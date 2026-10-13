// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Contract tests for the LWC primitive bridge: toLwcPrimitive in
// lib/chart-engine/lwc/index.ts (the only module allowed to name
// lightweight-charts types) plus LwcSeriesHandle.attachPrimitive/detachPrimitive.
//
// Real LWC needs a live <canvas>, which jsdom does not provide, so — following the
// house precedent (lib/__tests__/lwcAdapter.test.ts, subpaneAssign.test.ts) — the
// chart is a vi.mock("lightweight-charts") stand-in. Unlike lwcAdapter.test.ts this
// stand-in also DRIVES the plugin lifecycle the way LWC 5.2 does, because the bridge
// is defined by that lifecycle and not by a single delegating call:
//
//   series.attachPrimitive(p)  → p.attached({ chart, series, requestUpdate }) now
//   a render pass              → p.updateAllViews(), then for every p.paneViews()
//                                entry p.renderer().draw(target) with a target whose
//                                useMediaCoordinateSpace hands over a recording fake
//                                2D context (jsdom has no real canvas)
//   series.detachPrimitive(p)  → p.detached()
//   chart.removeSeries(s)      → p.detached() for every plugin still on s
//
// Asserted here: attached() exactly once with the right seriesId/paneIndex, update()
// at most once per generation and never with a stale or non-ready projection,
// paint() through the pane view with the very projection object update() received,
// zOrder for all three tiers, hitTest mapping (and null), and detached() exactly
// once on detachPrimitive / series remove() / engine destroy() — including when LWC
// had already called detached() itself. Native (non-Engine) LWC primitives must
// still be forwarded untouched: that is the path ChartPanel, sessionShading and
// drawingPaneReadiness use today.
// ─────────────────────────────────────────────────────────────────────────────

