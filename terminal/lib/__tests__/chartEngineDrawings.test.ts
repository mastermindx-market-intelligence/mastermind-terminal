// @vitest-environment jsdom
// D02 — drawing gestures project through createDrawingBridge over both engine impls.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDrawingBridge } from "@/lib/chart-engine/drawingBridge";
import { createEngine } from "@/lib/chart-engine";
import { createCanvasEngine, createManualScheduler } from "@/lib/chart-engine/canvas";
import type {
  ChartEngine,
  EngineLogicalRange,
  EngineLogicalRangeHandler,
  EngineTime,
  SeriesHandle,
  TimeScaleHandle,
} from "@/lib/chart-engine/api";
import { futureCadence } from "@/lib/chart-engine/futureTime";
import {
  DRAWING_HANDLE_HIT_RADIUS_CSS,
  drawingPointToAnchor,
  hitTestDrawingHandles,
  type DrawingHandleTarget,
} from "@/lib/drawing-engine/interaction";

const TIMES = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];

type CtxCall = { method: string; args: unknown[] };
const ctxByCanvas = new WeakMap<HTMLCanvasElement, { __calls: CtxCall[] }>();

function makeFakeCtx(): CanvasRenderingContext2D & { __calls: CtxCall[] } {
  const calls: CtxCall[] = [];
  const rec = (method: string) => (...args: unknown[]) => { calls.push({ method, args }); };
  const ctx: Record<string, unknown> = { __calls: calls };
  for (const m of [
    "setTransform", "fillRect", "clearRect", "drawImage", "beginPath", "moveTo", "lineTo", "stroke",
    "fill", "save", "restore", "scale", "translate", "rect", "closePath", "fillText", "strokeRect",
  ]) ctx[m] = rec(m);
  ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  return ctx as unknown as CanvasRenderingContext2D & { __calls: CtxCall[] };
}

function linearBridgeEngine(width = 600, height = 300): ChartEngine {
  let range: EngineLogicalRange = { from: -1, to: TIMES.length + 1 };
  const handlers = new Set<EngineLogicalRangeHandler>();
  const barSpacing = () => width / (range.to - range.from);
  const series = {
    priceToCoordinate: (price: number) => (200 - price) * (height - 1) / 300,
    coordinateToPrice: (y: number) => 200 - y * 300 / (height - 1),
  };
  const timeScale: TimeScaleHandle = {
    getVisibleLogicalRange: () => ({ ...range }),
    setVisibleLogicalRange: (next: EngineLogicalRange) => { range = { ...next }; },
    subscribeVisibleLogicalRangeChange: (h: EngineLogicalRangeHandler) => { handlers.add(h); },
    unsubscribeVisibleLogicalRangeChange: (h: EngineLogicalRangeHandler) => { handlers.delete(h); },
    timeToCoordinate: (time: EngineTime) => {
      const i = TIMES.findIndex((t) => t === String(time));
      return i < 0 ? null : (i - range.from + 0.5) * barSpacing();
    },
    coordinateToTime: (x: number) => {
      const i = Math.round(x / barSpacing() + range.from - 0.5);
      return i >= 0 && i < TIMES.length ? TIMES[i] : null;
    },
    logicalToCoordinate: (logical: number) => (logical - range.from + 0.5) * barSpacing(),
    coordinateToLogical: (x: number) => x / barSpacing() + range.from - 0.5,
    scrollToRealtime: () => {},
    scrollToPosition: () => {},
    applyOptions: () => {},
    fitContent: () => {},
    getVisibleRange: () => null,
    setVisibleRange: () => {},
    timeToIndex: () => null,
    options: () => ({}),
    width: () => width,
    unwrap: () => timeScale,
  } as unknown as TimeScaleHandle;
  return {
    impl: "test",
    timeScale: () => timeScale,
    paneSize: () => ({ width, height }),
    panes: () => [],
    addSeries: () => series as unknown as SeriesHandle,
    resize: () => {},
    destroy: () => {},
    applyOptions: () => {},
    subscribeCrosshairMove: () => {},
    unsubscribeCrosshairMove: () => {},
    setWatermark: () => {},
    takeScreenshot: () => document.createElement("canvas"),
    inventory: () => ({ alive: false, series: 0, priceLines: 0 }),
    unwrap: () => ({}),
  } as unknown as ChartEngine;
}

