export const PROPHET_PERF_SCHEMA = "prophet.perf_projection/v1" as const;

export const PROPHET_PERF_OUTCOMES = [
  "T1_HIT",
  "T2_HIT",
  "INVALIDATED",
  "EXPIRED",
  "CLOSED_EARLY",
  "NO_ENTRY",
] as const;

export type ProphetPerfOutcome = (typeof PROPHET_PERF_OUTCOMES)[number];

export interface ProphetPerfPlan {
  id: string;
  ticker: string;
  direction: "BULL" | "BEAR";
  signal_date: string | null;
  signal_date_unavailable_reason: string | null;
  entry_date: string | null;
  entry_date_unavailable_reason: string | null;
  close_date: string;
  outcome: ProphetPerfOutcome;
  days_held: number;
  plan_adherence: string;
  stock_result_pct: number | null;
  stock_result_pct_unavailable_reason: string | null;
  option_result_pct: number | null;
  option_result_pct_unavailable_reason: string | null;
  asof: string;
}

export interface ProphetPerfPayload {
  schema: typeof PROPHET_PERF_SCHEMA;
  source: {
    path: string;
    schema: "prophet.ledger/v1";
    projection: "canonical_effective_ledger";
    latest_asof: string | null;
    latest_close_date: string | null;
    freshness_unavailable_reason: string | null;
  };
  summary: {
    terminal_plan_count: number;
    closed_plan_count: number;
    no_entry_count: number;
    outcome_counts: Record<ProphetPerfOutcome, number>;
    raw_stock_return: {
      label: string;
      available_count: number;
      unavailable_count: number;
      mean_pct: number | null;
      median_pct: number | null;
      min_pct: number | null;
      max_pct: number | null;
      positive_count: number;
      negative_count: number;
      zero_count: number;
      unavailable_reason: string | null;
    };
    benchmarked_performance: {
      available: boolean;
      benchmark_return_pct: number | null;
      excess_return_pct: number | null;
      unavailable_reason: string | null;
    };
  };
  integrity: {
    canonical_row_count: number;
    effective_row_count: number;
    quarantined_excluded_count: number;
    quarantined_id_count: number;
    corrected_row_count: number;
    correction_application_count: number;
  };
  semantics: {
    outcome_count_basis: string;
    raw_stock_return_basis: string;
  };
  plans: ProphetPerfPlan[];
}

type Dict = Record<string, unknown>;

function record(value: unknown): Dict | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Dict
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value;
  return undefined;
}

function finiteNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function count(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 0 ? value as number : null;
}

function hasExplicitAvailability<T>(
  value: T | null,
  unavailableReason: string | null,
): boolean {
  return value === null
    ? typeof unavailableReason === "string" && unavailableReason.length > 0
    : unavailableReason === null;
}

function parsePlan(value: unknown): ProphetPerfPlan | null {
  const row = record(value);
  if (!row) return null;

  const id = stringValue(row.id);
  const ticker = stringValue(row.ticker);
  const direction = row.direction;
  const signalDate = nullableString(row.signal_date);
  const signalReason = nullableString(row.signal_date_unavailable_reason);
  const entryDate = nullableString(row.entry_date);
  const entryReason = nullableString(row.entry_date_unavailable_reason);
  const closeDate = stringValue(row.close_date);
  const outcome = row.outcome;
  const daysHeld = count(row.days_held);
  const adherence = stringValue(row.plan_adherence);
  const stockResult = finiteNumber(row.stock_result_pct);
  const stockReason = nullableString(row.stock_result_pct_unavailable_reason);
  const optionResult = finiteNumber(row.option_result_pct);
  const optionReason = nullableString(row.option_result_pct_unavailable_reason);
  const asof = stringValue(row.asof);

  if (
    !id || !ticker ||
    (direction !== "BULL" && direction !== "BEAR") ||
    signalDate === undefined || signalReason === undefined ||
    entryDate === undefined || entryReason === undefined ||
    !closeDate ||
    !PROPHET_PERF_OUTCOMES.includes(outcome as ProphetPerfOutcome) ||
    daysHeld === null || !adherence ||
    stockResult === undefined || stockReason === undefined ||
    optionResult === undefined || optionReason === undefined ||
    !asof
  ) return null;

  if (
    !hasExplicitAvailability(signalDate, signalReason) ||
    !hasExplicitAvailability(entryDate, entryReason) ||
    !hasExplicitAvailability(stockResult, stockReason) ||
    !hasExplicitAvailability(optionResult, optionReason)
  ) return null;

  if (
    outcome === "NO_ENTRY" &&
    (
      entryDate !== null ||
      stockResult !== null ||
      optionResult !== null ||
      stockReason !== "no_entry_no_position" ||
      optionReason !== "no_entry_no_position"
    )
  ) return null;

  return {
    id,
    ticker,
    direction,
    signal_date: signalDate,
    signal_date_unavailable_reason: signalReason,
    entry_date: entryDate,
    entry_date_unavailable_reason: entryReason,
    close_date: closeDate,
    outcome: outcome as ProphetPerfOutcome,
    days_held: daysHeld,
    plan_adherence: adherence,
    stock_result_pct: stockResult,
    stock_result_pct_unavailable_reason: stockReason,
    option_result_pct: optionResult,
    option_result_pct_unavailable_reason: optionReason,
    asof,
  };
}

