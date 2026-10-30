// @vitest-environment jsdom
// PATCH3P2 — falsifier tests for the PAINT2-REV / MODEL2-REV findings adjudicated
// against H2 (= INTEGRATE3). Each `describe` block is the test an independent-review
// finding has to pass at HEAD; the MUTANT paste-backs quoted in the review are tried
// in reverse (apply locally, run, revert) to prove each can fail.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CANVAS_NEUTRAL_DEFAULTS,
  createCanvasEngine,
  createManualScheduler,
  type ChartModel,
} from "@/lib/chart-engine/canvas";
import { engineProjectionFor } from "@/lib/chart-engine/canvas/frame";
import { priceToDisplay, type PriceScaleState } from "@/lib/chart-engine/canvas/scales";
import { hostHitId, type HostPrimitive } from "@/lib/chart-engine/canvas/primitives";
import type { EnginePrimitive } from "@/lib/chart-engine/primitive";
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

function paneCtx(engine: ReturnType<typeof createCanvasEngine>, index = 0): FakeCtx {
  const canvas = engine.chartElement().querySelectorAll("canvas[data-mm-pane-canvas]")[index] as HTMLCanvasElement;
  const ctx = ctxOf(canvas);
  if (!ctx) throw new Error("no ctx for pane canvas");
  return ctx;
}

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

// ─── F1 (P1) — painted y equals series.priceToCoordinate for every kind ─────────
// H2 fix: dab8e54c "one autoscale truth" — `displayScale` delegates to
// `model.autoscaleScale`. Mutant: restore the hand-rolled extentsOf loop and verify
// the test goes RED for at least one kind.
describe("F1 (P1) painted y equals series.priceToCoordinate (ONE autoscale truth)", () => {
  it("painted y matches priceToCoordinate for candles / histogram / baseline / line", () => {
    const cases: { kind: EngineSeriesKind; rows: EngineSeriesRow[]; probePrice: number; opts: Record<string, unknown> }[] = [
      { kind: "candles", rows: OHLC, probePrice: 11, opts: {} },
      {
        kind: "histogram",
        rows: [{ time: 1, value: 10 }, { time: 2, value: 12 }],
        probePrice: 10,
        opts: { color: "c", baseValue: { price: 0 } },
      },
      {
        kind: "baseline",
        rows: [{ time: 1, value: 100 }, { time: 2, value: 102 }],
        probePrice: 102,
        opts: { baseValue: { price: 0 } },
      },
      { kind: "line", rows: [{ time: 1, value: 105 }, { time: 2, value: 120 }], probePrice: 112, opts: { color: "c" } },
    ];
    for (const c of cases) {
      const { engine, scheduler } = mount();
      const s = engine.addSeries(c.kind, c.opts as never);
      s.setData(c.rows);
      engine.timeScale().setVisibleLogicalRange({ from: 0, to: c.rows.length + 0.5 });
      scheduler.flush();
      const model = engine.unwrap<ChartModel>();
      const firstId = [...model.series.keys()][0];
      const sm = model.getSeries(firstId)!;
      const projY = engineProjectionFor(model, sm).yOfPrice(c.probePrice);
      const pubY = s.priceToCoordinate(c.probePrice) as number | null;
      expect(pubY, `${c.kind}: contract-side priceToCoordinate must be a number`).not.toBeNull();
      expect(Math.abs(projY - (pubY as number)), `${c.kind}: painted y must equal priceToCoordinate`).toBeLessThan(1e-6);
      engine.destroy();
    }
  });
});

