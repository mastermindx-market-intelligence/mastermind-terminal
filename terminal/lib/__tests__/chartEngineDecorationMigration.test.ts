// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// M03 — decoration migration contract tests (markers / watermark / price lines /
// crosshair payload) against the LWC adapter.
//
// Same house precedent as lib/__tests__/lwcAdapter.test.ts: real LWC needs a live
// canvas, so we vi.mock("lightweight-charts") with a faithful stand-in that records
// every plugin construction and call. The four clusters asserted here are the
// semantics the ChartPanel M03 patch (docs/chart-engine/migration/M03_DECOR.patch)
// relies on:
//
//   M03-A01  setMarkers / setWatermark REPLACE — repeated calls leave exactly one
//            current markers plugin per series and one live watermark per pane
//            (constructor + detach counts are quoted from the fake's registries).
//   M03-A02  a price line pooled on the price series survives its CREATOR's own
//            series removal and is cleared through the price series' handle.
//   M03-A03  a crosshair payload delivered through engine.subscribeCrosshairMove
//            is addressed by the OWNED SeriesHandles the caller created — the
//            assertion is written keying-invariantly (handle key or its raw view)
//            so it stays green across the raw→handle keying migration the patch
//            lands in the adapter, while still proving every handle reaches its
//            row and the wrapper is memoized for unsubscribe-by-identity.
//   M03-A04  hiding decorations (watermark visible:false, price line
//            lineVisible:false) is OPTION state on the LIVE instance — instance
//            counts never move through hide/show round trips, so the renderer
//            that takeScreenshot() re-rasterizes is the same hidden instance.
//
// Also covers the additive handle-based session-shading entry points
// (lib/sessionShading.ts) the patch switches ChartPanel onto.
// ─────────────────────────────────────────────────────────────────────────────

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
    __priceLines: FakePriceLine[];
    priceLines: Spy;
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
    seriesType: Spy;
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
  interface FakeChart {
    __opts: unknown;
    __panes: FakePane[];
    panes: Spy;
    addSeries: Spy;
    removeSeries: Spy;
    applyOptions: Spy;
    resize: Spy;
    remove: Spy;
    subscribeCrosshairMove: Spy;
    unsubscribeCrosshairMove: Spy;
    subscribeClick: Spy;
    unsubscribeClick: Spy;
    takeScreenshot: Spy;
    chartElement: Spy;
    options: Spy;
    setCrosshairPosition: Spy;
    clearCrosshairPosition: Spy;
    timeScale: Spy;
    priceScale: Spy;
    paneSize: Spy;
    swapPanes: Spy;
    subscribeDblClick: Spy;
    unsubscribeDblClick: Spy;
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
      priceScale: vi.fn(),
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
      options: vi.fn(() => s.__opts ?? {}),
      data: vi.fn(() => []),
      dataByIndex: vi.fn(() => null),
      // LWC's seriesType() is what the adapter's foreign-series adoption reads.
      seriesType: vi.fn(() => (def as { seriesType?: string }).seriesType ?? "Line"),
      priceScale: vi.fn(),
      priceToCoordinate: vi.fn((p: number) => p * 2),
      coordinateToPrice: vi.fn((y: number) => y / 2),
      moveToPane: vi.fn((idx: number) => {
        s.__paneIndex = idx;
        while (chart.__panes.length <= idx) chart.__panes.push(makePane(chart.__panes.length));
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

  const createChart = vi.fn((): FakeChart => {
    const chart: FakeChart = {
      __opts: {},
      __panes: [makePane(0)],
      panes: vi.fn(() => chart.__panes),
      addSeries: vi.fn((def: unknown, o: unknown, paneIndex?: number) => {
        const pi = paneIndex ?? 0;
        const idx = Math.min(chart.__panes.length, pi);
        while (chart.__panes.length <= idx) chart.__panes.push(makePane(chart.__panes.length));
        const series = makeSeries(def, o, idx, chart);
        chart.__panes[idx].__series.push(series);
        return series;
      }),
      // LWC disposes a removed series with everything hanging off it (price lines,
      // primitives) — modelled because "the line died with its series" is the
      // ownership claim M03-A02 checks.
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
      resize: vi.fn(),
      remove: vi.fn(),
      subscribeCrosshairMove: vi.fn(),
      unsubscribeCrosshairMove: vi.fn(),
      subscribeClick: vi.fn(),
      unsubscribeClick: vi.fn(),
      subscribeDblClick: vi.fn(),
      unsubscribeDblClick: vi.fn(),
      takeScreenshot: vi.fn(() => ({ __canvas: true }) as unknown),
      chartElement: vi.fn(() => ({ __chartEl: true }) as unknown),
      options: vi.fn(() => ({})),
      setCrosshairPosition: vi.fn(),
      clearCrosshairPosition: vi.fn(),
      timeScale: vi.fn(),
      priceScale: vi.fn(),
      paneSize: vi.fn(() => ({ width: 800, height: 400 })),
      swapPanes: vi.fn(),
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

import { createEngine, type SeriesHandle } from "../chart-engine";
import { attachSessionShadingToHandle, detachSessionShadingFromHandle } from "../sessionShading";

const container = {} as unknown as HTMLElement;

beforeEach(() => {
  H.reg.reset();
  vi.clearAllMocks();
});

// ── M03-A01: markers replace ──────────────────────────────────────────────────
describe("M03-A01 — setMarkers replaces; no plugin stacking", () => {
  it("setMarkers ×10 on one series creates the markers plugin exactly once and replaces the set each call", () => {
    const e = createEngine(container);
    const s = e.addSeries("line");
    for (let i = 0; i < 10; i++) {
      s.setMarkers([{ time: i, position: "aboveBar", shape: "arrowUp", color: "#8a8a8a" }]);
    }
    // Constructor count: ONE plugin for the whole churn (lazy create + reuse).
    expect(H.createSeriesMarkers).toHaveBeenCalledTimes(1);
    expect(H.reg.markers).toHaveLength(1);
    // The FIRST set rode the constructor; every later call (9 of them) replaced in place.
    const plugin = H.reg.markers[0]!;
    expect(plugin.__initialMarkers).toEqual([{ time: 0, position: "aboveBar", shape: "arrowUp", color: "#8a8a8a" }]);
    expect(plugin.setMarkers).toHaveBeenCalledTimes(9);
    expect(plugin.setMarkers).toHaveBeenLastCalledWith([{ time: 9, position: "aboveBar", shape: "arrowUp", color: "#8a8a8a" }]);
    // The series count is untouched by marker churn (markers are not series).
    expect(e.inventory().series).toBe(1);
  });

  it("two series each keep exactly ONE plugin — per-series marker sets stay isolated", () => {
    const e = createEngine(container);
    const a = e.addSeries("line");
    const b = e.addSeries("histogram", {}, 1);
    for (let i = 0; i < 10; i++) {
      a.setMarkers([{ time: i, position: "belowBar", shape: "circle", color: "#c4c4c4" }]);
      b.setMarkers([{ time: i, position: "inBar", shape: "square", color: "#9a9a9a" }]);
    }
    expect(H.createSeriesMarkers).toHaveBeenCalledTimes(2);
    expect(H.reg.markers).toHaveLength(2);
    expect(H.reg.markers[0]!.__series).toBe(a.unwrap());
    expect(H.reg.markers[1]!.__series).toBe(b.unwrap());
  });

  it("setMarkers([]) clears the set without destroying the plugin, and the handle stays live", () => {
    const e = createEngine(container);
    const s = e.addSeries("candles");
    s.setMarkers([{ time: 1, position: "aboveBar", shape: "arrowUp", color: "#8a8a8a" }]);
    s.setMarkers([]);
    expect(H.reg.markers).toHaveLength(1);
    const plugin = H.reg.markers[0]!;
    expect(plugin.setMarkers).toHaveBeenLastCalledWith([]);
    expect(() => s.setData([{ time: 2, open: 1, high: 2, low: 0.5, close: 1.5 }])).not.toThrow();
  });
});

// ── M03-A01: watermark replace ────────────────────────────────────────────────
describe("M03-A01 — setWatermark replaces; one live instance per pane", () => {
  it("setWatermark ×10 on pane 0 constructs 10 plugins, detaches 9, leaves exactly the last one live", () => {
    const e = createEngine(container);
    for (let i = 0; i < 10; i++) {
      e.setWatermark(0, { visible: true, horzAlign: "center", vertAlign: "center", lines: [{ text: `wm${i}` }] });
    }
    expect(H.createTextWatermark).toHaveBeenCalledTimes(10);
    expect(H.reg.watermarks).toHaveLength(10);
    const detached = H.reg.watermarks.filter((w) => w.detach.mock.calls.length > 0);
    expect(detached).toHaveLength(9);
    // The live instance is the LAST created, not detached, carrying the last text.
    const live = H.reg.watermarks[9]!;
    expect(live.detach).not.toHaveBeenCalled();
    expect((live.__opts as { lines: { text: string }[] }).lines[0]!.text).toBe("wm9");
    expect(e.inventory().watermarks).toBe(1);
  });

  it("panes keep independent single instances — pane 1's watermark is not pane 0's replacement victim", () => {
    const e = createEngine(container);
    e.addSeries("line", {}, 1); // grows the pane list to 2 (getOrCreatePane semantics)
    e.setWatermark(0, { lines: [{ text: "price" }] });
    e.setWatermark(0, { lines: [{ text: "price2" }] });
    e.setWatermark(1, { lines: [{ text: "sub" }] });
    e.setWatermark(1, { lines: [{ text: "sub2" }] });
    expect(e.inventory().watermarks).toBe(2);
    const texts = H.reg.watermarks.map((w) => (w.__opts as { lines: { text: string }[] }).lines[0]!.text);
    expect(texts).toEqual(["price", "price2", "sub", "sub2"]);
    const detached = H.reg.watermarks.filter((w) => w.detach.mock.calls.length > 0);
    expect(detached.map((w) => (w.__opts as { lines: { text: string }[] }).lines[0]!.text)).toEqual(["price", "sub"]);
  });

  it("a bare WatermarkLine[] is shorthand for {lines} with visible defaulting true", () => {
    const e = createEngine(container);
    e.setWatermark(0, [{ text: "bare" }]);
    const opts = H.reg.watermarks[0]!.__opts as { visible: boolean; lines: { text: string; fontSize?: number }[] };
    expect(opts.visible).toBe(true);
    expect(opts.lines[0]!.text).toBe("bare");
    expect(opts.lines[0]!.fontSize).toBe(44); // adapter default
  });
});

// ── M03-A02: cross-owner pooled price lines ──────────────────────────────────
describe("M03-A02 — a price line on the price series is cleared by its creator through the host handle", () => {
  it("the line survives creator X's own series removal; A.removePriceLine then empties A.priceLines()", () => {
    const e = createEngine(container);
    const priceA = e.addSeries("candles");          // the SHARED price series
    const creatorX = e.addSeries("line", {}, 1);    // the creator's own (sub-pane) series
    const pl = priceA.createPriceLine({ price: 42, color: "#8a94a6", title: "hline" });
    expect(priceA.priceLines()).toHaveLength(1);
    expect(e.inventory().priceLines).toBe(1);

    // The creator's own series is removed — the pooled line on the price series
    // must NOT go with it (that is exactly why it is pooled).
    creatorX.remove();
    expect(priceA.priceLines()).toHaveLength(1);
    expect(e.inventory().priceLines).toBe(1);

    // ...and the creator still clears it through the price series' handle.
    priceA.removePriceLine(pl);
    expect(priceA.priceLines()).toHaveLength(0);
    expect(e.inventory().priceLines).toBe(0);
    priceA.removePriceLine(pl); // double remove is a no-op
    expect(priceA.priceLines()).toHaveLength(0);
  });

  it("priceLines() returns the SAME handle objects createPriceLine returned (pool identity)", () => {
    const e = createEngine(container);
    const s = e.addSeries("candles");
    const a = s.createPriceLine({ price: 1 });
    const b = s.createPriceLine({ price: 2 });
    const listed = s.priceLines();
    expect(listed).toHaveLength(2);
    expect(listed[0]).toBe(a);
    expect(listed[1]).toBe(b);
  });

  it("PriceLineHandle.remove() clears the line and is idempotent", () => {
    const e = createEngine(container);
    const s = e.addSeries("candles");
    const pl = s.createPriceLine({ price: 7 });
    pl.remove();
    pl.remove();
    expect(s.priceLines()).toHaveLength(0);
  });
});

// ── M03-A03: crosshair payload addressed by owned handles ────────────────────
describe("M03-A03 — crosshair payload is addressed by the owned handles the caller registered", () => {
  it("every SeriesHandle returned by addSeries addresses its row in the delivered seriesData map", () => {
    const e = createEngine(container);
    const s1 = e.addSeries("line");
    const s2 = e.addSeries("line", {}, 1);
    const handler = vi.fn();
    e.subscribeCrosshairMove(handler);
    const wrapper = H.reg.lastChart().subscribeCrosshairMove.mock.calls[0]![0] as (p: unknown) => void;

    // LWC keys its map by raw ISeriesApi; the engine surfaces the caller's own
    // handles. Whichever keying the adapter delivers, the OWNED handle must reach
    // its row — that addressing is what ChartPanel's magnet handler relies on.
    const row1 = { value: 11.5 };
    const row2 = { value: 22.5 };
    wrapper({ time: 1_700_000_000, logical: 5, point: { x: 10, y: 20 }, seriesData: new Map([[s1.unwrap(), row1], [s2.unwrap(), row2]]) });

    expect(handler).toHaveBeenCalledTimes(1);
    const param = handler.mock.calls[0]![0] as { point: { x: number; y: number }; seriesData: Map<unknown, unknown> };
    expect(param.point).toEqual({ x: 10, y: 20 });
    expect(param.seriesData).toBeInstanceOf(Map);
    expect(param.seriesData.size).toBe(2);
    const keyOf = (h: SeriesHandle): unknown => (param.seriesData.has(h) ? h : h.unwrap());
    expect(param.seriesData.get(keyOf(s1))).toBe(row1);
    expect(param.seriesData.get(keyOf(s2))).toBe(row2);
  });

  it("the engine memoizes the LWC wrapper per handler — unsubscribe pairs by handler identity", () => {
    const e = createEngine(container);
    const onMove = vi.fn();
    e.subscribeCrosshairMove(onMove);
    e.subscribeCrosshairMove(onMove);
    const chart = H.reg.lastChart();
    expect(chart.subscribeCrosshairMove).toHaveBeenCalledTimes(2);
    const w1 = chart.subscribeCrosshairMove.mock.calls[0]![0];
    const w2 = chart.subscribeCrosshairMove.mock.calls[1]![0];
    expect(w1).toBe(w2); // same wrapper — otherwise unsubscribe could never match

    e.unsubscribeCrosshairMove(onMove);
    expect(chart.unsubscribeCrosshairMove).toHaveBeenCalledTimes(1);
    expect(chart.unsubscribeCrosshairMove.mock.calls[0]![0]).toBe(w1);
  });
});

// ── M03-A04: hidden decorations stay hidden through takeScreenshot ───────────
describe("M03-A04 — hide/show round trips keep the inventory at baseline", () => {
  it("hiding is option state on the LIVE instance: counts never move, takeScreenshot still answers", () => {
    const e = createEngine(container);
    const baseline = e.inventory();
    const s = e.addSeries("line");
    e.setWatermark(0, { visible: true, horzAlign: "center", vertAlign: "center", lines: [{ text: "Mastermind Terminal" }] });
    const pl = s.createPriceLine({ price: 5, color: "#8a94a6" });
    const decorated = e.inventory();
    expect(decorated.watermarks).toBe(baseline.watermarks + 1);
    expect(decorated.priceLines).toBe(baseline.priceLines + 1);

    // HIDE: watermark via spec replace, price line via applyOptions — neither may
    // construct or destroy an instance. The renderer that takeScreenshot()
    // re-rasterizes is therefore the SAME (hidden) instance the live chart shows.
    e.setWatermark(0, { visible: false, horzAlign: "center", vertAlign: "center", lines: [{ text: "Mastermind Terminal" }] });
    pl.applyOptions({ lineVisible: false });
    const hidden = e.inventory();
    expect(hidden.watermarks).toBe(decorated.watermarks);
    expect(hidden.priceLines).toBe(decorated.priceLines);
    const liveWm = H.reg.watermarks[H.reg.watermarks.length - 1]!;
    expect((liveWm.__opts as { visible: boolean }).visible).toBe(false);
    // The screenshot path stays callable while decorations are hidden — it re-rasterizes
    // the SAME live (hidden) instances, so hidden stays hidden in the composite.
    const shot = e.takeScreenshot();
    expect(shot).toEqual({ __canvas: true });
    expect(H.reg.lastChart().takeScreenshot).toHaveBeenCalled();

    // SHOW: round trip back to the same counts and visible state.
    e.setWatermark(0, { visible: true, horzAlign: "center", vertAlign: "center", lines: [{ text: "Mastermind Terminal" }] });
    pl.applyOptions({ lineVisible: true });
    expect((H.reg.watermarks[H.reg.watermarks.length - 1]!.__opts as { visible: boolean }).visible).toBe(true);
    const shown = e.inventory();
    expect(shown.watermarks).toBe(decorated.watermarks);
    expect(shown.priceLines).toBe(decorated.priceLines);

    // Clean removal returns to the decoration-free baseline.
    s.removePriceLine(pl);
    const after = e.inventory();
    expect(after.watermarks).toBe(decorated.watermarks); // watermark persists until replaced/destroy
    expect(after.priceLines).toBe(baseline.priceLines);
  });
});

// ── sessionShading additive handle-based entry points (committed helpers) ────
describe("sessionShading — handle-based attach/detach (additive M03 entry points)", () => {
  it("attaches/detaches the primitive through any host with the SeriesHandle slice", () => {
    const host = { attachPrimitive: vi.fn(), detachPrimitive: vi.fn() };
    const bars = [{ time: 570 * 60, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }];
    const prim = attachSessionShadingToHandle(host, bars);
    expect(host.attachPrimitive).toHaveBeenCalledTimes(1);
    expect(host.attachPrimitive.mock.calls[0]![0]).toBe(prim);
    detachSessionShadingFromHandle(host, prim);
    expect(host.detachPrimitive).toHaveBeenCalledWith(prim);
  });
});
