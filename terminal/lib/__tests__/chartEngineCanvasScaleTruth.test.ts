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