// Shared mock registry — hoisted so the vi.mock factory and the test body see the
// SAME objects (vi.mock is hoisted above imports).
const H = vi.hoisted(() => {
  type Spy = ReturnType<typeof vi.fn>;

  interface Size {
    width: number;
    height: number;
  }
  /** The media-scope callback hands over this fake; the bridge never names the
   *  fancy-canvas types, so a plain structural target is enough to drive it. */
  interface DrawTarget {
    useMediaCoordinateSpace(f: (scope: { context: unknown; mediaSize: Size }) => void): void;
    useBitmapCoordinateSpace(
      f: (scope: {
        context: unknown;
        mediaSize: Size;
        bitmapSize: Size;
        horizontalPixelRatio: number;
        verticalPixelRatio: number;
      }) => void,
    ): void;
  }
  interface FakeRenderer {
    draw(target: DrawTarget): void;
    drawBackground?(target: DrawTarget): void;
  }
  interface FakeView {
    zOrder?(): string;
    renderer(): FakeRenderer | null;
  }
  interface FakeAttachedParam {
    chart: unknown;
    series: unknown;
    requestUpdate: Spy;
    horzScaleBehavior: Record<string, unknown>;
  }
  /** The slice of LWC 5.2 ISeriesPrimitive a plugin object may expose. */
  interface FakePlugin {
    attached?(param: FakeAttachedParam): void;
    detached?(): void;
    updateAllViews?(): void;
    paneViews?(): readonly FakeView[];
    hitTest?(x: number, y: number): { externalId: string; zOrder: string; cursorStyle?: string } | null;
  }
  interface FakePane {
    paneIndex(): number;
    getSeries(): FakeSeries[];
  }
  interface FakeSeries {
    __def: unknown;
    __opts: unknown;
    __paneIndex: number;
    __plugins: { plugin: FakePlugin; param: FakeAttachedParam }[];
    __priceLines: unknown[];
    setData: Spy;
    update: Spy;
    applyOptions: Spy;
    options: Spy;
    data: Spy;
    dataByIndex: Spy;
    priceLines: Spy;
    createPriceLine: Spy;
    removePriceLine: Spy;
    priceScale: Spy;
    priceToCoordinate: Spy;
    coordinateToPrice: Spy;
    getPane: Spy;
    moveToPane: Spy;
    attachPrimitive: Spy;
    detachPrimitive: Spy;
  }
  interface FakeTimeScale {
    logicalToCoordinate: Spy;
    coordinateToLogical: Spy;
    timeToCoordinate: Spy;
    coordinateToTime: Spy;
    getVisibleLogicalRange: Spy;
    getVisibleRange: Spy;
    width: Spy;
  }
  interface FakeChart {
    __opts: unknown;
    __series: FakeSeries[];
    __panes: FakePane[];
    __ts: FakeTimeScale;
    addSeries: Spy;
    removeSeries: Spy;
    panes: Spy;
    timeScale: Spy;
    paneSize: Spy;
    priceScale: Spy;
    chartElement: Spy;
    options: Spy;
    applyOptions: Spy;
    remove: Spy;
    takeScreenshot: Spy;
  }

  // Mutable "viewport" the projection is read from: bump it to change geometry and
  // the bridge has to hand out a new projection generation.
  const defaults = (): Geo => ({
    width: 800,
    height: 400,
    from: 10,
    to: 20,
    priceTop: 200,
    priceSlope: -5,
  });
  interface Geo {
    width: number;
    height: number;
    from: number;
    to: number;
    priceTop: number;
    priceSlope: number;
  }

  const reg = {
    geo: defaults(),
    charts: [] as FakeChart[],
    lastChart(): FakeChart {
      return reg.charts[reg.charts.length - 1];
    },
    /** The fake series behind the newest handle — what a render pass walks. */
    lastSeries(): FakeSeries {
      const chart = reg.lastChart();
      return chart.__series[chart.__series.length - 1];
    },
    barSpacing: () => reg.geo.width / (reg.geo.to - reg.geo.from),
    reset(): void {
      reg.geo = defaults();
      reg.charts.length = 0;
    },
  };

  const makeTimeScale = (): FakeTimeScale => ({
    logicalToCoordinate: vi.fn((i: number) => (i - reg.geo.from + 0.5) * reg.barSpacing()),
    coordinateToLogical: vi.fn((x: number) => x / reg.barSpacing() + reg.geo.from - 0.5),
    timeToCoordinate: vi.fn((t: unknown) => (typeof t === "number" ? t * 10 : null)),
    coordinateToTime: vi.fn((x: number) => x / 10),
    getVisibleLogicalRange: vi.fn(() => ({ from: reg.geo.from, to: reg.geo.to })),
    getVisibleRange: vi.fn(() => ({ from: 1_700_000_000, to: 1_700_086_400 })),
    width: vi.fn(() => reg.geo.width),
  });

  const makePriceScale = (series: FakeSeries) => ({
    width: vi.fn(() => 57),
    applyOptions: vi.fn(),
    options: vi.fn(() => ({ mode: 0, autoScale: true })),
    getVisibleRange: vi.fn(() => ({ from: 10, to: 20 })),
    setVisibleRange: vi.fn(),
    setAutoScale: vi.fn(),
    series,
  });

  const makeSeries = (chart: FakeChart, def: unknown, opts: unknown, paneIndex: number): FakeSeries => {
    const s: FakeSeries = {
      __def: def,
      __opts: opts,
      __paneIndex: paneIndex,
      __plugins: [],
      __priceLines: [],
      setData: vi.fn(),
      update: vi.fn(),
      applyOptions: vi.fn(),
      options: vi.fn(() => s.__opts ?? {}),
      data: vi.fn(() => []),
      dataByIndex: vi.fn(() => null),
      priceLines: vi.fn(() => s.__priceLines),
      createPriceLine: vi.fn(() => ({ applyOptions: vi.fn(), options: vi.fn(() => ({})) })),
      removePriceLine: vi.fn(),
      priceScale: vi.fn(() => makePriceScale(s)),
      // The pane-scoped price map: y = priceTop + price * priceSlope.
      priceToCoordinate: vi.fn((p: number) => reg.geo.priceTop + p * reg.geo.priceSlope),
      coordinateToPrice: vi.fn((y: number) => (y - reg.geo.priceTop) / reg.geo.priceSlope),
      getPane: vi.fn(() => chart.__panes[Math.min(s.__paneIndex, chart.__panes.length - 1)]),
      moveToPane: vi.fn((i: number) => {
        s.__paneIndex = i;
      }),
      attachPrimitive: vi.fn((plugin: FakePlugin) => {
        const param: FakeAttachedParam = {
          chart,
          series: s,
          requestUpdate: vi.fn(),
          horzScaleBehavior: { type: "comparable" },
        };
        s.__plugins.push({ plugin, param });
        plugin.attached?.(param); // LWC attaches synchronously, inside attachPrimitive
        return plugin;
      }),
      detachPrimitive: vi.fn((plugin: FakePlugin) => {
        // LWC ignores a plugin it does not know — only a real detachment calls
        // detached(), which is what makes the bridge's own guard observable.
        const at = s.__plugins.findIndex((entry) => entry.plugin === plugin);
        if (at === -1) return;
        s.__plugins.splice(at, 1);
        plugin.detached?.();
      }),
    };
    return s;
  };

  const makePane = (index: number, series: () => FakeSeries[]): FakePane => ({
    paneIndex: () => index,
    getSeries: series,
  });

  const createChart = vi.fn((_container: unknown, opts: unknown): FakeChart => {
    const ts = makeTimeScale();
    const chart: FakeChart = {
      __series: [],
      __panes: [],
      __ts: ts,
      __opts: opts,
      addSeries: vi.fn((def: unknown, o: unknown, paneIndex?: number) => {
        const idx = paneIndex ?? 0;
        while (chart.__panes.length <= idx) {
          chart.__panes.push(makePane(chart.__panes.length, () => chart.__series));
        }
        const series = makeSeries(chart, def, o, idx);
        chart.__series.push(series);
        return series;
      }),
      removeSeries: vi.fn((series: FakeSeries) => {
        // LWC disposes a series together with the plugins hanging off it.
        for (const entry of series.__plugins.slice()) entry.plugin.detached?.();
        series.__plugins.length = 0;
        const at = chart.__series.indexOf(series);
        if (at !== -1) chart.__series.splice(at, 1);
      }),
      panes: vi.fn(() => chart.__panes),
      timeScale: vi.fn(() => ts),
      paneSize: vi.fn(() => ({ width: reg.geo.width, height: reg.geo.height })),
      priceScale: vi.fn(() => ({
        width: vi.fn(() => 57),
        applyOptions: vi.fn(),
        options: vi.fn(() => ({ autoScale: true })),
        getVisibleRange: vi.fn(() => ({ from: 10, to: 20 })),
        setVisibleRange: vi.fn(),
        setAutoScale: vi.fn(),
      })),
      chartElement: vi.fn(() => ({ __chartEl: true })),
      options: vi.fn(() => ({ layout: { fontSize: 12 } })),
      applyOptions: vi.fn(),
      remove: vi.fn(() => {
        for (const series of chart.__series.slice()) {
          for (const entry of series.__plugins.slice()) entry.plugin.detached?.();
          series.__plugins.length = 0;
        }
      }),
      takeScreenshot: vi.fn(() => ({ __canvas: true })),
    };
    reg.charts.push(chart);
    return chart;
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
  const createSeriesMarkers = vi.fn(() => ({ setMarkers: vi.fn(), detach: vi.fn() }));
  const createTextWatermark = vi.fn(() => ({ detach: vi.fn(), applyOptions: vi.fn() }));

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

// Imported AFTER the mock is registered (vi.mock is hoisted).
import { createLwcEngine, toLwcPrimitive } from "../chart-engine/lwc";
import { projectionReady } from "../chart-engine/primitive";
import type {
  EnginePrimitive,
  EngineProjection,
  PrimitiveAttachContext,
  PrimitiveHit,
  PrimitiveZOrder,
} from "../chart-engine/primitive";
import type { EngineTime } from "../chart-engine/api";

// ── Test doubles ──────────────────────────────────────────────────────────────

const container = {} as unknown as HTMLElement;

/** Types derived from the bridge's own signature, so this file never imports
 *  "lightweight-charts" (the LWC-facing types stay inside lwc/index.ts). */
type BridgeAttachParam = Parameters<NonNullable<ReturnType<typeof toLwcPrimitive>["attached"]>>[0];

/** A CanvasRenderingContext2D stand-in: jsdom has no canvas, so every call is
 *  recorded as a string instead of touching pixels. */
function recordingContext() {
  const calls: string[] = [];
  const record = (name: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push(`${name}(${args.join(",")})`);
    });
  const ctx = {
    save: record("save"),
    restore: record("restore"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    stroke: record("stroke"),
    fillRect: record("fillRect"),
    setTransform: record("setTransform"),
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 1,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

/** One LWC render pass over everything attached to a fake series. */
function renderPass(series = H.reg.lastSeries()) {
  const { ctx, calls } = recordingContext();
  const geo = H.reg.geo;
  const size = { width: geo.width, height: geo.height };
  const target = {
    useMediaCoordinateSpace: vi.fn(
      (f: (scope: { context: unknown; mediaSize: { width: number; height: number } }) => void) => {
        f({ context: ctx, mediaSize: size });
      },
    ),
    useBitmapCoordinateSpace: vi.fn(
      (
        f: (scope: {
          context: unknown;
          mediaSize: { width: number; height: number };
          bitmapSize: { width: number; height: number };
          horizontalPixelRatio: number;
          verticalPixelRatio: number;
        }) => void,
      ) => {
        f({
          context: ctx,
          mediaSize: size,
          bitmapSize: { width: size.width * 2, height: size.height * 2 },
          horizontalPixelRatio: 2,
          verticalPixelRatio: 2,
        });
      },
    ),
  };
  for (const entry of series.__plugins.slice()) {
    entry.plugin.updateAllViews?.();
    for (const view of entry.plugin.paneViews?.() ?? []) {
      view.renderer()?.draw(target);
    }
  }
  return { ctx, calls, target };
}

type PaintCall = { ctx: CanvasRenderingContext2D; proj: EngineProjection };

interface SpyOptions {
  zOrder?: PrimitiveZOrder;
  paint?: boolean;
  hitTest?: (x: number, y: number) => PrimitiveHit | null;
}

function spyPrimitive(id: string, options: SpyOptions = {}) {
  const contexts: PrimitiveAttachContext[] = [];
  const updates: EngineProjection[] = [];
  const paints: PaintCall[] = [];
  const detached = vi.fn();
  const primitive: EnginePrimitive = {
    id,
    ...(options.zOrder === undefined ? {} : { zOrder: options.zOrder }),
    attached: (ctx: PrimitiveAttachContext) => {
      contexts.push(ctx);
    },
    detached,
    update: (proj: EngineProjection) => {
      updates.push(proj);
    },
    ...(options.paint
      ? {
          paint: (ctx: CanvasRenderingContext2D, proj: EngineProjection) => {
            paints.push({ ctx, proj });
            ctx.beginPath();
          },
        }
      : {}),
    ...(options.hitTest ? { hitTest: options.hitTest } : {}),
  };
  return { primitive, contexts, updates, paints, detached };
}

function fakeProjection(generation: number, widthPx = 800, heightPx = 400): EngineProjection {
  return {
    generation,
    dpr: 2,
    widthPx,
    heightPx,
    xOfLogical: (i: number) => (i + 0.5) * 10,
    logicalOfX: (x: number) => x / 10 - 0.5,
    yOfPrice: (p: number) => 200 - p * 5,
    priceOfY: (y: number) => (200 - y) / 5,
    timeToX: (t: EngineTime) => (typeof t === "number" ? t : null),
    xToTime: (x: number) => x,
  };
}

/** A SeriesAttachedParameter for bridges driven directly (no series handle).
 *  The chart/series stubs are inert on purpose: with an explicit projection source
 *  the bridge must not need either, and an unresolvable pane exercises the
 *  options.paneIndex fallback. */
function attachParam() {
  const requestUpdate = vi.fn();
  return {
    requestUpdate,
    value: {
      chart: { inert: true },
      series: { inert: true },
      requestUpdate,
      horzScaleBehavior: { type: "comparable" },
    } as unknown as BridgeAttachParam,
  };
}

function setup(paneIndex = 0) {
  const engine = createLwcEngine(container);
  const handle = engine.addSeries("candles", {}, paneIndex);
  return { engine, handle, native: H.reg.lastSeries() };
}

beforeEach(() => {
  H.reg.reset();
  vi.clearAllMocks();
});

// ── attached() / requestUpdate ────────────────────────────────────────────────

describe("toLwcPrimitive — attach context", () => {
  it("calls primitive.attached exactly once with the series label, live paneIndex and LWC's requestUpdate", () => {
    const { handle, native } = setup(1);
    const spy = spyPrimitive("overlay-a", { paint: true });
    handle.attachPrimitive(spy.primitive);

    expect(native.attachPrimitive).toHaveBeenCalledTimes(1);
    const entry = native.__plugins[0];
    expect(entry.plugin).not.toBe(spy.primitive); // wrapped, never forwarded raw
    expect(spy.contexts).toHaveLength(1);
    expect(spy.contexts[0].paneIndex).toBe(1);
    expect(spy.contexts[0].seriesId).toMatch(/^lwc-series-\d+$/);

    // ctx.requestUpdate is LWC's own handle, and it does not deliver synchronously.
    spy.contexts[0].requestUpdate();
    expect(entry.param.requestUpdate).toHaveBeenCalledTimes(1);
    expect(spy.updates).toHaveLength(1); // the attach pass itself delivered gen 1

    renderPass(native);
    renderPass(native);
    expect(spy.contexts).toHaveLength(1);
    expect(spy.updates).toHaveLength(1);
  });

  it("honours an explicit seriesId/paneIndex when the bridge is built directly", () => {
    const spy = spyPrimitive("overlay-direct", { paint: true });
    const bridge = toLwcPrimitive(spy.primitive, () => fakeProjection(1), {
      seriesId: "pane-2-series-0",
      paneIndex: 2,
    });
    const param = attachParam();
    bridge.attached?.(param.value);
    expect(spy.contexts).toHaveLength(1);
    expect(spy.contexts[0].seriesId).toBe("pane-2-series-0");
    expect(spy.contexts[0].paneIndex).toBe(2);
    expect(param.requestUpdate).not.toHaveBeenCalled();
    spy.contexts[0].requestUpdate();
    expect(param.requestUpdate).toHaveBeenCalledTimes(1);
  });

  it("defaults seriesId to the empty string when the caller supplies no options", () => {
    const spy = spyPrimitive("overlay-default", { paint: true });
    const bridge = toLwcPrimitive(spy.primitive, () => fakeProjection(1));
    bridge.attached?.(attachParam().value);
    expect(spy.contexts[0].seriesId).toBe("");
    expect(spy.contexts[0].paneIndex).toBe(0);
  });

  it("ignores a second attach of the same EnginePrimitive object", () => {
    const { handle, native } = setup(0);
    const spy = spyPrimitive("overlay-twice", { paint: true });
    handle.attachPrimitive(spy.primitive);
    handle.attachPrimitive(spy.primitive);
    expect(native.attachPrimitive).toHaveBeenCalledTimes(1);
    expect(spy.contexts).toHaveLength(1);
    handle.detachPrimitive(spy.primitive);
    handle.attachPrimitive(spy.primitive); // a detach makes it attachable again
    expect(native.attachPrimitive).toHaveBeenCalledTimes(2);
    expect(spy.contexts).toHaveLength(2);
  });
});

// ── projection content and generations ───────────────────────────────────────

describe("toLwcPrimitive — EngineProjection built from LWC", () => {
  it("reads x/logical and time/x off the time scale, price/y off the series, size off the pane", () => {
    const { handle } = setup(0);
    const spy = spyPrimitive("overlay-geom", { paint: true });
    handle.attachPrimitive(spy.primitive);

    const geo = H.reg.geo;
    const proj = spy.updates[0];
    expect(proj).toBeDefined();
    expect(projectionReady(proj)).toBe(true);
    expect(proj.generation).toBe(1);
    expect(proj.widthPx).toBe(geo.width);
    expect(proj.heightPx).toBe(geo.height);
    expect(proj.dpr).toBe(window.devicePixelRatio);

    const barSpacing = geo.width / (geo.to - geo.from);
    expect(proj.xOfLogical(geo.from)).toBeCloseTo(0.5 * barSpacing, 6);
    expect(proj.logicalOfX(0.5 * barSpacing)).toBeCloseTo(geo.from, 6);
    expect(proj.yOfPrice(10)).toBe(geo.priceTop + 10 * geo.priceSlope);
    expect(proj.priceOfY(geo.priceTop + 10 * geo.priceSlope)).toBeCloseTo(10, 6);
    expect(proj.timeToX(1_700_000_000)).toBe(17_000_000_000);
    expect(proj.xToTime(40)).toBe(4);
  });

  it("delivers one update per generation and bumps the generation when geometry changes", () => {
    const { handle, native } = setup(0);
    const spy = spyPrimitive("overlay-gen", { paint: true });
    handle.attachPrimitive(spy.primitive);
    renderPass(native);
    renderPass(native);
    expect(spy.updates.map((p) => p.generation)).toEqual([1]);

    H.reg.geo.height = 500;
    renderPass(native);
    expect(spy.updates).toHaveLength(2);
    expect(spy.updates[1].generation).toBe(2);
    expect(spy.updates[1].heightPx).toBe(500);
    expect(spy.updates[1]).not.toBe(spy.updates[0]);

    H.reg.geo.priceSlope = -6; // a price-map change alone is new geometry
    renderPass(native);
    const generations = spy.updates.map((p) => p.generation);
    expect(generations).toEqual([1, 2, 3]);
    expect(generations[2]).toBeGreaterThan(generations[1]);
  });

  it("never delivers a stale generation and never delivers a non-ready projection", () => {
    const spy = spyPrimitive("overlay-stale", { paint: true });
    let current = fakeProjection(7);
    const bridge = toLwcPrimitive(spy.primitive, () => current);
    bridge.attached?.(attachParam().value);
    expect(spy.updates.map((p) => p.generation)).toEqual([7]);

    bridge.updateAllViews?.(); // same generation again
    expect(spy.updates).toHaveLength(1);

    current = fakeProjection(6); // stale: lower than what was already delivered
    bridge.updateAllViews?.();
    bridge.updateAllViews?.();
    expect(spy.updates).toHaveLength(1);

    current = fakeProjection(8, 0, 0); // not projectionReady()
    bridge.updateAllViews?.();
    expect(spy.updates).toHaveLength(1);

    current = fakeProjection(9);
    bridge.updateAllViews?.();
    expect(spy.updates.map((p) => p.generation)).toEqual([7, 9]);
  });

  it("defers attached() until the first ready projection, then wires it once (C03-A01)", () => {
    const spy = spyPrimitive("overlay-queued", { paint: true });
    let current: EngineProjection | null = fakeProjection(1, 0, 0);
    const bridge = toLwcPrimitive(spy.primitive, () => current, { seriesId: "q", paneIndex: 1 });
    bridge.attached?.(attachParam().value);
    bridge.updateAllViews?.();
    expect(spy.contexts).toHaveLength(0);
    expect(spy.updates).toHaveLength(0);
    expect(bridge.paneViews?.()[0].renderer()).not.toBeNull();

    current = fakeProjection(2);
    bridge.updateAllViews?.();
    expect(spy.contexts).toHaveLength(1);
    expect(spy.contexts[0].seriesId).toBe("q");
    expect(spy.updates.map((p) => p.generation)).toEqual([2]);
  });

  it("keeps an EnginePrimitive unwired while the pane has no geometry, then catches up", () => {
    H.reg.geo.width = 0; // a pane that has never been laid out
    const { handle, native } = setup(0);
    const spy = spyPrimitive("overlay-noedge", { paint: true });
    handle.attachPrimitive(spy.primitive);
    expect(spy.contexts).toHaveLength(0);
    expect(spy.updates).toHaveLength(0);
    renderPass(native);
    expect(spy.paints).toHaveLength(0);

    H.reg.geo.width = 640;
    renderPass(native);
    expect(spy.contexts).toHaveLength(1);
    // Generation 1 was the zero-width geometry: the token counts distinct
    // geometries the source produced, not deliveries, so the first projection the
    // primitive is allowed to see is generation 2.
    expect(spy.updates.map((p) => p.generation)).toEqual([2]);
    expect(spy.paints).toHaveLength(1);
    expect(spy.paints[0].proj).toBe(spy.updates[0]);
  });
});

// ── paint through paneViews / zOrder ──────────────────────────────────────────

describe("toLwcPrimitive — pane views, zOrder and paint", () => {
  it("paints with the very projection object update() received, inside useMediaCoordinateSpace", () => {
    const { handle, native } = setup(0);
    const spy = spyPrimitive("overlay-paint", { paint: true });
    handle.attachPrimitive(spy.primitive);

    const plugin = native.__plugins[0].plugin;
    expect(plugin.paneViews?.()).toHaveLength(1);
    const { target, ctx, calls } = renderPass(native);

    expect(target.useMediaCoordinateSpace).toHaveBeenCalledTimes(1);
    expect(spy.paints).toHaveLength(1);
    expect(spy.paints[0].proj).toBe(spy.updates[0]);
    expect(spy.paints[0].ctx).toBe(ctx);
    expect(calls).toContain("beginPath()"); // the paint reached the fake 2D context
  });

  it("maps all three zOrder tiers, defaulting to normal", () => {
    const tiers: { tier?: PrimitiveZOrder; expected: string }[] = [
      { tier: "bottom", expected: "bottom" },
      { expected: "normal" },
      { tier: "normal", expected: "normal" },
      { tier: "top", expected: "top" },
    ];
    for (const { tier, expected } of tiers) {
      const { handle, native } = setup(0);
      const spy = spyPrimitive(`overlay-z-${expected}`, { zOrder: tier, paint: true });
      handle.attachPrimitive(spy.primitive);
      const view = native.__plugins[0].plugin.paneViews?.()[0];
      expect(view?.zOrder?.()).toBe(expected);
    }
  });

  it("exposes no pane view for a primitive without paint(), but still updates it", () => {
    const { handle, native } = setup(0);
    const spy = spyPrimitive("overlay-logic");
    handle.attachPrimitive(spy.primitive);
    expect(native.__plugins[0].plugin.paneViews?.()).toHaveLength(0);
    expect(spy.updates).toHaveLength(1);
    expect(() => renderPass(native)).not.toThrow();
    expect(spy.paints).toHaveLength(0);
  });

  it("never paints before the first ready projection", () => {
    H.reg.geo.height = 0;
    const { handle, native } = setup(0);
    const spy = spyPrimitive("overlay-dry", { paint: true });
    handle.attachPrimitive(spy.primitive);
    expect(spy.updates).toHaveLength(0);

    const dry = renderPass(native);
    expect(spy.paints).toHaveLength(0);
    expect(dry.target.useMediaCoordinateSpace).not.toHaveBeenCalled();

    H.reg.geo.height = 300;
    renderPass(native);
    expect(spy.paints).toHaveLength(1);
    expect(spy.paints[0].proj.heightPx).toBe(300);
  });

  it("re-enters the media coordinate space for every primitive attached to the series", () => {
    const { handle, native } = setup(0);
    const a = spyPrimitive("overlay-mix-a", { paint: true, zOrder: "bottom" });
    const b = spyPrimitive("overlay-mix-b", { paint: true, zOrder: "top" });
    handle.attachPrimitive(a.primitive);
    handle.attachPrimitive(b.primitive);
    const { target } = renderPass(native);
    expect(target.useMediaCoordinateSpace).toHaveBeenCalledTimes(2);
    expect(a.paints).toHaveLength(1);
    expect(b.paints).toHaveLength(1);
    expect(native.__plugins[0].plugin.paneViews?.()[0].zOrder?.()).toBe("bottom");
    expect(native.__plugins[1].plugin.paneViews?.()[0].zOrder?.()).toBe("top");
  });
});

// ── hitTest ───────────────────────────────────────────────────────────────────

describe("toLwcPrimitive — hitTest", () => {
  it("maps a hit onto PrimitiveHoveredItem with the primitive's zOrder", () => {
    const { handle, native } = setup(0);
    const hit: PrimitiveHit = { primitiveId: "anchor-3", cursor: "grab", data: { anchor: 1 } };
    const spy = spyPrimitive("overlay-hit", {
      zOrder: "top",
      paint: true,
      hitTest: () => hit,
    });
    handle.attachPrimitive(spy.primitive);
    expect(native.__plugins[0].plugin.hitTest?.(120, 40)).toEqual({
      externalId: "anchor-3",
      zOrder: "top",
      cursorStyle: "grab",
    });
  });

  it("omits cursorStyle when the hit carries no cursor hint", () => {
    const { handle, native } = setup(0);
    const spy = spyPrimitive("overlay-hit-nocursor", {
      zOrder: "bottom",
      paint: true,
      hitTest: () => ({ primitiveId: "body" }),
    });
    handle.attachPrimitive(spy.primitive);
    expect(native.__plugins[0].plugin.hitTest?.(1, 1)).toEqual({
      externalId: "body",
      zOrder: "bottom",
    });
  });

  it("answers null for a miss, for a primitive without hitTest, and after release", () => {
    const { handle, native } = setup(0);
    const miss = spyPrimitive("overlay-miss", { paint: true, hitTest: () => null });
    const plain = spyPrimitive("overlay-plain", { paint: true });
    handle.attachPrimitive(miss.primitive);
    handle.attachPrimitive(plain.primitive);
    expect(native.__plugins[0].plugin.hitTest?.(4, 5)).toBeNull();
    expect(native.__plugins[1].plugin.hitTest?.(4, 5)).toBeNull();

    const released = native.__plugins[0].plugin;
    handle.detachPrimitive(miss.primitive);
    // A released bridge stays silent: no hit, no pane view, no repaint request.
    expect(released.hitTest?.(4, 5)).toBeNull();
    expect(released.paneViews?.()).toHaveLength(0);
    released.updateAllViews?.();
    expect(miss.updates).toHaveLength(1);
  });

  it("passes the raw pixel coordinates through to the primitive", () => {
    const { handle, native } = setup(0);
    const seen: [number, number][] = [];
    const spy = spyPrimitive("overlay-coords", {
      paint: true,
      hitTest: (x, y) => {
        seen.push([x, y]);
        return null;
      },
    });
    handle.attachPrimitive(spy.primitive);
    native.__plugins[0].plugin.hitTest?.(37, 211);
    expect(seen).toEqual([[37, 211]]);
  });
});

// ── detach: exactly once on every teardown path ───────────────────────────────

describe("LwcSeriesHandle — bridge bookkeeping and detach", () => {
  it("detaches the SAME wrapper it attached and calls detached() exactly once", () => {
    const { handle, native } = setup(0);
    const spy = spyPrimitive("overlay-undock", { paint: true });
    handle.attachPrimitive(spy.primitive);
    const wrapper = native.__plugins[0].plugin;

    handle.detachPrimitive(spy.primitive);
    expect(native.detachPrimitive).toHaveBeenCalledTimes(1);
    expect(native.detachPrimitive.mock.calls[0][0]).toBe(wrapper);
    expect(native.__plugins).toHaveLength(0);
    expect(spy.detached).toHaveBeenCalledTimes(1);

    handle.detachPrimitive(spy.primitive); // unknown to the bridge now: a no-op
    expect(spy.detached).toHaveBeenCalledTimes(1);
    // LWC calls detached() unconditionally (dev :12802-12807), so an engine-shaped value
    // this handle does not own must never reach it — the second detach is a true no-op.
    expect(native.detachPrimitive).toHaveBeenCalledTimes(1);
    expect(native.detachPrimitive.mock.calls.map((c) => c[0])).not.toContain(spy.primitive);
  });

  it("detaches when the series is removed, and stays quiet on a repeat remove", () => {
    const { handle, native } = setup(0);
    const spy = spyPrimitive("overlay-with-series", { paint: true });
    handle.attachPrimitive(spy.primitive);
    handle.remove();
    expect(spy.detached).toHaveBeenCalledTimes(1);
    expect(native.__plugins).toHaveLength(0);
    handle.remove();
    expect(spy.detached).toHaveBeenCalledTimes(1);
  });

  it("detaches every bridge on engine destroy(), once per primitive", () => {
    const { engine, handle } = setup(0);
    const second = engine.addSeries("line", {}, 1);
    const a = spyPrimitive("overlay-a", { paint: true });
    const b = spyPrimitive("overlay-b", { paint: true });
    const c = spyPrimitive("overlay-c", { paint: true });
    handle.attachPrimitive(a.primitive);
    handle.attachPrimitive(b.primitive);
    second.attachPrimitive(c.primitive);
    expect(H.reg.lastChart().__series[1].__plugins).toHaveLength(1);

    engine.destroy();
    expect(a.detached).toHaveBeenCalledTimes(1);
    expect(b.detached).toHaveBeenCalledTimes(1);
    expect(c.detached).toHaveBeenCalledTimes(1);
    engine.destroy(); // idempotent destroy
    expect(a.detached).toHaveBeenCalledTimes(1);
    expect(c.detached).toHaveBeenCalledTimes(1);
  });

  it("does not double-detach when the host calls detached() itself", () => {
    const { handle, native } = setup(0);
    const spy = spyPrimitive("overlay-host-detach", { paint: true });
    handle.attachPrimitive(spy.primitive);
    const plugin = native.__plugins[0].plugin;

    plugin.detached?.(); // the host tore it down on its own
    expect(spy.detached).toHaveBeenCalledTimes(1);
    handle.detachPrimitive(spy.primitive); // our bookkeeping still unwinds
    expect(spy.detached).toHaveBeenCalledTimes(1);
    plugin.detached?.();
    expect(spy.detached).toHaveBeenCalledTimes(1);
  });

  it("still releases when the host drops the plugin without calling detached()", () => {
    const { handle, native } = setup(0);
    const spy = spyPrimitive("overlay-force", { paint: true });
    handle.attachPrimitive(spy.primitive);
    const plugin = native.__plugins[0].plugin;
    native.__plugins.length = 0; // a host that forgot the plugin entirely
    handle.detachPrimitive(spy.primitive);
    expect(plugin.detached).toBeDefined();
    expect(spy.detached).toHaveBeenCalledTimes(1); // our own release covered it
  });

  it("forwards a native LWC primitive untouched, both directions", () => {
    const { handle, native } = setup(0);
    const draw = vi.fn();
    const native2 = {
      attached: vi.fn(),
      detached: vi.fn(),
      updateAllViews: vi.fn(),
      paneViews: () => [{ zOrder: () => "bottom", renderer: () => ({ draw }) }],
    };
    handle.attachPrimitive(native2);
    expect(native.attachPrimitive).toHaveBeenCalledTimes(1);
    expect(native.attachPrimitive.mock.calls[0][0]).toBe(native2);
    expect(native2.attached).toHaveBeenCalledTimes(1); // the host wired it, not us

    renderPass(native);
    expect(native2.paneViews()).toHaveLength(1);
    expect(draw).toHaveBeenCalledTimes(1);

    handle.detachPrimitive(native2);
    expect(native.detachPrimitive.mock.calls[0][0]).toBe(native2);
    expect(native2.detached).toHaveBeenCalledTimes(1);
  });

  it("does not mistake a hand-rolled plugin for an EnginePrimitive", () => {
    const { handle, native } = setup(0);
    // Shape A: a string id and the three engine hooks, but no update() — the
    // sessionShading primitive family (attached/detached/paneViews/updateAllViews).
    const shapeA = {
      id: "session-shading",
      attached: vi.fn(),
      detached: vi.fn(),
      paneViews: () => [],
      updateAllViews: vi.fn(),
    };
    // Shape B: update() but no string id.
    const shapeB = {
      attached: vi.fn(),
      detached: vi.fn(),
      update: vi.fn(),
      paneViews: () => [],
    };
    handle.attachPrimitive(shapeA);
    handle.attachPrimitive(shapeB);
    expect(native.attachPrimitive.mock.calls[0][0]).toBe(shapeA);
    expect(native.attachPrimitive.mock.calls[1][0]).toBe(shapeB);
    handle.detachPrimitive(shapeA);
    handle.detachPrimitive(shapeB);
    expect(native.detachPrimitive.mock.calls[0][0]).toBe(shapeA);
    expect(native.detachPrimitive.mock.calls[1][0]).toBe(shapeB);
  });

  it("releasing the bridges leaves the series usable for native primitives", () => {
    const { handle } = setup(0);
    const spy = spyPrimitive("overlay-mixed", { paint: true });
    const native2 = { attached: vi.fn(), detached: vi.fn(), paneViews: () => [] };
    handle.attachPrimitive(spy.primitive);
    handle.attachPrimitive(native2);
    handle.detachPrimitive(spy.primitive);
    handle.remove();
    expect(spy.detached).toHaveBeenCalledTimes(1);
    expect(native2.detached).toHaveBeenCalledTimes(1);
  });
});

// ── the bridge keeps the engine contract intact ──────────────────────────────

describe("toLwcPrimitive — engine-neutral contract", () => {
  it("is idempotent about detach and never rewires after release", () => {
    const spy = spyPrimitive("overlay-idempotent", { paint: true });
    const bridge = toLwcPrimitive(spy.primitive, () => fakeProjection(1));
    const param = attachParam();
    bridge.attached?.(param.value);
    expect(spy.contexts).toHaveLength(1);

    bridge.detached?.();
    bridge.detached?.();
    expect(spy.detached).toHaveBeenCalledTimes(1);

    bridge.attached?.(param.value); // a host that re-uses the wrapper after detach
    bridge.updateAllViews?.();
    expect(spy.contexts).toHaveLength(1);
    expect(spy.updates).toHaveLength(1);
    expect(bridge.paneViews?.()).toHaveLength(0);
    expect(bridge.hitTest?.(1, 1)).toBeNull();
  });

  it("drops the projection subscription implicitly: a released bridge ignores updateAllViews", () => {
    const spy = spyPrimitive("overlay-late-update", { paint: true });
    let current = fakeProjection(1);
    const bridge = toLwcPrimitive(spy.primitive, () => current);
    bridge.attached?.(attachParam().value);
    bridge.detached?.();
    current = fakeProjection(2);
    bridge.updateAllViews?.();
    expect(spy.updates).toHaveLength(1);
  });
});