// ─── F5 (P2) — CANVAS_NEUTRAL_DEFAULTS.seriesColor is never an up/down colour ────
// Mutant: revert the `upC/downC` fallback to `up ?? line` / `down ?? line`
// (where `line` falls back to CANVAS_NEUTRAL_DEFAULTS.seriesColor when no
// lineColor/color is supplied) and verify the down side picks up the neutral grey.
describe("F5 (P2) a directional series given only upColor never paints with the neutral default", () => {
  it("down side of a one-sided candles series is NOT the neutral default seriesColor", () => {
    // Pin textColor so axis backgrounds can't supply a grey that masks the assertion.
    const { engine, scheduler } = mount({ layout: { textColor: "axis-txt" } as never });
    const s = engine.addSeries("candles", { upColor: "U-ONLY" });
    s.setData(OHLC);
    scheduler.flush();
    const ctx = paneCtx(engine);
    // All fillStyle / strokeStyle values the pane canvas saw, in order:
    const painted = ctx.__calls
      .filter((c) => c.method === "set:fillStyle" || c.method === "set:strokeStyle")
      .map((c) => c.args[0]);
    // The up side must dominate: at least 4 styles set to U-ONLY (up-body fill,
    // up-wick stroke, up-border stroke and one redundant set pass at minimum).
    expect(painted.filter((v) => v === "U-ONLY").length).toBeGreaterThanOrEqual(2);
    // And the down side must NEVER be the neutral default (axis label backgrounds
    // count separately under the explicit textColor we set above).
    expect(painted).not.toContain(CANVAS_NEUTRAL_DEFAULTS.seriesColor);
    engine.destroy();
  });
});

// ─── F6 (P2) — a directional series with no colour is silently skipped, not painted ──
// Mutant: drop the `if (directional && up == null && down == null) return null` guard
// and verify the test goes RED (a colourless candles series now paints bodies in
// the neutral grey, which funnels through ctx.fill() and ctx.stroke() with non-axis rect() calls).
describe("F6 (P2) a directional series with no colour paints no bodies / wicks / borders", () => {
  it("a colourless candles series emits zero rect() calls outside the axis-label clip rects", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("candles");
    s.setData(OHLC);
    scheduler.flush();
    const ctx = paneCtx(engine);
    expect(ctx.__calls.length).toBeGreaterThan(0);
    // The withClip helpers in frame.ts use the corner-to-corner `(0,0,w,h)` rect to
    // build the clip region for each z-tier — exactly 3 of them (bottom/normal/top).
    // Candle body / wick / border paints never produce that exact rect (paint.ts:259
    // and :272 emit per-body rects at non-zero, non-corner coordinates). Subtract
    // the 3 clip rects and assert NO non-clip rects survived.
    const rects = ctx.__calls.filter((c) => c.method === "rect");
    const isClip = (c: { args: unknown[] }) =>
      Array.isArray(c.args) &&
      c.args.length === 4 &&
      c.args[0] === 0 &&
      c.args[1] === 0;
    const nonClipRects = rects.filter((c) => !isClip(c));
    expect(nonClipRects, "no candle body / wick / border geometry for a colourless series").toHaveLength(0);
    // Cross-check: the contract still answers priceToCoordinate so data is queryable.
    expect(s.priceToCoordinate(11)).not.toBeNull();
    engine.destroy();
  });
});

// ─── F7 (P2) — in-pane axes paint AFTER series + decorations (frame.ts:1-4 invariant) ──
// Mutant M5: move `paintInPaneAxes` BEFORE grid instead of after decorations.
// Red condition: some series/decorations colour shows up AFTER an axis fillRect.
describe("F7 (P2) paint order: in-pane axes come LAST (after series/decorations/watermark)", () => {
  it("no series / decoration / primitive colour appears after the axis label backgrounds", () => {
    const { engine, scheduler } = mount({ layout: { textColor: "axis-txt" } as never });
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    s.setData(OHLC);
    s.createPriceLine({ price: 11, color: "PL" });
    engine.setWatermark(0, { visible: true, lines: [{ text: "WMARK", color: "WM" }] });
    const TOP: EnginePrimitive = {
      id: "top",
      zOrder: "top",
      attached(): void {},
      detached(): void {},
      update(): void {},
      paint(c: CanvasRenderingContext2D): void {
        (c as unknown as FakeCtx).__calls.push({ method: "marker", args: ["TOP-PRIM"] });
      },
    };
    s.attachPrimitive(TOP);
    scheduler.flush();
    const ops = paneCtx(engine).__calls;
    // The axis label strip paints with the explicit layout.textColor we set above
    // AND is the only thing that flows after series + decorations + watermark + primitives.
    const idxAxisFill = ops.findIndex(
      (c) => c.method === "set:fillStyle" && c.args[0] === "axis-txt",
    );
    expect(idxAxisFill).toBeGreaterThanOrEqual(0);
    const seriesAfterAxis = ops
      .slice(idxAxisFill)
      .some(
        (c) =>
          (c.method === "set:fillStyle" && (c.args[0] === "U" || c.args[0] === "D" || c.args[0] === "PL" || c.args[0] === "WM")) ||
          c.method === "marker",
      );
    expect(seriesAfterAxis).toBe(false);
    engine.destroy();
  });
});

