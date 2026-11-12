// @vitest-environment jsdom
// Canvas engine (impl "mm") against the C02-extended contract surface: handle identity,
// data readback, price/time scale ranges and the programmatic crosshair. Every assertion
// here can fail (falsifier: mutate the model's nearest-left branch → RED).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCanvasEngine, createManualScheduler } from "@/lib/chart-engine/canvas";
import type { EngineSeriesRow } from "@/lib/chart-engine/api";

type Call = { method: string; args: unknown[] };
const ctxByCanvas = new WeakMap<HTMLCanvasElement, { __calls: Call[] }>();

function makeFakeCtx(): CanvasRenderingContext2D & { __calls: Call[] } {
  const calls: Call[] = [];
  const rec = (method: string) => (...args: unknown[]) => { calls.push({ method, args }); };
  const ctx: Record<string, unknown> = { __calls: calls };
  for (const m of [
    "setTransform", "fillRect", "clearRect", "drawImage", "beginPath", "moveTo", "lineTo", "stroke",
    "fill", "save", "restore", "scale", "translate", "rect", "closePath", "fillText", "strokeRect",
  ]) ctx[m] = rec(m);
  ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  return ctx as unknown as CanvasRenderingContext2D & { __calls: Call[] };
}

const ROWS: EngineSeriesRow[] = [
  { time: "2026-01-05", open: 10, high: 12, low: 9, close: 11 },
  { time: "2026-01-06", open: 11, high: 14, low: 10, close: 13 },
  { time: "2026-01-07", open: 13, high: 15, low: 12, close: 14 },
];

