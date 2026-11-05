import { describe, expect, it } from "vitest";
import type { EngineBarRow, EnginePointRow, EngineSeriesOptions } from "@/lib/chart-engine/api";
import {
  areaGeometry,
  barBodyWidth,
  barGeometry,
  baselineGeometry,
  candleGeometry,
  createProjection,
  extentsOf,
  histogramGeometry,
  lineGeometry,
  snap,
  visibleSlice,
  type Projection,
} from "@/lib/chart-engine/canvas/series";
import { axisLayout, layoutPanes, priceAxisWidthFor } from "@/lib/chart-engine/canvas/layout";

// Fixed 7-bar fixture: one whitespace row (index 2) and one NaN close (index 3).
// Projection: width 700, barSpacing 100, price 90..110 over 200px.

const BARS: EngineBarRow[] = [
  { time: 1, open: 100, high: 105, low: 95, close: 102 },
  { time: 2, open: 102, high: 108, low: 100, close: 101 },
  { time: 3 },
  { time: 4, open: 101, high: 110, low: 91, close: Number.NaN },
  { time: 5, open: 99, high: 103, low: 97, close: 103 },
  { time: 6, open: 103, high: 109, low: 102, close: 104 },
  { time: 7, open: 104, high: 107, low: 98, close: 99 },
];

const POINTS: EnginePointRow[] = [
  { time: 1, value: 100 },
  { time: 2, value: 102 },
  { time: 3 },
  { time: 4, value: Number.NaN },
  { time: 5, value: 103 },
  { time: 6, value: 104 },
  { time: 7, value: 99 },
];

const HIST: EnginePointRow[] = [
  { time: 1, value: 105, color: "#abcabc" },
  { time: 2, value: 95 },
  { time: 3 },
  { time: 4, value: Number.NaN },
  { time: 5, value: 108 },
  { time: 6, value: 92 },
  { time: 7, value: 100 },
];

const CANDLE_OPTS: EngineSeriesOptions = {
  upColor: "#111111",
  downColor: "#222222",
  borderVisible: true,
  wickVisible: true,
  borderUpColor: "#010101",
  borderDownColor: "#020202",
  wickUpColor: "#333333",
  wickDownColor: "#444444",
};

function proj(dpr: number, extra?: Partial<{
  visibleFrom: number; visibleTo: number; widthPx: number; heightPx: number;
}>): Projection {
  return createProjection({
    dpr,
    widthPx: extra?.widthPx ?? 700,
    heightPx: extra?.heightPx ?? 200,
    visibleFrom: extra?.visibleFrom ?? 0,
    visibleTo: extra?.visibleTo ?? 7,
    priceFrom: 90,
    priceTo: 110,
  });
}

function y(p: number, dpr: number): number {
  return snap((110 - p) * 10, dpr);
}

describe("barBodyWidth", () => {
  it("uses floor(barSpacing * 0.7) clamped to >= 1 with a 1px gap when spacing >= 3", () => {
    expect(barBodyWidth(100, 1)).toBe(70);
    expect(barBodyWidth(100, 2)).toBe(70);
    expect(barBodyWidth(3, 1)).toBe(2);
    expect(barBodyWidth(0.5, 1)).toBe(1);
  });
});

describe("visibleSlice", () => {
  it("returns the full 7-bar window with one bar of overscan on each side", () => {
    expect(visibleSlice(BARS, proj(1))).toEqual([0, 6]);
  });

  it("overscans one bar past a partial window and clamps to the row bounds", () => {
    const p = proj(1, { visibleFrom: 2, visibleTo: 5, widthPx: 300 });
    expect(visibleSlice(BARS, p)).toEqual([1, 5]);
  });
});

