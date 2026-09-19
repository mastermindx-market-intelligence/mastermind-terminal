/**
 * marketStructure.ts — Market Structure Core, Wave 1 (R0).
 *
 * Pure arithmetic over the `options_hub.gex/v1` + `options_hub.moves/v1` payloads the
 * Exposure desk ALREADY fetches. No new f-param, no new builder, no network.
 *
 * Program of record: docs/MARKET_STRUCTURE_CORE_MASTERPLAN_2026-08-01.md
 * Quant reference:   docs/audits/2026-08-01-market-structure-core/dealer-positioning-math.md
 *
 * ─── UNITS (verified against macro engine/options_hub.py, origin/main) ────────────────
 * Every `by_strike` greek column is **$mn of dealer delta**, already dealer-signed:
 *   gamma_net = sign · Γ · OI · 100 · S² · 0.01 / 1e6   → $mn per **+1% spot move**
 *   vanna_net = sign · vanna · OI · 100 · S  · 0.01 / 1e6 → $mn per **+1 vol point**
 *   charm_net = sign · (charm/365) · OI · 100 · S   / 1e6 → $mn per **+1 calendar day**
 * The three share one unit ($mn of dealer delta), which is what makes the scenario
 * expansion in `scenarioGrid()` dimensionally legal.
 *
 * ─── HONESTY (masterplan §4.1 tiering) ───────────────────────────────────────────────
 * Tier A (deterministic, independent of who is long): `topology`, `expiryConcentration`,
 *   `emFrame` — these ride on |Γ|·OI and market-quoted prices only.
 * Tier B (signed estimate, convention-dependent): `signSensitivity`, `scenarioGrid` —
 *   these inherit the payload's dealer-sign assumption and must render its disclosure.
 * Nothing here emits a Tier C claim (support/resistance, pin odds); those need a live
 * grade and arrive in wave R2.4.
 *
 * ─── WINDOWING ───────────────────────────────────────────────────────────────────────
 * `by_strike` is published truncated (±20% of spot, 160-strike cap) with the uncut count
 * in `by_strike_full_n`. Every aggregate below is therefore a WINDOWED sum and says so via
 * `AggregateResult.windowed` — callers must surface it. Do NOT reconcile these sums against
 * the payload's headline `net_gex_bn` (a full-book figure): they legitimately differ.
 */

// ─── Input row shapes (structural subset of GexPayload) ──────────────────────────────

export interface MscStrikeRow {
  strike: number;
  gamma_net: number;
  gamma_call: number;
  gamma_put: number;
  delta_net?: number;
  vanna_net?: number;
  charm_net?: number;
}

export interface MscExpiryRow {
  exp: string;
  gamma_net: number;
  delta_net?: number;
  /** Additive owner-native fields from options_hub.gex/v1; absent on older archives. */
  vanna_net?: number;
  charm_net?: number;
}

/** Subset of `options_hub.moves/v1` this module reads. */
export interface MscMoves {
  spot_ref?: number | null;
  expected_move?: {
    band_mult?: number | null;
    horizon_days?: number | null;
    pct?: number | null;
    lo?: number | null;
    hi?: number | null;
  } | null;
  calibration?: {
    contained_rate?: number | null;
    n_sessions?: number | null;
    band_mult?: number | null;
    since?: string | null;
    through?: string | null;
    ci?: [number, number] | number[] | null;
  } | null;
}

// ─── Tunables (display conventions — documented, not laws of nature) ─────────────────

/**
 * |tilt| below this renders the long/short-gamma verdict as FRAGILE. Reading: the call
 * side of the book would have to be re-signed by less than ~12% of gross gamma to flip
 * the regime call, which is well inside the uncertainty of any public-OI convention.
 */
export const TILT_FRAGILE_ABS = 0.12;

/** Share of gross by-expiry gamma at the front expiration that counts as concentrated. */
export const EXPIRY_CONCENTRATION_PCT = 25;

/** A level further than this many expected moves away is decorative for the horizon. */
export const REACHABLE_EM = 1.5;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// ─── Aggregates ──────────────────────────────────────────────────────────────────────

export interface AggregateResult {
  /** Σ gamma_net — $mn dealer delta per +1% spot. */
  gammaMn: number;
  /** Σ vanna_net — $mn dealer delta per +1 vol point. `null` when the lens is absent. */
  vannaMn: number | null;
  /** Σ charm_net — $mn dealer delta per +1 calendar day. `null` when the lens is absent. */
  charmMn: number | null;
  /** Σ delta_net — $mn dealer delta (level, not a sensitivity). */
  deltaMn: number | null;
  /** Σ |gamma_call| — gross call-side gamma. */
  callAbsMn: number;
  /** Σ |gamma_put| — gross put-side gamma. */
  putAbsMn: number;
  /** Strikes actually summed. */
  nStrikes: number;
  /** Uncut strike count when the payload discloses it. */
  nStrikesFull: number | null;
  /** True when the ladder is a window over a larger book. */
  windowed: boolean;
}

