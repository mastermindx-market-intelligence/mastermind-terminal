/**
 * optionsAlerts.ts — canonical PURE evaluators for the options-flow alert family.
 *
 * NO I/O. These are the single source of truth for BOTH the browser (AlertsView
 * creation preview + condition builder) AND the Python firing engine
 * (ingest/alerts_engine.py ports the SAME algorithms — the pytest parity guard in
 * tests/test_alerts_options.py keeps the two from drifting).
 *
 * Contract for every evaluator: (condition, payload, priorState) -> EvalResult.
 *   fired === null  → "cannot evaluate" (missing/malformed payload). The caller LOGS
 *                     and NEVER disarms — a null is honest, not a miss.
 *   fired === true  → the condition is met; the engine applies the one-shot disarm.
 *   fired === false → armed, not met (or first observation just arming the state).
 * `nextState` is the per-condition state to persist back onto condition.* jsonb.
 *
 * Display-tier law: every `note` carries the payload's as-of + a cadence word and
 * uses NO "signal"/"buy"/"sell"/"validated" vocabulary — only "crosses"/"reaches"/
 * "unusual pace"/"map"/"level". The wall note says walls are EOD levels.
 *
 * STATISTICAL ASSUMPTIONS (premium burst, `sessionSlopeStats`): per-minute deltas of the
 * cumulative premium series are treated as IID — no serial-correlation / HAC correction,
 * despite the well-known intraday autocorrelation and U-shaped intraday variance profile
 * real tape carries. The z is therefore a rough, not exact, standardized distance. A
 * session also re-runs the evaluator on every poll (~390 looks on a 1-minute tape); the
 * multiplicity this implies is handled by a per-fire COOLDOWN (see evalPremiumBurst), not
 * by raising the z threshold — the threshold itself is an unadjusted single-look bar.
 */

import { isValidRoot } from "@/lib/flowRoot";

export type GexState = {
  root?: string;
  spot?: number;
  gamma_flip?: number;
  call_wall?: number;
  put_wall?: number;
  asof?: string;
  authority_tier?: string;
  stale?: boolean;
};
export type GexPayload = {
  root?: string;
  spot_ref?: number;
  call_wall?: number;
  put_wall?: number;
  asof?: string;
  /** Per-strike ladder — the sign-fragility statistic reads the two gross sides. */
  by_strike?: { gamma_call?: number | null; gamma_put?: number | null }[];
  /** Per-expiration breakdown — the OPEX-concentration share reads gamma_net. */
  by_expiry?: { exp?: string; gamma_net?: number | null }[];
};
export type TidePoint = { t: string; ncp: number; npp: number };
export type TidePayload = { minutes?: TidePoint[]; asof?: string; session_date?: string };
export type DtePayload = { buckets?: Record<string, { t: string; ncp: number; npp: number }[]>; asof?: string };
export type EvalResult = { fired: boolean | null; value: number | null; note: string; nextState: Record<string, unknown> };

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const round = (x: number, dp = 2) => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};
/** "as of {asof}" fragment; empty asof degrades to "as of unknown time" so the note is never dishonestly bare. */
const asOf = (asof?: string) => `as of ${asof && asof.length ? asof : "unknown time"}`;

// ─── (a) gamma-flip cross ───────────────────────────────────────────────────
// cond {type:"opt_gamma_flip", root, band_pct?}  — hysteresis on a dead-band so
// dead-band jitter never flips the side. First observation ARMS (never fires).
export type GammaFlipCond = { type: "opt_gamma_flip"; root?: string; band_pct?: number };

export function evalGammaFlipCross(
  cond: GammaFlipCond,
  gs: GexState | null | undefined,
  prev: Record<string, unknown> | null | undefined,
): EvalResult {
  const p = prev || {};
  const spot = gs?.spot;
  const flip = gs?.gamma_flip;
  if (!isNum(spot) || !isNum(flip)) {
    return { fired: null, value: null, note: "gamma-flip level unavailable", nextState: p };
  }
  const band = isNum(cond.band_pct) ? cond.band_pct : 0.05;
  const rawSide = spot >= flip ? "above" : "below";
  const priorSide = typeof p.side === "string" ? (p.side as string) : undefined;

  // Hysteresis: only ACCEPT a side change when spot has cleared the flip by more
  // than band_pct% of flip. Inside the dead-band, hold the prior confirmed side.
  const beyondBand = flip !== 0 && (Math.abs(spot - flip) / flip) * 100 > band;
  let confirmed: string;
  if (priorSide === undefined) confirmed = rawSide; // first obs: adopt raw, but don't fire
  else if (rawSide !== priorSide && beyondBand) confirmed = rawSide; // real cross
  else confirmed = priorSide; // within band, or same side → hold

  const nextState = { side: confirmed };
  // Fire ONCE per cross: confirmed flipped AND we had a prior confirmed side.
  if (priorSide !== undefined && confirmed !== priorSide) {
    const root = cond.root || gs?.root || "the underlying";
    const dir =
      confirmed === "above"
        ? `crossed above its gamma flip (${flip}) → long-gamma side`
        : `crossed below its gamma flip (${flip}) → short-gamma side`;
    const note = `${root} ${dir} · ${asOf(gs?.asof)}, intraday`;
    return { fired: true, value: spot, note, nextState };
  }
  return { fired: false, value: spot, note: "", nextState };
}

// ─── (b) wall proximity ──────────────────────────────────────────────────────
// cond {type:"opt_wall_touch", root, wall:"call"|"put", within_pct?}  — fires on
// ENTER (false->true). First observation arms (records inside, no fire) so an
// alert created while already near the wall does not fire on creation.
export type WallTouchCond = { type: "opt_wall_touch"; root?: string; wall?: "call" | "put"; within_pct?: number };

export function evalWallProximity(
  cond: WallTouchCond,
  gx: GexPayload | null | undefined,
  prev: Record<string, unknown> | null | undefined,
): EvalResult {
  const p = prev || {};
  const spot = gx?.spot_ref;
  const wallSide = cond.wall === "put" ? "put" : "call";
  const wall = wallSide === "put" ? gx?.put_wall : gx?.call_wall;
  if (!isNum(spot) || !isNum(wall) || wall === 0) {
    return { fired: null, value: null, note: "wall level unavailable", nextState: p };
  }
  const within = isNum(cond.within_pct) ? cond.within_pct : 0.25;
  const distPct = (Math.abs(spot - wall) / wall) * 100;
  const inside = distPct <= within;
  const priorInside = typeof p.inside === "boolean" ? (p.inside as boolean) : undefined;
  const nextState = { inside };

  // Fire only on a false->true transition (prev.inside explicitly false).
  if (inside && priorInside === false) {
    const root = cond.root || gx?.root || "the underlying";
    const note = `${root} within ${within}% of its ${wallSide} wall (${wall}) — EOD wall level · ${asOf(gx?.asof)}`;
    return { fired: true, value: spot, note, nextState };
  }
  return { fired: false, value: spot, note: "", nextState };
}

// ─── (b2) wall migration ─────────────────────────────────────────────────────
// cond {type:"opt_wall_migration", root, wall:"call"|"put", min_move_pct?} — fires
// when the wall RE-STRIKES between nightly builds (a positioning change, not a
// price touch — masterplan §8; nobody in the category alerts on this). First
// observation ARMS (stores the wall strike). Sub-threshold jitter still updates
// the stored anchor so a slow drift cannot fire late.
export type WallMigrationCond = {
  type: "opt_wall_migration";
  root?: string;
  wall?: "call" | "put";
  min_move_pct?: number;
};

export function evalWallMigration(
  cond: WallMigrationCond,
  gx: GexPayload | null | undefined,
  prev: Record<string, unknown> | null | undefined,
): EvalResult {
  const p = prev || {};
  const spot = gx?.spot_ref;
  const wallSide = cond.wall === "put" ? "put" : "call";
  const wall = wallSide === "put" ? gx?.put_wall : gx?.call_wall;
  if (!isNum(spot) || spot === 0 || !isNum(wall)) {
    return { fired: null, value: null, note: "wall level unavailable", nextState: p };
  }
  const minMove = isNum(cond.min_move_pct) ? cond.min_move_pct : 0.4;
  const prior = isNum(p.level) ? (p.level as number) : undefined;
  const nextState = { level: wall };
  if (prior === undefined) return { fired: false, value: wall, note: "", nextState };
  const movedPct = (Math.abs(wall - prior) / spot) * 100;
  if (wall !== prior && movedPct >= minMove) {
    const root = cond.root || gx?.root || "the underlying";
    const arrow = wall > prior ? "up" : "down";
    const note =
      `${root} ${wallSide} wall migrated ${prior} → ${wall} (${arrow} ${movedPct.toFixed(1)}% of spot) — ` +
      `positioning re-struck, EOD build · ${asOf(gx?.asof)}`;
    return { fired: true, value: wall, note, nextState };
  }
  return { fired: false, value: wall, note: "", nextState };
}

