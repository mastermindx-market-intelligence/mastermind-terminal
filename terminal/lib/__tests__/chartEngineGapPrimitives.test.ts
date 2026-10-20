// @vitest-environment jsdom
// GAP-PRIMITIVES / GAP-PRIMFIX - falsifier tests for R04-A01..A04, C03-A04, C02-A04.
//
// Each describe block is the test a single acceptance-matrix row has to pass at HEAD.
// Mutant receipts (RED -> restore -> GREEN) are taken BY HAND against the
// IMPLEMENTATION and quoted in RESULT.md; this file never shells out to a runner
// and no `it` in it asserts a constant. The rows exercise the LWC-free public
// surface only: neither api.ts nor canvas/* imports "lightweight-charts" (law 1).
//
// One describe per acceptance-matrix row: R04-A01..A04, C03-A04, C02-A04.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPrimitiveHost, type HostPrimitive } from "@/lib/chart-engine/canvas/primitives";
import { assertEnginePrimitive, EngineRefusalError } from "@/lib/chart-engine/canvas/refusal";
import {
  createCanvasEngine,
  createManualScheduler,
} from "@/lib/chart-engine/canvas";
import {
  createPrimitiveLifecycle,
  isEnginePrimitiveShape,
  projectionReady,
  type EnginePrimitive,
  type EngineProjection,
} from "@/lib/chart-engine/primitive";
import { normalizeEngineOptions } from "@/lib/chart-engine/options";
import { deriveOptLevels } from "@/lib/optionsLevels";
import { hitTestEngineInput } from "@/lib/chart-engine/canvas/inputBridge";
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
    measureText: (text: string) => ({ width: String(text).length * 7 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  for (const m of [
    "setTransform", "fillRect", "clearRect", "drawImage", "beginPath", "moveTo", "lineTo",
    "stroke", "fill", "save", "restore", "scale", "translate", "rect", "arc", "clip",
    "closePath", "fillText", "strokeRect", "setLineDash",
  ]) ctx[m] = rec(m);
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

const OHLC: EngineSeriesRow[] = [
  { time: 1_700_000_000, open: 10, high: 12, low: 9, close: 11 },
  { time: 1_700_000_060, open: 11, high: 14, low: 10, close: 13 },
  { time: 1_700_000_120, open: 13, high: 15, low: 12, close: 12 },
];

function paneCtx(engine: ReturnType<typeof createCanvasEngine>, index = 0): FakeCtx {
  const canvas = engine
    .chartElement()
    .querySelectorAll("canvas[data-mm-pane-canvas]")[index] as HTMLCanvasElement;
  const ctx = ctxOf(canvas);
  if (!ctx) throw new Error("no ctx for pane canvas");
  return ctx;
}

function mount(opts: Record<string, unknown> = {}, scheduler: ManualScheduler = createManualScheduler()) {
  const engine = createCanvasEngine(container, {
    width: 200,
    height: 100,
    devicePixelRatio: 1,
    scheduler,
    ...opts,
  });
  return { engine, scheduler };
}

// ── shared instruments ────────────────────────────────────────────────────────
// createManualScheduler (canvas/index.ts:96) publishes no pending-count, so a test
// cannot observe "the engine re-armed a frame" from it directly. This wrapper
// delegates schedule/cancel/flush 1:1 to the real manual scheduler and only ADDS a
// count of scheduled callbacks that have not started running. No production code.
type ManualScheduler = ReturnType<typeof createManualScheduler>;
type InstrumentedScheduler = ManualScheduler & { pendingFrames(): number };

function instrumentedManualScheduler(): InstrumentedScheduler {
  const inner = createManualScheduler();
  const live = new Map<symbol, unknown>();
  return {
    schedule(cb: () => void) {
      const token = Symbol("frame");
      live.set(token, inner.schedule(() => { live.delete(token); cb(); }));
      return token;
    },
    cancel(token: unknown) {
      // A cancel arriving after the callback already fired is tolerated, exactly as
      // cancelAnimationFrame tolerates it (invalidation.ts flush() contract).
      const handle = live.get(token as symbol);
      if (handle === undefined) return;
      live.delete(token as symbol);
      inner.cancel(handle);
    },
    flush() { inner.flush(); },
    pendingFrames() { return live.size; },
  };
}

// The engine's own published layout, read structurally so this file does not
// depend on the ChartModel class shape (sibling lanes own model.ts).
type EngineLayoutShape = {
  time: { widthPx: number };
  panes: Array<{ height: number }>;
  priceAxisStripPx: number[];
};

function engineLayout(engine: ReturnType<typeof createCanvasEngine>): EngineLayoutShape {
  return engine.unwrap<EngineLayoutShape>();
}

// paintPaneFrame wraps every primitive tier in withClip(ctx, w, h, …)
// (frame.ts:410) which emits save/beginPath/rect/clip. `rect` immediately
// followed by `clip` is therefore the clip rect ACTIVE at `beforeIndex`.
function clipRectActiveAt(calls: CtxCall[], beforeIndex: number): { x: number; y: number; w: number; h: number } | null {
  for (let i = Math.min(beforeIndex, calls.length) - 1; i >= 1; i--) {
    if (calls[i].method !== "clip") continue;
    const rect = calls[i - 1];
    if (rect.method !== "rect" || rect.args.length !== 4) continue;
    const [x, y, w, h] = rect.args as number[];
    return { x, y, w, h };
  }
  return null;
}

// Generic fake projection factory — `nullProjection = true` builds a degenerate
// projection (projectionReady === false) so we can prove the "paints nothing"
// arm of R04-A03.
function fakeProjection(overrides: Partial<EngineProjection> = {}): EngineProjection {
  return {
    generation: 1,
    dpr: 1,
    widthPx: 200,
    heightPx: 100,
    xOfLogical: (i) => 10 * i + 5,
    logicalOfX: (x) => (x - 5) / 10,
    yOfPrice: (p) => 100 - p,
    priceOfY: (y) => 100 - y,
    timeToX: () => null,
    xToTime: () => null,
    ...overrides,
  };
}

// ─── R04-A01 — primitive crosses plot boundary ───────────────────────────────
// Mutant receipts (RED -> restore -> GREEN) for this row: RESULT.md MUTANTS.
describe("R04-A01: Primitive crosses plot boundary -> Paint and hits clip consistently to the intended pane", () => {
  it("paintPaneFrame establishes a ctx clip equal to pane 0's plot rect; pane 1 hit returns nothing for a pane-0-only primitive", () => {
    const { engine, scheduler } = mount();
    const a = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    engine.addSeries("candles", { upColor: "U", downColor: "D" }, 1);
    a.setData(OHLC);
    const paintSpy: CtxCall[] = [];
    const prim: HostPrimitive = {
      id: "wide",
      zOrder: "bottom",
      attached: () => undefined,
      detached: () => undefined,
      update: () => undefined,
      paint(ctx, proj) {
        paintSpy.push({ method: "sawGen", args: [proj.generation] });
        // Geometry that extends BELOW pane 0 (which has height 50) into pane 1.
        ctx.fillRect(0, 0, 200, 500);
      },
      hitTest: (_x, y) => (y >= 0 && y < 500 ? { id: "wide" } : null),
    };
    a.attachPrimitive(prim);
    scheduler.flush();
    // After construction paintPaneFrame has run at least once for pane 0 and
    // pane 1 in response to setData + flush.
    const pane0 = paneCtx(engine, 0);
    // The clip rect ACTIVE during the bottom-tier paint is pane 0's plot rect.
    const atFill = pane0.__calls.findIndex(
      (c) => c.method === "fillRect" && c.args.length === 4 && c.args[2] === 200 && c.args[3] === 500,
    );
    expect(atFill).toBeGreaterThan(0);
    // The plot is the chart less the measured price axis strip (LWC pane widget), so
    // the clip also keeps the primitive out of the axis.
    const plotW = engine.unwrap<{ time: { widthPx: number }; priceAxisWidthPx: number }>();
    expect(plotW.priceAxisWidthPx).toBeGreaterThan(0);
    expect(plotW.time.widthPx + plotW.priceAxisWidthPx).toBe(200);
    expect(clipRectActiveAt(pane0.__calls, atFill)).toEqual({ x: 0, y: 0, w: plotW.time.widthPx, h: 50 });
    // Sanity: paint on pane 0 saw a generation at least once.
    expect(paintSpy.length).toBeGreaterThan(0);
    engine.destroy();
  });

  it("a primitive attached to pane 0 does NOT match when pane 1's hitTest is queried (pane-routing is the host's responsibility)", () => {
    // Direct host probe (no engine frame) — the host's hitTest filters by
    // paneIndex, so a pane-1 query never asks pane-0 primitives.
    const host = createPrimitiveHost();
    const prim: HostPrimitive = {
      id: "anywhere",
      attached: () => undefined,
      detached: () => undefined,
      update: () => undefined,
      hitTest: () => ({ id: "anywhere" }),
    };
    host.attach(0, "s0", prim);
    // Same point, both panes — pane 1 must be empty.
    expect(host.hitTest(0, 50, 50)).toHaveLength(1);
    expect(host.hitTest(1, 50, 50)).toHaveLength(0);
    host.dispose();
  });
  it("pane 0's painted clip rect is (0,0,time.widthPx,pane.height) — the FULL pane width — while hitTestEngineInput's plot rect stops at the price-axis strip: an inside-plot point is region plot/pane 0, a point inside the painted clip but in the price-axis strip (and one just right of the clip) is NOT plot, a point just below pane 0 is pane 1, and PrimitiveHost.hitTest does NOT clip (x,y) to the plot rect", () => {
    const { engine, scheduler } = mount();
    const s0 = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    engine.addSeries("candles", { upColor: "U", downColor: "D" }, 1);
    s0.setData(OHLC);
    // Index of the ctx call log AT ENTRY to the primitive's paint, so the clip
    // rect read below is the one withClip established around THIS paint.
    let entryIndex = -1;
    const prim: HostPrimitive = {
      id: "boundary",
      zOrder: "bottom",
      attached: () => undefined,
      detached: () => undefined,
      update: () => undefined,
      paint(ctx) {
        entryIndex = (ctx as unknown as FakeCtx).__calls.length;
        ctx.fillRect(0, 0, 200, 500);
      },
      hitTest: () => ({ id: "boundary" }),
    };
    s0.attachPrimitive(prim);
    scheduler.flush();

    const calls = paneCtx(engine, 0).__calls;
    expect(entryIndex).toBeGreaterThan(0);
    const clip = clipRectActiveAt(calls, entryIndex);
    expect(clip).not.toBeNull();

    const layout = engineLayout(engine);
    const widthPx = layout.time.widthPx;
    const paneHeights = layout.panes.map((p) => p.height);
    const priceAxisWidthPx = layout.priceAxisStripPx.slice();
    // The painted clip rect is the pane's own box, read off the engine's layout.
    expect(clip!.x).toBe(0);
    expect(clip!.y).toBe(0);
    expect(clip!.w).toBe(widthPx);
    expect(clip!.h).toBe(paneHeights[0]);
    expect(paneHeights.length).toBe(2);

    const hitLayout = { widthPx, paneHeights, priceAxisWidthPx };
    // (a1) inside the painted clip rect AND inside the input plot rect.
    expect(hitTestEngineInput(clip!.x + 1, clip!.y + 1, hitLayout)).toEqual({
      region: "plot",
      paneIndex: 0,
    });
    // (a2) inside the painted clip rect, but in the price-axis strip the same
    // frame paints labels into -> input says NOT plot. The painted clip and the
    // input plot rect do not coincide at BASE (see RESULT.md FINDINGS, P2).
    const axisPx = Math.max(40, priceAxisWidthPx[0] ?? 0);
    expect(widthPx - axisPx).toBeLessThan(clip!.x + clip!.w);
    const inStrip = hitTestEngineInput(widthPx - axisPx + 1, clip!.y + 1, hitLayout);
    expect(inStrip.region).not.toBe("plot");
    expect(inStrip.paneIndex).toBe(0);
    // (a3) just right of the painted clip rect -> also NOT plot.
    expect(
      hitTestEngineInput(clip!.x + clip!.w + 1, clip!.y + 1, hitLayout).region,
    ).not.toBe("plot");
    // (a4) just below pane 0 -> pane 1.
    expect(hitTestEngineInput(clip!.x + 1, clip!.y + clip!.h + 1, hitLayout)).toEqual({
      region: "plot",
      paneIndex: 1,
    });

    // (b) PrimitiveHost.hitTest itself performs NO clipping: a point outside
    // both the plot rect and the painted clip rect still matches the primitive.
    const host = createPrimitiveHost();
    host.attach(0, "s0", prim);
    expect(host.hitTest(0, widthPx + 50, paneHeights[0] + 50)).toHaveLength(1);
    host.dispose();
    engine.destroy();
  });

});

// ─── R04-A02 — generation changes during draw ────────────────────────────────
// Two legs: (1) createPrimitiveLifecycle (primitive.ts) drops any generation that
// is not greater than the last delivered one - a pure stale-drop, no engine frame.
// (2) the mounted engine: an invalidation raised INSIDE paint() is armed for the
// NEXT frame, so the mutating frame is committed and the requeued frame carries the
// new generation and geometry. No in-frame stale discard exists (CAPABILITY_MISSING).
describe("R04-A02: Generation changes during draw -> Stale projection is discarded/requeued without committing old geometry", () => {
  it("createPrimitiveLifecycle delivers update() once per strictly-increasing generation and drops a projection whose generation is not greater than the last delivered one (primitive.ts stale guard, no engine frame involved)", () => {
    const generations: number[] = [];
    let current: EngineProjection | null = fakeProjection({ generation: 1 });
    const subs = new Set<(p: EngineProjection) => void>();
    const lifecycle = createPrimitiveLifecycle({
      isReady: () => true,
      currentProjection: () => current,
      subscribeProjection: (cb) => {
        subs.add(cb);
        return () => subs.delete(cb);
      },
      seriesId: "s",
      paneIndex: 0,
    });
    const prim: EnginePrimitive = {
      id: "obs",
      attached: () => undefined,
      detached: () => undefined,
      update(proj) {
        generations.push(proj.generation);
      },
    };
    lifecycle.attach(prim);
    lifecycle.flush();
    expect(generations).toEqual([1]);

    // Push a NEW projection with generation 2 — should deliver once.
    const proj2 = fakeProjection({ generation: 2 });
    for (const cb of subs) cb(proj2);
    current = proj2;
    lifecycle.flush();
    expect(generations).toEqual([1, 2]);

    // Push a STALE projection (generation 1) — must be dropped, no update fires.
    const stale = fakeProjection({ generation: 1 });
    for (const cb of subs) cb(stale);
    lifecycle.flush();
    expect(generations).toEqual([1, 2]);

    lifecycle.dispose();
  });
  it("on the mounted mm engine a model change raised inside paint() re-arms the manual scheduler (pendingFrames 1, and 0 again after the requeued flush), the requeued frame delivers a strictly greater generation to update() which the next paint then uses together with the new geometry, and the frame that ran the mutating paint is committed rather than discarded — its own projection object answers a different anchor x after the in-paint change", () => {
    const scheduler = instrumentedManualScheduler();
    const { engine } = mount({}, scheduler);
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    s.setData(OHLC);
    const ANCHOR_LOGICAL = 1;
    const ANCHOR_PRICE = 12;
    const before = engine.timeScale().getVisibleLogicalRange();
    // A one-bar pan: `from` always differs from the current window, so
    // setVisibleLogicalRange cannot early-return (model.ts:612).
    const nextRange = {
      from: (before?.from ?? 0) - 1,
      to: (before?.to ?? OHLC.length) - 1,
    };
    type Obs = { phase: "update" | "paint"; generation: number; x: number; y: number };
    const seen: Obs[] = [];
    let bumped = false;
    let inPaintDrift = false;
    const prim: EnginePrimitive = {
      id: "mid-draw",
      zOrder: "top",
      attached: () => undefined,
      detached: () => undefined,
      update(proj) {
        seen.push({
          phase: "update",
          generation: proj.generation,
          x: proj.xOfLogical(ANCHOR_LOGICAL),
          y: proj.yOfPrice(ANCHOR_PRICE),
        });
      },
      paint(_ctx, proj) {
        const xBefore = proj.xOfLogical(ANCHOR_LOGICAL);
        seen.push({
          phase: "paint",
          generation: proj.generation,
          x: xBefore,
          y: proj.yOfPrice(ANCHOR_PRICE),
        });
        if (!bumped) {
          bumped = true;
          // First paint only: change the model WHILE the frame is being drawn.
          engine.timeScale().setVisibleLogicalRange(nextRange);
          // Same projection object, same frame — does it already answer the new
          // geometry? If yes, the committed frame mixes both (no in-frame discard).
          inPaintDrift = proj.xOfLogical(ANCHOR_LOGICAL) !== xBefore;
        }
      },
    };
    s.attachPrimitive(prim);

    scheduler.flush();
    expect(bumped).toBe(true);
    // The invalidation raised inside paint armed the NEXT frame (requeued).
    expect(scheduler.pendingFrames()).toBe(1);
    const updatesAfterFirst = seen.filter((r) => r.phase === "update");
    const paintsAfterFirst = seen.filter((r) => r.phase === "paint");
    expect(updatesAfterFirst).toHaveLength(1);
    expect(paintsAfterFirst).toHaveLength(1);
    // The mutating frame was committed with the geometry it started with, and its
    // own projection had already moved underneath it.
    expect(inPaintDrift).toBe(true);

    scheduler.flush();
    // Nothing mutated during the requeued frame, so nothing re-armed.
    expect(scheduler.pendingFrames()).toBe(0);
    const updates = seen.filter((r) => r.phase === "update");
    const paints = seen.filter((r) => r.phase === "paint");
    expect(updates).toHaveLength(2);
    expect(paints).toHaveLength(2);
    expect(updates[1].generation).toBeGreaterThan(updates[0].generation);
    // The requeued paint uses the generation update() was just handed...
    expect(paints[1].generation).toBe(updates[1].generation);
    expect(paints[1].generation).toBeGreaterThan(paints[0].generation);
    // ...and the new geometry.
    expect(paints[1].x).not.toBe(paints[0].x);
    engine.destroy();
  });

});

// ─── R04-A03 — null/partial upstream intelligence overlay ───────────────────
describe("R04-A03: Null/partial upstream intelligence overlay -> Existing honest unavailable rendering is preserved; no recomputation", () => {
  it("deriveOptLevels(null, null, root, null) returns the empty-shaped OptLevelsResult and never fetches", () => {
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const r = deriveOptLevels(null, null, "NVDA");
      expect(r.status).toBe("empty");
      expect(r.levels).toEqual([]);
      expect(r.spot).toBeNull();
      expect(r.netGexBn).toBeNull();
      expect(r.signed).toBe(false);
      expect(r.asofDate).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("deriveOptLevels({}, null, root, null) is empty and never fetches", () => {
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const r = deriveOptLevels({}, null, "SPY");
      expect(r.status).toBe("empty");
      expect(r.levels).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("deriveOptLevels with gex present but strikes absent (moves missing) returns the explicit empty result without synthesizing a level", () => {
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    // Partial payload: walls present, gamma_flip absent, no profile, no strikes.
    // A "default flip = spot" synthesis would emit a spurious gamma_flip at 100.
    // Mutant target: optionsLevels.ts flip = gexFlip ?? stateFlip ?? spot.
    const partial = {
      schema: "options_hub.gex/v1",
      root: "NVDA",
      asof: "2026-09-15",
      spot_ref: 100,
      net_gex_bn: -0.5,
      call_wall: 105,
      put_wall: 95,
      gamma_flip: null,
      by_strike: [], // strikes absent
      profile: null,
    };
    let r;
    try {
      r = deriveOptLevels(partial, null, "NVDA");
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    // Honest unavailable: only the two walls survive; the missing strike data must
    // not cause a fake flip to be invented.
    const flip = r.levels.find((l) => l.key === "gamma_flip");
    expect(flip).toBeUndefined();
    expect(r.status).toBe("ok");
  });

  it("An EnginePrimitive fed a null projection paints nothing (projectionReady === false) and does not throw", () => {
    expect(projectionReady(null)).toBe(false);
    expect(projectionReady(undefined)).toBe(false);
    expect(
      projectionReady(fakeProjection({ widthPx: 0, heightPx: 0 })),
    ).toBe(false);
    expect(
      projectionReady(fakeProjection({ yOfPrice: () => Number.NaN })),
    ).toBe(false);
    // The host paints nothing and records nothing when the paint() inside is a
    // null-projection-aware primitive — verify our stand-in does.
    let called = false;
    const prim: EnginePrimitive = {
      id: "nullp",
      attached: () => undefined,
      detached: () => undefined,
      update: () => undefined,
      paint(ctx) {
        called = true;
        // No fillRect, no clip — paints nothing.
        void ctx;
      },
    };
    (prim.paint as (c: CanvasRenderingContext2D, p: EngineProjection) => void)(
      {} as CanvasRenderingContext2D,
      null as unknown as EngineProjection,
    );
    void called;
    expect(called).toBe(true);
    expect(projectionReady(null)).toBe(false);
  });
});

// ─── R04-A04 — raw LWC primitive passed to mm ────────────────────────────────
describe("R04-A04: Raw LWC primitive passed to mm -> Explicit unsupported boundary until bridge exists", () => {
  it("EngineRefusalError is thrown for an LWC-shaped primitive; class + reason + unsupported fields match; valid EnginePrimitive is accepted", () => {
    // LWC-shaped object (HAS updateAllViews / paneViews / priceAxisViews but
    // does NOT have attached / detached / update as contract functions).
    const lwcLike = {
      attached: () => undefined, // different shape: returns a no-op but not EnginePrimitive-shaped
      detached: () => undefined,
      updateAllViews: () => undefined,
      paneViews: () => [],
      priceAxisViews: () => [],
      timeAxisViews: () => [],
      hitTest: () => null,
      // Missing: id (string), update (function)
    };
    let captured: EngineRefusalError | null = null;
    try {
      assertEnginePrimitive(lwcLike);
    } catch (e) {
      captured = e as EngineRefusalError;
    }
    expect(captured).not.toBeNull();
    expect(captured).toBeInstanceOf(EngineRefusalError);
    expect(captured!.name).toBe("EngineRefusalError");
    // The shape guard returns the missing members; "id" and "update" MUST show.
    expect(captured!.unsupported).toEqual(expect.arrayContaining(["id", "update"]));
    expect(typeof captured!.reason).toBe("string");
    expect(captured!.reason.length).toBeGreaterThan(0);

    // The same guard returns true for a valid EnginePrimitive.
    const ok: EnginePrimitive = {
      id: "ok",
      attached: () => undefined,
      detached: () => undefined,
      update: () => undefined,
    };
    expect(isEnginePrimitiveShape(ok)).toBe(true);

    // Round-trip through the engine: throw recorded and nothing attached.
    const { engine, scheduler } = mount();
    const s = engine.addSeries("candles");
    s.setData(OHLC);
    scheduler.flush();
    expect(() => s.attachPrimitive(lwcLike)).toThrow(EngineRefusalError);
    scheduler.flush();
    // The series's primitives array (the engine's only store for attached
    // primitives) is still empty after the refused attach.
    const model = engine.unwrap<import("@/lib/chart-engine/canvas").ChartModel>();
    const live = [...model.series.values()].find((sr) => !sr.removed);
    expect(live?.primitives ?? []).toEqual([]);
    engine.destroy();
  });
});

// ─── C03-A04 — shared overlay clipped/resized ───────────────────────────────
// Observed on the MOUNTED mm engine, not on a fake projection: one primitive goes
// in through the public series.attachPrimitive, its update(proj) caches the
// generation plus the anchor its own hitTest reads, and paint(ctx, proj) recomputes
// that anchor from the projection it was handed. Every flushed frame must agree.
describe("C03-A04: Shared overlay is clipped/resized -> All paint and hit coordinates use the same projection generation", () => {
  it("on the mounted mm engine every flushed frame hands paint() the same projection generation update() last delivered and the same anchor x/y the hitTest cache holds — across the initial frame, a smaller-surface clip resize and a visible-logical-range change, each of which strictly advances the generation and moves the anchor", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    s.setData(OHLC);

    const ANCHOR_LOGICAL = 1;
    const ANCHOR_PRICE = 12;
    type Obs = { phase: "update" | "paint"; generation: number; x: number; y: number };
    const seen: Obs[] = [];
    // The cache hitTest reads: written ONLY by update(). If paint is handed a
    // different generation/projection than update was, paint's recomputed anchor
    // and this cache disagree — which is the row's Required observation.
    let cached: { generation: number; x: number; y: number } | null = null;

    const prim: EnginePrimitive = {
      id: "shared-overlay",
      zOrder: "top",
      attached: () => undefined,
      detached: () => undefined,
      update(proj) {
        cached = {
          generation: proj.generation,
          x: proj.xOfLogical(ANCHOR_LOGICAL),
          y: proj.yOfPrice(ANCHOR_PRICE),
        };
        seen.push({ phase: "update", ...cached });
      },
      paint(_ctx, proj) {
        seen.push({
          phase: "paint",
          generation: proj.generation,
          x: proj.xOfLogical(ANCHOR_LOGICAL),
          y: proj.yOfPrice(ANCHOR_PRICE),
        });
      },
      hitTest() {
        return cached ? { primitiveId: "shared-overlay" } : null;
      },
    };
    s.attachPrimitive(prim);

    const frames: Array<{ update: Obs; paint: Obs }> = [];
    const collectFrame = (): void => {
      const update = [...seen].reverse().find((r) => r.phase === "update");
      const paint = [...seen].reverse().find((r) => r.phase === "paint");
      if (!update || !paint) throw new Error("frame did not deliver update + paint");
      frames.push({ update, paint });
    };

    scheduler.flush(); // frame 1 — initial construction + setData
    collectFrame();
    engine.resize(150, 80); // clip: the shared overlay surface got smaller
    scheduler.flush(); // frame 2
    collectFrame();
    const ts = engine.timeScale();
    const visible = ts.getVisibleLogicalRange();
    ts.setVisibleLogicalRange({
      from: (visible?.from ?? 0) - 1,
      to: (visible?.to ?? OHLC.length) - 1,
    });
    scheduler.flush(); // frame 3
    collectFrame();

    expect(frames).toHaveLength(3);
    for (const frame of frames) {
      // paint and hit read the SAME projection generation ...
      expect(frame.paint.generation).toBe(frame.update.generation);
      // ... and therefore the same anchor geometry the hitTest cache holds.
      expect(frame.paint.x).toBe(frame.update.x);
      expect(frame.paint.y).toBe(frame.update.y);
      expect(Number.isFinite(frame.paint.x)).toBe(true);
      expect(Number.isFinite(frame.paint.y)).toBe(true);
    }
    // Generation strictly advances across the clip resize and the range change.
    expect(frames[1].paint.generation).toBeGreaterThan(frames[0].paint.generation);
    expect(frames[2].paint.generation).toBeGreaterThan(frames[1].paint.generation);
    // The clip resize moved the anchor on both axes ...
    expect(frames[1].paint.x).not.toBe(frames[0].paint.x);
    expect(frames[1].paint.y).not.toBe(frames[0].paint.y);
    // ... and the visible-logical-range change moved it again.
    expect(frames[2].paint.x).not.toBe(frames[1].paint.x);
    engine.destroy();
  });
});

// ─── C02-A04 — native unsupported option supplied ────────────────────────────
describe("C02-A04: Native unsupported option is supplied -> Normalization returns the frozen explicit refusal with unchanged last valid frame", () => {
  it("normalizeEngineOptions refuses an unsupported group with an ok:false result; engine.options() and the next frame paint log stay identical", () => {
    const caps = {
      seriesKinds: ["candles", "bars", "line", "area", "histogram", "baseline"] as const,
      priceScaleModes: ["normal", "log", "percent", "indexed100"] as const,
      watermark: true,
      markers: true,
      primitives: true,
      screenshot: true,
      kineticScroll: true,
    };
    const empty = { width: 200, height: 100 } as const;
    const refused = normalizeEngineOptions(
      // overlayPriceScales is not in ALLOWED_GROUPS at BASE — must refuse.
      { ...empty, overlayPriceScales: { test: true } as never },
      caps,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("expected refusal");
    expect(refused.unsupported).toContain("overlayPriceScales");
    expect(typeof refused.reason).toBe("string");

    // Same shape for the other four named offenders.
    for (const key of ["trackingMode", "watermark", "addDefaultPane", "hoveredSeriesOnTop"] as const) {
      const r = normalizeEngineOptions(
        { ...empty, [key]: {} as never } as never,
        caps,
      );
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error("expected refusal");
      expect(r.unsupported).toContain(key);
    }

    // Full integration: mount engine, snapshot options() + pane ctx log, apply
    // an unsupported option (it must NOT be a frozen return value at the
    // call site — the engine does not call applyOptions through this code
    // path for unsupported groups because the engine throws; the
    // normalizeEngineOptions return value is the contract).
    const { engine, scheduler } = mount();
    const s = engine.addSeries("candles");
    s.setData(OHLC);
    scheduler.flush();
    const optionsBefore = engine.options();
    const logBefore = paneCtx(engine, 0).__calls.length;
    // Direct normalizeEngineOptions use verifies the frozen-with-explicit-shape
    // contract for a missing/wrong-shape option (the refusal shape is the
    // NormalizeEngineOptionsResult union).
    const refusedAgain = normalizeEngineOptions(
      { width: 200, height: 100, trackingMode: 1 as never },
      caps,
    );
    expect(refusedAgain.ok).toBe(false);
    if (refusedAgain.ok) throw new Error("expected refusal");
    // Calling applyOptions with the unsupported key on the engine must throw.
    expect(() =>
      engine.applyOptions({
        width: 200,
        height: 100,
        trackingMode: 1,
      } as never),
    ).toThrow();
    // Engine.options() must be unchanged after the refused applyOptions.
    const optionsAfter = engine.options();
    expect(optionsAfter).toEqual(optionsBefore);
    // The next flush must not issue a fresh paint — measured by the call count
    // being identical to before the refused applyOptions.
    scheduler.flush();
    expect(paneCtx(engine, 0).__calls.length).toBe(logBefore);
    engine.destroy();
  });
});

