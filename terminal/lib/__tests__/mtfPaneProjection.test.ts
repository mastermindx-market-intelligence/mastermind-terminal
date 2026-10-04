import { describe, expect, it } from "vitest";
import { momentumPoints, terminalStochastic, rsiMacd } from "../mtfMomentum";
import { MTF_TIMEFRAMES, isMtfPaneKey, mtfKnownAt, mtfMetrics, projectMtfMetric, selectedMtfLanes } from "../mtfPaneProjection";
import { IND_DEFS } from "../indicators";
import { LIVE_BAR_PROJECTION } from "../liveBarProjection";
import { MTF_COPY as LEX } from "../mtfPaneCopy";

const bars = (n: number) => Array.from({ length: n }, (_, i) => {
  const c = 100 + i / 100 + Math.sin(i / 4) * 8;
  return { time: new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), h: c + 2, l: c - 2, c };
});

describe("raw MTF projection", () => {
  it("warms raw stochastic without waiting for the 78-bar composite", () => {
    const source = bars(30), points = momentumPoints(source), times = source.map((b) => b.time);
    expect(points.at(-1)?.score).toBeNull();
    const k = projectMtfMetric(points, times, times, "stochK");
    const d = projectMtfMetric(points, times, times, "stochD");
    expect(k.at(-1)?.value).toBe(terminalStochastic(source).k.at(-1));
    expect(d.at(-1)?.value).toBe(terminalStochastic(source).d.at(-1));
    expect(k.at(-1)?.value).not.toBeNull();
    expect(projectMtfMetric(points, times, times, "score").every((p) => p.value === null)).toBe(true);
  });

  it("warms raw MACD before its signal and retains oscillator units", () => {
    const source = bars(75), points = momentumPoints(source), times = source.map((b) => b.time);
    const value = projectMtfMetric(points, times, times, "rsiMacd").at(-1)!.value;
    expect(value).toBe(rsiMacd(source.map((b) => b.c)).line.at(-1));
    expect(value).not.toBeNull();
    expect(projectMtfMetric(points, times, times, "rsiSignal").at(-1)?.value).toBeNull();
    expect(points.at(-1)?.score).toBeNull();
  });

  it("exposes source availability, not a backdated opening timestamp", () => {
    const source = bars(100), points = momentumPoints(source);
    const known = source.map((b) => b.time);
    const last = known.at(-1)!;
    known[99] = "2020-04-15";
    const out = projectMtfMetric(points, known, [last, "2020-04-15"], "stochK");
    expect(out[0]).toEqual({ value: points[98].stochK, availableSession: known[98] });
    expect(out[1]).toEqual({ value: points[99].stochK, availableSession: known[99] });
  });

  it.each(["stochK", "stochD", "rsiMacd", "rsiSignal", "score"] as const)("excludes the forming tail for %s", (metric) => {
    const source = bars(100), points = momentumPoints(source), times = source.map((b) => b.time);
    const known = mtfKnownAt(source, "D", times, 0, true);
    const before = projectMtfMetric(points, known, times, metric);
    const changed = source.map((b, i) => i === 99 ? { ...b, h: b.h * 3, l: b.l * 3, c: b.c * 3 } : b);
    expect(projectMtfMetric(momentumPoints(changed), known, times, metric)).toEqual(before);
    const final = projectMtfMetric(momentumPoints(changed), mtfKnownAt(source, "D", times, 0, false), times, metric);
    expect(final.at(-1)?.availableSession).toBe(times.at(-1));
    expect(final.at(-1)?.value).not.toBeNull();
  });

  it("does not invent signal values during warmup or before the first observation", () => {
    const source = bars(10), points = momentumPoints(source), times = source.map((b) => b.time);
    const out = projectMtfMetric(points, times, ["2019-12-31", ...times], "stochK");
    expect(out[0]).toEqual({ value: null, availableSession: null });
    expect(out.every((p) => p.value === null)).toBe(true);
  });

  it("aligns a historical prefix identically after a future suffix arrives", () => {
    const source = bars(120), times = source.map((b) => b.time);
    const prefix = source.slice(0, 90), prefixTimes = times.slice(0, 90);
    for (const metric of mtfMetrics("mtfstoch", true)) {
      expect(projectMtfMetric(momentumPoints(prefix), prefixTimes, prefixTimes, metric))
        .toEqual(projectMtfMetric(momentumPoints(source), times, prefixTimes, metric));
    }
  });

  it("uses the resolved daily-multiple phase and true completion separately", () => {
    const times = bars(6).map((b) => b.time);
    const source = [{ time: times[0], closeTime: times[2] }, { time: times[3], closeTime: times[5] }];
    expect(mtfKnownAt(source, "3D", times, 1, false)).toEqual([times[2], times[5]]);
    expect(mtfKnownAt(source, "3D", times, 1, true)).toEqual([times[2], null]);
    expect(mtfKnownAt(source, "3D", times, 0, false)).toEqual([times[2], null]);
  });

  it.each(["W", "2W", "1M"] as const)("holds %s until the next observed session", (tf) => {
    const times = ["2020-02-27", "2020-02-28", "2020-03-02"];
    const source = [{ time: "2020-02-28" }, { time: "2020-03-02" }];
    expect(mtfKnownAt(source, tf, times, 0, false)).toEqual(["2020-03-02", null]);
    expect(mtfKnownAt(source.slice(0, 1), tf, times.slice(0, 2), 0, false)).toEqual([null]);
  });

  it("refuses malformed availability instead of leaking future or unordered values", () => {
    const points = momentumPoints(bars(2));
    expect(() => projectMtfMetric(points, ["2020-01-01"], [], "score")).toThrow();
    expect(() => projectMtfMetric(points, [null, "2020-01-01"], [], "score")).toThrow();
    expect(() => projectMtfMetric(points, ["2020-01-02", "2020-01-01"], [], "score")).toThrow();
    expect(() => projectMtfMetric(points, ["2020-01-01", "2020-01-02"], ["2020-01-02", "2020-01-01"], "score")).toThrow();
  });
});

describe("native raw-pane configuration", () => {
  it("keeps raw families distinct, and signal lines opt-in", () => {
    expect(mtfMetrics("mtfstoch", false)).toEqual(["stochK"]);
    expect(mtfMetrics("mtfstoch", true)).toEqual(["stochK", "stochD"]);
    expect(mtfMetrics("mtfmacd", true)).toEqual(["rsiMacd", "rsiSignal"]);
    expect(mtfMetrics("mtfconfluence", true)).toEqual(["score"]);
  });
  it("preserves legacy settings and never substitutes a different horizon for an empty selection", () => {
    expect(selectedMtfLanes({}).map((lane) => lane.tf)).toEqual([...MTF_TIMEFRAMES]);
    expect(selectedMtfLanes({ d3On: false, mOn: false }).map((lane) => lane.tf)).toEqual(["D", "W", "2W"]);
    expect(selectedMtfLanes({ dOn: false, d3On: false, wOn: false, w2On: false, mOn: false })).toEqual([]);
  });
  it.each(["mtfstoch", "mtfmacd", "mtfconfluence"] as const)("registers %s with closed-bar updates and localized labels", (key) => {
    expect(isMtfPaneKey(key)).toBe(true);
    expect(IND_DEFS[key].kind).toBe("pane");
    expect(LIVE_BAR_PROJECTION[key]).toBe("closed-bar-series");
    expect(LEX[IND_DEFS[key].tkey!].every((s) => s.length > 0)).toBe(true);
    for (const field of IND_DEFS[key].fields.filter((f) => f.tkey)) expect(LEX[field.tkey!]).toHaveLength(2);
  });
});