describe("candleGeometry", () => {
  it("emits snapped bodies and wicks for a known projection at dpr 1 and dpr 2", () => {
    for (const dpr of [1, 2]) {
      const g = candleGeometry(BARS, proj(dpr), CANDLE_OPTS);
      expect(g.slice).toEqual([0, 6]);
      expect(g.visual).toBeNull();
      expect(g.bodies.map((b) => b.index)).toEqual([0, 1, 4, 5, 6]);
      expect(g.wicks.map((w) => w.index)).toEqual([0, 1, 4, 5, 6]);
      expect(g.bodies[0]).toMatchObject({
        index: 0, time: 1, x: 50, yOpen: y(100, dpr), yClose: y(102, dpr),
        width: 70, up: true, color: "#111111", borderVisible: true, borderColor: "#010101",
      });
      expect(g.wicks[0]).toMatchObject({
        index: 0, time: 1, x: 50, yHigh: y(105, dpr), yLow: y(95, dpr),
        visible: true, color: "#333333",
      });
      expect(g.bodies[1]).toMatchObject({
        index: 1, x: 150, yOpen: y(102, dpr), yClose: y(101, dpr), up: false, color: "#222222",
        borderColor: "#020202",
      });
      expect(g.wicks[1]).toMatchObject({ color: "#444444", visible: true });
      expect(g.bodies[2]).toMatchObject({ index: 4, x: 450, up: true });
      expect(g.bodies[3]).toMatchObject({ index: 5, x: 550, up: true });
      expect(g.bodies[4]).toMatchObject({ index: 6, x: 650, up: false, color: "#222222" });
    }
  });

  it("skips whitespace and NaN-close rows and never hardcodes up/down colors", () => {
    const g = candleGeometry(BARS, proj(1), CANDLE_OPTS);
    expect(g.bodies.some((b) => b.index === 2 || b.index === 3)).toBe(false);
    expect(g.bodies.map((b) => b.color).every((c) => c === "#111111" || c === "#222222")).toBe(true);
  });

  it("reads borderVisible / wickVisible from opts", () => {
    const g = candleGeometry(BARS, proj(1), { ...CANDLE_OPTS, borderVisible: false, wickVisible: false });
    expect(g.bodies.every((b) => b.borderVisible === false)).toBe(true);
    expect(g.wicks.every((w) => w.visible === false)).toBe(true);
  });

  it("snaps a half-pixel price differently at dpr 1 and dpr 2", () => {
    const row: EngineBarRow[] = [{ time: 1, open: 100.05, high: 100.05, low: 100.05, close: 100.05 }];
    const raw = (110 - 100.05) * 10; // 99.5
    expect(candleGeometry(row, proj(1), CANDLE_OPTS).bodies[0].yOpen).toBe(snap(raw, 1));
    expect(candleGeometry(row, proj(2), CANDLE_OPTS).bodies[0].yOpen).toBe(snap(raw, 2));
    expect(snap(raw, 1)).toBe(100);
    expect(snap(raw, 2)).toBe(99.5);
  });

  it("computes geometry only for the visible slice plus overscan", () => {
    const g = candleGeometry(BARS, proj(1, { visibleFrom: 2, visibleTo: 5, widthPx: 300 }), CANDLE_OPTS);
    expect(g.slice).toEqual([1, 5]);
    expect(g.bodies.map((b) => b.index)).toEqual([1, 4, 5]);
  });
});

describe("barGeometry", () => {
  it("places open ticks left and close ticks right of the bar centre", () => {
    const g = barGeometry(BARS, proj(1), { ...CANDLE_OPTS, thinBars: false });
    expect(g.ticks.map((t) => t.index)).toEqual([0, 1, 4, 5, 6]);
    const t0 = g.ticks[0];
    expect(t0).toMatchObject({
      x: 50, yOpen: 100, yHigh: 50, yLow: 150, yClose: 80, openX: 15, closeX: 85,
      thinBars: false, up: true, color: "#111111", time: 1,
    });
  });

  it("honours thinBars with 1px open/close ticks", () => {
    const g = barGeometry(BARS, proj(1), { ...CANDLE_OPTS, thinBars: true });
    expect(g.ticks[0].thinBars).toBe(true);
    expect(g.ticks[0].openX).toBe(49);
    expect(g.ticks[0].closeX).toBe(51);
  });
});

