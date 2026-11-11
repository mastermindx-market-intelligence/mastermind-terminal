// @vitest-environment jsdom
// Price-axis / time-axis DOM hit regions for the canvas ("mm") input bridge.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanvasEngine, createManualScheduler } from "../chart-engine/canvas";
import { hitTestEngineInput } from "../chart-engine/canvas/inputBridge";

type Ctx = CanvasRenderingContext2D & { __calls: Array<{ method: string; args: unknown[] }> };
const ctxByCanvas = new WeakMap<HTMLCanvasElement, Ctx>();

function makeFakeCtx(): Ctx {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const rec = (method: string) => (...args: unknown[]) => { calls.push({ method, args }); };
  const ctx: Record<string, unknown> = { __calls: calls };
  for (const m of [
    "setTransform", "fillRect", "clearRect", "drawImage", "beginPath", "moveTo", "lineTo",
    "stroke", "fill", "save", "restore", "scale", "translate", "rect", "closePath",
    "fillText", "strokeRect", "arc", "clip", "setLineDash",
  ]) ctx[m] = rec(m);
  ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  ctx.measureText = () => ({ width: 60 }); // WIDE price labels -> frame.ts strip > 40
  return ctx as unknown as Ctx;
}

let container: HTMLDivElement;
let nowMs = 0;
const ROWS = Array.from({ length: 40 }, (_, i) => ({
  time: 1700000000 + i * 3600, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i,
}));

function dispatchPointer(el: EventTarget, type: string, x: number, y: number, ts: number): void {
  const ev = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  Object.defineProperty(ev, "pointerType", { value: "mouse" });
  Object.defineProperty(ev, "timeStamp", { value: ts });
  el.dispatchEvent(ev);
}

beforeEach(() => {
  nowMs = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement, type: string,
  ) {
    if (type !== "2d") return null;
    let c = ctxByCanvas.get(this);
    if (!c) { c = makeFakeCtx(); ctxByCanvas.set(this, c); }
    return c as unknown as CanvasRenderingContext2D;
  });
});
afterEach(() => { vi.restoreAllMocks(); container.remove(); });

