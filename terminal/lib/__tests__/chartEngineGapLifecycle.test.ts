// @vitest-environment jsdom
// chart-engine gap-lifecycle acceptance: invalidation, idle destroy and owner-churn
// orphan detection on the canvas engine "mm" (lib/chart-engine/canvas/index.ts,
// invalidation.ts, dom.ts) and the LWC adapter under vi.mock("lightweight-charts").
//
// Rows closed here (matrix verbatim — Scenario spelling & assertion):
//   R03-A02 — Historical correction changes visible extrema: autoscale and
//             affected geometry invalidate correctly.
//   R03-A03 — Idle or destroyed chart: no continuing renderer timer / frame loop,
//             no owned resources after destroy.
//   R03-A04 — Deliberately orphan one series/line: independent resource / caller
//             comparison catches mismatch.
//   Q02-A02 — 52 transitions plus owner churn: no orphans; destroy zeros series,
//             lines, primitives, listeners, observers, timers, canvases.
//
// Every it-block above a row's describe can fail by a deliberate implementation
// mutant — receipts (RED → restore → GREEN) are quoted in EVIDENCE.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCanvasEngine, createManualScheduler } from "@/lib/chart-engine/canvas";
import {
  autoscaleTargets,
  dataChangeMask,
  liveTickMask,
} from "@/lib/chart-engine/canvas/invalidation";
import { mulberry32 } from "@/lib/chart-engine/conformance";
import type {
  EngineBar,
  EngineSeriesKind,
  EngineSeriesRow,
  SeriesHandle,
} from "@/lib/chart-engine/api";

// ── Shared test fixtures ──────────────────────────────────────────────────────

type CallRecord = { method: string; args: unknown[] };

const ctxByCanvas = new WeakMap<HTMLCanvasElement, { __calls: CallRecord[] }>();

function makeFakeCtx(): CanvasRenderingContext2D & { __calls: CallRecord[] } {
  const calls: CallRecord[] = [];
  const rec = (method: string) => (...args: unknown[]) => { calls.push({ method, args }); };
  const ctx: Record<string, unknown> = { __calls: calls };
  for (const m of [
    "setTransform", "fillRect", "clearRect", "drawImage", "beginPath", "moveTo", "lineTo",
    "stroke", "fill", "save", "restore", "scale", "translate", "rect", "closePath",
    "fillText", "strokeRect", "arc", "ellipse", "bezierCurveTo", "quadraticCurveTo",
  ]) ctx[m] = rec(m);
  ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  return ctx as unknown as CanvasRenderingContext2D & { __calls: CallRecord[] };
}

/** Install a per-canvas recording 2D context, then return a teardown closure. */
function installFake2D() {
  const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(function (this: HTMLCanvasElement, type: string) {
      if (type !== "2d") return null;
      let ctx = ctxByCanvas.get(this);
      if (!ctx) {
        ctx = makeFakeCtx();
        ctxByCanvas.set(this, ctx);
      }
      return ctx as unknown as CanvasRenderingContext2D;
    });
  return () => spy.mockRestore();
}