// ─── (b3) sign fragility ─────────────────────────────────────────────────────
// cond {type:"opt_sign_fragile", root, tilt_pct?} — fires when the ladder's gamma
// tilt (the SAME sign-robustness statistic the Positioning tab and the Neural Web
// render) drops below tilt_pct% (default 12): the long/short-gamma read now
// depends on the dealer-sign assumption. ENTER only; first observation arms.
export type SignFragileCond = { type: "opt_sign_fragile"; root?: string; tilt_pct?: number };

export function evalSignFragile(
  cond: SignFragileCond,
  gx: GexPayload | null | undefined,
  prev: Record<string, unknown> | null | undefined,
): EvalResult {
  const p = prev || {};
  const rows = gx?.by_strike;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { fired: null, value: null, note: "ladder unavailable", nextState: p };
  }
  let callAbs = 0;
  let putAbs = 0;
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    if (isNum(r.gamma_call)) callAbs += Math.abs(r.gamma_call);
    if (isNum(r.gamma_put)) putAbs += Math.abs(r.gamma_put);
  }
  const total = callAbs + putAbs;
  if (!(total > 0)) {
    return { fired: null, value: null, note: "no gamma in the published window", nextState: p };
  }
  const tiltPct = (Math.abs(callAbs - putAbs) / total) * 100;
  const thresh = isNum(cond.tilt_pct) ? cond.tilt_pct : 12;
  const fragile = tiltPct < thresh;
  const prior = typeof p.fragile === "boolean" ? (p.fragile as boolean) : undefined;
  const nextState = { fragile };
  if (fragile && prior === false) {
    const root = cond.root || gx?.root || "the underlying";
    const note =
      `${root} gamma tilt collapsed to ${tiltPct.toFixed(1)}% (< ${thresh}%) — the long/short-gamma read ` +
      `now depends on the dealer-sign assumption, EOD build · ${asOf(gx?.asof)}`;
    return { fired: true, value: round(tiltPct, 1), note, nextState };
  }
  return { fired: false, value: round(tiltPct, 1), note: "", nextState };
}

// ─── (b4) OPEX concentration ─────────────────────────────────────────────────
// cond {type:"opt_opex_concentration", root, share_pct?} — fires when the FRONT
// expiry carries ≥ share_pct% (default 35, the Neural Web's opex_window bar) of
// gross gamma: the structure a desk reads today rolls off at that date. ENTER
// only; first observation arms.
export type OpexConcentrationCond = { type: "opt_opex_concentration"; root?: string; share_pct?: number };

export function evalOpexConcentration(
  cond: OpexConcentrationCond,
  gx: GexPayload | null | undefined,
  prev: Record<string, unknown> | null | undefined,
): EvalResult {
  const p = prev || {};
  const rows = gx?.by_expiry;
  if (!Array.isArray(rows)) {
    return { fired: null, value: null, note: "expiration breakdown unavailable", nextState: p };
  }
  const vals: { exp: string; v: number }[] = [];
  for (const r of rows) {
    if (r && typeof r === "object" && isNum(r.gamma_net)) {
      vals.push({ exp: String(r.exp ?? ""), v: r.gamma_net });
    }
  }
  if (!vals.length) {
    return { fired: null, value: null, note: "expiration breakdown unavailable", nextState: p };
  }
  vals.sort((a, b) => (a.exp < b.exp ? -1 : a.exp > b.exp ? 1 : 0));
  const total = vals.reduce((s, x) => s + Math.abs(x.v), 0);
  if (!(total > 0)) {
    return { fired: null, value: null, note: "no gamma in the expiration breakdown", nextState: p };
  }
  const share = (Math.abs(vals[0].v) / total) * 100;
  const thresh = isNum(cond.share_pct) ? cond.share_pct : 35;
  const above = share >= thresh;
  const prior = typeof p.above === "boolean" ? (p.above as boolean) : undefined;
  const nextState = { above };
  if (above && prior === false) {
    const root = cond.root || gx?.root || "the underlying";
    const note =
      `${root} front expiry ${vals[0].exp} carries ${share.toFixed(0)}% of gross gamma (≥ ${thresh}%) — ` +
      `OPEX-unwind window, today's structure rolls off at that date, EOD build · ${asOf(gx?.asof)}`;
    return { fired: true, value: round(share, 1), note, nextState };
  }
  return { fired: false, value: round(share, 1), note: "", nextState };
}

// ─── (c) premium burst ───────────────────────────────────────────────────────
// cond {type:"opt_premium_burst", root, leg:"ncp"|"npp", window_min?, z?}
// ncp/npp are CUMULATIVE → the honest slope is the per-minute delta. The trailing
// `window` deltas are the TEST window; the deltas STRICTLY BEFORE it are the
// baseline the window is judged against.

/**
 * The baseline must be at least this multiple of the test window before we are
 * entitled to call a pace "unusual". Below it the evaluators return the honest
 * null tri-state rather than a z computed off a handful of samples.
 */
export const MIN_BASELINE_MULT = 2;

export type PremiumBurstCond = {
  type: "opt_premium_burst";
  root?: string;
  leg?: "ncp" | "npp";
  window_min?: number;
  z?: number;
};

export type SlopeStats = {
  winMean: number | null;
  baseMean: number | null;
  baseStd: number | null;
  se: number | null;
  /** null = not scoreable; `why` says which guard tripped. */
  z: number | null;
  n: number; // total deltas
  w: number; // test-window deltas actually used
  baseN: number; // baseline deltas (strictly before the window)
  why: string; // "" when z is computable
};

/**
 * Slope statistics for a CUMULATIVE series. Deltas d[i]=series[i]-series[i-1] are
 * the per-step slope. The trailing `window` deltas are the TEST window; the deltas
 * BEFORE it are the baseline. The test statistic is winMean − baseMean, a comparison
 * of TWO sample means, so it is judged against the standard error of THAT difference —
 * baseStd·√(1/w + 1/baseN) — not against a one-sample baseStd/√w, which omits the
 * baseline mean's own sampling variance entirely.
 *
 * Four properties this fixes (see the OEU T-D PR body for the fail-then-pass table on
 * items 1-3; item 4 is the OEU bugwave follow-up):
 *  1. the baseline no longer contains the window it is judging, so a burst can no
 *     longer inflate the very yardstick it is measured against. The old form was
 *     bounded by z ≤ √((n−w)/w) no matter how violent the burst — at the default
 *     w=10 / z=2 that made ANY burst unable to fire until ~51 minutes of tape;
 *  2. a √w-only correction restores the RIGHT UNITS for a mean comparison but is still
 *     missing a term — see 4;
 *  3. too little baseline yields null, not a guess;
 *  4. the SE now carries BOTH sample sizes. baseStd/√w alone treats the baseline mean as
 *     a known constant with no sampling error of its own; at the minimum baseline this
 *     guard admits (baseN = 2w), that omission inflates z by exactly √1.5 ≈ 22.5% — a
 *     "2σ" alert was truly firing at 1.63σ. The two-sample SE is what a mean-vs-mean
 *     comparison actually requires; the single-sample form is the special case where
 *     baseN → ∞ (see the vitest for the convergence).
 * Exposed so the vitest can assert the z-math directly on synthetic series.
 */
