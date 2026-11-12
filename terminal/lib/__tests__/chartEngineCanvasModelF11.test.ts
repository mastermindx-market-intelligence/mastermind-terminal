// F-11: timeScale behaviour options (LWC §1.5 / dev:12345-12370, 5998-6028,
// 6112-6115, 6574-6603, 7105-7109). Fails on BASE because applyTimeScaleOptions
// only stores rightOffset/barSpacing and ignores the rest.
import { describe, expect, it } from "vitest";

import { ChartModel } from "@/lib/chart-engine/canvas/model";
import type { EngineSeriesRow } from "@/lib/chart-engine/api";

function rows(n: number): EngineSeriesRow[] {
  return Array.from({ length: n }, (_, i) => ({ time: 1000 * (i + 1), value: i + 1 }));
}

function mounted(n = 10, width = 200): { m: ChartModel; ts: ReturnType<ChartModel["timeScaleHandleFor"]> } {
  const m = new ChartModel({ onInvalidate: () => undefined, onStructure: () => undefined });
  m.applyOptions({ width, height: 100 });
  m.addSeries("line").setData(rows(n));
  return { m, ts: m.timeScaleHandleFor() };
}

describe("F-11 timeScale behaviour options", () => {
  it("rightOffset shifts the visible window", () => {
    const { ts } = mounted(10, 200);
    ts.applyOptions({ rightOffset: 3 });
    expect(ts.options().rightOffset).toBe(3);
    expect(ts.getVisibleLogicalRange()).toEqual({ from: 3, to: 13 });
  });

  it("barSpacing sets the logical span from width", () => {
    const { ts } = mounted(5, 200);
    ts.applyOptions({ barSpacing: 20 });
    expect(ts.options().barSpacing).toBe(20);
    const lr = ts.getVisibleLogicalRange()!;
    expect(lr.to - lr.from).toBeCloseTo(10, 6);
  });

  it("minBarSpacing clamps a too-small barSpacing", () => {
    const { ts } = mounted(10, 200);
    ts.applyOptions({ minBarSpacing: 25, barSpacing: 5 });
    expect(ts.options().barSpacing).toBe(25);
    const lr = ts.getVisibleLogicalRange()!;
    expect(lr.to - lr.from).toBeCloseTo(200 / 25, 6);
  });

  it("maxBarSpacing clamps a too-large barSpacing", () => {
    const { ts } = mounted(10, 200);
    ts.applyOptions({ maxBarSpacing: 10, barSpacing: 50 });
    expect(ts.options().barSpacing).toBe(10);
    const lr = ts.getVisibleLogicalRange()!;
    expect(lr.to - lr.from).toBeCloseTo(20, 6);
  });

  it("fixLeftEdge clamps scroll so the first bar stays reachable", () => {
    const { m, ts } = mounted(10, 200);
    ts.applyOptions({ barSpacing: 40, fixLeftEdge: true });
    ts.scrollToPosition(-40);
    const lr = ts.getVisibleLogicalRange()!;
    expect(lr.from).toBeCloseTo(0, 5);
    expect(lr.to - lr.from).toBeCloseTo(5, 5);
    expect(m.time.rightOffset).toBeCloseTo(lr.to - 10, 5);
  });

  it("fixRightEdge clamps rightOffset to 0", () => {
    const { ts } = mounted(10, 200);
    ts.applyOptions({ fixRightEdge: true, rightOffset: 8 });
    expect(ts.options().rightOffset).toBe(0);
    expect(ts.getVisibleLogicalRange()).toEqual({ from: 0, to: 10 });
  });

  it("lockVisibleTimeRangeOnResize keeps the logical window when width changes", () => {
    const { m, ts } = mounted(10, 200);
    ts.setVisibleLogicalRange({ from: 0, to: 10 });
    m.applyOptions({ width: 100, timeScale: { lockVisibleTimeRangeOnResize: true } });
    expect(ts.getVisibleLogicalRange()).toEqual({ from: 0, to: 10 });
    expect(ts.options().barSpacing).toBeCloseTo(10, 6);
  });

  it("without lockVisibleTimeRangeOnResize a width change keeps barSpacing", () => {
    const { m, ts } = mounted(10, 200);
    ts.applyOptions({ barSpacing: 20 });
    const spacing = ts.options().barSpacing as number;
    m.applyOptions({ width: 100 });
    expect(ts.options().barSpacing).toBeCloseTo(spacing, 6);
    const lr = ts.getVisibleLogicalRange()!;
    expect(lr.to - lr.from).toBeCloseTo(100 / spacing, 6);
  });

  it("rightBarStaysOnScroll keeps the right edge when barSpacing changes", () => {
    const { ts } = mounted(10, 200);
    ts.setVisibleLogicalRange({ from: 0, to: 10 });
    ts.applyOptions({ rightBarStaysOnScroll: true, barSpacing: 40 });
    const lr = ts.getVisibleLogicalRange()!;
    expect(lr.to).toBeCloseTo(10, 6);
    expect(lr.from).toBeCloseTo(5, 6);
  });

  it("shiftVisibleRangeOnNewBar true shifts the window by one bar at realtime", () => {
    const { m, ts } = mounted(10, 200);
    ts.applyOptions({ shiftVisibleRangeOnNewBar: true });
    expect(ts.getVisibleLogicalRange()).toEqual({ from: 0, to: 10 });
    m.seriesHandle(m.primarySeries()!.id)!.update({ time: 11000, value: 99 });
    expect(ts.getVisibleLogicalRange()).toEqual({ from: 1, to: 11 });
  });

  it("shiftVisibleRangeOnNewBar false keeps the window when a bar is appended", () => {
    const { m, ts } = mounted(10, 200);
    ts.applyOptions({ shiftVisibleRangeOnNewBar: false });
    m.seriesHandle(m.primarySeries()!.id)!.update({ time: 11000, value: 99 });
    expect(ts.getVisibleLogicalRange()).toEqual({ from: 0, to: 10 });
  });

  it("engine applyOptions(timeScale) forwards rightOffset the same way", () => {
    const { m, ts } = mounted(10, 200);
    m.applyOptions({ timeScale: { rightOffset: 2 } });
    expect(ts.options().rightOffset).toBe(2);
    expect(ts.getVisibleLogicalRange()).toEqual({ from: 2, to: 12 });
  });

  it("display-only timeScale options are stored and echoed", () => {
    const { ts } = mounted(10, 200);
    ts.applyOptions({
      timeVisible: true,
      secondsVisible: false,
      visible: true,
      borderVisible: false,
      borderColor: "#abcabc",
    });
    expect(ts.options()).toMatchObject({
      timeVisible: true,
      secondsVisible: false,
      visible: true,
      borderVisible: false,
      borderColor: "#abcabc",
    });
    expect(ts.getVisibleLogicalRange()).toEqual({ from: 0, to: 10 });
  });
});