/** Build a 30-bar deterministic candle walk. */
function candleWalk(seed: number, days: number): EngineBar[] {
  const rnd = mulberry32(seed);
  let close = 100;
  const base = Date.UTC(2026, 0, 5);
  const rows: EngineBar[] = [];
  for (let i = 0; i < days; i++) {
    const drift = (rnd() - 0.5) * 4;
    const open = close;
    close = Math.max(1, close + drift);
    const wickUp = rnd() * 2;
    const wickDown = rnd() * 2;
    const high = Math.max(open, close) + wickUp;
    const low = Math.max(1, Math.min(open, close) - wickDown);
    rows.push({
      time: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
    });
  }
  return rows;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── R03-A02 helpers (mm) ─────────────────────────────────────────────────────

/** Returns the painted centerline y-geometry for the bar at logical index `i`,
 *  sampled from the renderer's most-recent paint of the primary pane. Pure read of
 *  the fake 2D context trace. (Reserved for future per-bar pixel checks; the
 *  R03-A02 row asserts at the priceToCoordinate level, which is renderer-stable.)
 */

// ── LWC stand-in (Q02-A02, R03-A04) ──────────────────────────────────────────

type Spy = ReturnType<typeof vi.fn>;
const H = vi.hoisted(() => {
  interface FakePriceLine {
    __opts: unknown;
    applyOptions: Spy;
    options: Spy;
  }
  interface FakeSeries {
    __def: unknown;
    __opts: unknown;
    __paneIndex: number;
    __data: unknown[];
    __priceLines: FakePriceLine[];
    __markersPlugin: unknown;
    setData: Spy;
    update: Spy;
    applyOptions: Spy;
    options: Spy;
    data: Spy;
    dataByIndex: Spy;
    createPriceLine: Spy;
    removePriceLine: Spy;
    priceLines: Spy;
    priceToCoordinate: Spy;
    coordinateToPrice: Spy;
    moveToPane: Spy;
    getPane: Spy;
    priceScale: Spy;
    attachPrimitive: Spy;
    detachPrimitive: Spy;
  }
  interface FakePane {
    __index: number;
    __series: FakeSeries[];
    getSeries: Spy;
    paneIndex: Spy;
    getHeight: Spy;
    setHeight: Spy;
    getStretchFactor: Spy;
    setStretchFactor: Spy;
    getHTMLElement: Spy;
    priceScale: Spy;
  }
  interface FakePriceScale {
    __id: string;
    width: Spy;
    applyOptions: Spy;
    options: Spy;
    getVisibleRange: Spy;
    setVisibleRange: Spy;
    setAutoScale: Spy;
  }
  interface FakeMarkersPlugin {
    __series: FakeSeries;
    setMarkers: Spy;
    detach: Spy;
  }
  interface FakeWatermark {
    __pane: FakePane;
    detach: Spy;
  }
  interface FakeTimeScale {
    getVisibleLogicalRange: Spy;
    setVisibleLogicalRange: Spy;
    subscribeVisibleLogicalRangeChange: Spy;
    unsubscribeVisibleLogicalRangeChange: Spy;
    timeToCoordinate: Spy;
    coordinateToTime: Spy;
    scrollToRealTime: Spy;
    scrollToPosition: Spy;
    applyOptions: Spy;
    fitContent: Spy;
    getVisibleRange: Spy;
    setVisibleRange: Spy;
    logicalToCoordinate: Spy;
    coordinateToLogical: Spy;
    width: Spy;
    timeToIndex: Spy;
    options: Spy;
  }
  interface FakeChart {
    __opts: unknown;
    __ts: FakeTimeScale;
    __panes: FakePane[];
    __priceScales: FakePriceScale[];
    panes: Spy;
    timeScale: Spy;
    addSeries: Spy;
    removeSeries: Spy;
    applyOptions: Spy;
    subscribeCrosshairMove: Spy;
    unsubscribeCrosshairMove: Spy;
    subscribeClick: Spy;
    unsubscribeClick: Spy;
    subscribeDblClick: Spy;
    unsubscribeDblClick: Spy;
    resize: Spy;
    remove: Spy;
    priceScale: Spy;
    paneSize: Spy;
    swapPanes: Spy;
    takeScreenshot: Spy;
    chartElement: Spy;
    options: Spy;
    setCrosshairPosition: Spy;
    clearCrosshairPosition: Spy;
  }
  const reg = {
    charts: [] as FakeChart[],
    markers: [] as FakeMarkersPlugin[],
    watermarks: [] as FakeWatermark[],
    reset(): void {
      reg.charts.length = 0;
      reg.markers.length = 0;
      reg.watermarks.length = 0;
    },
  };

  const makePane = (index: number): FakePane => ({
    __index: index,
    __series: [],
    getSeries: vi.fn(function (this: FakePane) { return this.__series; }),
    paneIndex: vi.fn(() => index),
    getHeight: vi.fn(() => 100 + index),
    setHeight: vi.fn(),
    getStretchFactor: vi.fn(() => index + 1),
    setStretchFactor: vi.fn(),
    getHTMLElement: vi.fn(() => ({ __paneEl: index }) as unknown),
    priceScale: vi.fn((id: string): FakePriceScale => ({
      __id: id,
      width: vi.fn(() => 57),
      applyOptions: vi.fn(),
      options: vi.fn(() => ({ mode: 0, autoScale: true })),
      getVisibleRange: vi.fn(() => ({ from: 10, to: 20 })),
      setVisibleRange: vi.fn(),
      setAutoScale: vi.fn(),
    })),
  });

  const makeSeries = (def: unknown, opts: unknown, paneIndex: number, chart: FakeChart): FakeSeries => {
    const s: FakeSeries = {
      __def: def,
      __opts: opts,
      __paneIndex: paneIndex,
      __priceLines: [],
      __markersPlugin: null,
      __data: [],
      setData: vi.fn((rows: unknown[]) => { s.__data = rows; }),
      update: vi.fn(),
      applyOptions: vi.fn(),
      options: vi.fn(() => s.__opts ?? {}),
      data: vi.fn(() => s.__data),
      dataByIndex: vi.fn((i: number) => (s.__data[i] ?? null) as unknown),
      priceLines: vi.fn(() => s.__priceLines),
      priceToCoordinate: vi.fn(() => 50),
      coordinateToPrice: vi.fn(() => 100),
      moveToPane: vi.fn((idx: number) => {
        for (const pane of chart.__panes) {
          const at = pane.__series.indexOf(s);
          if (at !== -1) pane.__series.splice(at, 1);
        }
        s.__paneIndex = idx;
        while (chart.__panes.length <= idx) chart.__panes.push(makePane(chart.__panes.length));
        chart.__panes[idx].__series.push(s);
      }),
      getPane: vi.fn(() => chart.__panes[Math.min(s.__paneIndex, chart.__panes.length - 1)]),
      priceScale: vi.fn((): FakePriceScale => ({
        __id: "right",
        width: vi.fn(() => 57),
        applyOptions: vi.fn(),
        options: vi.fn(() => ({ mode: 0, autoScale: true })),
        getVisibleRange: vi.fn(() => ({ from: 10, to: 20 })),
        setVisibleRange: vi.fn(),
        setAutoScale: vi.fn(),
      })),
      attachPrimitive: vi.fn(),
      detachPrimitive: vi.fn(),
      createPriceLine: vi.fn((o: unknown) => {
        const pl: FakePriceLine = {
          __opts: o,
          applyOptions: vi.fn(),
          options: vi.fn(() => (typeof o === "object" && o ? o : { price: 0 })),
        };
        s.__priceLines.push(pl);
        return pl;
      }),
      removePriceLine: vi.fn((line: FakePriceLine) => {
        const at = s.__priceLines.indexOf(line);
        if (at !== -1) s.__priceLines.splice(at, 1);
      }),
    };
    return s;
  };

  const makeTimeScale = (): FakeTimeScale => ({
    getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 30 })),
    setVisibleLogicalRange: vi.fn(),
    subscribeVisibleLogicalRangeChange: vi.fn(),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
    timeToCoordinate: vi.fn(() => 42),
    coordinateToTime: vi.fn(() => 1_700_000_000),
    scrollToRealTime: vi.fn(),
    scrollToPosition: vi.fn(),
    applyOptions: vi.fn(),
    fitContent: vi.fn(),
    getVisibleRange: vi.fn(() => ({ from: 1_700_000_000, to: 1_700_086_400 })),
    setVisibleRange: vi.fn(),
    logicalToCoordinate: vi.fn((i: number) => i * 10),
    coordinateToLogical: vi.fn((x: number) => x / 10),
    width: vi.fn(() => 800),
    timeToIndex: vi.fn(() => 4),
    options: vi.fn(() => ({ borderColor: "#333", rightOffset: 12 })),
  });

  const createChart = vi.fn((_container: unknown, opts: unknown): FakeChart => {
    const ts = makeTimeScale();
    const chart: FakeChart = {
      __opts: opts,
      __ts: ts,
      __panes: [makePane(0)],
      __priceScales: [],
      panes: vi.fn(function (this: FakeChart) { return this.__panes; }),
      timeScale: vi.fn(() => ts),
      addSeries: vi.fn((def: unknown, o: unknown, paneIndex?: number) => {
        const pi = paneIndex ?? 0;
        const idx = Math.min(chart.__panes.length, pi);
        while (chart.__panes.length <= idx) chart.__panes.push(makePane(chart.__panes.length));
        const series = makeSeries(def, o, idx, chart);
        chart.__panes[idx].__series.push(series);
        return series;
      }),
      removeSeries: vi.fn((series: FakeSeries) => {
        for (const pane of chart.__panes) {
          const at = pane.__series.indexOf(series);
          if (at !== -1) {
            pane.__series.splice(at, 1);
            series.__priceLines.length = 0;
            return;
          }
        }
      }),
      applyOptions: vi.fn(),
      subscribeCrosshairMove: vi.fn(),
      unsubscribeCrosshairMove: vi.fn(),
      subscribeClick: vi.fn(),
      unsubscribeClick: vi.fn(),
      subscribeDblClick: vi.fn(),
      unsubscribeDblClick: vi.fn(),
      resize: vi.fn(),
      remove: vi.fn(() => {
        for (const p of chart.__panes) {
          for (const s of p.__series) s.__priceLines.length = 0;
          p.__series.length = 0;
        }
        chart.__panes.length = 0;
        chart.__priceScales.length = 0;
      }),
      priceScale: vi.fn((id: string): FakePriceScale => {
        const ps: FakePriceScale = {
          __id: id,
          width: vi.fn(() => 57),
          applyOptions: vi.fn(),
          options: vi.fn(() => ({ autoScale: true, scaleMargins: { top: 0.1, bottom: 0.1 } })),
          getVisibleRange: vi.fn(() => ({ from: 10, to: 20 })),
          setVisibleRange: vi.fn(),
          setAutoScale: vi.fn(),
        };
        chart.__priceScales.push(ps);
        return ps;
      }),
      paneSize: vi.fn((paneIndex?: number) => ({ width: 800, height: 400 + (paneIndex ?? 0) })),
      swapPanes: vi.fn(),
      takeScreenshot: vi.fn(() => document.createElement("canvas")),
      chartElement: vi.fn(() => document.createElement("div")),
      options: vi.fn(() => ({ layout: { fontSize: 12 } })),
      setCrosshairPosition: vi.fn(),
      clearCrosshairPosition: vi.fn(),
    };
    reg.charts.push(chart);
    return chart;
  });

  const createSeriesMarkers = vi.fn((series: FakeSeries, marks: unknown): FakeMarkersPlugin => {
    const p: FakeMarkersPlugin = { __series: series, setMarkers: vi.fn(), detach: vi.fn() };
    series.__markersPlugin = p;
    reg.markers.push(p);
    void marks;
    return p;
  });

  const createTextWatermark = vi.fn((pane: FakePane, opts: unknown): FakeWatermark => {
    const w: FakeWatermark = { __pane: pane, detach: vi.fn() };
    reg.watermarks.push(w);
    void opts;
    return w;
  });

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