export function aggregate(
  rows: readonly MscStrikeRow[] | null | undefined,
  fullN?: number | null,
): AggregateResult {
  let gammaMn = 0;
  let callAbsMn = 0;
  let putAbsMn = 0;
  let vSum = 0;
  let cSum = 0;
  let dSum = 0;
  let vSeen = false;
  let cSeen = false;
  let dSeen = false;
  let n = 0;

  for (const r of rows ?? []) {
    if (!r) continue;
    if (isNum(r.gamma_net)) gammaMn += r.gamma_net;
    if (isNum(r.gamma_call)) callAbsMn += Math.abs(r.gamma_call);
    if (isNum(r.gamma_put)) putAbsMn += Math.abs(r.gamma_put);
    if (isNum(r.vanna_net)) { vSum += r.vanna_net; vSeen = true; }
    if (isNum(r.charm_net)) { cSum += r.charm_net; cSeen = true; }
    if (isNum(r.delta_net)) { dSum += r.delta_net; dSeen = true; }
    n += 1;
  }

  const nStrikesFull = isNum(fullN) && fullN > 0 ? fullN : null;
  return {
    gammaMn,
    vannaMn: vSeen ? vSum : null,
    charmMn: cSeen ? cSum : null,
    deltaMn: dSeen ? dSum : null,
    callAbsMn,
    putAbsMn,
    nStrikes: n,
    nStrikesFull,
    windowed: nStrikesFull != null && nStrikesFull > n,
  };
}

// ─── R0.1 — sign sensitivity (Tier B; the differentiator) ────────────────────────────

export type SignVerdict = "robust" | "fragile" | "unknown";

export interface SignSensitivity {
  callAbsMn: number;
  putAbsMn: number;
  /**
   * Normalised gamma tilt (callAbs − putAbs) / (callAbs + putAbs) ∈ [−1, +1].
   * The margin by which the long/short-gamma verdict survives a change of convention.
   */
  tilt: number | null;
  /**
   * Critical call-side weight w* = putAbs / callAbs — the weight at which net gamma is
   * exactly zero. Our published convention is w = +1 (dealers long calls, short puts).
   * w* > 1 ⇒ no weight in the plausible range makes the book long gamma.
   */
  criticalWeight: number | null;
  /** net(w) = w·callAbs − putAbs, sampled across the plausible convention range. */
  curve: { w: number; netMn: number }[];
  /** net at our published convention (w = +1). Equals Σ gamma_net. */
  naiveNetMn: number;
  /** |tilt|, i.e. how far the verdict sits from the knife edge. */
  confidence: number | null;
  verdict: SignVerdict;
}

const WEIGHT_GRID = [-1, -0.5, 0, 0.5, 1];

/**
 * How much does the long-gamma / short-gamma verdict depend on the dealer-sign assumption?
 *
 * `gamma_call` and `gamma_put` are published separately (and separately signed), so the net
 * can be recomputed for any call-side weight w: `net(w) = w·Σ|gamma_call| − Σ|gamma_put|`.
 * w = +1 is our published convention (dealers long calls); w = −1 is the "dealers short
 * both sides" convention some vendors apply to single names; w = 0 leaves the call side
 * unsigned. No competitor in this category publishes this.
 */
export function signSensitivity(agg: AggregateResult): SignSensitivity {
  const { callAbsMn, putAbsMn } = agg;
  const gross = callAbsMn + putAbsMn;
  const tilt = gross > 0 ? (callAbsMn - putAbsMn) / gross : null;
  const criticalWeight = callAbsMn > 0 ? putAbsMn / callAbsMn : null;
  const curve = WEIGHT_GRID.map((w) => ({ w, netMn: w * callAbsMn - putAbsMn }));
  const confidence = tilt == null ? null : Math.abs(tilt);

  let verdict: SignVerdict = "unknown";
  if (confidence != null) verdict = confidence < TILT_FRAGILE_ABS ? "fragile" : "robust";

  return {
    callAbsMn,
    putAbsMn,
    tilt,
    criticalWeight,
    curve,
    naiveNetMn: callAbsMn - putAbsMn,
    confidence,
    verdict,
  };
}

// ─── R0.2 — hedge-flow scenario grid (Tier B) ────────────────────────────────────────

export interface ScenarioGrid {
  /** Spot-move axis, in percent. */
  dsPct: number[];
  /** IV-shock axis, in vol points. */
  dVolPts: number[];
  /** Time axis used for the charm column, in calendar days. */
  dtDays: number;
  /**
   * cells[volIdx][spotIdx] = estimated dealer hedge flow in $mn.
   * POSITIVE = dealers must BUY the underlying; negative = must SELL.
   */
  cells: number[][];
  /** Hedge flow from one calendar day of decay alone, $mn. `null` without a charm lens. */
  charmPerDayMn: number | null;
  /** Largest |cell| — the colour-scale anchor. */
  maxAbs: number;
  hasVanna: boolean;
  hasCharm: boolean;
}

export interface ScenarioOpts {
  dsPct?: number[];
  dVolPts?: number[];
  dtDays?: number;
}

const DEFAULT_DS = [-3, -2, -1, 0, 1, 2, 3];
const DEFAULT_DVOL = [5, 2, 0, -2, -5];

/**
 * Projected dealer re-hedging demand across a (spot, IV, time) scenario grid.
 *
 * A hedged dealer's position delta moves by `Γ·ΔS + Vanna·Δσ + Charm·Δt`; to stay hedged
 * they must trade the negative of that in the underlying. This is VolSignals' "Delta
 * Change" idea (delta you must trade to get from here to a future time and price)
 * generalised from their 2-D (time × price) field to a full (ΔS, Δσ, Δt) surface.
 *
 * ⚠️ LOCAL ESTIMATE. This is a first-order expansion around the published snapshot: the
 * greeks are evaluated at the current spot and are themselves functions of spot, so the
 * approximation degrades as |ΔS| grows. It is bounded to ±3% / ±5 vol points for that
 * reason, and is superseded by full book re-pricing on the spot grid in wave R1.3.
 * The caller MUST render that disclosure (see `mscStrings.scenarioDisclose`).
 */
