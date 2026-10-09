import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Contract tests for the lightweight-charts 5.2 adapter (lib/chart-engine/lwc).
//
// Real LWC needs a live <canvas>, which vitest/jsdom lacks — so, following the house
// precedent (lib/__tests__/subpaneAssign.test.ts models LWC's pane store rather than
// running it), we vi.mock("lightweight-charts") with a faithful stand-in and assert the
// adapter delegates 1:1. The mock records every construction and call so we can check
// mapping, laziness, reuse, cleanup, subscribe/unsubscribe symmetry, and disposal.
//
// LOCATION NOTE: this file lives in lib/__tests__/ (not lib/chart-engine/__tests__/,
// where the spec nominally wanted it). terminal/vitest.config.ts includes ONLY
// "lib/__tests__/**/*.test.ts" — verified empirically that a file under
// lib/chart-engine/__tests__/ is NOT collected. The spec forbids editing existing files
// (which the config is), and a test that never runs is worthless, so it lands here.
// ─────────────────────────────────────────────────────────────────────────────

// Shared mock registry — hoisted so the vi.mock factory and the test body reference the
// SAME object (vi.mock is hoisted above imports; a plain outer const would be a TDZ error).
const H = vi.hoisted(() => {
  type Spy = ReturnType<typeof vi.fn>;
  interface FakePriceLine {
    __opts: unknown;
    applyOptions: Spy;
  }
  interface FakeSeries {
    __def: unknown;
    __opts: unknown;
    __paneIndex: number;
    setData: Spy;
    update: Spy;
    applyOptions: Spy;
    createPriceLine: Spy;
    removePriceLine: Spy;
    priceToCoordinate: Spy;
    coordinateToPrice: Spy;
    moveToPane: Spy;
    getPane: Spy;
    attachPrimitive: Spy;
    detachPrimitive: Spy;
    // Real LWC exposes priceLines() as a METHOD returning only the custom lines
    // (createPriceLine), with removePriceLine splicing the same array. inventory()
    // reads exactly that, so the stand-in has to own the array rather than just
    // record the calls.
    __priceLines: FakePriceLine[];
    priceLines: Spy;
  }
  interface FakePane {
    __index: number;
    // Series really live in panes in LWC, and pane.getSeries() is how inventory()
    // counts them — so membership is modelled, not faked with a flat list.
    __series: FakeSeries[];
    getSeries: Spy;
    paneIndex: Spy;
    getHeight: Spy;
    setHeight: Spy;
    getStretchFactor: Spy;
    setStretchFactor: Spy;
    getHTMLElement: Spy;
  }
  interface FakePriceScale {
    __id: string;
    __paneIndex: number | undefined;
    width: Spy;
    applyOptions: Spy;
  }
  interface FakeMarkersPlugin {
    __series: FakeSeries;
    __initialMarkers: unknown;
    setMarkers: Spy;
    detach: Spy;
  }
  interface FakeWatermark {
    __pane: FakePane;
    __opts: unknown;
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
  }
  interface FakeChart {
    __opts: unknown;
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
    __ts: FakeTimeScale;
    __panes: FakePane[];
    __priceScales: FakePriceScale[];
  }
  const reg = {
    charts: [] as FakeChart[],
    markers: [] as FakeMarkersPlugin[],
    watermarks: [] as FakeWatermark[],
    lastChart(): FakeChart {
      return reg.charts[reg.charts.length - 1];
    },
    reset(): void {
      reg.charts.length = 0;
      reg.markers.length = 0;
      reg.watermarks.length = 0;
    },
  };

  const makePane = (index: number): FakePane => {
    const pane: FakePane = {
    __index: index,
    __series: [],
    getSeries: vi.fn(() => pane.__series),
    paneIndex: vi.fn(() => index),
    getHeight: vi.fn(() => 100 + index),
    setHeight: vi.fn(),
    getStretchFactor: vi.fn(() => index + 1),
    setStretchFactor: vi.fn(),
    getHTMLElement: vi.fn(() => ({ __paneEl: index }) as unknown),
    };
    return pane;
  };

  const makeSeries = (def: unknown, opts: unknown, paneIndex: number, chart: FakeChart): FakeSeries => {
    const s: FakeSeries = {
      __def: def,
      __opts: opts,
      __paneIndex: paneIndex,
      __priceLines: [],
      priceLines: vi.fn(() => s.__priceLines),
      setData: vi.fn(),
      update: vi.fn(),
      applyOptions: vi.fn(),
      priceToCoordinate: vi.fn((p: number) => p * 2),
      coordinateToPrice: vi.fn((y: number) => y / 2),
      moveToPane: vi.fn((idx: number) => {
        const from = chart.__panes[s.__paneIndex];
        if (from) {
          const at = from.__series.indexOf(s);
          if (at !== -1) from.__series.splice(at, 1);
        }
        s.__paneIndex = idx;
        while (chart.__panes.length <= idx) chart.__panes.push(makePane(chart.__panes.length));
        chart.__panes[Math.min(idx, chart.__panes.length - 1)].__series.push(s);
      }),
      getPane: vi.fn(() => {
        // Mirror LWC's getOrCreatePane clamp: an out-of-range index resolves to the
        // last pane, and the pane list grows to cover the requested slot.
        const idx = Math.min(chart.__panes.length, s.__paneIndex);
        while (chart.__panes.length <= idx) chart.__panes.push(makePane(chart.__panes.length));
        return chart.__panes[Math.min(idx, chart.__panes.length - 1)];
      }),
      attachPrimitive: vi.fn(),
      detachPrimitive: vi.fn(),
      createPriceLine: vi.fn((o: unknown) => {
        const pl: FakePriceLine = { __opts: o, applyOptions: vi.fn() };
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
    getVisibleLogicalRange: vi.fn(() => ({ from: 10, to: 20 })),
    setVisibleLogicalRange: vi.fn(),
    subscribeVisibleLogicalRangeChange: vi.fn(),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
    timeToCoordinate: vi.fn(() => 42),
    coordinateToTime: vi.fn(() => 1_700_000_000),
    scrollToRealTime: vi.fn(),
    scrollToPosition: vi.fn(),
    applyOptions: vi.fn(),
    fitContent: vi.fn(),
  });

  const createChart = vi.fn((_container: unknown, opts: unknown): FakeChart => {
    const ts = makeTimeScale();
    const chart: FakeChart = {
      __opts: opts,
      __ts: ts,
      __panes: [makePane(0)],
      panes: vi.fn(() => chart.__panes),
      timeScale: vi.fn(() => ts),
      addSeries: vi.fn((def: unknown, o: unknown, paneIndex?: number) => {
        const pi = paneIndex ?? 0;
        // Grow panes to model addSeries(paneIndex) clamp+append.
        const idx = Math.min(chart.__panes.length, pi);
        while (chart.__panes.length <= idx) chart.__panes.push(makePane(chart.__panes.length));
        const series = makeSeries(def, o, idx, chart);
        chart.__panes[idx].__series.push(series);
        return series;
      }),
      // LWC disposes a removed series together with everything hanging off it — its
      // price lines and primitives go with it. Modelled, because "the line died with
      // its series" is precisely the ownership claim these tests exist to check.
      removeSeries: vi.fn((series: FakeSeries) => {
        for (const pane of chart.__panes) {
          const at = pane.__series.indexOf(series);
          if (at !== -1) { pane.__series.splice(at, 1); series.__priceLines.length = 0; return; }
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
      remove: vi.fn(),
      __priceScales: [],
      priceScale: vi.fn((id: string, paneIndex?: number): FakePriceScale => {
        const ps: FakePriceScale = { __id: id, __paneIndex: paneIndex, width: vi.fn(() => 57), applyOptions: vi.fn() };
        chart.__priceScales.push(ps);
        return ps;
      }),
      paneSize: vi.fn((paneIndex?: number) => ({ width: 800, height: 400 + (paneIndex ?? 0) })),
      swapPanes: vi.fn(),
      takeScreenshot: vi.fn(() => ({ __canvas: true }) as unknown),
    };
    reg.charts.push(chart);
    return chart;
  });

  const createSeriesMarkers = vi.fn((series: FakeSeries, marks: unknown): FakeMarkersPlugin => {
    const p: FakeMarkersPlugin = { __series: series, __initialMarkers: marks, setMarkers: vi.fn(), detach: vi.fn() };
    reg.markers.push(p);
    return p;
  });

  const createTextWatermark = vi.fn((pane: FakePane, opts: unknown): FakeWatermark => {
    const w: FakeWatermark = { __pane: pane, __opts: opts, detach: vi.fn() };
    reg.watermarks.push(w);
    return w;
  });

  // Sentinel series-definition consts — the adapter must map each kind to the matching one.
  const defs = {
    CandlestickSeries: { seriesType: "Candlestick" },
    BarSeries: { seriesType: "Bar" },
    LineSeries: { seriesType: "Line" },
    AreaSeries: { seriesType: "Area" },
    HistogramSeries: { seriesType: "Histogram" },
    BaselineSeries: { seriesType: "Baseline" },
  };

  return { reg, createChart, createSeriesMarkers, createTextWatermark, defs };
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
}));

// Imported AFTER the mock is registered (vi.mock is hoisted, so this resolves to the mock).
import { createEngine } from "../chart-engine";
import { createLwcEngine } from "../chart-engine/lwc";
import type { EngineSeriesKind } from "../chart-engine";

const container = {} as unknown as HTMLElement;

beforeEach(() => {
  H.reg.reset();
  vi.clearAllMocks();
});

describe("lwc adapter — construction & options", () => {
  it("createEngine('lwc') and createLwcEngine both build one chart via createChart", () => {
    createEngine(container, { width: 800, height: 600 });
    expect(H.createChart).toHaveBeenCalledTimes(1);
    expect(H.createChart.mock.calls[0][0]).toBe(container);
    expect(H.createChart.mock.calls[0][1]).toEqual({ width: 800, height: 600 });

    createLwcEngine(container, { layout: { textColor: "#fff" } });
    expect(H.createChart).toHaveBeenCalledTimes(2);
    expect(H.createChart.mock.calls[1][1]).toEqual({ layout: { textColor: "#fff" } });
  });

  it("createEngine passes {} to createChart when options are omitted", () => {
    createEngine(container);
    expect(H.createChart.mock.calls[0][1]).toEqual({});
  });

  it("createEngine throws on an unknown impl", () => {
    // The impl union is "lwc"-only; force an invalid value to hit the exhaustiveness guard.
    expect(() => createEngine(container, undefined, "canvas" as unknown as "lwc")).toThrow(/unknown impl/);
  });

  it("applyOptions and resize delegate to the chart", () => {
    const e = createEngine(container);
    e.applyOptions({ grid: { vertLines: { color: "#111" } } });
    e.resize(1024, 768, true);
    const c = H.reg.lastChart();
    expect(c.applyOptions).toHaveBeenCalledWith({ grid: { vertLines: { color: "#111" } } });
    expect(c.resize).toHaveBeenCalledWith(1024, 768, true);
  });
});

describe("lwc adapter — kind → series-definition mapping", () => {
  const cases: [EngineSeriesKind, string][] = [
    ["candles", "Candlestick"],
    ["bars", "Bar"],
    ["line", "Line"],
    ["area", "Area"],
    ["histogram", "Histogram"],
    ["baseline", "Baseline"],
  ];
  it.each(cases)("maps kind %s to the %s series definition", (kind, seriesType) => {
    const e = createEngine(container);
    e.addSeries(kind);
    const c = H.reg.lastChart();
    expect(c.addSeries).toHaveBeenCalledTimes(1);
    const passedDef = c.addSeries.mock.calls[0][0] as { seriesType: string };
    expect(passedDef.seriesType).toBe(seriesType);
  });

  it("all six kinds map to six DISTINCT definitions (no accidental aliasing)", () => {
    const e = createEngine(container);
    for (const [kind] of cases) e.addSeries(kind);
    const c = H.reg.lastChart();
    const defsSeen = c.addSeries.mock.calls.map((call) => (call[0] as { seriesType: string }).seriesType);
    expect(new Set(defsSeen).size).toBe(6);
  });

  it("exposes the kind on the returned handle", () => {
    const e = createEngine(container);
    expect(e.addSeries("candles").kind).toBe("candles");
    expect(e.addSeries("baseline").kind).toBe("baseline");
  });
});

describe("lwc adapter — addSeries paneIndex pass-through + clamp model", () => {
  it("forwards options and paneIndex verbatim to chart.addSeries", () => {
    const e = createEngine(container);
    const opts = { color: "#0f0", lineWidth: 2 };
    e.addSeries("line", opts, 2);
    const c = H.reg.lastChart();
    expect(c.addSeries).toHaveBeenCalledWith(expect.anything(), opts, 2);
  });

  it("passes undefined paneIndex through unchanged (LWC defaults to pane 0)", () => {
    const e = createEngine(container);
    e.addSeries("candles", { upColor: "#0f0" });
    const c = H.reg.lastChart();
    expect(c.addSeries.mock.calls[0][2]).toBeUndefined();
  });

  it("paneIndex() reflects the clamp model — out-of-range requests land on the last pane", () => {
    const e = createEngine(container);
    // Only pane 0 exists; requesting pane 5 must clamp to pane 1 (append at end), matching
    // getOrCreatePane semantics the subpaneAssign test pins.
    const s = e.addSeries("histogram", {}, 5);
    expect(s.paneIndex()).toBe(1);
  });

  it("moveToPane delegates to the series and updates the resolved pane index", () => {
    const e = createEngine(container);
    const s = e.addSeries("line", {}, 0);
    s.moveToPane(1);
    const c = H.reg.lastChart();
    const raw = c.addSeries.mock.results[0].value as { moveToPane: ReturnType<typeof vi.fn> };
    expect(raw.moveToPane).toHaveBeenCalledWith(1);
    expect(s.paneIndex()).toBe(1);
  });
});

describe("lwc adapter — series data delegation", () => {
  it("setData / update / applyOptions delegate to the underlying series", () => {
    const e = createEngine(container);
    const s = e.addSeries("line");
    const rows = [{ time: "2020-01-01", value: 1 }];
    const row = { time: "2020-01-02", value: 2 };
    s.setData(rows);
    s.update(row, true);
    s.applyOptions({ color: "#abc" });
    const c = H.reg.lastChart();
    const raw = c.addSeries.mock.results[0].value as {
      setData: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      applyOptions: ReturnType<typeof vi.fn>;
    };
    expect(raw.setData).toHaveBeenCalledWith(rows);
    expect(raw.update).toHaveBeenCalledWith(row, true);
    expect(raw.applyOptions).toHaveBeenCalledWith({ color: "#abc" });
  });

  it("priceToCoordinate / coordinateToPrice delegate and return the raw values", () => {
    const e = createEngine(container);
    const s = e.addSeries("candles");
    expect(s.priceToCoordinate(10)).toBe(20);
    expect(s.coordinateToPrice(20)).toBe(10);
  });

  it("attachPrimitive / detachPrimitive delegate to the series", () => {
    const e = createEngine(container);
    const s = e.addSeries("candles");
    const prim = { id: "sessionShading" };
    s.attachPrimitive(prim);
    s.detachPrimitive(prim);
    const c = H.reg.lastChart();
    const raw = c.addSeries.mock.results[0].value as {
      attachPrimitive: ReturnType<typeof vi.fn>;
      detachPrimitive: ReturnType<typeof vi.fn>;
    };
    expect(raw.attachPrimitive).toHaveBeenCalledWith(prim);
    expect(raw.detachPrimitive).toHaveBeenCalledWith(prim);
  });
});

describe("lwc adapter — markers plugin lifecycle", () => {
  it("does NOT create a markers plugin until setMarkers is first called (lazy)", () => {
    const e = createEngine(container);
    e.addSeries("candles");
    expect(H.createSeriesMarkers).not.toHaveBeenCalled();
  });

  it("creates the plugin on first setMarkers, then REUSES it via plugin.setMarkers", () => {
    const e = createEngine(container);
    const s = e.addSeries("candles");
    const m1 = [{ time: "2020-01-01", position: "aboveBar" as const, shape: "arrowUp" as const, color: "#0f0" }];
    const m2 = [{ time: "2020-01-02", position: "belowBar" as const, shape: "arrowDown" as const, color: "#f00" }];
    s.setMarkers(m1);
    expect(H.createSeriesMarkers).toHaveBeenCalledTimes(1);
    // The plugin is created seeded with the first marker set (forwarded verbatim).
    expect(H.reg.markers[0].__initialMarkers).toBe(m1);
    s.setMarkers(m2);
    // No second plugin — reuse.
    expect(H.createSeriesMarkers).toHaveBeenCalledTimes(1);
    expect(H.reg.markers).toHaveLength(1);
    expect(H.reg.markers[0].setMarkers).toHaveBeenCalledWith(m2);
  });

  it("detaches the markers plugin when the series is removed", () => {
    const e = createEngine(container);
    const s = e.addSeries("candles");
    s.setMarkers([{ time: "2020-01-01", position: "inBar" as const, shape: "circle" as const, color: "#fff" }]);
    const plugin = H.reg.markers[0];
    s.remove();
    expect(plugin.detach).toHaveBeenCalledTimes(1);
  });

  it("a series removed without ever setting markers detaches no plugin", () => {
    const e = createEngine(container);
    const s = e.addSeries("candles");
    s.remove();
    expect(H.reg.markers).toHaveLength(0);
  });
});

describe("lwc adapter — price lines", () => {
  it("createPriceLine delegates and the handle removes via series.removePriceLine", () => {
    const e = createEngine(container);
    const s = e.addSeries("line");
    const opts = { price: 100, color: "#999", lineStyle: 2 };
    const pl = s.createPriceLine(opts);
    const c = H.reg.lastChart();
    const raw = c.addSeries.mock.results[0].value as {
      createPriceLine: ReturnType<typeof vi.fn>;
      removePriceLine: ReturnType<typeof vi.fn>;
      __priceLines: { __opts: unknown }[];
    };
    expect(raw.createPriceLine).toHaveBeenCalledWith(opts);
    expect(raw.__priceLines[0].__opts).toBe(opts);
    pl.remove();
    expect(raw.removePriceLine).toHaveBeenCalledTimes(1);
    // Idempotent — a second remove is a no-op.
    pl.remove();
    expect(raw.removePriceLine).toHaveBeenCalledTimes(1);
  });

  it("price line applyOptions delegates to the raw line", () => {
    const e = createEngine(container);
    const s = e.addSeries("line");
    const pl = s.createPriceLine({ price: 50 });
    pl.applyOptions({ color: "#123" });
    const c = H.reg.lastChart();
    const raw = c.addSeries.mock.results[0].value as { __priceLines: { applyOptions: ReturnType<typeof vi.fn> }[] };
    expect(raw.__priceLines[0].applyOptions).toHaveBeenCalledWith({ color: "#123" });
  });
});

describe("lwc adapter — panes", () => {
  it("panes() returns one handle per LWC pane with pass-through index/height/stretch", () => {
    const e = createEngine(container);
    e.addSeries("line", {}, 1); // force a second pane to exist
    const panes = e.panes();
    expect(panes).toHaveLength(2);
    expect(panes[0].index()).toBe(0);
    expect(panes[1].index()).toBe(1);
    expect(panes[1].height()).toBe(101); // mock: 100 + index
    panes[1].setHeight(250);
    panes[1].setStretchFactor(0.4);
    expect(panes[1].stretchFactor()).toBe(2); // mock: index + 1
    const c = H.reg.lastChart();
    expect(c.__panes[1].setHeight).toHaveBeenCalledWith(250);
    expect(c.__panes[1].setStretchFactor).toHaveBeenCalledWith(0.4);
  });
});

describe("lwc adapter — time scale", () => {
  it("returns the SAME handle across calls (stable subscription identity)", () => {
    const e = createEngine(container);
    expect(e.timeScale()).toBe(e.timeScale());
  });

  it("logical range get/set convert and delegate", () => {
    const e = createEngine(container);
    const ts = e.timeScale();
    expect(ts.getVisibleLogicalRange()).toEqual({ from: 10, to: 20 });
    ts.setVisibleLogicalRange({ from: 3, to: 7 });
    expect(H.reg.lastChart().__ts.setVisibleLogicalRange).toHaveBeenCalledWith({ from: 3, to: 7 });
  });

  it("scrollToRealtime bridges to LWC's scrollToRealTime (capital T)", () => {
    const e = createEngine(container);
    e.timeScale().scrollToRealtime();
    expect(H.reg.lastChart().__ts.scrollToRealTime).toHaveBeenCalledTimes(1);
  });

  it("scrollToPosition / timeToCoordinate / coordinateToTime / fitContent / applyOptions delegate", () => {
    const e = createEngine(container);
    const ts = e.timeScale();
    ts.scrollToPosition(5, true);
    expect(ts.timeToCoordinate("2020-01-01")).toBe(42);
    expect(ts.coordinateToTime(42)).toBe(1_700_000_000);
    ts.fitContent();
    ts.applyOptions({ rightOffset: 12 });
    const raw = H.reg.lastChart().__ts;
    expect(raw.scrollToPosition).toHaveBeenCalledWith(5, true);
    expect(raw.fitContent).toHaveBeenCalledTimes(1);
    expect(raw.applyOptions).toHaveBeenCalledWith({ rightOffset: 12 });
  });

  it("visible-range subscribe/unsubscribe resolve to the SAME LWC callback (symmetry)", () => {
    const e = createEngine(container);
    const ts = e.timeScale();
    const handler = vi.fn();
    ts.subscribeVisibleLogicalRangeChange(handler);
    ts.unsubscribeVisibleLogicalRangeChange(handler);
    const raw = H.reg.lastChart().__ts;
    const subbed = raw.subscribeVisibleLogicalRangeChange.mock.calls[0][0];
    const unsubbed = raw.unsubscribeVisibleLogicalRangeChange.mock.calls[0][0];
    expect(subbed).toBe(unsubbed); // reference-equal → LWC can actually detach it
    // And the wrapper forwards a converted range to the user handler.
    (subbed as (r: unknown) => void)({ from: 1, to: 2 });
    expect(handler).toHaveBeenCalledWith({ from: 1, to: 2 });
    (subbed as (r: unknown) => void)(null);
    expect(handler).toHaveBeenCalledWith(null);
  });
});

describe("lwc adapter — crosshair/click subscriptions", () => {
  it("crosshair subscribe/unsubscribe pair up by reference and forward the param", () => {
    const e = createEngine(container);
    const handler = vi.fn();
    e.subscribeCrosshairMove(handler);
    e.unsubscribeCrosshairMove(handler);
    const c = H.reg.lastChart();
    const subbed = c.subscribeCrosshairMove.mock.calls[0][0];
    const unsubbed = c.unsubscribeCrosshairMove.mock.calls[0][0];
    expect(subbed).toBe(unsubbed);
    (subbed as (p: unknown) => void)({ time: 123 });
    expect(handler).toHaveBeenCalledWith({ time: 123 });
  });

  it("click and dbl-click subscribe/unsubscribe are symmetric too", () => {
    const e = createEngine(container);
    const onClick = vi.fn();
    const onDbl = vi.fn();
    e.subscribeClick(onClick);
    e.unsubscribeClick(onClick);
    e.subscribeDblClick(onDbl);
    e.unsubscribeDblClick(onDbl);
    const c = H.reg.lastChart();
    expect(c.subscribeClick.mock.calls[0][0]).toBe(c.unsubscribeClick.mock.calls[0][0]);
    expect(c.subscribeDblClick.mock.calls[0][0]).toBe(c.unsubscribeDblClick.mock.calls[0][0]);
  });
});

describe("lwc adapter — watermark replace-on-recall", () => {
  it("creates a text watermark on the requested pane", () => {
    const e = createEngine(container);
    e.setWatermark(0, [{ text: "MASTERMIND" }]);
    expect(H.createTextWatermark).toHaveBeenCalledTimes(1);
    const [pane, opts] = H.createTextWatermark.mock.calls[0];
    expect((pane as { __index: number }).__index).toBe(0);
    expect((opts as { lines: { text: string }[] }).lines[0].text).toBe("MASTERMIND");
  });

  it("re-calling for the same pane DETACHES the previous watermark before creating a new one", () => {
    const e = createEngine(container);
    e.setWatermark(0, [{ text: "first" }]);
    const first = H.reg.watermarks[0];
    e.setWatermark(0, [{ text: "second" }]);
    expect(first.detach).toHaveBeenCalledTimes(1);
    expect(H.createTextWatermark).toHaveBeenCalledTimes(2);
    expect(H.reg.watermarks).toHaveLength(2);
  });

  it("watermarks on different panes coexist (no cross-pane detach)", () => {
    const e = createEngine(container);
    e.addSeries("line", {}, 1); // ensure pane 1 exists
    e.setWatermark(0, [{ text: "p0" }]);
    e.setWatermark(1, [{ text: "p1" }]);
    expect(H.reg.watermarks[0].detach).not.toHaveBeenCalled();
    expect(H.reg.watermarks[1].detach).not.toHaveBeenCalled();
    expect(H.createTextWatermark).toHaveBeenCalledTimes(2);
  });

  it("throws when the requested pane does not exist", () => {
    const e = createEngine(container);
    expect(() => e.setWatermark(9, [{ text: "nope" }])).toThrow(/pane 9/);
  });

  it("a full WatermarkSpec forwards alignment + visibility (ChartPanel's centered brand mark)", () => {
    const e = createEngine(container);
    e.setWatermark(0, { visible: false, horzAlign: "center", vertAlign: "center", lines: [{ text: "MASTERMIND" }] });
    const [, opts] = H.createTextWatermark.mock.calls[0] as [unknown, { visible: boolean; horzAlign: string; vertAlign: string; lines: { text: string }[] }];
    expect(opts.visible).toBe(false);
    expect(opts.horzAlign).toBe("center");
    expect(opts.vertAlign).toBe("center");
    expect(opts.lines[0].text).toBe("MASTERMIND");
  });
});

describe("lwc adapter — P0.5 surface (priceScale / paneSize / swapPanes / takeScreenshot / pane element)", () => {
  it("priceScale forwards id + paneIndex and resolves live per call", () => {
    const e = createEngine(container);
    const ps = e.priceScale("volume", 0);
    ps.applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    expect(ps.width()).toBe(57);
    const c = H.reg.lastChart();
    // Two method calls → two live resolutions of the same (id, paneIndex) address.
    expect(c.priceScale).toHaveBeenCalledWith("volume", 0);
    expect(c.__priceScales.length).toBe(2);
    expect(c.__priceScales[0].applyOptions).toHaveBeenCalledWith({ scaleMargins: { top: 0.78, bottom: 0 } });
  });

  it("paneSize forwards the index and returns plain {width,height}", () => {
    const e = createEngine(container);
    expect(e.paneSize(2)).toEqual({ width: 800, height: 402 });
    expect(H.reg.lastChart().paneSize).toHaveBeenCalledWith(2);
  });

  it("swapPanes and takeScreenshot delegate to the chart", () => {
    const e = createEngine(container);
    e.swapPanes(0, 1);
    const shot = e.takeScreenshot();
    const c = H.reg.lastChart();
    expect(c.swapPanes).toHaveBeenCalledWith(0, 1);
    expect((shot as unknown as { __canvas: boolean }).__canvas).toBe(true);
  });

  it("series.pane() resolves the live pane; pane.getHTMLElement() forwards", () => {
    const e = createEngine(container);
    const s = e.addSeries("line", {}, 1);
    const pane = s.pane();
    expect(pane.index()).toBe(1);
    expect((pane.getHTMLElement() as unknown as { __paneEl: number }).__paneEl).toBe(1);
  });

  it("the new surface throws after destroy", () => {
    const e = createEngine(container);
    e.destroy();
    expect(() => e.priceScale("right")).toThrow(/disposed/);
    expect(() => e.paneSize()).toThrow(/disposed/);
    expect(() => e.swapPanes(0, 1)).toThrow(/disposed/);
    expect(() => e.takeScreenshot()).toThrow(/disposed/);
  });
});

describe("lwc adapter — disposal & idempotency", () => {
  it("destroy calls chart.remove exactly once and is idempotent", () => {
    const e = createEngine(container);
    const c = H.reg.lastChart();
    e.destroy();
    e.destroy();
    expect(c.remove).toHaveBeenCalledTimes(1);
  });

  it("destroy detaches all outstanding watermarks", () => {
    const e = createEngine(container);
    e.addSeries("line", {}, 1);
    e.setWatermark(0, [{ text: "a" }]);
    e.setWatermark(1, [{ text: "b" }]);
    e.destroy();
    expect(H.reg.watermarks[0].detach).toHaveBeenCalledTimes(1);
    expect(H.reg.watermarks[1].detach).toHaveBeenCalledTimes(1);
  });

  it("post-destroy engine calls throw Error('chart-engine: disposed')", () => {
    const e = createEngine(container);
    e.destroy();
    expect(() => e.addSeries("line")).toThrow("chart-engine: disposed");
    expect(() => e.panes()).toThrow("chart-engine: disposed");
    expect(() => e.timeScale()).toThrow("chart-engine: disposed");
    expect(() => e.applyOptions({})).toThrow("chart-engine: disposed");
    expect(() => e.resize(1, 1)).toThrow("chart-engine: disposed");
    expect(() => e.unwrap()).toThrow("chart-engine: disposed");
    expect(() => e.setWatermark(0, [])).toThrow("chart-engine: disposed");
    expect(() => e.subscribeCrosshairMove(vi.fn())).toThrow("chart-engine: disposed");
  });

  it("post-destroy calls on handles obtained BEFORE destroy also throw", () => {
    const e = createEngine(container);
    const s = e.addSeries("line");
    const ts = e.timeScale();
    const panes = e.panes();
    e.destroy();
    expect(() => s.setData([])).toThrow("chart-engine: disposed");
    expect(() => ts.fitContent()).toThrow("chart-engine: disposed");
    expect(() => panes[0].height()).toThrow("chart-engine: disposed");
  });

  it("remove() on a series is idempotent (single removeSeries)", () => {
    const e = createEngine(container);
    const s = e.addSeries("line");
    const c = H.reg.lastChart();
    s.remove();
    s.remove();
    expect(c.removeSeries).toHaveBeenCalledTimes(1);
  });

  it("calling a method on an already-removed series throws (removed guard, not disposed)", () => {
    const e = createEngine(container);
    const s = e.addSeries("line");
    s.remove();
    expect(() => s.setData([])).toThrow(/series removed/);
  });
});

describe("lwc adapter — unwrap escape hatch", () => {
  it("engine.unwrap returns the raw chart; series/pane/timescale unwrap return their raw handles", () => {
    const e = createEngine(container);
    const c = H.reg.lastChart();
    expect(e.unwrap()).toBe(c);
    const s = e.addSeries("candles");
    const rawSeries = c.addSeries.mock.results[0].value;
    expect(s.unwrap()).toBe(rawSeries);
    expect(e.timeScale().unwrap()).toBe(c.__ts);
    expect(e.panes()[0].unwrap()).toBe(c.__panes[0]);
    const pl = s.createPriceLine({ price: 1 });
    const rawPl = (rawSeries as { __priceLines: unknown[] }).__priceLines[0];
    expect(pl.unwrap()).toBe(rawPl);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// inventory() — the live-resource census.
//
// This is the contract the chart-engine quality gate's "no leak across 50
// symbol/timeframe switches" claim rests on, so the tests below are written against
// the ownership SEMANTICS rather than the delegation: they build resources, tear them
// down the way ChartPanel does, and assert the census follows.
//
// The census deliberately reads the renderer, not the engine's own `series` Set —
// ChartPanel still creates most series on the unwrapped IChartApi, and a census that
// only saw engine-created handles would report a clean bill of health for exactly the
// call sites most likely to leak. Several cases below therefore add series RAW, the
// way ChartPanel does, and check the census still sees them.
// ─────────────────────────────────────────────────────────────────────────────
describe("lwc adapter — inventory()", () => {
  type RawChart = {
    addSeries: (def: unknown, opts?: unknown, pane?: number) => RawSeries;
    removeSeries: (s: RawSeries) => void;
    panes: () => unknown[];
  };
  type RawSeries = { createPriceLine: (o: unknown) => RawLine; removePriceLine: (l: RawLine) => void };
  type RawLine = { __opts: unknown };

  it("an empty chart reports one pane and nothing else", () => {
    const e = createEngine(container);
    expect(e.inventory()).toEqual({ alive: true, panes: 1, series: 0, seriesByPane: [0], priceLines: 0, watermarks: 0 });
  });

  it("counts series per pane, in pane order", () => {
    const e = createEngine(container);
    e.addSeries("candles", {}, 0);
    e.addSeries("line", {}, 0);
    e.addSeries("histogram", {}, 1);
    const inv = e.inventory();
    expect(inv.panes).toBe(2);
    expect(inv.series).toBe(3);
    expect(inv.seriesByPane).toEqual([2, 1]);
  });

  it("sees series created RAW through unwrap(), not just engine-created ones", () => {
    const e = createEngine(container);
    const raw = e.unwrap<RawChart>();
    raw.addSeries(H.defs.LineSeries, {}, 0);
    raw.addSeries(H.defs.LineSeries, {}, 1);
    // Nothing went through engine.addSeries, so an engine-side registry would say 0.
    expect(e.inventory().series).toBe(2);
  });

  it("removing a series drops it and its price lines from the census", () => {
    const e = createEngine(container);
    const s = e.addSeries("line");
    s.createPriceLine({ price: 1 });
    s.createPriceLine({ price: 2 });
    expect(e.inventory()).toMatchObject({ series: 1, priceLines: 2 });
    s.remove();
    expect(e.inventory()).toMatchObject({ series: 0, priceLines: 0 });
  });

  it("a price line removed explicitly leaves the census, and its series stays", () => {
    const e = createEngine(container);
    const s = e.addSeries("line");
    const a = s.createPriceLine({ price: 1 });
    s.createPriceLine({ price: 2 });
    a.remove();
    expect(e.inventory()).toMatchObject({ series: 1, priceLines: 1 });
  });

  it("moveToPane relocates a series without changing the total", () => {
    const e = createEngine(container);
    e.addSeries("line", {}, 0);
    const s = e.addSeries("line", {}, 1);
    expect(e.inventory().seriesByPane).toEqual([1, 1]);
    s.moveToPane(0);
    const inv = e.inventory();
    expect(inv.series).toBe(2);
    expect(inv.seriesByPane).toEqual([2, 0]);
  });

  it("counts watermarks the engine owns, and a replacement does not stack", () => {
    const e = createEngine(container);
    e.setWatermark(0, [{ text: "a" }]);
    expect(e.inventory().watermarks).toBe(1);
    e.setWatermark(0, [{ text: "b" }]);
    expect(e.inventory().watermarks).toBe(1);
  });

  // The defect class this census exists to catch: a price line drawn on a series the
  // creator does NOT own outlives the creator's own teardown. Removing the creator's
  // series cannot reclaim it, so it has to be removed explicitly — and until it is,
  // the count climbs once per generation with nothing else looking different.
  it("a price line drawn on a FOREIGN series survives that creator's teardown", () => {
    const e = createEngine(container);
    const priceSeries = e.addSeries("candles", {}, 0);   // long-lived, survives generations
    for (let generation = 0; generation < 5; generation++) {
      const own = e.addSeries("line", {}, 0);            // this generation's own series
      own.createPriceLine({ price: 10 });                // disposed with `own`
      priceSeries.createPriceLine({ price: 20 });        // NOT disposed with `own`
      own.remove();
    }
    const inv = e.inventory();
    expect(inv.series).toBe(1);        // every generation's own series was reclaimed
    expect(inv.priceLines).toBe(5);    // ...but the foreign-anchored lines were not
  });

  it("explicitly removing the foreign-anchored lines returns the census to steady state", () => {
    const e = createEngine(container);
    const priceSeries = e.addSeries("candles", {}, 0);
    for (let generation = 0; generation < 5; generation++) {
      const pooled = [priceSeries.createPriceLine({ price: 20 }), priceSeries.createPriceLine({ price: 30 })];
      const own = e.addSeries("line", {}, 0);
      own.remove();
      for (const line of pooled) line.remove();          // the pool is the disposal owner
      expect(e.inventory().priceLines).toBe(0);
    }
    expect(e.inventory()).toMatchObject({ series: 1, priceLines: 0 });
  });

  it("stays bounded across 50 add/remove generations", () => {
    const e = createEngine(container);
    const baseline = e.inventory();
    for (let generation = 0; generation < 50; generation++) {
      const overlay = e.addSeries("line", {}, 0);
      const sub = e.addSeries("histogram", {}, 1);
      sub.createPriceLine({ price: generation });
      sub.setMarkers([{ time: 1, position: "aboveBar", shape: "circle", color: "#fff" }]);
      overlay.remove();
      sub.remove();
    }
    const after = e.inventory();
    expect(after.series).toBe(baseline.series);
    expect(after.priceLines).toBe(0);
    // Panes are allowed to persist — LWC keeps an emptied pane rather than resplicing
    // indices under live series — so assert they are BOUNDED, not that they vanish.
    expect(after.panes).toBeLessThanOrEqual(2);
  });

  it("a destroyed engine reports alive:false with zeroes instead of throwing", () => {
    const e = createEngine(container);
    e.addSeries("line").createPriceLine({ price: 1 });
    e.setWatermark(0, [{ text: "x" }]);
    e.destroy();
    expect(() => e.inventory()).not.toThrow();
    expect(e.inventory()).toEqual({ alive: false, panes: 0, series: 0, seriesByPane: [], priceLines: 0, watermarks: 0 });
  });

  it("survives a renderer that throws mid-census", () => {
    const e = createEngine(container);
    e.addSeries("line");
    const c = H.reg.lastChart();
    c.__panes[0].getSeries.mockImplementationOnce(() => { throw new Error("pane gone"); });
    expect(() => e.inventory()).not.toThrow();
    expect(e.inventory().alive).toBe(true);
  });
});
