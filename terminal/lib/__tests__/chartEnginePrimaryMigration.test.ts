// M01 contract tests — primary chart ownership + price-series handles.
//
// ChartPanel's M01 patch (docs/chart-engine/migration/M01_PRIMARY.patch) rewires
// create/destroy, the primary price series, time/price scales, and crosshair
// subscriptions onto ChartEngine / SeriesHandle. These tests pin the adapter
// invariants that patch relies on, against the house vi.mock("lightweight-charts")
// stand-in (see lwcAdapter.test.ts). They must stay green at BASE_SHA WITHOUT
// the patch applied.
//
// Ceilings in the ratchet test are the BASE_SHA grep counts. Integrator: lower
// them when M01/M02/M03 land.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

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
    __priceLines: FakePriceLine[];
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
    priceLines: Spy;
  }
  interface FakePriceScale {
    __id: string;
    __paneIndex: number | undefined;
    __opts: Record<string, unknown>;
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
    __scaleState: Map<string, Record<string, unknown>>;
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
      priceScale: vi.fn((id: string): FakePriceScale => makePriceScale(id, index)),
    };
    return pane;
  };

  const makePriceScale = (id: string, paneIndex: number | undefined, seed?: Record<string, unknown>): FakePriceScale => {
    const opts: Record<string, unknown> = { autoScale: true, mode: 0, ...(seed ?? {}) };
    const ps: FakePriceScale = {
      __id: id,
      __paneIndex: paneIndex,
      __opts: opts,
      width: vi.fn(() => 57),
      applyOptions: vi.fn((o: Record<string, unknown>) => {
        Object.assign(opts, o);
      }),
      options: vi.fn(() => ({ ...opts })),
      getVisibleRange: vi.fn(() => ({ from: 10, to: 20 })),
      setVisibleRange: vi.fn(),
      setAutoScale: vi.fn(),
    };
    return ps;
  };

  const makeSeries = (def: unknown, opts: unknown, paneIndex: number, chart: FakeChart): FakeSeries => {
    const s: FakeSeries = {
      __def: def,
      __opts: opts,
      __paneIndex: paneIndex,
      __priceLines: [],
      __data: [],
      priceLines: vi.fn(() => s.__priceLines),
      setData: vi.fn((rows: unknown[]) => {
        s.__data = rows;
      }),
      update: vi.fn(),
      applyOptions: vi.fn(),
      options: vi.fn(() => s.__opts ?? {}),
      data: vi.fn(() => s.__data),
      dataByIndex: vi.fn((i: number) => (s.__data[i] ?? null) as unknown),
      priceScale: vi.fn((): FakePriceScale => makePriceScale("right", s.__paneIndex)),
      priceToCoordinate: vi.fn((p: number) => p * 2),
      coordinateToPrice: vi.fn((y: number) => y / 2),
      moveToPane: vi.fn(),
      getPane: vi.fn(() => chart.__panes[Math.min(s.__paneIndex, chart.__panes.length - 1)]),
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
    options: vi.fn(() => ({ borderColor: "#333", rightOffset: 12 })),
  });

  const createChart = vi.fn((_container: unknown, opts: unknown): FakeChart => {
    const ts = makeTimeScale();
    const scaleState = new Map<string, Record<string, unknown>>();
    const chart: FakeChart = {
      __opts: opts,
      __ts: ts,
      __panes: [makePane(0)],
      __scaleState: scaleState,
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
      remove: vi.fn(),
      __priceScales: [],
      priceScale: vi.fn((id: string, paneIndex?: number): FakePriceScale => {
        const key = `${id}:${paneIndex ?? ""}`;
        const seed = scaleState.get(key) ?? { autoScale: true, mode: 0 };
        const ps = makePriceScale(id, paneIndex, seed);
        ps.applyOptions = vi.fn((o: Record<string, unknown>) => {
          Object.assign(ps.__opts, o);
          scaleState.set(key, { ...ps.__opts });
        });
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

import { createEngine } from "../chart-engine";

const container = {} as unknown as HTMLElement;

beforeEach(() => {
  H.reg.reset();
  vi.clearAllMocks();
});

const DEAD = {
  alive: false,
  panes: 0,
  series: 0,
  seriesByPane: [] as number[],
  priceLines: 0,
  watermarks: 0,
};

function liveChartCount(): number {
  return H.reg.charts.filter((c) => c.remove.mock.calls.length === 0).length;
}

describe("M01-A01 StrictMode-style create / destroy / create", () => {
  it("effect replay leaves exactly one live engine; final destroy inventories dead zeros", () => {
    const first = createEngine(container, { width: 800, height: 600 });
    first.addSeries("candles", { upColor: "#0a0" }, 0);
    expect(H.createChart).toHaveBeenCalledTimes(1);
    expect(first.inventory().alive).toBe(true);
    expect(liveChartCount()).toBe(1);

    first.destroy();
    expect(first.inventory()).toEqual(DEAD);
    expect(liveChartCount()).toBe(0);

    const second = createEngine(container, { width: 800, height: 600 });
    second.addSeries("candles", { upColor: "#0a0" }, 0);
    expect(H.createChart).toHaveBeenCalledTimes(2);
    expect(first.inventory().alive).toBe(false);
    expect(second.inventory().alive).toBe(true);
    expect(liveChartCount()).toBe(1);
    expect(H.reg.charts[0].remove).toHaveBeenCalledTimes(1);
    expect(H.reg.charts[1].remove).not.toHaveBeenCalled();

    second.destroy();
    expect(second.inventory()).toEqual(DEAD);
    expect(liveChartCount()).toBe(0);
    second.destroy();
    expect(H.reg.charts[1].remove).toHaveBeenCalledTimes(1);
  });
});

describe("M01-A02 setData([]) withdraws stale primary-series state", () => {
  it("emptying the primary series drops data, price lines and markers", () => {
    const engine = createEngine(container);
    const primary = engine.addSeries("candles", { upColor: "#0a0" }, 0);
    const bars = [
      { time: "2020-01-01", open: 10, high: 11, low: 9, close: 10.5 },
      { time: "2020-01-02", open: 10.5, high: 12, low: 10, close: 11 },
    ];
    primary.setData(bars);
    const line = primary.createPriceLine({ price: 10.5, title: "ext" });
    primary.setMarkers([
      { time: "2020-01-02", position: "aboveBar", shape: "circle", color: "#fff" },
    ]);
    expect(primary.data()).toHaveLength(2);
    expect(engine.inventory().priceLines).toBe(1);
    expect(H.reg.markers).toHaveLength(1);

    // ChartPanel clearChartData order: detach decorations, then empty the series
    // so a dead-end symbol cannot keep the previous ticker's plot.
    primary.setMarkers([]);
    primary.removePriceLine(line);
    primary.setData([]);

    expect(primary.data()).toEqual([]);
    expect(primary.dataByIndex(0)).toBeNull();
    expect(primary.dataByIndex(0, "none")).toBeNull();
    expect(primary.priceLines()).toEqual([]);
    expect(engine.inventory().priceLines).toBe(0);
    expect(H.reg.markers[0].setMarkers).toHaveBeenCalledWith([]);
  });
});

describe("M01-A03 replace primary series family without orphans", () => {
  it("candles → line → candles keeps pane count, price-scale options, and baseline inventory", () => {
    const engine = createEngine(container);
    const scaleOpts = { mode: 1, invertScale: true, autoScale: false };
    engine.priceScale("right").applyOptions(scaleOpts);
    const baseline = engine.inventory();
    expect(baseline.panes).toBe(1);
    expect(baseline.series).toBe(0);

    const candles = engine.addSeries("candles", { upColor: "#0a0", priceScaleId: "right" }, 0);
    expect(engine.inventory().series).toBe(1);
    engine.removeSeries(candles);

    const line = engine.addSeries("line", { color: "#09f", priceScaleId: "right" }, 0);
    expect(engine.inventory().series).toBe(1);
    expect(engine.inventory().panes).toBe(baseline.panes);
    engine.removeSeries(line);

    const candles2 = engine.addSeries("candles", { upColor: "#0a0", priceScaleId: "right" }, 0);
    expect(engine.inventory()).toMatchObject({
      alive: true,
      panes: baseline.panes,
      series: 1,
      priceLines: 0,
    });
    expect(candles2.kind).toBe("candles");

    const readBack = engine.priceScale("right").options();
    expect(readBack.mode).toBe(1);
    expect(readBack.invertScale).toBe(true);
    expect(readBack.autoScale).toBe(false);

    candles2.remove();
    expect(engine.inventory()).toMatchObject({
      alive: true,
      panes: baseline.panes,
      series: 0,
      priceLines: 0,
    });
  });
});

describe("M01 ratchet — ChartPanel raw-LWC site ceilings (BASE_SHA)", () => {
  // Integrator: lower these ceilings when M01/M02/M03 land.
  const CEILINGS = {
    "unwrap<": 1,
    // 48, not the census 46: master #929 (b4095c3d) net-added two chartRef.current sites to
    // ChartPanel after the M01 census commit; measured at origin/master e0ffafc1f.
    "chartRef.current": 48,
    IChartApi: 28,
    "ISeriesApi<": 56,
    "createSeriesMarkers(": 4,
    "createTextWatermark(": 1,
  } as const;

  it("raw-LWC site counts stay at or below the BASE_SHA ceilings", () => {
    const src = readFileSync(path.resolve(__dirname, "../../components/ChartPanel.tsx"), "utf8");
    for (const [needle, ceiling] of Object.entries(CEILINGS)) {
      let count = 0;
      let from = 0;
      while (from < src.length) {
        const at = src.indexOf(needle, from);
        if (at === -1) break;
        count += 1;
        from = at + needle.length;
      }
      expect(count, `${needle} exceeded ceiling ${ceiling}`).toBeLessThanOrEqual(ceiling);
    }
  });
});
