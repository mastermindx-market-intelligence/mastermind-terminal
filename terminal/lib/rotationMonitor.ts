/**
 * Descriptive, stateless measurement for the incumbent RS × 30m workspace.
 * Quote event clocks are UTC milliseconds. Bar clocks are ET display-epoch seconds.
 * Neither server receipt time nor nominal bar completeness establishes PIT availability.
 * No ranking, signal, probability, event store, regime verdict or trading authority.
 */
import { sectorRegularReading, sectorRegularSession } from "./sectorRegularReading";
import { liveDisplayEpoch } from "./liveCandle";
import type { Bar6 } from "./intradayShared";

export const ROTATION_SYMBOLS = ["XLC", "XLY", "XLP", "XLE", "XLF", "XLV", "XLI", "XLB", "XLRE", "XLK", "XLU"] as const;
export const ROTATION_BENCHMARK = "SPY" as const;
export const ROTATION_MAX_BAR_AGE_SECONDS = 20 * 60;
export type RotationReason = "unavailable" | "missing_benchmark" | "untimed" | "misaligned"
  | "mixed_freshness" | "invalid_clock" | "invalid_series" | "unknown_basis" | "missing_interval" | "source_stale";
export type RotationQuote = {
  kind: "live" | "delayed" | "untimed" | "close" | "unavailable";
  sincePreviousClosePct: number | null;
  relativePct: number | null;
  observedAtMs: number | null;
  ageMs: number | null;
  benchmarkObservedAtMs: number | null;
  skewMs: number | null;
  reason: RotationReason | null;
};
export type RotationWindow = {
  state: "measured" | "unavailable";
  authority: "descriptive_bar_geometry";
  horizonMinutes: 5 | 30;
  absolutePct: number | null;
  benchmarkPct: number | null;
  relativePct: number | null;
  fromDisplayEpoch: number | null;
  toDisplayEpoch: number | null;
  endpointAgeSeconds: number | null;
  expectedSlots: number;
  matchedSlots: number;
  reason: RotationReason | null;
};
export type RotationMonitorReport = {
  schema: "terminal.rotation_monitor.v1";
  authority: "descriptive_only";
  benchmark: typeof ROTATION_BENCHMARK;
  sessionDate: string | null;
  sessionOpen: boolean | null;
  barEndpointDisplayEpoch: number | null;
  barEndpointAgeSeconds: number | null;
  quoteCoverage: { expected: number; absolute: number; relative: number };
  rows: Array<{ symbol: string; quote: RotationQuote; windows: { 5: RotationWindow; 30: RotationWindow } }>;
};
type Session = NonNullable<ReturnType<typeof sectorRegularSession>>;
type Reading = NonNullable<ReturnType<typeof sectorRegularReading>>;
type Leg = { reading: Reading | null; reason: RotationReason | null };
type Series = { bars: Map<number, Bar6>; reason: RotationReason | null };
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const emptyQuote = (reason: RotationReason): RotationQuote => ({
  kind: "unavailable", sincePreviousClosePct: null, relativePct: null, observedAtMs: null,
  ageMs: null, benchmarkObservedAtMs: null, skewMs: null, reason,
});

function quoteLeg(raw: unknown, session: Session, nowMs: number): Leg {
  const q = object(raw);
  if (!q) return { reading: null, reason: "unavailable" };
  if (typeof q.source !== "string" || !["polygon-live", "polygon-delayed", "polygon-live-second", "polygon-snapshot", "polygon-snapshot-rt"].includes(q.source))
    return { reading: null, reason: "unknown_basis" };
  if (session.open) {
    const stamped = q.asOfMs !== undefined && q.asOfMs !== null;
    const aggregate = q.source === "polygon-live" || q.source === "polygon-delayed";
    const observed = stamped ? q.asOfMs : aggregate && finite(q.ts) ? q.ts * 1000 : null;
    // An invalid explicit event clock must not fall through to a refresh clock.
    if ((stamped && !finite(observed)) || (finite(observed) && (observed <= 0 || observed > nowMs)))
      return { reading: null, reason: "invalid_clock" };
  }
  const reading = sectorRegularReading(raw, session, nowMs);
  if (!reading || reading.value <= -100) return { reading: null, reason: "unavailable" };
  // Public regularChg belongs to the same regular price/reference pair. Permit at most
  // one hundredth of a percentage point of upstream rounding, not a different anchor.
  const price = session.open ? q.regularPrice : q.close;
  if (!finite(price) || price <= 0 || !finite(q.prevClose) || q.prevClose <= 0
    || Math.abs(100 * (price / q.prevClose - 1) - reading.value) > 0.01)
    return { reading: null, reason: "unavailable" };
  return { reading, reason: reading.kind === "untimed" ? "untimed" : null };
}