describe("canvas engine: C02 contract surface", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
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

  function mount(opts: Record<string, unknown> = {}) {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, { width: 200, height: 100, devicePixelRatio: 1, scheduler, ...opts });
    return { engine, scheduler };
  }

  it("pane.getSeries() and series.priceLines() return the SAME handle objects (identity)", () => {
    const { engine } = mount();
    const a = engine.addSeries("candles");
    const b = engine.addSeries("line", undefined, 1);
    const pane0 = engine.panes()[0];
    expect(pane0.getSeries()).toHaveLength(1);
    expect(pane0.getSeries()[0]).toBe(a);
    expect(engine.panes()[1].getSeries()[0]).toBe(b);
    expect(pane0.priceScale("right").options()).toMatchObject({ mode: "normal", autoScale: true });

    const l1 = a.createPriceLine({ price: 10 });
    const l2 = a.createPriceLine({ price: 11, title: "two" });
    expect(a.priceLines()).toHaveLength(2);
    expect(a.priceLines()[0]).toBe(l1);
    expect(a.priceLines()[1]).toBe(l2);
    expect(l2.options()).toMatchObject({ price: 11, title: "two" });
    a.removePriceLine(l1);
    expect(a.priceLines()).toEqual([l2]);
    expect(l1.options()).toEqual({});
    expect(engine.inventory().priceLines).toBe(1);

    engine.removeSeries(a);
    expect(pane0.getSeries()).toEqual([]);
    expect(a.priceLines()).toEqual([]);
    expect(engine.inventory().series).toBe(1);
    engine.destroy();
  });

  it("series.data()/options() are copies and dataByIndex honours the mismatch direction", () => {
    const { engine } = mount();
    const s = engine.addSeries("candles", { priceScaleId: "left", lineWidth: 2 });
    s.setData(ROWS);
    const rows = s.data();
    expect(rows).toEqual(ROWS);
    (rows as EngineSeriesRow[]).push({ time: "2026-01-08" });
    expect(s.data()).toHaveLength(3);
    const opts = s.options();
    expect(opts).toEqual({ priceScaleId: "left", lineWidth: 2 });
    opts.lineWidth = 9;
    expect(s.options().lineWidth).toBe(2);
    expect(s.priceScale().options()).toMatchObject({ mode: "normal" });

    expect(s.dataByIndex(1)).toBe(ROWS[1]);
    expect(s.dataByIndex(1.4)).toBe(ROWS[1]);
    expect(s.dataByIndex(5)).toBeNull();
    expect(s.dataByIndex(5, "nearest-left")).toBe(ROWS[2]);
    expect(s.dataByIndex(5, "nearest-right")).toBeNull();
    expect(s.dataByIndex(-1)).toBeNull();
    expect(s.dataByIndex(-1, "nearest-right")).toBe(ROWS[0]);
    expect(s.dataByIndex(-1, "nearest-left")).toBeNull();
    expect(s.dataByIndex(Number.NaN, "nearest-left")).toBeNull();
    engine.destroy();
  });

  it("price scale: autoscale readback, explicit range (normalised), setAutoScale re-arms", () => {
    const { engine } = mount();
    const s = engine.addSeries("candles");
    s.setData(ROWS);
    const ps = s.priceScale();
    expect(ps.getVisibleRange()).toEqual({ from: 9, to: 15 });
    ps.setVisibleRange({ from: 20, to: 5 });
    expect(ps.getVisibleRange()).toEqual({ from: 5, to: 20 });
    expect(ps.options()).toMatchObject({ autoScale: false });
    ps.setVisibleRange({ from: Number.NaN, to: 1 });
    expect(ps.getVisibleRange()).toEqual({ from: 5, to: 20 });
    ps.setAutoScale(true);
    expect(ps.options()).toMatchObject({ autoScale: true });
    expect(ps.getVisibleRange()).toEqual({ from: 9, to: 15 });
    ps.applyOptions({ invertScale: true, mode: "log", scaleMargins: { top: 0.1, bottom: 0.3 } });
    expect(ps.options()).toEqual({
      mode: "log", invertScale: true, autoScale: true, scaleMargins: { top: 0.1, bottom: 0.3 },
      tickMarkDensity: 2.5, // LWC priceScaleOptionsDefaults; ChartPanel reads it back per pane
    });
    expect(engine.priceScale("right", 0).options()).toEqual(ps.options());
    engine.destroy();
  });

  it("time scale: timeToIndex, coordinate<->logical, width, time-domain visible range", () => {
    const { engine } = mount();
    const ts = engine.timeScale();
    expect(ts.timeToIndex("2026-01-06")).toBeNull();
    const s = engine.addSeries("candles");
    s.setData(ROWS);
    expect(ts.width()).toBe(200);
    expect(ts.timeToIndex("2026-01-06")).toBe(1);
    expect(ts.timeToIndex({ year: 2026, month: 1, day: 7 })).toBe(2);
    expect(ts.timeToIndex("2026-01-06T15:00:00Z")).toBeNull();
    expect(ts.timeToIndex("2026-01-06T15:00:00Z", true)).toBe(1);
    expect(ts.timeToIndex("2026-01-09")).toBeNull(); // F-04 / dossier §1.6 (dev:6037-6053): future times are not data
    expect(ts.timeToIndex("2026-01-09", true)).toBe(2); // findNearest past last point → last index
    expect(ts.getVisibleLogicalRange()).toEqual({ from: 0, to: 3 });
    expect(ts.getVisibleRange()).toEqual({ from: "2026-01-05", to: "2026-01-07" });
    const x1 = ts.logicalToCoordinate(1);
    expect(x1).toBeCloseTo(100, 6);
    expect(ts.coordinateToLogical(x1!)).toBeCloseTo(1, 6);
    expect(ts.logicalToCoordinate(Number.NaN)).toBeNull();
    ts.setVisibleRange({ from: "2026-01-07", to: "2026-01-06" });
    expect(ts.getVisibleLogicalRange()).toEqual({ from: 1, to: 3 });
    expect(ts.getVisibleRange()).toEqual({ from: "2026-01-06", to: "2026-01-07" });
    ts.applyOptions({ rightOffset: 4 });
    expect(ts.options()).toMatchObject({ rightOffset: 4 });
    engine.destroy();
  });

  it("engine.options() is a copy; setCrosshairPosition paints without firing crosshair handlers; clear erases", () => {
    // No price strip: x of logical 1 is asserted against the full 200 px plot.
    const { engine, scheduler } = mount({ rightPriceScale: { visible: false } });
    const opts = engine.options();
    expect(opts).toMatchObject({ width: 200, height: 100 });
    (opts as Record<string, unknown>).width = 1;
    expect(engine.options().width).toBe(200);

    const s = engine.addSeries("candles");
    s.setData(ROWS);
    const fired = vi.fn();
    engine.subscribeCrosshairMove(fired);
    scheduler.flush();
    const overlay = engine.chartElement().querySelector("canvas[data-mm-overlay]") as HTMLCanvasElement;
    const octx = ctxByCanvas.get(overlay)!;
    octx.__calls.length = 0;

    engine.setCrosshairPosition(13, "2026-01-06", s);
    scheduler.flush();
    const moves = octx.__calls.filter((c) => c.method === "moveTo");
    expect(moves).toHaveLength(2);
    // x of logical 1; a 1-device-px line sits on the pixel centre (LWC drawVerticalLine +0.5)
    expect(moves[0].args[0]).toBeCloseTo(100.5, 6);
    expect(fired).not.toHaveBeenCalled();

    octx.__calls.length = 0;
    engine.clearCrosshairPosition();
    scheduler.flush();
    expect(octx.__calls.some((c) => c.method === "clearRect")).toBe(true);
    expect(octx.__calls.filter((c) => c.method === "moveTo")).toHaveLength(0);

    // A removed series cannot host a programmatic crosshair.
    octx.__calls.length = 0;
    engine.removeSeries(s);
    engine.setCrosshairPosition(13, "2026-01-06", s);
    scheduler.flush();
    expect(octx.__calls.filter((c) => c.method === "moveTo")).toHaveLength(0);
    engine.destroy();
  });

  it("after destroy the C02 surface is a deterministic no-op and chartElement() is the detached root", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("candles");
    s.setData(ROWS);
    const line = s.createPriceLine({ price: 10 });
    const pane = engine.panes()[0];
    const ps = s.priceScale();
    const ts = engine.timeScale();
    const root = engine.chartElement();
    engine.destroy();
    expect(engine.chartElement()).toBe(root);
    expect(root.isConnected).toBe(false);
    expect(() => {
      engine.setCrosshairPosition(1, "2026-01-06", s);
      engine.clearCrosshairPosition();
      engine.removeSeries(s);
      s.removePriceLine(line);
      ps.setVisibleRange({ from: 1, to: 2 });
      ps.setAutoScale(false);
      ts.setVisibleRange({ from: "2026-01-05", to: "2026-01-06" });
      scheduler.flush();
    }).not.toThrow();
    expect(s.data()).toEqual([]);
    expect(s.options()).toEqual({});
    expect(s.dataByIndex(0, "nearest-left")).toBeNull();
    expect(s.priceLines()).toEqual([]);
    expect(line.options()).toEqual({});
    expect(pane.getSeries()).toEqual([]);
    expect(ps.options()).toEqual({});
    expect(ps.getVisibleRange()).toBeNull();
    expect(ts.getVisibleRange()).toBeNull();
    expect(ts.timeToIndex("2026-01-06", true)).toBeNull();
    expect(ts.logicalToCoordinate(1)).toBeNull();
    expect(ts.coordinateToLogical(10)).toBeNull();
    expect(ts.width()).toBe(0);
    expect(ts.options()).toEqual({});
    expect(engine.options()).toMatchObject({ width: 200 });
  });
});
