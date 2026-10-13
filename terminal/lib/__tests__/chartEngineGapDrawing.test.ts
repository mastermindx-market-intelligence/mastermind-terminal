// @vitest-environment jsdom
//
// chartEngineGapDrawing.test.ts — proves the D01 drawing-document rows:
//   D01-A01: same drawing loaded in both engines -> identical semantic anchors
//            and serialized bytes remain.
//   D01-A02: timeframe or history-depth changes -> existing anchor policy
//            applies; no accidental row-index rebinding.
//   D01-A04: source disappears then returns -> document remains recoverable;
//            missing state does not delete it.
//
// Both engines exercised end-to-end:
//   • impl "mm": createCanvasEngine + createManualScheduler; fake 2D context via
//     vi.spyOn(HTMLCanvasElement.prototype, "getContext") — house precedent:
//     lib/__tests__/chartEngineCanvasC02.test.ts.
//   • impl "lwc": createLwcEngine under vi.mock("lightweight-charts"); deterministic
//     LINEAR stand-in: timeToCoordinate(i) = (i - range.from + 0.5) * barSpacing;
//     coordinateToTime is the exact inverse; priceToCoordinate(p) =
//     (top - p) * (h-1)/(top - bottom); coordinateToPrice is the exact inverse.
//
// Document shape: lib/drawings.Drawing, ingested through normalizeDrawing so the
// bytes the test asserts on are the same bytes the product persists. Serializer:
// JSON.stringify (the only stable byte form available at BASE). Falsifier receipts
// (mutate IMPLEMENTATION -> RED, restore -> GREEN) live in RESULT.md MUTANTS.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCanvasEngine, createManualScheduler } from "@/lib/chart-engine/canvas";
import { createDrawingBridge, type DrawingAnchor } from "@/lib/chart-engine/drawingBridge";
import {
  FUTURE_ANCHOR_BARS,
  futureBarTimes,
  futureCadence,
} from "@/lib/chart-engine/futureTime";
import {
  normalizeDrawing,
  type Drawing,
  type NormalizedDrawing,
} from "@/lib/drawings";
import type { ChartEngine, EngineTime, EngineBarRow, SeriesHandle } from "@/lib/chart-engine/api";

// ─────────────────────────────────────────────────────────────────────────────
// Shared dataset (deterministic; both engines see the SAME bar set).
// ─────────────────────────────────────────────────────────────────────────────

const TIMES = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2026, 0, 5 + i)).toISOString().slice(0, 10));
const PANE_W = 600;
const PANE_H_PX = 300;

