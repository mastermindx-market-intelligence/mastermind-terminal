/**
 * prophetBetaEvaluation.ts — closed decoder + display model for Macro's
 * `prophet.beta_evaluation/v1` strategy-evaluation artifact
 * (see `/home/ubuntu2/...` recon contract: ARTIFACT_CONTRACT_v1.md in the
 * publisher's fixture bundle; the wire contract is `prophet.beta_evaluation/v1`).
 *
 * LAWS THIS FILE ENFORCES
 *   - Closed contract: every field the UI renders is validated here; a body
 *     outside the contract returns null and is never half-rendered. Unknown
 *     OBJECT KEYS are tolerated (forward compatibility: "a future artifact
 *     with different numbers/levels renders without code change"); unknown
 *     VALUES for closed enums (schema, statuses, may_* flags, harness_dirty)
 *     are rejected.
 *   - Units: every return/difference on the wire is a FRACTION (0.01 = 1%).
 *     This file performs NO arithmetic on values beyond validation — the UI
 *     only formats (×100 for display). `null` means unavailable and is
 *     preserved as null, never coerced to 0.
 *   - Authority: all five `may_*` flags must be false; `code.harness_dirty`
 *     must be false. A body claiming action authority is not rehosted.
 *   - No interpretation lives here: claim statuses, levels and headline
 *     sentences pass through as the publisher's own words.
 */
export const PROPHET_BETA_EVALUATION_SCHEMA = "prophet.beta_evaluation/v1";
export const PROPHET_BETA_EVALUATION_VIEW = "STRATEGY_EVALUATION_VIEW";

/** Anchor rows the surface cannot render without (zero line + incumbent book). */
export const BENCHMARK_COMPARATOR_ID = "C1_passive_market";
export const INCUMBENT_COMPARATOR_ID = "C6_exact_incumbent_prophet";
/** Books the artifact publishes an attribution bridge for (rendered in the
 * "How attribution works" disclosure when present). */
export const ATTRIBUTION_BOOK_IDS = [
  INCUMBENT_COMPARATOR_ID,
  "C7_independent_emergence",
  "C6A_context_aligned_prophet",
] as const;
/** Known comparator ids (display order). Unknown future ids render generically. */
export const COMPARATOR_ORDER = [
  "C1_passive_market",
  "C2_simple_participation",
  "C3_sector_allocation_only",
  "C4_member_selection_only",
  "C5_joint_sector_and_name",
  INCUMBENT_COMPARATOR_ID,
  "C7_independent_emergence",
  "C6A_context_aligned_prophet",
  "X6_exposure_matched_reference",
] as const;

// ── Wire types (validated projection — the only shape the UI may render) ────

export type Ci95 = readonly [number, number];
export type ReleaseCriterion = { criterion: string; required: string; observed: number | string | boolean | null; met: boolean | null };
export type ComparatorRow = {
  id: string; label: string; definition: string | null;
  status: "evaluated" | "unavailable"; reason: string | null;
  totalNetReturn: number | null; annReturn: number | null;
  excessTotalVsSpy: number | null; annExcessVsSpy: number | null; annExcessOverCash: number | null;
  vsSpy: { totalDiff: number | null; totalDiffCi95: Ci95 | null; annDiff: number | null; annDiffCi95: Ci95 | null; pOneSided: number | null } | null;
  beta: number | null; betaCi95: Ci95 | null; interceptAnn: number | null;
  trackingError: number | null; maxDrawdown: number | null;
  upsideCapture: number | null; upsideCaptureCi95: Ci95 | null;
  downsideCapture: number | null; downsideCaptureCi95: Ci95 | null;
  meanInvested: number | null; timeInMarket: number | null; noEntryPeriods: number | null;
  annualTurnover: number | null; costsPaidTotal: number | null;
  noFillSignals: number | null; staleAssetDays: number | null;
  at2xCosts: { totalNetReturn: number | null; annExcessVsSpy: number | null } | null;
  window: { firstReturnClose: string; lastClose: string; dailyReturns: number } | null;
  sample: { positions: number; distinctAssets: number; censoredOpenAtWindowEnd: number; resolved: number } | null;
  hitRateVsSpy: { n: number; beatSpy: number; rate: number; ci95Wilson: Ci95 } | null;
  note: string | null;
};
export type ContrastRow = {
  id: string; a: string; b: string; headerDefinition: string;
  annDiff: number; annDiffCi95: Ci95; totalDiff: number; totalDiffCi95: Ci95;
  pRaw: number; pHolm: number; rejectH0: boolean;
  block21: { annDiffCi95: Ci95; pRaw: number; pHolm: number; rejectH0: boolean };
  at2xCosts: { annDiff: number; annDiffCi95: Ci95 };
};
export type AttributionBook = {
  method: string; linking: string; unit: string;
  legs: { marketParticipation: number; sectorAllocation: number; selectionWithinSector: number; cash: number; costs: number };
  bridge: { benchmark: number; uninvestedMarketShortfall: number; sectorAllocation: number; selectionWithinSector: number; cash: number; costs: number; strategy: number };
  sumOfDailyNetReturns: number; identityError: number;
  compoundedTotalNetReturn: number; compoundingResidual: number;
  benchmarkSumOfDailyReturns: number; unmappedSectorWeightDays: number;
};
export type EventStudyMetric = { mean: number; median: number; n: number; ci95DateCluster: Ci95 };
/**
 * A horizon whose cohort has not matured (D5: no live-published plan reaches H)
 * carries no metric fields — they decode as null and render as "not yet
 * matured", never as a zero or an empty cell that reads as a value.
 */
export type EventStudyHorizon = {
  horizon: string; n: number; nDates: number | null;
  status: "matured_subset" | "too_few_dates" | "unmatured";
  excessVsSpy: EventStudyMetric | null; sectorEtfMinusSpy: EventStudyMetric | null; stockMinusSectorEtf: EventStudyMetric | null;
  shareBeatingSpy: { k: number; n: number; rate: number; ci95WilsonNaive: Ci95 } | null;
};
export type PostHocBook = {
  concurrentPositions: { min: number; median: number; max: number; first5Sessions: number[] };
  topContributors: { asset: string; grossContribution: number }[];
  bottomContributors: { asset: string; grossContribution: number }[];
  top5ShareOfPositiveContribution: number;
  withoutTopContributor: {
    droppedAsset: string; totalNetReturn: number; excessTotalVsSpy: number; excessTotalCi95: Ci95;
    annExcessVsSpy: number; annExcessCi95: Ci95; betaVsMarket: number;
  };
};
/** D5 population block — names the corrected primary population and the
 * excluded outage-reconstructed cohort. Optional at decode: an artifact
 * without it (the pre-correction v1 shape) decodes with `population: null`
 * and the surface degrades to "not available", never to a zero. */
export type PopulationBlock = {
  primary: string;
  excludedCohort: {
    reason: string; detection: string;
    eraPlansExcluded: number;
    ofWhichReplayedReceiptedBake: number | null;
    ofWhichSyntheticBoardReconstructions: number | null;
    originationModeCounts: { mode: string; count: number }[];
    backfillExecutedAtByKind: { kind: string; stamps: string[] }[];
    planIds: string[];
    wouldHaveEnteredPositionsAsRun: number | null;
    wouldHaveEnteredIdsAsRun: string[] | null;
  } | null;
  mrna: {
    note: string; asRunEntry: string | null; inSensitivityA: boolean | null;
    sensitivityAEntry: string | null; priceAuthentication: string | null;
  } | null;
  review: { file: string; sha256: string } | null;
};

/** One book/variant row of a sensitivity block (subset of a comparator row —
 * the exact fields the engine republishes under `sensitivity`). */
