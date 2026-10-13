// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CANVAS_CAPABILITIES,
  CANVAS_ENGINE_IMPL,
  ChartModel,
  createCanvasEngine,
  createManualScheduler,
  EngineRefusalError,
  logicalOfX,
  xOfLogical,
  type SeriesModel,
} from "@/lib/chart-engine/canvas";
import type { EngineSeriesKind, EngineSeriesRow } from "@/lib/chart-engine/api";

type CtxCall = { method: string; args: unknown[] };

type FakeCtx = CanvasRenderingContext2D & { __calls: CtxCall[] };

function makeFakeCtx(): FakeCtx {
  const calls: CtxCall[] = [];
  const rec = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
  };
  const props: Record<string, unknown> = {};
  const ctx: Record<string, unknown> = {
    __calls: calls,
    setTransform: rec("setTransform"),
    fillRect: rec("fillRect"),
    clearRect: rec("clearRect"),
    drawImage: rec("drawImage"),
    beginPath: rec("beginPath"),
    moveTo: rec("moveTo"),
    lineTo: rec("lineTo"),
    stroke: rec("stroke"),
    fill: rec("fill"),
    save: rec("save"),
    restore: rec("restore"),
    scale: rec("scale"),
    translate: rec("translate"),
    rect: rec("rect"),
    closePath: rec("closePath"),
    fillText: rec("fillText"),
    strokeRect: rec("strokeRect"),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, m11: 1, m12: 0, m21: 0, m22: 1, m41: 0, m42: 0 }),
  };
  for (const p of ["fillStyle", "strokeStyle", "lineWidth", "font", "textAlign", "textBaseline", "globalAlpha"]) {
    Object.defineProperty(ctx, p, {
      get: () => props[p],
      set: (v: unknown) => {
        calls.push({ method: `set:${p}`, args: [v] });
        props[p] = v;
      },
      enumerable: true,
      configurable: true,
    });
  }
  return ctx as unknown as FakeCtx;
}

const ctxByCanvas = new WeakMap<HTMLCanvasElement, FakeCtx>();

function ctxOf(canvas: HTMLCanvasElement): FakeCtx | undefined {
  return ctxByCanvas.get(canvas);
}

const KINDS: EngineSeriesKind[] = ["candles", "bars", "line", "area", "histogram", "baseline"];