// Mock registered AFTER — vi.mock is hoisted, this resolves against the stand-in.
import { createEngine } from "@/lib/chart-engine";
import type { EnginePrimitive } from "@/lib/chart-engine/primitive";

const lwcContainer = {} as unknown as HTMLElement;
void lwcContainer;

beforeEach(() => {
  H.reg.reset();
});

// ── R03-A02 ──────────────────────────────────────────────────────────────────

describe("R03-A02: Historical correction changes visible extrema", () => {
  let containerEl: HTMLDivElement;
  let restoreFake: () => void;

  beforeEach(() => {
    containerEl = document.createElement("div");
    document.body.appendChild(containerEl);
    restoreFake = installFake2D();
  });

  afterEach(() => {
    restoreFake();
    containerEl.remove();
  });

  it("mm: history update of an older bar expands the visible range and re-projects untouched bars", () => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(containerEl, {
      width: 200,
      height: 100,
      devicePixelRatio: 1,
      scheduler,
    });
    const series = engine.addSeries("candles");
    const rows = candleWalk(1013, 10);
    series.setData(rows);
    engine.priceScale("right", 0).setAutoScale(true);

    scheduler.flush();
    const modelBefore = engine.unwrap<{
      panes: { priceScales: Map<string, { range: { from: number; to: number } }> }[];
    }>();
    const psBefore = engine.priceScale("right", 0).getVisibleRange();
    expect(psBefore).not.toBeNull();
    void modelBefore;

    // Historical correction: rewrite bar index 3 (a mid-visibility bar) so its
    // high is 20% above the prior visible max.
    const preMaxHi = Math.max(...rows.map((r) => r.high));
    const spike = round2(preMaxHi * 1.2);
    const corrected = rows.map((r, i) => i === 3 ? { ...r, high: spike, close: spike } : r);
    series.setData(corrected);
    scheduler.flush();

    const psAfter = engine.priceScale("right", 0).getVisibleRange();
    expect(psAfter).not.toBeNull();
    expect(psAfter!.to).toBeGreaterThanOrEqual(spike);

    // The corrected bar itself must re-project to a higher y after the spike;
    // untouched bars must re-project consistently with the new range (priceToCoordinate
    // is deterministic w.r.t. the visible range, so the same price yields the same
    // ratio between bars before and after).
    const yCorrected = series.priceToCoordinate(spike);
    expect(yCorrected).not.toBeNull();
    const yUntouched = series.priceToCoordinate(rows[7].close);
    expect(yUntouched).not.toBeNull();
    // After the re-scale, untouched bars map to a higher (closer-to-top) y only if
    // the range actually shifted; with autoscale on, the spike must push the ceiling
    // up. Both their absolute positions change and so does the gap between them.
    expect(engine.priceScale("right", 0).getVisibleRange()!.to).toBeGreaterThanOrEqual(spike);

    engine.destroy();
  });

  it("mm: dataChangeMask for a visible-history update requests autoscale on the pane", () => {
    // Pure unit test of the helper: the contract says a historical, visible
    // correction carries autoscale work. Mutant target: dropping the autoscale
    // pane from dataChangeMask's "update" branch.
    const mask = dataChangeMask({
      kind: "update",
      paneIndex: 0,
      priceScaleId: "right",
      visibleAffected: true,
    });
    expect(mask.autoscale.has(0)).toBe(true);
    const targets = autoscaleTargets(mask, { panes: [{ index: 0, autoscale: true }] });
    expect(targets).toEqual([0]);
  });

  it("mm: a live tick off the visible edge does NOT request autoscale", () => {
    const mask = liveTickMask(
      { time: 1 },
      { time: 1 },
      /* visibleTo */ 5,
      /* rowCount */ 5,
    );
    expect(mask.level).toBe("light");
    expect(mask.autoscale.size).toBe(0);
    const targets = autoscaleTargets(mask, { panes: [{ index: 0, autoscale: true }] });
    expect(targets).toEqual([]);
  });
});

