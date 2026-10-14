import { describe, it, expect, vi, beforeEach } from "vitest";

// C02 handle-surface tests for the LWC adapter. vi.mock("lightweight-charts") matches
// lwcAdapter.test.ts so the stand-in, not a real canvas, is what the adapter talks to.

const H = vi.hoisted(() => {
  type Spy = ReturnType<typeof vi.fn>;
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
    setData: Spy;
    update: Spy;
    applyOptions: Spy;
    options: Spy;
    data: Spy;
    dataByIndex: Spy;
    createPriceLine: Spy;
    removePriceLine: Spy;
    priceToCoordinate: Spy;
    coordinateToPrice: Spy;
    moveToPane: Spy;
    getPane: Spy;
    priceScale: Spy;
    attachPrimitive: Spy;
    detachPrimitive: Spy;
    __priceLines: FakePriceLine[];
    priceLines: Spy;
  }
  interface FakePriceScale {
    __id: string;
    __paneIndex: number | undefined;
    width: Spy;
    applyOptions: Spy;
    options: Spy;
    getVisibleRange: Spy;
    setVisibleRange: Spy;
    setAutoScale: Spy;
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
    __ts: FakeTimeScale;
    __panes: FakePane[];
    __priceScales: FakePriceScale[];
  }
  const reg = {
    charts: [] as FakeChart[],
    markers: [] as unknown[],
    watermarks: [] as unknown[],
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
      priceScale: vi.fn((id: string): FakePriceScale => ({
        __id: id,
        __paneIndex: index,
        width: vi.fn(() => 57),
        applyOptions: vi.fn(),
        options: vi.fn(() => ({ tickMarkDensity: 2 })),
        getVisibleRange: vi.fn(() => ({ from: 1, to: 2 })),
        setVisibleRange: vi.fn(),
        setAutoScale: vi.fn(),
      })),
    };
    return pane;
  };

  const makeSeries = (def: unknown, opts: unknown, paneIndex: number, chart: FakeChart): FakeSeries => {
    const s: FakeSeries = {
      __def: def,
      __opts: opts,
      __paneIndex: paneIndex,
      __priceLines: [],
      __data: [],
      priceLines: vi.fn(() => s.__priceLines),
      setData: vi.fn((rows: unknown[]) => { s.__data = rows; }),
      update: vi.fn(),
      applyOptions: vi.fn(),
      options: vi.fn(() => s.__opts ?? { color: "#abc" }),
      data: vi.fn(() => s.__data),
      dataByIndex: vi.fn((i: number) => (s.__data[i] ?? null) as unknown),
      priceScale: vi.fn((): FakePriceScale => ({
        __id: "right",
        __paneIndex: s.__paneIndex,
        width: vi.fn(() => 57),
        applyOptions: vi.fn(),
        options: vi.fn(() => ({ mode: 0, autoScale: true })),
        getVisibleRange: vi.fn(() => ({ from: 10, to: 20 })),
        setVisibleRange: vi.fn(),
        setAutoScale: vi.fn(),
      })),
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
        const idx = Math.min(chart.__panes.length, s.__paneIndex);
        while (chart.__panes.length <= idx) chart.__panes.push(makePane(chart.__panes.length));
        return chart.__panes[Math.min(idx, chart.__panes.length - 1)];
      }),
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
    getVisibleRange: vi.fn(() => ({ from: 1_700_000_000, to: 1_700_086_400 })),
    setVisibleRange: vi.fn(),
    logicalToCoordinate: vi.fn((i: number) => i * 10),
    coordinateToLogical: vi.fn((x: number) => x / 10),
    width: vi.fn(() => 800),
    timeToIndex: vi.fn(() => 4),
    options: vi.fn(() => ({ borderColor: "#333" })),
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
        const idx = Math.min(chart.__panes.length, pi);
        while (chart.__panes.length <= idx) chart.__panes.push(makePane(chart.__panes.length));
        const series = makeSeries(def, o, idx, chart);
        chart.__panes[idx].__series.push(series);
        return series;
      }),
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
        const ps: FakePriceScale = {
          __id: id,
          __paneIndex: paneIndex,
          width: vi.fn(() => 57),
          applyOptions: vi.fn(),
          options: vi.fn(() => ({ autoScale: true })),
          getVisibleRange: vi.fn(() => ({ from: 10, to: 20 })),
          setVisibleRange: vi.fn(),
          setAutoScale: vi.fn(),
        };
        chart.__priceScales.push(ps);
        return ps;
      }),
      paneSize: vi.fn((paneIndex?: number) => ({ width: 800, height: 400 + (paneIndex ?? 0) })),
      swapPanes: vi.fn(),
      takeScreenshot: vi.fn(() => ({ __canvas: true }) as unknown),
      chartElement: vi.fn(() => ({ __chartEl: true }) as unknown),
      options: vi.fn(() => ({ layout: { fontSize: 12 } })),
      setCrosshairPosition: vi.fn(),
      clearCrosshairPosition: vi.fn(),
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

  return {
    reg,
    createChart,
    createSeriesMarkers: vi.fn(),
    createTextWatermark: vi.fn(),
    defs,
    MismatchDirection,
  };
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