export function sessionSlopeStats(series: number[], window: number): SlopeStats {
  const deltas: number[] = [];
  for (let i = 1; i < series.length; i++) deltas.push(series[i] - series[i - 1]);
  const n = deltas.length;
  if (n === 0) {
    return { winMean: null, baseMean: null, baseStd: null, se: null, z: null, n: 0, w: 0, baseN: 0, why: "no tape" };
  }
  const w = Math.max(1, Math.min(Math.floor(window) || 1, n));
  const baseN = Math.max(0, n - w);
  const blank = { winMean: null, baseMean: null, baseStd: null, se: null, z: null, n, w, baseN };
  // Min-sample guard — an honest null beats a z off a handful of samples.
  if (baseN < MIN_BASELINE_MULT * w) return { ...blank, why: "not enough baseline before the window" };

  const base = deltas.slice(0, baseN);
  const win = deltas.slice(baseN);
  const winMean = win.reduce((a, b) => a + b, 0) / w;
  const baseMean = base.reduce((a, b) => a + b, 0) / baseN;
  const variance = base.reduce((a, b) => a + (b - baseMean) * (b - baseMean), 0) / baseN; // population
  const baseStd = Math.sqrt(variance);
  if (!(baseStd > 0)) return { ...blank, winMean, baseMean, baseStd, why: "flat baseline" };
  // Two-sample SE of (winMean − baseMean): baseStd·√(1/w + 1/baseN). The 1/baseN term is
  // the piece the old baseStd/√w form dropped — see property 4 above.
  const se = baseStd * Math.sqrt(1 / w + 1 / baseN);
  return { winMean, baseMean, baseStd, se, z: (winMean - baseMean) / se, n, w, baseN, why: "" };
}

/** Minutes since midnight for an "HH:MM" tape stamp, or null if unparseable. Callers fall
 *  back to exact-stamp dedupe when the clock can't be read — see evalPremiumBurst. */
