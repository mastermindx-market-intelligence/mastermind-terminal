/**
 * Display-only qualification of Macro's same-US-cash-session cross-asset context.
 * The producer owns the signed-in feed, source captures, semantic digest and
 * measured return arithmetic. The consumer rejects contradictory metadata and
 * never converts these US-listed ETF proxies into trade instructions, flow, or
 * an intraday forecast. Missing/invalid optional context must not fail Risk Radar.
 */
export const MULTI_ASSET_SCHEMA = "mastermind.multi_asset_daily_context/v1";
const SOURCE_KIND = "captured_mutable_daily_cache";
const ALIGNMENT = "US_CASH_SESSION_LABEL_NOT_QUOTE_TIMESTAMP";
const COHERENCE = "individually_hashed_not_atomic_bundle";
const HEX = /^[a-f0-9]{64}$/;
const INSTRUMENT = /^[A-Z0-9_.-]{1,20}$/;
const CLASSIFICATIONS = new Set([
  "POSITIVE_AND_OUTPERFORMING", "RELATIVE_RESILIENCE_ONLY",
  "UNDERPERFORMING", "IN_LINE",
]);
const AUTHORITY_KEYS = ["can_gate", "can_rank", "can_size", "can_trade"];

export type CrossAssetRow = {
  instrument_id: string;
  label_en: string;
  label_zh: string;
  asset_class: string;
  exposure_region: string;
  listing_market: "US";
  currency: "USD";
  return_basis: "total_return";
  start_session: string;
  end_session: string;
  last_source_session: string | null;
  status: "OBSERVED" | "UNAVAILABLE";
  reasons: string[];
  absolute_return: number | null;
  relative_return: number | null;
  classification: string | null;
  source_ref: string;
  source_digest: string | null;
  evidence_family_id: "yahoo_daily_adjusted_prices";
  comparison_status?: "OBSERVED" | "UNAVAILABLE";
};

export type CrossAssetContext = {
  schema: typeof MULTI_ASSET_SCHEMA;
  method_version: "same_us_cash_session_snapshot.v1";
  status: "AVAILABLE" | "PARTIAL" | "STALE" | "UNAVAILABLE";
  reasons: string[];
  context_digest: string;
  captured_at: string;
  alignment_basis: typeof ALIGNMENT;
  window: {
    start_session: string; end_session: string; expected_session: string; horizon_sessions: number;
    calendar_owner: "lib.nyse_calendar"; listing_timezone: "America/New_York";
  };
  coverage: { requested: number; observed: number; comparable: number; invalid_sources: number };
  source_kind: typeof SOURCE_KIND;
  provider_available_at: null;
  historical_original_availability_proven: false;
  capture_coherence: typeof COHERENCE;
  base_currency: "USD";
  benchmark_instrument_id: "SPY";
  benchmark_return: number | null;
  rows: CrossAssetRow[];
  display_only: true;
  no_predictive_claim: true;
  authority: { can_rank: false; can_gate: false; can_size: false; can_trade: false };
  limitations: string[];
};
export type CrossAssetQualification = {
  context: CrossAssetContext | null;
  qualified: boolean;
  reasons: string[];
};

const obj = (x: unknown): Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : {};
const str = (x: unknown, max = 160): string | null =>
  typeof x === "string" && x.length > 0 && x.length <= max && x.trim() === x ? x : null;
const num = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) ? x : null;
const natural = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
function day(x: unknown): string | null {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return null;
  const parsed = Date.parse(x + "T00:00:00Z");
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === x ? x : null;
}
function instant(x: unknown): number | null {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(x)
      || !/(Z|[+-]\d{2}:\d{2})$/.test(x)) return null;
  const parsed = Date.parse(x);
  return Number.isFinite(parsed) ? parsed : null;
}
const fail = (reason: string): CrossAssetQualification =>
  ({ context: null, qualified: false, reasons: [reason] });