export function scenarioGrid(agg: AggregateResult, opts: ScenarioOpts = {}): ScenarioGrid {
  const dsPct = opts.dsPct ?? DEFAULT_DS;
  const dVolPts = opts.dVolPts ?? DEFAULT_DVOL;
  const dtDays = opts.dtDays ?? 0;

  const g = agg.gammaMn;
  const v = agg.vannaMn ?? 0;
  const c = agg.charmMn ?? 0;

  let maxAbs = 0;
  const cells = dVolPts.map((dv) =>
    dsPct.map((ds) => {
      // Dealer position-delta change, then the hedge is its negative. Negating a zero
      // yields -0, which formats as "-0.0" — normalise it so the flat cell reads flat.
      const dDealerDelta = g * ds + v * dv + c * dtDays;
      const flow = dDealerDelta === 0 ? 0 : -dDealerDelta;
      const a = Math.abs(flow);
      if (a > maxAbs) maxAbs = a;
      return flow;
    }),
  );

  return {
    dsPct,
    dVolPts,
    dtDays,
    cells,
    charmPerDayMn: agg.charmMn == null ? null : agg.charmMn === 0 ? 0 : -agg.charmMn,
    maxAbs,
    hasVanna: agg.vannaMn != null,
    hasCharm: agg.charmMn != null,
  };
}

// ─── R5 Stage 0 — scenario-conditioned alignment by absolute DTE ────────────────────

export type R5DteBucket =
  | "0DTE"
  | "1-2DTE"
  | "3-7DTE"
  | "8-30DTE"
  | "31-90DTE"
  | "91D+";

const R5_DTE_BUCKETS: readonly R5DteBucket[] = [
  "0DTE", "1-2DTE", "3-7DTE", "8-30DTE", "31-90DTE", "91D+",
];

export type R5AlignmentState =
  | "aligned_positive"
  | "aligned_negative"
  | "opposed"
  | "one_factor_dominant"
  | "immaterial"
  | "unavailable";

export interface R5ScenarioSpec {
  /** Explicit spot shock in percent. Must stay inside scenarioGrid's documented ±3% envelope. */
  spotPct: number;
  /** Explicit ATM-IV shock in vol points. Must stay inside scenarioGrid's documented ±5pt envelope. */
  volPts: number;
  /** Calendar-day time step for charm. */
  dtDays: number;
  /** Absolute $mn hedge-flow floor below which a gamma/vanna leg is non-material. */
  materialityMn: number;
  /** Upstream position/sign convention label. R5 never averages tiers. */
  positionTier: string;
}

export interface R5AlignmentRow {
  bucket: R5DteBucket | "ALL";
  present: boolean;
  expirations: number;
  gammaMn: number | null;
  vannaMn: number | null;
  charmMn: number | null;
  gammaFlowMn: number | null;
  vannaFlowMn: number | null;
  charmFlowMn: number | null;
  totalFlowMn: number | null;
  alignment: R5AlignmentState;
  /** Signed descriptive agreement in [-1,+1]; null without both nonzero flow legs. */
  alignmentStrength: number | null;
}

export interface R5Stage0Alignment {
  researchAuthority: "research_only";
  outcomeLabelsOpened: false;
  population: "full_book_by_expiry";
  asof: string;
  scenario: R5ScenarioSpec;
  wholeBook: R5AlignmentRow;
  buckets: R5AlignmentRow[];
  coverage: {
    inputRows: number;
    qualifiedRows: number;
    invalidOrExpiredRows: number;
    vannaRows: number;
    charmRows: number;
    bucketsPresent: number;
  };
}

export function r5DteBucket(dte: number): R5DteBucket | null {
  if (!Number.isFinite(dte) || dte < 0) return null;
  if (dte === 0) return "0DTE";
  if (dte <= 2) return "1-2DTE";
  if (dte <= 7) return "3-7DTE";
  if (dte <= 30) return "8-30DTE";
  if (dte <= 90) return "31-90DTE";
  return "91D+";
}

function r5ExpiryAggregate(rows: readonly MscExpiryRow[]): AggregateResult {
  let gammaMn = 0;
  let vannaMn = 0;
  let charmMn = 0;
  let deltaMn = 0;
  let vCount = 0;
  let cCount = 0;
  let dCount = 0;

  for (const row of rows) {
    if (isNum(row.gamma_net)) gammaMn += row.gamma_net;
    if (isNum(row.vanna_net)) { vannaMn += row.vanna_net; vCount += 1; }
    if (isNum(row.charm_net)) { charmMn += row.charm_net; cCount += 1; }
    if (isNum(row.delta_net)) { deltaMn += row.delta_net; dCount += 1; }
  }

  // Research aggregation is stricter than the display consumer: a missing expiry
  // cannot silently become a zero contribution inside a tenor. Either every row in
  // the population carries the lens or that aggregate is unavailable.
  return {
    gammaMn,
    vannaMn: vCount === rows.length ? vannaMn : null,
    charmMn: cCount === rows.length ? charmMn : null,
    deltaMn: dCount === rows.length ? deltaMn : null,
    // by-expiry is Net-only. R5 does not manufacture call/put decomposition.
    callAbsMn: 0,
    putAbsMn: 0,
    nStrikes: rows.length,
    nStrikesFull: null,
    windowed: false,
  };
}

function r5OneCell(agg: AggregateResult, spotPct: number, volPts: number, dtDays: number): number {
  return scenarioGrid(agg, { dsPct: [spotPct], dVolPts: [volPts], dtDays }).cells[0][0];
}

