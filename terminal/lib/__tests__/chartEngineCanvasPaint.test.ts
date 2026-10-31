// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CANVAS_CAPABILITIES,
  CANVAS_NEUTRAL_DEFAULTS,
  assertEnginePrimitive,
  createCanvasEngine,
  createManualScheduler,
  EngineRefusalError,
} from "@/lib/chart-engine/canvas";
import { contrastColors } from "@/lib/chart-engine/canvas/priceAxis";
import type { EnginePrimitive, EngineProjection, PrimitiveAttachContext } from "@/lib/chart-engine/primitive";
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
    arc: rec("arc"),
    clip: rec("clip"),
    closePath: rec("closePath"),
    fillText: rec("fillText"),
    strokeRect: rec("strokeRect"),
    setLineDash: rec("setLineDash"),
    measureText: (text: string) => ({ width: String(text).length * 7 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
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

const OHLC: EngineSeriesRow[] = [
  { time: 1_700_000_000, open: 10, high: 12, low: 9, close: 11 },
  { time: 1_700_000_060, open: 11, high: 14, low: 10, close: 13 },
  { time: 1_700_000_120, open: 13, high: 15, low: 12, close: 12 },
];

describe("canvas engine real-frame paint", () => {
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
      devicePixelRatio: 1,
      scheduler,
      ...opts,
    });
    return { engine, scheduler };
  }

  function paneCtx(engine: ReturnType<typeof createCanvasEngine>, index = 0): FakeCtx {
    const canvas = engine.chartElement().querySelectorAll("canvas[data-mm-pane-canvas]")[index] as HTMLCanvasElement;
    return ctxOf(canvas)!;
  }

  it("paints candle bodies with the upColor/downColor from series options", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("candles", { upColor: "up-body", downColor: "down-body" });
    s.setData(OHLC);
    scheduler.flush();
    const fills = paneCtx(engine).__calls.filter((c) => c.method === "set:fillStyle").map((c) => c.args[0]);
    expect(fills).toContain("up-body");
    expect(fills).toContain("down-body");
    engine.destroy();
  });

  it("40k candles issue O(colours) fill() calls, not O(bars)", () => {
    const { engine, scheduler } = mount({ width: 200, height: 80 });
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    const rows: EngineSeriesRow[] = [];
    for (let i = 0; i < 40_000; i++) {
      const close = i % 2 === 0 ? 11 : 9;
      rows.push({ time: 1_700_000_000 + i, open: 10, high: 12, low: 8, close });
    }
    s.setData(rows);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 40_000 });
    scheduler.flush();
    const ctx = paneCtx(engine);
    const fills = ctx.__calls.filter((c) => c.method === "fill").length;
    const rects = ctx.__calls.filter((c) => c.method === "rect").length;
    expect(fills).toBeLessThan(16);
    expect(rects).toBeLessThan(2_000);
    expect(fills).toBeGreaterThan(0);
    engine.destroy();
  });

  it("a live tick on pane 0 does not issue draw calls on pane 1", () => {
    const { engine, scheduler } = mount();
    const a = engine.addSeries("candles", { upColor: "U", downColor: "D" }, 0);
    const b = engine.addSeries("line", { color: "#abc" }, 1);
    a.setData(OHLC);
    b.setData([
      { time: 1_700_000_000, value: 1 },
      { time: 1_700_000_060, value: 2 },
      { time: 1_700_000_120, value: 3 },
    ]);
    scheduler.flush();
    const ctx1 = paneCtx(engine, 1);
    const before = ctx1.__calls.length;
    a.update({ time: 1_700_000_120, open: 13, high: 16, low: 12, close: 15 });
    scheduler.flush();
    expect(ctx1.__calls.length).toBe(before);
    engine.destroy();
  });

  it("unknown option groups are refused at construction and applyOptions; applyOptions is atomic", () => {
    expect(() =>
      createCanvasEngine(container, { width: 80, height: 40, overlayPriceScales: { ticksVisible: true } }),
    ).toThrow(EngineRefusalError);
    expect(container.childNodes).toHaveLength(0);

    const { engine } = mount();
    const before = engine.options();
    expect(() => engine.applyOptions({ trackingMode: { exitMode: 0 } })).toThrow(EngineRefusalError);
    expect(engine.options()).toEqual(before);
    engine.destroy();
  });

  it("construction strips scheduler/dpr keys so they are never reported as unsupported", () => {
    const scheduler = createManualScheduler();
    expect(() =>
      createCanvasEngine(container, { width: 80, height: 40, scheduler, devicePixelRatio: 2 }),
    ).not.toThrow();
    const engine = createCanvasEngine(container, { width: 80, height: 40, scheduler, devicePixelRatio: 2 });
    expect(engine.options().scheduler).toBeUndefined();
    expect(engine.options().devicePixelRatio).toBeUndefined();
    engine.destroy();
  });

  it("attached/detached/update/paint lifecycle and requestUpdate through the scheduler", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("line", { color: "#fff" });
    s.setData([{ time: 1, value: 1 }, { time: 2, value: 2 }]);
    const log: string[] = [];
    let attachCtx: PrimitiveAttachContext | undefined;
    const prim: EnginePrimitive = {
      id: "p1",
      zOrder: "normal",
      attached(ctx) {
        log.push("attached");
        attachCtx = ctx;
      },
      detached() { log.push("detached"); },
      update(proj) { log.push(`update:${proj.generation}`); },
      paint(ctx, proj) {
        log.push("paint");
        expect(proj).toMatchObject({ widthPx: expect.any(Number), heightPx: expect.any(Number) });
        expect(typeof proj.timeToX).toBe("function");
        expect(typeof proj.xToTime).toBe("function");
        void ctx;
      },
    };
    s.attachPrimitive(prim);
    expect(log).toEqual(["attached"]);
    expect(attachCtx).toBeDefined();
    expect(attachCtx!.seriesId).toBe(String(s.unwrap<{ id: number }>().id));
    expect(typeof attachCtx!.requestUpdate).toBe("function");
    scheduler.flush();
    expect(log.filter((l) => l.startsWith("update:")).length).toBe(1);
    expect(log).toContain("paint");
    const updates = log.filter((l) => l.startsWith("update:")).length;
    attachCtx!.requestUpdate();
    scheduler.flush();
    expect(log.filter((l) => l.startsWith("update:")).length).toBeGreaterThanOrEqual(updates);
    s.detachPrimitive(prim);
    expect(log.filter((l) => l === "detached")).toEqual(["detached"]);
    engine.destroy();
  });

  it("detach on removeSeries and destroy fires detached exactly once", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("line", { color: "#fff" });
    s.setData([{ time: 1, value: 1 }]);
    const detached = vi.fn();
    const prim: EnginePrimitive = {
      id: "gone",
      attached() { /* registry */ },
      detached,
      update() { /* registry */ },
    };
    s.attachPrimitive(prim);
    scheduler.flush();
    s.remove();
    expect(detached).toHaveBeenCalledTimes(1);
    s.detachPrimitive(prim);
    expect(detached).toHaveBeenCalledTimes(1);
    engine.destroy();
  });

  it("takeScreenshot composites the overlay last only when a crosshair is visible", () => {
    const { engine, scheduler } = mount();
    const line = engine.addSeries("line", { color: "#fff" }, 0);
    engine.addSeries("histogram", { color: "#eee" }, 1);
    line.setData([{ time: 1_700_000_000, value: 11 }, { time: 1_700_000_060, value: 12 }]);
    scheduler.flush();
    const shot = engine.takeScreenshot();
    const panes = [...engine.chartElement().querySelectorAll("canvas[data-mm-pane-canvas]")] as HTMLCanvasElement[];
    const overlay = engine.chartElement().querySelector("canvas[data-mm-overlay]") as HTMLCanvasElement;
    const without = ctxOf(shot)!.__calls.filter((c) => c.method === "drawImage");
    expect(without).toHaveLength(2);
    expect(without.map((c) => c.args[0])).toEqual(panes);

    engine.setCrosshairPosition(11, 1_700_000_060, line);
    scheduler.flush();
    const shot2 = engine.takeScreenshot();
    const withXh = ctxOf(shot2)!.__calls.filter((c) => c.method === "drawImage");
    expect(withXh).toHaveLength(3);
    expect(withXh[2].args[0]).toBe(overlay);
    engine.destroy();
  });

  it("no-colour render uses CANVAS_NEUTRAL_DEFAULTS entries, never invented directional colours", () => {
    const { engine, scheduler } = mount({
      grid: { vertLines: { visible: true }, horzLines: { visible: true } },
    });
    const s = engine.addSeries("line");
    s.setData([{ time: 1, value: 1 }, { time: 2, value: 2 }]);
    scheduler.flush();
    const used = paneCtx(engine).__calls
      .filter((c) => c.method === "set:strokeStyle" || c.method === "set:fillStyle")
      .map((c) => c.args[0]);
    // The last-value label paints a default colour as its normalised rgb() background with a
    // black/white text colour picked by luminance (LWC generateContrastColors) — still a default.
    const defaults: string[] = Object.values(CANVAS_NEUTRAL_DEFAULTS);
    const allowed = [
      ...defaults,
      ...defaults.map((d) => contrastColors(d)?.background).filter((b): b is string => !!b),
      "black",
      "white",
    ];
    for (const color of used) {
      if (typeof color !== "string") continue;
      if (color === "" || color === "#fff" || color === "#000") continue;
      expect(allowed).toContain(color);
    }
    engine.destroy();

    const { engine: e2, scheduler: sch2 } = mount();
    const c = e2.addSeries("candles");
    c.setData(OHLC);
    sch2.flush();
    const candleFills = paneCtx(e2).__calls.filter((c0) => c0.method === "set:fillStyle").map((c0) => c0.args[0]);
    expect(candleFills).not.toContain("#26a69a");
    expect(candleFills).not.toContain("#ef5350");
    expect(candleFills).not.toContain("#4caf50");
    expect(candleFills).not.toContain("#f44336");
    e2.destroy();
  });

  it("a candle series with only `color` uses that colour; no up/down is invented", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("candles", { color: "series-only" });
    s.setData(OHLC);
    scheduler.flush();
    const fills = paneCtx(engine).__calls.filter((c) => c.method === "set:fillStyle").map((c) => c.args[0]);
    expect(fills).toContain("series-only");
    expect(fills).not.toContain("#26a69a");
    expect(fills).not.toContain("#ef5350");
    engine.destroy();
  });

  it("crosshair param.time is undefined past the last bar; logical and point stay set", () => {
    // No price strip: the clientX positions below assume the plot spans the full 200 px.
    const { engine, scheduler } = mount({ rightPriceScale: { visible: false } });
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    s.setData(OHLC);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 10 });
    scheduler.flush();
    const seen: Array<{ time?: unknown; logical?: unknown; point?: unknown }> = [];
    engine.subscribeCrosshairMove((p) => seen.push({ time: p.time, logical: p.logical, point: p.point }));
    const overlay = engine.chartElement().querySelector("canvas[data-mm-overlay]") as HTMLCanvasElement;
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() { return {}; },
    } as DOMRect);
    overlay.dispatchEvent(new MouseEvent("mousemove", { clientX: 150, clientY: 20 }));
    expect(seen.length).toBeGreaterThan(0);
    const last = seen[seen.length - 1];
    expect(last.time).toBeUndefined();
    expect(typeof last.logical).toBe("number");
    expect(last.point).toEqual({ x: 150, y: 20 });
    overlay.dispatchEvent(new MouseEvent("mousemove", { clientX: 30, clientY: 20 }));
    const over = seen[seen.length - 1];
    expect(over.time).toBe(OHLC[1].time);
    engine.destroy();
  });

  it("timeVisible false vs true produces different time-axis label text for an intraday series", () => {
    const { engine, scheduler } = mount({ timeScale: { timeVisible: true } });
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    s.setData(OHLC);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 3 });
    scheduler.flush();
    const ctxT = paneCtx(engine);
    const textsTrue = ctxT.__calls.filter((c) => c.method === "fillText").map((c) => String(c.args[0]));
    ctxT.__calls.length = 0;
    engine.applyOptions({ timeScale: { timeVisible: false } });
    scheduler.flush();
    const textsFalse = ctxT.__calls.filter((c) => c.method === "fillText").map((c) => String(c.args[0]));
    expect(textsTrue.join("|")).not.toEqual(textsFalse.join("|"));
    engine.destroy();
  });

  it("secondsVisible true vs false produces different time-axis label text for an intraday series", () => {
    const { engine, scheduler } = mount({ timeScale: { timeVisible: true, secondsVisible: false } });
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    s.setData(OHLC);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 3 });
    scheduler.flush();
    const ctxS = paneCtx(engine);
    const without = ctxS.__calls.filter((c) => c.method === "fillText").map((c) => String(c.args[0]));
    ctxS.__calls.length = 0;
    engine.applyOptions({ timeScale: { timeVisible: true, secondsVisible: true } });
    scheduler.flush();
    const withSec = ctxS.__calls.filter((c) => c.method === "fillText").map((c) => String(c.args[0]));
    expect(without.join("|")).not.toEqual(withSec.join("|"));
    engine.destroy();
  });
});

