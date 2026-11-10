import { describe, expect, it } from "vitest";
import { buildRotationMonitor, ROTATION_SYMBOLS } from "@/lib/rotationMonitor";
import type { Bar6 } from "@/lib/intradayShared";

const NOW = Date.parse("2026-10-27T15:00:02Z");
const START = Date.parse("2026-10-27T09:30:00Z") / 1000; // ET display epoch, deliberately not UTC.
function quote(value = 2, patch: Record<string, unknown> = {}) {
  return { market: "us", regularSessionDate: "2026-10-27", regularSession: "rth", marketSession: "rth",
    regularPrice: 100 * (1 + value / 100), prevClose: 100, regularChg: value,
    source: "polygon-snapshot-rt", anchor_source: "snapshot", basis: "REALTIME", asOfMs: NOW - 2_000, ...patch };
}
function history(symbol: string, step = .2, n = 18, start = START) {
  const bars: Bar6[] = Array.from({ length: n }, (_, i) => {
    const p = 100 + i * step;
    return [start + i * 300, p, p + .1, p - .1, p, 1000];
  });
  return { bars, source_evidence: { schema: "terminal.intraday_source_evidence.v1", symbol,
    requested_timeframe: "5m", session: "regular", timestamp_basis: "market_local_display_epoch",
    assembly_clock: { cache_state: "new_assembly" }, point_in_time_availability: "not_verified" } };
}
function quotes(): Record<string, ReturnType<typeof quote>> { return { SPY: quote(1), ...Object.fromEntries(ROTATION_SYMBOLS.map(s => [s, quote()])) }; }
function histories(n = 18): Record<string, ReturnType<typeof history>> {
  return { SPY: history("SPY", .05, n), ...Object.fromEntries(ROTATION_SYMBOLS.map(s => [s, history(s, .2, n)])) };
}
const row = (report: ReturnType<typeof buildRotationMonitor>, symbol = "XLK") => report.rows.find(r => r.symbol === symbol)!;

describe("rotation quote qualification", () => {
  it("reports true relative wealth and preserves the fixed eleven-sector population", () => {
    const report = buildRotationMonitor(quotes(), {}, NOW), q = row(report).quote;
    expect(q.kind).toBe("live"); expect(q.sincePreviousClosePct).toBe(2);
    expect(q.relativePct).toBeCloseTo(100 * (1.02 / 1.01 - 1), 10);
    expect(q.relativePct).not.toBeCloseTo(1, 5);
    expect(q.ageMs).toBe(2000); expect(q.skewMs).toBe(0);
    expect(report.quoteCoverage).toEqual({ expected: 11, absolute: 11, relative: 11 });
    expect(report.rows.map(r => r.symbol)).toEqual([...ROTATION_SYMBOLS]);
  });
  it("does not turn a freshly received delayed quote into a live print", () => {
    const q = Object.fromEntries(["SPY", ...ROTATION_SYMBOLS].map(s => [s,
      quote(1, { basis: "DELAYED_15M", source: "polygon-snapshot", asOfMs: NOW - 900_000 })]));
    const out = row(buildRotationMonitor(q, {}, NOW)).quote;
    expect(out.kind).toBe("delayed"); expect(out.ageMs).toBe(900_000); expect(out.relativePct).toBe(0);
  });
  it("does not use a snapshot refresh timestamp as a price-event clock", () => {
    const q = quotes(); q.XLK = quote(2, { asOfMs: undefined, ts: NOW / 1000,
      basis: "DELAYED_15M", source: "polygon-snapshot" });
    const out = row(buildRotationMonitor(q, {}, NOW)).quote;
    expect(out.kind).toBe("untimed"); expect(out.sincePreviousClosePct).toBe(2);
    expect(out.observedAtMs).toBeNull(); expect(out.relativePct).toBeNull(); expect(out.reason).toBe("untimed");
  });
  it("uses only the incumbent AM event timestamp fallback", () => {
    const q = quotes(); q.XLK = quote(2, { asOfMs: undefined, ts: (NOW - 3000) / 1000, source: "polygon-live" });
    expect(row(buildRotationMonitor(q, {}, NOW)).quote.observedAtMs).toBe(NOW - 3000);
    q.XLK = quote(2, { asOfMs: undefined, ts: NOW / 1000, source: "unknown" });
    expect(row(buildRotationMonitor(q, {}, NOW)).quote.relativePct).toBeNull();
  });
  it.each([NaN, Infinity, NOW + 1])("rejects an invalid explicit event clock (%s) without a fallback", stamp => {
    const q = quotes(); q.XLK = quote(2, { asOfMs: stamp, source: "polygon-live", ts: (NOW - 1000) / 1000 });
    expect(row(buildRotationMonitor(q, {}, NOW)).quote.reason).toBe("invalid_clock");
  });
  it("an unfamiliar source cannot establish price freshness with a plausible timestamp", () => {
    const q = quotes(); q.XLK = quote(2, { source: "unknown", asOfMs: NOW - 1000 });
    expect(row(buildRotationMonitor(q, {}, NOW)).quote.reason).toBe("unknown_basis");
  });
  it("missing SPY withholds relative returns while preserving admitted absolute observations", () => {
    const q = quotes(); delete (q as Record<string, unknown>).SPY;
    const report = buildRotationMonitor(q, {}, NOW);
    expect(row(report).quote.sincePreviousClosePct).toBe(2);
    expect(row(report).quote.relativePct).toBeNull(); expect(row(report).quote.reason).toBe("missing_benchmark");
    expect(report.quoteCoverage).toEqual({ expected: 11, absolute: 11, relative: 0 });
  });
  it("a missing sector never becomes zero and never shrinks the coverage denominator", () => {
    const q = quotes(); delete q.XLU;
    const report = buildRotationMonitor(q, {}, NOW);
    expect(report.rows).toHaveLength(11); expect(row(report, "XLU").quote.relativePct).toBeNull();
    expect(report.quoteCoverage).toEqual({ expected: 11, absolute: 10, relative: 10 });
  });
  it("withholds a live/delayed pair and excessive skew between delayed observations", () => {
    const q = quotes(); q.XLK = quote(2, { asOfMs: NOW - 30_000 });
    expect(row(buildRotationMonitor(q, {}, NOW)).quote.reason).toBe("mixed_freshness");
    q.SPY = quote(1, { asOfMs: NOW - 100_001 });
    const out = row(buildRotationMonitor(q, {}, NOW)).quote;
    expect(out.reason).toBe("misaligned"); expect(out.skewMs).toBe(70_001);
  });
  it("withdraws expired or incoherent quote values rather than treating them as leaders", () => {
    const q = quotes(); q.XLK = quote(2, { asOfMs: NOW - 1_200_001 });
    expect(row(buildRotationMonitor(q, {}, NOW)).quote.sincePreviousClosePct).toBeNull();
    q.XLK = quote(2, { regularPrice: 115 });
    expect(row(buildRotationMonitor(q, {}, NOW)).quote.relativePct).toBeNull();
    q.XLK = quote(2, { stale_anchor: true });
    expect(row(buildRotationMonitor(q, {}, NOW)).quote.relativePct).toBeNull();
  });
  it("keeps official completed-session comparisons separate from event-age claims", () => {
    const afterClose = Date.parse("2026-10-27T20:05:00Z");
    const q = quotes();
    for (const symbol of ["SPY", ...ROTATION_SYMBOLS]) {
      const pct = symbol === "SPY" ? 1 : 2;
      (q as Record<string, unknown>)[symbol] = quote(pct, { close: 100 + pct, marketSession: "post" });
    }
    const report = buildRotationMonitor(q, {}, afterClose), out = row(report).quote;
    expect(report.sessionOpen).toBe(false); expect(out.kind).toBe("close");
    expect(out.ageMs).toBeNull(); expect(out.observedAtMs).toBeNull(); expect(out.relativePct).not.toBeNull();
  });
});