function minutesOfDay(t: string | null | undefined): number | null {
  if (typeof t !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  return h * 60 + mi;
}

export function evalPremiumBurst(
  cond: PremiumBurstCond,
  tide: TidePayload | null | undefined,
  prev: Record<string, unknown> | null | undefined,
): EvalResult {
  const p = prev || {};
  const leg = cond.leg === "npp" ? "npp" : "ncp";
  const windowMin = isNum(cond.window_min) ? Math.max(1, Math.floor(cond.window_min)) : 10;
  const zThresh = isNum(cond.z) ? cond.z : 2;
  const mins = tide?.minutes;
  // Window + baseline: (1+MIN_BASELINE_MULT)·w deltas → one more sample than that.
  const needSamples = (1 + MIN_BASELINE_MULT) * windowMin + 1;
  if (!Array.isArray(mins) || mins.length < needSamples) {
    return { fired: null, value: null, note: "not enough tape for pace check", nextState: p };
  }
  const series: number[] = [];
  for (const m of mins) {
    const v = m?.[leg];
    if (!isNum(v)) return { fired: null, value: null, note: "not enough tape for pace check", nextState: p };
    series.push(v);
  }
  const stats = sessionSlopeStats(series, windowMin);
  if (stats.z === null || !Number.isFinite(stats.z)) {
    return { fired: null, value: null, note: stats.why || "pace not scoreable", nextState: p };
  }
  const latestT = mins[mins.length - 1]?.t ?? "";
  // ONE-SIDED: a burst is a HOT tape. The old two-sided |z| also fired on a tape that
  // had gone unusually QUIET, which is the opposite of what the alert promises.
  const meetsBar = stats.z >= zThresh;

  // Multiplicity guard: the evaluator re-runs on every poll of the session (~390 looks on
  // a 1-minute tape). Per-stamp dedupe alone is too fine — `lastFiredT` used to advance to
  // the LATEST stamp on every evaluation that met the bar (fired or not), so the very next
  // new minute always looked "unfired" and a burst that stayed hot for K minutes fired K
  // times. Re-arm only once a full fresh window (`windowMin` minutes of NEW tape) has
  // elapsed since the last actual fire — a coarser key than the latest stamp, without
  // moving the z threshold itself.
  const lastFiredMin = minutesOfDay(typeof p.lastFiredT === "string" ? p.lastFiredT : null);
  const nowMin = minutesOfDay(latestT);
  const cooldownElapsed =
    lastFiredMin == null || nowMin == null
      ? p.lastFiredT !== latestT // clock unparseable: fall back to exact-stamp dedupe
      : nowMin - lastFiredMin >= windowMin;
  const fires = meetsBar && cooldownElapsed;
  const nextState: Record<string, unknown> = fires
    ? { lastFiredT: latestT, lastZ: round(stats.z, 2) }
    : { lastFiredT: p.lastFiredT, lastZ: p.lastZ };

  if (fires) {
    const root = cond.root || "the underlying";
    const legWord = leg === "npp" ? "net-put premium" : "net-call premium";
    const note = `${root} ${legWord} moving at an unusual pace (z ${stats.z.toFixed(1)}, last ${windowMin}m vs the ${stats.baseN}m before it) · intraday tape ${asOf(tide?.asof)}`;
    return { fired: true, value: round(stats.z, 2), note, nextState };
  }
  return { fired: false, value: round(stats.z, 2), note: "", nextState };
}

// ─── (d) 0DTE share ──────────────────────────────────────────────────────────
// cond {type:"opt_0dte_spike", root, share_pct?}  — share of tracked net premium
// carried by the "0d" bucket at the latest common stamp. Missing 0d → null.
export type Zero0dteCond = { type: "opt_0dte_spike"; root?: string; share_pct?: number };

export function eval0dteShare(
  cond: Zero0dteCond,
  dte: DtePayload | null | undefined,
  prev: Record<string, unknown> | null | undefined,
): EvalResult {
  const p = prev || {};
  const buckets = dte?.buckets;
  if (!buckets || typeof buckets !== "object" || !Array.isArray(buckets["0d"])) {
    return { fired: null, value: null, note: "0DTE split unavailable", nextState: p };
  }
  const sharePct = isNum(cond.share_pct) ? cond.share_pct : 55;

  // Latest common stamp = the newest t present in every bucket that actually carries
  // rows (an honest cross-section). An EMPTY bucket (e.g. "90p" with no flow yet — routine
  // early in a session) has nothing to disagree with the others about; it must not
  // collapse the whole intersection to zero the way a genuinely MISSING bucket would. An
  // absent bucket already returns null above; an empty one now just contributes 0 to the
  // share's denominator, same as a bucket that was never wired at all.
  const bucketKeys = Object.keys(buckets).filter(
    (k) => Array.isArray(buckets[k]) && buckets[k].length > 0
  );
  const stampSets = bucketKeys.map((k) => new Set(buckets[k].map((r) => r.t)));
  let common: string[] = stampSets.length ? [...stampSets[0]] : [];
  for (let i = 1; i < stampSets.length; i++) common = common.filter((t) => stampSets[i].has(t));
  if (common.length === 0) {
    return { fired: null, value: null, note: "0DTE split unavailable", nextState: p };
  }
  common.sort();
  const stamp = common[common.length - 1];

  const magAt = (rows: { t: string; ncp: number; npp: number }[]): number => {
    const row = rows.find((r) => r.t === stamp);
    if (!row) return 0;
    const ncp = isNum(row.ncp) ? Math.abs(row.ncp) : 0;
    const npp = isNum(row.npp) ? Math.abs(row.npp) : 0;
    return ncp + npp;
  };
  let total = 0;
  for (const k of bucketKeys) total += magAt(buckets[k]);
  const zeroMag = magAt(buckets["0d"]);
  if (total === 0) {
    return { fired: null, value: null, note: "0DTE split unavailable", nextState: p };
  }
  const share = (zeroMag / total) * 100;
  const fires = share >= sharePct;
  const alreadyFired = p.lastFiredT === stamp;
  const nextState: Record<string, unknown> = fires ? { lastFiredT: stamp } : { lastFiredT: p.lastFiredT };

  if (fires && !alreadyFired) {
    const root = cond.root || "the underlying";
    const note = `${root} 0DTE share ${share.toFixed(0)}% of tracked net premium · 10-min DTE tape ${asOf(dte?.asof)}`;
    return { fired: true, value: round(share, 1), note, nextState };
  }
  return { fired: false, value: round(share, 1), note: "", nextState };
}

// ─── (e) surface hot pocket ──────────────────────────────────────────────────
// cond {type:"opt_surface_pocket", root, k?, near_pct?, metric?}
// The Flow-Surface snapshot is a strike × interval grid of net premium
// (grids[metric][levelIdx][timeIdx]). A "hot pocket" is a single cell in the
// NEWEST interval, at a strike near spot, carrying |value| ≥ k × the trailing
// session cell-scale.
//
// Scale = the MEAN |cell| over the same near-spot strikes in the intervals
// STRICTLY BEFORE the newest one — the same baseline-exclusion discipline as the
// premium-burst z, so a hot cell cannot inflate the yardstick it is measured
// against. Mean-abs (not median) is deliberate: it is the conservative choice
// here, since one earlier outlier RAISES the bar rather than lowering it.
//
// Tri-state null when: no surface store for the root, too few intervals to scale
// against, no strikes inside the band, or a scale of zero.

/** Intervals of trailing history required before a pocket can be scored. */
export const MIN_SURFACE_COLS = 3;

export type SurfacePocketCond = {
  type: "opt_surface_pocket";
  root?: string;
  k?: number; // multiple of the trailing cell-scale (default 4)
  near_pct?: number; // ± band around spot, in % (default 5)
  metric?: string; // grid metric (default "netprem")
};

/** The subset of SurfaceFrame (lib/surfaceContract.ts) this evaluator reads. */
export type SurfaceFramePayload = {
  spot?: number | null;
  price_levels?: number[];
  time_steps?: string[];
  grids?: Record<string, (number | null)[][]>;
  asof?: string;
  root?: string;
};

export function evalSurfaceHotPocket(
  cond: SurfacePocketCond,
  frame: SurfaceFramePayload | null | undefined,
  prev: Record<string, unknown> | null | undefined,
): EvalResult {
  const p = prev || {};
  const metric = typeof cond.metric === "string" && cond.metric.length ? cond.metric : "netprem";
  const k = isNum(cond.k) && cond.k > 0 ? cond.k : 4;
  const nearPct = isNum(cond.near_pct) && cond.near_pct > 0 ? cond.near_pct : 5;
  const levels = frame?.price_levels;
  const steps = frame?.time_steps;
  const grid = frame?.grids?.[metric];
  const spot = frame?.spot;
  if (!Array.isArray(levels) || !Array.isArray(steps) || !Array.isArray(grid) || !isNum(spot) || spot <= 0) {
    return { fired: null, value: null, note: "no surface for this root yet", nextState: p };
  }
  const tLast = steps.length - 1;
  if (tLast < MIN_SURFACE_COLS) {
    return { fired: null, value: null, note: "not enough surface history to scale", nextState: p };
  }
  // Near-spot strikes only: |strike − spot| / spot ≤ near_pct%.
  const rows: number[] = [];
  for (let i = 0; i < levels.length; i++) {
    const lv = levels[i];
    if (isNum(lv) && (Math.abs(lv - spot) / spot) * 100 <= nearPct) rows.push(i);
  }
  if (rows.length === 0) {
    return { fired: null, value: null, note: "no strikes near spot on the surface", nextState: p };
  }
  // Trailing cell-scale over the intervals BEFORE the newest one.
  let sum = 0;
  let cnt = 0;
  for (const r of rows) {
    const row = grid[r];
    if (!Array.isArray(row)) continue;
    for (let t = 0; t < tLast; t++) {
      const v = row[t];
      if (isNum(v)) {
        sum += Math.abs(v);
        cnt++;
      }
    }
  }
  if (cnt === 0 || sum === 0) {
    return { fired: null, value: null, note: "surface too sparse to scale", nextState: p };
  }
  const scale = sum / cnt;
  // Hottest near-spot cell in the NEWEST interval.
  let hot = 0;
  let hotLevel: number | null = null;
  let found = false;
  for (const r of rows) {
    const v = grid[r]?.[tLast];
    if (!isNum(v)) continue;
    if (!found || Math.abs(v) > Math.abs(hot)) {
      hot = v;
      hotLevel = levels[r];
      found = true;
    }
  }
  if (!found || hotLevel === null) {
    return { fired: null, value: null, note: "no surface reading at the latest interval", nextState: p };
  }
  const ratio = Math.abs(hot) / scale;
  const stamp = steps[tLast] ?? "";
  const fires = ratio >= k;
  const alreadyFired = p.lastFiredT === stamp;
  const nextState: Record<string, unknown> = fires
    ? { lastFiredT: stamp, lastRatio: round(ratio, 2), lastStrike: hotLevel }
    : { lastFiredT: p.lastFiredT, lastRatio: p.lastRatio, lastStrike: p.lastStrike };

  if (fires && !alreadyFired) {
    const root = cond.root || frame?.root || "the underlying";
    const side = hot >= 0 ? "call-side" : "put-side";
    const note =
      `${root} ${hotLevel} strike lit up ${ratio.toFixed(1)}× its usual cell on the surface ` +
      `(${side} net premium at ${stamp}, strikes within ${nearPct}% of spot) · ${asOf(frame?.asof)}`;
    return { fired: true, value: round(ratio, 2), note, nextState };
  }
  return { fired: false, value: round(ratio, 2), note: "", nextState };
}

// ─── UI helpers: creation preview + condition builder (shared with AlertsView) ──
export type OptKind =
  | "opt_gamma_flip"
  | "opt_wall_touch"
  | "opt_premium_burst"
  | "opt_0dte_spike"
  | "opt_surface_pocket"
  | "opt_wall_migration"
  | "opt_sign_fragile"
  | "opt_opex_concentration";

export type OptParams = {
  band_pct?: number;
  within_pct?: number;
  wall?: "call" | "put";
  window_min?: number;
  z?: number;
  leg?: "ncp" | "npp";
  share_pct?: number;
  k?: number;
  near_pct?: number;
  min_move_pct?: number;
  tilt_pct?: number;
};

/** These publishers aggregate the tracked options universe; they are not root-specific. */
export function isMarketWideOptKind(kind: string): boolean {
  return kind === "opt_premium_burst" || kind === "opt_0dte_spike";
}

/** Normalize a root before it can become both the row identity and evaluator input. */
export function normalizeOptAlertRoot(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const root = value.trim().toUpperCase();
  // Strip+upper, then the one root rule /api/flow applies (lib/flowRoot.ts). Flow._root in
  // ingest/alerts_engine.py ports the same rule; tests/test_alerts_engine_identity.py pins it.
  return isValidRoot(root) ? root : null;
}

/** Canonical storage identity for an options alert.
 *
 * Tide and DTE publishers aggregate the tracked options universe rather than one root. Keeping
 * this normalization pure lets both the form and the POST route enforce the same law,
 * including clients that bypass or predate the current picker.
 */
export function canonicalizeOptAlertIdentity(
  symbol: string,
  condition: Record<string, unknown>,
): { symbol: string; condition: Record<string, unknown> } | null {
  if (isMarketWideOptKind(String(condition.type ?? ""))) {
    return { symbol: "MARKET", condition: { ...condition, root: "MARKET" } };
  }
  // condition.root is the evaluator's actual input, so it is the sole root authority.
  // Persisting that same normalized value as symbol prevents a SPY-labelled row from
  // silently evaluating QQQ when a stale or bypassing client sends conflicting fields.
  const root = normalizeOptAlertRoot(condition.root);
  if (!root) return null;
  return { symbol: root, condition: { ...condition, root } };
}

export type OptAlertIdentityState = "ok" | "unresolved";

/** Derived read-side identity. Unresolved exactly when canonicalize returns null. */
export function optAlertIdentityState(
  symbol: string,
  condition: Record<string, unknown>,
): OptAlertIdentityState {
  return canonicalizeOptAlertIdentity(symbol, condition) ? "ok" : "unresolved";
}

/**
 * Build the `{type, root, ...}` condition the POST sends. Only the fields each
 * type reads are included (opaque jsonb — the API route passes it through
 * unchanged). Numeric params are coerced; undefined params fall to evaluator
 * defaults, so an omitted field is still valid.
 */
export function buildOptCondition(kind: OptKind, root: string, params: OptParams): Record<string, unknown> {
  const r = (root || "SPY").toUpperCase();
  if (kind === "opt_gamma_flip") {
    const c: Record<string, unknown> = { type: kind, root: r };
    if (isNum(params.band_pct)) c.band_pct = params.band_pct;
    return c;
  }
  if (kind === "opt_wall_touch") {
    const c: Record<string, unknown> = { type: kind, root: r, wall: params.wall === "put" ? "put" : "call" };
    if (isNum(params.within_pct)) c.within_pct = params.within_pct;
    return c;
  }
  if (kind === "opt_premium_burst") {
    const c: Record<string, unknown> = { type: kind, root: "MARKET", leg: params.leg === "npp" ? "npp" : "ncp" };
    if (isNum(params.window_min)) c.window_min = params.window_min;
    if (isNum(params.z)) c.z = params.z;
    return c;
  }
  if (kind === "opt_surface_pocket") {
    const c: Record<string, unknown> = { type: kind, root: r };
    if (isNum(params.k)) c.k = params.k;
    if (isNum(params.near_pct)) c.near_pct = params.near_pct;
    return c;
  }
  if (kind === "opt_wall_migration") {
    const c: Record<string, unknown> = { type: kind, root: r, wall: params.wall === "put" ? "put" : "call" };
    if (isNum(params.min_move_pct)) c.min_move_pct = params.min_move_pct;
    return c;
  }
  if (kind === "opt_sign_fragile") {
    const c: Record<string, unknown> = { type: kind, root: r };
    if (isNum(params.tilt_pct)) c.tilt_pct = params.tilt_pct;
    return c;
  }
  if (kind === "opt_opex_concentration") {
    const c: Record<string, unknown> = { type: kind, root: r };
    if (isNum(params.share_pct)) c.share_pct = params.share_pct;
    return c;
  }
  // opt_0dte_spike
  const c: Record<string, unknown> = { type: kind, root: "MARKET" };
  if (isNum(params.share_pct)) c.share_pct = params.share_pct;
  return c;
}

/**
 * Plain-word "what will fire" for the creation preview. Reads the SAME condition
 * shape buildOptCondition emits. Display-tier: no banned vocabulary.
 */
export function optAlertPreview(cond: Record<string, unknown>, lang: "en" | "zh"): string {
  const zh = lang === "zh";
  const root = typeof cond.root === "string" && cond.root.length ? (cond.root as string) : "SPY";
  const type = cond.type;
  if (type === "opt_gamma_flip") {
    return zh ? `当 ${root} 上穿/下穿其 gamma 翻转位时提醒我` : `Alert me when ${root} crosses its gamma flip`;
  }
  if (type === "opt_wall_touch") {
    const wall = cond.wall === "put" ? "put" : "call";
    const within = isNum(cond.within_pct) ? (cond.within_pct as number) : 0.25;
    if (zh) {
      const wz = wall === "put" ? "看跌墙" : "看涨墙";
      return `当 ${root} 接近其${wz}（EOD 水平）${within}% 以内时提醒我`;
    }
    return `Alert me when ${root} comes within ${within}% of its ${wall} wall (EOD)`;
  }
  if (type === "opt_premium_burst") {
    const leg = cond.leg === "npp" ? "npp" : "ncp";
    if (zh) {
      const lw = leg === "npp" ? "看跌权利金" : "看涨权利金";
      return `当覆盖范围内的净${lw}以异常速度变动时提醒我`;
    }
    const lw = leg === "npp" ? "net-put premium" : "net-call premium";
    return `Alert me when ${lw} across the covered options tape moves at an unusual pace`;
  }
  if (type === "opt_surface_pocket") {
    const near = isNum(cond.near_pct) ? (cond.near_pct as number) : 5;
    return zh
      ? `当 ${root} 平值附近（±${near}%）某个行权价在期权面上异常放量时提醒我`
      : `Alert me when a strike lights up hot on the ${root} surface (within ${near}% of spot)`;
  }
  if (type === "opt_wall_migration") {
    const wall = cond.wall === "put" ? "put" : "call";
    const min = isNum(cond.min_move_pct) ? (cond.min_move_pct as number) : 0.4;
    if (zh) {
      const wz = wall === "put" ? "看跌墙" : "看涨墙";
      return `当 ${root} 的${wz}换到新行权价（移动 ≥ 现价的 ${min}%）时提醒我`;
    }
    return `Alert me when the ${root} ${wall} wall re-strikes (moves ≥ ${min}% of spot)`;
  }
  if (type === "opt_sign_fragile") {
    const tilt = isNum(cond.tilt_pct) ? (cond.tilt_pct as number) : 12;
    return zh
      ? `当 ${root} 的伽马倾斜跌破 ${tilt}%（多空伽马判断变得依赖符号假设）时提醒我`
      : `Alert me when the ${root} gamma tilt drops below ${tilt}% (the long/short read turns assumption-fragile)`;
  }
  if (type === "opt_opex_concentration") {
    const share = isNum(cond.share_pct) ? (cond.share_pct as number) : 35;
    return zh
      ? `当 ${root} 近月到期伽马占比达到 ${share}% 以上（OPEX 展仓窗口）时提醒我`
      : `Alert me when the ${root} front expiry carries ${share}%+ of gross gamma (OPEX-unwind window)`;
  }
  // opt_0dte_spike
  const share = isNum(cond.share_pct) ? (cond.share_pct as number) : 55;
  return zh
    ? `当覆盖范围内的 0DTE 占比超过 ${share}% 时提醒我`
    : `Alert me when 0DTE share across the covered options tape tops ${share}%`;
}

// ─── (f) frozen-node sampled proximity (PREPARATORY — no production caller yet) ──
// cond {type:"opt_frozen_node_proximity", root, target, within_pct?}
//
// PREPARATORY CORE ONLY. The production alert route does not admit this type yet; no
// API allowlist entry, condition-builder branch or preview line is added here, and no
// real admission reader exists. This evaluator exists so the TS and Python owners can be
// parity-guarded against one shared vector file before a verified reader lands.
//
// What it watches: ONE frozen options node — an exact expiry/strike/right member set
// bound to a source fingerprint at arming time — and it fires when the CURRENT SESSION
// spot first comes within `within_pct`% of that frozen price. That is SAMPLED proximity,
// never an exact intrabar touch and never a probability. The level is never re-derived,
// re-priced or re-ranked: whatever wall the source would publish TODAY is irrelevant. A
// node frozen at 620 is judged against 620 even when today's rebuilt wall prints 630.
// Expiry/right/lens stay EXPLICIT through members + scopeKey — nothing here infers a
// "full"/"strongest"/"current" ranking, and the target's observed_partial qualification
// is carried verbatim, never upgraded.
//
// Trust law (binding):
//   * The admission context is a SEPARATE trusted caller argument — the out-of-band
//     result of a server-side admission reader. It is NEVER read out of the condition
//     jsonb: an admission/rights/allowed key inside condition JSON grants nothing.
//   * Prior observation is NOT attested by the row. Alerts carry own-row RLS, so a
//     browser or a direct DB write can set created_at, armingEpoch, condition._fnp or a
//     planted admission blob freely — none of it can admit, arm or bootstrap a
//     transition. The admission reader must INDEPENDENTLY attest both the armingEpoch
//     and the priorState provenance; that authority is the reader's responsibility, not
//     a self-asserted boolean in the row.
//   * context.priorState is REQUIRED: null for an independently attested initial (or
//     changed-epoch) arming, or the reader-verified previous state. An ABSENT key is
//     rejected. This evaluator only ever USES the reader-attested priorState. The
//     persisted condition._fnp stays this evaluator's own persistence OUTPUT: the
//     prevState argument below is that row output, it is never a provenance claim, and
//     it is only consulted to detect tampering (see the cross-check below). A future
//     production reader must verify the stored state's provenance independently before
//     returning it as priorState.
//   * The envelope {principal, createdAt, evaluationAt} is the trusted server caller's
//     own record of who is being evaluated and when. The admission context must repeat
//     the envelope's principal and createdAt EXACTLY and bind the CURRENT evaluation
//     instant; rights.allowed must be strictly true, with a nonempty policy_version and
//     a checked_at equal to the actual evaluation instant; the returned target identity
//     must equal the requested target identity exactly.
//   * This is a STRUCTURAL caller contract, NOT cryptographic authentication — the
//     reader's own provenance is the trusted caller's responsibility.
//
// Clocks: availableAt <= armingEpoch <= evaluationAt, armingEpoch >= server createdAt,
// and the qualified quote must be strictly AFTER armingEpoch and no later than
// evaluationAt. Timestamps are exact timezone-aware instants at microsecond
// resolution — naive stamps and impossible calendar dates are rejected, microseconds
// preserved.
//
// State machine on cond._fnp = {targetFingerprint, armingEpoch, lastQuoteAt, inside, withinPct, lastQuoteBasis}:
// the FIRST qualifying quote for a (target, armingEpoch) binding only ARMS — even when
// already inside — so pre-enrollment touches are ignored and an alert created near the
// node does not fire on creation. Only a later outside→inside transition of a NEWER
// quote fires. A duplicate or out-of-order quote causes no transition and no state
// advance. A changed target or a changed armingEpoch re-arms (and the reader must attest
// that re-arming with priorState: null). Unknown/revoked context never updates state.
//
// Identity: fingerprint = sha256 over a canonical ordered tuple of EVERY target field,
// with number payloads rendered as IEEE-754 big-endian hex and instants as UTC epoch
// microseconds, with clock/member counts and UTF-8 byte-length-prefixed tokens — never JSON.stringify/dumps number text, which the two languages render
// differently. The fingerprint is a STATE BINDING ONLY, not a new provenance proof; it
// reuses the existing sourceKey/inputSha256/member binding rather than replacing it.
//
// null is honest: any unavailable input (no reader, malformed/denied/unknown admission,
// no qualified quote) returns fired===null with the row state UNCHANGED — the caller
// logs and never disarms.

export const FNP_STATE_KEY = "_fnp";
/** The admission context's action value for this type. */
export const FNP_ADMITTED_ACTION = "frozen_node_proximity";
/** The only target qualification this evaluator accepts — carried verbatim, never upgraded. */
export const FNP_QUALIFICATION = "observed_partial";
export const FNP_DEFAULT_WITHIN_PCT = 0.25;

export type FrozenNodeMember = { expiry: string; strike: number; right: "C" | "P" };

export type FrozenNodeSourceBinding = {
  inputSha256: string;
  populationId: string;
  sourceRef: string;
  /** Exact native clock values: dates, optional instants and correction references.
   * Native projection validation owns their field semantics. Never coerce null/date labels. */
  clocks: Record<string, string | null>;
};

export type FrozenNodeTarget = {
  root: string;
  securityId: string;
  sourceSession: string;
  /** Full selected-root document canonical JSON VALUE fingerprint from
   * exposureValueFingerprint(raw); never a response-byte SHA, signature, chart or lens digest. */
  sourceKey: string;
  definitionKey: string;
  /** The lens this frozen node was read through — carried, never re-inferred. */
  scopeKey: string;
  availableAt: string;
  sourceBinding: FrozenNodeSourceBinding;
  /** Exact member set; every strike must equal price. Unique, nonempty. */
  members: FrozenNodeMember[];
  price: number;
  qualification: "observed_partial";
};

/** Trusted qualified current-session quote (Data.live_quote's receipt on the Python side). */
export type FrozenNodeQuote = { spot: number; asof: string; basis: string };

/** Reader-attested previous state, or null for an attested fresh (re-)arming. */
export type FrozenNodePriorState = {
  targetFingerprint: string;
  armingEpoch: string;
  lastQuoteAt: string;
  inside: boolean;
  withinPct: number;
  lastQuoteBasis: string;
};

/** The trusted server caller's own record of the evaluation — never built from condition JSON. */
export type FrozenNodeEnvelope = { principal: string; createdAt: string; evaluationAt: string };

export type FrozenNodeAdmissionContext = {
  principal: string;
  createdAt: string;
  armingEpoch: string;
  evaluationAt: string;
  action: string;
  target: FrozenNodeTarget;
  rights: { allowed: boolean; policy_version: string; checked_at: string };
  priorState: FrozenNodePriorState | null;
};

export type FrozenNodeCond = {
  type: "opt_frozen_node_proximity";
  root?: string;
  target?: FrozenNodeTarget;
  within_pct?: number;
};

const FNP_US = String.fromCharCode(31);
const FNP_HEX64 = /^[0-9a-f]{64}$/;
const FNP_ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FNP_INSTANT_RE =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,6}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

