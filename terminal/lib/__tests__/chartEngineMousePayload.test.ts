// @vitest-environment jsdom
/**
 * M04-A02 — crosshair/click payloads expose contract handles, not raw LWC objects.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createEngine } from "../chart-engine";
import type { SeriesHandle } from "../chart-engine/api";

const H = vi.hoisted(() => {
  const charts: unknown[] = [];
  const makeSeries = () => ({
    setData: vi.fn(),
    update: vi.fn(),
    applyOptions: vi.fn(),
    options: vi.fn(() => ({})),
    data: vi.fn(() => []),
    dataByIndex: vi.fn(),
    createPriceLine: vi.fn(),
    removePriceLine: vi.fn(),
    priceLines: vi.fn(() => []),
    priceToCoordinate: vi.fn(),
    coordinateToPrice: vi.fn(),
    moveToPane: vi.fn(),
    getPane: vi.fn(() => ({ paneIndex: () => 0 })),
    priceScale: vi.fn(() => ({ width: () => 0, applyOptions: vi.fn(), options: vi.fn(() => ({})) })),
    attachPrimitive: vi.fn(),
    detachPrimitive: vi.fn(),
  });
  return {
    charts,
    makeSeries,
    lastChart: () => charts[charts.length - 1] as {
      subscribeCrosshairMove: ReturnType<typeof vi.fn>;
    },
  };
});

vi.mock("lightweight-charts", () => ({
  createChart: vi.fn(() => {
    const series = H.makeSeries();
    const chart = {
      addSeries: vi.fn(() => series),
      removeSeries: vi.fn(),
      panes: vi.fn(() => [{ getSeries: () => [series], getHeight: () => 100, setStretchFactor: vi.fn(), getStretchFactor: () => 1, getHTMLElement: () => null, priceScale: vi.fn() }]),
      timeScale: vi.fn(() => ({
        getVisibleLogicalRange: vi.fn(),
        setVisibleLogicalRange: vi.fn(),
        subscribeVisibleLogicalRangeChange: vi.fn(),
        unsubscribeVisibleLogicalRangeChange: vi.fn(),
        timeToCoordinate: vi.fn(),
        coordinateToTime: vi.fn(),
        scrollToRealTime: vi.fn(),
        scrollToPosition: vi.fn(),
        applyOptions: vi.fn(),
        fitContent: vi.fn(),
        getVisibleRange: vi.fn(),
        setVisibleRange: vi.fn(),
        logicalToCoordinate: vi.fn(),
        coordinateToLogical: vi.fn(),
        width: vi.fn(() => 400),
        timeToIndex: vi.fn(),
        options: vi.fn(() => ({})),
      })),
      subscribeCrosshairMove: vi.fn(),
      unsubscribeCrosshairMove: vi.fn(),
      subscribeClick: vi.fn(),
      unsubscribeClick: vi.fn(),
      subscribeDblClick: vi.fn(),
      unsubscribeDblClick: vi.fn(),
      applyOptions: vi.fn(),
      resize: vi.fn(),
      remove: vi.fn(),
      priceScale: vi.fn(() => ({ width: () => 60, applyOptions: vi.fn(), options: vi.fn(() => ({})) })),
      paneSize: vi.fn(() => ({ width: 400, height: 300 })),
      swapPanes: vi.fn(),
      takeScreenshot: vi.fn(() => document.createElement("canvas")),
      chartElement: vi.fn(() => document.createElement("div")),
      options: vi.fn(() => ({})),
      setCrosshairPosition: vi.fn(),
      clearCrosshairPosition: vi.fn(),
    };
    H.charts.push(chart);
    return chart;
  }),
  CandlestickSeries: {},
  BarSeries: {},
  LineSeries: {},
  AreaSeries: {},
  HistogramSeries: {},
  BaselineSeries: {},
  createSeriesMarkers: vi.fn(),
  createTextWatermark: vi.fn(),
  MismatchDirection: { None: 0, NearestLeft: -1, NearestRight: 1 },
}));

function isRawLwcSeries(v: unknown): boolean {
  return Boolean(v && typeof v === "object" && "getPane" in (v as object) && !("kind" in (v as object)));
}

describe("M04-A02 mouse payload sanitization", () => {
  let container: HTMLElement;

  beforeEach(() => {
    H.charts.length = 0;
    container = document.createElement("div");
  });

  it("delivers SeriesHandle keys in seriesData and hoveredSeries", () => {
    const engine = createEngine(container);
    const s1 = engine.addSeries("line");
    const row = { value: 42 };
    const handler = vi.fn();
    engine.subscribeCrosshairMove(handler);
    const wrapper = H.lastChart().subscribeCrosshairMove.mock.calls[0]![0] as (p: unknown) => void;
    const rawKey = s1.unwrap();
    wrapper({
      time: 1_700_000_000,
      logical: 3,
      point: { x: 1, y: 2 },
      seriesData: new Map([[rawKey, row]]),
      hoveredSeries: rawKey,
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const param = handler.mock.calls[0]![0] as {
      seriesData?: Map<SeriesHandle, unknown>;
      hoveredSeries?: SeriesHandle | null;
    };
    expect(param.seriesData).toBeInstanceOf(Map);
    expect(param.seriesData?.get(s1)).toBe(row);
    for (const key of param.seriesData?.keys() ?? []) {
      expect(isRawLwcSeries(key)).toBe(false);
      expect((key as SeriesHandle).kind).toBe("line");
    }
    expect(param.hoveredSeries).toBe(s1);
    expect(isRawLwcSeries(param.hoveredSeries)).toBe(false);
  });
});