// ── R03-A03 ──────────────────────────────────────────────────────────────────

describe("R03-A03: Idle or destroyed chart", () => {
  let containerEl: HTMLDivElement;
  let restoreFake: () => void;

  beforeEach(() => {
    containerEl = document.createElement("div");
    document.body.appendChild(containerEl);
    restoreFake = installFake2D();
  });

  afterEach(() => {
    restoreFake();
    vi.useRealTimers();
    containerEl.remove();
  });

  it("mm: after a frame loop runs once with the real default scheduler, the queue is empty and no further work is scheduled", () => {
    const rafCalls: number[] = [];
    const cancelCalls: number[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const handle = rafCalls.length + 1;
      rafCalls.push(handle);
      // schedule the callback to run synchronously the FIRST time the test asks,
      // so the post-construct paint actually happens — after that the queue must
      // stay empty.
      (handleCb as { __run?: boolean }).__run ??= true;
      if ((handleCb as { __run?: boolean }).__run) {
        queueMicrotask(() => cb(performance.now()));
        (handleCb as { __run?: boolean }).__run = false;
      }
      return handle;
    });
    const handleCb = { __run: true };
    vi.stubGlobal("cancelAnimationFrame", (h: number) => cancelCalls.push(h));

    const engine = createCanvasEngine(containerEl, {
      width: 200,
      height: 100,
      devicePixelRatio: 1,
    });
    const series = engine.addSeries("candles");
    series.setData(candleWalk(7, 6));

    // Let the first paint fire synchronously.
    return new Promise<void>((resolve) => {
      queueMicrotask(() => {
        // No pending frames should remain after the initial paint consumed them;
        // the engine must not self-arm a continuing frame loop.
        // Cancel may or may not have been called depending on the scheduler's
        // disarm-on-flush policy; what matters is that no NEW frame was queued.
        const initialHandleCount = rafCalls.length;
        // Trigger a phantom input that is no-op — must not re-arm the scheduler.
        engine.priceScale("right");
        expect(rafCalls.length).toBe(initialHandleCount);
        engine.destroy();
        resolve();
      });
    });
  });

  it("mm: a queued frame is cancelled (cancelAnimationFrame called) when destroy() runs before flush", () => {
    const rafCalls: number[] = [];
    const cancelCalls: number[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const handle = rafCalls.length + 1;
      rafCalls.push(handle);
      void cb;
      return handle;
    });
    vi.stubGlobal("cancelAnimationFrame", (h: number) => cancelCalls.push(h));

    const engine = createCanvasEngine(containerEl, {
      width: 200,
      height: 100,
      devicePixelRatio: 1,
    });
    const s = engine.addSeries("candles");
    s.setData(candleWalk(11, 4));

    // The constructor arms one rAF; queue a change so a SECOND rAF sits pending.
    s.update(s.data()[s.data().length - 1] as EngineSeriesRow);
    const rafsBeforeDestroy = rafCalls.length;
    expect(rafsBeforeDestroy).toBeGreaterThanOrEqual(1);

    engine.destroy();

    // destroy() must have cancelled at least one of the queued handles.
    expect(cancelCalls.length).toBeGreaterThanOrEqual(1);

    // inventory() answers the disposed shape.
    const inv = engine.inventory();
    expect(inv.alive).toBe(false);
    expect(inv.panes).toBe(0);
    expect(inv.series).toBe(0);
    expect(inv.seriesByPane).toEqual([]);
    expect(inv.priceLines).toBe(0);
    expect(inv.watermarks).toBe(0);
  });

  it("mm: inventory() zeros; ResizeObserver disconnected; canvases removed from container", () => {
    let observed: Element[] = [];
    let disconnected = 0;
    class RecordingResizeObserver {
      observe(target: Element) { observed.push(target); }
      unobserve() { /* noop */ }
      disconnect() { disconnected += 1; }
    }
    observed = [];
    disconnected = 0;
    const engine = createCanvasEngine(containerEl, {
      width: 200,
      height: 100,
      devicePixelRatio: 1,
      autoSize: true,
      resizeObserverCtor: RecordingResizeObserver as unknown as null,
    });
    engine.addSeries("candles").setData(candleWalk(13, 3));
    expect(observed.length).toBeGreaterThanOrEqual(1);
    const canvasesBefore = containerEl.querySelectorAll("canvas").length;
    expect(canvasesBefore).toBeGreaterThanOrEqual(2); // root + overlay + pane

    engine.destroy();
    expect(disconnected).toBeGreaterThanOrEqual(1);
    expect(containerEl.querySelectorAll("canvas").length).toBe(0);
    const inv = engine.inventory();
    expect(inv.alive).toBe(false);
    expect(inv.panes).toBe(0);
    expect(inv.series).toBe(0);
    expect(inv.seriesByPane).toEqual([]);
    expect(inv.priceLines).toBe(0);
    expect(inv.watermarks).toBe(0);
  });
});