import { createEngine } from "../chart-engine";
import { createLwcEngine, LWC_CAPABILITIES } from "../chart-engine/lwc";

const container = { __container: true } as unknown as HTMLElement;

beforeEach(() => {
  H.reg.reset();
  vi.clearAllMocks();
});

function rawSeries() {
  return H.reg.lastChart().addSeries.mock.results[0].value as {
    setData: ReturnType<typeof vi.fn>;
    data: ReturnType<typeof vi.fn>;
    dataByIndex: ReturnType<typeof vi.fn>;
    options: ReturnType<typeof vi.fn>;
    priceScale: ReturnType<typeof vi.fn>;
    createPriceLine: ReturnType<typeof vi.fn>;
    removePriceLine: ReturnType<typeof vi.fn>;
    __priceLines: { options: ReturnType<typeof vi.fn> }[];
  };
}

describe("chart-engine C02 — chart handle methods", () => {
  it("impl is 'lwc' for both factories and LWC_CAPABILITIES lists every series kind", () => {
    expect(createEngine(container).impl).toBe("lwc");
    expect(createLwcEngine(container).impl).toBe("lwc");
    expect(LWC_CAPABILITIES.seriesKinds).toHaveLength(6);
  });

  it("chartElement / options / crosshair / removeSeries delegate 1:1", () => {
    const e = createEngine(container);
    const s = e.addSeries("line");
    expect(e.chartElement()).toEqual({ __chartEl: true });
    expect(e.options()).toEqual({ layout: { fontSize: 12 } });
    e.setCrosshairPosition(12.5, 1_700_000_000, s);
    e.clearCrosshairPosition();
    const c = H.reg.lastChart();
    expect(c.chartElement).toHaveBeenCalledTimes(1);
    expect(c.options).toHaveBeenCalledTimes(1);
    expect(c.setCrosshairPosition).toHaveBeenCalledWith(12.5, 1_700_000_000, c.addSeries.mock.results[0].value);
    expect(c.clearCrosshairPosition).toHaveBeenCalledTimes(1);
    e.removeSeries(s);
    expect(c.removeSeries).toHaveBeenCalledTimes(1);
    e.removeSeries(s);
    expect(c.removeSeries).toHaveBeenCalledTimes(1);
  });
});

