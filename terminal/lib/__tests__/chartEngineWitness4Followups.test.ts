// @vitest-environment jsdom
// WITNESS4 follow-ups: three pins for behaviour that is live at HEAD but not falsifiable
// there — the displayed price scale in PAINT (W4-F1), the click latch's hover guard
// (W4-F2), the dblclick latch suppression (W4-F3, PERF-W4 follow-up), and the
// model-level price-scale mode refusal (W4-F4).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanvasEngine, createManualScheduler } from "../chart-engine/canvas";
import { ChartModel } from "../chart-engine/canvas/model";
import { EngineRefusalError } from "../chart-engine/canvas/refusal";

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
  ctx.measureText = () => ({ width: 60 });
  return ctx as unknown as Ctx;
}

let container: HTMLDivElement;
let nowMs = 0;
const ROWS = Array.from({ length: 40 }, (_, i) => ({
  time: 1700000000 + i * 3600, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i,
}));

function ev(type: string, x: number, y: number, buttons: number): MouseEvent {
  const e = new MouseEvent(type, {
    clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons,
  });
  Object.defineProperty(e, "pointerId", { value: 1 });
  Object.defineProperty(e, "pointerType", { value: "mouse" });
  return e;
}

function axisLabelsIn(root: HTMLElement, widthPx: number): string[] {
  const out: string[] = [];
  root.querySelectorAll("canvas").forEach((cv) => {
    const c = ctxByCanvas.get(cv);
    if (!c) return;
    for (const call of c.__calls) {
      if (call.method === "fillText" && Number(call.args[1]) === widthPx - 4) out.push(String(call.args[0]));
    }
  });
  return out;
}

function mountInto(root: HTMLElement, scaleLeft: boolean) {
  const scheduler = createManualScheduler();
  const engine = createCanvasEngine(root, {
    width: 200, height: 100, devicePixelRatio: 1, scheduler, now: () => nowMs,
  });
  if (scaleLeft) {
    engine.applyOptions({
      leftPriceScale: { visible: true },
      rightPriceScale: { visible: false },
    } as never);
  }
  const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
  if (scaleLeft) s.applyOptions({ priceScaleId: "left" } as never);
  s.setData(ROWS as never);
  engine.timeScale().setVisibleLogicalRange({ from: 0, to: 20 });
  scheduler.flush();
  return engine;
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

describe("W4-F1 — scaleLeft: PAINT must use the displayed scale too, not only gestures", () => {
  it("the painted price-axis labels are the displayed (left) scale's, matching the same data on the right", () => {
    const right = document.createElement("div");
    document.body.appendChild(right);
    const left = document.createElement("div");
    document.body.appendChild(left);
    const engineR = mountInto(right, false);
    const engineL = mountInto(left, true);
    const rightLabels = axisLabelsIn(right, 200);
    const leftLabels = axisLabelsIn(left, 200);
    expect(rightLabels.length).toBeGreaterThan(0);
    // ChartPanel.tsx:9735-9736 hides "right", shows "left" and moves the price series to
    // "left". frame.ts:288/:358 paint from "right", so at HEAD this reads a scale that has
    // no series on it: measured ['0','0.5','1'] against ['100','110','120'].
    expect(leftLabels).toEqual(rightLabels);
    engineR.destroy();
    engineL.destroy();
    right.remove();
    left.remove();
  });
});

describe("W4-F2 — the click latch must not arm on an unpressed (hover) move", () => {
  it("a hover move (buttons:0) followed by a bare click still delivers ONE click", () => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 200, height: 100, devicePixelRatio: 1, scheduler, now: () => nowMs,
    });
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    s.setData(ROWS as never);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 20 });
    scheduler.flush();
    const overlay = engine.chartElement().querySelector("[data-mm-overlay]") as HTMLElement;
    const clicks: number[] = [];
    engine.subscribeClick(() => { clicks.push(1); });
    // Nothing is pressed: pointermove carries buttons === 0, so the latch must stay disarmed.
    overlay.dispatchEvent(ev("pointermove", 10, 10, 0));
    overlay.dispatchEvent(ev("pointermove", 90, 40, 0));
    // A click with no pointerdown of its own (keyboard activation, element.click(), a proof harness).
    overlay.dispatchEvent(ev("click", 90, 40, 0));
    expect(clicks.length).toBe(1);
    engine.destroy();
  });
});

describe("W4-F3 — a pressed move >= 5px must suppress the next dblclick (LWC parity)", () => {
  function setupEngines() {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 200, height: 100, devicePixelRatio: 1, scheduler, now: () => nowMs,
    });
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    s.setData(ROWS as never);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 20 });
    scheduler.flush();
    return { engine, scheduler };
  }

  it("suppressed after a pressed move >= 5px; control delivered with no pressed move", () => {
    const { engine } = setupEngines();
    const overlay = engine.chartElement().querySelector("[data-mm-overlay]") as HTMLElement;
    const dbls: number[] = [];
    engine.subscribeDblClick(() => { dbls.push(1); });
    // Pressed: buttons:1 throughout, latchDown arms the latch and latchMove fires once
    // the manhattan distance from downX/downY reaches the 5-px threshold (dev :8269-8270).
    overlay.dispatchEvent(ev("pointerdown", 10, 10, 1));
    overlay.dispatchEvent(ev("pointermove", 90, 40, 1));
    overlay.dispatchEvent(ev("pointermove", 95, 45, 1));
    // Release, then a double-click the user might fire — the latch must cancel it.
    overlay.dispatchEvent(ev("pointerup", 95, 45, 0));
    overlay.dispatchEvent(new MouseEvent("dblclick", { clientX: 95, clientY: 45, bubbles: true }));
    expect(dbls.length).toBe(0);
    // Control: a fresh engine, no pointerdown / no pressed move — cancelClick stays false and
    // a subsequent dblclick IS delivered exactly once.
    const control = setupEngines();
    const controlOverlay = control.engine.chartElement().querySelector("[data-mm-overlay]") as HTMLElement;
    const ctrlDbls: number[] = [];
    control.engine.subscribeDblClick(() => { ctrlDbls.push(1); });
    controlOverlay.dispatchEvent(new MouseEvent("dblclick", { clientX: 30, clientY: 30, bubbles: true }));
    expect(ctrlDbls.length).toBe(1);
    engine.destroy();
    control.engine.destroy();
  });
});

describe("W4-F4 — ChartModel.applyOptions refuses an unsupported price-scale mode group", () => {
  it("a bogus mode in rightPriceScale / leftPriceScale throws EngineRefusalError at the model gate", () => {
    const m = new ChartModel({ onInvalidate: () => undefined, onStructure: () => undefined });
    // The engine path is refused earlier by gateEngineOptions (canvas/index.ts:586), so this
    // is the only pin for the group-level assertPriceScaleModeSupported (model.ts:605).
    expect(() => m.applyOptions({ rightPriceScale: { mode: "bogus" } } as never)).toThrow(EngineRefusalError);
    expect(() => m.applyOptions({ leftPriceScale: { mode: "bogus" } } as never)).toThrow(EngineRefusalError);
    expect(() => m.applyOptions({ rightPriceScale: { mode: "log" } } as never)).not.toThrow();
  });
});