/** Synchronous, pure, bounded consumer qualification. No confidence/alpha inferred. */
export function qualifyMultiAssetContext(raw: unknown, nowMs = Date.now()): CrossAssetQualification {
  if (raw === undefined || raw === null) return fail("missing_multi_asset_context");
  const src = obj(raw), window = obj(src.window), coverage = obj(src.coverage), auth = obj(src.authority);
  if (src.schema !== MULTI_ASSET_SCHEMA || src.method_version !== "same_us_cash_session_snapshot.v1") {
    return fail("multi_asset_schema_invalid");
  }
  if (src.display_only !== true || src.no_predictive_claim !== true
      || Object.keys(auth).length !== AUTHORITY_KEYS.length
      || AUTHORITY_KEYS.some(k => auth[k] !== false)) return fail("multi_asset_authority_invalid");
  if (src.source_kind !== SOURCE_KIND || src.alignment_basis !== ALIGNMENT
      || src.capture_coherence !== COHERENCE || src.base_currency !== "USD"
      || src.benchmark_instrument_id !== "SPY"
      || src.historical_original_availability_proven !== false
      || src.provider_available_at !== null
      || typeof src.context_digest !== "string" || !HEX.test(src.context_digest)) {
    return fail("multi_asset_evidence_basis_invalid");
  }
  const captured = instant(src.captured_at), start = day(window.start_session);
  const end = day(window.end_session), expected = day(window.expected_session);
  if (captured === null || !Number.isFinite(nowMs) || captured > nowMs || !start || !end || !expected
      || !(start < end && end <= expected)
      || expected > new Date(captured).toISOString().slice(0, 10)
      || !natural(window.horizon_sessions) || window.horizon_sessions < 1 || window.horizon_sessions > 252
      || window.calendar_owner !== "lib.nyse_calendar"
      || window.listing_timezone !== "America/New_York") {
    return fail("multi_asset_clock_invalid");
  }
  const status = src.status;
  if (!["AVAILABLE", "PARTIAL", "STALE", "UNAVAILABLE"].includes(String(status))) {
    return fail("multi_asset_status_invalid");
  }
  const requested = natural(coverage.requested) ? coverage.requested : -1;
  const observed = natural(coverage.observed) ? coverage.observed : -1;
  const comparable = natural(coverage.comparable) ? coverage.comparable : -1;
  const invalidSources = natural(coverage.invalid_sources) ? coverage.invalid_sources : -1;
  if (requested < 1 || requested > 32 || observed < 0 || comparable < 0 || invalidSources < 0
      || observed > requested || comparable > observed
      || !Array.isArray(src.rows) || src.rows.length !== requested) return fail("multi_asset_coverage_invalid");
  if (!Array.isArray(src.reasons) || src.reasons.length > 20
      || src.reasons.some((s: unknown) => !str(s))) return fail("multi_asset_reasons_invalid");
  const limits = [
    "not_intraday", "not_native_foreign_market_returns", "not_observed_fund_flows",
    "not_point_in_time_backtest_evidence", "funds_may_overlap",
    "cash_is_separate_from_short_duration_funds", "not_an_allocation_recommendation",
  ];
  if (!Array.isArray(src.limitations) || src.limitations.length !== limits.length
      || src.limitations.some((s: unknown, i: number) => s !== limits[i])) {
    return fail("multi_asset_limitations_invalid");
  }
  const rows: CrossAssetRow[] = [], seen = new Set<string>();
  let counted = 0, comparables = 0, benchmark: number | null = null;
  for (const rawRow of src.rows) {
    const r = obj(rawRow), identity = str(r.instrument_id, 20);
    if (!identity || !INSTRUMENT.test(identity) || seen.has(identity)
        || !str(r.label_en, 160) || !str(r.label_zh, 160)
        || !str(r.asset_class, 80) || !str(r.exposure_region, 80)
        || r.currency !== "USD" || r.listing_market !== "US"
        || r.return_basis !== "total_return" || r.evidence_family_id !== "yahoo_daily_adjusted_prices"
        || r.start_session !== start || r.end_session !== end
        || (r.last_source_session !== null && !day(r.last_source_session))
        || r.source_ref !== "data/yahoo/" + identity + ".parquet"
        || (r.source_digest !== null && !HEX.test(String(r.source_digest)))
        || !Array.isArray(r.reasons) || r.reasons.length > 20
        || r.reasons.some((s: unknown) => !str(s, 120))
        || !["OBSERVED", "UNAVAILABLE"].includes(String(r.status))) {
      return fail("multi_asset_row_invalid");
    }
    seen.add(identity);
    let absolute: number | null = null, relative: number | null = null, classification: string | null = null;
    let comparison: "OBSERVED" | "UNAVAILABLE" | undefined;
    if (r.status === "OBSERVED") {
      absolute = num(r.absolute_return);
      if (absolute === null || absolute < -1 || !HEX.test(String(r.source_digest))) {
        return fail("multi_asset_return_invalid");
      }
      counted++;
      if (identity === "SPY") {
        benchmark = absolute;
        if (r.relative_return !== null || r.classification !== null
            || r.comparison_status !== undefined) return fail("multi_asset_benchmark_invalid");
      } else if (r.comparison_status === "OBSERVED") {
        relative = num(r.relative_return);
        classification = str(r.classification, 48);
        if (relative === null || !classification || !CLASSIFICATIONS.has(classification)) {
          return fail("multi_asset_comparison_invalid");
        }
        comparison = "OBSERVED";
        comparables++;
      } else if (r.comparison_status === "UNAVAILABLE") {
        if (r.relative_return !== null || r.classification !== null) {
          return fail("multi_asset_unavailable_comparison_invalid");
        }
        comparison = "UNAVAILABLE";
      } else {
        return fail("multi_asset_comparison_missing");
      }
    } else {
      if (r.absolute_return !== null || r.relative_return !== null
          || r.classification !== null || r.comparison_status !== undefined) {
        return fail("multi_asset_missing_return_invalid");
      }
    }
    const row: CrossAssetRow = {
      instrument_id: identity, label_en: r.label_en as string, label_zh: r.label_zh as string,
      asset_class: r.asset_class as string, exposure_region: r.exposure_region as string,
      listing_market: "US", currency: "USD", return_basis: "total_return",
      start_session: start, end_session: end, last_source_session: r.last_source_session as string | null,
      status: r.status as CrossAssetRow["status"], reasons: [...r.reasons as string[]],
      absolute_return: absolute, relative_return: relative, classification,
      source_ref: r.source_ref as string,
      source_digest: r.source_digest === null ? null : r.source_digest as string,
      evidence_family_id: "yahoo_daily_adjusted_prices",
    };
    if (comparison !== undefined) row.comparison_status = comparison;
    rows.push(row);
  }
  if (!seen.has("SPY") || counted !== observed || comparables !== comparable
      || (src.benchmark_return !== null && num(src.benchmark_return) === null)
      || src.benchmark_return !== benchmark) return fail("multi_asset_coverage_disagreement");
  if (comparables && benchmark !== null && benchmark > -1) {
    for (const r of rows) {
      if (r.comparison_status !== "OBSERVED") continue;
      const calculation = (1 + (r.absolute_return as number)) / (1 + benchmark) - 1;
      if (r.relative_return === null || Math.abs(r.relative_return - calculation) > 1e-8) {
        return fail("multi_asset_relative_math_invalid");
      }
      const kind = r.relative_return > 0
        ? (r.absolute_return! > 0 ? "POSITIVE_AND_OUTPERFORMING" : "RELATIVE_RESILIENCE_ONLY")
        : r.relative_return < 0 ? "UNDERPERFORMING" : "IN_LINE";
      if (r.classification !== kind) return fail("multi_asset_classification_invalid");
    }
  } else if (comparables > 0) {
    return fail("multi_asset_zero_benchmark_wealth");
  }
  const expectedStatus = !comparables ? "UNAVAILABLE" : end < expected ? "STALE"
    : observed < requested || invalidSources > 0 || comparables < observed - 1 ? "PARTIAL" : "AVAILABLE";
  const expectedReasons = !comparables
    ? [benchmark === null ? "benchmark_unavailable" : "no_comparable_returns"]
    : end < expected ? ["older_than_expected_session"] : [];
  if (status !== expectedStatus
      || JSON.stringify(src.reasons) !== JSON.stringify(expectedReasons)) {
    return fail("multi_asset_status_disagreement");
  }
  const safe: CrossAssetContext = {
    schema: MULTI_ASSET_SCHEMA, method_version: "same_us_cash_session_snapshot.v1",
    status: status as CrossAssetContext["status"], reasons: [...src.reasons as string[]],
    context_digest: src.context_digest as string, captured_at: src.captured_at as string,
    alignment_basis: ALIGNMENT,
    window: { start_session: start, end_session: end, expected_session: expected,
      horizon_sessions: window.horizon_sessions as number,
      calendar_owner: "lib.nyse_calendar", listing_timezone: "America/New_York" },
    coverage: { requested: requested as number, observed: observed as number,
      comparable: comparable as number, invalid_sources: invalidSources as number },
    source_kind: SOURCE_KIND, provider_available_at: null,
    historical_original_availability_proven: false, capture_coherence: COHERENCE,
    base_currency: "USD", benchmark_instrument_id: "SPY",
    benchmark_return: benchmark, rows: rows.sort((a, b) => a.instrument_id.localeCompare(b.instrument_id)),
    display_only: true, no_predictive_claim: true,
    authority: { can_rank: false, can_gate: false, can_size: false, can_trade: false },
    limitations: [...limits],
  };
  return { context: safe, qualified: true, reasons: [] };
}

