import { describe, expect, it } from "vitest";
import {
  addMonths,
  lastConfirmedPivot,
  rhythmPlacement,
  rhythmReading,
  rhythmWindowFromTurns,
  type RhythmPivot,
  type RhythmSpacing,
} from "../sectorCycleRhythm";

describe("rhythm window edges are fixed to the turns, not to today", () => {
  const pivot: RhythmPivot = { date: "2026-03-31", kind: "trough", provisional: false };
  const spacing: RhythmSpacing = { p25: 4, median: 6, p75: 9 };
  const window = rhythmWindowFromTurns(pivot, spacing);
  it("derives the window from the last confirmed pivot and its own spacing quantiles", () => {
    expect(window).toMatchObject({
      state: "ready",
      nextTurn: "peak",
      low: "2026-07",
      central: "2026-09",
      high: "2026-12",
    });
  });
  it("clamps month arithmetic to end of month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02"); // leap year
    expect(addMonths("2026-03-31", -3)).toBe("2025-12");
    expect(addMonths("2026-03-31", 1.5)).toBeNull();
  });
  it("advancing today moves the position and the overdue flag but never the edges", () => {
    const edges = [window.low, window.central, window.high];
    const days = [
      "2026-04-15",
      "2026-06-30",
      "2026-07-01",
      "2026-09-10",
      "2026-12-15",
      "2027-03-01",
      "2028-01-01",
    ];
    const observed = days.map((today) => {
      const placement = rhythmPlacement(rhythmWindowFromTurns(pivot, spacing), today);
      const fresh = rhythmWindowFromTurns(pivot, spacing);
      expect([fresh.low, fresh.central, fresh.high]).toEqual(edges);
      return placement;
    });
    expect(observed.map((p) => p.position)).toEqual([
      "before",
      "before",
      "inside",
      "inside",
      "inside",
      "past",
      "past",
    ]);
    expect(observed.map((p) => p.overdue)).toEqual(
      days.map((d) => d.slice(0, 7) > "2026-12"),
    );
  });
  it("holds the window when turns stay fixed and only 'today' is supplied later", () => {
    const first = rhythmWindowFromTurns(pivot, spacing);
    const later = rhythmWindowFromTurns(
      { ...pivot, provisional: false },
      { ...spacing },
    );
    expect([later.low, later.central, later.high]).toEqual([
      first.low,
      first.central,
      first.high,
    ]);
  });
  it("skips provisional pivots: only a confirmed turn anchors the window", () => {
    const turns = [
      { date: "2025-06-13", k: "peak", provisional: false },
      { date: "2025-11-28", k: "trough", provisional: false },
      { date: "2026-02-20", k: "peak", provisional: true },
    ];
    expect(lastConfirmedPivot(turns)).toEqual({
      date: "2025-11-28",
      kind: "trough",
      provisional: false,
    });
    const provisionalOnly = [
      { date: "2026-02-20", k: "peak", provisional: true },
    ];
    expect(lastConfirmedPivot(provisionalOnly)).toBeNull();
    expect(
      rhythmWindowFromTurns(lastConfirmedPivot(provisionalOnly), spacing).state,
    ).toBe("unavailable");
  });
  it("refuses unordered or non-positive spacing and a missing pivot", () => {
    for (const bad of [
      null,
      { p25: 0, median: 6, p75: 9 },
      { p25: 9, median: 6, p75: 4 },
      { p25: 2, median: NaN, p75: 9 },
    ])
      expect(rhythmWindowFromTurns(pivot, bad as RhythmSpacing | null).state).toBe(
        "unavailable",
      );
    expect(rhythmWindowFromTurns(null, spacing).state).toBe("unavailable");
  });
});

describe("producer rhythm block as an optional depth", () => {
  const record = (rhythm: unknown) => ({ rhythm });
  const generation = { asOf: "2026-10-30" };
  it("valid read: fixed producer edges, placement against today", () => {
    const reading = rhythmReading(
      record({
        schema: "sector_cycles.rhythm.v1",
        as_of: "2026-10-30",
        kind: "descriptive_rhythm",
        next_turn: "peak",
        window: { low: "2026-08", central: "2026-10", high: "2027-01" },
      }),
      generation,
      "2026-10-30",
    );
    expect(reading.state).toBe("valid");
    expect(reading.window).toMatchObject({
      low: "2026-08",
      central: "2026-10",
      high: "2027-01",
    });
    expect(reading.position).toBe("inside");
    expect(reading.overdue).toBe(false);
  });
  it("a rhythm from another generation is expired, never spliced into this one", () => {
    const reading = rhythmReading(
      record({
        schema: "sector_cycles.rhythm.v1",
        as_of: "2026-10-24",
        window: { low: "2026-08", central: "2026-10", high: "2027-01" },
      }),
      generation,
      "2026-10-30",
    );
    expect(reading.state).toBe("expired");
    expect(reading.window.state).toBe("unavailable");
  });
  it("an unknown schema is a wrong epoch, an absent block is absent, and neither crashes", () => {
    expect(
      rhythmReading(record({ schema: "sector_cycles.rhythm.v9" }), generation, null).state,
    ).toBe("wrong_epoch");
    expect(rhythmReading(record({}), generation, null).state).toBe("absent");
    expect(rhythmReading({}, generation, null).state).toBe("absent");
  });
  it("unordered producer windows are withheld rather than drawn", () => {
    const reading = rhythmReading(
      record({
        schema: "sector_cycles.rhythm.v1",
        as_of: "2026-10-30",
        window: { low: "2027-01", central: "2026-10", high: "2026-08" },
      }),
      generation,
      null,
    );
    expect(reading.state).toBe("valid");
    expect(reading.window.state).toBe("unavailable");
    expect(reading.position).toBeNull();
  });
  it("producer overdue flag stays authoritative for the chip", () => {
    const reading = rhythmReading(
      record({
        schema: "sector_cycles.rhythm.v1",
        as_of: "2026-10-30",
        overdue: true,
        window: { low: "2026-01", central: "2026-03", high: "2026-06" },
      }),
      generation,
      "2026-10-30",
    );
    expect(reading.overdue).toBe(true);
    expect(reading.position).toBe("past");
  });
});