describe("lineGeometry", () => {
  it("runs the polyline straight across whitespace and NaN — LWC keeps them out of the plot list, never a zero", () => {
    const g = lineGeometry(POINTS, proj(1), { lineType: 0, color: "#55aa55" });
    expect(g.segments).toHaveLength(1);
    expect(g.segments[0].points.map((p) => p.index)).toEqual([0, 1, 4, 5, 6]);
    expect(g.segments.flatMap((s) => s.points).every((p) => p.y !== 0 || p.value === 110)).toBe(true);
    expect(g.segments[0].points[0]).toMatchObject({ index: 0, time: 1, x: 50, y: 100, value: 100 });
    expect(g.segments[0].points[1]).toMatchObject({ index: 1, x: 150, y: 80, value: 102 });
    expect(g.segments[0].points[2]).toMatchObject({ index: 4, x: 450, y: 70, value: 103 });
    expect(g.segments[0].points[4]).toMatchObject({ index: 6, x: 650, y: 110, value: 99 });
  });

  it("expands step vertices horizontally then vertically (lineType 1)", () => {
    const g = lineGeometry(POINTS, proj(1), { lineType: 1 });
    expect(g.lineType).toBe(1);
    expect(g.segments[0].vertices).toEqual([
      { x: 50, y: 100 },
      { x: 150, y: 100 },
      { x: 150, y: 80 },
      { x: 450, y: 80 },
      { x: 450, y: 70 },
      { x: 550, y: 70 },
      { x: 550, y: 60 },
      { x: 650, y: 60 },
      { x: 650, y: 110 },
    ]);
  });

  it("emits LWC-style bezier controls for lineType 2, neighbours taken across the whitespace", () => {
    const g = lineGeometry(POINTS, proj(1), { lineType: 2 });
    expect(g.lineType).toBe(2);
    expect(g.segments).toHaveLength(1);
    expect(g.segments[0].curves).toHaveLength(4);
    // 0 -> 1: the after-neighbour is index 4 (x 450, y 70), not the end of a segment.
    expect(g.segments[0].curves![0]).toEqual({ cp1x: 67, cp1y: 97, cp2x: 83, cp2y: 85 });
    // 1 -> 4 spans the gap: before = index 0, after = index 5.
    expect(g.segments[0].curves![1]).toEqual({ cp1x: 217, cp1y: 75, cp2x: 383, cp2y: 73 });
  });
});

describe("areaGeometry", () => {
  it("closes the line down to the pane bottom, one fill across the whitespace", () => {
    const g = areaGeometry(POINTS, proj(1), { lineType: 0 });
    expect(g.baselineY).toBe(200);
    expect(g.fills).toHaveLength(1);
    expect(g.fills[0].closed).toBe(true);
    expect(g.fills[0].vertices).toEqual([
      { x: 50, y: 100 },
      { x: 150, y: 80 },
      { x: 450, y: 70 },
      { x: 550, y: 60 },
      { x: 650, y: 110 },
      { x: 650, y: 200 },
      { x: 50, y: 200 },
    ]);
  });

  it("fills to a price baseline when opts.base is set", () => {
    const g = areaGeometry(POINTS, proj(1), { base: 100 });
    expect(g.baselineY).toBe(100);
  });
});