function r5Alignment(
  gammaFlowMn: number | null,
  vannaFlowMn: number | null,
  materialityMn: number,
): { state: R5AlignmentState; strength: number | null } {
  if (gammaFlowMn == null || vannaFlowMn == null) {
    return { state: "unavailable", strength: null };
  }
  // Contract says "below" the frozen threshold is non-material. Equality is
  // therefore material, but exact zero must never become material when the
  // declared threshold is zero.
  const gAbs = Math.abs(gammaFlowMn);
  const vAbs = Math.abs(vannaFlowMn);
  const gMaterial = gAbs > 0 && gAbs >= materialityMn;
  const vMaterial = vAbs > 0 && vAbs >= materialityMn;
  if (!gMaterial && !vMaterial) return { state: "immaterial", strength: null };
  if (gMaterial !== vMaterial) return { state: "one_factor_dominant", strength: null };

  const product = gammaFlowMn * vannaFlowMn;
  const denom = Math.abs(gammaFlowMn) * Math.abs(vannaFlowMn);
  const strength = denom > 0 ? product / (denom + 1e-12) : null;
  if (product > 0) {
    return {
      state: gammaFlowMn > 0 ? "aligned_positive" : "aligned_negative",
      strength,
    };
  }
  if (product < 0) return { state: "opposed", strength };
  return { state: "one_factor_dominant", strength: null };
}

function r5AlignmentRow(
  bucket: R5DteBucket | "ALL",
  rows: readonly MscExpiryRow[],
  scenario: R5ScenarioSpec,
): R5AlignmentRow {
  if (rows.length === 0) {
    return {
      bucket,
      present: false,
      expirations: 0,
      gammaMn: null,
      vannaMn: null,
      charmMn: null,
      gammaFlowMn: null,
      vannaFlowMn: null,
      charmFlowMn: null,
      totalFlowMn: null,
      alignment: "unavailable",
      alignmentStrength: null,
    };
  }

  const agg = r5ExpiryAggregate(rows);
  const gammaFlowMn = r5OneCell(
    { ...agg, vannaMn: null, charmMn: null },
    scenario.spotPct, 0, 0,
  );
  const vannaFlowMn = agg.vannaMn == null
    ? null
    : r5OneCell({ ...agg, gammaMn: 0, charmMn: null }, 0, scenario.volPts, 0);
  const charmFlowMn = agg.charmMn == null
    ? null
    : r5OneCell({ ...agg, gammaMn: 0, vannaMn: null }, 0, 0, scenario.dtDays);
  // scenarioGrid intentionally treats a missing lens as zero for its generic UI
  // surface and exposes hasVanna/hasCharm separately. R5 cannot collapse that
  // uncertainty: when a non-zero requested shock needs a missing lens, the combined
  // flow is unknown. A missing lens is irrelevant only when its requested shock is 0.
  const totalKnown =
    (scenario.volPts === 0 || vannaFlowMn != null) &&
    (scenario.dtDays === 0 || charmFlowMn != null);
  const totalFlowMn = totalKnown
    ? r5OneCell(agg, scenario.spotPct, scenario.volPts, scenario.dtDays)
    : null;
  const alignment = r5Alignment(gammaFlowMn, vannaFlowMn, scenario.materialityMn);

  return {
    bucket,
    present: true,
    expirations: rows.length,
    gammaMn: agg.gammaMn,
    vannaMn: agg.vannaMn,
    charmMn: agg.charmMn,
    gammaFlowMn,
    vannaFlowMn,
    charmFlowMn,
    totalFlowMn,
    alignment: alignment.state,
    alignmentStrength: alignment.strength,
  };
}

/**
 * R5's construction-only object. It never reads future returns/prices and it never
 * rebuilds the scenario engine: every component flow is evaluated through scenarioGrid().
 *
 * Absolute DTE buckets are deliberately separate from tenorBand(), which describes the
 * GAP between consecutive expirations for UI sampling density.
 */
export function r5Stage0Alignment(
  rows: readonly MscExpiryRow[] | null | undefined,
  asof: string,
  scenario: R5ScenarioSpec,
): R5Stage0Alignment {
  if (!isNum(scenario.spotPct) || Math.abs(scenario.spotPct) > 3) {
    throw new RangeError("R5 spotPct must be finite and within scenarioGrid's ±3% envelope");
  }
  if (!isNum(scenario.volPts) || Math.abs(scenario.volPts) > 5) {
    throw new RangeError("R5 volPts must be finite and within scenarioGrid's ±5pt envelope");
  }
  if (!isNum(scenario.dtDays) || scenario.dtDays < 0) {
    throw new RangeError("R5 dtDays must be finite and non-negative");
  }
  if (!isNum(scenario.materialityMn) || scenario.materialityMn < 0) {
    throw new RangeError("R5 materialityMn must be finite and non-negative");
  }
  if (!scenario.positionTier?.trim()) {
    throw new RangeError("R5 positionTier must be declared");
  }

  const asofDay = asof.slice(0, 10);
  const base = Date.parse(`${asofDay}T00:00:00Z`);
  if (!Number.isFinite(base)) throw new RangeError("R5 asof must contain a valid YYYY-MM-DD date");

  const grouped = new Map<R5DteBucket, MscExpiryRow[]>();
  for (const bucket of R5_DTE_BUCKETS) grouped.set(bucket, []);

  const expiryKeys = (rows ?? [])
    .map((row) => typeof row?.exp === "string" ? row.exp.slice(0, 10) : "")
    .filter(Boolean);
  if (new Set(expiryKeys).size !== expiryKeys.length) {
    throw new RangeError("R5 by-expiry input must contain unique expiration rows");
  }

  const qualified: MscExpiryRow[] = [];
  let invalidOrExpiredRows = 0;
  let vannaRows = 0;
  let charmRows = 0;
  for (const row of rows ?? []) {
    const expiry = typeof row?.exp === "string" ? Date.parse(`${row.exp.slice(0, 10)}T00:00:00Z`) : NaN;
    if (!Number.isFinite(expiry) || !isNum(row?.gamma_net)) {
      invalidOrExpiredRows += 1;
      continue;
    }
    const dte = Math.round((expiry - base) / 86_400_000);
    const bucket = r5DteBucket(dte);
    if (bucket == null) {
      invalidOrExpiredRows += 1;
      continue;
    }
    qualified.push(row);
    grouped.get(bucket)!.push(row);
    if (isNum(row.vanna_net)) vannaRows += 1;
    if (isNum(row.charm_net)) charmRows += 1;
  }

  const buckets = R5_DTE_BUCKETS.map((bucket) =>
    r5AlignmentRow(bucket, grouped.get(bucket)!, scenario)
  );

  return {
    researchAuthority: "research_only",
    outcomeLabelsOpened: false,
    population: "full_book_by_expiry",
    asof: asofDay,
    scenario: { ...scenario, positionTier: scenario.positionTier.trim() },
    wholeBook: r5AlignmentRow("ALL", qualified, scenario),
    buckets,
    coverage: {
      inputRows: (rows ?? []).length,
      qualifiedRows: qualified.length,
      invalidOrExpiredRows,
      vannaRows,
      charmRows,
      bucketsPresent: buckets.filter((row) => row.present).length,
    },
  };
}