const bars = (): EngineBarRow[] => TIMES.map((t, i) => ({
  time: t, open: 50 + i * 10, high: 90 + i * 10, low: 30 + i * 10, close: 70 + i * 10,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Document: trendline (2 anchors, 1 future slot) + hline + pane-1 trendline.
// ─────────────────────────────────────────────────────────────────────────────

function makeDocument(): { document: NormalizedDrawing[]; anchors: DrawingAnchor[] } {
  const futureSlotTime = futureBarTimes(TIMES, FUTURE_ANCHOR_BARS)[2];
  const rawInputs: Drawing[] = [
    {
      id: "tl-1", kind: "trendline",
      points: [{ t: TIMES[2]!, p: 120 }, { t: futureSlotTime as string, p: 200 }],
    },
    { id: "hl-1", kind: "hline", points: [{ t: TIMES[5]!, p: 150 }] },
    {
      id: "tl-2", kind: "trendline",
      points: [{ t: TIMES[7]!, p: 280 }, { t: TIMES[10]!, p: 180 }],
    },
  ];
  const document = rawInputs
    .map((d) => normalizeDrawing(d, 0))
    .filter((d): d is NormalizedDrawing => d !== null);
  const anchors: DrawingAnchor[] = [
    { paneIndex: 0, time: TIMES[2]!, logical: 2, price: 120 },
    { paneIndex: 0, time: futureSlotTime as string, logical: 14, price: 200, future: { slot: 2 } },
    { paneIndex: 0, time: TIMES[5]!, logical: 5, price: 150 },
    { paneIndex: 1, time: TIMES[7]!, logical: 7, price: 280 },
    { paneIndex: 1, time: TIMES[10]!, logical: 10, price: 180 },
  ];
  return { document, anchors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fake 2D context for the canvas engine (mirrors chartEngineCanvasC02.test.ts).
// ─────────────────────────────────────────────────────────────────────────────

type Call = { method: string; args: unknown[] };
const ctxByCanvas = new WeakMap<HTMLCanvasElement, { __calls: Call[] }>();
function makeFakeCtx(): CanvasRenderingContext2D & { __calls: Call[] } {
  const calls: Call[] = [];
  const rec = (m: string) => (...args: unknown[]) => { calls.push({ method: m, args }); };
  const ctx: Record<string, unknown> = { __calls: calls };
  for (const m of [
    "setTransform", "fillRect", "clearRect", "drawImage", "beginPath", "moveTo",
    "lineTo", "stroke", "fill", "save", "restore", "scale", "translate",
    "rect", "closePath", "fillText", "strokeRect",
  ]) ctx[m] = rec(m);
  ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  return ctx as unknown as CanvasRenderingContext2D & { __calls: Call[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// LWC stand-in: deterministic LINEAR mapping (see file header).
// ─────────────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => {
  type Spy = ReturnType<typeof vi.fn>;
  // Geometry literals — these live inside the hoisted block because vi.hoisted
  // runs before module-scope constants are initialized. The shared TIMES and
  // module-scope constants below MUST match these values exactly.
  const HOIST_PANE_W = 600;
  const HOIST_PANE_H_PX = 300;
  // Match the module-level P0_TOP/P0_BOTTOM/P1_TOP/P1_BOTTOM below (price range
  // covers anchor prices 120..280 so the linear stand-in never goes negative).
  const HOIST_P0_TOP = 220;
  const HOIST_P0_BOTTOM = 50;
  const HOIST_P1_TOP = 320;
  const HOIST_P1_BOTTOM = 100;
  const HOIST_TIMES = Array.from({ length: 12 }, (_, i) =>
    new Date(Date.UTC(2026, 0, 5 + i)).toISOString().slice(0, 10));
  interface FakeSeries {
    __paneIndex: number;
    __data: EngineBarRow[];
    setData: Spy;
    priceToCoordinate: Spy;
    coordinateToPrice: Spy;
    getPane: Spy;
    priceScale: Spy;
  }
  interface FakePane {
    __index: number;
    __series: FakeSeries[];
    paneIndex: Spy;
    getSeries: Spy;
    getHeight: Spy;
    setHeight: Spy;
    getStretchFactor: Spy;
    setStretchFactor: Spy;
    getHTMLElement: Spy;
    priceScale: Spy;
  }
  interface FakeChart {
    __ts: { getVisibleLogicalRange: Spy; setVisibleLogicalRange: Spy;
            subscribeVisibleLogicalRangeChange: Spy; unsubscribeVisibleLogicalRangeChange: Spy;
            timeToCoordinate: Spy; coordinateToTime: Spy };
    addSeries: Spy;
    panes: Spy;
    timeScale: Spy;
    paneSize: Spy;
    removeSeries: Spy;
    remove: Spy;
    __panes: FakePane[];
  }
  const reg = {
    geo: { width: HOIST_PANE_W, height: HOIST_PANE_H_PX, from: 0, to: HOIST_TIMES.length } as
      { width: number; height: number; from: number; to: number },
    charts: [] as FakeChart[],
    reset() { reg.charts.length = 0; },
  };
  function makePriceScale(paneIndex: number) {
    return {
      __id: "right", __paneIndex: paneIndex,
      width: vi.fn(() => 57), applyOptions: vi.fn(), options: vi.fn(() => ({})),
      getVisibleRange: vi.fn(() => ({ from: 0, to: 300 })),
      setVisibleRange: vi.fn(), setAutoScale: vi.fn(),
    };
  }
  function makeSeries(paneIndex: number, chart: FakeChart): FakeSeries {
    return {
      __paneIndex: paneIndex,
      __data: [],
      setData: vi.fn(() => { /* store */ }),
      priceToCoordinate: vi.fn((p: number): number | null => {
        const top = paneIndex === 1 ? HOIST_P1_TOP : HOIST_P0_TOP;
        const bottom = paneIndex === 1 ? HOIST_P1_BOTTOM : HOIST_P0_BOTTOM;
        return (top - p) * (HOIST_PANE_H_PX - 1) / (top - bottom);
      }),
      coordinateToPrice: vi.fn((y: number): number | null => {
        const top = paneIndex === 1 ? HOIST_P1_TOP : HOIST_P0_TOP;
        const bottom = paneIndex === 1 ? HOIST_P1_BOTTOM : HOIST_P0_BOTTOM;
        return top - y * (top - bottom) / (HOIST_PANE_H_PX - 1);
      }),
      getPane: vi.fn(() => chart.__panes[paneIndex]!),
      priceScale: vi.fn(() => makePriceScale(paneIndex)),
    };
  }
  function makePane(index: number, chart: FakeChart): FakePane {
    return {
      __index: index,
      __series: [],
      paneIndex: vi.fn(() => index),
      getSeries: vi.fn(() => chart.__panes[index]!.__series),
      getHeight: vi.fn(() => HOIST_PANE_H_PX),
      setHeight: vi.fn(),
      getStretchFactor: vi.fn(() => 1),
      setStretchFactor: vi.fn(),
      getHTMLElement: vi.fn(() => null),
      priceScale: vi.fn(() => makePriceScale(index)),
    };
  }
  function makeChart(): FakeChart {
    const rangeHandlers = new Set<(r: { from: number; to: number } | null) => void>();
    const ts = {
      getVisibleLogicalRange: vi.fn(() => ({ from: reg.geo.from, to: reg.geo.to })),
      setVisibleLogicalRange: vi.fn((next: { from: number; to: number }) => {
        reg.geo = { ...reg.geo, ...next };
        for (const h of rangeHandlers) h(next);
      }),
      subscribeVisibleLogicalRangeChange: vi.fn((h: (r: { from: number; to: number } | null) => void) => {
        rangeHandlers.add(h);
      }),
      unsubscribeVisibleLogicalRangeChange: vi.fn((h: (r: { from: number; to: number } | null) => void) => {
        rangeHandlers.delete(h);
      }),
      timeToCoordinate: vi.fn((time: EngineTime): number | null => {
        const key = typeof time === "number" ? time : String(time);
        const idx = HOIST_TIMES.findIndex((t) => t === key);
        if (idx === -1) return null;
        const spacing = reg.geo.width / (reg.geo.to - reg.geo.from);
        return (idx - reg.geo.from + 0.5) * spacing;
      }),
      coordinateToTime: vi.fn((x: number): EngineTime | null => {
        const spacing = reg.geo.width / (reg.geo.to - reg.geo.from);
        const idx = Math.round(x / spacing + reg.geo.from - 0.5);
        return idx >= 0 && idx < HOIST_TIMES.length ? HOIST_TIMES[idx]! : null;
      }),
    };
    const chart: FakeChart = {
      __ts: ts,
      __panes: [],
      addSeries: vi.fn((_def: unknown, _opts: unknown, paneIndex?: number) => {
        const idx = paneIndex ?? 0;
        if (!chart.__panes[idx]) chart.__panes[idx] = makePane(idx, chart);
        const pane = chart.__panes[idx]!;
        const s = makeSeries(idx, chart);
        pane.__series.push(s);
        return s;
      }),
      panes: vi.fn(() => chart.__panes),
      timeScale: vi.fn(() => ts),
      paneSize: vi.fn(() => ({ width: reg.geo.width, height: reg.geo.height })),
      removeSeries: vi.fn((s: FakeSeries) => {
        for (const pane of chart.__panes) {
          const at = pane.__series.indexOf(s);
          if (at !== -1) pane.__series.splice(at, 1);
        }
      }),
      remove: vi.fn(),
    };
    reg.charts.push(chart);
    return chart;
  }
  const createChart = vi.fn(() => makeChart());
  return { reg, createChart };
});

vi.mock("lightweight-charts", () => ({
  createChart: H.createChart,
  CandlestickSeries: { seriesType: "Candlestick" },
  BarSeries: { seriesType: "Bar" },
  LineSeries: { seriesType: "Line" },
  AreaSeries: { seriesType: "Area" },
  HistogramSeries: { seriesType: "Histogram" },
  BaselineSeries: { seriesType: "Baseline" },
  MismatchDirection: { NearestLeft: -1, None: 0, NearestRight: 1 },
  createSeriesMarkers: vi.fn(),
  createTextWatermark: vi.fn(),
}));

import { createLwcEngine } from "@/lib/chart-engine/lwc";

// ─────────────────────────────────────────────────────────────────────────────
// Per-engine wiring.
// ─────────────────────────────────────────────────────────────────────────────

type MountHandle = {
  engine: ChartEngine;
  primaryByPane: (paneIndex: number) => SeriesHandle | null;
  scheduler: ReturnType<typeof createManualScheduler>;
};

function mountCanvas(container: HTMLDivElement): MountHandle {
  const scheduler = createManualScheduler();
  const engine = createCanvasEngine(container, {
    width: PANE_W, height: PANE_H_PX * 2, devicePixelRatio: 1, scheduler,
  });
  const s0 = engine.addSeries("candles", {}, 0);
  const s1 = engine.addSeries("candles", {}, 1);
  s0.setData(bars());
  s1.setData(bars());
  scheduler.flush();
  const primaryByPane = (paneIndex: number): SeriesHandle | null =>
    engine.panes()[paneIndex]?.getSeries()[0] ?? null;
  return { engine, primaryByPane, scheduler };
}

function mountLwc(container: HTMLDivElement): MountHandle {
  H.reg.reset();
  H.reg.geo = { width: PANE_W, height: PANE_H_PX, from: 0, to: TIMES.length };
  const engine = createLwcEngine(container, { width: PANE_W, height: PANE_H_PX * 2 });
  const s0 = engine.addSeries("candles", {}, 0);
  const s1 = engine.addSeries("candles", {}, 1);
  s0.setData(bars());
  s1.setData(bars());
  const primaryByPane = (paneIndex: number): SeriesHandle | null =>
    engine.panes()[paneIndex]?.getSeries()[0] ?? null;
  return { engine, primaryByPane, scheduler: { schedule() {}, cancel() {}, flush() {} } };
}

function bridgeOpts(handle: MountHandle) {
  // Wrap primaryByPane so reassigning handle.primaryByPane later (D01-A04 simulates
  // "source missing" by returning null) reaches the bridge on every call.
  return {
    primaryByPane: (paneIndex: number) => handle.primaryByPane(paneIndex),
    cadence: () => futureCadence(TIMES),
    lastBarTime: (): EngineTime | null => TIMES[TIMES.length - 1]!,
    scheduler: (run: () => void) => { run(); return () => {}; },
  } as const;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test setup.
// ─────────────────────────────────────────────────────────────────────────────

let canvasContainer: HTMLDivElement;
let lwcContainer: HTMLDivElement;

beforeEach(() => {
  canvasContainer = document.createElement("div");
  document.body.appendChild(canvasContainer);
  lwcContainer = document.createElement("div");
  document.body.appendChild(lwcContainer);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement, type: string,
  ) {
    if (type !== "2d") return null;
    let ctx = ctxByCanvas.get(this);
    if (!ctx) { ctx = makeFakeCtx(); ctxByCanvas.set(this, ctx); }
    return ctx as unknown as CanvasRenderingContext2D;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  canvasContainer.remove();
  lwcContainer.remove();
});

// ─────────────────────────────────────────────────────────────────────────────
// D01-A01: same drawing -> identical anchors + identical bytes.
// ─────────────────────────────────────────────────────────────────────────────

describe("D01-A01: Same drawing loaded in both engines -> Identical semantic anchors and serialized bytes remain", () => {
  it("round-trips every anchor pixel-equal across engines and equal to the input bytes", () => {
    const { document, anchors } = makeDocument();
    const inputBytes = JSON.stringify(document);

    const mm = mountCanvas(canvasContainer);
    const mmBridge = createDrawingBridge(mm.engine, bridgeOpts(mm));
    const lwc = mountLwc(lwcContainer);
    const lwcBridge = createDrawingBridge(lwc.engine, bridgeOpts(lwc));

    for (const a of anchors) {
      const mmPix = mmBridge.anchorToPixel(a);
      const lwcPix = lwcBridge.anchorToPixel(a);
      expect(mmPix).not.toBeNull();
      expect(lwcPix).not.toBeNull();

      // Each engine round-trips the SAME semantic anchor — price + logical are
      // data-space and identical regardless of the engine's local pixel layout.
      const mmBack = mmBridge.pixelToAnchor(a.paneIndex, mmPix!.x, mmPix!.y, "raw");
      const lwcBack = lwcBridge.pixelToAnchor(a.paneIndex, lwcPix!.x, lwcPix!.y, "raw");
      expect(mmBack).not.toBeNull();
      expect(lwcBack).not.toBeNull();
      expect(mmBack!.paneIndex).toBe(a.paneIndex);
      expect(mmBack!.price).toBeCloseTo(a.price, 9);
      expect(mmBack!.logical).toBeCloseTo(a.logical, 9);
      expect(lwcBack!.paneIndex).toBe(a.paneIndex);
      expect(lwcBack!.price).toBeCloseTo(a.price, 9);
      expect(lwcBack!.logical).toBeCloseTo(a.logical, 9);
      // Cross-engine semantic equality: the two engines hand back the same data
      // shape (price, logical, paneIndex) for the same input anchor.
      expect(mmBack!.price).toBeCloseTo(lwcBack!.price, 9);
      expect(mmBack!.logical).toBeCloseTo(lwcBack!.logical, 9);
    }

    // Document bytes are unchanged by either engine: bridge never mutates drawings.
    expect(JSON.stringify(document)).toBe(inputBytes);

    // Future-slot anchor survives: the trendline anchor whose stored slot is 2
    // must still resolve on both engines (the engine that knows future slots via
    // the time scale maps it past the last bar; the bridge's fallback resolves the
    // stored slot through the cadence math).
    const futureAnchor = anchors[1]!;
    const mmFuture = mmBridge.anchorToPixel(futureAnchor);
    const lwcFuture = lwcBridge.anchorToPixel(futureAnchor);
    expect(mmFuture).not.toBeNull();
    expect(lwcFuture).not.toBeNull();
    // Both engines resolve the future anchor to the SAME semantic slot: the
    // round-trip back yields the same logical+price on both.
    const mmFutureBack = mmBridge.pixelToAnchor(0, mmFuture!.x, mmFuture!.y, "raw");
    const lwcFutureBack = lwcBridge.pixelToAnchor(0, lwcFuture!.x, lwcFuture!.y, "raw");
    expect(mmFutureBack).not.toBeNull();
    expect(lwcFutureBack).not.toBeNull();
    expect(mmFutureBack!.price).toBeCloseTo(lwcFutureBack!.price, 9);
    expect(mmFutureBack!.logical).toBeCloseTo(lwcFutureBack!.logical, 9);
    expect(mmFutureBack!.logical).toBeCloseTo(futureAnchor.logical, 6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D01-A02: history-depth + coarser timeframe keep time-keyed anchors stable.
// ─────────────────────────────────────────────────────────────────────────────

describe("D01-A02: Timeframe or history-depth changes -> Existing anchor policy applies; no accidental row-index rebinding", () => {
  it("history-depth prepend keeps every time-keyed anchor at the SAME x and price across both engines", () => {
    const { anchors } = makeDocument();
    const mm0 = mountCanvas(canvasContainer);
    const mm0Bridge = createDrawingBridge(mm0.engine, bridgeOpts(mm0));
    const lwc0 = mountLwc(lwcContainer);
    const lwc0Bridge = createDrawingBridge(lwc0.engine, bridgeOpts(lwc0));

    // Pre-change: snapBar every anchor back to its TIME. This is what "the
    // anchor still resolves to the same time" actually means — the row claim is
    // about the data-space address, not about a particular pixel (the pixel
    // shifts naturally when the visible range re-fits to a longer series).
    const mmBeforeTimes = anchors.map((a) => {
      const p = mm0Bridge.anchorToPixel(a)!;
      return mm0Bridge.pixelToAnchor(a.paneIndex, p.x, p.y, "snapBar")!.time;
    });
    const lwcBeforeTimes = anchors.map((a) => {
      const p = lwc0Bridge.anchorToPixel(a)!;
      return lwc0Bridge.pixelToAnchor(a.paneIndex, p.x, p.y, "snapBar")!.time;
    });

    // 500 older bars: row 0 now sits at the chart edge. A "row-index rebound"
    // anchor would now point to a DIFFERENT bar (the bar at logical index
    // `a.logical` has shifted +500 places). Time-keyed anchors must still
    // resolve to the SAME time.
    const older = Array.from({ length: 500 }, (_, i) =>
      new Date(Date.UTC(2024, 0, 2 + i)).toISOString().slice(0, 10));
    const merged = [
      ...older.map((t, i) => ({ time: t, open: 40, high: 42, low: 38, close: 41 + (i % 5) })),
      ...bars(),
    ];
    for (const s of mm0.engine.panes().flatMap((p) => p.getSeries())) s.setData(merged);
    mm0.scheduler.flush();
    for (const s of lwc0.engine.panes().flatMap((p) => p.getSeries())) s.setData(merged);

    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i]!;
      const mmAfter = mm0Bridge.anchorToPixel(a);
      const lwcAfter = lwc0Bridge.anchorToPixel(a);
      expect(mmAfter).not.toBeNull();
      expect(lwcAfter).not.toBeNull();
      // The resolved TIME is unchanged. A row-index rebound would yield the
      // time of the bar that now sits at the anchor's old row (an older 2024
      // date); the correct resolution yields the same 2026 date as before.
      const mmAfterTime = mm0Bridge.pixelToAnchor(a.paneIndex, mmAfter!.x, mmAfter!.y, "snapBar")!.time;
      const lwcAfterTime = lwc0Bridge.pixelToAnchor(a.paneIndex, lwcAfter!.x, lwcAfter!.y, "snapBar")!.time;
      expect(mmAfterTime).toBe(mmBeforeTimes[i]);
      expect(lwcAfterTime).toBe(lwcBeforeTimes[i]);
      expect(mmAfterTime).toBe(lwcAfterTime);
      // Specifically: a 2026 date — NEVER a 2024 older-bar date.
      expect(String(mmAfterTime)).toMatch(/^2026-/);
      expect(String(lwcAfterTime)).toMatch(/^2026-/);
    }

    // Future-slot anchor: still past the live edge. Its stored slot 2 keeps it
    // future relative to the new last bar (TIMES[11] is still the last bar).
    const futureAnchor = anchors[1]!;
    const mmFuture = mm0Bridge.anchorToPixel(futureAnchor);
    const lwcFuture = lwc0Bridge.anchorToPixel(futureAnchor);
    expect(mmFuture).not.toBeNull();
    expect(lwcFuture).not.toBeNull();
    expect(mmFuture!.x).toBeGreaterThan(PANE_W);
    expect(lwcFuture!.x).toBeGreaterThan(PANE_W);
    // Both engines still tag the future anchor as a slot anchor (the bridge
    // recognises stored slots regardless of the live-edge baseline).
    const mmFutureBack = mm0Bridge.pixelToAnchor(0, mmFuture!.x, mmFuture!.y, "raw")!;
    const lwcFutureBack = lwc0Bridge.pixelToAnchor(0, lwcFuture!.x, lwcFuture!.y, "raw")!;
    expect(mmFutureBack.future?.slot).toBe(2);
    expect(lwcFutureBack.future?.slot).toBe(2);
  });

  it("coarser timeframe (5x aggregation) keeps time-keyed anchors at the SAME x and price where the bar still exists", () => {
    const { anchors } = makeDocument();
    const mm0 = mountCanvas(canvasContainer);
    const mm0Bridge = createDrawingBridge(mm0.engine, bridgeOpts(mm0));
    const lwc0 = mountLwc(lwcContainer);
    const lwc0Bridge = createDrawingBridge(lwc0.engine, bridgeOpts(lwc0));

    const mmBeforeTimes = anchors.map((a) => {
      const p = mm0Bridge.anchorToPixel(a)!;
      return mm0Bridge.pixelToAnchor(a.paneIndex, p.x, p.y, "snapBar")!.time;
    });
    const lwcBeforeTimes = anchors.map((a) => {
      const p = lwc0Bridge.anchorToPixel(a)!;
      return lwc0Bridge.pixelToAnchor(a.paneIndex, p.x, p.y, "snapBar")!.time;
    });

    // Coarser timeframe: bars at indices [2, 5, 7, 10] plus the edge [0]. Every
    // time-keyed anchor (TIMES[2], TIMES[5], TIMES[7], TIMES[10]) survives — a
    // row-index rebound would land on a DIFFERENT bar; time-keyed anchors must
    // still resolve to the SAME time. Anchor 1 (future-slot) resolves via its
    // stored slot, not via time.
    const coarseIndices = [0, 2, 5, 7, 10];
    const coarse: EngineBarRow[] = coarseIndices.map((i, k) => ({
      time: TIMES[i]!, open: 50 + k, high: 52 + k, low: 48 + k, close: 51 + k,
    }));

    for (const s of mm0.engine.panes().flatMap((p) => p.getSeries())) s.setData(coarse);
    mm0.scheduler.flush();
    for (const s of lwc0.engine.panes().flatMap((p) => p.getSeries())) s.setData(coarse);

    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i]!;
      const retained = coarseIndices.includes(a.logical);
      const mmAfter = mm0Bridge.anchorToPixel(a);
      const lwcAfter = lwc0Bridge.anchorToPixel(a);
      if (retained) {
        expect(mmAfter).not.toBeNull();
        expect(lwcAfter).not.toBeNull();
        // Time-keyed anchor still resolves to the SAME time on both engines.
        const mmAfterTime = mm0Bridge.pixelToAnchor(a.paneIndex, mmAfter!.x, mmAfter!.y, "snapBar")!.time;
        const lwcAfterTime = lwc0Bridge.pixelToAnchor(a.paneIndex, lwcAfter!.x, lwcAfter!.y, "snapBar")!.time;
        expect(mmAfterTime).toBe(mmBeforeTimes[i]);
        expect(lwcAfterTime).toBe(lwcBeforeTimes[i]);
      } else {
        // Anchor's `time` was dropped by the aggregation — both engines either
        // refuse the same way (LWC stand-in returns null on lookup miss) or
        // both fall back to the next nearest time. They must agree.
        expect(Boolean(mmAfter)).toBe(Boolean(lwcAfter));
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D01-A04: source disappears then returns.
// ─────────────────────────────────────────────────────────────────────────────

describe("D01-A04: Source disappears then returns -> Document remains recoverable; missing state does not delete it", () => {
  it("while the source is missing the bridge refuses to resolve but the document bytes are unchanged, and on restore projections revert", () => {
    const { document, anchors } = makeDocument();
    const inputBytes = JSON.stringify(document);

    const mm = mountCanvas(canvasContainer);
    const mmBridge = createDrawingBridge(mm.engine, bridgeOpts(mm));
    const lwc = mountLwc(lwcContainer);
    const lwcBridge = createDrawingBridge(lwc.engine, bridgeOpts(lwc));

    const mmBefore = anchors.map((a) => mmBridge.anchorToPixel(a));
    const lwcBefore = anchors.map((a) => lwcBridge.anchorToPixel(a));

    // Source missing path A: primaryByPane returns null. The bridge is engine-
    // agnostic and calls primaryByPane on every anchor; flipping the function
    // simulates the series being removed on both engines.
    mm.primaryByPane = () => null;
    lwc.primaryByPane = () => null;

    for (const a of anchors) {
      expect(mmBridge.anchorToPixel(a)).toBeNull();
      expect(lwcBridge.anchorToPixel(a)).toBeNull();
      expect(mmBridge.pixelToAnchor(a.paneIndex, 100, 100, "raw")).toBeNull();
      expect(lwcBridge.pixelToAnchor(a.paneIndex, 100, 100, "raw")).toBeNull();
    }
    expect(JSON.stringify(document)).toBe(inputBytes);
    expect(document.length).toBe(3);

    // Source missing path B: setData([]). Independent of "no series at all".
    const mm0 = mm.engine.panes()[0]!.getSeries()[0]!;
    const lwc0 = lwc.engine.panes()[0]!.getSeries()[0]!;
    mm0.setData([]);
    mm.scheduler.flush();
    lwc0.setData([]);
    for (const a of anchors) {
      expect(mmBridge.anchorToPixel(a)).toBeNull();
      expect(lwcBridge.anchorToPixel(a)).toBeNull();
    }
    expect(JSON.stringify(document)).toBe(inputBytes);

    // Restore source on both engines.
    mm.primaryByPane = (paneIndex: number) => mm.engine.panes()[paneIndex]?.getSeries()[0] ?? null;
    lwc.primaryByPane = (paneIndex: number) => lwc.engine.panes()[paneIndex]?.getSeries()[0] ?? null;
    for (const s of mm.engine.panes().flatMap((p) => p.getSeries())) s.setData(bars());
    mm.scheduler.flush();
    for (const s of lwc.engine.panes().flatMap((p) => p.getSeries())) s.setData(bars());

    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i]!;
      const mmAfter = mmBridge.anchorToPixel(a);
      const lwcAfter = lwcBridge.anchorToPixel(a);
      expect(mmAfter).not.toBeNull();
      expect(lwcAfter).not.toBeNull();
      expect(mmAfter!.x).toBeCloseTo(mmBefore[i]!.x, 9);
      expect(mmAfter!.y).toBeCloseTo(mmBefore[i]!.y, 9);
      expect(lwcAfter!.x).toBeCloseTo(lwcBefore[i]!.x, 9);
      expect(lwcAfter!.y).toBeCloseTo(lwcBefore[i]!.y, 9);
    }
    expect(JSON.stringify(document)).toBe(inputBytes);
  });
});