/** Calendar-day guard for the exact-instant parser: Feb 30 and month 13 are impossible
 *  dates, and Date.parse would silently roll them forward instead of refusing. */
function fnpIsCalendarDay(date: string): boolean {
  const m = FNP_ISO_DATE.exec(date);
  if (!m) return false;
  const y = Number(date.slice(0, 4));
  const mo = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  if (date.length !== 10 || y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysIn = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= daysIn[mo - 1];
}

/** Exact timezone-aware instant → UTC epoch microseconds (bigint), or null. Naive stamps
 *  and impossible dates are rejected; microseconds are preserved. Same exact-clock shape
 *  as the existing instantMicros parser pattern. */
export function fnpInstantMicros(x: unknown): bigint | null {
  if (typeof x !== "string") return null;
  const m = FNP_INSTANT_RE.exec(x);
  if (!m || m[0] !== x || !fnpIsCalendarDay(m[1])) return null;
  const off = m[6];
  let deltaMs = 0;
  if (off !== "Z") {
    const sign = off[0] === "-" ? -BigInt(1) : BigInt(1);
    deltaMs = Number(sign * (BigInt(off.slice(1, 3)) * BigInt(60) + BigInt(off.slice(4, 6)))) * 60000;
  }
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
  const utcYear = new Date(ms - deltaMs).getUTCFullYear();
  if (!Number.isFinite(ms) || utcYear < 1 || utcYear > 9999) return null;
  return BigInt(ms) * BigInt(1000) + BigInt((m[5] ?? "").padEnd(6, "0")) - BigInt(deltaMs) * BigInt(1000);
}

/** Canonical UTC rendering of an epoch-microsecond instant — the state's clock text, so
 *  both languages persist byte-identical state values. */
export function fnpFormatInstantUtc(micros: bigint): string {
  let secs = micros / BigInt(1000000); // BigInt division truncates toward zero…
  let frac = micros % BigInt(1000000); // …so fix the remainder up for pre-1970 instants.
  if (frac < BigInt(0)) {
    frac += BigInt(1000000);
    secs -= BigInt(1);
  }
  const d = new Date(Number(secs) * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${String(d.getUTCFullYear()).padStart(4, "0")}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}` +
    `.${frac.toString().padStart(6, "0")}Z`
  );
}

/** Preserve native metadata strings; only actual aware instant clocks can be future.
 * Date labels and correction references are never inflated into timestamps. */
function fnpSourceClockAfter(key: string, value: string | null, evaluationAt: bigint): boolean {
  if (value === null || ["source_session", "oi_report_date", "oi_position_session", "correction_ref"].includes(key)) return false;
  const match = /^(\d{4}-\d{2}-\d{2}T[0-2]\d:[0-5]\d:[0-5]\d)(?:\.(\d{1,9}))?(Z|[+-][0-2]\d:[0-5]\d)$/.exec(value);
  if (!match || match[0] !== value) return false;
  const fraction = (match[2] ?? "").padEnd(9, "0");
  const micros = fnpInstantMicros(`${match[1]}.${fraction.slice(0, 6)}${match[3]}`);
  return micros !== null && micros * BigInt(1000) + BigInt(fraction.slice(6)) > evaluationAt * BigInt(1000);
}

/** A finite positive native number — bools and numeric strings never pass. */
function fnpPositiveNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x > 0;
}

/** IEEE-754 big-endian hex of a finite double — the cross-language number payload token
 *  (JS DataView ↔ Python struct). Never a JSON/dumps float rendering. */
export function fnpF64BeHex(x: unknown): string | null {
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, x, false);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

const FNP_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Self-contained SHA-256 (UTF-8 input → 64-hex). Dependency-free on purpose: this module
 *  is loaded in the browser, so node:crypto is not reachable here. Used ONLY for the
 *  state-binding fingerprint — never as a provenance proof. */
function fnpSha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const blocks = ((bytes.length + 8) >> 6) + 1;
  const buf = new ArrayBuffer(blocks << 6);
  const out = new Uint8Array(buf);
  out.set(bytes);
  out[bytes.length] = 0x80;
  const dv = new DataView(buf);
  dv.setUint32(buf.byteLength - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(buf.byteLength - 4, bitLen >>> 0);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;
  const w = new Uint32Array(64);
  for (let off = 0; off < buf.byteLength; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a15 = w[i - 15];
      const a2 = w[i - 2];
      const s0 = rotr(a15, 7) ^ rotr(a15, 18) ^ (a15 >>> 3);
      const s1 = rotr(a2, 17) ^ rotr(a2, 19) ^ (a2 >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + FNP_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, "0")).join("");
}

function fnpText(x: unknown): string | null {
  if (typeof x !== "string" || !x.length) return null;
  // TextEncoder replaces lone surrogates; refuse them instead of aliasing U+FFFD.
  for (const char of x) {
    const cp = char.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) return null;
  }
  return x;
}

function fnpRecord(x: unknown): Record<string, unknown> | null {
  return x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

/** An exact ISO calendar date (an options expiry), not an arbitrary token. */
function fnpIsoDate(x: unknown): string | null {
  if (typeof x !== "string" || !FNP_ISO_DATE.test(x) || !fnpIsCalendarDay(x)) return null;
  return x;
}

/**
 * Canonical ordered token tuple for a frozen-node target — the ONE cross-language identity
 * algorithm. Every field is validated in the same pass, so a target that cannot be
 * fingerprinted is a target that cannot be evaluated. Number payloads become IEEE-754
 * big-endian hex and instants become UTC epoch-microsecond decimals; strings are used
 * verbatim. Returns null for any malformed field (absent member, non-observed_partial
 * qualification, member strike ≠ price, duplicate member, impossible clock, …).
 */
function fnpTargetTokens(target: unknown): string[] | null {
  const t = fnpRecord(target);
  if (!t || Object.keys(t).sort().join(",") !==
      "availableAt,definitionKey,members,price,qualification,root,scopeKey,securityId,sourceBinding,sourceKey,sourceSession") return null;
  const root = fnpText(t.root);
  if (!root || !isValidRoot(root) || normalizeOptAlertRoot(root) !== root) return null;
  const securityId = fnpText(t.securityId);
  const sourceSession = fnpText(t.sourceSession);
  const sourceKey = fnpText(t.sourceKey);
  const definitionKey = fnpText(t.definitionKey);
  const scopeKey = fnpText(t.scopeKey);
  if (!securityId || !sourceSession || !definitionKey || !scopeKey) return null;
  if (!sourceKey || sourceKey.length !== 64 || !FNP_HEX64.test(sourceKey)) return null;
  const availableAt = fnpInstantMicros(t.availableAt);
  if (availableAt === null) return null;
  const binding = fnpRecord(t.sourceBinding);
  if (!binding || Object.keys(binding).sort().join(",") !== "clocks,inputSha256,populationId,sourceRef") return null;
  const inputSha256 = fnpText(binding.inputSha256);
  const populationId = fnpText(binding.populationId);
  const sourceRef = fnpText(binding.sourceRef);
  if (!inputSha256 || inputSha256.length !== 64 || !FNP_HEX64.test(inputSha256) || !populationId || !sourceRef) return null;
  const clocks = fnpRecord(binding.clocks);
  if (!clocks) return null;
  const clockKeys = Object.keys(clocks).sort();
  if (clockKeys.length === 0) return null;
  const clockTokens: string[] = [];
  for (const key of clockKeys) {
    if (!fnpText(key)) return null;
    const value = clocks[key];
    if (value === null) clockTokens.push(key, "null");
    else if (typeof value === "string" && (value.length === 0 || fnpText(value) !== null)) {
      clockTokens.push(key, "string", value);
    } else return null;
  }
  const price = t.price;
  if (!fnpPositiveNum(price)) return null;
  const priceToken = fnpF64BeHex(price);
  if (priceToken === null) return null;
  const rawMembers = t.members;
  if (!Array.isArray(rawMembers) || rawMembers.length === 0) return null;
  const memberTokens: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawMembers) {
    const m = fnpRecord(raw);
    if (!m || Object.keys(m).sort().join(",") !== "expiry,right,strike") return null;
    const expiry = fnpIsoDate(m.expiry);
    const strike = m.strike;
    if (!expiry || !fnpPositiveNum(strike)) return null;
    if (m.right !== "C" && m.right !== "P") return null;
    // The frozen member set is exact: every strike IS the frozen price.
    if (strike !== price) return null;
    const strikeToken = fnpF64BeHex(strike);
    if (strikeToken === null) return null;
    const key = `${expiry}${FNP_US}${String(m.right)}${FNP_US}${strikeToken}`;
    if (seen.has(key)) return null;
    seen.add(key);
    memberTokens.push(key);
  }
  memberTokens.sort();
  if (t.qualification !== FNP_QUALIFICATION) return null;
  const tokens = [
    "opt_frozen_node_target/v1",
    root,
    securityId,
    sourceSession,
    sourceKey,
    definitionKey,
    scopeKey,
    availableAt.toString(),
    inputSha256,
    populationId,
    sourceRef,
  ];
  tokens.push("clocks", String(clockKeys.length), ...clockTokens, "members", String(memberTokens.length));
  for (const mk of memberTokens) tokens.push("member", mk);
  tokens.push("price", priceToken, FNP_QUALIFICATION);
  return tokens;
}

/**
 * The deterministic cross-language identity of a frozen-node target — sha256 over the
 * canonical token tuple above. STATE BINDING ONLY: it keys the persisted hysteresis state
 * to one exact target, and it is not a provenance proof (the source's own fingerprint
 * remains target.sourceKey / sourceBinding.inputSha256).
 */
export function frozenNodeTargetFingerprint(target: unknown): string | null {
  const tokens = fnpTargetTokens(target);
  // Length-prefix each UTF-8 token: embedded delimiters cannot alias field boundaries.
  return tokens === null ? null : fnpSha256Hex(tokens.map(token =>
    `${new TextEncoder().encode(token).length}:${token}`).join(""));
}

/** Field-by-field equality of two persisted states (no JSON round-trip). */
function fnpSameState(
  a: FrozenNodePriorState | null,
  b: FrozenNodePriorState | null,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.targetFingerprint === b.targetFingerprint &&
    a.armingEpoch === b.armingEpoch &&
    a.lastQuoteAt === b.lastQuoteAt &&
    a.inside === b.inside && a.withinPct === b.withinPct && a.lastQuoteBasis === b.lastQuoteBasis
  );
}

/** Normalize/validate a persisted frozen-node state object: the exact predicate and quote state fields,
 *  a matching target fingerprint, boolean inside, canonical exact clocks. */
function fnpNormalizeState(x: unknown, fingerprint: string): FrozenNodePriorState | null {
  const s = fnpRecord(x);
  if (!s) return null;
  if (Object.keys(s).sort().join(",") !== "armingEpoch,inside,lastQuoteAt,lastQuoteBasis,targetFingerprint,withinPct") return null;
  if (s.targetFingerprint !== fingerprint) return null;
  if (typeof s.inside !== "boolean" || !isNum(s.withinPct) || s.withinPct < 0 || !fnpText(s.lastQuoteBasis)) return null;
  const epochMicros = fnpInstantMicros(s.armingEpoch);
  const lastQuoteAt = fnpInstantMicros(s.lastQuoteAt);
  if (epochMicros === null || lastQuoteAt === null) return null;
  return {
    targetFingerprint: fingerprint,
    armingEpoch: fnpFormatInstantUtc(epochMicros),
    lastQuoteAt: fnpFormatInstantUtc(lastQuoteAt),
    inside: s.inside,
    withinPct: s.withinPct,
    lastQuoteBasis: s.lastQuoteBasis as string,
  };
}

/**
 * The frozen-node sampled-proximity evaluator.
 *
 * Signature is the trusted-caller contract, not the browser payload contract: the server
 * envelope, the out-of-band admission reader result and the qualified current-session
 * quote all arrive as ARGUMENTS. Nothing is ever read out of `cond` except the target,
 * root and threshold — a planted admission/rights/allowed blob inside condition JSON is
 * inert, and so is the row's own `_fnp` (see `prevState`).
 *
 * `prevState` is the row's persisted `_fnp` — this evaluator's own persistence OUTPUT. It
 * never implies provenance and is never the state the machine runs on; the machine runs
 * on the READER-ATTESTED `admission.priorState` only. `prevState` is consulted solely for
 * the tamper cross-check below.
 */
export function evalFrozenNodeProximity(
  cond: FrozenNodeCond,
  envelope: FrozenNodeEnvelope | null | undefined,
  admission: FrozenNodeAdmissionContext | null | undefined,
  quote: FrozenNodeQuote | null | undefined,
  prevState?: Record<string, unknown> | null,
): EvalResult {
  const rowState = prevState ?? null;
  const fail = (note: string): EvalResult => ({
    fired: null,
    value: null,
    note,
    nextState: rowState ? { ...rowState } : {},
  });

  // ── trusted server envelope ────────────────────────────────────────────────
  const env = fnpRecord(envelope);
  const principal = env ? fnpText(env.principal) : null;
  const createdAt = env ? fnpInstantMicros(env.createdAt) : null;
  const evaluationAt = env ? fnpInstantMicros(env.evaluationAt) : null;
  if (!env || !principal || createdAt === null || evaluationAt === null) {
    return fail("frozen-node server envelope unavailable");
  }

  // ── condition: root identity, target, threshold ───────────────────────────
  if (!cond || cond.type !== "opt_frozen_node_proximity") {
    return fail("condition is not a frozen-node proximity condition");
  }
  const root = normalizeOptAlertRoot(cond.root);
  if (!root) return fail("identity unresolved — stored underlying is not a readable options root");
  const targetFingerprint = frozenNodeTargetFingerprint(cond.target);
  if (targetFingerprint === null) return fail("frozen-node target unavailable or malformed");
  if (cond.target?.root !== root) return fail("condition root does not match frozen-node target root");
  if (cond.within_pct !== undefined && (!isNum(cond.within_pct) || cond.within_pct < 0)) {
    return fail("frozen-node proximity threshold is not a usable percentage");
  }
  const within = isNum(cond.within_pct) ? cond.within_pct : FNP_DEFAULT_WITHIN_PCT;

  // ── admission context (out-of-band reader result; NEVER from condition JSON) ──
  const adm = fnpRecord(admission);
  if (!adm) return fail("frozen-node admission unavailable");
  if (adm.action !== FNP_ADMITTED_ACTION) return fail("frozen-node admission action is not recognized");
  if (fnpText(adm.principal) !== principal) {
    return fail("frozen-node admission principal does not match the server envelope");
  }
  const admCreatedAt = fnpInstantMicros(adm.createdAt);
  const admEvalAt = fnpInstantMicros(adm.evaluationAt);
  const armingEpoch = fnpInstantMicros(adm.armingEpoch);
  if (admCreatedAt === null || admEvalAt === null || armingEpoch === null) {
    return fail("frozen-node admission clocks are malformed");
  }
  if (admCreatedAt !== createdAt) {
    return fail("frozen-node admission does not attest the server creation instant");
  }
  if (admEvalAt !== evaluationAt) {
    return fail("frozen-node admission does not bind the current evaluation instant");
  }
  if (armingEpoch < admCreatedAt) {
    return fail("frozen-node arming epoch precedes the server creation instant");
  }
  // The returned target identity must equal the requested target identity exactly.
  const admittedFingerprint = frozenNodeTargetFingerprint(adm.target);
  if (admittedFingerprint === null || admittedFingerprint !== targetFingerprint) {
    return fail("frozen-node admission target identity does not match the requested target");
  }
  const admTarget = fnpRecord(adm.target) as Record<string, unknown>;
  const availableAt = fnpInstantMicros(admTarget.availableAt);
  if (availableAt === null || availableAt > armingEpoch) {
    return fail("frozen-node target source was not available at the arming epoch");
  }
  if (armingEpoch > evaluationAt) {
    return fail("frozen-node arming epoch is after the evaluation instant");
  }
  const sourceClocks = (admTarget.sourceBinding as FrozenNodeSourceBinding).clocks;
  if (Object.entries(sourceClocks).some(([key, value]) => fnpSourceClockAfter(key, value, evaluationAt))) {
    return fail("frozen-node source clock is later than evaluation");
  }

  const rights = fnpRecord(adm.rights);
  if (!rights) return fail("frozen-node admission rights unavailable");
  if (rights.allowed !== true) return fail("frozen-node admission rights do not allow this action");
  if (!fnpText(rights.policy_version)) return fail("frozen-node admission rights carry no policy version");
  const checkedAt = fnpInstantMicros(rights.checked_at);
  if (checkedAt === null || checkedAt !== evaluationAt) {
    return fail("frozen-node rights were not checked at the evaluation instant");
  }

  // ── reader-attested prior state (REQUIRED key; null = attested fresh arming) ──
  if (!("priorState" in adm)) {
    return fail("frozen-node admission does not attest prior-state provenance");
  }
  let prior: FrozenNodePriorState | null = null;
  let verifiedPrior: FrozenNodePriorState | null = null;
  if (adm.priorState !== null) {
    const normalized = fnpNormalizeState(adm.priorState, targetFingerprint);
    if (!normalized || normalized.armingEpoch !== fnpFormatInstantUtc(armingEpoch)) {
      return fail("attested prior state belongs to a different target or arming epoch");
    }
    const priorQuoteAt = fnpInstantMicros(normalized.lastQuoteAt) as bigint;
    if (priorQuoteAt <= armingEpoch) {
      return fail("attested prior state quotes from before the arming epoch");
    }
    if (priorQuoteAt > evaluationAt) return fail("attested prior quote is later than evaluation");
    // A changed threshold starts a new sampled-proximity predicate, never an entry event.
    verifiedPrior = normalized;
    prior = normalized.withinPct === within ? normalized : null;
  }

  // ── tamper cross-check on the row's own persistence output ────────────────
  // A row state describing the SAME (target, armingEpoch) binding must agree with the
  // attested prior state, or the row was hand-edited under a live attestation. A row
  // state describing a DIFFERENT binding is stale output from before a re-arm and is
  // ignored (never an error, never an input).
  if (rowState && prior) {
    if (rowState.targetFingerprint === targetFingerprint && rowState.armingEpoch === prior.armingEpoch && rowState.withinPct === prior.withinPct) {
      const rowNormalized = fnpNormalizeState(rowState, targetFingerprint);
      if (!rowNormalized || !fnpSameState(rowNormalized, prior)) {
        return fail("frozen-node row state conflicts with the attested prior state");
      }
    }
  }

  // ── qualified current-session quote (sampled-proximity evidence) ──────────
  const q = fnpRecord(quote);
  const spot = q ? q.spot : undefined;
  const quoteAt = q ? fnpInstantMicros(q.asof) : null;
  const basis = q ? fnpText(q.basis) : null;
  if (!q || !fnpPositiveNum(spot) || quoteAt === null || !basis) {
    return fail("no qualified current-session quote for the frozen node");
  }
  if (quoteAt <= armingEpoch) return fail("quote is not after the arming epoch");
  if (quoteAt > evaluationAt) return fail("quote is later than the evaluation instant");
  if (verifiedPrior && quoteAt <= (fnpInstantMicros(verifiedPrior.lastQuoteAt) as bigint)) {
    return { fired: false, value: spot, note: "", nextState: { ...verifiedPrior } };
  }


  // ── state machine ─────────────────────────────────────────────────────────
  const target = cond.target as FrozenNodeTarget;
  const price = target.price;
  const distPct = (Math.abs(spot - price) / price) * 100;
  const inside = distPct <= within;
  const nextState: FrozenNodePriorState = {
    targetFingerprint,
    armingEpoch: fnpFormatInstantUtc(armingEpoch),
    lastQuoteAt: fnpFormatInstantUtc(quoteAt),
    inside,
    withinPct: within,
    lastQuoteBasis: basis,
  };

  // First qualifying quote for this binding: ARM ONLY — even when already inside — so a
  // pre-enrollment touch can never fire and an alert created near the node stays quiet.
  if (!prior) return { fired: false, value: spot, note: "", nextState };

  // Duplicate or out-of-order quote: no transition, no state advance.
  if (quoteAt <= (fnpInstantMicros(prior.lastQuoteAt) as bigint)) {
    return { fired: false, value: spot, note: "", nextState: { ...prior } };
  }

  if (inside && prior.inside === false) {
    const hasC = target.members.some((m) => m.right === "C");
    const hasP = target.members.some((m) => m.right === "P");
    const side = hasC && hasP ? "call/put" : hasC ? "call" : "put";
    const expiries = [...new Set(target.members.map((m) => m.expiry))].sort().join("/");
    const basisLabel =
      basis.toUpperCase() === "DELAYED_15M"
        ? "15-minute-delayed quote"
        : basis.toUpperCase() === "LIVE" || basis.toUpperCase() === "REALTIME"
          ? "live quote"
          : "current quote";
    const note =
      `${root} is within ${within}% of its frozen ${side} options node at ${price} (expiry ${expiries}) — ` +
      `frozen level held at arming, not today's rebuilt wall · sampled proximity on a ${basisLabel} ` +
      `${asOf(q.asof as string)}, intraday`;
    return { fired: true, value: spot, note, nextState };
  }
  return { fired: false, value: spot, note: "", nextState };
}
