import type { Bar6 } from "./intradayShared";

// Descriptive evidence for the EXISTING bar assembly. Never a trading/research gate.
export type BarOrigin = "stored_5m" | "stored_1h" | "live_tail" | "unattributed";
export type StoreRead = {
  base: "5m" | "1h";
  status: "available" | "empty" | "missing" | "unreadable" | "malformed";
  content_sha256: string | null;
};
export type IntradayAssemblyTrace = {
  // Kept inside the existing cache, never serialized as another per-bar store.
  origins: Array<[number, BarOrigin]>;
  storeReads: StoreRead[];
};
export type EvidenceContext = {
  symbol: string;
  timeframe: string;
  extended: boolean;
  sessionDate: string;
  assembledAtMs: number;
  servedAtMs: number;
  cacheState: "new_assembly" | "cache" | "stale_cache";
};
const ORIGINS: BarOrigin[] = ["stored_5m", "stored_1h", "live_tail", "unattributed"];
const READ_STATES = ["available", "empty", "missing", "unreadable", "malformed"];
const iso = (ms: number): string | null => Number.isFinite(ms) && Math.abs(ms) <= 8.64e15
  ? new Date(ms).toISOString() : null;

/** Summarize ONLY the returned bars; store-read attempts describe the whole assembly. */
export function buildIntradaySourceEvidence(
  bars: readonly Bar6[], trace: IntradayAssemblyTrace | null, context: EvidenceContext,
) {
  const lookup = new Map<number, BarOrigin>();
  const conflicts = new Set<number>();
  for (const [epoch, origin] of trace?.origins ?? []) {
    if (!Number.isFinite(epoch) || !ORIGINS.includes(origin)) continue;
    if (lookup.has(epoch) && lookup.get(epoch) !== origin) conflicts.add(epoch);
    lookup.set(epoch, origin);
  }
  const counts: Record<BarOrigin, number> = { stored_5m: 0, stored_1h: 0, live_tail: 0, unattributed: 0 };
  for (const bar of bars) {
    const origin = conflicts.has(bar[0]) ? "unattributed" : lookup.get(bar[0]) ?? "unattributed";
    counts[origin]++;
  }
  const kinds = ORIGINS.filter(origin => counts[origin] > 0);
  const construction = !bars.length ? "empty" : kinds.length > 1 ? "mixed" : kinds[0];
  const warnings: string[] = [];
  if (counts.stored_1h > 0 && !context.extended) warnings.push("provider_hourly_open_alignment_not_guaranteed");
  if (counts.live_tail > 0) warnings.push("live_tail_construction_not_receipted");
  if (counts.unattributed > 0) warnings.push("returned_bar_origin_unknown");
  if (context.cacheState === "stale_cache") warnings.push("stale_cache_after_refresh_failure");
  const age = context.servedAtMs - context.assembledAtMs;
  if (!Number.isFinite(age) || age < 0) warnings.push("server_clock_interval_unavailable");
  const reads = (trace?.storeReads ?? []).slice(0, 2).map(read => ({
    base: read.base === "5m" || read.base === "1h" ? read.base : null,
    status: READ_STATES.includes(read.status) ? read.status : "unreadable",
    content_sha256: typeof read.content_sha256 === "string" && /^[a-f0-9]{64}$/.test(read.content_sha256)
      ? read.content_sha256 : null,
  }));
  return {
    schema: "terminal.intraday_source_evidence.v1",
    authority: "descriptive_only",
    symbol: context.symbol,
    requested_timeframe: context.timeframe,
    session: context.extended ? "extended" : "regular",
    timestamp_basis: "market_local_display_epoch",
    response_scope: {
      requested_date: context.sessionDate || null,
      returned_bars: bars.length,
      first_bar_time: bars.length ? bars[0][0] : null,
      last_bar_time: bars.length ? bars[bars.length - 1][0] : null,
    },
    construction, source_counts: counts,
    assembly_store_reads: reads,
    store_read_scope: "whole_assembly_not_requested_date",
    assembly_clock: { assembled_at: iso(context.assembledAtMs), served_at: iso(context.servedAtMs),
      cache_state: context.cacheState, cache_age_ms: Number.isFinite(age) && age >= 0 ? age : null,
      meaning: "server_assembly_not_market_data_freshness" },
    instrument_identity: "not_verified",
    price_adjustment: "not_verified", volume_adjustment: "not_verified",
    completeness: "not_assessed", point_in_time_availability: "not_verified",
    research_admission: "not_assessed", warnings,
  };
}
