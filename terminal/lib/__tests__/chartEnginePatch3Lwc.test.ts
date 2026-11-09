// @vitest-environment jsdom
//
// PATCH3L — adversarial test suite for the lwc-prim + engid reviews (qwen3.8-max,
// verdict ACCEPT_WITH_PATCHES, against H2 = 0147bafa0). Every `describe` below pins
// one finding by an LWC-FAITHFUL stand-in (detachPrimitive calls detached()
// unconditionally, per lightweight-charts 5.2.0 dev :12802-12807). Each finding
// has a MUTANT receipt quoted in RESULT.md EVIDENCE: apply the mutant, RED,
// restore, GREEN.
//
// Mocking strategy mirrors chartEngineLwcPrimitive.test.ts: a vi.hoisted registry
// plus vi.mock("lightweight-charts"). The lwc stand-in in this file is the
// LWC-FAITHFUL one (detached() runs unconditionally in detachPrimitive); the
// pre-existing chartEngineLwcPrimitive.test.ts file keeps its looser stand-in
// unchanged per the binding rule on existing test files.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// LWC-faithful stand-in registry
// ─────────────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => {
  type Spy = ReturnType<typeof vi.fn>;

  interface Size {
    width: number;
    height: number;
  }
  interface DrawTarget {
    useMediaCoordinateSpace(f: (scope: { context: unknown; mediaSize: Size }) => void): void;
  }
  interface FakeRenderer {
    draw(target: DrawTarget): void;
  }
  interface FakeView {
    zOrder?(): string;
    renderer(): FakeRenderer | null;
  }
  interface FakePlugin {
    attached?(param: FakeAttachedParam): void;
    detached?(): void;
    updateAllViews?(): void;
    paneViews?(): readonly FakeView[];
    hitTest?(x: number, y: number): { externalId: string; zOrder: string } | null;
  }
  interface FakeAttachedParam {
    chart: unknown;
    series: unknown;
    requestUpdate: Spy;
    horzScaleBehavior: Record<string, unknown>;
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
    attachPrimitive: Spy;
    detachPrimitive: Spy;
    getPane: Spy;
    moveToPane: Spy;
    priceToCoordinate: Spy;
    coordinateToPrice: Spy;
  }
  interface FakeTimeScale {
    logicalToCoordinate: Spy;
    coordinateToLogical: Spy;
    timeToCoordinate: Spy;
    coordinateToTime: Spy;
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
    chartElement: Spy;
    options: Spy;
    applyOptions: Spy;
    remove: Spy;
    takeScreenshot: Spy;
  }

  interface Geo {
    width: number;
    height: number;
    from: number;
    to: number;
    priceTop: number;
    priceSlope: number;
  }

  const reg = {
    geo: {
      width: 800,
      height: 400,
      from: 10,
      to: 20,
      priceTop: 200,
      priceSlope: -5,
    } as Geo,
    charts: [] as FakeChart[],
    lastChart(): FakeChart {
      return reg.charts[reg.charts.length - 1];
    },
    lastSeries(): FakeSeries {
      const chart = reg.lastChart();
      return chart.__series[chart.__series.length - 1];
    },
    barSpacing: (): number => reg.geo.width / (reg.geo.to - reg.geo.from),
    reset(): void {
      reg.geo = {
        width: 800,
        height: 400,
        from: 10,
        to: 20,
        priceTop: 200,
        priceSlope: -5,
      };
      reg.charts.length = 0;
    },
  };

  const makeTimeScale = (): FakeTimeScale => ({
    logicalToCoordinate: vi.fn((i: number) => (i - reg.geo.from + 0.5) * reg.barSpacing()),
    coordinateToLogical: vi.fn((x: number) => x / reg.barSpacing() + reg.geo.from - 0.5),
    timeToCoordinate: vi.fn((t: unknown) => (typeof t === "number" ? t * 10 : null)),
    coordinateToTime: vi.fn((x: number) => x / 10),
    width: vi.fn(() => reg.geo.width),
  });

  const makePane = (index: number, seriesFn: () => FakeSeries[]): FakePane => ({
    paneIndex: () => index,
    getSeries: seriesFn,
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
      attachPrimitive: vi.fn((plugin: FakePlugin) => {
        const param: FakeAttachedParam = {
          chart,
          series: s,
          requestUpdate: vi.fn(),
          horzScaleBehavior: { type: "comparable" },
        };
        s.__plugins.push({ plugin, param });
        // Real LWC: attachPrimitive calls attached() synchronously, inside the
        // same call (SeriesApi :12789-12801).
        plugin.attached?.(param);
        return plugin;
      }),
      // ── LWC-FAITHFUL detachPrimitive (dev :12802-12807):
      //     Series._internal_detachPrimitive only filters the wrapper array,
      //     then `if (primitive.detached) primitive.detached();` runs
      //     UNCONDITIONALLY (whether LWC knew the object or not).
      detachPrimitive: vi.fn((plugin: FakePlugin) => {
        const at = s.__plugins.findIndex((entry) => entry.plugin === plugin);
        if (at !== -1) s.__plugins.splice(at, 1);
        plugin.detached?.();
      }),
      getPane: vi.fn(() => chart.__panes[Math.min(s.__paneIndex, chart.__panes.length - 1)]),
      moveToPane: vi.fn((i: number) => {
        s.__paneIndex = i;
      }),
      priceToCoordinate: vi.fn((p: number) => reg.geo.priceTop + p * reg.geo.priceSlope),
      coordinateToPrice: vi.fn((y: number) => (y - reg.geo.priceTop) / reg.geo.priceSlope),
    };
    return s;
  };

  // createChart stub: builds the chart graph and pushes it onto reg.charts.
  // The 'throw' override lets FIND-3 force a throw to check write-order.
  const createChart = vi.fn((container: HTMLElement, opts: unknown): FakeChart => {
    void container;
    const chart: FakeChart = {
      __opts: opts,
      __series: [],
      __panes: [],
      __ts: makeTimeScale(),
      addSeries: vi.fn(),
      removeSeries: vi.fn(),
      panes: vi.fn(),
      timeScale: vi.fn(),
      paneSize: vi.fn(),
      chartElement: vi.fn(),
      options: vi.fn(() => ({})),
      applyOptions: vi.fn(),
      remove: vi.fn(),
      takeScreenshot: vi.fn(() => document.createElement("canvas")),
    };
    chart.addSeries = vi.fn((def: unknown, options: unknown, paneIndex?: number): FakeSeries => {
      const pi = paneIndex ?? chart.__panes.length;
      // Pane 0 always exists; create new panes on demand.
      while (chart.__panes.length <= pi) {
        const idx = chart.__panes.length;
        chart.__panes.push(
          makePane(idx, () => chart.__panes[idx].getSeries()),
        );
      }
      const series = makeSeries(chart, def, options, pi);
      chart.__series.push(series);
      chart.panes = vi.fn(() => chart.__panes);
      chart.timeScale = vi.fn(() => chart.__ts);
      chart.paneSize = vi.fn(() => ({ width: reg.geo.width, height: reg.geo.height }));
      return series;
    });
    // Initial pane 0
    chart.__panes.push(makePane(0, () => chart.__panes[0].getSeries()));
    chart.panes = vi.fn(() => chart.__panes);
    chart.timeScale = vi.fn(() => chart.__ts);
    chart.paneSize = vi.fn(() => ({ width: reg.geo.width, height: reg.geo.height }));
    reg.charts.push(chart);
    return chart;
  });

  const reset = (): void => {
    reg.reset();
    createChart.mockClear();
  };

  return { reg, createChart, reset };
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

