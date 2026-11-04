import { describe, expect, it } from "vitest";
import { buildRotationPivotProjection } from "@/lib/rotationPivotPreview";
import type { RotationMonitorReport } from "@/lib/rotationMonitor";
import type { Bar6 } from "@/lib/intradayShared";

const START = Date.parse("2026-10-27T09:30:00Z") / 1000; // ET display epoch, NOT UTC event time.
const END = START + 78 * 300;
const session = { date: "2026-10-27", open: true, start: START, end: END };
function history(n: number, delta: Record<string, unknown> = {}) {
  const bars: Bar6[] = Array.from({ length: n }, (_, i) =>
    [START + i * 300, 100, 101, 99, 100, 1000]);
  return { bars, source_evidence: { schema: "terminal.intraday_source_evidence.v1", symbol: "XLK",
    requested_timeframe: "5m", session: "regular", timestamp_basis: "market_local_display_epoch",
    assembly_clock: { cache_state: "new_assembly" }, point_in_time_availability: "not_verified", ...delta } };
}
function monitor(n = 6): RotationMonitorReport {
  const endpoint = START + n * 300;
  return { schema: "terminal.rotation_monitor.v1", authority: "descriptive_only", benchmark: "SPY",
    sessionDate: session.date, sessionOpen: true, barEndpointDisplayEpoch: endpoint,
    barEndpointAgeSeconds: 60, quoteCoverage: { expected: 11, absolute: 1, relative: 1 },
    rows: [{ symbol: "XLK", quote: { kind: "live", sincePreviousClosePct: 2, relativePct: 1,
      observedAtMs: 1, ageMs: 1000, benchmarkObservedAtMs: 1, skewMs: 0, reason: null },
      windows: { 5: { state: "measured", authority: "descriptive_bar_geometry", horizonMinutes: 5,
        absolutePct: .1, benchmarkPct: .02, relativePct: .08,
        fromDisplayEpoch: endpoint - 300, toDisplayEpoch: endpoint, endpointAgeSeconds: 60,
        expectedSlots: 2, matchedSlots: 2, reason: null },
        30: { state: "unavailable", authority: "descriptive_bar_geometry", horizonMinutes: 30,
          absolutePct: null, benchmarkPct: null, relativePct: null, fromDisplayEpoch: endpoint-1800,
          toDisplayEpoch: endpoint, endpointAgeSeconds: 60, expectedSlots: 7, matchedSlots: 0,
          reason: "missing_interval" } } }],
  };
}
const build = (m = monitor(), h: unknown = history(6), s = session, symbol = "XLK") =>
  buildRotationPivotProjection({ monitor: m, history: h, symbol, session: s });

describe("R1 rotation to reconstructed R2 pivot bridge", () => {
  it("only shows a reconstructed, source-admitted preview at the common 5m endpoint", () => {
    const p = build();
    expect(p.state).toBe("available");
    expect(p.preview?.authority).toBe("reconstructed_descriptive_only");
    expect(p.preview?.outcomesAreAsIssued).toBe(false);
    expect(p.preview?.levelKnownAtDisplayEpoch).toBe(START + 1800);
    expect(p.preview?.rows.map(r => r.state)).toEqual(["watching", "watching"]);
  });
  it("cannot see a later sector-only encounter or confirmation", () => {
    const h = history(8);
    h.bars[6] = [START+1800, 100, 100.5, 98.9, 99.5, 1000];
    h.bars[7] = [START+2100, 99.5, 101.5, 99.4, 101.2, 1000];
    expect(build(monitor(6), h).preview?.rows[0].state).toBe("watching");
    expect(build(monitor(8), h).preview?.rows[0].state).toBe("confirmed");
  });
  it("withholds the watch without a comparable sector/SPY 5m interval", () => {
    const m = monitor(); m.rows[0].windows[5].state = "unavailable";
    expect(build(m).reason).toBe("common_interval_unavailable");
  });
  it("does not backtrack the sector to an older endpoint", () => {
    const m = monitor(); m.rows[0].windows[5].toDisplayEpoch = START + 1500;
    expect(build(m).reason).toBe("common_interval_unavailable");
  });
  it("rejects an expired shared endpoint and missing source evidence", () => {
    const m = monitor(); m.barEndpointAgeSeconds = 1201;
    expect(build(m).reason).toBe("common_interval_unavailable");
    expect(build(monitor(), {bars: history(6).bars}).reason).toBe("source_unqualified");
  });
  it("will not issue a pivot on mismatched calendar, time basis or symbol", () => {
    expect(build(monitor(), history(6), {...session, date:"2026-10-28"}).reason).toBe("session_mismatch");
    expect(build(monitor(), history(6, {timestamp_basis:"utc_epoch"}))).toHaveProperty("reason", "source_unqualified");
    expect(build(monitor(), history(6), session, "NVDA").reason).toBe("symbol_unavailable");
  });
  it("fails closed on incomplete opening range instead of drawing a support level", () => {
    const h = history(6); h.bars.splice(2,1);
    expect(build(monitor(), h).preview).toBeNull();
  });
});
