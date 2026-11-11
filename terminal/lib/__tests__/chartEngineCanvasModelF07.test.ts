// F-07: series.update matches LWC §8.4 / DataLayer._internal_updateSeriesData
// (dev:11560-11648). Fails on BASE because a backwards update silently patches
// and historicalUpdate at a missing time inserts.
import { describe, expect, it } from "vitest";

import { ChartModel } from "@/lib/chart-engine/canvas/model";
import type { EngineSeriesRow } from "@/lib/chart-engine/api";

const ROWS: EngineSeriesRow[] = [
  { time: 1000, value: 1 },
  { time: 2000, value: 2 },
  { time: 3000, value: 3 },
];

describe("F-07 updateSeriesRow matches LWC §8.4", () => {
  it("backwards without historicalUpdate throws and leaves the series unchanged", () => {
    const m = new ChartModel({ onInvalidate: () => undefined, onStructure: () => undefined });
    const s = m.addSeries("line");
    s.setData(ROWS);
    expect(() => s.update({ time: 1000, value: 9 })).toThrow(/^Cannot update oldest data/);
    expect(s.data()).toEqual(ROWS);
    expect(() => s.update({ time: 1500, value: 9 })).toThrow(/^Cannot update oldest data/);
    expect(s.data()).toEqual(ROWS);
  });

  it("historicalUpdate at an existing time replaces in place", () => {
    const m = new ChartModel({ onInvalidate: () => undefined, onStructure: () => undefined });
    const s = m.addSeries("line");
    s.setData(ROWS);
    s.update({ time: 2000, value: 22 }, true);
    expect(s.data()).toEqual([
      { time: 1000, value: 1 },
      { time: 2000, value: 22 },
      { time: 3000, value: 3 },
    ]);
  });

  it("historicalUpdate at a non-existing time throws and leaves the series unchanged", () => {
    const m = new ChartModel({ onInvalidate: () => undefined, onStructure: () => undefined });
    const s = m.addSeries("line");
    s.setData(ROWS);
    expect(() => s.update({ time: 1500, value: 9 }, true)).toThrow(
      /Cannot update non-existing data point/,
    );
    expect(s.data()).toEqual(ROWS);
  });

  it("equal-to-last replaces; a newer time appends", () => {
    const m = new ChartModel({ onInvalidate: () => undefined, onStructure: () => undefined });
    const s = m.addSeries("line");
    s.setData(ROWS);
    s.update({ time: 3000, value: 30 });
    expect(s.data()).toHaveLength(3);
    expect(s.data()[2]).toEqual({ time: 3000, value: 30 });
    s.update({ time: 4000, value: 4 });
    expect(s.data()).toHaveLength(4);
    expect(s.data()[3]).toEqual({ time: 4000, value: 4 });
  });
});
