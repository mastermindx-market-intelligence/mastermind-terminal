import type {
  TickerNewsFlow,
  TickerNewsFlowComparison,
  TickerNewsFlowProvenance,
  TickerNewsFlowReason,
  TickerNewsFlowState,
  TickerNewsSourceHealth,
  TickerNewsStoryRow,
} from "@/lib/newsTypes";

export class TickerNewsContractError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`ticker_news_contract:${code}`);
    this.name = "TickerNewsContractError";
    this.code = code;
  }
}

export function asRecord(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TickerNewsContractError(code);
  }
  return value as Record<string, unknown>;
}

export function asText(
  value: unknown,
  code: string,
  max = 8192,
  allowEmpty = false,
): string {
  if (typeof value !== "string") throw new TickerNewsContractError(code);
  const out = value.trim();
  if ((!allowEmpty && !out) || out.length > max || out.includes("\0")) {
    throw new TickerNewsContractError(code);
  }
  return out;
}

export function asNonNegativeInt(value: unknown, code: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new TickerNewsContractError(code);
  }
  return Number(value);
}

export function asPositiveInt(value: unknown, code: string): number {
  const out = asNonNegativeInt(value, code);
  if (out < 1) throw new TickerNewsContractError(code);
  return out;
}

export function asBoolean(value: unknown, code: string): boolean {
  if (typeof value !== "boolean") throw new TickerNewsContractError(code);
  return value;
}

export function asTimestamp(
  value: unknown,
  code: string,
  nullable = false,
): string | null {
  if (nullable && value === null) return null;
  const out = asText(value, code, 128);
  if (!Number.isFinite(Date.parse(out))) throw new TickerNewsContractError(code);
  return out;
}

export function asHttpUrl(value: unknown, code: string): string {
  const out = asText(value, code, 8192, true);
  if (!out) return "";
  let url: URL;
  try {
    url = new URL(out);
  } catch {
    throw new TickerNewsContractError(code);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TickerNewsContractError(code);
  }
  return out;
}

export function normalizeTickerNewsSymbol(raw: string): string {
  if (typeof raw !== "string") throw new TickerNewsContractError("symbol");
  const symbol = raw.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(symbol)) {
    throw new TickerNewsContractError("symbol");
  }
  return symbol;
}

export function asStoryId(value: unknown, code = "story_id"): string {
  const out = asText(value, code, 256);
  if (!/^ev2_[A-Za-z0-9._-]{1,240}$/.test(out)) {
    throw new TickerNewsContractError(code);
  }
  return out;
}

export function parseStoryRow(value: unknown): TickerNewsStoryRow {
  const obj = asRecord(value, "row");
  return {
    sequence: asPositiveInt(obj.sequence, "row_sequence"),
    source: asText(obj.source, "row_source", 128),
    source_item_id: asText(obj.source_item_id, "row_source_item_id", 256),
    story_id: asStoryId(obj.story_id, "row_story_id"),
    source_count: asNonNegativeInt(obj.source_count, "row_source_count"),
    item_count: asPositiveInt(obj.item_count, "row_item_count"),
    title: asText(obj.title, "row_title", 4096, true),
    url: asHttpUrl(obj.url, "row_url"),
    teaser: asText(obj.teaser, "row_teaser", 65536, true),
    published_at: asTimestamp(obj.published_at, "row_published_at", true),
    updated_at: asTimestamp(obj.updated_at, "row_updated_at", true),
    received_at: asTimestamp(obj.received_at, "row_received_at")!,
    universe_revision: asText(obj.universe_revision, "row_universe_revision", 1024),
  };
}

export function parseHealth(value: unknown): TickerNewsSourceHealth {
  const obj = asRecord(value, "source_health");
  return {
    state: asText(obj.state ?? "unavailable", "source_health_state", 64),
    last_successful_catchup:
      obj.last_successful_catchup == null
        ? null
        : asTimestamp(
            obj.last_successful_catchup,
            "source_health_last_successful_catchup",
          ),
  };
}

// ---- ticker_news.flow.v1 (Wave B terminal parser) -------------------------------
//
// Mirrors the frozen contract's validation rules with the two terminal differences
// it names: unknown EXTRA keys are ignored (forward compatibility), but all 13 keys
// must be present; and any failure returns the MALFORMED flow instead of throwing,
// so a broken flow can never take the rows down with it.

