// @vitest-environment jsdom
// P03 — session shading on the mm renderer. The mm SeriesHandle refuses an LWC
// ISeriesPrimitive, so ChartPanel attaches SessionShadingEnginePrimitive there. These
// tests pin the refusal, the engine overlay's acceptance and paint, and pixel parity
// with the LWC renderer on the same coordinate map.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCanvasEngine, createManualScheduler, EngineRefusalError } from "@/lib/chart-engine/canvas";
import { isEnginePrimitiveShape, type EngineProjection } from "@/lib/chart-engine/primitive";
import {
  AFTERHOURS_COLOR,
  PREMARKET_COLOR,
  SessionShadingPrimitive,
  detachSessionShadingFromHandle,
  type ShadingBar,
} from "@/lib/sessionShading";
import {
  SessionShadingEnginePrimitive,
  attachSessionShadingEngineToHandle,
  sessionShadingRuns,
} from "@/lib/sessionShadingEngine";

type Call = { method: string; args: unknown[] };
type FakeCtx = CanvasRenderingContext2D & { __calls: Call[] };

function makeFakeCtx(): FakeCtx {
  const calls: Call[] = [];
  const rec = (method: string) => (...args: unknown[]) => { calls.push({ method, args }); };
  const props: Record<string, unknown> = {};
  const ctx: Record<string, unknown> = { __calls: calls };
  for (const m of [
    "setTransform", "fillRect", "clearRect", "drawImage", "beginPath", "moveTo", "lineTo", "stroke",
    "fill", "save", "restore", "scale", "translate", "rect", "clip", "closePath", "fillText", "setLineDash",
    "strokeRect", "arc",
  ]) ctx[m] = rec(m);
  ctx.measureText = (text: string) => ({ width: String(text).length * 7 });
  ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  for (const p of ["fillStyle", "strokeStyle", "lineWidth", "font", "textAlign", "textBaseline", "globalAlpha"]) {
    Object.defineProperty(ctx, p, {
      get: () => props[p],
      set: (v: unknown) => { calls.push({ method: `set:${p}`, args: [v] }); props[p] = v; },
      enumerable: true,
      configurable: true,
    });
  }
  return ctx as unknown as FakeCtx;
}

/** fillRect calls with the fillStyle in force when each was made. */
function fills(ctx: FakeCtx): { color: unknown; rect: number[] }[] {
  let color: unknown;
  const out: { color: unknown; rect: number[] }[] = [];
  for (const c of ctx.__calls) {
    if (c.method === "set:fillStyle") color = c.args[0];
    else if (c.method === "fillRect") out.push({ color, rect: c.args as number[] });
  }
  return out;
}

// Midnight of a display-epoch day; minOfDay(t) = floor(t / 60) % 1440.
const DAY = 19_675 * 86_400;
const at = (minute: number): ShadingBar => ({ time: DAY + minute * 60, o: 1, h: 1, l: 1, c: 1, v: 1 });

// 04:00 → 20:00 every 30 minutes: premarket 04:00–09:00, RTH 09:30–15:30, after-hours 16:00–20:00.
const BARS: ShadingBar[] = Array.from({ length: 33 }, (_, i) => at(240 + i * 30));
const xOf = (t: number) => ((t - BARS[0].time) / 1800) * 10 + 5;

function projection(width: number, height: number, timeToX = (t: number): number | null => xOf(t)): EngineProjection {
  return {
    generation: 1, dpr: 1, widthPx: width, heightPx: height,
    xOfLogical: (i) => i * 10 + 5, logicalOfX: (x) => (x - 5) / 10,
    yOfPrice: (p) => 100 - p, priceOfY: (y) => 100 - y,
    timeToX: (t) => timeToX(t as number),
    xToTime: (x) => {
      const i = Math.round((x - 5) / 10);
      return i >= 0 && i < BARS.length ? BARS[i].time : null;
    },
  };
}

/** Drive the LWC renderer through a fake chart/series/target on the same map. */
function lwcFills(width: number, height: number): { color: unknown; rect: number[] }[] {
  const prim = new SessionShadingPrimitive(BARS);
  const chart = {
    timeScale: () => ({
      getVisibleLogicalRange: () => ({ from: 0, to: BARS.length - 1 }),
      timeToCoordinate: (t: number) => xOf(t),
    }),
  };
  const series = { barsInLogicalRange: () => ({ from: BARS[0].time, to: BARS[BARS.length - 1].time }) };
  prim.attached({ chart, series, requestUpdate: () => {} } as never);
  const ctx = makeFakeCtx();
  const target = {
    useMediaCoordinateSpace: (cb: (s: unknown) => void) =>
      cb({ context: ctx, mediaSize: { width, height } }),
  };
  const renderer = prim.paneViews()[0].renderer() as { drawBackground(t: unknown): void };
  renderer.drawBackground(target);
  return fills(ctx);
}

