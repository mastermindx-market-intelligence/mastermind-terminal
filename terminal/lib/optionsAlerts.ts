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

const OPT_ALERT_ROOT_RE = /^[A-Z0-9]{1,10}(?:[.-][A-Z0-9]{1,4})?$/;

/** Normalize a root before it can become both the row identity and evaluator input. */
export function normalizeOptAlertRoot(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const root = value.trim().toUpperCase();
  // Flow._root (ingest/alerts_engine.py) is the law: strip+upper, total length ≤ 12, then the regex.
  return root.length <= 12 && OPT_ALERT_ROOT_RE.test(root) ? root : null;
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
