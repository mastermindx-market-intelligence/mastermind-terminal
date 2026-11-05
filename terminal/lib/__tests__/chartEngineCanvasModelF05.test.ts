// F-05: dataByIndex nearest-left is floor, nearest-right is ceil (LWC MismatchDirection
// NearestLeft/NearestRight, dev:3028-3035). Fails on BASE because the handle rounds
// first and only uses mismatch when the rounded index is out of range.
import { describe, expect, it } from "vitest";

import { ChartModel } from "@/lib/chart-engine/canvas/model";
import type { EngineSeriesRow } from "@/lib/chart-engine/api";

const ROWS: EngineSeriesRow[] = [
  { time: 1000, value: 1 },
  { time: 2000, value: 2 },
  { time: 3000, value: 3 },
  { time: 4000, value: 4 },
  { time: 5000, value: 5 },
];

describe("F-05 dataByIndex nearest-left floors / nearest-right ceils", () => {
  it("nearest-left is the largest existing index ≤ logical; nearest-right is ≥", () => {
    const m = new ChartModel({ onInvalidate: () => undefined, onStructure: () => undefined });
    const s = m.addSeries("line");
    s.setData(ROWS);
    expect(s.dataByIndex(2.6, "nearest-left")).toBe(ROWS[2]);
    expect(s.dataByIndex(2.4, "nearest-right")).toBe(ROWS[3]);
    expect(s.dataByIndex(2, "nearest-left")).toBe(ROWS[2]);
    expect(s.dataByIndex(2, "nearest-right")).toBe(ROWS[2]);
    expect(s.dataByIndex(2.0, "nearest-left")).toBe(ROWS[2]);
    expect(s.dataByIndex(-0.4, "nearest-right")).toBe(ROWS[0]);
    expect(s.dataByIndex(-0.4, "nearest-left")).toBeNull();
    expect(s.dataByIndex(4.2, "nearest-left")).toBe(ROWS[4]);
    expect(s.dataByIndex(4.2, "nearest-right")).toBeNull();
  });
});