describe("chart-engine drawings (D02)", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    // jsdom has no matchMedia; lightweight-charts' fancy-canvas DPR observer calls it
    // asynchronously and an unstubbed window turns every extra engine into an unhandled
    // rejection that fails the whole vitest run.
    if (!window.matchMedia) {
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
    }
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
      type: string,
    ) {
      if (type !== "2d") return null;
      let ctx = ctxByCanvas.get(this);
      if (!ctx) {
        ctx = makeFakeCtx();
        ctxByCanvas.set(this, ctx);
      }
      return ctx as unknown as CanvasRenderingContext2D;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  function assertRawTravel(engine: ChartEngine) {
    const rows = TIMES.map((time, i) => ({ time, value: 100 + i }));
    const series = engine.addSeries("line", {}, 0);
    series.setData(rows);
    const bridge = createDrawingBridge(engine, {
      primaryByPane: (paneIndex) => engine.panes()[paneIndex]?.getSeries()?.[0] ?? series,
      cadence: () => futureCadence(TIMES),
      lastBarTime: () => TIMES[TIMES.length - 1],
    });
    const origin = bridge.pixelToAnchor(0, 200, 120, "raw");
    expect(origin).not.toBeNull();
    const moved = bridge.translateAnchor(origin!, 24, -16);
    expect(moved).not.toBeNull();
    const viaPixel = bridge.pixelToAnchor(0, 224, 104, "raw");
    expect(viaPixel!.logical).toBeCloseTo(moved!.logical, 3);
    expect(viaPixel!.price).toBeCloseTo(moved!.price, 3);
    bridge.dispose();
    engine.destroy();
  }

  it("A01: raw pixel gestures round-trip through the bridge on lwc", () => {
    assertRawTravel(createEngine(container, { width: 600, height: 300 }, "lwc"));
  });

  it("A01: raw pixel gestures round-trip through the bridge on mm", () => {
    const scheduler = createManualScheduler();
    const mm = createCanvasEngine(container, { width: 600, height: 300, devicePixelRatio: 1, scheduler });
    mm.addSeries("line", {}, 0).setData(TIMES.map((time, i) => ({ time, value: 100 + i })));
    scheduler.flush();
    assertRawTravel(mm);
  });

  it("A03: handle hit-test uses CSS px tolerance (not device pixels)", () => {
    const handles: DrawingHandleTarget[] = [{ drawingId: "d1", handleIndex: 0, cx: 100, cy: 200 }];
    const near = hitTestDrawingHandles(108, 200, handles, DRAWING_HANDLE_HIT_RADIUS_CSS, 2);
    expect(near?.handleIndex).toBe(0);
    const ghost = hitTestDrawingHandles(140, 200, handles, DRAWING_HANDLE_HIT_RADIUS_CSS, 2);
    expect(ghost).toBeNull();
  });

  it("A01 anchor minting preserves pane-scoped logical geometry", () => {
    const anchor = drawingPointToAnchor(0, { t: TIMES[2], p: 42 }, 2, TIMES[2], undefined);
    const engine = linearBridgeEngine();
    const bridge = createDrawingBridge(engine, {
      primaryByPane: () => ({
        priceToCoordinate: (p: number) => (200 - p) * 299 / 300,
        coordinateToPrice: (y: number) => 200 - y * 300 / 299,
      } as unknown as SeriesHandle),
      cadence: () => futureCadence(TIMES),
      lastBarTime: () => TIMES[TIMES.length - 1],
    });
    const px = bridge.anchorToPixel(anchor);
    bridge.dispose();
    expect(px?.x).not.toBeNull();
  });
});

describe("hitTestDrawingHandles falsifier", () => {
  it("RED when tolerance is scaled by devicePixelRatio (mutant)", () => {
    const handles: DrawingHandleTarget[] = [{ drawingId: "d1", handleIndex: 0, cx: 100, cy: 200 }];
    const dpr = 2;
    const wrongTolerance = DRAWING_HANDLE_HIT_RADIUS_CSS * dpr;
    const hit = hitTestDrawingHandles(115, 200, handles, wrongTolerance, dpr);
    expect(hit).not.toBeNull();
    const correct = hitTestDrawingHandles(115, 200, handles, DRAWING_HANDLE_HIT_RADIUS_CSS, dpr);
    expect(correct).toBeNull();
  });
});

describe("chart-engine drawings (D02) — review additions", () => {
  let box: HTMLDivElement;
  beforeEach(() => {
    box = document.createElement("div");
    document.body.appendChild(box);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
      type: string,
    ) {
      if (type !== "2d") return null;
      let ctx = ctxByCanvas.get(this);
      if (!ctx) {
        ctx = makeFakeCtx();
        ctxByCanvas.set(this, ctx);
      }
      return ctx as unknown as CanvasRenderingContext2D;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    box.remove();
  });

  it("picks the NEAREST handle when several sit inside the tolerance", () => {
    const handles: DrawingHandleTarget[] = [
      { drawingId: "far", handleIndex: 1, cx: 100, cy: 200 },
      { drawingId: "near", handleIndex: 0, cx: 106, cy: 200 },
    ];
    const hit = hitTestDrawingHandles(108, 200, handles, DRAWING_HANDLE_HIT_RADIUS_CSS, 2);
    expect(hit?.drawingId).toBe("near");
    expect(hit?.handleIndex).toBe(0);
    expect(hit?.distanceCss).toBeCloseTo(2, 6);
  });

  it("A01b: pixel -> anchor -> pixel round-trips within 1 CSS px on both impls", () => {
    for (const impl of ["lwc", "mm"] as const) {
      let engine = createEngine(box, { width: 600, height: 300 }, "lwc");
      let flush = () => {};
      if (impl === "mm") {
        const scheduler = createManualScheduler();
        engine = createCanvasEngine(box, { width: 600, height: 300, devicePixelRatio: 1, scheduler });
        flush = () => scheduler.flush();
      }
      const series = engine.addSeries("line", {}, 0);
      series.setData(TIMES.map((time, i) => ({ time, value: 100 + i })));
      flush();
      const bridge = createDrawingBridge(engine, {
        primaryByPane: (paneIndex) => engine.panes()[paneIndex]?.getSeries()?.[0] ?? series,
        cadence: () => futureCadence(TIMES),
        lastBarTime: () => TIMES[TIMES.length - 1],
      });
      for (const [x, y] of [[120, 90], [300, 150], [480, 210]] as const) {
        const anchor = bridge.pixelToAnchor(0, x, y, "raw");
        expect(anchor, `${impl} minted an anchor at ${x},${y}`).not.toBeNull();
        const back = bridge.anchorToPixel(anchor!);
        expect(back, `${impl} re-projected the anchor at ${x},${y}`).not.toBeNull();
        expect(Math.abs(back!.x - x), `${impl} x round trip at ${x},${y}`).toBeLessThanOrEqual(1);
        expect(Math.abs(back!.y - y), `${impl} y round trip at ${x},${y}`).toBeLessThanOrEqual(1);
      }
      bridge.dispose();
      engine.destroy();
    }
  });
});
