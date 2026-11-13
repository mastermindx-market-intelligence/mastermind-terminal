/**
 * prophetBetaEvaluation.ts — closed decoder + display model for Macro's
 * `prophet.beta_evaluation/v1` strategy-evaluation artifact (the artifact
 * contract lives in ARTIFACT_CONTRACT_v1.md in the publisher's fixture
 * bundle; the wire contract is `prophet.beta_evaluation/v1`).
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
  /** RUN-D concentration check (D6-era artifact): the three largest positive
   * gross contributors removed. Optional — absent on the pre-correction v1. */
  withoutTop3Contributors: {
    droppedAssets: string[]; reason: string;
    totalNetReturn: number; excessTotalVsSpy: number; excessTotalCi95: Ci95;
    annExcessVsSpy: number; annExcessCi95: Ci95; betaVsMarket: number;
  } | null;
};
/** A position whose close series stops inside the window (delisting): named by
 * the engine in the held-path coverage and the total-loss stress variant. */
export type GappedPosition = {
  planId: string; asset: string; entry: string; firstMissingClose: string; missingSessions: number;
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
    /** 2026-11-11 correction census (any-era minted backfills; see
     * censusBasis). Optional — absent on the pre-correction artifact. */
    censusBasis: string | null;
    eraMintedOutageBackfill: number | null;
    overallMintedOutageBackfill: number | null;
    overallOfWhichReplayedReceiptedBake: number | null;
    overallOfWhichSyntheticBoardReconstructions: number | null;
    outsideSelectionEra: string[] | null;
  } | null;
  /** The 78 incumbent-era plans converted without a dated fill (D6-era):
   * entered at the publication session under the header's literal C6 rule,
   * removed wholesale by the excluding_undated_conversions sensitivity. */
  undatedConversions: {
    count: number; ids: string[];
    basis: string; primaryTreatment: string; sensitivity: string;
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

/** One book-recomputed sensitivity variant (definition + row). */
export type SensitivityVariantEntry = {
  definition: string;
  excludedFromThisVariant: { reason: string; count: number }[];
} & SensitivityVariantRow;

/** D8 after-the-fact sensitivity: picks whose stock is not a point-in-time
 * S&P 1500 member at its signal session. Per horizon, the frozen leg split
 * into off-index and member-pick means with the off-index contribution. */
export type OffIndexGapRow = { mean: number; n: number; nDates: number; ci95: Ci95 };
export type OffIndexHorizon = {
  horizon: string;
  allPlans: OffIndexGapRow;
  offIndexPicks: OffIndexGapRow;
  sp1500MemberPicks: OffIndexGapRow;
  offIndexShareOfMatured: number;
  contributionToMeanGap: number;
  contributionNote: string;
};
export type OffIndexBlock = {
  label: string; definition: string;
  publishedPlansOffIndex: number; publishedPlansTotal: number; enteredPositionsOffIndex: number;
  horizons: OffIndexHorizon[];
  membershipFileLimits: string;
};

/** D5 sensitivity block — never the headline; the label says exactly that and
 * rides through verbatim. Optional at decode like `population`. The 2026-11-11
 * correction added two protocol variants and the after-the-fact off-index
 * diagnosis; each is optional the same way (an artifact without one renders
 * without it, an artifact with a malformed one fails the whole decode). */
export type SensitivityBlock = {
  label: string;
  backfillReplaysAdmittedAfterAvailability: SensitivityVariantEntry | null;
  supersededAsRun: {
    reason: string; sameEngineSeedPricesCosts: boolean;
    rows: { comparatorId: string; row: SensitivityVariantRow }[];
    contrasts: SupersededContrastRow[];
  } | null;
  /** The 78 undated-conversion plans removed (D6-era artifact). */
  excludingUndatedConversions: SensitivityVariantEntry | null;
  /** Delisted assets charged to a total loss (D6-era artifact), with the
   * affected positions itemised. */
  missingMarksTotalLossStress: ({ definition: string; gappedPositions: GappedPosition[] } & SensitivityVariantRow) | null;
  /** After-the-fact (independent diagnosis) — the artifact's own label says
   * so and rides with it wherever it renders. */
  offIndexPicks: OffIndexBlock | null;
};

/** D7 yardstick correction, beside the frozen event study: at each horizon
 * the equal-weight member basket, the picks against that basket, and a
 * placebo distribution of random same-sector members. Optional at decode. */
export type MemberBenchmarkPlacebo = {
  draws: number; mean: number; lo: number; hi: number;
  observedOutsidePlaceboRange: boolean; note: string;
};
export type MemberBenchmarkHorizon = {
  horizon: string; n: number; nDates: number | null;
  status: "matured_subset" | "too_few_dates" | "unmatured";
  nPlansWithoutEligiblePeers: number | null;
  medianPeersPerPlan: number | null;
  identityCheckMaxAbs: number | null;
  stockMinusEqualWeightMembers: EventStudyMetric | null;
  equalWeightMemberMinusSectorEtf: EventStudyMetric | null;
  stockMinusSectorEtf: EventStudyMetric | null;
  placebo: MemberBenchmarkPlacebo | null;
};
export type MemberBenchmarkBlock = {
  label: string; why: string;
  universeRule: string | null;
  sameRulerAndPopulation: boolean | null;
  decompositionIdentity: string | null;
  horizons: MemberBenchmarkHorizon[];
};

/** The 2026-11-11 correction statement: what changed, the superseded figures
 * beside their corrected successors, and the publisher's own
 * verdict-unchanged ruling. Optional at decode (the pre-correction v1 and any
 * future uncorrected artifact decode with `correction: null`). */
export type CorrectionSupersededRow = {
  positions: number;
  totalNetReturn: number;
  excessTotalVsSpy: number; excessTotalCi95: Ci95;
  annExcessVsSpy: number; annExcessCi95: Ci95;
  betaVsMarket: number; costsPaidTotal: number;
};
export type CorrectionBlock = {
  date: string; supersedes: string; whatChanged: string; label: string;
  figuresSuperseded: {
    reasonEach: string;
    rows: { comparatorId: string; row: CorrectionSupersededRow }[];
    verdictUnchanged: boolean; verdictReason: string;
  } | null;
};

/** The two-run post-publication audit summary (RUN-D). Optional at decode. */
export type AuditRun = { name: string; report: string; scope: string };
export type IndependentAuditBlock = {
  label: string;
  runs: AuditRun[];
  whatAgreed: string[];
  whatChanged: string[];
  addedSensitivities: string[];
  adjudication: string;
};

export type BetaEvaluation = {
  schema: typeof PROPHET_BETA_EVALUATION_SCHEMA;
  protocolRef: string;
  protocol: { id: string; headerSha256: string; headerCommit: string; frozenOn: string };
  code: { commit: string; harnessDirty: false; module: string; runner: string; bootstrap: { b: number; seed: number; meanBlock: number; sensitivityBlock: number } };
  dataClocks: {
    macroDataCommit: string;
    plansIndex: { path: string; sha256: string; asof: string; sourceAsof: string; computedAt: string; readFrom: string | null };
    resolutionLog: { path: string; sha256: string; rows: number; malformedLinesSkipped: number; maxAsof: string; closeDateCorrectionsApplied: number; quarantinedIdsRemoved: number };
    pitMembership: { path: string; sha256: string; lastRecordedChange: string; readFrom: string | null };
    prices: {
      source: string; tickersLoaded: number; digestSha256: string; missingFiles: number; lastCloseUsed: string;
      /** Pin verification (D6-era): every per-ticker parquet byte-compared to
       * the data pin's git blob id. Optional — absent on the v1 artifact. */
      pinVerified: boolean | null;
      pinVerification: string | null;
      readFromPinBlobs: string[] | null;
      pinnedInputSha256: { key: string; sha256: string }[] | null;
    };
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
  eventStudy: {
    ruler: string; population: string; plans: number; horizons: EventStudyHorizon[]; excludedBackfilledPlans: number | null;
    /** D7 member-benchmark yardstick (optional — the frozen study above is
     * untouched by it and renders alone when this is absent). */
    memberBenchmark: MemberBenchmarkBlock | null;
  };
  attribution: { bookId: string; book: AttributionBook }[];
  postHocDiagnostics: { label: string; books: { bookId: string; book: PostHocBook }[] };
  /** D5 additions — optional at decode; null on the pre-correction artifact. */
  population: PopulationBlock | null;
  sensitivity: SensitivityBlock | null;
  /** D6/D7/D8 additions of the 2026-11-11 correction — optional the same way. */
  correction: CorrectionBlock | null;
  independentAudit: IndependentAuditBlock | null;
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
    /** D6-era held-path coverage: `pricedShare` counts entry marks only, so
     * the held path is stated separately (complete vs gapped positions). */
    pricedShareBasis: string | null;
    heldPathCompletePositions: number | null;
    heldPathGaps: number | null;
    heldPathGapPositions: GappedPosition[] | null;
    resolvedAtOrBeforeSplit: { total: number; enteredAtFinalClose: number; resolvedBeforeFollowerFill: number } | null;
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
  // D6-era concentration check: the three largest positive gross contributors
  // removed (optional — the v1 artifact carries only without_top_contributor).
  const top3Raw = opt(r.without_top3_contributors, obj);
  if (top3Raw === undefined) return null;
  let withoutTop3: PostHocBook["withoutTop3Contributors"] = null;
  if (top3Raw) {
    if (!Array.isArray(top3Raw.dropped_assets) || top3Raw.dropped_assets.length < 1 || top3Raw.dropped_assets.length > 32
      || top3Raw.dropped_assets.some((v: unknown) => typeof v !== "string" || !ASSET.test(v))) return null;
    const reason = str(top3Raw.reason, 2048);
    const t3Total = frac(top3Raw.total_net_return), t3Excess = frac(top3Raw.excess_total_vs_spy);
    const t3ExcessCi = ci(top3Raw.excess_total_ci95), t3Ann = frac(top3Raw.ann_excess_vs_spy);
    const t3AnnCi = ci(top3Raw.ann_excess_ci95), t3Beta = frac(top3Raw.beta_vs_market);
    if (!reason || t3Total === null || t3Excess === null || t3ExcessCi === null || t3Ann === null || t3AnnCi === null || t3Beta === null) return null;
    withoutTop3 = { droppedAssets: top3Raw.dropped_assets as string[], reason,
      totalNetReturn: t3Total, excessTotalVsSpy: t3Excess, excessTotalCi95: t3ExcessCi,
      annExcessVsSpy: t3Ann, annExcessCi95: t3AnnCi, betaVsMarket: t3Beta };
  }
  return { bookId, book: {
    concurrentPositions: { min, median, max, first5Sessions: concRaw.first_5_sessions as number[] },
    topContributors: top, bottomContributors: bottom, top5ShareOfPositiveContribution: top5,
    withoutTopContributor: { droppedAsset: dropped, totalNetReturn: total, excessTotalVsSpy: excess, excessTotalCi95: excessCi,
      annExcessVsSpy: annExcess, annExcessCi95: annCi, betaVsMarket: beta },
    withoutTop3Contributors: withoutTop3 } };
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

// ── 2026-11-11 correction blocks (D6 engine fix, D7 yardstick, D8 off-index) ─

const ASSET = /^[A-Z][A-Z0-9.\-]{0,15}$/;

function gappedPosition(x: unknown): GappedPosition | null {
  const r = obj(x);
  if (!r) return null;
  const planId = str(r.plan_id, 32), asset = str(r.asset, 16);
  const entry = isoDate(r.entry), firstMissing = isoDate(r.first_missing_close);
  const missing = int(r.missing_sessions, 100_000);
  if (!planId || !PLAN_ID.test(planId) || !asset || !ASSET.test(asset)
    || !entry || !firstMissing || missing === null || missing < 1) return null;
  return { planId, asset, entry, firstMissingClose: firstMissing, missingSessions: missing };
}

const gappedPositionList = (x: unknown, max: number): GappedPosition[] | null => {
  if (!Array.isArray(x) || x.length > max) return null;
  const out: GappedPosition[] = [];
  for (const value of x) {
    const g = gappedPosition(value);
    if (!g) return null;
    out.push(g);
  }
  return out;
};

/** One `definition` + book row + exclusion-map variant (the shape the two new
 * protocol sensitivities share with the D5 replay variant). */
function sensitivityVariantEntry(x: unknown): SensitivityVariantEntry | null {
  const r = obj(x);
  if (!r) return null;
  const definition = str(r.definition, 2048);
  if (!definition) return null;
  const excluded = opt(r.excluded_from_this_variant, excludedMap);
  if (excluded === undefined || !excluded) return null;
  const row = sensitivityRow(r);
  if (!row) return null;
  return { definition, excludedFromThisVariant: excluded, ...row };
}

function offIndexHorizon(horizon: string, x: unknown): OffIndexHorizon | null {
  const r = obj(x);
  if (!r) return null;
  const gapRow = (value: unknown): OffIndexGapRow | null => {
    const g = obj(value);
    if (!g) return null;
    const mean = frac(g.mean), n = int(g.n, 1_000_000), nDates = int(g.n_dates, 1_000_000);
    const interval = ci(g.ci95_date_cluster);
    if (mean === null || n === null || nDates === null || interval === null || n < 1) return null;
    return { mean, n, nDates, ci95: interval };
  };
  const all = gapRow(r.all_plans), off = gapRow(r.off_index_picks), member = gapRow(r.sp1500_member_picks);
  const share = frac(r.off_index_share_of_matured, 1), contribution = frac(r.contribution_to_mean_gap);
  const note = str(r.contribution_note, 512);
  if (!all || !off || !member || share === null || contribution === null || !note) return null;
  return { horizon, allPlans: all, offIndexPicks: off, sp1500MemberPicks: member,
    offIndexShareOfMatured: share, contributionToMeanGap: contribution, contributionNote: note };
}

function offIndexBlock(x: unknown): OffIndexBlock | null {
  const r = obj(x);
  if (!r) return null;
  const label = str(r.label, 256), definition = str(r.definition, 2048);
  const publishedOff = int(r.published_plans_off_index, 10_000_000);
  const publishedTotal = int(r.published_plans_total, 10_000_000);
  const enteredOff = int(r.entered_positions_off_index, 1_000_000);
  const limits = str(r.membership_file_limits, 2048);
  if (!label || !definition || publishedOff === null || publishedTotal === null
    || enteredOff === null || !limits || publishedOff > publishedTotal) return null;
  const horizonsRaw = obj(r.horizons);
  if (!horizonsRaw) return null;
  const horizons: OffIndexHorizon[] = [];
  for (const [horizon, value] of Object.entries(horizonsRaw)) {
    if (!/^\d{1,3}$/.test(horizon)) return null;
    const h = offIndexHorizon(horizon, value);
    if (!h) return null;
    horizons.push(h);
  }
  if (horizons.length < 1) return null;
  return { label, definition, publishedPlansOffIndex: publishedOff, publishedPlansTotal: publishedTotal,
    enteredPositionsOffIndex: enteredOff, horizons, membershipFileLimits: limits };
}

/** Same maturity law as the frozen event study: an unmatured horizon carries
 * `{"n":0,"status":"unmatured"}`; every other status requires the full leg
 * set plus the placebo distribution. */
function memberBenchmarkHorizon(horizon: string, x: unknown): MemberBenchmarkHorizon | null {
  const r = obj(x);
  if (!r) return null;
  const n = int(r.n, 1_000_000);
  const status = r.status === "matured_subset" || r.status === "too_few_dates" || r.status === "unmatured"
    ? r.status : null;
  if (n === null || !status) return null;
  const metricsRequired = status !== "unmatured";
  const nDates = opt(r.n_dates, v => int(v, 1_000_000));
  const noPeers = opt(r.n_plans_without_eligible_peers, v => int(v, 1_000_000));
  const medianPeers = opt(r.median_peers_per_plan, v => frac(v, 1_000_000));
  const identity = opt(r.identity_check_max_abs, v => frac(v, 1));
  const stock = opt(r.stock_minus_equal_weight_members, eventMetric);
  const basket = opt(r.equal_weight_member_minus_sector_etf, eventMetric);
  const frozen = opt(r.stock_minus_sector_etf, eventMetric);
  const placeboRaw = opt(r.placebo_random_same_sector, obj);
  if (nDates === undefined || noPeers === undefined || medianPeers === undefined || identity === undefined
    || stock === undefined || basket === undefined || frozen === undefined || placeboRaw === undefined) return null;
  let placebo: MemberBenchmarkPlacebo | null = null;
  if (placeboRaw) {
    const draws = int(placeboRaw.draws, 10_000_000);
    const mean = frac(placeboRaw.mean), lo = frac(placeboRaw.p2_5), hi = frac(placeboRaw.p97_5);
    const outside = bool(placeboRaw.observed_outside_placebo_range);
    const note = str(placeboRaw.note, 512);
    if (draws === null || draws < 1 || mean === null || lo === null || hi === null || outside === null || !note
      || lo > hi) return null;
    placebo = { draws, mean, lo, hi, observedOutsidePlaceboRange: outside, note };
  }
  if (metricsRequired && (nDates === null || !stock || !basket || !frozen || !placebo)) return null;
  return { horizon, n, nDates, status, nPlansWithoutEligiblePeers: noPeers ?? null,
    medianPeersPerPlan: medianPeers ?? null, identityCheckMaxAbs: identity ?? null,
    stockMinusEqualWeightMembers: stock ?? null, equalWeightMemberMinusSectorEtf: basket ?? null,
    stockMinusSectorEtf: frozen ?? null, placebo };
}

function memberBenchmarkBlock(x: unknown): MemberBenchmarkBlock | null {
  const r = obj(x);
  if (!r) return null;
  const label = str(r.label, 256), why = str(r.why, 2048);
  if (!label || !why) return null;
  const universeRule = opt(r.universe_rule, v => str(v, 2048));
  const sameRuler = opt(r.same_ruler_and_population, bool);
  const identity = opt(r.decomposition_identity, v => str(v, 2048));
  if (universeRule === undefined || sameRuler === undefined || identity === undefined) return null;
  const horizonsRaw = obj(r.horizons);
  if (!horizonsRaw) return null;
  const horizons: MemberBenchmarkHorizon[] = [];
  for (const [horizon, value] of Object.entries(horizonsRaw)) {
    if (!/^\d{1,3}$/.test(horizon)) return null;
    const h = memberBenchmarkHorizon(horizon, value);
    if (!h) return null;
    horizons.push(h);
  }
  if (horizons.length < 1) return null;
  return { label, why, universeRule: universeRule ?? null, sameRulerAndPopulation: sameRuler ?? null,
    decompositionIdentity: identity ?? null, horizons };
}

function correctionBlock(x: unknown): CorrectionBlock | null {
  const r = obj(x);
  if (!r) return null;
  // A correction block exists to state a correction; `correction: false` is
  // outside the contract.
  if (r.correction !== true) return null;
  const date = isoDate(r.date), supersedes = str(r.supersedes, 512);
  const whatChanged = str(r.what_changed, 2048), label = str(r.label, 256);
  if (!date || !supersedes || !whatChanged || !label) return null;
  const figuresRaw = opt(r.figures_superseded, obj);
  if (figuresRaw === undefined) return null;
  let figures: CorrectionBlock["figuresSuperseded"] = null;
  if (figuresRaw) {
    const reasonEach = str(figuresRaw.reason_each, 2048);
    const verdictUnchanged = bool(figuresRaw.verdict_unchanged);
    const verdictReason = str(figuresRaw.verdict_reason, 2048);
    if (!reasonEach || verdictUnchanged === null || !verdictReason) return null;
    const rows: { comparatorId: string; row: CorrectionSupersededRow }[] = [];
    for (const [comparatorId, value] of Object.entries(figuresRaw)) {
      // Superseded book rows ride under their full comparator ids; every other
      // key (reason_each, verdict_*) is handled above.
      if (!/^C\d[A-Za-z0-9_]{0,63}$/.test(comparatorId)) continue;
      const c = obj(value);
      if (!c) return null;
      const positions = int(c.positions, 1_000_000);
      const total = frac(c.total_net_return), excess = frac(c.excess_total_vs_spy);
      const excessCi = ci(c.excess_total_ci95), annExcess = frac(c.ann_excess_vs_spy);
      const annCi = ci(c.ann_excess_ci95), beta = frac(c.beta_vs_market);
      const costs = frac(c.costs_paid_total);
      if (positions === null || total === null || excess === null || excessCi === null
        || annExcess === null || annCi === null || beta === null || costs === null) return null;
      rows.push({ comparatorId, row: { positions, totalNetReturn: total, excessTotalVsSpy: excess,
        excessTotalCi95: excessCi, annExcessVsSpy: annExcess, annExcessCi95: annCi, betaVsMarket: beta, costsPaidTotal: costs } });
    }
    if (rows.length < 1) return null;
    figures = { reasonEach, rows, verdictUnchanged, verdictReason };
  }
  return { date, supersedes, whatChanged, label, figuresSuperseded: figures };
}

function independentAuditBlock(x: unknown): IndependentAuditBlock | null {
  const r = obj(x);
  if (!r) return null;
  const label = str(r.label, 256);
  const adjudication = str(r.adjudication, 512);
  if (!label || !adjudication) return null;
  if (!Array.isArray(r.runs) || r.runs.length < 1 || r.runs.length > 4) return null;
  const runs: AuditRun[] = [];
  for (const value of r.runs) {
    const a = obj(value);
    const name = a ? str(a.name, 256) : null, report = a ? str(a.report, 512) : null, scope = a ? str(a.scope, 512) : null;
    if (!name || !report || !scope) return null;
    runs.push({ name, report, scope });
  }
  const listOf = (value: unknown, max: number, itemMax: number): string[] | null => {
    if (!Array.isArray(value) || value.length > max) return null;
    const out: string[] = [];
    for (const v of value) {
      const s = str(v, itemMax);
      if (!s) return null;
      out.push(s);
    }
    return out;
  };
  const agreed = listOf(r.what_agreed, 16, 1024);
  const changed = listOf(r.what_changed, 16, 1024);
  const added = listOf(r.added_sensitivities, 16, 128);
  if (!agreed || !changed || !added) return null;
  return { label, runs, whatAgreed: agreed, whatChanged: changed, addedSensitivities: added, adjudication };
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
    // 2026-11-11 census: any-era minted backfills beyond the selection era.
    const censusBasis = opt(cohortRaw.census_basis, v => str(v, 1024));
    const eraMinted = opt(cohortRaw.era_minted_outage_backfill, v => int(v, 1_000_000));
    const overallMinted = opt(cohortRaw.overall_minted_outage_backfill, v => int(v, 1_000_000));
    const overallReplayed = opt(cohortRaw.overall_of_which_replayed_receipted_bake, v => int(v, 1_000_000));
    const overallSynthetic = opt(cohortRaw.overall_of_which_synthetic_board_reconstructions, v => int(v, 1_000_000));
    const outsideEra = opt(cohortRaw.outside_selection_era, v => idList(v, 4096));
    if (censusBasis === undefined || eraMinted === undefined || overallMinted === undefined
      || overallReplayed === undefined || overallSynthetic === undefined || outsideEra === undefined) return null;
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
      censusBasis: censusBasis ?? null,
      eraMintedOutageBackfill: eraMinted ?? null,
      overallMintedOutageBackfill: overallMinted ?? null,
      overallOfWhichReplayedReceiptedBake: overallReplayed ?? null,
      overallOfWhichSyntheticBoardReconstructions: overallSynthetic ?? null,
      outsideSelectionEra: outsideEra ?? null,
    };
  }
  // The undated-conversion cohort (D6-era artifact): every field required once
  // the block is present — it is the definition of a whole sensitivity.
  const undatedRaw = opt(r.undated_conversions, obj);
  if (undatedRaw === undefined) return null;
  let undatedConversions: PopulationBlock["undatedConversions"] = null;
  if (undatedRaw) {
    const count = int(undatedRaw.count, 1_000_000);
    const ids = opt(undatedRaw.ids, v => idList(v, 4096));
    const basis = str(undatedRaw.basis, 2048);
    const primaryTreatment = str(undatedRaw.primary_treatment, 2048);
    const sensitivity = str(undatedRaw.sensitivity, 512);
    if (count === null || count < 1 || ids === undefined || !basis || !primaryTreatment || !sensitivity
      || !ids || ids.length !== count) return null;
    undatedConversions = { count, ids, basis, primaryTreatment, sensitivity };
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
  return { primary, excludedCohort, undatedConversions, mrna, review };
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
  // 2026-11-11 additions — optional individually, fail-closed once present.
  const undatedVariant = opt(r.excluding_undated_conversions, sensitivityVariantEntry);
  if (undatedVariant === undefined) return null;
  const marksRaw = opt(r.missing_marks_total_loss_stress, obj);
  if (marksRaw === undefined) return null;
  let marksVariant: SensitivityBlock["missingMarksTotalLossStress"] = null;
  if (marksRaw) {
    const definition = str(marksRaw.definition, 2048);
    const gapped = opt(marksRaw.gapped_positions, v => gappedPositionList(v, 64));
    if (!definition || gapped === undefined) return null;
    const row = sensitivityRow(marksRaw);
    if (!row) return null;
    marksVariant = { definition, gappedPositions: gapped ?? [], ...row };
  }
  const offIndex = opt(r.off_index_picks, offIndexBlock);
  if (offIndex === undefined) return null;
  return { label, backfillReplaysAdmittedAfterAvailability: variant, supersededAsRun: superseded,
    excludingUndatedConversions: undatedVariant ?? null, missingMarksTotalLossStress: marksVariant,
    offIndexPicks: offIndex ?? null };
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
  // D6-era provenance: which store each input was read from.
  const plansReadFrom = opt(plansRaw.read_from, v => str(v, 128));
  const pitReadFrom = opt(pitRaw.read_from, v => str(v, 128));
  const pinVerified = opt(pricesRaw.pin_verified, bool);
  const pinVerification = opt(pricesRaw.pin_verification, v => str(v, 2048));
  const pinBlobs = opt(pricesRaw.read_from_pin_blobs, v => {
    if (!Array.isArray(v) || v.length > 64) return null;
    const out: string[] = [];
    for (const item of v) {
      const s = str(item, 64);
      if (!s) return null;
      out.push(s);
    }
    return out;
  });
  const pinnedInputs = opt(pricesRaw.pinned_input_sha256, raw => {
    const p = obj(raw);
    if (!p) return null;
    const out: { key: string; sha256: string }[] = [];
    for (const [key, value] of Object.entries(p)) {
      if (!SLUG.test(key)) return null;
      const sha = hex(value, 64);
      if (!sha) return null;
      out.push({ key, sha256: sha });
    }
    return out;
  });
  if (plansReadFrom === undefined || pitReadFrom === undefined || pinVerified === undefined
    || pinVerification === undefined || pinBlobs === undefined || pinnedInputs === undefined) return null;
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
  // D7 yardstick block rides beside the frozen study (optional, fail-closed).
  const memberBenchmarkDecoded = opt(eventRaw.member_benchmark, memberBenchmarkBlock);
  if (memberBenchmarkDecoded === undefined) return null;

  // D5 blocks — optional; present-but-invalid fails the whole decode.
  const populationDecoded = opt(r.population, populationBlock);
  const sensitivityDecoded = opt(r.sensitivity, sensitivityBlock);
  if (populationDecoded === undefined || sensitivityDecoded === undefined) return null;
  // 2026-11-11 correction + audit — optional the same way.
  const correctionDecoded = opt(r.correction, correctionBlock);
  const auditDecoded = opt(r.independent_audit, independentAuditBlock);
  if (correctionDecoded === undefined || auditDecoded === undefined) return null;

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
  // D6-era held-path coverage + entry/exit split — optional, fail-closed.
  const pricedBasis = opt(coverageRaw.priced_share_basis, v => str(v, 2048));
  const heldComplete = opt(coverageRaw.held_path_complete_positions, v => int(v, 1_000_000));
  const heldGaps = opt(coverageRaw.held_path_gaps, v => int(v, 1_000_000));
  const heldGapPositions = opt(coverageRaw.held_path_gap_positions, v => gappedPositionList(v, 64));
  const splitRawCov = opt(coverageRaw.resolved_at_or_before_split, raw => {
    const s = obj(raw);
    if (!s) return null;
    const total = int(s.total, 1_000_000), finalClose = int(s.entered_at_final_close, 1_000_000);
    const beforeFollower = int(s.resolved_before_follower_fill, 1_000_000);
    if (total === null || finalClose === null || beforeFollower === null) return null;
    return { total, enteredAtFinalClose: finalClose, resolvedBeforeFollowerFill: beforeFollower };
  });
  if (pricedBasis === undefined || heldComplete === undefined || heldGaps === undefined
    || heldGapPositions === undefined || splitRawCov === undefined) return null;

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
    dataClocks: {
      macroDataCommit: macroCommit,
      plansIndex: { ...(plans as BetaEvaluation["dataClocks"]["plansIndex"]), readFrom: plansReadFrom ?? null },
      resolutionLog: resolution as BetaEvaluation["dataClocks"]["resolutionLog"],
      pitMembership: { ...(pit as BetaEvaluation["dataClocks"]["pitMembership"]), readFrom: pitReadFrom ?? null },
      prices: { ...(prices as BetaEvaluation["dataClocks"]["prices"]),
        pinVerified: pinVerified ?? null, pinVerification: pinVerification ?? null,
        readFromPinBlobs: pinBlobs ?? null, pinnedInputSha256: pinnedInputs ?? null },
    },
    basis: basis as BetaEvaluation["basis"], window: window as BetaEvaluation["window"],
    release: { levelsDefined, overallLevel, l0SourceChecks: l0Checks as ReleaseCriterion[], l0Met,
      globalMinimumForL1: globalMin as ReleaseCriterion[], globalMinimumMet, jobs, capRule, l2L3Note },
    headline, limitations, comparators,
    contrasts: { family, rows: contrastRows as ContrastRow[] },
    eventStudy: { ruler, population, plans: eventPlans, horizons, excludedBackfilledPlans: excludedBackfilled ?? null,
      memberBenchmark: memberBenchmarkDecoded ?? null },
    attribution: books, postHocDiagnostics: { label: postLabel, books: postBooks },
    population: populationDecoded ?? null, sensitivity: sensitivityDecoded ?? null,
    correction: correctionDecoded ?? null, independentAudit: auditDecoded ?? null,
    coverage: { eraPlans, evaluatedPositions, excluded, entryShiftedToPublication: entryShifted,
      exitBasis: exitBasis as BetaEvaluation["coverage"]["exitBasis"], classifiedShare, pricedShare,
      sector: sector as BetaEvaluation["coverage"]["sector"], c7C6aSplit: split as BetaEvaluation["coverage"]["c7C6aSplit"],
      memberUniverseByRebalance: universe, memberUniverseMissingPriceFiles: missingFiles,
      c4SectorWeights, issuerExcludedPeers: { status: peersStatus, reason: peersReason },
      dropCorrectedSensitivity: { positions: dropPositions, excluded: dropExcluded },
      pricedShareBasis: pricedBasis ?? null, heldPathCompletePositions: heldComplete ?? null,
      heldPathGaps: heldGaps ?? null, heldPathGapPositions: heldGapPositions ?? null,
      resolvedAtOrBeforeSplit: splitRawCov ?? null },
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

/** One matured fixed-horizon per-plan mark a verdict sentence may quote: the
 * horizon's date-cluster interval on `excess_vs_spy` excludes zero. The leg
 * value is the stock-minus-own-sector-ETF mean at the SAME horizon, carried
 * only when that leg's own interval also excludes zero. */
export type PerPlanHorizonMark = {
  horizon: string;
  n: number;
  mean: number;
  direction: "behind" | "ahead";
  legMean: number | null;
};

/** The per-plan forward marks the verdict may cite. Unmatured horizons carry
 * no metrics and are never cited; a horizon whose interval spans zero is not
 * distinguishable from chance and stays in the coverage panel only. */
export function perPlanHorizonMarks(horizons: readonly EventStudyHorizon[]): PerPlanHorizonMark[] {
  const marks: PerPlanHorizonMark[] = [];
  for (const h of horizons) {
    if (h.status !== "matured_subset" || h.excessVsSpy === null) continue;
    if (intervalIncludesZero(h.excessVsSpy.ci95DateCluster)) continue;
    const leg = h.stockMinusSectorEtf;
    marks.push({
      horizon: h.horizon,
      n: h.excessVsSpy.n,
      mean: h.excessVsSpy.mean,
      direction: h.excessVsSpy.mean < 0 ? "behind" : "ahead",
      legMean: leg !== null && !intervalIncludesZero(leg.ci95DateCluster) ? leg.mean : null,
    });
  }
  return marks.sort((a, b) => Number(a.horizon) - Number(b.horizon));
}

/** One horizon of the "why the picks trailed" panel: the two decomposition
 * legs against the member yardstick, the frozen stock-vs-sector measure the
 * placebo is drawn for, and the placebo distribution itself. */
export type MemberYardstickMark = {
  horizon: string; n: number;
  /** equal-weight member basket − sector ETF: the yardstick's own gap. */
  yardstick: EventStudyMetric;
  /** stock − equal-weight member basket: the picks against the fairer ruler. */
  picks: EventStudyMetric;
  /** stock − sector ETF (the frozen event-study leg, same horizon). */
  frozen: EventStudyMetric;
  placebo: MemberBenchmarkPlacebo;
};

/** The horizons the diagnosis panel renders: matured member-benchmark
 * horizons whose frozen excess_vs_spy mark the verdict itself cites (the same
 * qualification `perPlanHorizonMarks` applies), so the "why" panel and the
 * verdict sentence always speak about the same measurements — today 21 and 42
 * sessions. No qualifying horizon, no panel. */
export function memberYardstickMarks(
  horizons: readonly MemberBenchmarkHorizon[],
  cited: readonly PerPlanHorizonMark[],
): MemberYardstickMark[] {
  const citedSet = new Set(cited.map(m => m.horizon));
  const marks: MemberYardstickMark[] = [];
  for (const h of horizons) {
    if (h.status !== "matured_subset" || !citedSet.has(h.horizon)) continue;
    if (!h.stockMinusEqualWeightMembers || !h.equalWeightMemberMinusSectorEtf
      || !h.stockMinusSectorEtf || !h.placebo) continue;
    marks.push({ horizon: h.horizon, n: h.n, yardstick: h.equalWeightMemberMinusSectorEtf,
      picks: h.stockMinusEqualWeightMembers, frozen: h.stockMinusSectorEtf, placebo: h.placebo });
  }
  return marks.sort((a, b) => Number(a.horizon) - Number(b.horizon));
}

// ── The ?from seam (verdict back link) ──────────────────────────────────────

/** Budget for a ?from value, mirroring the sector surface's carrier budget. */
export const EVALUATION_FROM_MAX = 1800;

/** The back link accepts only a rooted same-app path: a leading "/" followed
 * by URL-path characters — no scheme, no protocol-relative "//", no
 * backslash, no hash, no control characters. The constant pattern is the gate
 * (same contract as the sector surface's `prophetFromHrefAdmissible`);
 * anything else falls back to /prophet. Pure: no window access. */
const EVALUATION_FROM_PATTERN = /^\/[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=:@%/?-]*$/;

export function safeEvaluationFromHref(raw: string | null): string {
  if (!raw || raw.length > EVALUATION_FROM_MAX) return "/prophet";
  if (!EVALUATION_FROM_PATTERN.test(raw)) return "/prophet";
  if (raw.includes("//") || raw.includes("\\") || raw.includes("#")) return "/prophet";
  return raw;
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