export function normalizeProphetPerfPayload(value: unknown): ProphetPerfPayload | null {
  const root = record(value);
  if (!root || root.schema !== PROPHET_PERF_SCHEMA) return null;

  const source = record(root.source);
  const summary = record(root.summary);
  const integrity = record(root.integrity);
  const semantics = record(root.semantics);
  if (!source || !summary || !integrity || !semantics || !Array.isArray(root.plans)) return null;

  const sourcePath = stringValue(source.path);
  const sourceLatestAsof = nullableString(source.latest_asof);
  const sourceLatestClose = nullableString(source.latest_close_date);
  const sourceFreshnessReason = nullableString(source.freshness_unavailable_reason);
  if (
    !sourcePath ||
    source.schema !== "prophet.ledger/v1" ||
    source.projection !== "canonical_effective_ledger" ||
    sourceLatestAsof === undefined ||
    sourceLatestClose === undefined ||
    sourceFreshnessReason === undefined
  ) return null;

  const terminalCount = count(summary.terminal_plan_count);
  const closedCount = count(summary.closed_plan_count);
  const noEntryCount = count(summary.no_entry_count);
  const outcomeSource = record(summary.outcome_counts);
  const raw = record(summary.raw_stock_return);
  const benchmark = record(summary.benchmarked_performance);
  if (
    terminalCount === null || closedCount === null || noEntryCount === null ||
    !outcomeSource || !raw || !benchmark
  ) return null;

  const outcomeCounts = {} as Record<ProphetPerfOutcome, number>;
  for (const outcome of PROPHET_PERF_OUTCOMES) {
    const parsed = count(outcomeSource[outcome]);
    if (parsed === null) return null;
    outcomeCounts[outcome] = parsed;
  }
  const outcomeTotal = PROPHET_PERF_OUTCOMES.reduce(
    (total, outcome) => total + outcomeCounts[outcome],
    0,
  );
  if (
    outcomeTotal !== terminalCount ||
    outcomeCounts.NO_ENTRY !== noEntryCount
  ) return null;

  const rawLabel = stringValue(raw.label);
  const rawAvailable = count(raw.available_count);
  const rawUnavailable = count(raw.unavailable_count);
  const rawMean = finiteNumber(raw.mean_pct);
  const rawMedian = finiteNumber(raw.median_pct);
  const rawMin = finiteNumber(raw.min_pct);
  const rawMax = finiteNumber(raw.max_pct);
  const rawPositive = count(raw.positive_count);
  const rawNegative = count(raw.negative_count);
  const rawZero = count(raw.zero_count);
  const rawUnavailableReason = nullableString(raw.unavailable_reason);
  if (
    !rawLabel || rawAvailable === null || rawUnavailable === null ||
    rawMean === undefined || rawMedian === undefined || rawMin === undefined || rawMax === undefined ||
    rawPositive === null || rawNegative === null || rawZero === null ||
    rawUnavailableReason === undefined
  ) return null;

  const hasRawStats =
    rawMean !== null && rawMedian !== null && rawMin !== null && rawMax !== null;
  if (
    rawAvailable + rawUnavailable !== closedCount ||
    rawPositive + rawNegative + rawZero !== rawAvailable ||
    (rawAvailable === 0 && (hasRawStats || !rawUnavailableReason)) ||
    (rawAvailable > 0 && (!hasRawStats || rawUnavailableReason !== null))
  ) return null;

  if (typeof benchmark.available !== "boolean") return null;
  const benchmarkReturn = finiteNumber(benchmark.benchmark_return_pct);
  const excessReturn = finiteNumber(benchmark.excess_return_pct);
  const benchmarkReason = nullableString(benchmark.unavailable_reason);
  if (benchmarkReturn === undefined || excessReturn === undefined || benchmarkReason === undefined) return null;
  if (
    (!benchmark.available && (
      benchmarkReturn !== null ||
      excessReturn !== null ||
      !benchmarkReason
    )) ||
    (benchmark.available && (
      benchmarkReturn === null ||
      excessReturn === null ||
      benchmarkReason !== null
    ))
  ) return null;

  const canonicalRows = count(integrity.canonical_row_count);
  const effectiveRows = count(integrity.effective_row_count);
  const quarantinedExcluded = count(integrity.quarantined_excluded_count);
  const quarantinedIds = count(integrity.quarantined_id_count);
  const correctedRows = count(integrity.corrected_row_count);
  const correctionApps = count(integrity.correction_application_count);
  if (
    canonicalRows === null || effectiveRows === null || quarantinedExcluded === null ||
    quarantinedIds === null || correctedRows === null || correctionApps === null
  ) return null;
  if (
    canonicalRows < effectiveRows ||
    effectiveRows !== terminalCount ||
    canonicalRows - effectiveRows !== quarantinedExcluded
  ) return null;

  const outcomeBasis = stringValue(semantics.outcome_count_basis);
  const rawBasis = stringValue(semantics.raw_stock_return_basis);
  if (!outcomeBasis || !rawBasis) return null;

  const plans: ProphetPerfPlan[] = [];
  for (const value of root.plans) {
    const plan = parsePlan(value);
    if (!plan) return null;
    plans.push(plan);
  }

  const ids = new Set(plans.map((plan) => plan.id));
  const noEntryPlans = plans.filter((plan) => plan.outcome === "NO_ENTRY").length;
  if (
    terminalCount !== plans.length ||
    ids.size !== plans.length ||
    closedCount + noEntryCount !== terminalCount ||
    noEntryPlans !== noEntryCount
  ) return null;

  if (
    terminalCount === 0
      ? (
        sourceLatestAsof !== null ||
        sourceLatestClose !== null ||
        !sourceFreshnessReason
      )
      : (
        sourceLatestAsof === null ||
        sourceLatestClose === null ||
        sourceFreshnessReason !== null
      )
  ) return null;

  return {
    schema: PROPHET_PERF_SCHEMA,
    source: {
      path: sourcePath,
      schema: "prophet.ledger/v1",
      projection: "canonical_effective_ledger",
      latest_asof: sourceLatestAsof,
      latest_close_date: sourceLatestClose,
      freshness_unavailable_reason: sourceFreshnessReason,
    },
    summary: {
      terminal_plan_count: terminalCount,
      closed_plan_count: closedCount,
      no_entry_count: noEntryCount,
      outcome_counts: outcomeCounts,
      raw_stock_return: {
        label: rawLabel,
        available_count: rawAvailable,
        unavailable_count: rawUnavailable,
        mean_pct: rawMean,
        median_pct: rawMedian,
        min_pct: rawMin,
        max_pct: rawMax,
        positive_count: rawPositive,
        negative_count: rawNegative,
        zero_count: rawZero,
        unavailable_reason: rawUnavailableReason,
      },
      benchmarked_performance: {
        available: benchmark.available,
        benchmark_return_pct: benchmarkReturn,
        excess_return_pct: excessReturn,
        unavailable_reason: benchmarkReason,
      },
    },
    integrity: {
      canonical_row_count: canonicalRows,
      effective_row_count: effectiveRows,
      quarantined_excluded_count: quarantinedExcluded,
      quarantined_id_count: quarantinedIds,
      corrected_row_count: correctedRows,
      correction_application_count: correctionApps,
    },
    semantics: {
      outcome_count_basis: outcomeBasis,
      raw_stock_return_basis: rawBasis,
    },
    plans,
  };
}
