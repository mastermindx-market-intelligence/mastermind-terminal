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
//
// The "serialized bytes remain" clause is an ENGINE OUTPUT, never the input object
// compared with itself: each engine resolves every point with its own anchorToPixel,
// reads it back with its own pixelToAnchor and re-normalizes the drawing; only that
// rebuild meets the persisted input bytes (see rebuildDocument).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCanvasEngine, createManualScheduler } from "@/lib/chart-engine/canvas";
import {
  createDrawingBridge,
  type DrawingAnchor,
  type DrawingBridge,
} from "@/lib/chart-engine/drawingBridge";
import {
  FUTURE_ANCHOR_BARS,
  futureBarTimes,
  futureCadence,
} from "@/lib/chart-engine/futureTime";
import {
  normalizeDrawing,
  type Drawing,
  type NormalizedDrawing,
  type Pt,
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

type DocumentBundle = {
  document: NormalizedDrawing[]; rawInputs: Drawing[];
  anchors: DrawingAnchor[]; anchorIds: string[];
};

// Pane each drawing lives in: anchors are PANE-SCOPED (a pane owns its price scale).
const PANE_BY_ID: Record<string, number> = { "tl-1": 0, "hl-1": 0, "tl-2": 1 };

function makeDocument(): DocumentBundle {
  const futureTimes = futureBarTimes(TIMES, FUTURE_ANCHOR_BARS);
  const futureSlotTime = futureTimes[2];
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
  // Anchors are DERIVED from the document's own points, never hand-copied beside
  // it: time = point.t, price = point.p, logical = the row of point.t in TIMES (or
  // TIMES.length + slot for the future point), paneIndex per drawing.
  const anchors: DrawingAnchor[] = [];
  const anchorIds: string[] = [];
  for (const d of document) {
    for (const pt of d.points) {
      const row = TIMES.indexOf(pt.t);
      const slot = row === -1 ? futureTimes.findIndex((t) => t === pt.t) : -1;
      const paneIndex = PANE_BY_ID[d.id] ?? 0;
      anchors.push(row >= 0
        ? { paneIndex, time: pt.t, logical: row, price: pt.p }
        : { paneIndex, time: pt.t, logical: TIMES.length + slot, price: pt.p, future: { slot } });
      anchorIds.push(d.id);
    }
  }
  return { document, rawInputs, anchors, anchorIds };
}

// ── Per-engine document rebuild: the "serialized bytes remain" clause ─────────
/** Prices are quantised to 1e-6 so the serialized bytes are stable. */
const roundPrice = (price: number): number => Math.round(price * 1e6) / 1e6;

/**
 * One engine's points for one drawing: every anchor is resolved to a pixel by THAT
 * engine and read back through THAT engine's projection — snapBar for the time (a
 * future point keeps the time the bridge resolves for its slot), raw for the price.
 * Null when the engine cannot place a point: the rebuilt bytes must then differ. */
function enginePoints(bridge: DrawingBridge, group: DrawingAnchor[]): Pt[] | null {
  const out: Pt[] = [];
  for (const a of group) {
    const pix = bridge.anchorToPixel(a);
    if (pix == null) return null;
    const snapped = bridge.pixelToAnchor(a.paneIndex, pix.x, pix.y, "snapBar");
    const raw = bridge.pixelToAnchor(a.paneIndex, pix.x, pix.y, "raw");
    if (snapped == null || snapped.time == null || raw == null) return null;
    out.push({ t: String(snapped.time), p: roundPrice(raw.price) });
  }
  return out;
}

/**
 * The document as ONE engine reproduces it, re-normalized through the product's own
 * normalizeDrawing. Mapping the RAW inputs (keyed by id) rather than the normalized
 * array keeps a product-side prune visible: a drawing the normalizer drops comes back
 * as null instead of vanishing from both sides of the comparison. */
function rebuildDocument(
  bridge: DrawingBridge,
  bundle: DocumentBundle,
): (NormalizedDrawing | null)[] {
  return bundle.rawInputs.map((raw) => {
    const group = bundle.anchors.filter((_a, i) => bundle.anchorIds[i] === raw.id);
    return normalizeDrawing({ ...raw, points: enginePoints(bridge, group) ?? [] }, 0);
  });
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
    // The times the stand-in can address. MUST follow setData, or a history-depth
    // or timeframe change cannot reach the LWC leg at all (RESULT.md F2).
    times: [...HOIST_TIMES] as string[],
    charts: [] as FakeChart[],
    reset() { reg.charts.length = 0; reg.times = [...HOIST_TIMES]; },
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
    const series: FakeSeries = {
      __paneIndex: paneIndex,
      __data: [],
      setData: vi.fn((rows: EngineBarRow[]) => {
        series.__data = rows;
        // Pane 0 owns the shared time scale: its rows are the addressable times.
        if (paneIndex === 0) {
          reg.times = rows.map((r) => (typeof r.time === "string" ? r.time : String(r.time)));
          reg.geo = { ...reg.geo, from: 0, to: Math.max(1, rows.length) };
        }
      }),
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
    return series;
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
        const idx = reg.times.findIndex((t) => t === key);
        if (idx === -1) return null;
        const spacing = reg.geo.width / (reg.geo.to - reg.geo.from);
        return (idx - reg.geo.from + 0.5) * spacing;
      }),
      coordinateToTime: vi.fn((x: number): EngineTime | null => {
        const spacing = reg.geo.width / (reg.geo.to - reg.geo.from);
        const idx = Math.round(x / spacing + reg.geo.from - 0.5);
        return idx >= 0 && idx < reg.times.length ? reg.times[idx]! : null;
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
    // The LWC double's pane IS PANE_W wide (its axis width lives outside it); with no
    // mm price axis the mm plot is PANE_W too, so both engines map the same pixels.
    rightPriceScale: { visible: false },
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
  H.reg.times = [...TIMES];
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
  it("round-trips every anchor to the SAME semantic anchor on both engines (pixels are renderer-local and may differ)", () => {
    const { anchors } = makeDocument();
    // Pixels are NOT compared across engines: each renderer owns its price-scale
    // geometry. Identical must be the data-space address. See RESULT.md F1.

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

  it("rebuilds the SAME serialized document bytes from each engine's own projections", () => {
    const bundle = makeDocument();
    const inputBytes = JSON.stringify(bundle.document);

    const mm = mountCanvas(canvasContainer);
    const mmBridge = createDrawingBridge(mm.engine, bridgeOpts(mm));
    const lwc = mountLwc(lwcContainer);
    const lwcBridge = createDrawingBridge(lwc.engine, bridgeOpts(lwc));

    // OUTPUT of each engine, never the input compared with itself: every point
    // travels anchor -> pixel -> anchor through that engine alone.
    const mmBytes = JSON.stringify(rebuildDocument(mmBridge, bundle));
    const lwcBytes = JSON.stringify(rebuildDocument(lwcBridge, bundle));
    expect(mmBytes).toBe(inputBytes);
    expect(lwcBytes).toBe(inputBytes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D01-A02: history-depth + coarser timeframe keep time-keyed anchors stable.
// ─────────────────────────────────────────────────────────────────────────────

describe("D01-A02: Timeframe or history-depth changes -> Existing anchor policy applies; no accidental row-index rebinding", () => {
  it("history-depth prepend keeps every time-keyed anchor on the SAME bar time across both engines", () => {
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
      const mmAfterAnchor = mm0Bridge.pixelToAnchor(a.paneIndex, mmAfter!.x, mmAfter!.y, "snapBar")!;
      const lwcAfterAnchor = lwc0Bridge.pixelToAnchor(a.paneIndex, lwcAfter!.x, lwcAfter!.y, "snapBar")!;
      const mmRawLogical = mm0Bridge.pixelToAnchor(a.paneIndex, mmAfter!.x, mmAfter!.y, "raw")!.logical;
      const lwcRawLogical = lwc0Bridge.pixelToAnchor(a.paneIndex, lwcAfter!.x, lwcAfter!.y, "raw")!.logical;
      const mmAfterTime = mmAfterAnchor.time;
      const lwcAfterTime = lwcAfterAnchor.time;
      // The snapped ROW INDEX = the snap of the raw logical at the same pixel: an
      // off-by-one IS the row-index rebinding this row forbids (F7).
      expect(mmAfterAnchor.logical).toBe(Math.round(mmRawLogical));
      expect(lwcAfterAnchor.logical).toBe(Math.round(lwcRawLogical));
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

  it("coarser timeframe (5x aggregation) keeps time-keyed anchors on the SAME bar time where the bar still exists", () => {
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
        // SAME time and SAME snapped row index on both engines (RESULT.md F7).
        const mmAfterAnchor = mm0Bridge.pixelToAnchor(a.paneIndex, mmAfter!.x, mmAfter!.y, "snapBar")!;
        const lwcAfterAnchor = lwc0Bridge.pixelToAnchor(a.paneIndex, lwcAfter!.x, lwcAfter!.y, "snapBar")!;
        const mmRawLogical = mm0Bridge.pixelToAnchor(a.paneIndex, mmAfter!.x, mmAfter!.y, "raw")!.logical;
        const lwcRawLogical = lwc0Bridge.pixelToAnchor(a.paneIndex, lwcAfter!.x, lwcAfter!.y, "raw")!.logical;
        const mmAfterTime = mmAfterAnchor.time;
        const lwcAfterTime = lwcAfterAnchor.time;
        expect(mmAfterAnchor.logical).toBe(Math.round(mmRawLogical));
        expect(lwcAfterAnchor.logical).toBe(Math.round(lwcRawLogical));
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
  it("refuses to resolve while the source is missing, and on restore reverts every projection and rebuilds the SAME document bytes on both engines", () => {
    const bundle = makeDocument();
    const { anchors } = bundle;
    const inputBytes = JSON.stringify(bundle.document);

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
    // The emptied-series / source-swap refusal is pinned in chartEngineGapDrawingAnchor.test.ts (drawingBridge.ts stale-logical guard, drawing review F5).

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

    // "Missing state does not delete it": after the restore EACH engine rebuilds the
    // persisted bytes from its own projections (F3).
    expect(JSON.stringify(rebuildDocument(mmBridge, bundle))).toBe(inputBytes);
    expect(JSON.stringify(rebuildDocument(lwcBridge, bundle))).toBe(inputBytes);
  });
});