describe("rotation common completed-bar intervals", () => {
  it("measures 5m and 30m on today's partial session with exact common endpoints", () => {
    const report = buildRotationMonitor({}, histories(), NOW), r = row(report);
    expect(report.barEndpointDisplayEpoch).toBe(START + 18 * 300);
    expect(report.barEndpointAgeSeconds).toBe(2);
    const five = r.windows[5], thirty = r.windows[30];
    expect(five.state).toBe("measured"); expect(thirty.state).toBe("measured");
    expect(five.fromDisplayEpoch).toBe(START + 17 * 300);
    expect(thirty.fromDisplayEpoch).toBe(START + 12 * 300);
    expect(thirty.matchedSlots).toBe(7);
    expect(five.relativePct).toBeCloseTo(100 * ((103.4 / 103.2) / (100.85 / 100.8) - 1), 10);
    expect(thirty.relativePct).toBeCloseTo(100 * ((103.4 / 102.2) / (100.85 / 100.55) - 1), 10);
    expect(thirty.authority).toBe("descriptive_bar_geometry");
  });
  it("requires seven closes for 30m rather than substituting the day's open", () => {
    const h = histories(6), now = Date.parse("2026-10-27T14:00:02Z");
    expect(row(buildRotationMonitor({}, h, now)).windows[5].state).toBe("measured");
    expect(row(buildRotationMonitor({}, h, now)).windows[30].reason).toBe("missing_interval");
    expect(row(buildRotationMonitor({}, histories(7), now + 300_000)).windows[30].state).toBe("measured");
  });
  it("does not backtrack one sector to an earlier endpoint", () => {
    const h = histories(); h.XLK.bars.pop();
    const report = buildRotationMonitor({}, h, NOW);
    expect(row(report).windows[5].reason).toBe("missing_interval");
    expect(row(report, "XLP").windows[5].state).toBe("measured");
    expect(row(report).windows[5].toDisplayEpoch).toBe(report.barEndpointDisplayEpoch);
  });
  it("does not bridge a missing slot even when both horizon endpoints exist", () => {
    const h = histories(); h.XLK.bars.splice(14, 1);
    const r = row(buildRotationMonitor({}, h, NOW));
    expect(r.windows[5].state).toBe("measured"); expect(r.windows[30].reason).toBe("missing_interval");
    expect(r.windows[30].matchedSlots).toBe(6);
  });
  it.each(["duplicate", "order", "range", "grid", "volume"] as const)("rejects malformed current geometry: %s", defect => {
    const h = histories();
    if (defect === "duplicate") h.XLK.bars.splice(10, 0, h.XLK.bars[10]);
    if (defect === "order") h.XLK.bars.reverse();
    if (defect === "range") h.XLK.bars[10][2] = 1;
    if (defect === "grid") h.XLK.bars[10][0]++;
    if (defect === "volume") h.XLK.bars[10][5] = -1;
    expect(row(buildRotationMonitor({}, h, NOW)).windows[5].reason).toBe("invalid_series");
  });
  it("excludes forming and future prices before inspecting their geometry", () => {
    const h = histories(), before = row(buildRotationMonitor({}, h, NOW)).windows;
    h.XLK.bars.push([START + 18 * 300, NaN, -1, Infinity, 5000, -1]);
    h.SPY.bars.push([START + 18 * 300, NaN, -1, Infinity, 1, -1]);
    expect(row(buildRotationMonitor({}, h, NOW)).windows).toEqual(before);
  });
  it("missing SPY cannot produce an interval-relative return", () => {
    const h = histories(); delete (h as Record<string, unknown>).SPY;
    const r = row(buildRotationMonitor({}, h, NOW));
    expect(r.windows[5].reason).toBe("missing_benchmark"); expect(r.windows[5].relativePct).toBeNull();
  });
  it.each(["symbol", "requested_timeframe", "session", "timestamp_basis", "schema"])("requires the actual source evidence: %s", key => {
    const h = histories(); (h.XLK.source_evidence as Record<string, unknown>)[key] = "wrong";
    expect(row(buildRotationMonitor({}, h, NOW)).windows[5].reason).toBe("unknown_basis");
  });
  it("does not let a fresh assembly receipt qualify stale cache or old market endpoints", () => {
    const h = histories(); h.XLK.source_evidence.assembly_clock.cache_state = "stale_cache";
    expect(row(buildRotationMonitor({}, h, NOW)).windows[5].reason).toBe("source_stale");
    expect(row(buildRotationMonitor({}, histories(), NOW + 1_200_000)).windows[5].reason).toBe("source_stale");
  });
  it("cannot bridge yesterday into the first 30m of a new session", () => {
    const h = histories(6);
    for (const input of Object.values(h)) input.bars.unshift(...history("ignored", .1, 78, START - 86400).bars);
    expect(row(buildRotationMonitor({}, h, Date.parse("2026-10-27T14:00:02Z"))).windows[30].reason).toBe("missing_interval");
  });
  it("uses the owner calendar across DST and early closing sessions", () => {
    const afterDst = Date.parse("2026-11-03T15:05:02Z"), dstStart = Date.parse("2026-11-03T09:30:00Z") / 1000;
    const h = { SPY: history("SPY", .05, 7, dstStart), XLK: history("XLK", .2, 7, dstStart) };
    const report = buildRotationMonitor({}, h, afterDst);
    expect(report.sessionDate).toBe("2026-11-03"); expect(report.barEndpointAgeSeconds).toBe(2);
    expect(row(report).windows[30].state).toBe("measured");
    const earlyStart = Date.parse("2026-11-27T09:30:00Z") / 1000;
    const early = { SPY: history("SPY", .05, 42, earlyStart), XLK: history("XLK", .2, 42, earlyStart) };
    const closed = buildRotationMonitor({}, early, Date.parse("2026-11-27T18:00:02Z"));
    expect(closed.sessionOpen).toBe(false); expect(row(closed).windows[30].state).toBe("measured");
    expect(closed.barEndpointAgeSeconds).toBeNull();
    early.XLK.bars.pop(); expect(row(buildRotationMonitor({}, early, Date.parse("2026-11-27T18:00:02Z"))).windows[30].relativePct).toBeNull();
  });
  it("requires a settled closing endpoint after the session ends", () => {
    const report = buildRotationMonitor({}, histories(), Date.parse("2026-10-27T20:05:00Z"));
    expect(row(report).windows[5].reason).toBe("source_stale"); expect(report.sessionOpen).toBe(false);
  });
  it.each([NaN, Infinity, -1, 0])("handles unavailable current clocks without throwing: %s", now => {
    const report = buildRotationMonitor(quotes(), histories(), now);
    expect(report.sessionDate).toBeNull(); expect(report.quoteCoverage.relative).toBe(0);
    expect(row(report).windows[5].reason).toBe("invalid_clock");
  });
  it("does not mutate inputs or create events", () => {
    const q = quotes(), h = histories(), before = JSON.stringify({ q, h });
    buildRotationMonitor(q, h, NOW); expect(JSON.stringify({ q, h })).toBe(before);
    expect(buildRotationMonitor(q, h, NOW).authority).toBe("descriptive_only");
  });
});