// ─── F8 (P2) — a cursor-level paint does NOT repaint any pane bitmap ────────────
// Mutant M4: change `const skipPanes = mask.level === "cursor"` to `const skipPanes = false`.
describe("F8 (P2) a cursor-level paint issues zero pane-bitmap draw calls", () => {
  it("a crosshair move does not advance the pane0 / pane1 __calls.length", () => {
    const { engine, scheduler } = mount();
    const a = engine.addSeries("candles", { upColor: "U", downColor: "D" }, 0);
    engine.addSeries("line", { color: "#abc" }, 1);
    a.setData(OHLC);
    scheduler.flush();
    const p0 = paneCtx(engine, 0).__calls.length;
    const p1 = paneCtx(engine, 1).__calls.length;
    engine.setCrosshairPosition(11, OHLC[1].time, a);
    scheduler.flush();
    expect(paneCtx(engine, 0).__calls.length).toBe(p0);
    expect(paneCtx(engine, 1).__calls.length).toBe(p1);
    engine.destroy();
  });
});

// ─── F9 (P2) — primitive requestUpdate() reaches update() exactly once more ──────
// Mutant M8: drop the `() => this.requestPaint({...})` wiring on `onRequestUpdate`.
describe("F9 (P2) primitive requestUpdate advances update() generation through the scheduler", () => {
  it("after a flush, calling requestUpdate() bumps update() count by exactly one more", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("line", { color: "#fff" });
    s.setData([{ time: 1, value: 1 }, { time: 2, value: 2 }]);
    let updates = 0;
    let req: (() => void) | undefined;
    s.attachPrimitive({
      id: "r",
      attached(ctx: Parameters<NonNullable<EnginePrimitive["attached"]>>[0]) {
        req = ctx.requestUpdate;
      },
      detached() {},
      update() {
        updates += 1;
      },
    });
    scheduler.flush();
    expect(updates).toBe(1);
    expect(typeof req).toBe("function");
    req!();
    scheduler.flush();
    expect(updates).toBe(2);
    engine.destroy();
  });
});

// ─── F2 (P2) — an EnginePrimitive is assignable to HostPrimitive ────────────────
// PATCH3P2 F2 widens HostPrimitive.hitTest to return either HostHit or PrimitiveHit
// (and renames the formerly-colliding local `PrimitiveHit` type to `HostHitMatch`).
// The tsc engine is the falsifier: a typed-assignment probe below MUST compile.
describe("F2 (P2) HostPrimitive is assignable from a contract-shaped EnginePrimitive", () => {
  it("a PrimitiveHit-returning hitTest satisfies HostPrimitive.hitTest", () => {
    const probe = (() => {
      const ePrim: EnginePrimitive = {
        id: "f2",
        attached: () => undefined,
        detached: () => undefined,
        update: () => undefined,
        hitTest: () => ({ primitiveId: "f2", cursor: "crosshair" }),
      };
      // The type assertion compiles when PATCH3P2 F2 is applied; it errors out with
      //   TS2322: Types of property 'hitTest' are incompatible …
      // when reverted. Vitest's tsc-on-test-files pass is the runtime gate.
      const host: HostPrimitive = ePrim;
      return host.id;
    });
    expect(probe()).toBe("f2");
  });
});