// Imported AFTER mock registration.
import { createEngine } from "../chart-engine";
import { createLwcEngine } from "../chart-engine/lwc";

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  H.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
  container.remove();
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build an engine primitive with attached/detached/update spies.
// ─────────────────────────────────────────────────────────────────────────────

interface SpyPrimitive {
  primitive: {
    id: string;
    attached: (ctx: unknown) => void;
    detached: () => void;
    update: (proj: unknown) => void;
  };
  spy: { detached: ReturnType<typeof vi.fn>; attached: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  contexts: unknown[];
  updates: unknown[];
}

function spyPrimitive(id: string): SpyPrimitive {
  const spy = { detached: vi.fn(), attached: vi.fn(), update: vi.fn() };
  const contexts: unknown[] = [];
  const updates: unknown[] = [];
  const primitive = {
    id,
    attached: (ctx: unknown) => {
      spy.attached(ctx);
      contexts.push(ctx);
    },
    detached: () => {
      spy.detached();
    },
    update: (proj: unknown) => {
      spy.update(proj);
      updates.push(proj);
    },
  };
  return { primitive, spy, contexts, updates };
}

// Drive the bridge's flush the way LWC's `updateAllViews → paneViews → draw`
// pipeline does it. Walk every series on every chart and invoke the wrapper
// each attached plugin installed.
function renderPass(): void {
  for (const chart of H.reg.charts) {
    for (const series of chart.__series) {
      for (const entry of series.__plugins.slice()) {
        entry.plugin.updateAllViews?.();
        const views = entry.plugin.paneViews?.() ?? [];
        for (const v of views) {
          const renderer = v.renderer();
          if (!renderer) continue;
          renderer.draw({
            useMediaCoordinateSpace: (fn) =>
              fn({ context: {}, mediaSize: { width: H.reg.geo.width, height: H.reg.geo.height } }),
          });
        }
      }
    }
  }
}

// Bump the geometry so the next flush yields a fresh projection generation.
function bumpGeometry(): void {
  H.reg.geo.width += 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// F1 (lwcprim P1): detachPrimitive must NOT forward a raw EnginePrimitive to
// LWC when the handle has no bridge for it (LWC 5.2 calls detached()
// unconditionally — dev :12802-12807).
// ─────────────────────────────────────────────────────────────────────────────

describe("F1 P1: detachPrimitive never forwards an unattached EnginePrimitive to LWC", () => {
  it("second detachPrimitive on a handle that owns no bridge for it is a no-op (no LWC call)", () => {
    const engine = createLwcEngine(container);
    const handle = engine.addSeries("candles", {}, 0);
    const { primitive, spy } = spyPrimitive("overlay-f1");
    handle.attachPrimitive(primitive);
    handle.detachPrimitive(primitive);
    // First detach: LWC.detachPrimitive called once; bridge's detached() called once.
    const native = H.reg.lastSeries().detachPrimitive;
    expect(native).toHaveBeenCalledTimes(1);
    expect(spy.detached).toHaveBeenCalledTimes(1);

    // Second detach (handle still alive but the bridge is gone): a no-op.
    handle.detachPrimitive(primitive);
    expect(native).toHaveBeenCalledTimes(1); // not called again
    expect(spy.detached).toHaveBeenCalledTimes(1); // not called again

    engine.destroy();
  });

  it("detachPrimitive on a handle that NEVER attached the primitive is a no-op", () => {
    const engine = createLwcEngine(container);
    const handleA = engine.addSeries("candles", {}, 0);
    const handleB = engine.addSeries("line", {}, 1);
    const { primitive, spy } = spyPrimitive("overlay-f1-b");
    handleA.attachPrimitive(primitive);
    // detachPrimitive through the WRONG handle: handleB never wired it.
    handleB.detachPrimitive(primitive);
    // LWC never sees it (no raw forwarding).
    const chart = H.reg.lastChart();
    expect(chart.__series[0].detachPrimitive).toHaveBeenCalledTimes(0);
    expect(chart.__series[1].detachPrimitive).toHaveBeenCalledTimes(0);
    expect(spy.detached).toHaveBeenCalledTimes(0);

    // Real owner still detaches cleanly.
    handleA.detachPrimitive(primitive);
    expect(chart.__series[0].detachPrimitive).toHaveBeenCalledTimes(1);
    expect(spy.detached).toHaveBeenCalledTimes(1);

    engine.destroy();
  });

  it("a foreign EnginePrimitive (attached on a different chart on the same container) is ignored", () => {
    const engineA = createLwcEngine(container);
    const handleA = engineA.addSeries("candles", {}, 0);
    const { primitive } = spyPrimitive("overlay-f1-c");
    handleA.attachPrimitive(primitive);
    const nativeA = H.reg.lastSeries().detachPrimitive;

    // Second engine on the same host (lwc): same impl, same container.
    const engineB = createLwcEngine(container);
    const handleB = engineB.addSeries("line", {}, 1);
    // Grab the new chart's last series' detachPrimitive spy.
    const nativeB = H.reg.lastChart().__series[H.reg.lastChart().__series.length - 1].detachPrimitive;

    // Wrong engine's detachPrimitive: a no-op for the foreign primitive.
    handleB.detachPrimitive(primitive);
    expect(nativeB).toHaveBeenCalledTimes(0);

    // Correct owner still detaches cleanly.
    handleA.detachPrimitive(primitive);
    expect(nativeA).toHaveBeenCalledTimes(1);

    engineA.destroy();
    engineB.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIND-1 / FIND-2 / FIND-3 (engid P2): identity marker survives overlap.
//
// Re-home report I6-a..I6-e into P3L-I7-a..e (FOLD3 already used I6 at H2).
// ─────────────────────────────────────────────────────────────────────────────

describe("P3L-I7-a FIND-1 P2: destroying the FIRST of two live lwc engines keeps the marker", () => {
  it("a.destroy() leaves the host marker for the still-live b", () => {
    const a = createEngine(container, {});
    const b = createEngine(container, {});
    expect(container.dataset.chartEngine).toBe("lwc");
    a.destroy();
    expect(b.inventory().alive).toBe(true);
    expect(container.getAttribute("data-chart-engine")).toBe("lwc");
    b.destroy();
    expect(container.hasAttribute("data-chart-engine")).toBe(false);
  });
});

describe("P3L-I7-b FIND-1 P2: destroying the FIRST of two live mm engines keeps the marker", () => {
  it("mm a.destroy() leaves the host marker for the still-live b", () => {
    const a = createEngine(container, { width: 200, height: 100 }, "mm");
    const b = createEngine(container, { width: 200, height: 100 }, "mm");
    expect(container.dataset.chartEngine).toBe("mm");
    a.destroy();
    expect(b.inventory().alive).toBe(true);
    expect(container.getAttribute("data-chart-engine")).toBe("mm");
    b.destroy();
    expect(container.hasAttribute("data-chart-engine")).toBe(false);
  });
});

describe("P3L-I7-c FIND-1/FIND-2 P2: a live lwc engine's destroy() never clears a newer mm marker", () => {
  it("stale lwc.destroy() with live mm engine on the same host leaves the mm marker", () => {
    const a = createEngine(container, {});
    const b = createEngine(container, { width: 200, height: 100 }, "mm");
    expect(container.dataset.chartEngine).toBe("mm");
    a.destroy();
    expect(container.getAttribute("data-chart-engine")).toBe("mm");
    b.destroy();
  });
});

describe("P3L-I7-d FIND-1/FIND-2 P2: a live mm engine's destroy() never clears a newer lwc marker", () => {
  it("stale mm.destroy() with live lwc engine on the same host leaves the lwc marker", () => {
    const a = createEngine(container, { width: 200, height: 100 }, "mm");
    const b = createEngine(container, {});
    expect(container.dataset.chartEngine).toBe("lwc");
    a.destroy();
    expect(container.getAttribute("data-chart-engine")).toBe("lwc");
    b.destroy();
  });
});

describe("P3L-I7-e FIND-3 P2: a throwing createChart leaves no marker on the host", () => {
  it("lwc createChart throws → no data-chart-engine attribute", () => {
    H.createChart.mockImplementationOnce(() => {
      throw new Error("mount failed");
    });
    expect(() => createEngine(container, {})).toThrow("mount failed");
    expect(container.hasAttribute("data-chart-engine")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F3 (lwcprim P2): bridge generation must not regress on detach→re-attach.
// ─────────────────────────────────────────────────────────────────────────────

describe("F3 P2: detach then re-attach never regresses the bridge generation", () => {
  it("re-attached primitive sees a strictly higher generation than its first delivery", () => {
    const engine = createLwcEngine(container);
    const handle = engine.addSeries("candles", {}, 0);
    const { primitive, updates } = spyPrimitive("overlay-f3");

    handle.attachPrimitive(primitive);
    renderPass();
    // First delivery: generation >= 1 (any positive int).
    expect(updates.length).toBeGreaterThanOrEqual(1);
    const firstGen = (updates[0] as { generation: number }).generation;
    expect(Number.isFinite(firstGen)).toBe(true);
    expect(firstGen).toBeGreaterThan(0);

    handle.detachPrimitive(primitive);
    handle.attachPrimitive(primitive);
    // Bump geometry so the bridge hands out a new generation (memo doesn't
    // short-circuit).
    bumpGeometry();
    renderPass();
    expect(updates.length).toBeGreaterThanOrEqual(2);
    const secondGen = (updates[1] as { generation: number }).generation;
    expect(secondGen).toBeGreaterThan(firstGen);

    engine.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F4 (lwcprim P2): lwc duck-type predicate must agree with canvas refusal on
// non-callable paint, non-callable hitTest, and unknown zOrder.
// ─────────────────────────────────────────────────────────────────────────────

describe("F4 P2: lwc isEnginePrimitive agrees with canvas assertEnginePrimitive", () => {
  // The shared predicate (primitive.ts) is what lwc/index.ts now uses; the
  // canvas host uses canvas/refusal.ts's own assertEnginePrimitive (sibling-
  // owned). The lwc adapter's behaviour we exercise through attachPrimitive's
  // routing: an engine-shaped value gets WRAPPED in a bridge (the plugin
  // recorded on the series is NOT the original value); a non-engine-shaped
  // value is forwarded RAW (the plugin recorded IS the original value). The
  // shared predicate rejects non-callable paint / non-callable hitTest /
  // unknown zOrder — the loose inline predicate did not.

  function attachShape(value: unknown): { plugin: unknown; wrapped: boolean } {
    const engine = createLwcEngine(container);
    const handle = engine.addSeries("candles", {}, 0);
    handle.attachPrimitive(value);
    const plugin = H.reg.lastSeries().__plugins[0].plugin;
    engine.destroy();
    return { plugin, wrapped: plugin !== value };
  }

  it("does NOT wrap a shape with non-callable paint (forwarded raw, like a native plugin)", () => {
    const shape = {
      id: "x",
      attached: () => {},
      detached: () => {},
      update: () => {},
      paint: 5, // present but not callable
    };
    const { wrapped } = attachShape(shape);
    expect(wrapped).toBe(false);
  });

  it("does NOT wrap a shape with non-callable hitTest", () => {
    const shape = {
      id: "x",
      attached: () => {},
      detached: () => {},
      update: () => {},
      hitTest: "nope",
    };
    const { wrapped } = attachShape(shape);
    expect(wrapped).toBe(false);
  });

  it("does NOT wrap a shape with zOrder outside the vocabulary", () => {
    const shape = {
      id: "x",
      attached: () => {},
      detached: () => {},
      update: () => {},
      zOrder: "middle",
    };
    const { wrapped } = attachShape(shape);
    expect(wrapped).toBe(false);
  });

  it("DOES wrap a well-formed EnginePrimitive (regression anchor)", () => {
    const shape = {
      id: "x",
      attached: () => {},
      detached: () => {},
      update: () => {},
    };
    const { wrapped } = attachShape(shape);
    expect(wrapped).toBe(true);
  });

  it("routes a hand-rolled native plugin through unchanged (no string id → not engine)", () => {
    const engine = createLwcEngine(container);
    const handle = engine.addSeries("candles", {}, 0);
    // A hand-rolled plugin WITHOUT id (e.g. sessionShading shape): must be
    // forwarded raw to LWC.
    const native = { attached: vi.fn(), updateAllViews: vi.fn(), paneViews: () => [] };
    handle.attachPrimitive(native);
    const fake = H.reg.lastSeries().attachPrimitive;
    expect(fake).toHaveBeenCalledTimes(1);
    expect(fake.mock.calls[0][0]).toBe(native);
    engine.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F5 (lwcprim P2): lwcCoord null → NaN (never to 0).
// ─────────────────────────────────────────────────────────────────────────────

describe("F5 P2: lwcCoord maps a null coordinate to NaN", () => {
  it("a null logicalToCoordinate hands the primitive NaN, not 0", () => {
    const engine = createLwcEngine(container);
    const handle = engine.addSeries("candles", {}, 0);
    // Make logicalToCoordinate ALWAYS return null: a degenerate time map.
    // The price scale is still healthy (priceToCoordinate unchanged), so the
    // projection IS delivered — the contract promises the consumer NaN here,
    // not 0.
    H.reg.lastChart().__ts.logicalToCoordinate.mockImplementation(() => null);
    const { primitive, updates } = spyPrimitive("overlay-f5");
    handle.attachPrimitive(primitive);
    // Price map is still healthy so projectionReady passes.
    expect(updates.length).toBe(1);
    const proj = updates[0] as { xOfLogical: (i: number) => number; logicalOfX: (x: number) => number };
    expect(Number.isNaN(proj.xOfLogical(0))).toBe(true);
    // The inverse is still finite (it's not a null-returning function).
    expect(Number.isNaN(proj.logicalOfX(0))).toBe(false);
    engine.destroy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F11 (lwcprim P2): ctx.paneIndex stays live across moveToPane / swapPanes.
// ─────────────────────────────────────────────────────────────────────────────

describe("F11 P2: ctx.paneIndex stays live after moveToPane", () => {
  it("a primitive's PrimitiveAttachContext.paneIndex reflects moveToPane", () => {
    const engine = createLwcEngine(container);
    const handle = engine.addSeries("candles", {}, 0);
    // Add another series so pane 1 exists in the stand-in.
    engine.addSeries("line", {}, 1);
    const { primitive, contexts } = spyPrimitive("overlay-f11");
    handle.attachPrimitive(primitive);
    renderPass();
    expect((contexts[0] as { paneIndex: number }).paneIndex).toBe(0);
    handle.moveToPane(1);
    bumpGeometry();
    renderPass();
    expect((contexts[0] as { paneIndex: number }).paneIndex).toBe(1);
    engine.destroy();
  });
});