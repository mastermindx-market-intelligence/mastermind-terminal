import { describe, expect, it } from "vitest";
import type { Bar } from "../fund";
import { realizedVolCone, realizedVolYZ, RV_WINDOWS, type RvConeRow } from "../realizedVol";

const ROW_FIELDS = ["min", "p25", "median", "p75", "max"] as const;

function makeBars(count: number, range: (index: number) => number): Bar[] {
  return Array.from({ length: count }, (_, index) => {
    const amplitude = range(index);
    return {
      time: new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10),
      o: 100,
      h: 100 + amplitude,
      l: 100 - amplitude,
      c: 100,
      v: 1000,
    };
  });
}

function rowAt(bars: Bar[], window: number): RvConeRow {
  const row = realizedVolCone(bars).find((candidate) => candidate.window === window);
  expect(row).toBeDefined();
  return row!;
}

function expectMissing(row: RvConeRow): void {
  expect(row.current).toBeNull();
  for (const field of ROW_FIELDS) expect(row[field]).toBeNull();
}

function expectedHistorical(bars: Bar[], window: number) {
  const total = bars.length - window;
  const stride = Math.max(1, Math.floor(total / 500));
  const values: number[] = [];
  for (let end = bars.length; end >= window + 1; end -= stride) {
    const estimate = realizedVolYZ(bars.slice(end - window - 1, end));
    if (Number.isFinite(estimate) && estimate > 0) values.push(estimate);
  }
  values.sort((a, b) => a - b);
  const at = (p: number) => {
    const index = p * (values.length - 1);
    const lo = Math.floor(index);
    const hi = Math.ceil(index);
    return values[lo] + (values[hi] - values[lo]) * (index - lo);
  };
  return { values, stride, min: values[0], p25: at(0.25), median: at(0.5), p75: at(0.75), max: values.at(-1)! };
}

describe("realizedVolCone: Current must mean the latest exact trailing window", () => {
  it("reproduces the 40-bar historical-positive/latest-flat defect without changing inputs", () => {
    const bars = makeBars(40, (index) => (index < 29 ? 2 : 0));
    const before = bars.map((bar) => ({ ...bar }));
    expect(realizedVolYZ(bars.slice(-11))).toBe(0);
    const row = rowAt(bars, 10);
    expect(row.current).toBeNull();
    expect(row.min).toBeGreaterThan(0);
    expect(row.max).toBeGreaterThan(0);
    expect(bars).toEqual(before);
  });

  for (const window of RV_WINDOWS) {
    it(String(window) + "-day: never promotes historical positive RV after a latest zero", () => {
      const bars = makeBars(window + 40, (index) => (index < 39 ? 1 + (index % 7) / 4 : 0));
      expect(realizedVolYZ(bars.slice(-window - 1))).toBe(0);
      const row = rowAt(bars, window);
      expect(row.current).toBeNull();
      expect(row.min).toBeGreaterThan(0);
      expect(row.max).toBeGreaterThan(0);
    });

    for (const invalidField of ["h", "c"] as const) {
      it(String(window) + "-day: rejects nonfinite newest RV (infinite " + invalidField + ") without historical fallback", () => {
        const bars = makeBars(window + 40, (index) => 1 + (index % 11) / 5);
        bars[bars.length - 1] = { ...bars[bars.length - 1], [invalidField]: Infinity };
        expect(Number.isFinite(realizedVolYZ(bars.slice(-window - 1)))).toBe(false);
        const row = rowAt(bars, window);
        expect(row.current).toBeNull();
        expect(row.min).toBeGreaterThan(0);
        expect(row.max).toBeGreaterThan(0);
      });
    }

    it(String(window) + "-day: binds valid Current to exact latest w+1 bars, not the previous window", () => {
      const bars = makeBars(window + 45, (index) => 0.8 + (index % 13) / 8);
      bars[bars.length - 1] = { ...bars[bars.length - 1], h: 120, l: 80 };
      const current = realizedVolYZ(bars.slice(-window - 1));
      const previous = realizedVolYZ(bars.slice(-window - 2, -1));
      expect(current).toBeGreaterThan(0);
      expect(current).not.toBeCloseTo(previous, 8);
      const row = rowAt(bars, window);
      expect(row.current).toBeCloseTo(current, 12);
      expect(row.current).not.toBeCloseTo(previous, 8);
    });

    it(String(window) + "-day: insufficient w+1 history yields a fully null row", () => {
      const row = rowAt(makeBars(window, () => 1), window);
      expectMissing(row);
    });
  }

  it("keeps all-flat rows null for all six windows", () => {
    const rows = realizedVolCone(makeBars(300, () => 0));
    expect(rows.map((row) => row.window)).toEqual(RV_WINDOWS);
    for (const row of rows) expectMissing(row);
  });

  it("preserves all historical distribution fields and does not mutate frozen input", () => {
    const bars = makeBars(320, (index) => 0.4 + (index % 17) / 10);
    const before = bars.map((bar) => ({ ...bar }));
    for (const bar of bars) Object.freeze(bar);
    Object.freeze(bars);
    const rows = realizedVolCone(bars);
    expect(rows.map((row) => row.window)).toEqual(RV_WINDOWS);
    for (const row of rows) {
      const expected = expectedHistorical(bars, row.window);
      expect(expected.values.length).toBeGreaterThan(0);
      expect(row.current).toBeCloseTo(realizedVolYZ(bars.slice(-row.window - 1)), 12);
      for (const field of ROW_FIELDS) expect(row[field]).toBeCloseTo(expected[field], 12);
    }
    expect(bars).toEqual(before);
  });

  for (const window of RV_WINDOWS) {
    it(String(window) + "-day: >1000 positions retain stride/bands but not a stale Current", () => {
      const count = 1800;
      const bars = makeBars(count, (index) =>
        index >= count - 253 ? 0 : 0.7 + (index % 23) / 10,
      );
      expect(count - window).toBeGreaterThan(1000);
      expect(realizedVolYZ(bars.slice(-window - 1))).toBe(0);
      const expected = expectedHistorical(bars, window);
      expect(expected.stride).toBeGreaterThan(1);
      expect(expected.values.length).toBeGreaterThan(0);
      const row = rowAt(bars, window);
      expect(row.current).toBeNull();
      for (const field of ROW_FIELDS) expect(row[field]).toBeCloseTo(expected[field], 12);
    });
  }

  it("keeps the canonical window list in its defined order", () => {
    expect(realizedVolCone(makeBars(300, () => 1)).map((row) => row.window)).toEqual(RV_WINDOWS);
  });
});