const FLOW_KEYS = [
  "schema",
  "state",
  "reason",
  "coverage",
  "as_of",
  "reports_24h",
  "reports_7d",
  "stories_24h",
  "median_daily_28d",
  "daily_counts_28d",
  "history_days_observed",
  "comparison",
  "provenance",
] as const;

const FLOW_STATES = new Set<TickerNewsFlowState>(["ok", "thin_history", "unavailable"]);
const FLOW_REASONS = new Set<TickerNewsFlowReason>(["no_accessible_sources", "calculation_failed"]);
const FLOW_COVERAGE = new Set<string>(["complete", "partial"]);
const FLOW_COMPARISONS = new Set<TickerNewsFlowComparison>(["busier", "typical", "quieter"]);
const AS_OF_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const DAILY_28D_KEYS = ["start_date", "end_date", "unit", "excludes", "order"] as const;

const malformedFlow = (): TickerNewsFlow => ({
  schema: "ticker_news.flow.v1",
  state: "unavailable",
  reason: "malformed",
  coverage: "complete",
  as_of: null,
  reports_24h: null,
  reports_7d: null,
  stories_24h: null,
  median_daily_28d: null,
  daily_counts_28d: null,
  history_days_observed: null,
  comparison: null,
  provenance: null,
});

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function parseFlowProvenance(value: unknown): TickerNewsFlowProvenance {
  const obj = asRecord(value, "flow_provenance");
  const sources = obj.sources_counted;
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new TickerNewsContractError("flow_provenance");
  }
  for (const source of sources) {
    if (typeof source !== "string" || !source.trim()) {
      throw new TickerNewsContractError("flow_provenance");
    }
  }
  const windows = asRecord(obj.windows, "flow_provenance");
  const daily28d = asRecord(windows.daily_28d, "flow_provenance");
  for (const key of DAILY_28D_KEYS) {
    asText(daily28d[key], "flow_provenance", 256);
  }
  asText(windows.reports_24h, "flow_provenance", 256);
  asText(windows.reports_7d, "flow_provenance", 256);
  const calculation = asRecord(obj.calculation, "flow_provenance");
  asText(calculation.method, "flow_provenance", 1024);
  asText(calculation.comparison_rule, "flow_provenance", 128);
  asText(obj.velocity_schema, "flow_provenance", 128);
  asText(obj.status_counted, "flow_provenance", 64);
  asText(obj.distinct_by, "flow_provenance", 256);
  asText(obj.story_grouping, "flow_provenance", 1024);
  asText(obj.cluster_policy_version, "flow_provenance", 128);
  const basis = asRecord(obj.time_basis_counts_24h, "flow_provenance");
  const publishedAt = basis.published_at;
  const receivedAt = basis.received_at;
  if (!isCount(publishedAt) || !isCount(receivedAt)) {
    throw new TickerNewsContractError("flow_provenance");
  }
  return {
    velocity_schema: obj.velocity_schema as string,
    sources_counted: sources as string[],
    status_counted: obj.status_counted as string,
    distinct_by: obj.distinct_by as string,
    story_grouping: obj.story_grouping as string,
    cluster_policy_version: obj.cluster_policy_version as string,
    windows: {
      reports_24h: windows.reports_24h as string,
      reports_7d: windows.reports_7d as string,
      daily_28d: {
        start_date: daily28d.start_date as string,
        end_date: daily28d.end_date as string,
        unit: daily28d.unit as string,
        excludes: daily28d.excludes as string,
        order: daily28d.order as string,
      },
    },
    calculation: {
      method: calculation.method as string,
      comparison_rule: calculation.comparison_rule as string,
    },
    time_basis_counts_24h: { published_at: publishedAt, received_at: receivedAt },
  };
}