describe("histogramGeometry", () => {
  it("uses candle body width, honours per-point color, and places negatives below base", () => {
    const g = histogramGeometry(HIST, proj(1), { base: 100, color: "#999999" });
    expect(g.columns.map((c) => c.index)).toEqual([0, 1, 4, 5, 6]);
    expect(g.columns[0]).toMatchObject({
      index: 0, time: 1, x: 50, y: 50, yBase: 100, width: 70, color: "#abcabc",
    });
    expect(g.columns[1]).toMatchObject({ index: 1, x: 150, y: 150, yBase: 100, color: "#999999" });
    expect(g.columns[1].y).toBeGreaterThan(g.columns[1].yBase);
    expect(g.columns[0].y).toBeLessThan(g.columns[0].yBase);
    expect(g.columns[3]).toMatchObject({ index: 5, y: 180, yBase: 100 });
    expect(g.columns[4]).toMatchObject({ index: 6, y: 100, yBase: 100 });
  });
});

describe("baselineGeometry", () => {
  it("splits above/below opts.baseValue with a crossing on the baseline", () => {
    const g = baselineGeometry(POINTS, proj(1), { baseValue: { type: "price", price: 100 }, lineType: 0 });
    expect(g.basePrice).toBe(100);
    expect(g.baseY).toBe(100);
    const aboveIdx = g.above.segments.flatMap((s) => s.points.filter((p) => p.value > 100).map((p) => p.index));
    const belowIdx = g.below.segments.flatMap((s) => s.points.filter((p) => p.value < 100).map((p) => p.index));
    expect(g.above.segments[0].points[0]).toMatchObject({ index: 0, value: 100 });
    expect(aboveIdx).toEqual([1, 4, 5]);
    expect(belowIdx).toEqual([6]);
    const cross = g.below.segments[0].points[0];
    expect(cross.value).toBe(100);
    expect(cross.x).toBe(630);
    expect(cross.y).toBe(100);
    expect(g.above.fills.length).toBeGreaterThan(0);
    expect(g.below.fills.length).toBeGreaterThan(0);
    // Whitespace is not a break: the above-side line runs from index 1 straight to index 4.
    expect(g.above.segments.some((s) => s.points.some((p) => p.index === 1) && s.points.some((p) => p.index === 4))).toBe(true);
  });
});

describe("extentsOf", () => {
  it("ignores whitespace and uses only finite OHLC values", () => {
    expect(extentsOf(BARS, 0, 6, "candles")).toEqual({ min: 91, max: 110 });
    expect(extentsOf(BARS, 0, 6, "bars")).toEqual({ min: 91, max: 110 });
    expect(extentsOf(POINTS, 0, 6, "line")).toEqual({ min: 99, max: 104 });
    expect(extentsOf(POINTS, 0, 6, "area")).toEqual({ min: 99, max: 104 });
  });

  it("honours histogram base and baseline value", () => {
    expect(extentsOf(HIST, 0, 6, "histogram", { base: 0 })).toEqual({ min: 0, max: 108 });
    expect(extentsOf(HIST, 0, 6, "histogram", { base: 100 })).toEqual({ min: 92, max: 108 });
    expect(extentsOf(
      [{ time: 1, value: 105 }, { time: 2, value: 106 }],
      0, 1, "baseline",
      { baseValue: { type: "price", price: 100 } },
    )).toEqual({ min: 100, max: 106 });
  });
});

describe("layoutPanes", () => {
  it("distributes leftover height by stretch after separators", () => {
    const three = layoutPanes(201, [{ stretch: 1 }, { stretch: 1 }, { stretch: 2 }], 1);
    expect(three).toEqual([
      { top: 0, height: 50 },
      { top: 51, height: 50 },
      { top: 102, height: 99 },
    ]);
  });

  it("re-distributes to remaining panes and keeps order when an empty pane is removed", () => {
    const three = layoutPanes(201, [{ stretch: 1 }, { stretch: 1 }, { stretch: 2 }], 1);
    const two = layoutPanes(201, [{ stretch: 1 }, { stretch: 2 }], 1);
    expect(two).toHaveLength(2);
    expect(two[0].top).toBe(0);
    expect(two[1].top).toBe(two[0].height + 1);
    expect(two[0].height).toBeGreaterThan(three[0].height);
    expect(two[1].height).toBeGreaterThan(three[2].height);
    expect(two[0].height + 1 + two[1].height).toBe(201);
  });

  it("honours fixedHeightPx panes before stretch", () => {
    const laid = layoutPanes(200, [
      { stretch: 0, fixedHeightPx: 40 },
      { stretch: 1 },
      { stretch: 1 },
    ], 1);
    expect(laid[0]).toEqual({ top: 0, height: 40 });
    expect(laid[1].height).toBe(79);
    expect(laid[2].height).toBe(79);
    expect(laid[2].top).toBe(121);
  });
});