describe("canvas engine skeleton", () => {
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
      return ctx;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  function mount(opts: Record<string, unknown> = {}) {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 200,
      height: 100,
      devicePixelRatio: 2,
      scheduler,
      ...opts,
    });
    return { engine, scheduler };
  }

  it("identifies as impl mm and unwraps the owned ChartModel", () => {
    const { engine } = mount();
    expect(engine.impl).toBe("mm");
    expect(CANVAS_ENGINE_IMPL).toBe("mm");
    const model = engine.unwrap<ChartModel>();
    expect(model).toBeInstanceOf(ChartModel);
    expect(engine.unwrap()).toBe(model);
    engine.destroy();
  });

  it("construction allocates one canvas per pane and sizes bitmaps by dpr", () => {
    const { engine } = mount({ width: 200, height: 100, devicePixelRatio: 2 });
    const root = engine.chartElement();
    expect(root).toBeTruthy();
    const paneCanvases = root!.querySelectorAll("canvas[data-mm-pane-canvas]");
    const overlay = root!.querySelectorAll("canvas[data-mm-overlay]");
    expect(paneCanvases).toHaveLength(1);
    expect(overlay).toHaveLength(1);
    const pane = paneCanvases[0] as HTMLCanvasElement;
    expect(pane.width).toBe(400);
    expect(pane.height).toBe(200);
    expect(pane.style.width).toBe("200px");
    expect(pane.style.height).toBe("100px");
    const ctx = ctxOf(pane);
    expect(ctx?.__calls.some((c) => c.method === "setTransform" && c.args[0] === 2 && c.args[3] === 2)).toBe(true);
    engine.destroy();
  });

  it("addSeries of all six kinds and inventory counts including seriesByPane and priceLines", () => {
    const { engine } = mount();
    const handles = KINDS.map((k) => engine.addSeries(k));
    expect(handles.map((h) => h.kind)).toEqual(KINDS);
    expect(engine.inventory()).toMatchObject({
      alive: true,
      panes: 1,
      series: 6,
      seriesByPane: [6],
      priceLines: 0,
      watermarks: 0,
    });
    handles[0].createPriceLine({ price: 10, color: "#abc" });
    handles[0].createPriceLine({ price: 20 });
    expect(engine.inventory().priceLines).toBe(2);
    engine.destroy();
  });

  it("setData/update retain whitespace rows", () => {
    const { engine } = mount();
    const s = engine.addSeries("line");
    const rows: EngineSeriesRow[] = [
      { time: "2020-01-01", value: 1 },
      { time: "2020-01-02" },
      { time: "2020-01-03", value: 3 },
    ];
    s.setData(rows);
    const model = s.unwrap<SeriesModel>();
    expect(model.rows).toHaveLength(3);
    expect(model.rows[1]).toEqual({ time: "2020-01-02" });
    s.update({ time: "2020-01-03", value: 4 });
    expect(model.rows[2]).toEqual({ time: "2020-01-03", value: 4 });
    s.update({ time: "2020-01-04" });
    expect(model.rows).toHaveLength(4);
    expect(model.rows[3]).toEqual({ time: "2020-01-04" });
    engine.destroy();
  });

  it("moveToPane clamps an out-of-range index and appends a pane", () => {
    const { engine } = mount();
    const s = engine.addSeries("line");
    expect(engine.inventory().panes).toBe(1);
    s.moveToPane(99);
    expect(s.paneIndex()).toBe(1);
    expect(engine.inventory().panes).toBe(2);
    expect(engine.inventory().seriesByPane).toEqual([0, 1]);
    const root = engine.chartElement()!;
    expect(root.querySelectorAll("canvas[data-mm-pane-canvas]")).toHaveLength(2);
    s.moveToPane(0);
    expect(s.paneIndex()).toBe(0);
    engine.destroy();
  });

  it("addSeries paneIndex also clamps and appends", () => {
    const { engine } = mount();
    engine.addSeries("candles");
    engine.addSeries("histogram", { priceScaleId: "volume" }, 5);
    expect(engine.inventory().panes).toBe(2);
    expect(engine.inventory().seriesByPane).toEqual([1, 1]);
    engine.destroy();
  });

  it("swapPanes exchanges series membership and pane indices", () => {
    const { engine } = mount();
    const a = engine.addSeries("line");
    const b = engine.addSeries("histogram", {}, 1);
    expect(a.paneIndex()).toBe(0);
    expect(b.paneIndex()).toBe(1);
    engine.swapPanes(0, 1);
    expect(a.paneIndex()).toBe(1);
    expect(b.paneIndex()).toBe(0);
    expect(engine.inventory().seriesByPane).toEqual([1, 1]);
    engine.destroy();
  });

  it("watermark replace semantics keep a single watermark per pane", () => {
    const { engine } = mount();
    engine.setWatermark(0, [{ text: "first" }]);
    expect(engine.inventory().watermarks).toBe(1);
    engine.setWatermark(0, { visible: true, horzAlign: "center", lines: [{ text: "second" }] });
    expect(engine.inventory().watermarks).toBe(1);
    const pane = engine.unwrap<ChartModel>().panes[0];
    expect(pane.watermark?.lines[0].text).toBe("second");
    engine.addSeries("line", {}, 1);
    engine.setWatermark(1, [{ text: "other" }]);
    expect(engine.inventory().watermarks).toBe(2);
    expect(() => engine.setWatermark(9, [{ text: "nope" }])).toThrow(/pane 9/);
    engine.destroy();
  });

  it("subscribe/unsubscribe are symmetric for crosshair, click, dblclick", () => {
    const { engine } = mount();
    const move = vi.fn();
    const click = vi.fn();
    const dbl = vi.fn();
    engine.subscribeCrosshairMove(move);
    engine.subscribeClick(click);
    engine.subscribeDblClick(dbl);
    const model = engine.unwrap<ChartModel>();
    model.emitMouse("crosshair", { point: { x: 1, y: 1 } });
    model.emitMouse("click", { point: { x: 2, y: 2 } });
    model.emitMouse("dblclick", { point: { x: 3, y: 3 } });
    expect(move).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(dbl).toHaveBeenCalledTimes(1);
    engine.unsubscribeCrosshairMove(move);
    engine.unsubscribeClick(click);
    engine.unsubscribeDblClick(dbl);
    model.emitMouse("crosshair", { point: { x: 4, y: 4 } });
    model.emitMouse("click", { point: { x: 5, y: 5 } });
    model.emitMouse("dblclick", { point: { x: 6, y: 6 } });
    expect(move).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(dbl).toHaveBeenCalledTimes(1);
    engine.destroy();
  });

  it("logical range set/get notifies only on change", () => {
    const { engine } = mount();
    const ts = engine.timeScale();
    expect(ts).toBe(engine.timeScale());
    const handler = vi.fn();
    ts.subscribeVisibleLogicalRangeChange(handler);
    ts.setVisibleLogicalRange({ from: 0, to: 10 });
    expect(ts.getVisibleLogicalRange()).toEqual({ from: 0, to: 10 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ from: 0, to: 10 });
    ts.setVisibleLogicalRange({ from: 0, to: 10 });
    expect(handler).toHaveBeenCalledTimes(1);
    ts.setVisibleLogicalRange({ from: 1, to: 11 });
    expect(handler).toHaveBeenCalledTimes(2);
    ts.unsubscribeVisibleLogicalRangeChange(handler);
    ts.setVisibleLogicalRange({ from: 2, to: 12 });
    expect(handler).toHaveBeenCalledTimes(2);
    engine.destroy();
  });

  it("projection round trips xOfLogical/logicalOfX and price<->y within 1e-9", () => {
    const { engine } = mount({ width: 200, height: 100 });
    const s = engine.addSeries("line");
    s.setData([
      { time: 1, value: 10 },
      { time: 2, value: 20 },
      { time: 3, value: 30 },
    ]);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 10 });
    const model = engine.unwrap<ChartModel>();
    expect(model.time.barSpacing).toBeCloseTo(20, 9);
    for (const i of [0, 0.5, 3, 9.25]) {
      const x = model.xOfLogical(i);
      expect(Math.abs(model.logicalOfX(x) - i)).toBeLessThan(1e-9);
      expect(Math.abs(logicalOfX(xOfLogical(i, model.time), model.time) - i)).toBeLessThan(1e-9);
    }
    const y = s.priceToCoordinate(15);
    expect(y).not.toBeNull();
    const p = s.coordinateToPrice(y!);
    expect(p).not.toBeNull();
    expect(Math.abs(p! - 15)).toBeLessThan(1e-9);
    engine.destroy();
  });

  it("timeToCoordinate resolves nearest primary-series row for strings and numbers", () => {
    const { engine } = mount({ width: 100, height: 50 });
    const s = engine.addSeries("candles");
    s.setData([
      { time: "2020-01-01", open: 1, high: 2, low: 1, close: 1.5 },
      { time: "2020-01-02", open: 1.5, high: 3, low: 1, close: 2 },
      { time: "2020-01-03", open: 2, high: 4, low: 2, close: 3 },
    ]);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 3 });
    const ts = engine.timeScale();
    const x0 = ts.timeToCoordinate("2020-01-01");
    const xBd = ts.timeToCoordinate({ year: 2020, month: 1, day: 1 });
    expect(x0).not.toBeNull();
    expect(xBd).toBe(x0);
    expect(ts.coordinateToTime(x0!)).toBe("2020-01-01");
    expect(ts.timeToCoordinate("1999-01-01")).toBeNull();
    engine.destroy();
  });

  it("takeScreenshot is sync and draws every pane", () => {
    const { engine, scheduler } = mount({ width: 200, height: 100, devicePixelRatio: 2 });
    engine.addSeries("line", {}, 0);
    engine.addSeries("histogram", {}, 1);
    scheduler.flush();
    const shot = engine.takeScreenshot();
    expect(shot).toBeInstanceOf(HTMLCanvasElement);
    const paneCanvases = [...engine.chartElement()!.querySelectorAll("canvas[data-mm-pane-canvas]")] as HTMLCanvasElement[];
    expect(paneCanvases).toHaveLength(2);
    expect(shot.width).toBe(paneCanvases[0].width);
    expect(shot.height).toBe(paneCanvases[0].height + paneCanvases[1].height);
    const calls = ctxOf(shot)?.__calls.filter((c) => c.method === "drawImage") ?? [];
    expect(calls).toHaveLength(2);
    expect(calls[0].args[0]).toBe(paneCanvases[0]);
    expect(calls[1].args[0]).toBe(paneCanvases[1]);
    engine.destroy();
  });

  it("destroy exactly once releases canvases/observers and zeroes inventory", () => {
    class FakeRO {
      disconnected = false;
      observe(): void { /* test stand-in */ }
      unobserve(): void { /* test stand-in */ }
      disconnect(): void {
        this.disconnected = true;
      }
    }
    const { engine } = mount({
      autoSize: true,
      resizeObserverCtor: FakeRO as unknown as typeof ResizeObserver,
    });
    const root = engine.chartElement()!;
    expect(container.contains(root)).toBe(true);
    const model = engine.unwrap<ChartModel>();
    expect(model.alive).toBe(true);
    engine.destroy();
    engine.destroy();
    expect(container.contains(root)).toBe(false);
    expect(container.childNodes).toHaveLength(0);
    expect(engine.inventory()).toEqual({
      alive: false,
      panes: 0,
      series: 0,
      seriesByPane: [],
      priceLines: 0,
      watermarks: 0,
    });
    // Contract: chartElement() is always an HTMLElement; after destroy it is the detached root.
    expect(engine.chartElement()).toBe(root);
    expect(engine.chartElement().isConnected).toBe(false);
  });

  it("post-destroy handles are deterministic no-ops and queries return null/[]/0", () => {
    const { engine } = mount();
    const s = engine.addSeries("line");
    const pl = s.createPriceLine({ price: 1 });
    const ts = engine.timeScale();
    s.setData([{ time: 1, value: 10 }]);
    engine.destroy();
    expect(() => s.setData([{ time: 2, value: 11 }])).not.toThrow();
    expect(() => s.update({ time: 2, value: 12 })).not.toThrow();
    expect(() => s.applyOptions({ color: "#fff" })).not.toThrow();
    expect(() => s.setMarkers([])).not.toThrow();
    expect(() => s.moveToPane(1)).not.toThrow();
    expect(() => s.remove()).not.toThrow();
    expect(() => pl.applyOptions({ price: 2 })).not.toThrow();
    expect(() => pl.remove()).not.toThrow();
    expect(s.priceToCoordinate(10)).toBeNull();
    expect(s.coordinateToPrice(10)).toBeNull();
    expect(s.paneIndex()).toBe(0);
    expect(s.pane().getHTMLElement()).toBeNull();
    expect(s.pane().height()).toBe(0);
    expect(engine.panes()).toEqual([]);
    expect(ts.getVisibleLogicalRange()).toBeNull();
    expect(ts.timeToCoordinate(1)).toBeNull();
    expect(ts.coordinateToTime(0)).toBeNull();
    expect(engine.paneSize()).toEqual({ width: 0, height: 0 });
    expect(engine.inventory().alive).toBe(false);
  });

  it("EngineRefusalError leaves no DOM (R01-A04)", () => {
    expect(CANVAS_CAPABILITIES.priceScaleModes).toEqual(["normal", "log", "percent", "indexed100"]);
    expect(() =>
      createCanvasEngine(container, { width: 100, height: 50, kineticScroll: { touch: true } }),
    ).toThrow(EngineRefusalError);
    try {
      createCanvasEngine(container, { width: 100, height: 50, kineticScroll: { touch: true } });
    } catch (err) {
      expect(err).toBeInstanceOf(EngineRefusalError);
      const e = err as EngineRefusalError;
      expect(e.reason).toMatch(/kinetic/);
      expect(e.unsupported).toContain("kineticScroll");
    }
    expect(container.childNodes).toHaveLength(0);
  });

  it("paneSize throws for a missing pane while alive", () => {
    const { engine } = mount();
    expect(engine.paneSize(0)).toEqual({ width: 200, height: 100 });
    expect(() => engine.paneSize(3)).toThrow(/pane 3/);
    engine.destroy();
  });

  it("getHTMLElement returns the pane wrapper and chartElement the root", () => {
    const { engine } = mount();
    const root = engine.chartElement()!;
    const paneEl = engine.panes()[0].getHTMLElement();
    expect(paneEl).toBe(root.querySelector("[data-mm-pane='0']"));
    expect(root.dataset.mmChart).toBe("mm");
    engine.destroy();
  });

  it("paint loop coalesces invalidations until the scheduler flushes", () => {
    const { engine, scheduler } = mount({
      layout: { background: { color: "#111111" } },
      grid: { vertLines: { visible: true, color: "#222" }, horzLines: { visible: true, color: "#333" } },
    });
    const s = engine.addSeries("candles", { upColor: "#4caf50", downColor: "#f44336" });
    s.setData([
      { time: 1, open: 1, high: 2, low: 0.5, close: 1.5 },
      { time: 2, open: 1.5, high: 2.5, low: 1, close: 2 },
    ]);
    const pane = engine.chartElement()!.querySelector("canvas[data-mm-pane-canvas]") as HTMLCanvasElement;
    const before = ctxOf(pane)!.__calls.filter((c) => c.method === "fillRect").length;
    scheduler.flush();
    const after = ctxOf(pane)!.__calls.filter((c) => c.method === "fillRect").length;
    expect(after).toBeGreaterThan(before);
    engine.destroy();
  });

  it("capabilities advertise the six series kinds and screenshot", () => {
    expect([...CANVAS_CAPABILITIES.seriesKinds]).toEqual(KINDS);
    expect(CANVAS_CAPABILITIES.screenshot).toBe(true);
    expect(CANVAS_CAPABILITIES.watermark).toBe(true);
    expect(CANVAS_CAPABILITIES.markers).toBe(true);
    expect(CANVAS_CAPABILITIES.primitives).toBe(true);
  });
});