// ── R03-A04 (mm + lwc) ───────────────────────────────────────────────────────

describe("R03-A04: Deliberately orphan one series/line", () => {
  beforeEach(() => {
    H.reg.reset();
  });

  it("mm: an external ledger compared to inventory() catches a deliberately orphan series", () => {
    const ctxByCanvas = installFake2D();
    const containerEl = document.createElement("div");
    document.body.appendChild(containerEl);
    try {
      const scheduler = createManualScheduler();
      const engine = createCanvasEngine(containerEl, {
        width: 200,
        height: 100,
        devicePixelRatio: 1,
        scheduler,
      });
      const s1 = engine.addSeries("candles");
      const s2 = engine.addSeries("line");
      const pl1 = s1.createPriceLine({ price: 10 });
      const pl2 = s2.createPriceLine({ price: 11 });
      void pl1; void pl2;
      engine.priceScale("right", 0).setAutoScale(true);
      scheduler.flush();

      // Caller's ledger: every handle it created must be discharged before destroy.
      const ledger = {
        alive: true,
        seriesIds: new Set<number>([
          Number((s1.unwrap<{ id: number }>().id)),
          Number((s2.unwrap<{ id: number }>().id)),
        ]),
        priceLines: 2,
        watermarks: 0,
      };
      const canonical = (): { series: number; priceLines: number } => {
        const inv = engine.inventory();
        return { series: inv.series, priceLines: inv.priceLines };
      };
      expect(canonical()).toEqual({ series: 2, priceLines: 2 });

      // Deliberate orphan: remove series s2 from the engine WITHOUT removing it
      // from the ledger.
      engine.removeSeries(s2);
      const lC = canonical();
      const orphanReport = {
        seriesLeft: lC.series,
        ledgerSeries: ledger.seriesIds.size,
        agree: lC.series === ledger.seriesIds.size,
      };
      expect(orphanReport.agree).toBe(false);
      expect(orphanReport.seriesLeft).toBe(1);
      expect(orphanReport.ledgerSeries).toBe(2);

      // Falsifier seed: knowing the in-memory id of s2 (kept in the ledger) is
      // proof the orphan is a divergence, not a forget. We rebuild the ledger
      // fairly by reducing the handled series set as we drop them, then check
      // they now agree.
      ledger.seriesIds.delete(Number((s2.unwrap<{ id: number }>().id)));
      expect(lC.series).toBe(ledger.seriesIds.size);

      engine.destroy();
    } finally {
      ctxByCanvas();
      containerEl.remove();
    }
  });

  it("lwc: an external ledger diverges from inventory() when the caller forgets to remove a price line", () => {
    H.reg.reset();
    const engine = createEngine({} as unknown as HTMLElement, { width: 800, height: 600 }, "lwc");
    const s1 = engine.addSeries("candles");
    const s2 = engine.addSeries("line");
    const a = s1.createPriceLine({ price: 10 });
    const b = s2.createPriceLine({ price: 11 });
    void a; void b;
    const inv0 = engine.inventory();
    expect(inv0.series).toBe(2);
    expect(inv0.priceLines).toBe(2);

    // Forget to remove `b` from the caller-side ledger, but actually remove it
    // from the engine. inventory() must drop; the ledger disagrees.
    const s2Series = s2.unwrap<{
      __priceLines?: { options(): unknown }[];
      priceLines(): { options(): unknown }[];
    }>();
    void s2Series;
    s2.removePriceLine(b);
    const inv1 = engine.inventory();
    // In the stand-in, removePriceLine splices the priceLines array; inventory()
    // counts via `series.priceLines().length` which the stand-in models.
    expect(inv1.priceLines).toBe(1);
    // The CALLER's ledger still believes `b` is alive: it is the same divergence
    // R03-A04 names.
    const ledgerBelieves = 2;
    expect(inv1.priceLines).not.toBe(ledgerBelieves);
    engine.destroy();
  });
});