describe("assertEnginePrimitive", () => {
  function valid(): EnginePrimitive {
    return {
      id: "ok",
      attached() { /* */ },
      detached() { /* */ },
      update() { /* */ },
    };
  }

  it("accepts a valid primitive and refuses null, {}, a function, and a missing-update object", () => {
    expect(() => assertEnginePrimitive(valid())).not.toThrow();
    expect(() => assertEnginePrimitive(null)).toThrow(EngineRefusalError);
    expect(() => assertEnginePrimitive({})).toThrow(EngineRefusalError);
    expect(() => assertEnginePrimitive(() => undefined)).toThrow(EngineRefusalError);
    expect(() => assertEnginePrimitive({
      id: "x",
      attached() { /* */ },
      detached() { /* */ },
    })).toThrow(EngineRefusalError);
    try {
      assertEnginePrimitive({ id: "x", attached() { /* */ }, detached() { /* */ } });
    } catch (err) {
      expect(err).toBeInstanceOf(EngineRefusalError);
      expect((err as EngineRefusalError).unsupported).toContain("update");
      expect((err as EngineRefusalError).reason).toMatch(/not an EnginePrimitive/);
    }
  });
});

describe("CANVAS_CAPABILITIES equals probed paint path", () => {
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

  function mount() {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, { width: 200, height: 100, devicePixelRatio: 1, scheduler });
    return { engine, scheduler };
  }

  function probeBoolean(key: string): boolean {
    if (key === "kineticScroll") {
      try {
        createCanvasEngine(container, { width: 40, height: 20, kineticScroll: { touch: true } });
        return true;
      } catch {
        return false;
      }
    }
    const { engine, scheduler } = mount();
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    s.setData(OHLC);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 3 });
    let ok = false;
    if (key === "watermark") {
      engine.setWatermark(0, { visible: true, lines: [{ text: "WMARK", color: "#fff" }] });
      scheduler.flush();
      const texts = paneCtxText(engine);
      ok = texts.some((t) => t.includes("WMARK"));
    } else if (key === "markers") {
      s.setMarkers([{ time: OHLC[1].time, position: "inBar", shape: "square", color: "mk" }]);
      scheduler.flush();
      const pane = engine.chartElement().querySelector("canvas[data-mm-pane-canvas]") as HTMLCanvasElement;
      const x = engine.timeScale().logicalToCoordinate(1);
      const calls = ctxOf(pane)!.__calls;
      const fills = calls.filter((c) => c.method === "set:fillStyle").map((c) => c.args[0]);
      const rects = calls.filter((c) => c.method === "rect");
      ok = fills.includes("mk") && x != null && rects.some((c) => Math.abs(Number(c.args[0]) + Number(c.args[2]) / 2 - x) < 8);
    } else if (key === "primitives") {
      let painted = false;
      const prim: EnginePrimitive = {
        id: "cap",
        attached() { /* */ },
        detached() { /* */ },
        update() { /* */ },
        paint(_ctx, proj: EngineProjection) {
          painted = typeof proj.xOfLogical === "function";
        },
      };
      s.attachPrimitive(prim);
      scheduler.flush();
      ok = painted;
    } else if (key === "screenshot") {
      scheduler.flush();
      const shot = engine.takeScreenshot();
      const panes = [...engine.chartElement().querySelectorAll("canvas[data-mm-pane-canvas]")];
      const draws = ctxOf(shot)?.__calls.filter((c) => c.method === "drawImage") ?? [];
      ok = shot instanceof HTMLCanvasElement && draws.length === panes.length;
    }
    engine.destroy();
    return ok;
  }

  function paneCtxText(engine: ReturnType<typeof createCanvasEngine>): string[] {
    const pane = engine.chartElement().querySelector("canvas[data-mm-pane-canvas]") as HTMLCanvasElement;
    return (ctxOf(pane)?.__calls ?? []).filter((c) => c.method === "fillText").map((c) => String(c.args[0]));
  }

  it("every advertised key matches a real paint-path probe", () => {
    const caps = CANVAS_CAPABILITIES as Record<string, unknown>;
    for (const key of Object.keys(caps)) {
      const advertised = caps[key];
      if (typeof advertised === "boolean") {
        expect(advertised, key).toBe(probeBoolean(key));
      } else if (key === "seriesKinds") {
        const kinds = advertised as readonly EngineSeriesKind[];
        for (const kind of kinds) {
          const { engine, scheduler } = mount();
          const opts = kind === "candles" || kind === "bars" || kind === "histogram"
            ? { upColor: "up-body", downColor: "down-body", color: "line" }
            : { color: "line", lineColor: "line", topColor: "top", bottomColor: "bot" };
          const s = engine.addSeries(kind, opts);
          if (kind === "candles" || kind === "bars") s.setData(OHLC);
          else if (kind === "histogram") s.setData([{ time: 1, value: 10 }, { time: 2, value: -4 }, { time: 3, value: 12 }]);
          else s.setData([{ time: 1, value: 10 }, { time: 2, value: 8 }, { time: 3, value: 12 }]);
          scheduler.flush();
          const pane = engine.chartElement().querySelector("canvas[data-mm-pane-canvas]") as HTMLCanvasElement;
          const calls = ctxOf(pane)!.__calls;
          if (kind === "candles" || kind === "histogram") {
            const fills = calls.filter((c) => c.method === "set:fillStyle").map((c) => c.args[0]);
            expect(fills, kind).toContain("up-body");
            expect(fills, kind).toContain("down-body");
          } else {
            expect(calls.some((c) => c.method === "stroke" || c.method === "fill"), kind).toBe(true);
          }
          engine.destroy();
        }
      } else if (key === "priceScaleModes") {
        const modes = advertised as readonly string[];
        for (const mode of modes) {
          const { engine, scheduler } = mount();
          const s = engine.addSeries("line", { color: "line" });
          s.setData([{ time: 1, value: 10 }, { time: 2, value: 20 }]);
          s.priceScale().applyOptions({ mode });
          const pane = engine.chartElement().querySelector("canvas[data-mm-pane-canvas]") as HTMLCanvasElement;
          const n0 = ctxOf(pane)!.__calls.length;
          scheduler.flush();
          expect(ctxOf(pane)!.__calls.length, `mode ${mode}`).toBeGreaterThan(n0);
          engine.destroy();
        }
      }
    }
  });
});
