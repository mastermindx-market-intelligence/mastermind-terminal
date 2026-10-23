// PaneHandle identity contract (M04 regression).
//
// The orchestrator diagnosed that the engine adapters (lwc/index.ts,
// canvas/model.ts) returned PaneHandle instances whose `.index()` and acting
// methods re-resolved through a captured slot index — POSITIONAL. swapPanes
// reorders the panes in the renderer's internal array; a positional handle
// therefore addressed the wrong pane after the swap, which is what made
// large-trades.spec.ts:981 and :1136 fail with `TypeError: Cannot read
// properties of null`. This file pins the IDENTITY semantic for both adapters:
//
//   • h0 = series0.pane()             // pre-swap, series0 is on pane A
//   • h2 = engine.panes()[2]          // pre-swap, slot 2 also holds pane A
//   • engine.swapPanes(0, 2)
//   • h0.index() === 2  (followed pane A)
//   • h2.index() === 0  (followed pane C — but wait, swap (0,2) means A and C swapped, so h2 holds C which is now at 0)
//   • h0.getSeries() still contains series0 (same SeriesHandle object)
//   • h2.getSeries() still contains series2 (same SeriesHandle object)
//   • h0.unwrap() === <raw object> (the underlying IPaneApi/PaneModel is STABLE)
//
// The lwcAdapter.test.ts mock had its swapPanes fleshed out and its pane's
// paneIndex()/getHeight() relaxed to read `__index` (instead of the captured
// make-time `index`), so a stored LwcPaneHandle that survives swapPanes
// reports its pane's NEW position. This file exercises the same contract
// against the live adapters.

import { describe, it, expect, vi, beforeEach } from "vitest";

// @vitest-environment jsdom
// (both adapters need a DOM — LWC creates a real chart; the canvas engine
// touches HTMLCanvasElement for takeScreenshot.)

// ─────────────────────────────────────────────────────────────────────────────
// Local "lwc fake" — copy the minimal surface from lwcAdapter.test.ts but keep
// the panes store live (swapPanes mutates it), so an LwcPaneHandle built
// before the swap reports its pane's NEW position through `pane.paneIndex()`.
// ─────────────────────────────────────────────────────────────────────────────

type FakeP = {
  __index: number;
  __series: FakeS[];
  __stretch: { value: number };
  __height: { value: number };
  paneIndex: ReturnType<typeof vi.fn>;
  getSeries: ReturnType<typeof vi.fn>;
  getHeight: ReturnType<typeof vi.fn>;
  setHeight: ReturnType<typeof vi.fn>;
  getStretchFactor: ReturnType<typeof vi.fn>;
  setStretchFactor: ReturnType<typeof vi.fn>;
  getHTMLElement: ReturnType<typeof vi.fn>;
  priceScale: ReturnType<typeof vi.fn>;
};
type FakeS = { __paneIndex: number; getPane: ReturnType<typeof vi.fn>; priceLines: ReturnType<typeof vi.fn>; setData: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; applyOptions: ReturnType<typeof vi.fn>; options: ReturnType<typeof vi.fn>; data: ReturnType<typeof vi.fn>; dataByIndex: ReturnType<typeof vi.fn>; createPriceLine: ReturnType<typeof vi.fn>; removePriceLine: ReturnType<typeof vi.fn>; priceToCoordinate: ReturnType<typeof vi.fn>; coordinateToPrice: ReturnType<typeof vi.fn>; moveToPane: ReturnType<typeof vi.fn>; priceScale: ReturnType<typeof vi.fn>; attachPrimitive: ReturnType<typeof vi.fn>; detachPrimitive: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; _private__pane: FakeP };

