import { describe, expect, it } from "vitest";
import { decodeProphetObservations, prophetObservationSummary, isProphetTicker } from "../prophetObservations";
import { prophetFixture } from "./prophetObservationsFixture";

const read = (data: unknown, symbol = "KO") => ({ symbol, account: "reader-a", status: "ready" as const, data: decodeProphetObservations(data, symbol) });
describe("native Prophet early-observation consumer", () => {
  it("retains an uncapped source event, its suppression reason and false authority", () => {
    const raw = prophetFixture(), before = JSON.stringify(raw);
    const value = decodeProphetObservations(raw, "KO");
    expect(value?.rows[0].source_visibility).toBe("BEYOND_CAP");
    expect(value?.rows[0].episode_relation.reason).toBe("ACTIVE_EPISODE_DIFFERENT_ANCHOR");
    expect(value?.authority.buy).toBe(false); expect(JSON.stringify(raw)).toBe(before);
    expect(prophetObservationSummary(read(raw), false).label).toBe("Recorded evidence");
  });
  it("refuses a row belonging to another security", () => {
    expect(decodeProphetObservations(prophetFixture("WM"), "KO")).toBeNull();
  });
  it.each(["buy", "alert", "entry_open", "rank", "size", "episode_write"])("refuses promoted root or row authority: %s", key => {
    const raw = prophetFixture(); (raw.authority as Record<string, unknown>)[key] = true;
    expect(decodeProphetObservations(raw, "KO")).toBeNull();
    const row = prophetFixture(); (row.rows[0].authority as Record<string, unknown>)[key] = true;
    expect(decodeProphetObservations(row, "KO")).toBeNull();
  });
  it.each([null, {}, [], { schema: "not-prophet", rows: [] }])("refuses malformed envelopes instead of inventing no signal", raw => {
    expect(decodeProphetObservations(raw, "KO")).toBeNull();
  });
  it("refuses malformed, impossible, future and inconsistent source dates", () => {
    for (const date of ["2026-02-30", "not a date", "2026-10-19"]) {
      const raw = prophetFixture(); raw.clocks.source_session = date;
      expect(decodeProphetObservations(raw, "KO")).toBeNull();
    }
    const raw = prophetFixture(); raw.rows[0].source_session = "2026-10-15";
    expect(decodeProphetObservations(raw, "KO")).toBeNull();
  });
  it("does not invent verified membership from an empty triggered population", () => {
    const raw = prophetFixture(); raw.rows = []; raw.counts.matched = 0; raw.counts.returned = 0;
    expect(prophetObservationSummary(read(raw), false).label).toBe("Coverage not reported");
  });
  it("requires the source event trigger to be both fired and evaluated", () => {
    const raw = prophetFixture(); raw.rows[0].source_evidence.triggers.pre_confluence_2d.evaluated = false;
    expect(decodeProphetObservations(raw, "KO")).toBeNull();
    raw.rows[0].source_evidence.triggers.pre_confluence_2d.evaluated = true;
    raw.rows[0].source_evidence.triggers.pre_confluence_2d.fired = false;
    expect(decodeProphetObservations(raw, "KO")).toBeNull();
  });
  it("does not silently truncate a contradictory source count", () => {
    const raw = prophetFixture(); raw.counts.returned = 2;
    expect(decodeProphetObservations(raw, "KO")).toBeNull();
  });
  it("keeps retained source evidence distinguishable from current evidence", () => {
    const raw = prophetFixture(); raw.status = "RETAINED_PREVIOUS_SESSION"; raw.reference_session = "2026-10-19";
    const summary = prophetObservationSummary(read(raw), false);
    expect(summary.label).toBe("Recorded evidence"); expect(summary.detail).toContain("2026-10-16"); expect(summary.current).toBe(false);
  });
  it("never accepts a URL, futures code, crypto pair or path as a US ticker", () => {
    for (const t of ["https://bad.test", "../KO", "KO?limit=100", "BTC-USD", "ES=F", "^GSPC", "KO/WM", ""]) expect(isProphetTicker(t)).toBe(false);
    expect(isProphetTicker("KO")).toBe(true); expect(isProphetTicker("WM")).toBe(true); expect(isProphetTicker("BRK.B")).toBe(true);
  });
});