describe("sessionShadingRuns", () => {
  it("emits one padded run per premarket / after-hours stretch and skips RTH", () => {
    const runs = sessionShadingRuns(BARS, xOf, 1000);
    // premarket bars 0..10 (04:00–09:00), after-hours bars 24..32 (16:00–20:00), half-bar pad 5
    expect(runs).toEqual([
      { color: PREMARKET_COLOR, xLeft: 0, xRight: xOf(BARS[10].time) + 5 },
      { color: AFTERHOURS_COLOR, xLeft: xOf(BARS[24].time) - 5, xRight: xOf(BARS[32].time) + 5 },
    ]);
  });

  it("splits a run at a bar with no coordinate and clamps to the pane width", () => {
    const missing = BARS[5].time;
    const runs = sessionShadingRuns(BARS, (t) => (t === missing ? null : xOf(t)), 200);
    expect(runs.map((r) => r.color)).toEqual([PREMARKET_COLOR, PREMARKET_COLOR]);
    expect(runs[0].xRight).toBe(xOf(BARS[4].time) + 5);
    expect(runs[1].xLeft).toBe(xOf(BARS[6].time) - 5);
    // the after-hours run starts at x=240-5 > 200, so it clamps to nothing and is dropped
    expect(runs).toHaveLength(2);
  });
});

describe("SessionShadingEnginePrimitive", () => {
  it("is an EnginePrimitive painted in the bottom layer", () => {
    const prim = new SessionShadingEnginePrimitive(BARS);
    expect(isEnginePrimitiveShape(prim)).toBe(true);
    expect(prim.zOrder).toBe("bottom");
    expect(prim.id).not.toBe(new SessionShadingEnginePrimitive(BARS).id);
  });

  it("paints the same rects as the LWC renderer on the same coordinate map", () => {
    for (const width of [1000, 200]) {
      const ctx = makeFakeCtx();
      new SessionShadingEnginePrimitive(BARS).paint(ctx, projection(width, 80));
      const engine = fills(ctx);
      expect(engine.length).toBeGreaterThan(0);
      expect(engine).toEqual(lwcFills(width, 80));
    }
  });

  it("paints nothing without bars or pane extent", () => {
    const ctx = makeFakeCtx();
    new SessionShadingEnginePrimitive([]).paint(ctx, projection(400, 80));
    new SessionShadingEnginePrimitive(BARS).paint(ctx, projection(0, 80));
    new SessionShadingEnginePrimitive(BARS).paint(ctx, projection(400, 0));
    expect(fills(ctx)).toEqual([]);
  });

  it("updateBars repaints through the attach context and is silent once detached", () => {
    const prim = new SessionShadingEnginePrimitive([]);
    const requestUpdate = vi.fn();
    prim.attached({ requestUpdate, seriesId: "1", paneIndex: 0 });
    prim.updateBars(BARS);
    expect(requestUpdate).toHaveBeenCalledTimes(1);
    prim.detached();
    prim.updateBars([]);
    expect(requestUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("session shading on the mm canvas engine", () => {
  let container: HTMLDivElement;
  let contexts: FakeCtx[];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    contexts = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (type: string) {
      if (type !== "2d") return null;
      const ctx = makeFakeCtx();
      contexts.push(ctx);
      return ctx;
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  it("refuses the LWC primitive and paints the engine-neutral one", () => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, { width: 400, height: 120, devicePixelRatio: 1, scheduler });
    const s = engine.addSeries("line", { color: "#fff" });
    s.setData(BARS.map((b) => ({ time: b.time, value: b.c })));
    scheduler.flush();

    expect(() => s.attachPrimitive(new SessionShadingPrimitive(BARS))).toThrow(EngineRefusalError);

    const prim = attachSessionShadingEngineToHandle(s, BARS);
    scheduler.flush();
    const painted = contexts.flatMap(fills).map((f) => f.color);
    expect(painted).toContain(PREMARKET_COLOR);
    expect(painted).toContain(AFTERHOURS_COLOR);

    detachSessionShadingFromHandle(s, prim);
    for (const c of contexts) c.__calls.length = 0;
    s.setData(BARS.map((b) => ({ time: b.time, value: b.c + 1 })));
    scheduler.flush();
    const after = contexts.flatMap(fills).map((f) => f.color);
    expect(after).not.toContain(PREMARKET_COLOR);
    expect(after).not.toContain(AFTERHOURS_COLOR);
    engine.destroy();
  });
});