const H = vi.hoisted(() => {
  const makePane = (index: number): FakeP => {
    const stretch = { value: index + 1 };
    const height = { value: 100 + index };
    const pane: FakeP = {
      __index: index,
      __series: [],
      __stretch: stretch,
      __height: height,
      paneIndex: vi.fn(() => pane.__index),
      getSeries: vi.fn(() => pane.__series),
      getHeight: vi.fn(() => height.value),
      setHeight: vi.fn((h: number) => { height.value = h; }),
      getStretchFactor: vi.fn(() => stretch.value),
      setStretchFactor: vi.fn((f: number) => { stretch.value = f; }),
      getHTMLElement: vi.fn(() => ({ __paneEl: pane.__index })),
      priceScale: vi.fn(() => ({ width: () => 57, applyOptions: () => undefined, options: () => ({}), getVisibleRange: () => null, setVisibleRange: () => undefined, setAutoScale: () => undefined })),
    };
    return pane;
  };
  const reg: { charts: { __panes: FakeP[]; swapPanes: ReturnType<typeof vi.fn>; panes: ReturnType<typeof vi.fn>; addSeries: ReturnType<typeof vi.fn>; removeSeries: ReturnType<typeof vi.fn>; timeScale: ReturnType<typeof vi.fn>; priceScale: ReturnType<typeof vi.fn>; paneSize: ReturnType<typeof vi.fn>; chartElement: ReturnType<typeof vi.fn>; options: ReturnType<typeof vi.fn>; applyOptions: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; setCrosshairPosition: ReturnType<typeof vi.fn>; clearCrosshairPosition: ReturnType<typeof vi.fn>; subscribeCrosshairMove: ReturnType<typeof vi.fn>; unsubscribeCrosshairMove: ReturnType<typeof vi.fn>; subscribeClick: ReturnType<typeof vi.fn>; unsubscribeClick: ReturnType<typeof vi.fn>; subscribeDblClick: ReturnType<typeof vi.fn>; unsubscribeDblClick: ReturnType<typeof vi.fn>; takeScreenshot: ReturnType<typeof vi.fn> }[] } = { charts: [] };
  const createChart = vi.fn((_container: unknown, _opts: unknown) => {
    const chart = {
      __panes: [makePane(0)],
      panes: vi.fn(() => chart.__panes),
      timeScale: vi.fn(() => ({
        getVisibleLogicalRange: () => ({ from: 0, to: 1 }),
        setVisibleLogicalRange: () => undefined,
        subscribeVisibleLogicalRangeChange: () => undefined,
        unsubscribeVisibleLogicalRangeChange: () => undefined,
        timeToCoordinate: () => 0,
        coordinateToTime: () => 0,
        scrollToRealTime: () => undefined,
        scrollToPosition: () => undefined,
        applyOptions: () => undefined,
        fitContent: () => undefined,
        getVisibleRange: () => ({ from: 0, to: 1 }),
        setVisibleRange: () => undefined,
        logicalToCoordinate: () => null,
        coordinateToLogical: () => null,
        width: () => 800,
        timeToIndex: () => 0,
        options: () => ({}),
      })),
      addSeries: vi.fn((_def: unknown, _opts: unknown, paneIndex?: number) => {
        const pi = paneIndex ?? 0;
        const idx = Math.min(chart.__panes.length, pi);
        while (chart.__panes.length <= idx) chart.__panes.push(makePane(chart.__panes.length));
        const series: FakeS = {
          __paneIndex: idx,
          getPane: vi.fn(() => chart.__panes[series.__paneIndex]!),
          priceLines: vi.fn(() => []),
          setData: vi.fn(),
          update: vi.fn(),
          applyOptions: vi.fn(),
          options: vi.fn(() => ({})),
          data: vi.fn(() => []),
          dataByIndex: vi.fn(() => null),
          createPriceLine: vi.fn(() => ({ applyOptions: () => undefined, options: () => ({}), remove: () => undefined })),
          removePriceLine: vi.fn(),
          priceToCoordinate: vi.fn(() => null),
          coordinateToPrice: vi.fn(() => null),
          moveToPane: vi.fn((to: number) => {
            const from = chart.__panes[series.__paneIndex];
            if (from) {
              const at = from.__series.indexOf(series);
              if (at !== -1) from.__series.splice(at, 1);
            }
            while (chart.__panes.length <= to) chart.__panes.push(makePane(chart.__panes.length));
            const slot = Math.min(to, chart.__panes.length - 1);
            series.__paneIndex = slot;
            chart.__panes[slot]!.__series.push(series);
          }),
          priceScale: vi.fn(() => ({ width: () => 57, applyOptions: () => undefined, options: () => ({}), getVisibleRange: () => null, setVisibleRange: () => undefined, setAutoScale: () => undefined })),
          attachPrimitive: vi.fn(),
          detachPrimitive: vi.fn(),
          remove: vi.fn(() => {
            for (const p of chart.__panes) {
              const at = p.__series.indexOf(series);
              if (at !== -1) p.__series.splice(at, 1);
            }
          }),
          _private__pane: undefined as unknown as FakeP,
        };
        series.getPane = vi.fn(() => chart.__panes[series.__paneIndex]!);
        series._private__pane = chart.__panes[idx]!;
        chart.__panes[idx]!.__series.push(series);
        return series;
      }),
      removeSeries: vi.fn((series: FakeS) => {
        for (const p of chart.__panes) {
          const at = p.__series.indexOf(series);
          if (at !== -1) p.__series.splice(at, 1);
        }
      }),
      // Live swapPanes — reorders chart.__panes, updates each pane's __index,
      // and slides each series' __paneIndex so series.getPane() lands on the
      // right pane after the reorder.
      swapPanes: vi.fn((first: number, second: number) => {
        if (first === second) return;
        const a = chart.__panes[first];
        const b = chart.__panes[second];
        if (!a || !b) return;
        chart.__panes[first] = b;
        chart.__panes[second] = a;
        a.__index = second;
        b.__index = first;
        for (const pane of chart.__panes) {
          const slot = chart.__panes.indexOf(pane);
          for (const s of pane.__series) s.__paneIndex = slot;
        }
      }),
      applyOptions: vi.fn(),
      resize: vi.fn(),
      remove: vi.fn(),
      priceScale: vi.fn(),
      paneSize: vi.fn(),
      chartElement: vi.fn(() => ({ __chartEl: true })),
      options: vi.fn(() => ({})),
      setCrosshairPosition: vi.fn(),
      clearCrosshairPosition: vi.fn(),
      subscribeCrosshairMove: vi.fn(),
      unsubscribeCrosshairMove: vi.fn(),
      subscribeClick: vi.fn(),
      unsubscribeClick: vi.fn(),
      subscribeDblClick: vi.fn(),
      unsubscribeDblClick: vi.fn(),
      takeScreenshot: vi.fn(() => ({ __canvas: true })),
    };
    reg.charts.push(chart);
    return chart;
  });
  const createSeriesMarkers = vi.fn(() => ({ setMarkers: vi.fn(), detach: vi.fn() }));
  const createTextWatermark = vi.fn(() => ({ detach: vi.fn() }));
  const defs = {
    CandlestickSeries: { seriesType: "Candlestick" },
    BarSeries: { seriesType: "Bar" },
    LineSeries: { seriesType: "Line" },
    AreaSeries: { seriesType: "Area" },
    HistogramSeries: { seriesType: "Histogram" },
    BaselineSeries: { seriesType: "Baseline" },
  };
  const MismatchDirection = { NearestLeft: -1, None: 0, NearestRight: 1 } as const;
  return { reg, createChart, createSeriesMarkers, createTextWatermark, defs, MismatchDirection };
});

