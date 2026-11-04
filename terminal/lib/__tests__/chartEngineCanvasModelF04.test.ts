// F-04: future slots and non-grid times are not data on the public time-scale
// contract. Drawings keep the synthetic grid via ChartModel.futureSlotLogical /
// logicalToFutureTime. Fails on BASE because timeToIndex/timeToCoordinate/
// coordinateToTime leak futureSlotResolver results.
import { describe, expect, it } from "vitest";

import { ChartModel } from "@/lib/chart-engine/canvas/model";
import type { EngineSeriesRow } from "@/lib/chart-engine/api";

function makeModel(): ChartModel {
  const m = new ChartModel({ onInvalidate: () => undefined, onStructure: () => undefined });
  m.applyOptions({ width: 200, height: 100 });
  return m;
}

const FOUR: EngineSeriesRow[] = [
  { time: 1000, value: 1 },
  { time: 2000, value: 2 },
  { time: 3000, value: 3 },
  { time: 4000, value: 4 },
];

describe("F-04 future slots are not data", () => {
  it("timeToIndex(t,false) is null off the primary grid; findNearest past last → last index", () => {
    const m = makeModel();
    const s = m.addSeries("line");
    s.setData(FOUR);
    const ts = m.timeScaleHandleFor();
    expect(ts.timeToIndex(1000, false)).toBe(0);
    expect(ts.timeToIndex(4000, false)).toBe(3);
    expect(ts.timeToIndex(6000, false)).toBeNull();
    expect(ts.timeToIndex(6000, true)).toBe(3);
    expect(ts.timeToIndex(3500, false)).toBeNull();
    expect(ts.timeToIndex(500, false)).toBeNull();
    expect(ts.timeToIndex(500, true)).toBe(0);
  });

  it("timeToCoordinate is null for non-grid times (review probe 3500)", () => {
    const m = makeModel();
    const s = m.addSeries("line");
    s.setData(FOUR);
    const ts = m.timeScaleHandleFor();
    expect(ts.timeToCoordinate(2000)).toBe(m.xOfLogical(1));
    expect(ts.timeToCoordinate(3500)).toBeNull();
    expect(ts.timeToCoordinate(6000)).toBeNull();
  });

  it("coordinateToTime is null when x maps to no existing row (review probe logical 5)", () => {
    const m = makeModel();
    const s = m.addSeries("line");
    s.setData(FOUR);
    const ts = m.timeScaleHandleFor();
    expect(ts.coordinateToTime(m.xOfLogical(2))).toBe(3000);
    expect(ts.coordinateToTime(m.xOfLogical(5))).toBeNull();
    expect(ts.coordinateToTime(m.xOfLogical(-2))).toBeNull();
  });

  it("hasBarAtLogical is true only for a rounded index that exists", () => {
    const m = makeModel();
    m.addSeries("line").setData(FOUR);
    expect(m.hasBarAtLogical(0)).toBe(true);
    expect(m.hasBarAtLogical(3)).toBe(true);
    expect(m.hasBarAtLogical(1.4)).toBe(true);
    expect(m.hasBarAtLogical(2.6)).toBe(true);
    expect(m.hasBarAtLogical(3.6)).toBe(false);
    expect(m.hasBarAtLogical(5)).toBe(false);
    expect(m.hasBarAtLogical(-1)).toBe(false);
  });

  it("futureSlotLogical / logicalToFutureTime keep the synthetic grid for drawings", () => {
    const m = makeModel();
    m.addSeries("line").setData(FOUR);
    expect(m.futureSlotLogical(6000)).toBe(5);
    expect(m.logicalToFutureTime(5)).toBe(6000);
    expect(m.futureSlotLogical(4000)).toBeNull();
    expect(m.logicalToFutureTime(3)).toBeNull();
    expect(m.hasBarAtLogical(m.futureSlotLogical(6000)!)).toBe(false);
  });
});