describe("chart-engine C02 — series data / options / price lines / priceScale", () => {
  it("data() snapshots rows and never returns the native series", () => {
    const e = createEngine(container);
    const s = e.addSeries("line");
    const rows = [{ time: "2020-01-01", value: 1 }, { time: "2020-01-02", value: 2 }];
    s.setData(rows);
    const got = s.data();
    expect(got).toEqual(rows);
    expect(got).not.toBe(rows);
    expect(s).not.toBe(rawSeries());
    expect(s.options()).toEqual({ color: "#abc" });
    expect(rawSeries().options).toHaveBeenCalled();
  });

  it("dataByIndex maps MismatchDirection strings onto LWC's numeric enum", () => {
    const e = createEngine(container);
    const s = e.addSeries("candles");
    s.setData([{ time: "2020-01-01", open: 1, high: 1, low: 1, close: 1 }]);
    s.dataByIndex(0, "nearest-right");
    s.dataByIndex(0, "nearest-left");
    s.dataByIndex(0, "none");
    s.dataByIndex(3);
    const raw = rawSeries();
    expect(raw.dataByIndex.mock.calls[0]).toEqual([0, H.MismatchDirection.NearestRight]);
    expect(raw.dataByIndex.mock.calls[1]).toEqual([0, H.MismatchDirection.NearestLeft]);
    expect(raw.dataByIndex.mock.calls[2]).toEqual([0, H.MismatchDirection.None]);
    expect(raw.dataByIndex.mock.calls[3]).toEqual([3, undefined]);
  });

  it("priceLines() returns the SAME handles createPriceLine returned; removePriceLine delegates", () => {
    const e = createEngine(container);
    const s = e.addSeries("line");
    const a = s.createPriceLine({ price: 10, color: "#111" });
    const b = s.createPriceLine({ price: 20 });
    const listed = s.priceLines();
    expect(listed).toHaveLength(2);
    expect(listed[0]).toBe(a);
    expect(listed[1]).toBe(b);
    expect(a.options()).toEqual({ price: 10, color: "#111" });
    s.removePriceLine(a);
    expect(rawSeries().removePriceLine).toHaveBeenCalledTimes(1);
    expect(s.priceLines()).toEqual([b]);
  });

  it("priceLines() OMITS native lines created outside the handle (raw unwrap path)", () => {
    // ChartPanel's options pin must pass the SeriesHandle — not the raw unwrap view — as
    // its pin host: a native line created behind the adapter's back is invisible to
    // priceLines(), so creating raw while counting through the handle would silently
    // orphan the pin (orphanPricePaneLines drifts without any error).
    const e = createEngine(container);
    const s = e.addSeries("line");
    const tracked = s.createPriceLine({ price: 10, color: "#111" });
    const rogue = {
      __opts: { price: 99 },
      applyOptions: vi.fn(),
      options: vi.fn(() => ({ price: 99 })),
    };
    rawSeries().__priceLines.push(rogue);
    expect(rawSeries().__priceLines).toHaveLength(2); // the native series sees both
    expect(s.priceLines()).toEqual([tracked]);        // the handle only vouches for its own
  });

  it("series.priceScale forwards options / range / autoScale without leaking the native scale", () => {
    const e = createEngine(container);
    const s = e.addSeries("candles");
    const ps = s.priceScale();
    expect(ps.options()).toEqual({ mode: 0, autoScale: true });
    expect(ps.getVisibleRange()).toEqual({ from: 10, to: 20 });
    ps.setVisibleRange({ from: 3, to: 9 });
    ps.setAutoScale(false);
    const results = rawSeries().priceScale.mock.results as { value: {
      setVisibleRange: ReturnType<typeof vi.fn>;
      setAutoScale: ReturnType<typeof vi.fn>;
    } }[];
    // Live resolve: each method hits series.priceScale() again (same as chart.priceScale).
    expect(results[results.length - 2].value.setVisibleRange).toHaveBeenCalledWith({ from: 3, to: 9 });
    expect(results[results.length - 1].value.setAutoScale).toHaveBeenCalledWith(false);
  });
});

describe("chart-engine C02 — pane getSeries identity + pane.priceScale", () => {
  it("pane.getSeries returns the identical SeriesHandle objects addSeries created, in pane order", () => {
    const e = createEngine(container);
    const a = e.addSeries("line", {}, 0);
    const b = e.addSeries("histogram", {}, 0);
    const c = e.addSeries("area", {}, 1);
    const p0 = e.panes()[0].getSeries();
    const p1 = e.panes()[1].getSeries();
    expect(p0).toEqual([a, b]);
    expect(p0[0]).toBe(a);
    expect(p0[1]).toBe(b);
    expect(p1).toEqual([c]);
    expect(p1[0]).toBe(c);
    expect(a.pane().getSeries()[0]).toBe(a);
  });

  it("pane.priceScale(id) delegates to IPaneApi.priceScale, not chart.priceScale", () => {
    const e = createEngine(container);
    const pane = e.panes()[0];
    const ps = pane.priceScale("right");
    expect(ps.options()).toEqual({ tickMarkDensity: 2 });
    const c = H.reg.lastChart();
    expect(c.__panes[0].priceScale).toHaveBeenCalledWith("right");
    expect(c.priceScale).not.toHaveBeenCalled();
  });
});

describe("chart-engine C02 — timeScale calendar/pixel surface", () => {
  it("get/setVisibleRange, logical↔coordinate, width, timeToIndex, options delegate 1:1", () => {
    const e = createEngine(container);
    const ts = e.timeScale();
    expect(ts.getVisibleRange()).toEqual({ from: 1_700_000_000, to: 1_700_086_400 });
    ts.setVisibleRange({ from: "2020-01-01", to: "2020-02-01" });
    expect(ts.logicalToCoordinate(5)).toBe(50);
    expect(ts.coordinateToLogical(50)).toBe(5);
    expect(ts.width()).toBe(800);
    expect(ts.timeToIndex("2020-01-01", false)).toBe(4);
    expect(ts.options()).toEqual({ borderColor: "#333" });
    const raw = H.reg.lastChart().__ts;
    expect(raw.setVisibleRange).toHaveBeenCalledWith({ from: "2020-01-01", to: "2020-02-01" });
    expect(raw.timeToIndex).toHaveBeenCalledWith("2020-01-01", false);
    expect(raw.logicalToCoordinate).toHaveBeenCalledWith(5);
    expect(raw.coordinateToLogical).toHaveBeenCalledWith(50);
  });
});