describe("axisLayout / priceAxisWidthFor", () => {
  it("places the price axis on the requested side and sizes the time axis to the plot width", () => {
    const right = axisLayout(800, 60, 24, "right");
    expect(right.plot).toMatchObject({ x: 0, width: 740 });
    expect(right.priceAxis).toMatchObject({ x: 740, width: 60 });
    expect(right.timeAxis).toMatchObject({ x: 0, width: 740, height: 24 });
    const left = axisLayout(800, 60, 24, "left");
    expect(left.plot).toMatchObject({ x: 60, width: 740 });
    expect(left.priceAxis).toMatchObject({ x: 0, width: 60 });
    expect(left.timeAxis).toMatchObject({ x: 60, width: 740, height: 24 });
  });

  it("adds padding to the widest label and rounds even like LWC", () => {
    expect(priceAxisWidthFor([40, 55, 30], 8)).toBe(64);
    expect(priceAxisWidthFor([], 8)).toBe(8);
  });
});

describe("dense visual geometry (R02-A02) + 40k stress", () => {
  it("collapses 40k rows at barSpacing 0.05 to <= 2*widthPx columns without losing extrema", () => {
    const n = 40_000;
    const widthPx = 2000;
    const rows: EngineBarRow[] = new Array(n);
    const highAt = 12_345;
    const lowAt = 23_456;
    for (let i = 0; i < n; i++) {
      const mid = 100 + ((i % 7) - 3) * 0.1;
      rows[i] = { time: i, open: mid, high: mid + 0.2, low: mid - 0.2, close: mid };
    }
    rows[highAt] = { time: highAt, open: 109, high: 110, low: 108, close: 109 };
    rows[lowAt] = { time: lowAt, open: 91, high: 92, low: 90, close: 91 };
    const p = createProjection({
      dpr: 1,
      widthPx,
      heightPx: 200,
      visibleFrom: 0,
      visibleTo: n,
      priceFrom: 90,
      priceTo: 110,
    });
    expect(p.xOfLogical(1) - p.xOfLogical(0)).toBeCloseTo(0.05, 12);
    const t0 = performance.now();
    const g = candleGeometry(rows, p, CANDLE_OPTS);
    const ms = performance.now() - t0;
    console.log(`R02 40k candleGeometry: ${ms.toFixed(2)} ms`);
    expect(g.visual).not.toBeNull();
    expect(g.visual!.kind).toBe("visual");
    expect(g.visual!.columns.length).toBeGreaterThan(0);
    expect(g.visual!.columns.length).toBeLessThanOrEqual(2 * widthPx);
    expect(g.slice).toEqual([0, n - 1]);
    const minYHigh = Math.min(...g.visual!.columns.map((c) => c.yHigh));
    const maxYLow = Math.max(...g.visual!.columns.map((c) => c.yLow));
    expect(minYHigh).toBe(snap(p.yOfPrice(110), 1));
    expect(maxYLow).toBe(snap(p.yOfPrice(90), 1));
    const highCol = g.visual!.columns.find((c) => c.fromIndex <= highAt && c.toIndex >= highAt);
    const lowCol = g.visual!.columns.find((c) => c.fromIndex <= lowAt && c.toIndex >= lowAt);
    expect(highCol).toBeDefined();
    expect(lowCol).toBeDefined();
    expect(ms).toBeLessThan(250);
  });
});