const percent = (value: number): string => (value >= 0 ? "+" : "") + (100 * value).toFixed(2) + "%";

/** Context-only plain text for the EXISTING collapsed Risk Radar disclosure. */
export function multiAssetContextCopy(context: CrossAssetContext, zh: boolean): string[] {
  const coverage = context.coverage, window = context.window;
  const state = context.status === "STALE" ? (zh ? "已过期" : "stale")
    : context.status === "PARTIAL" ? (zh ? "部分覆盖" : "partial")
      : context.status === "AVAILABLE" ? (zh ? "已有观测" : "observed")
        : (zh ? "不可用" : "unavailable");
  const benchmark = context.benchmark_return === null
    ? (zh ? "不可用" : "unavailable") : percent(context.benchmark_return);
  const lines = [zh
    ? `跨资产历史背景（${state}）：${window.start_session} 至 ${window.end_session}，美国交易时段标记，美元计价 ETF 代理；SPY 基准调整收益 ${benchmark}，${coverage.comparable} 项相对比较。预期交易日 ${window.expected_session}。这不是实时资金流、交易指令或预测。`
    : `Historical cross-asset context (${state}): ${window.start_session} to ${window.end_session}, US cash-session labels, USD-listed ETF proxies; SPY benchmark adjusted return ${benchmark}, ${coverage.comparable} relative comparisons. Expected session ${window.expected_session}. Not live fund flow, a trade instruction or a forecast.`];
  for (const r of context.rows) {
    if (r.comparison_status !== "OBSERVED" || r.absolute_return === null || r.relative_return === null) continue;
    const kind = r.classification === "RELATIVE_RESILIENCE_ONLY"
      ? (zh ? "仅相对抗跌，绝对收益未上涨" : "relative resilience only; not an absolute gain")
      : r.classification === "POSITIVE_AND_OUTPERFORMING"
        ? (zh ? "绝对上涨且相对占优" : "positive absolute return and relative outperformance")
        : r.classification === "UNDERPERFORMING"
          ? (zh ? "相对落后" : "relative underperformance")
          : (zh ? "相对持平" : "in line");
    lines.push(zh
      ? `${r.label_zh}（${r.instrument_id}）：美元调整收益 ${percent(r.absolute_return)}，相对 SPY 的财富比变化 ${percent(r.relative_return)}（${kind}）。`
      : `${r.label_en} (${r.instrument_id}): USD adjusted return ${percent(r.absolute_return)}, relative wealth vs SPY ${percent(r.relative_return)} (${kind}).`);
  }
  return lines;
}