function compareQuote(leg: Leg, benchmark: Leg, nowMs: number): RotationQuote {
  const s = leg.reading, b = benchmark.reading;
  if (!s) return emptyQuote(leg.reason ?? "unavailable");
  const out: RotationQuote = {
    kind: s.kind, sincePreviousClosePct: s.value, relativePct: null,
    observedAtMs: s.observed, ageMs: s.observed === null ? null : nowMs - s.observed,
    benchmarkObservedAtMs: b?.observed ?? null, skewMs: null, reason: null,
  };
  if (!b) return { ...out, reason: "missing_benchmark" };
  if (s.kind === "untimed" || b.kind === "untimed") return { ...out, reason: "untimed" };
  if (s.kind !== b.kind) return { ...out, reason: "mixed_freshness" };
  if (s.kind !== "close") {
    if (s.observed === null || b.observed === null) return { ...out, reason: "untimed" };
    out.skewMs = Math.abs(s.observed - b.observed);
    if (out.skewMs > (s.kind === "live" ? 15_000 : 60_000))
      return { ...out, reason: "misaligned" };
  }
  const relative = 100 * ((1 + s.value / 100) / (1 + b.value / 100) - 1);
  return Number.isFinite(relative) ? { ...out, relativePct: relative }
    : { ...out, reason: "unavailable" };
}

function readSeries(raw: unknown, symbol: string, session: Session, cutoff: number): Series {
  const bad = (reason: RotationReason): Series => ({ bars: new Map(), reason });
  const input = object(raw), evidence = object(input?.source_evidence);
  if (!input) return bad(symbol === ROTATION_BENCHMARK ? "missing_benchmark" : "unavailable");
  if (!evidence || evidence.schema !== "terminal.intraday_source_evidence.v1"
    || evidence.symbol !== symbol || evidence.requested_timeframe !== "5m" || evidence.session !== "regular"
    || evidence.timestamp_basis !== "market_local_display_epoch") return bad("unknown_basis");
  if (object(evidence.assembly_clock)?.cache_state === "stale_cache") return bad("source_stale");
  if (!Array.isArray(input.bars) || input.bars.length > 2_000) return bad("invalid_series");
  const bars = new Map<number, Bar6>();
  let previous = -Infinity;
  for (const row of input.bars) {
    if (!Array.isArray(row) || !Number.isSafeInteger(row[0]) || row[0] <= 0) return bad("invalid_series");
    const t = row[0] as number;
    // Only geometry that is already completed in this session can influence the read.
    // Do not inspect a forming/future candle's prices, or bridge a previous session.
    if (t < session.start || t >= session.end || t + 300 > cutoff) continue;
    if (t <= previous || (t - session.start) % 300 !== 0) return bad("invalid_series");
    previous = t;
    if (row.length !== 6 || !row.every(finite)) return bad("invalid_series");
    const [, o, h, l, c, v] = row;
    if (o <= 0 || c <= 0 || l <= 0 || v < 0 || h < Math.max(o, l, c) || l > Math.min(o, h, c))
      return bad("invalid_series");
    bars.set(t, row as Bar6);
  }
  return { bars, reason: null };
}