export type SensitivityVariantRow = {
  positions: number | null;
  totalNetReturn: number | null;
  excessTotalVsSpy: number | null;
  excessTotalCi95: Ci95 | null;
  annExcessVsSpy: number | null;
  annExcessCi95: Ci95 | null;
  betaVsMarket: number | null;
  meanInvested: number | null;
  hitRateVsSpy: { n: number; beatSpy: number; rate: number; ci95Wilson: Ci95 } | null;
};

/** The retained-verbatim superseded contrast rows (K1/K2/K7 under the old
 * population). Render, if at all, only in a clearly superseded presentation. */
export type SupersededContrastRow = {
  id: string; annDiff: number | null; annDiffCi95: Ci95 | null;
  totalDiff: number | null; totalDiffCi95: Ci95 | null; pOneSided: number | null;
};

/** D5 sensitivity block — never the headline; the label says exactly that and
 * rides through verbatim. Optional at decode like `population`. */
export type SensitivityBlock = {
  label: string;
  backfillReplaysAdmittedAfterAvailability: ({
    definition: string;
    excludedFromThisVariant: { reason: string; count: number }[];
  } & SensitivityVariantRow) | null;
  supersededAsRun: {
    reason: string; sameEngineSeedPricesCosts: boolean;
    rows: { comparatorId: string; row: SensitivityVariantRow }[];
    contrasts: SupersededContrastRow[];
  } | null;
};

export type BetaEvaluation = {
  schema: typeof PROPHET_BETA_EVALUATION_SCHEMA;
  protocolRef: string;
  protocol: { id: string; headerSha256: string; headerCommit: string; frozenOn: string };
  code: { commit: string; harnessDirty: false; module: string; runner: string; bootstrap: { b: number; seed: number; meanBlock: number; sensitivityBlock: number } };
  dataClocks: {
    macroDataCommit: string;
    plansIndex: { path: string; sha256: string; asof: string; sourceAsof: string; computedAt: string };
    resolutionLog: { path: string; sha256: string; rows: number; malformedLinesSkipped: number; maxAsof: string; closeDateCorrectionsApplied: number; quarantinedIdsRemoved: number };
    pitMembership: { path: string; sha256: string; lastRecordedChange: string };
    prices: { source: string; tickersLoaded: number; digestSha256: string; missingFiles: number; lastCloseUsed: string };
  };
  basis: { market: string; benchmark: string; currency: string; returnBasis: string; cashInstrument: string; costsBpPerSide: { etf: number; stock: number } };
  window: { firstReturnClose: string; lastClose: string; sessions: number; dailyReturns: number; spyTotalReturn: number; spyMaxDrawdown: number };
  release: {
    levelsDefined: string[];
    overallLevel: string;
    l0SourceChecks: ReleaseCriterion[];
    l0Met: boolean;
    globalMinimumForL1: ReleaseCriterion[];
    globalMinimumMet: boolean;
    jobs: { key: string; level: string; criteria: ReleaseCriterion[] }[];
    capRule: string; l2L3Note: string;
  };
  headline: string[];
  limitations: string[];
  comparators: ComparatorRow[];
  contrasts: { family: string; rows: ContrastRow[] };
  eventStudy: { ruler: string; population: string; plans: number; horizons: EventStudyHorizon[]; excludedBackfilledPlans: number | null };
  attribution: { bookId: string; book: AttributionBook }[];
  postHocDiagnostics: { label: string; books: { bookId: string; book: PostHocBook }[] };
  /** D5 additions — optional at decode; null on the pre-correction artifact. */
  population: PopulationBlock | null;
  sensitivity: SensitivityBlock | null;
  coverage: {
    eraPlans: number; evaluatedPositions: number;
    excluded: { reason: string; count: number }[];
    entryShiftedToPublication: number;
    exitBasis: { recordedCloseDate: number; mechanicalPublishedLevels: number; censoredOpenAtWindowEnd: number };
    classifiedShare: number; pricedShare: number;
    sector: { unmappedPlans: number; labelSourceDisagreements: number; labelsBasis: string };
    c7C6aSplit: { outsideLeading: number; insideLeading: number; unmapped: number };
    memberUniverseByRebalance: { decision: string; execution: string; pitActive: number; noPriceFile: number; noSector: number; shortHistory: number; priceBelowMin: number; eligible: number; c4Names: number; c5Names: number; c5Sectors: string[] }[];
    memberUniverseMissingPriceFiles: string[];
    c4SectorWeights: { sector: string; weight: number }[];
    issuerExcludedPeers: { status: string; reason: string };
    dropCorrectedSensitivity: { positions: number; excluded: { reason: string; count: number }[] };
  };
  claims: { key: string; status: string; basis: string }[];
  deviations: { id: string; kind: string; when: string; what: string; why: string }[];
  mayRank: false; mayGate: false; maySize: false; mayTrade: false; mayEscalate: false;
};

// ── Validation helpers (house style: fail closed, bounded) ──────────────────

const obj = (x: unknown): Record<string, unknown> | null =>
  x !== null && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : null;
const str = (x: unknown, max = 256): string | null =>
  typeof x === "string" && x.length > 0 && x.length <= max ? x : null;
const int = (x: unknown, max = 1_000_000_000): number | null =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0 && x <= max ? x : null;
/** Fractional return/difference magnitude bound: |x| ≤ 20 (2000%) — anything
 * beyond is not a plausible evaluation number and fails closed. */
const frac = (x: unknown, bound = 20): number | null =>
  typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= bound ? x : null;
const ratio = (x: unknown, bound = 20): number | null => frac(x, bound);
const bool = (x: unknown): boolean | null => typeof x === "boolean" ? x : null;
const hex = (x: unknown, len: 40 | 64): string | null =>
  typeof x === "string" && new RegExp(`^[0-9a-f]{${len}}$`).test(x) ? x : null;