describe("chart-engine C02 — priceScale C02 methods on chart.priceScale", () => {
  it("options / getVisibleRange / setVisibleRange / setAutoScale forward", () => {
    const e = createEngine(container);
    const ps = e.priceScale("volume", 0);
    expect(ps.options()).toEqual({ autoScale: true });
    expect(ps.getVisibleRange()).toEqual({ from: 10, to: 20 });
    ps.setVisibleRange({ from: 0, to: 1 });
    ps.setAutoScale(true);
    const scales = H.reg.lastChart().__priceScales;
    // Live resolve per call — the C02 mutators land on the scale created for that call.
    expect(scales[scales.length - 2].setVisibleRange).toHaveBeenCalledWith({ from: 0, to: 1 });
    expect(scales[scales.length - 1].setAutoScale).toHaveBeenCalledWith(true);
  });
});

describe("chart-engine C02 — disposed semantics (C02-A02)", () => {
  it("after destroy, C02 mutators no-op, queries return null/[]/0/{}, nothing throws, inventory stays safe", () => {
    const e = createEngine(container);
    const s = e.addSeries("line");
    const pl = s.createPriceLine({ price: 1 });
    const ts = e.timeScale();
    const pane = e.panes()[0];
    const el = e.chartElement();
    s.setData([{ time: 1, value: 1 }]);
    e.destroy();

    expect(() => e.inventory()).not.toThrow();
    expect(e.inventory()).toEqual({
      alive: false, panes: 0, series: 0, seriesByPane: [], priceLines: 0, watermarks: 0,
    });
    expect(() => e.options()).not.toThrow();
    expect(e.options()).toEqual({});
    expect(e.chartElement()).toBe(el);
    expect(() => e.setCrosshairPosition(1, 2, s)).not.toThrow();
    expect(() => e.clearCrosshairPosition()).not.toThrow();
    expect(() => e.removeSeries(s)).not.toThrow();
    expect(H.reg.lastChart().setCrosshairPosition).not.toHaveBeenCalled();
    expect(H.reg.lastChart().clearCrosshairPosition).not.toHaveBeenCalled();

    expect(s.data()).toEqual([]);
    expect(s.dataByIndex(0, "nearest-right")).toBeNull();
    expect(s.options()).toEqual({});
    expect(s.priceLines()).toEqual([]);
    expect(() => s.removePriceLine(pl)).not.toThrow();
    expect(pl.options()).toEqual({});
    expect(ts.getVisibleRange()).toBeNull();
    expect(ts.logicalToCoordinate(1)).toBeNull();
    expect(ts.coordinateToLogical(1)).toBeNull();
    expect(ts.width()).toBe(0);
    expect(ts.timeToIndex(1)).toBeNull();
    expect(ts.options()).toEqual({});
    expect(() => ts.setVisibleRange({ from: 1, to: 2 })).not.toThrow();
    expect(pane.getSeries()).toEqual([]);
    expect(pane.priceScale("right").options()).toEqual({});
    expect(pane.priceScale("right").getVisibleRange()).toBeNull();
    expect(() => pane.priceScale("right").setAutoScale(true)).not.toThrow();
  });

  it("after series.remove(), C02 queries go quiet while P0 mutators still throw 'series removed'", () => {
    const e = createEngine(container);
    const s = e.addSeries("line");
    s.setData([{ time: 1, value: 1 }]);
    const pl = s.createPriceLine({ price: 5 });
    s.remove();
    expect(s.data()).toEqual([]);
    expect(s.dataByIndex(0)).toBeNull();
    expect(s.options()).toEqual({});
    expect(s.priceLines()).toEqual([]);
    expect(pl.options()).toEqual({});
    expect(() => s.removePriceLine(pl)).not.toThrow();
    expect(() => s.setData([])).toThrow(/series removed/);
  });

  it("destroy without ever calling chartElement still returns an HTMLElement and does not throw", () => {
    const e = createEngine(container);
    e.destroy();
    expect(() => e.chartElement()).not.toThrow();
    expect(e.chartElement()).toBe(container);
  });
});
