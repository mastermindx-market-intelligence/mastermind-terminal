import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHART_RIGHT_OFFSET,
  DEFAULT_CHART_VIEW_BARS,
  defaultChartRightOffset,
  fullHistoryLogicalRange,
  futureAxisBarCount,
  normalizedChartLogicalRange,
  withChartFutureOffset,
} from "@/lib/chart-engine/viewReset";

describe("normalizedChartLogicalRange", () => {
  it("reserves enough future bars to clear the last-price symbol tag", () => {
    expect(DEFAULT_CHART_RIGHT_OFFSET).toBe(24);
    expect(defaultChartRightOffset(904)).toBe(24);
    expect(defaultChartRightOffset(329)).toBe(77);
  });

  it("restores the recent default window instead of fitting a long history", () => {
    expect(normalizedChartLogicalRange(1_200, false)).toEqual({
      from: 1_200 - DEFAULT_CHART_VIEW_BARS,
      to: 1_200 - 1 + DEFAULT_CHART_RIGHT_OFFSET,
    });
  });

  it("fits a history that is already shorter than the default window", () => {
    expect(normalizedChartLogicalRange(DEFAULT_CHART_VIEW_BARS, false)).toBeNull();
  });

  it("fits the currently available replay slice", () => {
    expect(normalizedChartLogicalRange(1_200, true)).toBeNull();
  });
});

describe("withChartFutureOffset", () => {
  it("extends an explicit range into the empty future area", () => {
    expect(withChartFutureOffset({ from: 10, to: 50 })).toEqual({ from: 10, to: 50 + DEFAULT_CHART_RIGHT_OFFSET });
    expect(withChartFutureOffset({ from: 10, to: 50 }, 7)).toEqual({ from: 10, to: 57 });
  });

  it("passes a missing range through and never pulls the end backwards", () => {
    expect(withChartFutureOffset(null)).toBeNull();
    expect(withChartFutureOffset({ from: 0, to: 9 }, -5)).toEqual({ from: 0, to: 9 });
  });
});

describe("fullHistoryLogicalRange", () => {
  it("spans every bar plus the future gutter", () => {
    expect(fullHistoryLogicalRange(1000)).toEqual({ from: 0, to: 999 + DEFAULT_CHART_RIGHT_OFFSET });
  });

  it("has nothing to bound below two bars", () => {
    expect(fullHistoryLogicalRange(1)).toBeNull();
    expect(fullHistoryLogicalRange(0)).toBeNull();
  });
});

describe("futureAxisBarCount", () => {
  it("keeps the blank tail proportionate to the loaded history", () => {
    expect(futureAxisBarCount(1000, 200)).toBe(200);
    expect(futureAxisBarCount(500, 200)).toBe(100);
  });

  it("never drops below the standard gutter, and never exceeds the anchor grid", () => {
    expect(futureAxisBarCount(60, 200)).toBe(DEFAULT_CHART_RIGHT_OFFSET);
    expect(futureAxisBarCount(100_000, 200)).toBe(200);
  });

  it("adds no tail without a series to hang it from", () => {
    expect(futureAxisBarCount(1, 200)).toBe(0);
    expect(futureAxisBarCount(0, 200)).toBe(0);
  });
});
