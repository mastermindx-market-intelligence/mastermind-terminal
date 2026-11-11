import { describe, it, expect, vi, beforeEach } from "vitest";

// M02 contract tests: compare / built-in indicator / volume series live on owned
// SeriesHandle objects. The LWC stand-in matches lwcAdapter.test.ts so inventory()
// is counted from pane membership, and update() actually advances data() (the house
// mock's update spy is a no-op; a live-bar law test cannot use a no-op).

const H = vi.hoisted(() => {
  type Spy = ReturnType<typeof vi.fn>;
  interface FakePriceLine { __opts: unknown; applyOptions: Spy; options: Spy }
  interface FakeSeries {
    __def: unknown; __opts: unknown; __paneIndex: number; __data: unknown[];
    __priceLines: FakePriceLine[];
    setData: Spy; update: Spy; applyOptions: Spy; options: Spy; data: Spy;
    dataByIndex: Spy; createPriceLine: Spy; removePriceLine: Spy;
    priceToCoordinate: Spy; coordinateToPrice: Spy; moveToPane: Spy;
    getPane: Spy; priceScale: Spy; attachPrimitive: Spy; detachPrimitive: Spy;
    priceLines: Spy;
  }
  interface FakePane {
    __index: number; __series: FakeSeries[];
    getSeries: Spy; paneIndex: Spy; getHeight: Spy; setHeight: Spy;
    getStretchFactor: Spy; setStretchFactor: Spy; getHTMLElement: Spy; priceScale: Spy;
  }
  interface FakePriceScale {
    __id: string; __paneIndex: number | undefined;
    width: Spy; applyOptions: Spy; options: Spy;
    getVisibleRange: Spy; setVisibleRange: Spy; setAutoScale: Spy;
  }
  interface FakeTimeScale {
    getVisibleLogicalRange: Spy; setVisibleLogicalRange: Spy;
    subscribeVisibleLogicalRangeChange: Spy; unsubscribeVisibleLogicalRangeChange: Spy;
    timeToCoordinate: Spy; coordinateToTime: Spy; scrollToRealTime: Spy;
    scrollToPosition: Spy; applyOptions: Spy; fitContent: Spy;
    getVisibleRange: Spy; setVisibleRange: Spy; logicalToCoordinate: Spy;
    coordinateToLogical: Spy; width: Spy; timeToIndex: Spy; options: Spy;
  }
  interface FakeChart {
    __opts: unknown; panes: Spy; timeScale: Spy; addSeries: Spy; removeSeries: Spy;
    applyOptions: Spy; subscribeCrosshairMove: Spy; unsubscribeCrosshairMove: Spy;
    subscribeClick: Spy; unsubscribeClick: Spy; subscribeDblClick: Spy;
    unsubscribeDblClick: Spy; resize: Spy; remove: Spy; priceScale: Spy;
    paneSize: Spy; swapPanes: Spy; takeScreenshot: Spy; chartElement: Spy;
    options: Spy; setCrosshairPosition: Spy; clearCrosshairPosition: Spy;
    __ts: FakeTimeScale; __panes: FakePane[]; __priceScales: FakePriceScale[];
  }
  const reg = {
    charts: [] as FakeChart[],
    lastChart(): FakeChart { return reg.charts[reg.charts.length - 1]; },
    reset(): void { reg.charts.length = 0; },
  };

  const makePane = (index: number): FakePane => {
    const pane: FakePane = {
      __index: index, __series: [],
      getSeries: vi.fn(() => pane.__series),
      paneIndex: vi.fn(() => index),
      getHeight: vi.fn(() => 100), setHeight: vi.fn(),
      getStretchFactor: vi.fn(() => 1), setStretchFactor: vi.fn(),
      getHTMLElement: vi.fn(() => ({ __paneEl: index }) as unknown),
      priceScale: vi.fn((id: string): FakePriceScale => ({
        __id: id, __paneIndex: index,
        width: vi.fn(() => 57), applyOptions: vi.fn(),
        options: vi.fn(() => ({ autoScale: true })),
        getVisibleRange: vi.fn(() => ({ from: 1, to: 2 })),
        setVisibleRange: vi.fn(), setAutoScale: vi.fn(),
      })),
    };
    return pane;
  };

  const makeSeries = (def: unknown, opts: unknown, paneIndex: number, chart: FakeChart): FakeSeries => {
    const s: FakeSeries = {
      __def: def, __opts: opts && typeof opts === "object" ? { ...(opts as object) } : {},
      __paneIndex: paneIndex, __priceLines: [], __data: [],
      priceLines: vi.fn(() => s.__priceLines),
      setData: vi.fn((rows: unknown[]) => { s.__data = Array.isArray(rows) ? rows.slice() : []; }),
      update: vi.fn((row: { time?: unknown }, historical?: boolean) => {
        const data = s.__data as { time?: unknown }[];
        if (historical && row && "time" in row) {
          const idx = data.findIndex((r) => r && r.time === row.time);
          if (idx !== -1) { data[idx] = row; return; }
        }
        if (!data.length) { data.push(row); return; }
        const last = data[data.length - 1];
        if (row && last && row.time === last.time) { data[data.length - 1] = row; return; }
        data.push(row);
      }),
      applyOptions: vi.fn((o: Record<string, unknown>) => {
        s.__opts = { ...(typeof s.__opts === "object" && s.__opts ? s.__opts as object : {}), ...o };
      }),
      options: vi.fn(() => s.__opts ?? {}),
      data: vi.fn(() => s.__data),
      dataByIndex: vi.fn((i: number) => (s.__data[i] ?? null) as unknown),
      priceScale: vi.fn((): FakePriceScale => ({
        __id: "right", __paneIndex: s.__paneIndex,
        width: vi.fn(() => 57), applyOptions: vi.fn(),
        options: vi.fn(() => ({ mode: 0, autoScale: true })),
        getVisibleRange: vi.fn(() => ({ from: 10, to: 20 })),
        setVisibleRange: vi.fn(), setAutoScale: vi.fn(),
      })),
      priceToCoordinate: vi.fn((p: number) => p * 2),
      coordinateToPrice: vi.fn((y: number) => y / 2),
      moveToPane: vi.fn(),
      getPane: vi.fn(() => chart.__panes[Math.min(s.__paneIndex, chart.__panes.length - 1)]),
      attachPrimitive: vi.fn(), detachPrimitive: vi.fn(),
      createPriceLine: vi.fn((o: unknown) => {
        const pl: FakePriceLine = {
          __opts: o, applyOptions: vi.fn(),
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
    getVisibleLogicalRange: vi.fn(() => ({ from: 0, to: 10 })),
    setVisibleLogicalRange: vi.fn(),
    subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn(),
    timeToCoordinate: vi.fn(() => 42), coordinateToTime: vi.fn(() => 1),
    scrollToRealTime: vi.fn(), scrollToPosition: vi.fn(), applyOptions: vi.fn(),
    fitContent: vi.fn(),
    getVisibleRange: vi.fn(() => ({ from: 1, to: 2 })),
    setVisibleRange: vi.fn(), logicalToCoordinate: vi.fn((i: number) => i * 10),
    coordinateToLogical: vi.fn((x: number) => x / 10), width: vi.fn(() => 800),
    timeToIndex: vi.fn(() => 0), options: vi.fn(() => ({})),
  });

  const createChart = vi.fn((_c: unknown, opts: unknown): FakeChart => {
    const ts = makeTimeScale();
    const chart: FakeChart = {
      __opts: opts, __ts: ts, __panes: [makePane(0)], __priceScales: [],
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
      applyOptions: vi.fn(), subscribeCrosshairMove: vi.fn(), unsubscribeCrosshairMove: vi.fn(),
      subscribeClick: vi.fn(), unsubscribeClick: vi.fn(),
      subscribeDblClick: vi.fn(), unsubscribeDblClick: vi.fn(),
      resize: vi.fn(), remove: vi.fn(),
      priceScale: vi.fn((id: string, paneIndex?: number): FakePriceScale => {
        const ps: FakePriceScale = {
          __id: id, __paneIndex: paneIndex,
          width: vi.fn(() => 57), applyOptions: vi.fn(),
          options: vi.fn(() => ({ autoScale: true })),
          getVisibleRange: vi.fn(() => ({ from: 10, to: 20 })),
          setVisibleRange: vi.fn(), setAutoScale: vi.fn(),
        };
        chart.__priceScales.push(ps);
        return ps;
      }),
      paneSize: vi.fn(() => ({ width: 800, height: 400 })),
      swapPanes: vi.fn(),
      takeScreenshot: vi.fn(() => ({ __canvas: true }) as unknown),
      chartElement: vi.fn(() => ({ __chartEl: true }) as unknown),
      options: vi.fn(() => ({})),
      setCrosshairPosition: vi.fn(), clearCrosshairPosition: vi.fn(),
    };
    reg.charts.push(chart);
    return chart;
  });

  return {
    reg, createChart,
    createSeriesMarkers: vi.fn(() => ({ setMarkers: vi.fn(), detach: vi.fn() })),
    createTextWatermark: vi.fn(() => ({ detach: vi.fn() })),
    defs: {
      CandlestickSeries: { seriesType: "Candlestick" },
      BarSeries: { seriesType: "Bar" },
      LineSeries: { seriesType: "Line" },
      AreaSeries: { seriesType: "Area" },
      HistogramSeries: { seriesType: "Histogram" },
      BaselineSeries: { seriesType: "Baseline" },
    },
    MismatchDirection: { NearestLeft: -1, None: 0, NearestRight: 1 } as const,
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
import type { EnginePoint, SeriesHandle } from "../chart-engine/api";
import { keepIndicatorPaneAxisLabelsOnlyHandles } from "../indicatorPaneSeries";
import {
  reuseSeriesHandle,
  seriesReuseEngine,
  updateLiveStudyRow,
} from "../liveBarProjection";

const container = {} as unknown as HTMLElement;

beforeEach(() => {
  H.reg.reset();
  vi.clearAllMocks();
});

function isWhitespace(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const r = row as { time?: unknown; value?: unknown; open?: unknown };
  return "time" in r && r.value === undefined && r.open === undefined;
}

describe("M02-A01 — 100 quote updates through handle.update", () => {
  it("advance data() without changing pane count or series options", () => {
    const e = createEngine(container);
    e.addSeries("candles", { priceScaleId: "right" });
    const ema = e.addSeries("line", { color: "#4d82ff", lineWidth: 2, priceLineVisible: false }, 0);
    ema.setData([{ time: 1_700_000_000, value: 100 }]);
    const optsBefore = JSON.stringify(ema.options());
    const invBefore = e.inventory();

    for (let i = 1; i <= 100; i++) {
      ema.update({ time: 1_700_000_000, value: 100 + i });
    }

    const rows = ema.data();
    expect(rows).toHaveLength(1);
    expect((rows[0] as EnginePoint).value).toBe(200);
    expect((rows[0] as EnginePoint).time).toBe(1_700_000_000);
    const invAfter = e.inventory();
    expect(invAfter.panes).toBe(invBefore.panes);
    expect(invAfter.series).toBe(invBefore.series);
    expect(invAfter.seriesByPane).toEqual(invBefore.seriesByPane);
    expect(JSON.stringify(ema.options())).toBe(optsBefore);
    expect(H.reg.lastChart().__panes[0].__series[1].update).toHaveBeenCalledTimes(100);
  });
});

describe("M02-A02 — add/remove compare ×20 returns inventory() to baseline", () => {
  it("compare overlay churn does not leak series or panes", () => {
    const e = createEngine(container);
    e.addSeries("candles");
    const baseline = e.inventory();
    expect(baseline.series).toBe(1);
    expect(baseline.panes).toBe(1);

    for (let i = 0; i < 20; i++) {
      const cmp = e.addSeries("line", {
        color: "#e8b339", title: "AAPL", priceScaleId: `cmp:AAPL:${i}`,
      }, 0);
      cmp.setData([{ time: 1_700_000_000, value: 190 + i }]);
      expect(e.inventory().series).toBe(baseline.series + 1);
      expect(e.inventory().panes).toBe(baseline.panes);
      cmp.remove();
      expect(e.inventory()).toEqual(baseline);
    }
    expect(e.inventory()).toEqual(baseline);
  });
});

describe("M02-A03 — whitespace rows stay whitespace", () => {
  it("setData / update / dataByIndex never zero a gap and never interpolate", () => {
    const e = createEngine(container);
    const rsi = e.addSeries("line", { title: "RSI" }, 1);
    const rows = [
      { time: 1, value: 55 },
      { time: 2 },
      { time: 3, value: 60 },
    ];
    rsi.setData(rows);

    const mid = rsi.dataByIndex(1);
    expect(isWhitespace(mid)).toBe(true);
    expect(mid).toEqual({ time: 2 });
    expect((mid as { value?: unknown }).value).toBeUndefined();
    expect(rsi.data().map((r) => ("value" in r ? (r as EnginePoint).value : null))).toEqual([55, null, 60]);
    expect(rsi.data().some((r) => (r as { value?: unknown }).value === 0)).toBe(false);

    rsi.update({ time: 2 }, true);
    const still = rsi.dataByIndex(1);
    expect(isWhitespace(still)).toBe(true);
    expect((still as { value?: unknown }).value).toBeUndefined();
    expect((still as { value?: unknown }).value).not.toBe(0);
    const snapped = rsi.data();
    expect(snapped).toHaveLength(3);
    expect((snapped[0] as EnginePoint).value).toBe(55);
    expect((snapped[2] as EnginePoint).value).toBe(60);
  });
});

describe("M02-A04 — applyOptions on parameter change touches only the designated handle", () => {
  it("spy counts stay isolated across sibling study series", () => {
    const e = createEngine(container);
    const ema = e.addSeries("line", { color: "#4d82ff", lineWidth: 1 }, 0);
    const vol = e.addSeries("histogram", { priceScaleId: "volume" }, 0);
    const osc = e.addSeries("line", { color: "#e8b339", lineWidth: 1 }, 1);
    const rawEma = ema.unwrap<{ applyOptions: ReturnType<typeof vi.fn> }>();
    const rawVol = vol.unwrap<{ applyOptions: ReturnType<typeof vi.fn> }>();
    const rawOsc = osc.unwrap<{ applyOptions: ReturnType<typeof vi.fn> }>();

    ema.applyOptions({ lineWidth: 3, color: "#112233" });
    expect(rawEma.applyOptions).toHaveBeenCalledTimes(1);
    expect(rawEma.applyOptions).toHaveBeenCalledWith({ lineWidth: 3, color: "#112233" });
    expect(rawVol.applyOptions).not.toHaveBeenCalled();
    expect(rawOsc.applyOptions).not.toHaveBeenCalled();

    osc.applyOptions({ visible: false });
    expect(rawOsc.applyOptions).toHaveBeenCalledTimes(1);
    expect(rawEma.applyOptions).toHaveBeenCalledTimes(1);
    expect(rawVol.applyOptions).not.toHaveBeenCalled();
  });
});

describe("M02 helpers — engine-handle entry points", () => {
  it("keepIndicatorPaneAxisLabelsOnlyHandles hides the native last-value line", () => {
    const e = createEngine(container);
    const a = e.addSeries("line", { lastValueVisible: true }, 1);
    const b = e.addSeries("line", { lastValueVisible: true }, 1);
    const out = keepIndicatorPaneAxisLabelsOnlyHandles([a, b]);
    expect(out).toEqual([a, b]);
    expect(a.unwrap<{ applyOptions: ReturnType<typeof vi.fn> }>().applyOptions)
      .toHaveBeenCalledWith({ priceLineVisible: false });
    expect(b.unwrap<{ applyOptions: ReturnType<typeof vi.fn> }>().applyOptions)
      .toHaveBeenCalledWith({ priceLineVisible: false });
  });

  it("reuseSeriesHandle swallows applyOptions and createPriceLine", () => {
    const e = createEngine(container);
    const s = e.addSeries("line");
    const wrapped = reuseSeriesHandle(s);
    wrapped.applyOptions({ priceLineVisible: true, color: "#fff" });
    wrapped.createPriceLine({ price: 50, color: "#aaa" });
    const raw = s.unwrap<{ applyOptions: ReturnType<typeof vi.fn>; createPriceLine: ReturnType<typeof vi.fn> }>();
    expect(raw.applyOptions).not.toHaveBeenCalled();
    expect(raw.createPriceLine).not.toHaveBeenCalled();
    wrapped.setData([{ time: 1, value: 9 }]);
    expect(s.data()).toEqual([{ time: 1, value: 9 }]);
  });

  it("seriesReuseEngine hands back owned handles and refuses to leak", () => {
    const e = createEngine(container);
    const owned: SeriesHandle[] = [e.addSeries("line"), e.addSeries("line")];
    const addCalls = H.reg.lastChart().addSeries.mock.calls.length;
    const facade = seriesReuseEngine(e, owned, "ichimoku");
    facade.addSeries("line", { color: "#1" }, 0).setData([{ time: 1, value: 1 }]);
    facade.addSeries("line", { color: "#2" }, 0).setData([{ time: 1, value: 2 }]);
    expect(H.reg.lastChart().addSeries.mock.calls.length).toBe(addCalls);
    expect(owned[0].data()).toEqual([{ time: 1, value: 1 }]);
    expect(owned[1].data()).toEqual([{ time: 1, value: 2 }]);
    expect(() => facade.addSeries("line")).toThrow(/more series than it owns/);
  });

  it("updateLiveStudyRow is a last-bar in-place update on the stable handle", () => {
    const e = createEngine(container);
    const s = e.addSeries("histogram", { priceScaleId: "volume" });
    s.setData([{ time: 10, value: 1_000, color: "#0a0" }]);
    updateLiveStudyRow(s, { time: 10, value: 1_250, color: "#a00" });
    expect(s.data()).toEqual([{ time: 10, value: 1_250, color: "#a00" }]);
    expect(e.inventory().series).toBe(1);
  });
});