vi.mock("lightweight-charts", () => ({
  createChart: H.createChart,
  createSeriesMarkers: H.createSeriesMarkers,
  createTextWatermark: H.createTextWatermark,
  CandlestickSeries: H.defs.CandlestickSeries,
  BarSeries: H.defs.BarSeries,
  LineSeries: H.defs.LineSeries,
  AreaSeries: H.defs.AreaSeries,
  HistogramSeries: H.defs.HistogramSeries,
  BaselineSeries: H.defs.BaselineSeries,
  MismatchDirection: H.MismatchDirection,
}));

// Recording 2D context (jsdom has no real canvas; the canvas engine calls
// getContext("2d") on takeScreenshot).
type CtxCall = { method: string; args: unknown[] };
type RecordingCtx = CanvasRenderingContext2D & { __calls: CtxCall[] };
function makeRecordingCtx(): RecordingCtx {
  const calls: CtxCall[] = [];
  const props: Record<string, unknown> = {};
  const rec = (method: string) => (...args: unknown[]) => { calls.push({ method, args }); };
  const ctx: Record<string, unknown> = {
    __calls: calls,
    measureText: (text: unknown) => ({ width: String(text).length * 7 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createPattern: () => null,
  };
  for (const m of [
    "setTransform", "resetTransform", "fillRect", "clearRect", "strokeRect", "drawImage",
    "beginPath", "closePath", "moveTo", "lineTo", "stroke", "fill", "clip", "rect", "arc",
    "arcTo", "ellipse", "quadraticCurveTo", "bezierCurveTo", "save", "restore", "scale",
    "translate", "rotate", "setLineDash", "fillText", "strokeText",
  ]) ctx[m] = rec(m);
  for (const k of [
    "fillStyle", "strokeStyle", "lineWidth", "font", "textAlign", "textBaseline",
    "globalAlpha", "lineCap", "lineJoin", "miterLimit", "shadowBlur", "shadowColor",
  ]) Object.defineProperty(ctx, k, { get: () => props[k], set: (v: unknown) => { props[k] = v; }, enumerable: true, configurable: true });
  return ctx as unknown as RecordingCtx;
}
const ctxByCanvas = new WeakMap<HTMLCanvasElement, RecordingCtx>();
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, type: string) {
  if (type !== "2d") return null;
  let ctx = ctxByCanvas.get(this);
  if (!ctx) { ctx = makeRecordingCtx(); ctxByCanvas.set(this, ctx); }
  return ctx as unknown as CanvasRenderingContext2D;
});