// ─── R0.3 — levels in expected-move units (Tier A) ───────────────────────────────────

export interface EmLevel {
  key: string;
  price: number;
  /** Distance from spot in 1σ expected moves. */
  distEm: number | null;
  /** Signed distance in percent (positive = above spot). */
  distPct: number | null;
  side: "above" | "below" | "at";
  reachable: boolean | null;
}

export interface EmFrame {
  /** 1σ expected move as a percent of spot (the payload's band divided by its multiplier). */
  emPct1sig: number | null;
  /** 1σ expected move in price units. */
  emAbs1sig: number | null;
  bandMult: number | null;
  horizonDays: number | null;
  containedRate: number | null;
  nSessions: number | null;
  ci: [number, number] | null;
  levels: EmLevel[];
}

/**
 * Express structural levels as distances in expected moves rather than in price.
 *
 * A wall three expected moves away is decoration; a wall 0.3 EM away is the session's
 * structure. Every product in this category quotes levels in price only — this reframing
 * is the cheapest genuine upgrade available to us.
 *
 * The moves payload publishes `expected_move.pct` at `band_mult` sigmas (default 1.96), so
 * the 1σ move is `pct / band_mult`. The calibration block travels with it: it is a
 * measurement about the past (how often a same-multiplier band contained the next
 * session's range), never a forecast.
 */
export function emFrame(
  spot: number | null | undefined,
  levels: readonly { key: string; price: number | null | undefined }[],
  moves: MscMoves | null | undefined,
): EmFrame {
  const em = moves?.expected_move ?? null;
  const bandMult = isNum(em?.band_mult) && em!.band_mult! > 0 ? em!.band_mult! : null;
  const bandPct = isNum(em?.pct) ? em!.pct! : null;
  const emPct1sig = bandPct != null && bandMult != null ? bandPct / bandMult : null;
  const emAbs1sig =
    emPct1sig != null && isNum(spot) && spot > 0 ? (spot * emPct1sig) / 100 : null;

  const cal = moves?.calibration ?? null;
  const rawCi = cal?.ci;
  const ci =
    Array.isArray(rawCi) && rawCi.length >= 2 && isNum(rawCi[0]) && isNum(rawCi[1])
      ? ([rawCi[0], rawCi[1]] as [number, number])
      : null;

  const out: EmLevel[] = [];
  for (const l of levels) {
    if (!isNum(l.price)) continue;
    const price = l.price;
    let distPct: number | null = null;
    let distEm: number | null = null;
    let side: EmLevel["side"] = "at";
    if (isNum(spot) && spot > 0) {
      distPct = ((price - spot) / spot) * 100;
      side = price > spot ? "above" : price < spot ? "below" : "at";
      if (emAbs1sig != null && emAbs1sig > 0) distEm = Math.abs(price - spot) / emAbs1sig;
    }
    out.push({
      key: l.key,
      price,
      distEm,
      distPct,
      side,
      reachable: distEm == null ? null : distEm <= REACHABLE_EM,
    });
  }
  // Nearest-first: the level you can actually reach today leads.
  out.sort((a, b) => {
    const av = a.distEm ?? Number.POSITIVE_INFINITY;
    const bv = b.distEm ?? Number.POSITIVE_INFINITY;
    return av - bv;
  });

  return {
    emPct1sig,
    emAbs1sig,
    bandMult,
    horizonDays: isNum(em?.horizon_days) ? em!.horizon_days! : null,
    containedRate: isNum(cal?.contained_rate) ? cal!.contained_rate! : null,
    nSessions: isNum(cal?.n_sessions) ? cal!.n_sessions! : null,
    ci,
    levels: out,
  };
}

// ─── R0.4 — gamma topology (Tier A) ──────────────────────────────────────────────────

export interface TopologyResult {
  /** argmax over strikes of |gamma_call| + |gamma_put| — the stickiest magnet candidate. */
  absGammaStrike: number | null;
  absGammaMn: number | null;
  /** That strike's share of total absolute gamma, 0..1. */
  concentrationShare: number | null;
  /** Ranked absolute-gamma strikes (largest first). */
  topStrikes: { strike: number; absMn: number; share: number }[];
  totalAbsMn: number;
}

/**
 * Absolute gamma topology — magnitude only, so it does not inherit the dealer-sign
 * assumption at all (Tier A). SpotGamma publishes this concept for indices only; it is
 * computable for every root whose ladder we publish.
 */