describe("I8 price-axis hit strip follows the DRAWN strip", () => {
  it("price-axis wheel anchors use the same local Y after moving to another pane", () => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, { width: 300, height: 200, devicePixelRatio: 1, scheduler });
    engine.addSeries("candles", {}, 0).setData(ROWS);
    engine.addSeries("candles", {}, 1).setData(ROWS);
    const panes = engine.panes();
    panes[0].setHeight(100); panes[1].setHeight(100);
    for (const pane of panes) pane.priceScale("right").setVisibleRange({ from: 90, to: 160 });
    scheduler.flush();
    const time = engine.timeScale().getVisibleLogicalRange();
    const overlay = engine.chartElement().querySelector("[data-mm-overlay]")!;
    for (const clientY of [30, panes[0].height() + 30]) overlay.dispatchEvent(new WheelEvent("wheel", {
      clientX: 290, clientY, deltaY: -40, bubbles: true, cancelable: true,
    }));
    expect(panes[0].priceScale("right").getVisibleRange()).not.toEqual({ from: 90, to: 160 });
    expect(panes[1].priceScale("right").getVisibleRange()).toEqual(panes[0].priceScale("right").getVisibleRange());
    expect(engine.timeScale().getVisibleLogicalRange()).toEqual(time);
    engine.destroy();
  });

  it("the left axis owns axis drags while plot wheel anchors stay plot-local", () => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 300, height: 160, devicePixelRatio: 1, scheduler,
      leftPriceScale: { visible: true }, rightPriceScale: { visible: false },
    });
    const series = engine.addSeries("candles", { priceScaleId: "left" });
    series.setData(ROWS);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 20 });
    scheduler.flush();
    const overlay = engine.chartElement().querySelector("[data-mm-overlay]")!;
    const before = engine.timeScale().getVisibleLogicalRange();
    dispatchPointer(overlay, "pointerdown", 20, 30, 0);
    dispatchPointer(overlay, "pointermove", 40, 60, 20);
    dispatchPointer(overlay, "pointerup", 40, 60, 20);
    expect(engine.timeScale().getVisibleLogicalRange()).toEqual(before);
    const x = 90, left = engine.priceScale("left").width();
    const logical = engine.timeScale().coordinateToLogical(x);
    overlay.dispatchEvent(new WheelEvent("wheel", {
      clientX: left + x, clientY: 30, deltaY: -40, bubbles: true, cancelable: true,
    }));
    expect(engine.timeScale().coordinateToLogical(x)).toBeCloseTo(logical!, 10);
    engine.destroy();
  });

  it.each([
    { scale: true, scroll: false, deltaX: 0, deltaY: 30, consumed: true },
    { scale: false, scroll: true, deltaX: 0, deltaY: 30, consumed: false },
    { scale: false, scroll: true, deltaX: 30, deltaY: 0, consumed: true },
    { scale: true, scroll: false, deltaX: 30, deltaY: 0, consumed: false },
    { scale: false, scroll: false, deltaX: 30, deltaY: 30, consumed: false },
  ])("wheel consumption matches enabled directional gesture: %j", ({ scale, scroll, deltaX, deltaY, consumed }) => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 200, height: 100, devicePixelRatio: 1, scheduler,
      handleScale: { mouseWheel: scale }, handleScroll: { mouseWheel: scroll },
    });
    engine.addSeries("candles", {}).setData(ROWS);
    scheduler.flush();
    const overlay = engine.chartElement().querySelector("[data-mm-overlay]")!;
    const wheel = new WheelEvent("wheel", { clientX: 50, clientY: 20, deltaX, deltaY, bubbles: true, cancelable: true });
    overlay.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(consumed);
    engine.destroy();
  });

  it("a drag on the drawn price axis zooms price, it does not pan time", () => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 200, height: 100, devicePixelRatio: 1, scheduler, now: () => nowMs,
    });
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    s.setData(ROWS);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 20 });
    scheduler.flush();
    const overlay = engine.chartElement().querySelector("[data-mm-overlay]") as HTMLElement;
    const logicalBefore = engine.timeScale().getVisibleLogicalRange();
    const priceBefore = engine.priceScale("right").getVisibleRange();
    const x = 150; // 200 - 50: inside a 64px drawn strip, OUTSIDE the hardcoded 40px
    dispatchPointer(overlay, "pointerdown", x, 20, 0);
    nowMs = 20; dispatchPointer(overlay, "pointermove", x, 60, 20);
    dispatchPointer(overlay, "pointerup", x, 60, 20);
    const logicalAfter = engine.timeScale().getVisibleLogicalRange();
    const priceAfter = engine.priceScale("right").getVisibleRange();
    expect(logicalAfter).toEqual(logicalBefore);
    expect(priceAfter).not.toEqual(priceBefore);
    engine.destroy();
  });
});

// Direct unit test of the exported hitTestEngineInput. The published strip is a
// PER-PANE array; the helper must answer for a point inside the painted band,
// outside it, and in the time-axis band below.
describe("I8b direct hitTestEngineInput honours a published per-pane strip", () => {
  const layout = {
    widthPx: 200,
    paneHeights: [80] as const, // single 80px pane; total = 80
    priceAxisWidthPx: [68] as const, // published 68px strip
  };

  it("x=150 (inside the painted 68px strip) -> priceAxis", () => {
    expect(hitTestEngineInput(150, 10, layout).region).toBe("priceAxis");
  });

  it("x=120 (outside the painted 68px strip) -> plot", () => {
    expect(hitTestEngineInput(120, 10, layout).region).toBe("plot");
  });

  it("y inside the time-axis band -> timeAxis (when x is outside the painted strip)", () => {
    // paneHeights total = 80; TIME_AXIS_HIT_HEIGHT_PX = 24; band y >= 80-24 = 56
    expect(hitTestEngineInput(120, 70, layout).region).toBe("timeAxis");
  });

  it("omitted priceAxisWidthPx falls back to the 40-px floor", () => {
    const noStrip = { widthPx: 200, paneHeights: [80] as const };
    // x=170 -> x >= 200-40 -> priceAxis (the floor makes this region claim)
    expect(hitTestEngineInput(170, 10, noStrip).region).toBe("priceAxis");
    // x=150 -> x < 200-40 -> plot
    expect(hitTestEngineInput(150, 10, noStrip).region).toBe("plot");
  });

  it("scalar priceAxisWidthPx is honoured for every pane", () => {
    const scalar = { widthPx: 200, paneHeights: [80] as const, priceAxisWidthPx: 68 };
    expect(hitTestEngineInput(140, 10, scalar).region).toBe("priceAxis");
    expect(hitTestEngineInput(120, 10, scalar).region).toBe("plot");
  });
});