function parseFlowOrThrow(value: unknown): TickerNewsFlow {
  const obj = asRecord(value, "flow");
  // Unknown extra keys are ignored; all 13 contract keys must be present.
  for (const key of FLOW_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      throw new TickerNewsContractError("flow_key:" + key);
    }
  }
  if (obj.schema !== "ticker_news.flow.v1") throw new TickerNewsContractError("flow_schema");
  const state = obj.state as TickerNewsFlowState;
  if (!FLOW_STATES.has(state)) throw new TickerNewsContractError("flow_state");
  const reason = obj.reason as TickerNewsFlowReason | null;
  if (reason !== null && !FLOW_REASONS.has(reason)) {
    throw new TickerNewsContractError("flow_reason");
  }
  if (typeof obj.coverage !== "string" || !FLOW_COVERAGE.has(obj.coverage)) {
    throw new TickerNewsContractError("flow_coverage");
  }

  const coverage = obj.coverage as "complete" | "partial";

  if (state === "unavailable") {
    if (reason === null) throw new TickerNewsContractError("flow_reason");
    if (coverage !== "complete") throw new TickerNewsContractError("flow_coverage");
    for (const key of FLOW_KEYS) {
      if (key === "schema" || key === "state" || key === "reason" || key === "coverage") continue;
      if (obj[key] !== null) throw new TickerNewsContractError("flow_unavailable");
    }
    return {
      schema: "ticker_news.flow.v1",
      state,
      reason,
      coverage,
      as_of: null,
      reports_24h: null,
      reports_7d: null,
      stories_24h: null,
      median_daily_28d: null,
      daily_counts_28d: null,
      history_days_observed: null,
      comparison: null,
      provenance: null,
    };
  }

  if (reason !== null) throw new TickerNewsContractError("flow_reason");
  if (typeof obj.as_of !== "string" || !AS_OF_RE.test(obj.as_of)) {
    throw new TickerNewsContractError("flow_as_of");
  }
  const reports24 = obj.reports_24h;
  const reports7 = obj.reports_7d;
  const stories24 = obj.stories_24h;
  if (!isCount(reports24) || !isCount(reports7) || !isCount(stories24)) {
    throw new TickerNewsContractError("flow_counts");
  }
  if (!(stories24 <= reports24 && reports24 <= reports7)) {
    throw new TickerNewsContractError("flow_invariant");
  }
  if (!Array.isArray(obj.daily_counts_28d) || obj.daily_counts_28d.length !== 28) {
    throw new TickerNewsContractError("flow_daily");
  }
  for (const day of obj.daily_counts_28d) {
    if (!isCount(day)) throw new TickerNewsContractError("flow_daily");
  }
  const history = obj.history_days_observed;
  if (!isCount(history) || history > 28) throw new TickerNewsContractError("flow_history");
  const provenance = parseFlowProvenance(obj.provenance);
  if (provenance.time_basis_counts_24h.published_at + provenance.time_basis_counts_24h.received_at !== reports24) {
    throw new TickerNewsContractError("flow_time_basis");
  }

  if (state === "ok") {
    if (history < 20) throw new TickerNewsContractError("flow_history");
    const median = obj.median_daily_28d;
    if (typeof median !== "number" || !Number.isFinite(median) || median < 0) {
      throw new TickerNewsContractError("flow_median");
    }
    const comparison = obj.comparison as TickerNewsFlowComparison | null;
    if (coverage === "partial") {
      if (comparison !== null) throw new TickerNewsContractError("flow_comparison");
    } else if (!FLOW_COMPARISONS.has(comparison as TickerNewsFlowComparison)) {
      throw new TickerNewsContractError("flow_comparison");
    }
    return {
      schema: "ticker_news.flow.v1",
      state,
      reason: null,
      coverage,
      as_of: obj.as_of,
      reports_24h: reports24,
      reports_7d: reports7,
      stories_24h: stories24,
      median_daily_28d: median,
      daily_counts_28d: obj.daily_counts_28d as number[],
      history_days_observed: history,
      comparison,
      provenance,
    };
  }

  // thin_history
  if (history > 19) throw new TickerNewsContractError("flow_history");
  if (obj.median_daily_28d !== null) throw new TickerNewsContractError("flow_median");
  const comparison = obj.comparison;
  if (coverage === "partial") {
    if (comparison !== null) throw new TickerNewsContractError("flow_comparison");
  } else if (comparison !== "insufficient_history") {
    throw new TickerNewsContractError("flow_comparison");
  }
  return {
    schema: "ticker_news.flow.v1",
    state,
    reason: null,
    coverage,
    as_of: obj.as_of,
    reports_24h: reports24,
    reports_7d: reports7,
    stories_24h: stories24,
    median_daily_28d: null,
    daily_counts_28d: obj.daily_counts_28d as number[],
    history_days_observed: history,
    comparison,
    provenance,
  };
}

/**
 * Parse one ticker_news.flow.v1 object. NEVER throws: any type error, out-of-range
 * number, unknown enum, wrong schema string, missing key or broken invariant gives
 * the terminal-only MALFORMED flow (state unavailable, all counts null).
 */
export function parseTickerNewsFlow(value: unknown): TickerNewsFlow {
  try {
    return parseFlowOrThrow(value);
  } catch {
    return malformedFlow();
  }
}