const isoDate = (x: unknown): string | null => {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return null;
  const ms = Date.parse(x + "T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === x ? x : null;
};
const ci = (x: unknown, bound = 20): Ci95 | null => {
  if (!Array.isArray(x) || x.length !== 2) return null;
  const lo = frac(x[0], bound), hi = frac(x[1], bound);
  return lo !== null && hi !== null && lo <= hi ? [lo, hi] : null;
};
const pValue = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1 ? x : null;

function criterion(x: unknown): ReleaseCriterion | null {
  const c = obj(x);
  if (!c) return null;
  const criterionId = str(c.criterion, 128), required = str(c.required, 64);
  if (!criterionId || !required) return null;
  const observedRaw = c.observed;
  let observed: ReleaseCriterion["observed"];
  if (observedRaw === null) observed = null;
  else if (typeof observedRaw === "boolean") observed = observedRaw;
  else if (typeof observedRaw === "string") { const s = str(observedRaw, 64); if (s === null) return null; observed = s; }
  // Criterion observed values are counts (e.g. resolved positions) or fractions
  // (e.g. shares) — finite and bounded, never a recomputed result.
  else { const n = frac(observedRaw, 10_000_000); if (n === null) return null; observed = n; }
  const metRaw = c.met;
  if (metRaw !== null && typeof metRaw !== "boolean") return null;
  return { criterion: criterionId, required, observed, met: metRaw === null ? null : metRaw };
}

function comparator(x: unknown): ComparatorRow | null {
  const r = obj(x);
  if (!r) return null;
  const id = str(r.id, 96), label = str(r.label, 256);
  if (!id || !label) return null;
  const status = r.status === "evaluated" || r.status === "unavailable" ? r.status : null;
  if (!status) return null;
  const definition = r.definition === null || r.definition === undefined ? null : str(r.definition, 1600);
  const reason = r.reason === null || r.reason === undefined ? null : str(r.reason, 512);
  if (status === "unavailable") {
    if (!reason) return null;
    return { id, label, definition, status, reason, totalNetReturn: null, annReturn: null, excessTotalVsSpy: null,
      annExcessVsSpy: null, annExcessOverCash: null, vsSpy: null, beta: null, betaCi95: null, interceptAnn: null,
      trackingError: null, maxDrawdown: null, upsideCapture: null, upsideCaptureCi95: null, downsideCapture: null,
      downsideCaptureCi95: null, meanInvested: null, timeInMarket: null, noEntryPeriods: null, annualTurnover: null,
      costsPaidTotal: null, noFillSignals: null, staleAssetDays: null, at2xCosts: null, window: null, sample: null,
      hitRateVsSpy: null, note: null };
  }
  const windowRaw = obj(r.window);
  if (!windowRaw) return null;
  const first = isoDate(windowRaw.first_return_close), last = isoDate(windowRaw.last_close), daily = int(windowRaw.daily_returns, 100000);
  if (!first || !last || daily === null || daily < 1) return null;
  const vsRaw = obj(r.vs_passive_market);
  if (!vsRaw) return null;
  const pOneSided = vsRaw.p_one_sided == null ? null : pValue(vsRaw.p_one_sided);
  if (vsRaw.p_one_sided != null && pOneSided === null) return null;
  const vsSpy: ComparatorRow["vsSpy"] = {
    totalDiff: vsRaw.total_diff === null || vsRaw.total_diff === undefined ? null : frac(vsRaw.total_diff),
    totalDiffCi95: vsRaw.total_diff_ci95 === null || vsRaw.total_diff_ci95 === undefined ? null : ci(vsRaw.total_diff_ci95),
    annDiff: vsRaw.ann_diff === null || vsRaw.ann_diff === undefined ? null : frac(vsRaw.ann_diff),
    annDiffCi95: vsRaw.ann_diff_ci95 === null || vsRaw.ann_diff_ci95 === undefined ? null : ci(vsRaw.ann_diff_ci95),
    pOneSided,
  };
  if (vsSpy.totalDiff === null || vsSpy.totalDiffCi95 === null) return null;
  // A PRESENT but out-of-contract value must reject the whole row — never
  // degrade silently to "absent" (that would publish a partial comparator).
  const presentFrac = (value: unknown, bound = 20): boolean =>
    value === null || value === undefined || frac(value, bound) !== null;
  if (!presentFrac(vsRaw.ann_diff) || !presentFrac(vsRaw.ann_diff, 100)
    || (vsRaw.ann_diff_ci95 != null && ci(vsRaw.ann_diff_ci95) === null)) return null;
  const NUMERIC: Array<[string, number]> = [
    ["total_net_return", 20], ["ann_return", 20], ["excess_total_vs_spy", 20], ["ann_excess_vs_spy", 20],
    ["ann_excess_over_cash", 20], ["beta_vs_market", 20], ["intercept_ann", 20], ["tracking_error", 20],
    ["max_drawdown", 20], ["upside_capture", 20], ["downside_capture", 20],
    ["mean_invested", 2], ["time_in_market", 2], ["no_entry_periods", 100000],
    ["annual_turnover", 10000], ["costs_paid_total", 20], ["no_fill_signals", 100000],
  ];
  for (const [key, bound] of NUMERIC) {
    if (!presentFrac(r[key], bound)) return null;
  }
  if (r.stale_asset_days != null && int(r.stale_asset_days, 100000) === null) return null;
  for (const key of ["beta_ci95", "upside_capture_ci95", "downside_capture_ci95"] as const) {
    if (r[key] != null && ci(r[key]) === null) return null;
  }
  const at2xRaw = r.at_2x_costs === null || r.at_2x_costs === undefined ? null : obj(r.at_2x_costs);
  let at2xCosts: ComparatorRow["at2xCosts"] = null;
  if (at2xRaw !== null) {
    if (!presentFrac(at2xRaw.total_net_return) || !presentFrac(at2xRaw.ann_excess_vs_spy)) return null;
    const t = at2xRaw.total_net_return === null || at2xRaw.total_net_return === undefined ? null : frac(at2xRaw.total_net_return);
    const e = at2xRaw.ann_excess_vs_spy === null || at2xRaw.ann_excess_vs_spy === undefined ? null : frac(at2xRaw.ann_excess_vs_spy);
    if (t === null && e === null) return null;
    at2xCosts = { totalNetReturn: t, annExcessVsSpy: e };
  }
  let sample: ComparatorRow["sample"] = null;
  const sampleRaw = r.sample === null || r.sample === undefined ? null : obj(r.sample);
  if (sampleRaw !== null) {
    const positions = int(sampleRaw.positions, 1_000_000), distinct = int(sampleRaw.distinct_assets, 1_000_000);
    const censored = int(sampleRaw.censored_open_at_window_end, 1_000_000), resolved = int(sampleRaw.resolved, 1_000_000);
    if (positions === null || distinct === null || censored === null || resolved === null) return null;
    sample = { positions, distinctAssets: distinct, censoredOpenAtWindowEnd: censored, resolved };
  }
  let hitRate: ComparatorRow["hitRateVsSpy"] = null;
  const hitRaw = r.hit_rate_vs_spy === null || r.hit_rate_vs_spy === undefined ? null : obj(r.hit_rate_vs_spy);
  if (hitRaw !== null) {
    const n = int(hitRaw.n, 1_000_000), beat = int(hitRaw.beat_spy, 1_000_000);
    const rate = frac(hitRaw.rate, 1), wilson = ci(hitRaw.ci95_wilson, 1);
    if (n === null || beat === null || rate === null || wilson === null || beat > n) return null;
    hitRate = { n, beatSpy: beat, rate, ci95Wilson: wilson };
  }
  const metric = (value: unknown, bound = 20): number | null =>
    value === null || value === undefined ? null : frac(value, bound);
  return {
    id, label, definition, status, reason,
    totalNetReturn: metric(r.total_net_return), annReturn: metric(r.ann_return),
    excessTotalVsSpy: metric(r.excess_total_vs_spy), annExcessVsSpy: metric(r.ann_excess_vs_spy),
    annExcessOverCash: metric(r.ann_excess_over_cash), vsSpy,
    beta: metric(r.beta_vs_market), betaCi95: r.beta_ci95 === null || r.beta_ci95 === undefined ? null : ci(r.beta_ci95),
    interceptAnn: metric(r.intercept_ann), trackingError: metric(r.tracking_error), maxDrawdown: metric(r.max_drawdown),
    upsideCapture: metric(r.upside_capture), upsideCaptureCi95: r.upside_capture_ci95 === null || r.upside_capture_ci95 === undefined ? null : ci(r.upside_capture_ci95),
    downsideCapture: metric(r.downside_capture), downsideCaptureCi95: r.downside_capture_ci95 === null || r.downside_capture_ci95 === undefined ? null : ci(r.downside_capture_ci95),
    meanInvested: metric(r.mean_invested, 2), timeInMarket: metric(r.time_in_market, 2), noEntryPeriods: metric(r.no_entry_periods, 100000),
    annualTurnover: r.annual_turnover === null || r.annual_turnover === undefined ? null : ratio(r.annual_turnover, 10000),
    costsPaidTotal: metric(r.costs_paid_total),
    noFillSignals: metric(r.no_fill_signals, 100000), staleAssetDays: r.stale_asset_days === null || r.stale_asset_days === undefined ? null : int(r.stale_asset_days, 100000),
    at2xCosts, window: { firstReturnClose: first, lastClose: last, dailyReturns: daily },
    sample, hitRateVsSpy: hitRate,
    note: r.note === null || r.note === undefined ? null : str(r.note, 256),
  };
}

function contrast(x: unknown): ContrastRow | null {
  const r = obj(x);
  if (!r) return null;
  const id = str(r.id, 16), a = str(r.a, 96), b = str(r.b, 96), def = str(r.header_definition, 128);
  const annDiff = frac(r.ann_diff), annCi = ci(r.ann_diff_ci95);
  const totalDiff = frac(r.total_diff), totalCi = ci(r.total_diff_ci95);
  const pRaw = pValue(r.p_raw), pHolm = pValue(r.p_holm), reject = bool(r.reject_h0);
  const blockRaw = obj(r.block21), costRaw = obj(r.at_2x_costs);
  if (!id || !a || !b || !def || annDiff === null || annCi === null || totalDiff === null || totalCi === null
    || pRaw === null || pHolm === null || reject === null || !blockRaw || !costRaw) return null;
  const bCi = ci(blockRaw.ann_diff_ci95), bP = pValue(blockRaw.p_raw), bH = pValue(blockRaw.p_holm), bR = bool(blockRaw.reject_h0);
  const cDiff = frac(costRaw.ann_diff), cCi = ci(costRaw.ann_diff_ci95);
  if (bCi === null || bP === null || bH === null || bR === null || cDiff === null || cCi === null) return null;
  return { id, a, b, headerDefinition: def, annDiff, annDiffCi95: annCi, totalDiff, totalDiffCi95: totalCi,
    pRaw, pHolm, rejectH0: reject,
    block21: { annDiffCi95: bCi, pRaw: bP, pHolm: bH, rejectH0: bR },
    at2xCosts: { annDiff: cDiff, annDiffCi95: cCi } };
}

function attribution(bookId: string, x: unknown): { bookId: string; book: AttributionBook } | null {
  const r = obj(x);
  if (!r) return null;
  const method = str(r.method, 256), linking = str(r.linking, 256), unit = str(r.unit, 128);
  const legsRaw = obj(r.legs), bridgeRaw = obj(r.gap_vs_benchmark_bridge);
  if (!method || !linking || !unit || !legsRaw || !bridgeRaw) return null;
  const leg = (name: string, bound = 20): number | null => {
    const value = frac(legsRaw[name], bound);
    return value;
  };
  const marketParticipation = leg("market_participation"), sectorAllocation = leg("sector_allocation");
  const selectionWithinSector = leg("selection_within_sector"), cash = leg("cash"), costs = leg("costs");
  const bl = (name: string): number | null => frac(bridgeRaw[name]);
  const bridge = { benchmark: bl("benchmark"), uninvestedMarketShortfall: bl("uninvested_market_shortfall"),
    sectorAllocation: bl("sector_allocation"), selectionWithinSector: bl("selection_within_sector"),
    cash: bl("cash"), costs: bl("costs"), strategy: bl("strategy") };
  if (marketParticipation === null || sectorAllocation === null || selectionWithinSector === null || cash === null || costs === null
    || Object.values(bridge).some(v => v === null)) return null;
  const sum = frac(r.sum_of_daily_net_returns), identityError = frac(r.identity_error, 1);
  const compounded = frac(r.compounded_total_net_return), residual = frac(r.compounding_residual);
  const benchSum = frac(r.benchmark_sum_of_daily_returns), unmapped = frac(r.unmapped_sector_weight_days, 1_000_000);
  if (sum === null || identityError === null || compounded === null || residual === null || benchSum === null || unmapped === null) return null;
  return { bookId, book: { method, linking, unit,
    legs: { marketParticipation, sectorAllocation, selectionWithinSector, cash, costs },
    bridge: bridge as AttributionBook["bridge"],
    sumOfDailyNetReturns: sum, identityError, compoundedTotalNetReturn: compounded, compoundingResidual: residual,
    benchmarkSumOfDailyReturns: benchSum, unmappedSectorWeightDays: unmapped } };
}

function eventMetric(x: unknown): EventStudyMetric | null {
  const m = obj(x);
  if (!m) return null;
  const mean = frac(m.mean), median = frac(m.median), n = int(m.n, 1_000_000);
  const ci95 = ci(m.ci95_date_cluster);
  if (mean === null || median === null || n === null || ci95 === null) return null;
  return { mean, median, n, ci95DateCluster: ci95 };
}

/** Optional-key decode: absent → null; present-but-invalid fails closed (the
 * closed-decoder law — a wrong value is never silently dropped). */
function opt<T>(value: unknown, decode: (x: unknown) => T | null): T | null | undefined {
  if (value === undefined) return null;
  const out = decode(value);
  return out === null ? undefined : out; // undefined = fail the whole decode
}

function eventHorizon(horizon: string, x: unknown): EventStudyHorizon | null {
  const r = obj(x);
  if (!r) return null;
  const n = int(r.n, 1_000_000);
  const status = r.status === "matured_subset" || r.status === "too_few_dates" || r.status === "unmatured" ? r.status : null;
  if (n === null || !status) return null;
  // An unmatured horizon may omit every metric field (D5: `{"n":0,"status":"unmatured"}`).
  // Matured/too-few-dates horizons carry the full metric set by contract.
  const metricsRequired = status !== "unmatured";
  const nDates = opt(r.n_dates, v => int(v, 1_000_000));
  const excess = opt(r.excess_vs_spy, eventMetric);
  const sector = opt(r.sector_etf_minus_spy, eventMetric);
  const stock = opt(r.stock_minus_sector_etf, eventMetric);
  const shareRaw = opt(r.share_beating_spy, obj);
  if (nDates === undefined || excess === undefined || sector === undefined || stock === undefined || shareRaw === undefined) return null;
  let share: EventStudyHorizon["shareBeatingSpy"] = null;
  if (shareRaw) {
    const k = int(shareRaw.k, 1_000_000), sn = int(shareRaw.n, 1_000_000);
    const rate = frac(shareRaw.rate, 1), wilson = ci(shareRaw.ci95_wilson_naive, 1);
    if (k === null || sn === null || rate === null || wilson === null || k > sn) return null;
    share = { k, n: sn, rate, ci95WilsonNaive: wilson };
  }
  if (metricsRequired && (nDates === null || !excess || !sector || !stock || !share)) return null;
  return { horizon, n, nDates, status, excessVsSpy: excess ?? null, sectorEtfMinusSpy: sector ?? null,
    stockMinusSectorEtf: stock ?? null, shareBeatingSpy: share };
}

function postHoc(bookId: string, x: unknown): { bookId: string; book: PostHocBook } | null {
  const r = obj(x);
  if (!r) return null;
  const concRaw = obj(r.concurrent_positions), withoutRaw = obj(r.without_top_contributor);
  if (!concRaw || !withoutRaw) return null;
  const min = int(concRaw.min, 1_000_000), median = frac(concRaw.median, 1_000_000), max = int(concRaw.max, 1_000_000);
  if (!Array.isArray(concRaw.first_5_sessions) || concRaw.first_5_sessions.length !== 5
    || concRaw.first_5_sessions.some((v: unknown) => int(v, 1_000_000) === null)) return null;
  const contributors = (list: unknown): { asset: string; grossContribution: number }[] | null => {
    if (!Array.isArray(list) || list.length === 0 || list.length > 32) return null;
    const out: { asset: string; grossContribution: number }[] = [];
    for (const item of list) {
      const c = obj(item);
      const asset = c ? str(c.asset, 16) : null;
      const gross = c ? frac(c.gross_contribution) : null;
      if (!asset || !/^[A-Z][A-Z0-9.\-]{0,15}$/.test(asset) || gross === null) return null;
      out.push({ asset, grossContribution: gross });
    }
    return out;
  };
  const top = contributors(r.top_contributors), bottom = contributors(r.bottom_contributors);
  const top5 = frac(r.top5_share_of_positive_contribution, 1);
  const dropped = str(withoutRaw.dropped_asset, 16);
  const total = frac(withoutRaw.total_net_return), excess = frac(withoutRaw.excess_total_vs_spy);
  const excessCi = ci(withoutRaw.excess_total_ci95), annExcess = frac(withoutRaw.ann_excess_vs_spy);
  const annCi = ci(withoutRaw.ann_excess_ci95), beta = frac(withoutRaw.beta_vs_market);
  if (min === null || median === null || max === null || !top || !bottom || top5 === null || !dropped
    || total === null || excess === null || excessCi === null || annExcess === null || annCi === null || beta === null) return null;
  return { bookId, book: {
    concurrentPositions: { min, median, max, first5Sessions: concRaw.first_5_sessions as number[] },
    topContributors: top, bottomContributors: bottom, top5ShareOfPositiveContribution: top5,
    withoutTopContributor: { droppedAsset: dropped, totalNetReturn: total, excessTotalVsSpy: excess, excessTotalCi95: excessCi,
      annExcessVsSpy: annExcess, annExcessCi95: annCi, betaVsMarket: beta } } };
}

function excludedMap(x: unknown): { reason: string; count: number }[] | null {
  const r = obj(x);
  if (!r) return null;
  const out: { reason: string; count: number }[] = [];
  for (const [reason, value] of Object.entries(r)) {
    if (!/^[a-z0-9_]{1,64}$/.test(reason)) return null;
    const count = int(value, 1_000_000);
    if (count === null) return null;
    out.push({ reason, count });
  }
  return out;
}

// ── D5 blocks: population and sensitivity (optional, fail-closed once present) ─

const PLAN_ID = /^[A-Z0-9][A-Z0-9.\-]{0,31}$/;
const SLUG = /^[a-z0-9_]{1,64}$/;
/** ISO date or datetime stamp ("2026-08-11T05:32:28.853265+00:00"). */
const STAMP = /^\d{4}-\d{2}-\d{2}(T[\d:.]{5,20}([+-]\d{2}:\d{2}|Z))?$/;

const stampList = (x: unknown, max: number): string[] | null => {
  if (!Array.isArray(x) || x.length > max) return null;
  const out: string[] = [];
  for (const v of x) {
    if (typeof v !== "string" || !STAMP.test(v)) return null;
    out.push(v);
  }
  return out;
};

const idList = (x: unknown, max: number): string[] | null => {
  if (!Array.isArray(x) || x.length > max) return null;
  const out: string[] = [];
  for (const v of x) {
    if (typeof v !== "string" || !PLAN_ID.test(v)) return null;
    out.push(v);
  }
  return out;
};

function hitRate(x: unknown): { n: number; beatSpy: number; rate: number; ci95Wilson: Ci95 } | null {
  const r = obj(x);
  if (!r) return null;
  const n = int(r.n, 1_000_000), beat = int(r.beat_spy, 1_000_000);
  const rate = frac(r.rate, 1), wilson = ci(r.ci95_wilson, 1);
  if (n === null || beat === null || rate === null || wilson === null || beat > n) return null;
  return { n, beatSpy: beat, rate, ci95Wilson: wilson };
}

function sensitivityRow(x: unknown): SensitivityVariantRow | null {
  const r = obj(x);
  if (!r) return null;
  const positions = int(r.positions, 1_000_000);
  const total = frac(r.total_net_return), excess = frac(r.excess_total_vs_spy);
  const excessCi = ci(r.excess_total_ci95), annExcess = frac(r.ann_excess_vs_spy);
  const annCi = ci(r.ann_excess_ci95), beta = frac(r.beta_vs_market);
  const invested = opt(r.mean_invested, v => frac(v, 1));
  const hit = opt(r.hit_rate_vs_spy, hitRate);
  if (positions === null || total === null || excess === null || excessCi === null || annExcess === null
    || annCi === null || beta === null || invested === undefined || hit === undefined) return null;
  return { positions, totalNetReturn: total, excessTotalVsSpy: excess, excessTotalCi95: excessCi,
    annExcessVsSpy: annExcess, annExcessCi95: annCi, betaVsMarket: beta, meanInvested: invested ?? null,
    hitRateVsSpy: hit ?? null };
}

function populationBlock(x: unknown): PopulationBlock | null {
  const r = obj(x);
  if (!r) return null;
  const primary = str(r.primary, 1024);
  if (!primary) return null;
  const cohortRaw = opt(r.excluded_cohort, obj);
  if (cohortRaw === undefined) return null;
  let excludedCohort: PopulationBlock["excludedCohort"] = null;
  if (cohortRaw) {
    const reason = str(cohortRaw.reason, 1024), detection = str(cohortRaw.detection, 1024);
    const eraPlansExcluded = int(cohortRaw.era_plans_excluded, 1_000_000);
    const replayed = opt(cohortRaw.of_which_replayed_receipted_bake, v => int(v, 1_000_000));
    const synthetic = opt(cohortRaw.of_which_synthetic_board_reconstructions, v => int(v, 1_000_000));
    const modesRaw = opt(cohortRaw.origination_mode_counts, obj);
    const stampsRaw = opt(cohortRaw.backfill_executed_at_by_kind, obj);
    const planIds = opt(cohortRaw.plan_ids, v => idList(v, 4096));
    const wouldCount = opt(cohortRaw.would_have_entered_positions_as_run, v => int(v, 1_000_000));
    const wouldIds = opt(cohortRaw.would_have_entered_ids_as_run, v => idList(v, 4096));
    if (!reason || !detection || eraPlansExcluded === null || replayed === undefined || synthetic === undefined
      || modesRaw === undefined || stampsRaw === undefined || planIds === undefined || wouldCount === undefined || wouldIds === undefined) return null;
    const originationModeCounts: { mode: string; count: number }[] = [];
    if (modesRaw) {
      for (const [mode, value] of Object.entries(modesRaw)) {
        if (!SLUG.test(mode)) return null;
        const count = int(value, 1_000_000);
        if (count === null) return null;
        originationModeCounts.push({ mode, count });
      }
    }
    const backfillExecutedAtByKind: { kind: string; stamps: string[] }[] = [];
    if (stampsRaw) {
      for (const [kind, value] of Object.entries(stampsRaw)) {
        if (!SLUG.test(kind)) return null;
        const stamps = stampList(value, 64);
        if (!stamps) return null;
        backfillExecutedAtByKind.push({ kind, stamps });
      }
    }
    excludedCohort = {
      reason, detection, eraPlansExcluded,
      ofWhichReplayedReceiptedBake: replayed ?? null,
      ofWhichSyntheticBoardReconstructions: synthetic ?? null,
      originationModeCounts, backfillExecutedAtByKind,
      planIds: planIds ?? [],
      wouldHaveEnteredPositionsAsRun: wouldCount ?? null,
      wouldHaveEnteredIdsAsRun: wouldIds ?? null,
    };
  }
  const mrnaRaw = opt(r.mrna, obj);
  if (mrnaRaw === undefined) return null;
  let mrna: PopulationBlock["mrna"] = null;
  if (mrnaRaw) {
    const note = str(mrnaRaw.note, 2048);
    if (!note) return null;
    const asRunEntry = opt(mrnaRaw.as_run_entry, v => str(v, 32));
    const inA = opt(mrnaRaw.in_sensitivity_a, bool);
    const entryA = opt(mrnaRaw.sensitivity_a_entry, v => str(v, 32));
    const auth = opt(mrnaRaw.price_authentication, v => str(v, 2048));
    if (asRunEntry === undefined || inA === undefined || entryA === undefined || auth === undefined) return null;
    mrna = { note, asRunEntry: asRunEntry ?? null, inSensitivityA: inA ?? null, sensitivityAEntry: entryA ?? null, priceAuthentication: auth ?? null };
  }
  const reviewRaw = opt(r.review, obj);
  if (reviewRaw === undefined) return null;
  let review: PopulationBlock["review"] = null;
  if (reviewRaw) {
    const file = str(reviewRaw.file, 256), sha = hex(reviewRaw.sha256, 64);
    if (!file || !sha) return null;
    review = { file, sha256: sha };
  }
  return { primary, excludedCohort, mrna, review };
}

function sensitivityBlock(x: unknown): SensitivityBlock | null {
  const r = obj(x);
  if (!r) return null;
  const label = str(r.label, 256);
  if (!label) return null;
  const variantRaw = opt(r.backfill_replays_admitted_after_availability, obj);
  if (variantRaw === undefined) return null;
  let variant: SensitivityBlock["backfillReplaysAdmittedAfterAvailability"] = null;
  if (variantRaw) {
    const definition = str(variantRaw.definition, 1024);
    if (!definition) return null;
    const excludedRaw = opt(variantRaw.excluded_from_this_variant, excludedMap);
    if (excludedRaw === undefined || !excludedRaw) return null;
    const row = sensitivityRow(variantRaw);
    if (!row) return null;
    variant = { definition, excludedFromThisVariant: excludedRaw, ...row };
  }
  const supersededRaw = opt(r.superseded_as_run, obj);
  if (supersededRaw === undefined) return null;
  let superseded: SensitivityBlock["supersededAsRun"] = null;
  if (supersededRaw) {
    const reason = str(supersededRaw.reason, 1024);
    const sameEngine = bool(supersededRaw.same_engine_seed_prices_costs);
    if (!reason || sameEngine === null) return null;
    const rows: { comparatorId: string; row: SensitivityVariantRow }[] = [];
    for (const [comparatorId, value] of Object.entries(supersededRaw)) {
      // Book rows are keyed by their full comparator ids; everything else
      // (reason, same_engine_seed_prices_costs, contrasts, retained
      // attribution/event-study evidence) is handled above or tolerated.
      if (!/^C\d[A-Za-z0-9_]{0,63}$/.test(comparatorId)) continue;
      const row = sensitivityRow(value);
      if (!row) return null;
      rows.push({ comparatorId, row });
    }
    const contrastsRaw = opt(supersededRaw.contrasts, obj);
    if (contrastsRaw === undefined) return null;
    const contrasts: SupersededContrastRow[] = [];
    if (contrastsRaw) {
      for (const [id, value] of Object.entries(contrastsRaw)) {
        if (!/^K\d_[A-Za-z0-9_]{1,63}$/.test(id)) return null;
        const c = obj(value);
        if (!c) return null;
        const annDiff = frac(c.ann_diff), annCi = ci(c.ann_diff_ci95);
        const totalDiff = frac(c.total_diff), totalCi = ci(c.total_diff_ci95);
        const p = pValue(c.p_one_sided);
        if (annDiff === null || annCi === null || totalDiff === null || totalCi === null || p === null) return null;
        contrasts.push({ id, annDiff, annDiffCi95: annCi, totalDiff, totalDiffCi95: totalCi, pOneSided: p });
      }
    }
    superseded = { reason, sameEngineSeedPricesCosts: sameEngine, rows, contrasts };
  }
  return { label, backfillReplaysAdmittedAfterAvailability: variant, supersededAsRun: superseded };
}


export function decodeBetaEvaluation(raw: unknown): BetaEvaluation | null {
  const r = obj(raw);
  if (!r || r.schema !== PROPHET_BETA_EVALUATION_SCHEMA || r.view !== PROPHET_BETA_EVALUATION_VIEW) return null;
  const protocolRef = str(r.protocol_ref, 512);
  const p = obj(r.protocol), code = obj(r.code), clocks = obj(r.data_clocks);
  if (!protocolRef || !p || !code || !clocks) return null;
  const protocolId = str(p.id, 128), headerSha = hex(p.header_sha256, 64), headerCommit = hex(p.header_commit, 40);
  const frozenOn = isoDate(p.frozen_on);
  if (!protocolId || !headerSha || !headerCommit || !frozenOn) return null;
  if (code.harness_dirty !== false) return null;
  const commit = hex(code.commit, 40), codeModule = str(code.module, 256), runner = str(code.runner, 256);
  const bootstrapRaw = obj(code.bootstrap);
  if (!commit || !codeModule || !runner || !bootstrapRaw) return null;
  const b = int(bootstrapRaw.B, 10_000_000), seed = int(bootstrapRaw.seed, Number.MAX_SAFE_INTEGER);
  const meanBlock = int(bootstrapRaw.mean_block, 10_000), sensBlock = int(bootstrapRaw.sensitivity_block, 10_000);
  if (b === null || b < 1 || seed === null || meanBlock === null || meanBlock < 1 || sensBlock === null || sensBlock < 1) return null;
  const plansRaw = obj(clocks.plans_index), resRaw = obj(clocks.resolution_log);
  const pitRaw = obj(clocks.pit_membership), pricesRaw = obj(clocks.prices);
  const macroCommit = hex(clocks.macro_data_commit, 40);
  if (!plansRaw || !resRaw || !pitRaw || !pricesRaw || !macroCommit) return null;
  const plans = {
    path: str(plansRaw.path, 512), sha256: hex(plansRaw.sha256, 64), asof: isoDate(plansRaw.asof),
    sourceAsof: isoDate(plansRaw.source_asof), computedAt: str(plansRaw.computed_at, 64),
  };
  const resolution = {
    path: str(resRaw.path, 512), sha256: hex(resRaw.sha256, 64), rows: int(resRaw.rows, 10_000_000),
    malformedLinesSkipped: int(resRaw.malformed_lines_skipped, 1_000_000), maxAsof: isoDate(resRaw.max_asof),
    closeDateCorrectionsApplied: int(resRaw.close_date_corrections_applied, 1_000_000),
    quarantinedIdsRemoved: int(resRaw.quarantined_ids_removed, 1_000_000),
  };
  const pit = { path: str(pitRaw.path, 512), sha256: hex(pitRaw.sha256, 64), lastRecordedChange: isoDate(pitRaw.last_recorded_change) };
  const prices = {
    source: str(pricesRaw.source, 256), tickersLoaded: int(pricesRaw.tickers_loaded, 1_000_000),
    digestSha256: hex(pricesRaw.digest_sha256, 64), missingFiles: int(pricesRaw.missing_files, 1_000_000),
    lastCloseUsed: isoDate(pricesRaw.last_close_used),
  };
  if (Object.values(plans).some(v => v === null) || Object.values(resolution).some(v => v === null)
    || Object.values(pit).some(v => v === null) || Object.values(prices).some(v => v === null)) return null;

  const costsRaw = obj(r.costs_bp_per_side);
  if (!costsRaw) return null;
  const etfCost = frac(costsRaw.etf, 10_000), stockCost = frac(costsRaw.stock, 10_000);
  if (etfCost === null || stockCost === null) return null;
  const basis = {
    market: str(r.market, 32), benchmark: str(r.benchmark, 32), currency: str(r.currency, 8),
    returnBasis: str(r.return_basis, 128), cashInstrument: str(r.cash_instrument, 32),
    costsBpPerSide: { etf: etfCost, stock: stockCost },
  };
  const windowRaw = obj(r.window);
  if (Object.values(basis).some(v => v === null) || !windowRaw) return null;
  const wFirst = isoDate(windowRaw.first_return_close), wLast = isoDate(windowRaw.last_close);
  const wSessions = int(windowRaw.sessions, 100_000), wDaily = int(windowRaw.daily_returns, 100_000);
  const wSpyTotal = frac(windowRaw.spy_total_return), wSpyDd = frac(windowRaw.spy_max_drawdown);
  if (!wFirst || !wLast || wSessions === null || wDaily === null || wSpyTotal === null || wSpyDd === null
    || wSessions < 1 || wDaily < 1) return null;
  const window = {
    firstReturnClose: wFirst, lastClose: wLast, sessions: wSessions, dailyReturns: wDaily,
    spyTotalReturn: wSpyTotal, spyMaxDrawdown: wSpyDd,
  };

  // Release block — the page's first-class element.
  const releaseRaw = obj(r.release);
  if (!releaseRaw) return null;
  if (!Array.isArray(releaseRaw.levels_defined) || releaseRaw.levels_defined.length < 1
    || releaseRaw.levels_defined.length > 8 || releaseRaw.levels_defined.some((v: unknown) => !str(v, 64))) return null;
  const levelsDefined = releaseRaw.levels_defined as string[];
  const overallLevel = str(releaseRaw.overall_level, 64);
  if (!overallLevel || !levelsDefined.includes(overallLevel)) return null;
  if (!Array.isArray(releaseRaw.l0_source_checks) || releaseRaw.l0_source_checks.length < 1 || releaseRaw.l0_source_checks.length > 32) return null;
  if (!Array.isArray(releaseRaw.global_minimum_for_L1) || releaseRaw.global_minimum_for_L1.length < 1 || releaseRaw.global_minimum_for_L1.length > 32) return null;
  const l0Checks = releaseRaw.l0_source_checks.map(criterion);
  const globalMin = releaseRaw.global_minimum_for_L1.map(criterion);
  const l0Met = bool(releaseRaw.l0_met), globalMinimumMet = bool(releaseRaw.global_minimum_met);
  const capRule = str(releaseRaw.cap_rule, 512), l2L3Note = str(releaseRaw.l2_l3_note, 512);
  if (l0Checks.some(c => c === null) || globalMin.some(c => c === null) || l0Met === null || globalMinimumMet === null
    || !capRule || !l2L3Note) return null;
  const jobsRaw = obj(releaseRaw.jobs);
  if (!jobsRaw) return null;
  const jobs: BetaEvaluation["release"]["jobs"] = [];
  for (const [key, value] of Object.entries(jobsRaw)) {
    const j = obj(value);
    if (!j || !/^[A-Za-z0-9_]{1,64}$/.test(key)) return null;
    const level = str(j.level, 64);
    if (!level || !levelsDefined.includes(level)) return null;
    if (!Array.isArray(j.criteria) || j.criteria.length < 1 || j.criteria.length > 64) return null;
    const criteria = j.criteria.map(criterion);
    if (criteria.some(c => c === null)) return null;
    jobs.push({ key, level, criteria: criteria as ReleaseCriterion[] });
  }
  if (jobs.length < 1) return null;

  const headline = Array.isArray(r.headline) && r.headline.length >= 1 && r.headline.length <= 32
    && r.headline.every((v: unknown) => str(v, 1024) !== null) ? r.headline as string[] : null;
  const limitations = Array.isArray(r.limitations) && r.limitations.length >= 0 && r.limitations.length <= 64
    && r.limitations.every((v: unknown) => str(v, 1024) !== null) ? r.limitations as string[] : null;
  if (!headline || !limitations) return null;

  if (!Array.isArray(r.comparators) || r.comparators.length < 2 || r.comparators.length > 64) return null;
  const comparators: ComparatorRow[] = [];
  const seenIds = new Set<string>();
  for (const value of r.comparators) {
    const row = comparator(value);
    if (!row || seenIds.has(row.id)) return null;
    seenIds.add(row.id);
    comparators.push(row);
  }
  if (!seenIds.has(BENCHMARK_COMPARATOR_ID) || !seenIds.has(INCUMBENT_COMPARATOR_ID)) return null;

  const contrastsRaw = obj(r.contrasts);
  if (!contrastsRaw || !Array.isArray(contrastsRaw.rows) || contrastsRaw.rows.length < 1 || contrastsRaw.rows.length > 64) return null;
  const family = str(contrastsRaw.family, 256);
  const contrastRows = contrastsRaw.rows.map(contrast);
  if (!family || contrastRows.some(c => c === null)) return null;

  const eventRaw = obj(r.event_study);
  if (!eventRaw) return null;
  const ruler = str(eventRaw.ruler, 256), population = str(eventRaw.population, 512);
  const eventPlans = int(eventRaw.plans, 10_000_000);
  const horizonsRaw = obj(eventRaw.horizons);
  const excludedBackfilled = opt(eventRaw.excluded_backfilled_plans, v => int(v, 1_000_000));
  if (!ruler || !population || eventPlans === null || !horizonsRaw || excludedBackfilled === undefined) return null;
  const horizons: EventStudyHorizon[] = [];
  for (const [horizon, value] of Object.entries(horizonsRaw)) {
    if (!/^\d{1,3}$/.test(horizon)) return null;
    const h = eventHorizon(horizon, value);
    if (!h) return null;
    horizons.push(h);
  }
  if (horizons.length < 1) return null;

  // D5 blocks — optional; present-but-invalid fails the whole decode.
  const populationDecoded = opt(r.population, populationBlock);
  const sensitivityDecoded = opt(r.sensitivity, sensitivityBlock);
  if (populationDecoded === undefined || sensitivityDecoded === undefined) return null;

  const attributionRaw = obj(r.attribution);
  if (!attributionRaw) return null;
  const books: { bookId: string; book: AttributionBook }[] = [];
  for (const bookId of ATTRIBUTION_BOOK_IDS) {
    const value = attributionRaw[bookId];
    if (value === undefined) continue; // a future artifact may publish fewer books
    const book = attribution(bookId, value);
    if (!book) return null;
    books.push(book);
  }
  if (!books.some(entry => entry.bookId === INCUMBENT_COMPARATOR_ID)) return null;

  const postRaw = obj(r.post_hoc_diagnostics);
  if (!postRaw) return null;
  const postLabel = str(postRaw.label, 256);
  if (!postLabel) return null;
  const postBooks: { bookId: string; book: PostHocBook }[] = [];
  for (const bookId of ATTRIBUTION_BOOK_IDS) {
    const value = postRaw[bookId];
    if (value === undefined) continue;
    const book = postHoc(bookId, value);
    if (!book) return null;
    postBooks.push(book);
  }
  if (!postBooks.some(entry => entry.bookId === INCUMBENT_COMPARATOR_ID)) return null;

  const coverageRaw = obj(r.coverage);
  if (!coverageRaw) return null;
  const eraPlans = int(coverageRaw.era_plans, 10_000_000), evaluatedPositions = int(coverageRaw.evaluated_positions, 10_000_000);
  const excluded = excludedMap(coverageRaw.excluded);
  const entryShifted = int(coverageRaw.entry_shifted_to_publication, 10_000_000);
  const exitRaw = obj(coverageRaw.exit_basis), sectorCovRaw = obj(coverageRaw.sector), splitRaw = obj(coverageRaw.c7_c6a_split);
  const classifiedShare = frac(coverageRaw.classified_share, 1), pricedShare = frac(coverageRaw.priced_share, 1);
  const missingFiles = Array.isArray(coverageRaw.member_universe_missing_price_files)
    && coverageRaw.member_universe_missing_price_files.length <= 4096
    && coverageRaw.member_universe_missing_price_files.every((v: unknown) => str(v, 16) !== null)
    ? coverageRaw.member_universe_missing_price_files as string[] : null;
  const weightsRaw = obj(coverageRaw.c4_sector_weights);
  const peersRaw = obj(coverageRaw.issuer_excluded_peers);
  const dropRaw = obj(coverageRaw.drop_corrected_sensitivity);
  if (eraPlans === null || evaluatedPositions === null || !excluded || entryShifted === null || !exitRaw || !sectorCovRaw
    || !splitRaw || classifiedShare === null || pricedShare === null || !missingFiles || !weightsRaw || !peersRaw || !dropRaw) return null;
  const exitBasis = {
    recordedCloseDate: int(exitRaw.recorded_close_date, 10_000_000),
    mechanicalPublishedLevels: int(exitRaw.mechanical_published_levels, 10_000_000),
    censoredOpenAtWindowEnd: int(exitRaw.censored_open_at_window_end, 10_000_000),
  };
  const sector = {
    unmappedPlans: int(sectorCovRaw.unmapped_plans, 10_000_000),
    labelSourceDisagreements: int(sectorCovRaw.label_source_disagreements, 10_000_000),
    labelsBasis: str(sectorCovRaw.labels_basis, 256),
  };
  const split = {
    outsideLeading: int(splitRaw.outside_leading, 10_000_000),
    insideLeading: int(splitRaw.inside_leading, 10_000_000),
    unmapped: int(splitRaw.unmapped, 10_000_000),
  };
  if (Object.values(exitBasis).some(v => v === null) || Object.values(sector).some(v => v === null) || Object.values(split).some(v => v === null)) return null;
  if (!Array.isArray(coverageRaw.member_universe_by_rebalance) || coverageRaw.member_universe_by_rebalance.length < 1
    || coverageRaw.member_universe_by_rebalance.length > 512) return null;
  const universe: BetaEvaluation["coverage"]["memberUniverseByRebalance"] = [];
  for (const value of coverageRaw.member_universe_by_rebalance) {
    const u = obj(value);
    if (!u) return null;
    const rDecision = isoDate(u.decision), rExecution = isoDate(u.execution);
    const rPitActive = int(u.pit_active, 10_000_000), rNoPriceFile = int(u.no_price_file, 10_000_000);
    const rNoSector = int(u.no_sector, 10_000_000), rShortHistory = int(u.short_history, 10_000_000);
    const rPriceBelowMin = int(u.price_below_min, 10_000_000), rEligible = int(u.eligible, 10_000_000);
    const rC4Names = int(u.c4_names, 10_000_000), rC5Names = int(u.c5_names, 10_000_000);
    const rC5Sectors = Array.isArray(u.c5_sectors) && u.c5_sectors.length >= 0 && u.c5_sectors.length <= 32
      && u.c5_sectors.every((v: unknown) => str(v, 16) !== null) ? u.c5_sectors as string[] : null;
    if (!rDecision || !rExecution || rPitActive === null || rNoPriceFile === null || rNoSector === null
      || rShortHistory === null || rPriceBelowMin === null || rEligible === null || rC4Names === null
      || rC5Names === null || rC5Sectors === null) return null;
    universe.push({
      decision: rDecision, execution: rExecution, pitActive: rPitActive, noPriceFile: rNoPriceFile,
      noSector: rNoSector, shortHistory: rShortHistory, priceBelowMin: rPriceBelowMin, eligible: rEligible,
      c4Names: rC4Names, c5Names: rC5Names, c5Sectors: rC5Sectors,
    });
  }
  const c4SectorWeights: { sector: string; weight: number }[] = [];
  for (const [sector, weight] of Object.entries(weightsRaw)) {
    if (!/^[A-Z]{2,8}$/.test(sector)) return null;
    const w = frac(weight, 1);
    if (w === null) return null;
    c4SectorWeights.push({ sector, weight: w });
  }
  if (c4SectorWeights.length < 1) return null;
  const peersStatus = str(peersRaw.status, 64), peersReason = str(peersRaw.reason, 512);
  if (!peersStatus || !peersReason) return null;
  const dropPositions = int(dropRaw.positions, 10_000_000);
  const dropExcluded = excludedMap(dropRaw.excluded);
  if (dropPositions === null || !dropExcluded) return null;

  const claimsRaw = obj(r.claims);
  if (!claimsRaw) return null;
  const claims: BetaEvaluation["claims"] = [];
  for (const [key, value] of Object.entries(claimsRaw)) {
    const c = obj(value);
    if (!c || !/^[a-z0-9_]{1,64}$/.test(key)) return null;
    const status = str(c.status, 64), basis = str(c.basis, 512);
    if (!status || !basis) return null;
    claims.push({ key, status, basis });
  }
  if (claims.length < 1) return null;

  if (!Array.isArray(r.deviations) || r.deviations.length > 64) return null;
  const deviations: BetaEvaluation["deviations"] = [];
  for (const value of r.deviations) {
    const d = obj(value);
    const id = d ? str(d.id, 16) : null, kind = d ? str(d.kind, 64) : null;
    // D5 carries the full before/after correction table in `what` — 2048 keeps
    // the bound meaningful while admitting it.
    const when = d ? str(d.when, 64) : null, what = d ? str(d.what, 2048) : null, why = d ? str(d.why, 2048) : null;
    if (!id || !kind || !when || !what || !why) return null;
    deviations.push({ id, kind, when, what, why });
  }

  // Safety: a v1 body carrying any action authority is not this contract.
  if (r.may_rank !== false || r.may_gate !== false || r.may_size !== false || r.may_trade !== false || r.may_escalate !== false) return null;

  return {
    schema: PROPHET_BETA_EVALUATION_SCHEMA, protocolRef,
    protocol: { id: protocolId, headerSha256: headerSha, headerCommit: headerCommit, frozenOn: frozenOn },
    code: { commit, harnessDirty: false, module: codeModule, runner, bootstrap: { b, seed, meanBlock, sensitivityBlock: sensBlock } },
    dataClocks: { macroDataCommit: macroCommit, plansIndex: plans as BetaEvaluation["dataClocks"]["plansIndex"], resolutionLog: resolution as BetaEvaluation["dataClocks"]["resolutionLog"], pitMembership: pit as BetaEvaluation["dataClocks"]["pitMembership"], prices: prices as BetaEvaluation["dataClocks"]["prices"] },
    basis: basis as BetaEvaluation["basis"], window: window as BetaEvaluation["window"],
    release: { levelsDefined, overallLevel, l0SourceChecks: l0Checks as ReleaseCriterion[], l0Met,
      globalMinimumForL1: globalMin as ReleaseCriterion[], globalMinimumMet, jobs, capRule, l2L3Note },
    headline, limitations, comparators,
    contrasts: { family, rows: contrastRows as ContrastRow[] },
    eventStudy: { ruler, population, plans: eventPlans, horizons, excludedBackfilledPlans: excludedBackfilled ?? null },
    attribution: books, postHocDiagnostics: { label: postLabel, books: postBooks },
    population: populationDecoded ?? null, sensitivity: sensitivityDecoded ?? null,
    coverage: { eraPlans, evaluatedPositions, excluded, entryShiftedToPublication: entryShifted,
      exitBasis: exitBasis as BetaEvaluation["coverage"]["exitBasis"], classifiedShare, pricedShare,
      sector: sector as BetaEvaluation["coverage"]["sector"], c7C6aSplit: split as BetaEvaluation["coverage"]["c7C6aSplit"],
      memberUniverseByRebalance: universe, memberUniverseMissingPriceFiles: missingFiles,
      c4SectorWeights, issuerExcludedPeers: { status: peersStatus, reason: peersReason },
      dropCorrectedSensitivity: { positions: dropPositions, excluded: dropExcluded } },
    claims, deviations,
    mayRank: false, mayGate: false, maySize: false, mayTrade: false, mayEscalate: false,
  };
}

// ── Display helpers (pure formatting — no recomputation of any result) ──────

/** True when the interval spans zero — a property visible on its face in the
 * rendered numbers; used only to state it in words, never to re-rank rows. */
export function intervalIncludesZero(ci95: Ci95): boolean {
  return ci95[0] <= 0 && ci95[1] >= 0;
}

/** Release levels are ordered L0…L3 by the artifact's own `levels_defined`;
 * the rank is used only for ordering chips, never to mint a new claim. */
export function evaluationLevelRank(level: string, levelsDefined: readonly string[]): number {
  const index = levelsDefined.indexOf(level);
  return index === -1 ? levelsDefined.length : index;
}

export const JOB_KEYS = ["A_market_participation", "B_sector_context", "C_member_selection"] as const;

/** Comparators in the family's declared order; unknown future ids last, in wire order. */
export function orderedComparators(rows: readonly ComparatorRow[]): ComparatorRow[] {
  const rank = (id: string): number => {
    const index = (COMPARATOR_ORDER as readonly string[]).indexOf(id);
    return index === -1 ? COMPARATOR_ORDER.length : index;
  };
  return [...rows].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

export function findComparator(rows: readonly ComparatorRow[], id: string): ComparatorRow | null {
  return rows.find(row => row.id === id) ?? null;
}
