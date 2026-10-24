/** Decode the prospective producer population, never the filtered Tape feed. */
export const OBSERVED_STATISTICS_MAX_AGE_MS = 120_000;
const LOCATIONS = ["below_bid", "at_bid", "inside_below_mid", "at_mid", "inside_above_mid", "at_ask", "above_ask", "UNKNOWN"] as const;
const COUNTERS = ["input_row_count", "rejected_row_count", "duplicate_row_count", "conflicting_identity_count", "ambiguous_row_count", "source_input_row_count", "source_rejected_row_count", "source_non_novel_row_count"] as const;
type RecordValue = Record<string, unknown>;
export type ObservedBucket = {
  print_count: number; contract_volume: number; premium_qualified_print_count: number;
  premium_print_coverage: number | null; qualified_premium_usd: number | null;
  premium_total_status: "UNAVAILABLE" | "UNREPRESENTABLE" | "QUALIFIED_SUBTOTAL";
};
type RootStatus = "OBSERVED" | "OBSERVED_EMPTY" | "NO_VALID_SOURCE_ROWS" | "NO_NEW_VALID_ROWS" | "NO_UNAMBIGUOUS_VALID_ROWS";
export type ObservedStatistics = {
  state: "available"; root: string; sessionDate: string; status: RootStatus; stale: boolean;
  firstObservedAt: string; lastObservedAt: string; firstTradeAt: string | null; lastTradeAt: string | null;
  population: "prospective_observed_source_valid_novel_prints";
  coverage: "caller_selected_roots_not_whole_market_or_whole_session";
  continuity: "observed_poll_batches_continuous_session_coverage_not_established";
  sourceCounterBasis: "received_rows_across_poll_batches_including_repeated_observations";
  counters: Record<typeof COUNTERS[number], number>; totals: ObservedBucket;
  rights: Record<string, ObservedBucket>; locations: Record<string, ObservedBucket>; venues: Record<string, ObservedBucket>;
  nbboPrintCoverage: number | null; venuePrintCoverage: number | null;
};
export type ObservedStatisticsResult = ObservedStatistics | { state: "unavailable"; reason: "publisher_absent" | "publisher_unavailable" | "root_unobserved" } | { state: "invalid"; reason: "invalid_snapshot" };
function object(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object");
  return value as RecordValue;
}
function own(value: RecordValue, key: string): unknown { return Object.hasOwn(value, key) ? value[key] : undefined; }
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("integer");
  return value;
}
function sum(values: number[]): number { return integer(values.reduce((a, b) => a + b, 0)); }
function clock(value: unknown): { text: string; ms: number } {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error("clock");
  const day = value.slice(0, 10);
  date(day);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) throw new Error("clock");
  return { text: value, ms };
}
function date(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("date");
  return value;
}
function ratio(value: unknown, numerator: number, denominator: number): number | null {
  if (!denominator) { if (value !== null) throw new Error("empty ratio"); return null; }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1 || Math.abs(value - numerator / denominator) > 1e-12) throw new Error("ratio");
  return value;
}
function bucket(raw: unknown): ObservedBucket {
  const b = object(raw), count = integer(own(b, "print_count")), volume = integer(own(b, "contract_volume")), qualified = integer(own(b, "premium_qualified_print_count"));
  if (qualified > count || volume < count || (!count && volume)) throw new Error("bucket");
  const coverage = ratio(own(b, "premium_print_coverage"), qualified, count), premium = own(b, "qualified_premium_usd"), status = own(b, "premium_total_status");
  if (!qualified) { if (status !== "UNAVAILABLE" || premium !== null) throw new Error("premium unavailable"); }
  else if (status === "UNREPRESENTABLE") { if (premium !== null) throw new Error("premium overflow"); }
  else if (status !== "QUALIFIED_SUBTOTAL" || typeof premium !== "number" || !Number.isFinite(premium) || premium <= 0) throw new Error("premium");
  return { print_count: count, contract_volume: volume, premium_qualified_print_count: qualified, premium_print_coverage: coverage, qualified_premium_usd: premium as number | null, premium_total_status: status as ObservedBucket["premium_total_status"] };
}
function partition(raw: unknown, total: ObservedBucket, keys?: readonly string[]): Record<string, ObservedBucket> {
  const values = object(raw), names = Object.keys(values);
  if (keys && (names.length !== keys.length || keys.some(k => !Object.hasOwn(values, k)))) throw new Error("partition keys");
  if (!keys && names.some(k => k !== "UNKNOWN" && !/^int:\d+$/.test(k) && !(k.startsWith("str:") && k.length > 4 && k.length <= 132 && k.slice(4).trim() === k.slice(4)))) throw new Error("venue");
  const out = Object.fromEntries(names.map(k => [k, bucket(own(values, k))]));
  for (const key of ["print_count", "contract_volume", "premium_qualified_print_count"] as const) {
    if (sum(Object.values(out).map(b => b[key])) !== total[key]) throw new Error("partition counts");
  }
  // JSON premium amounts are floating subtotals. Count partitions are exact;
  // overflowing qualified subtotals remain explicit unknown, never zero.
  const parts = Object.values(out);
  if (total.premium_total_status !== "UNREPRESENTABLE") {
    if (parts.some(b => b.premium_total_status === "UNREPRESENTABLE")) throw new Error("partition premium overflow");
    const amount = parts.reduce((a, b) => a + (b.qualified_premium_usd ?? 0), 0), expected = total.qualified_premium_usd ?? 0;
    if (!Number.isFinite(amount) || Math.abs(amount - expected) > Math.max(Number.MIN_VALUE, Math.abs(expected) * 1e-12)) throw new Error("partition premium");
  }
  return out;
}
export function decodeObservedStatistics(meta: unknown, selectedRoot: string, nowMs: number): ObservedStatisticsResult {
  try {
    if (meta == null) return { state: "unavailable", reason: "publisher_absent" };
    const envelope = object(meta), raw = own(envelope, "observed_statistics");
    if (raw === undefined) return { state: "unavailable", reason: "publisher_absent" };
    const snapshot = object(raw);
    if (own(snapshot, "schema") !== "options.observed_statistics_snapshot/v1") throw new Error("schema");
    if (own(snapshot, "status") === "UNAVAILABLE" && own(snapshot, "roots") === null) return { state: "unavailable", reason: "publisher_unavailable" };
    if (own(snapshot, "status") !== "OBSERVED" || own(snapshot, "population") !== "prospective_observed_source_valid_novel_prints" || own(snapshot, "coverage") !== "caller_selected_roots_not_whole_market_or_whole_session" || own(snapshot, "continuity") !== "observed_poll_batches_continuous_session_coverage_not_established" || own(snapshot, "source_counter_basis") !== "received_rows_across_poll_batches_including_repeated_observations") throw new Error("population");
    const sessionDate = date(own(snapshot, "session_date")), start = clock(own(snapshot, "first_observed_at")), end = clock(own(snapshot, "last_observed_at")), roots = object(own(snapshot, "roots"));
    if (!Number.isFinite(nowMs) || start.ms > end.ms || end.ms > nowMs + 60_000 || !Object.keys(roots).length || !/^[A-Z0-9.^=-]+$/.test(selectedRoot)) throw new Error("coverage");
    if (!Object.hasOwn(roots, selectedRoot)) return { state: "unavailable", reason: "root_unobserved" };
    const r = object(own(roots, selectedRoot)), first = clock(own(r, "first_observed_at")), last = clock(own(r, "last_observed_at"));
    if (first.ms < start.ms || first.ms > last.ms || last.ms > end.ms) throw new Error("root coverage");
    const counters = Object.fromEntries(COUNTERS.map(k => [k, integer(own(r, k))])) as ObservedStatistics["counters"];
    const totals = bucket(own(r, "totals")), count = totals.print_count;
    if (counters.input_row_count !== sum([count, counters.rejected_row_count, counters.duplicate_row_count, counters.ambiguous_row_count]) || counters.source_input_row_count !== sum([counters.input_row_count, counters.source_rejected_row_count, counters.source_non_novel_row_count]) || counters.ambiguous_row_count < 2 * counters.conflicting_identity_count) throw new Error("source counts");
    const firstTrade = count ? clock(own(r, "first_trade_at")) : null, lastTrade = count ? clock(own(r, "last_trade_at")) : null;
    if (firstTrade && lastTrade ? firstTrade.ms > lastTrade.ms || lastTrade.ms > last.ms : own(r, "first_trade_at") !== null || own(r, "last_trade_at") !== null) throw new Error("trade clocks");
    const status: RootStatus = count ? "OBSERVED" : !counters.source_input_row_count ? "OBSERVED_EMPTY" : counters.source_rejected_row_count === counters.source_input_row_count ? "NO_VALID_SOURCE_ROWS" : !counters.input_row_count ? "NO_NEW_VALID_ROWS" : "NO_UNAMBIGUOUS_VALID_ROWS";
    if (own(r, "status") !== status) throw new Error("status");
    const rights = partition(own(r, "rights"), totals, ["C", "P"]), locations = partition(own(r, "locations"), totals, LOCATIONS), venues = partition(own(r, "venues"), totals);
    return { state: "available", root: selectedRoot, sessionDate, status, stale: nowMs - last.ms > OBSERVED_STATISTICS_MAX_AGE_MS, firstObservedAt: first.text, lastObservedAt: last.text, firstTradeAt: firstTrade?.text ?? null, lastTradeAt: lastTrade?.text ?? null,
      population: "prospective_observed_source_valid_novel_prints", coverage: "caller_selected_roots_not_whole_market_or_whole_session", continuity: "observed_poll_batches_continuous_session_coverage_not_established", sourceCounterBasis: "received_rows_across_poll_batches_including_repeated_observations", counters, totals, rights, locations, venues,
      nbboPrintCoverage: ratio(own(r, "nbbo_print_coverage"), count - locations.UNKNOWN.print_count, count), venuePrintCoverage: ratio(own(r, "venue_print_coverage"), count - (venues.UNKNOWN?.print_count ?? 0), count) };
  } catch { return { state: "invalid", reason: "invalid_snapshot" }; }
}