export function topology(
  rows: readonly MscStrikeRow[] | null | undefined,
  topN = 5,
): TopologyResult {
  const items: { strike: number; absMn: number }[] = [];
  let total = 0;
  for (const r of rows ?? []) {
    if (!r || !isNum(r.strike)) continue;
    const a =
      (isNum(r.gamma_call) ? Math.abs(r.gamma_call) : 0) +
      (isNum(r.gamma_put) ? Math.abs(r.gamma_put) : 0);
    if (a <= 0) continue;
    items.push({ strike: r.strike, absMn: a });
    total += a;
  }
  items.sort((a, b) => b.absMn - a.absMn);
  const top = items.slice(0, topN).map((it) => ({
    ...it,
    share: total > 0 ? it.absMn / total : 0,
  }));
  return {
    absGammaStrike: items.length ? items[0].strike : null,
    absGammaMn: items.length ? items[0].absMn : null,
    concentrationShare: items.length && total > 0 ? items[0].absMn / total : null,
    topStrikes: top,
    totalAbsMn: total,
  };
}

// ─── R0.5 — expiry concentration & post-OPEX preview (Tier A) ────────────────────────

export interface ExpiryConcentrationResult {
  nextExp: string | null;
  /** |front-expiry gamma| as a percent of gross by-expiry gamma. */
  gammaSharePct: number | null;
  deltaSharePct: number | null;
  /** True when the front expiration carries an outsized share of the book. */
  concentrated: boolean;
  /** Σ gamma_net across ALL published expirations, $mn. */
  currentNetMn: number | null;
  /** Σ gamma_net EXCLUDING the front expiration — the book the next session inherits. */
  postExpiryNetMn: number | null;
  /** True when removing the front expiration flips the sign of net gamma. */
  signFlipsOnExpiry: boolean;
  nExp: number;
}

/**
 * What does the book look like once the front expiration rolls off?
 *
 * This is SpotGamma's "gamma/delta in next expiration %" plus a post-expiry preview. It
 * matters most into monthly OPEX, when a large expiring tranche can invert the regime at
 * 09:30 on expiration Friday — the sign flip is flagged explicitly.
 *
 * Expirations are sorted by date string (ISO `YYYY-MM-DD` sorts lexicographically) rather
 * than trusting the payload's order.
 */
export function expiryConcentration(
  rows: readonly MscExpiryRow[] | null | undefined,
): ExpiryConcentrationResult {
  const list = (rows ?? []).filter((r) => r && typeof r.exp === "string");
  if (!list.length) {
    return {
      nextExp: null,
      gammaSharePct: null,
      deltaSharePct: null,
      concentrated: false,
      currentNetMn: null,
      postExpiryNetMn: null,
      signFlipsOnExpiry: false,
      nExp: 0,
    };
  }
  const sorted = [...list].sort((a, b) => (a.exp < b.exp ? -1 : a.exp > b.exp ? 1 : 0));
  const front = sorted[0];

  let grossGamma = 0;
  let grossDelta = 0;
  let netAll = 0;
  let netRest = 0;
  let deltaSeen = false;

  sorted.forEach((r, i) => {
    if (isNum(r.gamma_net)) {
      grossGamma += Math.abs(r.gamma_net);
      netAll += r.gamma_net;
      if (i > 0) netRest += r.gamma_net;
    }
    if (isNum(r.delta_net)) {
      grossDelta += Math.abs(r.delta_net);
      deltaSeen = true;
    }
  });

  const gammaSharePct =
    grossGamma > 0 && isNum(front.gamma_net)
      ? (Math.abs(front.gamma_net) / grossGamma) * 100
      : null;
  const deltaSharePct =
    deltaSeen && grossDelta > 0 && isNum(front.delta_net)
      ? (Math.abs(front.delta_net) / grossDelta) * 100
      : null;

  const currentNetMn = grossGamma > 0 || netAll !== 0 ? netAll : null;
  const postExpiryNetMn = sorted.length > 1 ? netRest : null;
  const signFlipsOnExpiry =
    currentNetMn != null &&
    postExpiryNetMn != null &&
    currentNetMn !== 0 &&
    postExpiryNetMn !== 0 &&
    Math.sign(currentNetMn) !== Math.sign(postExpiryNetMn);

  return {
    nextExp: front.exp,
    gammaSharePct,
    deltaSharePct,
    concentrated: gammaSharePct != null && gammaSharePct > EXPIRY_CONCENTRATION_PCT,
    currentNetMn,
    postExpiryNetMn,
    signFlipsOnExpiry,
    nExp: sorted.length,
  };
}

// ─── Convenience roll-up ─────────────────────────────────────────────────────────────

export interface MarketStructure {
  agg: AggregateResult;
  sign: SignSensitivity;
  scenario: ScenarioGrid;
  topology: TopologyResult;
  expiry: ExpiryConcentrationResult;
  em: EmFrame;
}

export interface BuildInput {
  byStrike: readonly MscStrikeRow[] | null | undefined;
  byExpiry: readonly MscExpiryRow[] | null | undefined;
  byStrikeFullN?: number | null;
  spot: number | null | undefined;
  levels: readonly { key: string; price: number | null | undefined }[];
  moves: MscMoves | null | undefined;
  scenario?: ScenarioOpts;
}

