import { describe, expect, it } from "vitest";
import { planIndexedSeriesSlice } from "@/lib/indicator-canvas/indexedSeriesSlice";

const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ i, p: i * 0.1 }));

describe("indexed-series viewport planning", () => {
  it("binary-slices a long monotonic line to padded viewport points plus crossing endpoints", () => {
    expect(planIndexedSeriesSlice(pts(1200), 400, 499, 10)).toEqual({
      start: 395,
      end: 505,
      optimized: true,
    });
  });

  it("retains both endpoints of a segment that crosses the viewport with no point inside it", () => {
    const sparse = [{ i: 0, p: 1 }, { i: 100, p: 2 }, { i: 200, p: 3 }];
    expect(planIndexedSeriesSlice(sparse, 120, 140, 10)).toEqual({
      start: 1,
      end: 3,
      optimized: true,
    });
  });

  it("handles reversed visible ranges without changing the selected window", () => {
    expect(planIndexedSeriesSlice(pts(1200), 499, 400, 10))
      .toEqual(planIndexedSeriesSlice(pts(1200), 400, 499, 10));
  });

  it("falls back to the full line for unsorted, non-finite, or unusable viewport input", () => {
    const unsorted = [{ i: 0, p: 1 }, { i: 3, p: 2 }, { i: 2, p: 3 }];
    expect(planIndexedSeriesSlice(unsorted, 0, 1, 10)).toEqual({ start: 0, end: 3, optimized: false });
    expect(planIndexedSeriesSlice([{ i: 0, p: 1 }, { i: Number.NaN, p: 2 }], 0, 1, 10))
      .toEqual({ start: 0, end: 2, optimized: false });
    expect(planIndexedSeriesSlice(pts(10), Number.NaN, 5, 10))
      .toEqual({ start: 0, end: 10, optimized: false });
    expect(planIndexedSeriesSlice(pts(10), 0, 5, 0))
      .toEqual({ start: 0, end: 10, optimized: false });
  });

  it("does not claim an optimization when the whole line is already near the viewport", () => {
    expect(planIndexedSeriesSlice(pts(8), 0, 7, 10)).toEqual({ start: 0, end: 8, optimized: false });
  });
});