function windowRead(
  horizon: 5 | 30, symbol: Series, benchmark: Series, endpoint: number | null,
  session: Session | null, displayNow: number | null, fallback: RotationReason | null,
): RotationWindow {
  const expectedSlots = horizon / 5 + 1;
  const from = endpoint === null ? null : endpoint - horizon * 60;
  const age = endpoint !== null && session?.open && displayNow !== null ? displayNow - endpoint : null;
  const out: RotationWindow = {
    state: "unavailable", authority: "descriptive_bar_geometry", horizonMinutes: horizon,
    absolutePct: null, benchmarkPct: null, relativePct: null,
    fromDisplayEpoch: from, toDisplayEpoch: endpoint, endpointAgeSeconds: age,
    expectedSlots, matchedSlots: 0, reason: fallback,
  };
  if (fallback) return out;
  if (benchmark.reason) return { ...out, reason: benchmark.reason };
  if (!session || endpoint === null || from === null) return { ...out, reason: "missing_interval" };
  if (symbol.reason) return { ...out, reason: symbol.reason };
  if ((session.open && (age === null || age < 0 || age > ROTATION_MAX_BAR_AGE_SECONDS))
    || (!session.open && endpoint !== session.end)) return { ...out, reason: "source_stale" };
  const times = Array.from({ length: expectedSlots }, (_, i) => from - 300 + i * 300);
  const matchedSlots = times.filter(t => symbol.bars.has(t) && benchmark.bars.has(t)).length;
  if (times[0] < session.start || matchedSlots !== expectedSlots)
    return { ...out, matchedSlots, reason: "missing_interval" };
  const s0 = symbol.bars.get(times[0])![4], s1 = symbol.bars.get(times[times.length - 1])![4];
  const b0 = benchmark.bars.get(times[0])![4], b1 = benchmark.bars.get(times[times.length - 1])![4];
  const sRatio = s1 / s0, bRatio = b1 / b0;
  const absolutePct = 100 * (sRatio - 1), benchmarkPct = 100 * (bRatio - 1);
  const relativePct = 100 * (sRatio / bRatio - 1);
  if (sRatio <= 0 || bRatio <= 0 || ![absolutePct, benchmarkPct, relativePct].every(Number.isFinite))
    return { ...out, matchedSlots, reason: "invalid_series" };
  return { ...out, state: "measured", absolutePct, benchmarkPct, relativePct, matchedSlots, reason: null };
}

/**
 * A single benchmark endpoint fixes the comparison interval for the whole population.
 * A missing sector stays in its original row; no per-row endpoint backtracking or filling.
 */
export function buildRotationMonitor(
  quotes: Record<string, unknown>, histories: Record<string, unknown>, nowMs: number,
): RotationMonitorReport {
  let session: Session | null = null, displayNow: number | null = null;
  if (finite(nowMs) && nowMs > 0) {
    try { session = sectorRegularSession(nowMs); displayNow = liveDisplayEpoch(nowMs, "us"); }
    catch { /* Calendar/clock authority did not admit a session. */ }
  }
  const validClock = session !== null && finite(displayNow);
  const fallback: RotationReason | null = validClock ? null : "invalid_clock";
  const q = object(quotes) ?? {}, h = object(histories) ?? {};
  const unavailable: Leg = { reading: null, reason: "invalid_clock" };
  const benchmarkQuote = validClock ? quoteLeg(q[ROTATION_BENCHMARK], session!, nowMs) : unavailable;
  const missing: Series = { bars: new Map(), reason: fallback };
  const benchmark = validClock ? readSeries(h[ROTATION_BENCHMARK], ROTATION_BENCHMARK, session!,
    Math.min(displayNow!, session!.end)) : missing;
  const endpoint = benchmark.bars.size ? Math.max(...benchmark.bars.keys()) + 300 : null;
  const rows = ROTATION_SYMBOLS.map(symbol => {
    const quote = compareQuote(validClock ? quoteLeg(q[symbol], session!, nowMs) : unavailable, benchmarkQuote, nowMs);
    const series = validClock ? readSeries(h[symbol], symbol, session!, Math.min(displayNow!, session!.end)) : missing;
    return { symbol, quote, windows: {
      5: windowRead(5, series, benchmark, endpoint, session, displayNow, fallback),
      30: windowRead(30, series, benchmark, endpoint, session, displayNow, fallback),
    } };
  });
  return {
    schema: "terminal.rotation_monitor.v1", authority: "descriptive_only", benchmark: ROTATION_BENCHMARK,
    sessionDate: session?.date ?? null, sessionOpen: session?.open ?? null,
    barEndpointDisplayEpoch: endpoint,
    barEndpointAgeSeconds: endpoint !== null && session?.open && displayNow !== null ? displayNow - endpoint : null,
    quoteCoverage: { expected: ROTATION_SYMBOLS.length, absolute: rows.filter(r => r.quote.sincePreviousClosePct !== null).length,
      relative: rows.filter(r => r.quote.relativePct !== null).length },
    rows,
  };
}