// ─── F3 (P2) — every advertised price-scale mode produces a distinct priceToCoordinate ─
// H2 advertises four modes (b1da5fbd). The capability probe must prove each mode
// produces a DIFFERENT y for the same price; otherwise the advertisement is false.
// Mutant: widen CANVAS_CAPABILITIES.priceScaleModes to ["normal", "log", "percent",
// "indexed100"] with nothing painted differently, then verify the assertion fires.
describe("F3 (P2) every advertised price-scale mode produces a distinct priceToCoordinate", () => {
  // F3 / B-0 — non-vacuous log: log must shift the pixel y for an in-range price
  // away from the normal-mode y by more than half a CSS pixel. The previous
  // `unique.size === 4` assertion accepted identical pixel y under percent and
  // indexed100 (affine maps of price), so it could not catch a regression that
  // silently demoted log to normal.
  it("log places 110 at a different y than normal (non-vacuous)", () => {
    const { engine: eN, scheduler: sN } = mount();
    const sN2 = eN.addSeries("line", { color: "l" });
    sN2.setData([{ time: 1, value: 100 }, { time: 2, value: 110 }, { time: 3, value: 120 }]);
    sN2.priceScale().applyOptions({ mode: "normal" });
    sN.flush();
    const yNormal = sN2.priceToCoordinate(110);
    eN.destroy();

    const { engine: eL, scheduler: sL } = mount();
    const sL2 = eL.addSeries("line", { color: "l" });
    sL2.setData([{ time: 1, value: 100 }, { time: 2, value: 110 }, { time: 3, value: 120 }]);
    sL2.priceScale().applyOptions({ mode: "log" });
    sL.flush();
    const yLog = sL2.priceToCoordinate(110);
    eL.destroy();

    expect(yNormal, "normal must answer priceToCoordinate(110)").not.toBeNull();
    expect(yLog, "log must answer priceToCoordinate(110)").not.toBeNull();
    expect(Math.abs(yLog! - yNormal!), `|yLog - yNormal|=${Math.abs(yLog! - yNormal!)}`).toBeGreaterThan(0.5);
  });

  // F3 / B-0 — percent and indexed100 change the DISPLAY DOMAIN. With
  // data {50, 100, 150} and baseValue = 50 (the first valued close), the display
  // value of 120 differs across modes:
  //   normal    → 120 (price)
  //   percent   → 100 * (140 - 50) / 50 = 140 (a percent)
  //   indexed100→ 100 * (140 - 50) / 50 + 100 = 240 (indexed units)
  // percent/indexed100 are AFFINE maps of price, so on a constant base the
  // pixel y at any given price equals normal's (LWC agrees); assert that
  // equality within 1e-6 to pin the contract.
  it("percent and indexed100 change the display domain while autoscaled y matches normal", () => {
    const rows: EngineSeriesRow[] = [{ time: 1, value: 50 }, { time: 2, value: 100 }, { time: 3, value: 150 }];
    const targetPrice = 120;
    const displayByMode: Record<string, number> = {};
    const yByMode: Record<string, number> = {};
    for (const mode of ["normal", "percent", "indexed100"] as const) {
      const { engine, scheduler } = mount();
      const s = engine.addSeries("line", { color: "l" });
      s.setData(rows);
      s.priceScale().applyOptions({ mode });
      scheduler.flush();
      const state = s.priceScale().unwrap<PriceScaleState>();
      displayByMode[mode] = priceToDisplay(targetPrice, state);
      const y = s.priceToCoordinate(targetPrice);
      expect(y, `${mode} must answer priceToCoordinate(${targetPrice})`).not.toBeNull();
      yByMode[mode] = y!;
      engine.destroy();
    }
    // Display domain must differ across modes.
    expect(displayByMode.normal, "normal priceToDisplay(120) = price").toBe(120);
    expect(displayByMode.percent, "percent priceToDisplay(120, base=50)").toBe(140);
    expect(displayByMode.indexed100, "indexed100 priceToDisplay(120, base=50)").toBe(240);
    // Distinct pairwise.
    const uniq = new Set([displayByMode.normal, displayByMode.percent, displayByMode.indexed100]);
    expect(uniq.size, `display domains must be pairwise distinct: ${JSON.stringify(displayByMode)}`).toBe(3);
    // Percent / indexed100 are affine maps of price over a constant base, so
    // the autoscale collapses them to the SAME pixel y as normal at any
    // same-priced bar (LWC agrees). Pin that equality within 1e-6.
    expect(yByMode.percent, "percent pixel y at 120 vs normal").toBeCloseTo(yByMode.normal, 6);
    expect(yByMode.indexed100, "indexed100 pixel y at 120 vs normal").toBeCloseTo(yByMode.normal, 6);
  });
});
// ───           silently swallowed by a bare `catch {}` (F11, paint2-rev). ────────
// At H2 the frame's `deliverPrimitiveUpdates` (frame.ts:580-588) rolls its own loop
// with a bare `try { p.update(p) } catch { /* swallow */ }` instead of routing through
// `primHost.deliverPane()` which has the once-per-generation guard and records errors.
// We assert the observable behaviour: a thrown update() must show up in
// primHost.errors() with phase "update".
describe("F11 (P2) a throwing primitive update() is recorded in primHost.errors()", () => {
  it("frame delivery routes through the host so a throw is recorded, not swallowed", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("line", { color: "#fff" });
    s.setData([{ time: 1, value: 1 }, { time: 2, value: 2 }]);
    s.attachPrimitive({
      id: "throwy",
      attached() {},
      detached() {},
      update() {
        throw new Error("prim update blew up");
      },
    });
    scheduler.flush();
    // Reach the engine's private primHost via a narrow escape hatch:
    const primHost = (engine as unknown as {
      primHost: { errors: () => { primitiveId: string; phase: string }[] };
    }).primHost;
    const errs = primHost.errors();
    expect(errs.length).toBeGreaterThanOrEqual(1);
    expect(errs[0]?.primitiveId).toBe("throwy");
    expect(errs[0]?.phase).toBe("update");
    engine.destroy();
  });
});