export function buildMarketStructure(input: BuildInput): MarketStructure {
  const agg = aggregate(input.byStrike, input.byStrikeFullN);
  return {
    agg,
    sign: signSensitivity(agg),
    scenario: scenarioGrid(agg, input.scenario),
    topology: topology(input.byStrike),
    expiry: expiryConcentration(input.byExpiry),
    em: emFrame(input.spot, input.levels, input.moves),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// Volland-parity wave 1 — hedging-requirement framing (docs/VOLLAND_PARITY_PLAN_2026-08-01.md)
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * THE REFRAMING. Volland renders every greek on one axis: the dollar amount of underlying a
 * continuously-hedged dealer must TRANSACT. Gamma, vanna, charm and delta all collapse to
 * "$ to buy or sell". We already publish the inputs — we were showing the greek and asking
 * the reader to translate.
 *
 * Sign convention, stated once and used everywhere below:
 *   our `*_net` columns are the change in DEALER position delta for a +1 unit move.
 *   A hedged dealer must trade the NEGATIVE of that to stay flat.
 *   ⇒ hedging requirement = −(position-delta change).  POSITIVE = dealers BUY.
 *
 * This deliberately inverts the sign of the familiar GEX ladder, which plots dealer
 * position rather than dealer action. Both are correct; they answer different questions.
 * Anything rendering these values must say "dealers buy / dealers sell" rather than
 * relying on a colour the reader has to decode.
 */

/** Which greek lens a hedging series was built from. */
export type HedgeGreek = "gamma" | "delta" | "vanna" | "charm";

/**
 * Second-order greeks measure a RATE (how the hedge changes as something moves), so their
 * cumulative curve is anchored at spot and accumulates outward — "what must dealers trade
 * to get from here to there". First-order greeks are a LEVEL (the position itself), so
 * their cumulative curve is a plain running total across the ladder.
 *
 * Volland's user guide documents exactly this split, and getting it wrong (cumsumming
 * everything identically from the low strike) produces a curve that looks plausible and
 * means nothing.
 */
export const SECOND_ORDER: ReadonlySet<HedgeGreek> = new Set<HedgeGreek>(["gamma", "vanna", "charm"]);

export interface HedgeRow {
  strike: number;
  /** $mn of underlying to transact per unit move. Positive = dealers buy. */
  hedgeMn: number;
}

export interface HedgeProfile {
  greek: HedgeGreek;
  /** Per-strike requirement — the histogram. */
  rows: HedgeRow[];
  /**
   * Cumulative requirement — the profile line. Anchored at spot for second-order greeks
   * (spot reads 0 and the curve accumulates away from it in both directions); a plain
   * running total for first-order greeks.
   */
  cumulative: { strike: number; cumMn: number }[];
  anchored: boolean;
  /** Largest |value| in each series, for scale captions. */
  maxAbsMn: number;
  maxAbsCumMn: number;
  /** The unit the per-unit move refers to, for the axis caption. */
  perUnit: "1% spot" | "1 vol point" | "1 day" | "position";
}

const PER_UNIT: Record<HedgeGreek, HedgeProfile["perUnit"]> = {
  gamma: "1% spot",
  vanna: "1 vol point",
  charm: "1 day",
  delta: "position",
};

function greekField(greek: HedgeGreek): keyof MscStrikeRow {
  return greek === "gamma" ? "gamma_net"
    : greek === "delta" ? "delta_net"
    : greek === "vanna" ? "vanna_net"
    : "charm_net";
}

/**
 * Build the hedging-requirement histogram + cumulative profile for one greek lens.
 *
 * The anchored branch is the interesting one. Rows are split at spot; going up, the running
 * total accumulates from spot outward; going down, likewise. Spot therefore sits at zero and
 * each point answers "if price travelled from here to this strike, how much would dealers
 * have had to transact along the way" — the one-dimensional form of the same question the
 * (ΔS, Δσ, Δt) scenario grid answers in three.
 */
export function hedgeProfile(
  rows: readonly MscStrikeRow[] | null | undefined,
  greek: HedgeGreek,
  spot: number | null | undefined,
): HedgeProfile {
  const field = greekField(greek);
  const out: HedgeRow[] = [];
  for (const r of rows ?? []) {
    if (!r || !isNum(r.strike)) continue;
    const v = r[field];
    if (!isNum(v)) continue;
    // negate: dealer ACTION is the mirror of the dealer POSITION change
    out.push({ strike: r.strike, hedgeMn: v === 0 ? 0 : -v });
  }
  out.sort((a, b) => a.strike - b.strike);

  const anchored = SECOND_ORDER.has(greek) && isNum(spot) && spot > 0;
  const cumulative: { strike: number; cumMn: number }[] = [];

  if (!anchored) {
    let acc = 0;
    for (const r of out) {
      acc += r.hedgeMn;
      cumulative.push({ strike: r.strike, cumMn: acc });
    }
  } else {
    const s = spot as number;
    const below = out.filter((r) => r.strike < s).sort((a, b) => b.strike - a.strike);
    const above = out.filter((r) => r.strike >= s);
    let accDown = 0;
    const down: { strike: number; cumMn: number }[] = [];
    for (const r of below) {
      accDown += r.hedgeMn;
      down.push({ strike: r.strike, cumMn: accDown });
    }
    down.reverse();
    let accUp = 0;
    const up: { strike: number; cumMn: number }[] = [];
    for (const r of above) {
      accUp += r.hedgeMn;
      up.push({ strike: r.strike, cumMn: accUp });
    }
    cumulative.push(...down, ...up);
  }

  let maxAbsMn = 0;
  for (const r of out) maxAbsMn = Math.max(maxAbsMn, Math.abs(r.hedgeMn));
  let maxAbsCumMn = 0;
  for (const c of cumulative) maxAbsCumMn = Math.max(maxAbsCumMn, Math.abs(c.cumMn));

  return { greek, rows: out, cumulative, anchored, maxAbsMn, maxAbsCumMn, perUnit: PER_UNIT[greek] };
}

// ─── Term structure with tenor banding ───────────────────────────────────────────────

export type TenorBand = "daily" | "weekly" | "monthly" | "quarterly" | "annual";

/**
 * Volland bands their term-structure charts by the GAP between consecutive expirations —
 * not by absolute DTE. That is the better choice: it shows how finely the term structure is
 * sampled at each point, so a dense 0DTE cluster and a lone LEAPS read differently at a
 * glance. Thresholds are theirs (documented in their user guide); the colours are ours.
 */
export function tenorBand(gapDays: number): TenorBand {
  if (gapDays <= 5) return "daily";
  if (gapDays <= 10) return "weekly";
  if (gapDays <= 35) return "monthly";
  if (gapDays <= 360) return "quarterly";
  return "annual";
}

export interface TermNode {
  exp: string;
  dte: number | null;
  /** $mn to transact at this expiration. Positive = dealers buy. */
  hedgeMn: number;
  /** Running total accumulating from the NEAREST expiration outward. */
  cumMn: number;
  /** Gap in days to the next expiration (null for the last). */
  gapDays: number | null;
  band: TenorBand | null;
}

export interface TermStructure {
  nodes: TermNode[];
  maxAbsMn: number;
  maxAbsCumMn: number;
  /** True when the payload only carries gamma+delta per expiration (our current contract). */
  limitedGreeks: boolean;
}

/**
 * Term structure of the hedging requirement — where in TIME the dealer risk sits.
 *
 * `asof` anchors DTE deterministically (never the wall clock, so an archived session reads
 * its own DTEs rather than today's).
 */
export function termStructure(
  rows: readonly MscExpiryRow[] | null | undefined,
  greek: "gamma" | "delta",
  asof: string | null | undefined,
): TermStructure {
  const list = (rows ?? []).filter((r) => r && typeof r.exp === "string");
  const sorted = [...list].sort((a, b) => (a.exp < b.exp ? -1 : a.exp > b.exp ? 1 : 0));
  const base = asof ? Date.parse(`${asof.slice(0, 10)}T00:00:00Z`) : NaN;

  const nodes: TermNode[] = [];
  let acc = 0;
  let maxAbsMn = 0;
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const raw = greek === "gamma" ? r.gamma_net : r.delta_net;
    if (!isNum(raw)) continue;
    const hedgeMn = raw === 0 ? 0 : -raw;
    acc += hedgeMn;
    const t = Date.parse(`${r.exp}T00:00:00Z`);
    const dte = Number.isFinite(base) && Number.isFinite(t)
      ? Math.round((t - base) / 86_400_000)
      : null;
    let gapDays: number | null = null;
    const next = sorted[i + 1];
    if (next) {
      const tn = Date.parse(`${next.exp}T00:00:00Z`);
      if (Number.isFinite(t) && Number.isFinite(tn)) gapDays = Math.round((tn - t) / 86_400_000);
    }
    maxAbsMn = Math.max(maxAbsMn, Math.abs(hedgeMn));
    nodes.push({
      exp: r.exp,
      dte,
      hedgeMn,
      cumMn: acc,
      gapDays,
      band: gapDays == null ? null : tenorBand(gapDays),
    });
  }
  let maxAbsCumMn = 0;
  for (const n of nodes) maxAbsCumMn = Math.max(maxAbsCumMn, Math.abs(n.cumMn));

  return {
    nodes,
    maxAbsMn,
    maxAbsCumMn,
    // by_expiry publishes gamma+delta only — vanna/charm are not available per expiration.
    limitedGreeks: true,
  };
}

// ─── Daily hedging summary ───────────────────────────────────────────────────────────

export interface DailyHedging {
  /** From charm: delta drift over one calendar day, spot and IV unchanged. */
  fromTimeMn: number | null;
  /** From gamma, scaled by a one-sigma expected move rather than an arbitrary 1%. */
  fromSpotMn: number | null;
  /** From vanna, scaled by the typical daily IV change when supplied. */
  fromVolMn: number | null;
  /** Sum of the components that exist. */
  totalMn: number | null;
  /** The move the spot component was scaled by, in percent. */
  emPct: number | null;
  /** The IV shock the vol component was scaled by, in vol points. */
  volPts: number | null;
}

/**
 * "How much must dealers transact today?" — the Greek Hedging card.
 *
 * Volland ships this as three scalars (delta / vega / theta hedging) plus a total, without a
 * published methodology. Rather than guess at theirs, this composes OUR published inputs at
 * a stated, honest scale: the gamma leg is scaled by the ticker's own one-sigma expected move
 * (not a nominal 1%), so the number answers "on a typical day" instead of "per arbitrary
 * unit". Every component states the shock it assumed, and any missing lens is null, never 0.
 */
export function dailyHedging(
  agg: AggregateResult,
  emPct1sig: number | null | undefined,
  volPts = 1,
): DailyHedging {
  const em = isNum(emPct1sig) && emPct1sig > 0 ? emPct1sig : null;
  const fromTimeMn = agg.charmMn == null ? null : (agg.charmMn === 0 ? 0 : -agg.charmMn);
  const fromSpotMn = em == null ? null : (agg.gammaMn === 0 ? 0 : -agg.gammaMn * em);
  const fromVolMn = agg.vannaMn == null ? null : (agg.vannaMn === 0 ? 0 : -agg.vannaMn * volPts);
  const parts = [fromTimeMn, fromSpotMn, fromVolMn].filter((v): v is number => v != null);
  return {
    fromTimeMn,
    fromSpotMn,
    fromVolMn,
    totalMn: parts.length ? parts.reduce((a, b) => a + b, 0) : null,
    emPct: em,
    volPts: agg.vannaMn == null ? null : volPts,
  };
}
