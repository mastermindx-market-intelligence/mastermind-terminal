import { describe, expect, it } from "vitest";
import { fmtTick, niceTicks } from "@/components/charts/svgChart";

describe("step-derived SVG tick precision", () => {
  it.each([
    [2, 1, "2"], [4, 2, "4"], [15, 5, "15"], [100, 10, "100"],
    [2.5, 2.5, "2.5"], [7.5, 2.5, "7.5"], [-2.5, 2.5, "-2.5"],
    [0.25, 0.25, "0.25"], [0.75, 0.25, "0.75"],
    [0.025, 0.025, "0.025"], [0.0025, 0.0025, "0.0025"],
    [0.125, 0.125, "0.125"], [0.0064, 0.0032, "0.0064"],
    [0.001, 0.0005, "0.0010"], [0.0015, 0.0005, "0.0015"],
    [0.002, 0.0005, "0.0020"], [0.2, 0.1, "0.2"],
    [0.1000001, 0.1000001, "0.1000001"],
  ])("formats value %s at step %s as %s", (value, step, label) => {
    expect(fmtTick(value, step)).toBe(label);
    expect(fmtTick(value, -step)).toBe(label);
  });

  it("retains actual strike-grid precision despite subtraction noise", () => {
    expect(fmtTick(100.01, 100.01 - 100)).toBe("100.01");
    // This subtraction lands just below 0.01. An extra decimal preserves
    // the strict display-quantum <= actual-gap contract.
    expect(fmtTick(150.01, 150.01 - 150)).toBe("150.010");
    expect([0.05, 0.15].map(v => fmtTick(v, 0.15 - 0.05))).toEqual(["0.05", "0.15"]);
  });

  it("does not let fit tolerance choose a display interval larger than the step", () => {
    const step = 0.9999999999;
    const values = [0.5, 0.5 + step];
    const labels = values.map(value => fmtTick(value, step));
    expect(new Set(labels).size).toBe(values.length);
    expect(labels.map(Number)).toEqual(values);
  });

  it.each([0, -0, NaN, Infinity, -Infinity])("keeps values readable for unusable step %s", step => {
    expect(fmtTick(1.23456789, step)).toBe("1.23456789");
    expect(fmtTick(-0, step)).toBe("0");
  });

  it.each([NaN, Infinity, -Infinity])("does not throw for nonfinite value %s", value => {
    expect(fmtTick(value, 0.0025)).toBe(String(value));
  });

  it.each([1, 0.1, 0.0005])("avoids a misleading negative zero at step %s", step => {
    expect(fmtTick(-0, step)).not.toMatch(/^-/);
    expect(fmtTick(-step / 1000, step)).not.toMatch(/^-/);
    expect(Number(fmtTick(-step / 1000, step))).toBe(0);
  });

  it.each([
    [1e-100, 1e-100], [1e-101, 1e-101], [1e-200, 1e-200],
    [Number.MIN_VALUE, Number.MIN_VALUE], [1e21, 1e20],
    [Number.MAX_VALUE, Number.MAX_VALUE],
  ])("retains finite extremes %s without throwing or turning them into zero", (value, step) => {
    const label = fmtTick(value, step);
    expect(Number(label)).toBe(value);
    expect(Number(label)).not.toBe(0);
  });
});

describe("real niceTicks consumer domains", () => {
  for (const scale of [1e-12, 1e-9, 1e-6, 1e-3, 0.1, 1, 10, 1e3, 1e9, 1e12]) {
    it.each([
      [0, 0.01], [-4, 4], [2, 19], [-19, -2],
    ])("keeps ordered, accurate, distinct labels for [%s, %s] at scale " + scale, (lo, hi) => {
      const { values, step } = niceTicks(lo * scale, hi * scale, 4);
      expect(values.length).toBeGreaterThan(1);
      const labels = values.map(value => fmtTick(value, step));
      expect(new Set(labels).size).toBe(values.length);
      const numbers = labels.map(Number);
      numbers.forEach((value, index) => {
        expect(Number.isFinite(value)).toBe(true);
        expect(Math.abs(value - values[index])).toBeLessThanOrEqual(
          Math.max(step * 1e-9, Math.abs(values[index]) * Number.EPSILON * 4),
        );
        if (index > 0) expect(value).toBeGreaterThan(numbers[index - 1]);
      });
    });
  }
});