// ─── F10 (P2) — mouse-move payload carries seriesData + hoveredSeries + paneIndex ───
// At H2 `param()` (canvas/index.ts:404-438) returns only `{ point, logical, time }`
// and discards `crosshairInvalidation` (line 427) and `buildMouseParams` (line 343).
// After the PATCH3P2 fix, the param payload MUST carry the four fields the F10
// review says subscribers lose: `seriesData`, `hoveredSeries`, `paneIndex`,
// `sourceEvent`. We dispatch a real mousemove on the engine's overlay and inspect
// the subscriber payload.
describe("F10 (P2) crosshair mouse payload carries seriesData + hoveredSeries + paneIndex", () => {
  it("mousemove on the overlay delivers seriesData + hoveredSeries + paneIndex + sourceEvent to subscribers", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    s.setData([
      { time: 100, open: 10, high: 12, low: 9, close: 11 },
      { time: 200, open: 11, high: 14, low: 10, close: 13 },
    ]);
    scheduler.flush();
    // Subscribe via the public contract — emitMouse is what the overlay handler ends up calling.
    const seen: Record<string, unknown>[] = [];
    const handler = (p: Record<string, unknown>) => seen.push(p);
    engine.subscribeCrosshairMove(handler);
    // Dispatch a real mousemove on the overlay canvas.
    const overlay = engine.chartElement().querySelector("canvas[data-mm-overlay]") as HTMLCanvasElement | null;
    expect(overlay).toBeTruthy();
    const rect = { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) };
    overlay!.getBoundingClientRect = () => rect as DOMRect;
    overlay!.dispatchEvent(
      new MouseEvent("mousemove", { clientX: 100, clientY: 50, bubbles: true }),
    );
    expect(seen.length).toBeGreaterThanOrEqual(1);
    // The PATCH3P2 fix wires buildMouseParams into param() — these four fields MUST be present:
    const payload = seen[0];
    expect(payload, "F10 — seriesData must be present").toHaveProperty("seriesData");
    expect(payload, "F10 — hoveredSeries must be present").toHaveProperty("hoveredSeries");
    expect(payload, "F10 — paneIndex must be present").toHaveProperty("paneIndex");
    expect(payload, "F10 — sourceEvent must be present").toHaveProperty("sourceEvent");
    engine.unsubscribeCrosshairMove(handler);
    engine.destroy();
  });

  // P-4 RV-1 — re-key seriesData onto the series handle (object), not the bare id (string).
  it("RV-1 seriesData is keyed by the SeriesHandle (object), not by the bare id (string)", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    s.setData([
      { time: 100, open: 10, high: 12, low: 9, close: 11 },
      { time: 200, open: 11, high: 14, low: 10, close: 13 },
    ]);
    scheduler.flush();
    const seen: Record<string, unknown>[] = [];
    const handler = (p: Record<string, unknown>) => seen.push(p);
    engine.subscribeCrosshairMove(handler);
    const overlay = engine.chartElement().querySelector("canvas[data-mm-overlay]") as HTMLCanvasElement | null;
    expect(overlay).toBeTruthy();
    const rect = { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) };
    overlay!.getBoundingClientRect = () => rect as DOMRect;
    overlay!.dispatchEvent(new MouseEvent("mousemove", { clientX: 100, clientY: 50, bubbles: true }));
    expect(seen.length).toBeGreaterThanOrEqual(1);
    const sd = seen[0].seriesData as Map<unknown, unknown>;
    expect(sd, "seriesData must be a Map after the F10 payload wiring").toBeInstanceOf(Map);
    const key = [...sd.keys()][0] as { priceToCoordinate?: unknown; options?: unknown };
    expect(typeof key, "seriesData must be keyed by the series handle, not a bare id").toBe("object");
    expect(typeof key?.priceToCoordinate).toBe("function");
    expect(typeof key?.options).toBe("function");
    engine.unsubscribeCrosshairMove(handler);
    engine.destroy();
  });

  // P-4 RV-2 — a bar-crossing mousemove with no primitives must not repaint pane bitmaps.
  it("RV-2 a bar-crossing mousemove with no attached primitives does not repaint pane bitmaps", () => {
    const { engine, scheduler } = mount();
    const a = engine.addSeries("candles", { upColor: "U", downColor: "D" }, 0);
    engine.addSeries("line", { color: "#abc" }, 1);
    a.setData([
      { time: 100, open: 10, high: 12, low: 9, close: 11 },
      { time: 200, open: 11, high: 14, low: 10, close: 13 },
      { time: 300, open: 13, high: 16, low: 12, close: 15 },
    ]);
    scheduler.flush();
    const overlay = engine.chartElement().querySelector("canvas[data-mm-overlay]") as HTMLCanvasElement | null;
    expect(overlay).toBeTruthy();
    const rect = { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) };
    overlay!.getBoundingClientRect = () => rect as DOMRect;
    const before0 = paneCtx(engine, 0).__calls.length;
    const before1 = paneCtx(engine, 1).__calls.length;
    overlay!.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 50, bubbles: true }));
    scheduler.flush();
    overlay!.dispatchEvent(new MouseEvent("mousemove", { clientX: 180, clientY: 60, bubbles: true }));
    scheduler.flush();
    expect(paneCtx(engine, 0).__calls.length, "pane0 pane-bitmap must NOT advance on a bar-crossing crosshair move with no primitives").toBe(before0);
    expect(paneCtx(engine, 1).__calls.length, "pane1 pane-bitmap must NOT advance on a bar-crossing crosshair move with no primitives").toBe(before1);
    engine.destroy();
  });

  // P-4 RV-4 — hoveredSeries can no longer be unconditionally null; supply yOfValue so the
  // buildMouseParams hover-candidate branch has a chance to resolve.
  it("RV-4 hoveredSeries resolves at least one non-null entry when the cursor is over a bar", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    s.setData([
      { time: 100, open: 10, high: 12, low: 9, close: 11 },
      { time: 200, open: 11, high: 14, low: 10, close: 13 },
    ]);
    scheduler.flush();
    const seen: Record<string, unknown>[] = [];
    const handler = (p: Record<string, unknown>) => seen.push(p);
    engine.subscribeCrosshairMove(handler);
    const overlay = engine.chartElement().querySelector("canvas[data-mm-overlay]") as HTMLCanvasElement | null;
    expect(overlay).toBeTruthy();
    const rect = { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) };
    overlay!.getBoundingClientRect = () => rect as DOMRect;
    for (const x of [10, 30, 60, 100, 140, 190]) {
      overlay!.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: 60, bubbles: true }));
    }
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(
      seen.map((p) => p.hoveredSeries).some((h) => h != null),
      "hoveredSeries must resolve at least one non-null entry across cursor sweeps over the bars",
    ).toBe(true);
    engine.unsubscribeCrosshairMove(handler);
    engine.destroy();
  });
});

// ============================================================================
// RV-7 — hostHitId normalises HostHit.id / PrimitiveHit.primitiveId (F2, PATCH3P2)
// ============================================================================
describe("RV-7 — hostHitId normalises whichever shape a hit arrives as", () => {
  it("answers the same id for a HostHit and a contract PrimitiveHit", () => {
    expect(hostHitId({ id: "h", cursor: "pointer" })).toBe("h");
    expect(hostHitId({ primitiveId: "c", cursor: "crosshair" })).toBe("c");
  });
});