import { createLwcEngine } from "../chart-engine/lwc";
import { createCanvasEngine, createManualScheduler } from "../chart-engine/canvas";
import type { ChartEngine, PaneHandle, SeriesHandle } from "../chart-engine/api";

const lwcContainer = {} as unknown as HTMLElement;

function makeCanvas(): ChartEngine {
  const container = document.createElement("div");
  return createCanvasEngine(container, {
    width: 800, height: 400, devicePixelRatio: 1, resizeObserverCtor: null,
    scheduler: createManualScheduler(),
  });
}

beforeEach(() => { H.reg.charts.length = 0; vi.clearAllMocks(); });

function engineWithThreeSeriesAndPanes(e: ChartEngine): { s0: SeriesHandle; s1: SeriesHandle; s2: SeriesHandle; h0: PaneHandle; h1: PaneHandle; h2: PaneHandle; chartH2: PaneHandle } {
  const s0 = e.addSeries("candles", {}, 0);
  s0.setData([{ time: "2026-10-01", open: 1, high: 2, low: 1, close: 1.5 }]);
  const s1 = e.addSeries("line", {}, 1);
  s1.setData([{ time: "2026-10-01", value: 1 }]);
  const s2 = e.addSeries("histogram", {}, 2);
  s2.setData([{ time: "2026-10-01", value: 1 }]);
  const h0 = s0.pane();
  const h1 = s1.pane();
  const h2 = s2.pane();
  const chartH2 = e.panes()[2]!;
  // Sanity baseline.
  expect(h0.index()).toBe(0);
  expect(h1.index()).toBe(1);
  expect(h2.index()).toBe(2);
  expect(chartH2.index()).toBe(2);
  expect(h0.getSeries()).toContain(s0);
  expect(h2.getSeries()).toContain(s2);
  return { s0, s1, s2, h0, h1, h2, chartH2 };
}