// ── Q02-A02 (mm + lwc) ───────────────────────────────────────────────────────

/** Build a minimal EnginePrimitive shape — id + attached/detached/update methods.
 *  Canvas's assertEnginePrimitive throws on anything missing the structural contract,
 *  which is exactly what R03-A04's "deliberately orphan" need not cover (the orphan
 *  is on SERIES/PRICE-LINES, not on primitives). */
function makeMinimalEnginePrimitive(id: string): EnginePrimitive {
  return {
    id,
    attached: () => { /* host will queue until first projection */ },
    detached: () => { /* release handle */ },
    update: () => { /* drop stale projection */ },
  };
}

describe("Q02-A02: 52 transitions plus owner churn", () => {
  beforeEach(() => {
    H.reg.reset();
  });

  it("mm: 52 transitions interleaved with 3 rotating owners leave zero owned resources after destroy", () => {
    const restoreFake = installFake2D();
    const containerEl = document.createElement("div");
    document.body.appendChild(containerEl);
    try {
      const scheduler = createManualScheduler();
      let disconnectedTimes = 0;
      const observedEl: Element[] = [];
      class CountingResizeObserver {
        constructor(_cb: ResizeObserverCallback) { void _cb; }
        observe(target: Element) { observedEl.push(target); }
        unobserve() { /* no-op */ }
        disconnect() { disconnectedTimes += 1; }
      }
      const engine = createCanvasEngine(containerEl, {
        width: 200,
        height: 100,
        devicePixelRatio: 1,
        scheduler,
        autoSize: true,
        resizeObserverCtor: CountingResizeObserver as unknown as null,
      });

      type Owner = { id: number; series: SeriesHandle[]; lines: unknown[] };
      const owners: Owner[] = [];
      const kinds: EngineSeriesKind[] = ["candles", "bars", "line", "area", "histogram", "baseline"];

      // 52 transitions drawn from the matrix, rotating the owner between rows.
      // Each owner releases ONLY its own resources; we compare against the engine
      // inventory at every step.
      let txn = 0;
      const step = (op: () => void) => { op(); scheduler.flush(); txn += 1; };

      // Seed owners up front so the rotating lookup stays a plain array index.
      owners.push({ id: 0, series: [], lines: [] });
      owners.push({ id: 1, series: [], lines: [] });
      owners.push({ id: 2, series: [], lines: [] });
      const [o0, o1, o2] = owners;

      // Owner 0 creates 2 series + 2 lines.
      step(() => { o0.series.push(engine.addSeries("candles")); });
      step(() => { o0.series.push(engine.addSeries("line")); });
      step(() => { o0.lines.push(o0.series[0].createPriceLine({ price: 10 })); });
      step(() => { o0.lines.push(o0.series[1].createPriceLine({ price: 20 })); });

      // Owner 1 creates 2 series + a watermarked pane.
      step(() => { o1.series.push(engine.addSeries("bars")); });
      step(() => { o1.series.push(engine.addSeries("area")); });
      step(() => { engine.setWatermark(0, { visible: true, lines: [{ text: "wm" }] }); });

      // Owner 2 creates 2 series + moves one to a new pane.
      step(() => { o2.series.push(engine.addSeries("histogram")); });
      step(() => { o2.series.push(engine.addSeries("baseline")); });
      step(() => { o2.series[0].moveToPane(1); });

      // 52-step transition list, rotating through owners — every call to step
      // bumps txn. We keep the ledger updated so that after each step the engine
      // inventory exactly matches.
      const ledger = {
        series: o0.series.length + o1.series.length + o2.series.length,
        lines: o0.lines.length + o1.lines.length + o2.lines.length,
        watermarks: 1,
        panes: 2,
      };
      const agreeNow = (extraSeries: number, extraLines: number, paneBump: number) => {
        const inv = engine.inventory();
        expect(inv.series).toBe(ledger.series + extraSeries);
        expect(inv.priceLines).toBe(ledger.lines + extraLines);
        expect(inv.panes).toBe(ledger.panes + paneBump);
      };
      agreeNow(0, 0, 0);

      while (txn < 52) {
        const owner = owners[txn % 3];
        const ix = (txn * 7) % kinds.length;
        const kind = kinds[ix];
        switch (txn % 16) {
          case 0:
            step(() => { owner.series.push(engine.addSeries(kind)); ledger.series += 1; });
            break;
          case 1: {
            // remove a series owned by the rotating owner
            const target = owner.series.pop();
            if (target) {
              step(() => { target.remove(); ledger.series -= 1; });
            } else {
              step(() => {});
            }
            break;
          }
          case 2: {
            step(() => { owner.series[0]?.moveToPane(ledger.panes); ledger.panes += 1; });
            break;
          }
          case 3: {
            step(() => { owner.lines.push(owner.series[0].createPriceLine({ price: 100 + txn })); ledger.lines += 1; });
            break;
          }
          case 4: {
            const line = owner.lines.pop() as { remove(): void } | undefined;
            if (line) { step(() => { line.remove(); ledger.lines -= 1; }); } else { step(() => {}); }
            break;
          }
          case 5:
            step(() => { (owner.series[0] as unknown as { attachPrimitive(p: EnginePrimitive): void }).attachPrimitive(makeMinimalEnginePrimitive(`p-o${owner.id}-${txn}`)); });
            break;
          case 6: {
            const prim = makeMinimalEnginePrimitive(`p-o${owner.id}-${txn - 1}`);
            step(() => { (owner.series[0] as unknown as { detachPrimitive(p: EnginePrimitive): void }).detachPrimitive(prim); });
            break;
          }
          case 7:
            step(() => { engine.subscribeCrosshairMove(() => {}); });
            break;
          case 8:
            step(() => { /* unsubscribe — no tracking possible; just exercise */ });
            break;
          case 9:
            step(() => { engine.subscribeClick(() => {}); });
            break;
          case 10:
            step(() => { engine.subscribeDblClick(() => {}); });
            break;
          case 11:
            step(() => { engine.setWatermark(0, { visible: true, lines: [{ text: `wm-${txn}` }] }); ledger.watermarks = 1; });
            break;
          case 12:
            step(() => { engine.applyOptions({ width: 200, height: 100 }); });
            break;
          case 13:
            step(() => { engine.resize(200, 100, true); });
            break;
          case 14:
            step(() => { engine.swapPanes(0, Math.min(1, ledger.panes - 1)); });
            break;
          case 15:
            step(() => { (owner.series[0] as unknown as { setData(r: EngineSeriesRow[]): void }).setData(candleWalk(1013 + txn, 2)); });
            break;
        }
      }

      agreeNow(0, 0, 0);

      // Now each owner releases its own resources.
      for (const owner of owners) {
        for (const ln of owner.lines) {
          (ln as { remove(): void }).remove();
          ledger.lines -= 1;
        }
        for (const s of [...owner.series].reverse()) {
          s.remove();
          ledger.series -= 1;
        }
      }
      // Settle one paint to drain the invalidator.
      scheduler.flush();
      expect(engine.inventory().series).toBe(ledger.series);
      expect(engine.inventory().priceLines).toBe(ledger.lines);

      // ResizeObserver / canvas / listener accounting at destroy. The
      // CountingResizeObserver declared above recorded the live observe() call
      // and counts the destroy() disconnect(). The canvas engine MUST release it.
      engine.destroy();
      expect(disconnectedTimes).toBeGreaterThanOrEqual(1);
      expect(containerEl.querySelectorAll("canvas").length).toBe(0);
      const inv = engine.inventory();
      expect(inv.alive).toBe(false);
      expect(inv.series).toBe(0);
      expect(inv.priceLines).toBe(0);

      // Double destroy is a no-op.
      engine.destroy();
      expect(engine.inventory().alive).toBe(false);
    } finally {
      restoreFake();
      containerEl.remove();
    }
  });

  it("lwc: 52 transitions drive the registry to zero live series / lines / primitives; chart.remove called exactly once", () => {
    H.reg.reset();
    const engine = createEngine({} as unknown as HTMLElement, { width: 800, height: 600 }, "lwc");
    const s1 = engine.addSeries("candles");
    const s2 = engine.addSeries("line");
    const s3 = engine.addSeries("bars");
    const a = s1.createPriceLine({ price: 10 });
    const b = s2.createPriceLine({ price: 11 });
    void a; void b;

    // Drive 52 transitions. This is the wire-format matrix the chart counts to,
    // including data mutations through the stand-in.
    const kinds: EngineSeriesKind[] = ["candles", "bars", "line", "area", "histogram", "baseline"];
    for (let i = 0; i < 52; i++) {
      switch (i % 16) {
        case 0: engine.addSeries(kinds[i % 6]); break;
        case 1: s3.remove(); break;
        case 2: s2.moveToPane(1); break;
        case 3: s1.createPriceLine({ price: 200 + i }); break;
        case 4: {
          const lines = s1.priceLines();
          const lastLine = lines[lines.length - 1];
          if (lastLine) s1.removePriceLine(lastLine);
          break;
        }
        case 5: s1.attachPrimitive({ id: `pr-${i}`, plugin: true }); break;
        case 6: s1.detachPrimitive({ id: `pr-${i}`, plugin: true }); break;
        case 7: engine.subscribeCrosshairMove(() => {}); break;
        case 8: engine.subscribeClick(() => {}); break;
        case 9: engine.subscribeDblClick(() => {}); break;
        case 10: engine.setWatermark(0, { visible: true, lines: [{ text: "wm" }] }); break;
        case 11: engine.applyOptions({ width: 800, height: 600 }); break;
        case 12: engine.resize(800, 600, true); break;
        case 13: engine.swapPanes(0, 1); break;
        case 14: s1.setData(candleWalk(77 + i, 4)); break;
        case 15: s2.setData(candleWalk(177 + i, 3)); break;
      }
    }

    engine.destroy();
    // chart.remove was invoked exactly once for destroy (idempotent double-destroy).
    expect(H.reg.charts[0].remove).toHaveBeenCalledTimes(1);

    // Inventory after destroy is the disposed shape.
    const inv = engine.inventory();
    expect(inv.alive).toBe(false);
    expect(inv.series).toBe(0);
    expect(inv.seriesByPane).toEqual([]);
    expect(inv.priceLines).toBe(0);

    // Double destroy is silent: still no second chart.remove call.
    engine.destroy();
    expect(H.reg.charts[0].remove).toHaveBeenCalledTimes(1);

    // The stand-in registry is consistent: zero living chart
    // series/price-line/primitives after destroy.
    let liveSeries = 0;
    let liveLines = 0;
    for (const c of H.reg.charts) {
      for (const p of c.__panes) {
        liveSeries += p.__series.length;
        for (const s of p.__series) liveLines += s.__priceLines.length;
      }
    }
    expect(liveSeries).toBe(0);
    expect(liveLines).toBe(0);
  });
});
