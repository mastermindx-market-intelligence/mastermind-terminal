// @vitest-environment jsdom
// INTEGRATE3 G1/G2: stack-safe autoscale and one price-scale truth for paint vs
// series.priceToCoordinate. Recording fake 2D context matches chartEngineCanvasPaint.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCanvasEngine,
  createManualScheduler,
} from "@/lib/chart-engine/canvas";
import type { EngineSeriesRow } from "@/lib/chart-engine/api";

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

describe("canvas autoscale stack safety (G1)", () => {
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

  it("fitContent of 40,000 candles yields a finite priceToCoordinate and paints", () => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 200,
      height: 100,
      devicePixelRatio: 1,
      scheduler,
    });
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    const rows: EngineSeriesRow[] = [];
    for (let i = 0; i < 40_000; i++) {
      const close = 10 + (i % 7);
      rows.push({ time: 1_700_000_000 + i, open: 10, high: 18, low: 8, close });
    }
    s.setData(rows);
    engine.timeScale().fitContent();
    const y = s.priceToCoordinate(16);
    expect(y).not.toBeNull();
    expect(Number.isFinite(y!)).toBe(true);
    expect(() => scheduler.flush()).not.toThrow();
    const pane = engine.chartElement().querySelector("canvas[data-mm-pane-canvas]") as HTMLCanvasElement;
    expect((ctxOf(pane)?.__calls.length ?? 0)).toBeGreaterThan(0);
    engine.destroy();
  });
});

const CANDLES: EngineSeriesRow[] = [
  { time: 1_700_000_000, open: 10, high: 12, low: 9, close: 11 },
  { time: 1_700_000_060, open: 11, high: 20, low: 10, close: 18 },
  { time: 1_700_000_120, open: 18, high: 19, low: 14, close: 15 },
];

const KNOWN_INDEX = 1;
const KNOWN_CLOSE = 18;

function bodyRects(calls: CtxCall[], color: string): Array<{ x: number; y: number; w: number; h: number }> {
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  let armed = false;
  for (const c of calls) {
    if (c.method === "set:fillStyle") armed = c.args[0] === color;
    else if (armed && c.method === "rect") {
      out.push({
        x: Number(c.args[0]),
        y: Number(c.args[1]),
        w: Number(c.args[2]),
        h: Number(c.args[3]),
      });
    }
  }
  return out;
}

function paintedCloseY(calls: CtxCall[], color: string, xCss: number): number | null {
  let best: { y: number; dist: number } | null = null;
  for (const r of bodyRects(calls, color)) {
    const cx = r.x + r.w / 2;
    const dist = Math.abs(cx - xCss);
    if (best == null || dist < best.dist) {
      best = { y: r.y, dist };
      // close > open on this candle, so the body top (smaller y) is close
      best.y = r.y;
    }
  }
  return best && best.dist < 8 ? best.y : null;
}

describe("one autoscale truth (G2)", () => {
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

  const MODES = ["normal", "log", "percent", "indexed100"] as const;

  it.each(MODES)("painted close y matches priceToCoordinate in %s mode within 1 CSS px", (mode) => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 240,
      height: 200,
      devicePixelRatio: 1,
      scheduler,
    });
    const s = engine.addSeries("candles", { upColor: "up-body", downColor: "down-body" });
    s.setData(CANDLES);
    s.priceScale().applyOptions({ mode });
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 3 });
    scheduler.flush();
    const yCoord = s.priceToCoordinate(KNOWN_CLOSE);
    expect(yCoord).not.toBeNull();
    expect(Number.isFinite(yCoord!)).toBe(true);
    const pane = engine.chartElement().querySelector("canvas[data-mm-pane-canvas]") as HTMLCanvasElement;
    const x = engine.timeScale().logicalToCoordinate(KNOWN_INDEX);
    expect(x).not.toBeNull();
    const painted = paintedCloseY(ctxOf(pane)!.__calls, "up-body", x!);
    expect(painted).not.toBeNull();
    expect(Math.abs(painted! - yCoord!)).toBeLessThanOrEqual(1);
    engine.destroy();
  });

  it("histogram with base 0 keeps 0 inside the autoscaled range", () => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 200,
      height: 100,
      devicePixelRatio: 1,
      scheduler,
    });
    const s = engine.addSeries("histogram", { upColor: "U", downColor: "D", base: 0 });
    s.setData([
      { time: 1, value: 4 },
      { time: 2, value: 8 },
      { time: 3, value: 12 },
    ]);
    engine.timeScale().fitContent();
    scheduler.flush();
    const range = s.priceScale().getVisibleRange();
    expect(range).not.toBeNull();
    expect(range!.from).toBeLessThanOrEqual(0);
    expect(range!.to).toBeGreaterThanOrEqual(12);
    const y0 = s.priceToCoordinate(0);
    expect(y0).not.toBeNull();
    expect(Number.isFinite(y0!)).toBe(true);
    engine.destroy();
  });
});