describe("PaneHandle identity — LWC adapter", () => {
  it("after swapPanes(0,2), h0/h2 follow their pane and unwrap() is stable", () => {
    const e = createLwcEngine(lwcContainer);
    const { s0, s2, h0, h2, chartH2 } = engineWithThreeSeriesAndPanes(e);
    const unwrapped0Pre = h0.unwrap<FakeP>();
    const unwrapped2Pre = h2.unwrap<FakeP>();
    const unwrappedChart2Pre = chartH2.unwrap<FakeP>();
    e.swapPanes(0, 2);
    // Identity (not slot).
    expect(h0.index()).toBe(2);
    expect(h2.index()).toBe(0);
    expect(chartH2.index()).toBe(0);
    // getSeries() still includes the right series (same object).
    expect(h0.getSeries()).toContain(s0);
    expect(h0.getSeries()).not.toContain(s2);
    expect(h2.getSeries()).toContain(s2);
    expect(h2.getSeries()).not.toContain(s0);
    // unwrap() returns the SAME underlying IPaneApi before and after.
    expect(h0.unwrap<FakeP>()).toBe(unwrapped0Pre);
    expect(h2.unwrap<FakeP>()).toBe(unwrapped2Pre);
    expect(chartH2.unwrap<FakeP>()).toBe(unwrappedChart2Pre);
    // The IPaneApi's paneIndex() equals the handle's index() — the linchpin
    // identity claim (the orchestrator's spec, bullet 3).
    expect(unwrapped0Pre.paneIndex()).toBe(h0.index());
    expect(unwrapped0Pre.paneIndex()).toBe(2);
    expect(unwrapped2Pre.paneIndex()).toBe(0);
  });

  it("setStretchFactor writes route through h0's pane, not h2's", () => {
    const e = createLwcEngine(lwcContainer);
    const { h0, h2 } = engineWithThreeSeriesAndPanes(e);
    const unwrapped0 = h0.unwrap<FakeP>();
    const unwrapped2 = h2.unwrap<FakeP>();
    const callsBefore0 = unwrapped0.setStretchFactor.mock.calls.length;
    const callsBefore2 = unwrapped2.setStretchFactor.mock.calls.length;
    h0.setStretchFactor(5.2);
    const callsAfter0 = unwrapped0.setStretchFactor.mock.calls.length;
    const callsAfter2 = unwrapped2.setStretchFactor.mock.calls.length;
    expect(callsAfter0).toBe(callsBefore0 + 1); // h0's pane received the call
    expect(callsAfter2).toBe(callsBefore2);     // h2's pane did NOT
  });
});

describe("PaneHandle identity — canvas engine mm", () => {
  it("after swapPanes(0,2), h0/h2 follow their pane and unwrap() is stable", () => {
    const e = makeCanvas();
    const { s0, s2, h0, h2, chartH2 } = engineWithThreeSeriesAndPanes(e);
    const unwrapped0Pre = h0.unwrap<{ index: number }>();
    const unwrapped2Pre = h2.unwrap<{ index: number }>();
    const unwrappedChart2Pre = chartH2.unwrap<{ index: number }>();
    e.swapPanes(0, 2);
    expect(h0.index()).toBe(2);
    expect(h2.index()).toBe(0);
    expect(chartH2.index()).toBe(0);
    expect(h0.getSeries()).toContain(s0);
    expect(h0.getSeries()).not.toContain(s2);
    expect(h2.getSeries()).toContain(s2);
    expect(h2.getSeries()).not.toContain(s0);
    // The PaneModel is STABLE through the swap (the canvas engine moves the
    // SAME object between slots).
    expect(h0.unwrap<{ index: number }>()).toBe(unwrapped0Pre);
    expect(h2.unwrap<{ index: number }>()).toBe(unwrapped2Pre);
    expect(chartH2.unwrap<{ index: number }>()).toBe(unwrappedChart2Pre);
  });
});
describe("PaneHandle contract after pane removal / engine disposal — LWC adapter", () => {
  const oneBar = [{ time: "2026-10-01", open: 1, high: 2, low: 1, close: 1.5 } as const];
  it("a pane the renderer dropped reports index() -1; acting methods throw, reads stay quiet", () => {
    const e = createLwcEngine(lwcContainer);
    const s0 = e.addSeries("candles", {}, 0);
    s0.setData([...oneBar]);
    const s1 = e.addSeries("line", {}, 1);
    s1.setData([{ time: "2026-10-01", value: 1 }]);
    const held = s1.pane();
    // Model LWC's `_private__cleanupIfPaneIsEmpty`: the internal Pane is spliced out
    // of the chart's array, after which PaneApi.paneIndex() (= indexOf) answers -1.
    const chart = H.reg.charts[0]!;
    const dropped = chart.__panes[1]!;
    chart.__panes.splice(1, 1);
    dropped.__index = -1;
    expect(held.index()).toBe(-1);
    expect(() => held.height()).toThrow(/no longer exists/);
    expect(() => held.setHeight(50)).toThrow(/no longer exists/);
    expect(() => held.setStretchFactor(2)).toThrow(/no longer exists/);
    expect(() => held.stretchFactor()).toThrow(/no longer exists/);
    expect(() => held.unwrap<unknown>()).toThrow(/no longer exists/);
    expect(held.priceScale("right")).toBeTruthy(); // lazy: the resolver runs per call
    expect(() => held.priceScale("right").width()).toThrow(/no longer exists/);
    expect(held.getSeries()).toEqual([]); // quiet, like every other collection read
    expect(held.getHTMLElement()).toBeNull(); // real PaneApi.getHTMLElement() -> null
  });
  it("after destroy the handle is neutral: getHTMLElement() null, acting methods throw /disposed/", () => {
    const e = createLwcEngine(lwcContainer);
    const s0 = e.addSeries("candles", {}, 0);
    s0.setData([...oneBar]);
    const held = s0.pane();
    e.destroy();
    expect(held.getHTMLElement()).toBeNull();
    expect(held.getSeries()).toEqual([]);
    expect(() => held.height()).toThrow(/disposed/);
    expect(() => held.unwrap<unknown>()).toThrow(/disposed/);
    expect(e.inventory()).toMatchObject({ alive: false, panes: 0, series: 0 });
  });
});

describe("PaneHandle contract after engine disposal — canvas engine mm", () => {
  it("stays quiet at index -1 and unwrap() hands back a zeroed snapshot, never the live model", () => {
    const e = makeCanvas();
    const s0 = e.addSeries("candles", {}, 0);
    s0.setData([{ time: "2026-10-01", open: 1, high: 2, low: 1, close: 1.5 }]);
    const held = s0.pane();
    const raw = held.unwrap<{ height: number; seriesIds: unknown[] }>();
    expect(raw.height).toBeGreaterThan(0); // the live model really has geometry
    e.destroy();
    expect(held.index()).toBe(-1);
    expect(held.height()).toBe(0);
    expect(held.stretchFactor()).toBe(0);
    expect(held.getSeries()).toEqual([]);
    expect(held.getHTMLElement()).toBeNull();
    expect(() => held.setHeight(40)).not.toThrow();
    expect(() => held.setStretchFactor(2)).not.toThrow();
    // Q01-C13 forbids resurrection: a destroyed handle must not keep exposing the
    // live internal PaneModel (LwcPaneHandle.unwrap() throws "disposed" here).
    const after = held.unwrap<{ height: number; seriesIds: unknown[] }>();
    expect(after.height).toBe(0);
    expect(after.seriesIds).toEqual([]);
    expect(e.inventory()).toMatchObject({ alive: false, panes: 0, series: 0 });
  });
  it("a pane emptied by remove() is dropped as on LWC; the held handle reports -1, acting methods throw, reads stay quiet", () => {
    const e = makeCanvas();
    const s0 = e.addSeries("candles", {}, 0);
    s0.setData([{ time: "2026-10-01", open: 1, high: 2, low: 1, close: 1.5 }]);
    const s1 = e.addSeries("line", {}, 1);
    s1.setData([{ time: "2026-10-01", value: 1 }]);
    const s2 = e.addSeries("histogram", {}, 2);
    s2.setData([{ time: "2026-10-01", value: 1 }]);
    const held = s1.pane();
    const below = s2.pane();
    s1.remove();
    // LWC `_private__cleanupIfPaneIsEmpty`: the emptied pane leaves the chart and
    // the pane below it moves up one slot, its handle following it.
    expect(e.inventory()).toMatchObject({ alive: true, panes: 2, seriesByPane: [1, 1] });
    expect(held.index()).toBe(-1);
    expect(() => held.height()).toThrow(/pane 1 no longer exists/);
    expect(() => held.setHeight(50)).toThrow(/no longer exists/);
    expect(() => held.setStretchFactor(2)).toThrow(/no longer exists/);
    expect(() => held.stretchFactor()).toThrow(/no longer exists/);
    expect(() => held.unwrap<unknown>()).toThrow(/no longer exists/);
    expect(held.getSeries()).toEqual([]);
    expect(held.getHTMLElement()).toBeNull();
    expect(below.index()).toBe(1);
    expect(s2.paneIndex()).toBe(1);
    expect(below.getSeries()).toHaveLength(1);
    // The last pane is never dropped, even when it is empty.
    s0.remove();
    s2.remove();
    expect(e.inventory()).toMatchObject({ alive: true, panes: 1, series: 0, seriesByPane: [0] });
  });
});
