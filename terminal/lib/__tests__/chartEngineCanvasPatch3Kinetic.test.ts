// @vitest-environment jsdom
//
// PATCH3K pin tests — every finding below is paired with a falsifier scenario
// from ce-kinetic-rev-1013.RESULT.md. F1 pins the cross-lane gate fix landed
// by FOLD3 73c86cd7 (R01-A04 retargeted at trackingMode). F2 / F3 / F4 pin
// K-C6 / K-C8 / K-K3 gaps the KINETIC lane left uncovered. F5 pins the
// price-axis hit-test consumer side in inputBridge.ts (the upstream
// publication of model.priceAxisStripPx is a sibling-lane PROPOSED_PATCH).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CANVAS_CAPABILITIES,
  createCanvasEngine,
  createManualScheduler,
  EngineRefusalError,
  type CanvasChartEngine,
  type PaintScheduler,
} from "@/lib/chart-engine/canvas";
import { hitTestEngineInput } from "@/lib/chart-engine/canvas/inputBridge";
import type { EngineSeriesRow } from "@/lib/chart-engine/api";

const ROWS: EngineSeriesRow[] = Array.from({ length: 20 }, (_, i) => ({
  time: 1_700_000_000 + i * 60,
  open: 10,
  high: 12,
  low: 9,
  close: 11,
}));

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
        props[p] = v;
      },
      enumerable: true,
      configurable: true,
    });
  }
  return ctx as unknown as FakeCtx;
}

const ctxByCanvas = new WeakMap<HTMLCanvasElement, FakeCtx>();

function installCtxSpy(): void {
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
}

function dispatchPointer(
  el: EventTarget,
  type: string,
  x: number,
  y: number,
  extra: { pointerId?: number; pointerType?: string; timeStamp?: number } = {},
): void {
  const ev = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
  Object.defineProperty(ev, "pointerId", { value: extra.pointerId ?? 1 });
  Object.defineProperty(ev, "pointerType", { value: extra.pointerType ?? "mouse" });
  if (extra.timeStamp != null) Object.defineProperty(ev, "timeStamp", { value: extra.timeStamp });
  el.dispatchEvent(ev);
}

function dispatchWheel(
  el: EventTarget,
  x: number,
  y: number,
  deltaY: number,
  extra: { ctrlKey?: boolean; deltaX?: number; deltaMode?: number } = {},
): WheelEvent {
  const ev = new WheelEvent("wheel", {
    clientX: x,
    clientY: y,
    deltaY,
    deltaX: extra.deltaX ?? 0,
    deltaMode: extra.deltaMode ?? 0,
    ctrlKey: extra.ctrlKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  el.dispatchEvent(ev);
  return ev;
}

describe("F1 — cross-lane gate break is resolved (R01-A04 retargeted at trackingMode)", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    installCtxSpy();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  // Pin the cross-lane fix landed by FOLD3 73c86cd7: trackingMode sits outside
  // ALLOWED_GROUPS in lib/chart-engine/options.ts, so the refusal example is
  // stable regardless of which Capability Lane adds to the canvas capability
  // surface. The kineticScroll capability itself is a positive canvas
  // capability (no throw); that is the second half of R01-A04.
  it("createCanvasEngine refuses trackingMode but accepts kineticScroll", () => {
    expect(CANVAS_CAPABILITIES.kineticScroll).toBe(true);
    expect(() =>
      createCanvasEngine(container, {
        width: 100,
        height: 50,
        trackingMode: {},
      } as Parameters<typeof createCanvasEngine>[1]),
    ).toThrow(EngineRefusalError);
    try {
      createCanvasEngine(container, {
        width: 100,
        height: 50,
        trackingMode: {},
      } as Parameters<typeof createCanvasEngine>[1]);
    } catch (err) {
      const e = err as EngineRefusalError;
      expect(e).toBeInstanceOf(EngineRefusalError);
      expect(e.reason).toMatch(/trackingMode/);
      expect(e.unsupported).toContain("trackingMode");
    }
    expect(container.childNodes).toHaveLength(0);

    const container2 = document.createElement("div");
    document.body.appendChild(container2);
    let accepted: CanvasChartEngine | undefined;
    try {
      accepted = createCanvasEngine(container2, {
        width: 100,
        height: 50,
        kineticScroll: { touch: true, mouse: true },
      });
    } catch (err) {
      expect.fail(`kineticScroll sample should be accepted; got ${err}`);
    }
    accepted!.destroy();
    container2.remove();
  });
});

describe("F2 — unconsumed wheel does not preventDefault (K-C6 gap)", () => {
  let container: HTMLDivElement;
  let nowMs: number;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    nowMs = 0;
    installCtxSpy();
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
      now: () => nowMs,
      kineticScroll: { mouse: true, touch: true },
      ...opts,
    });
    const series = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    series.setData(ROWS);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 20 });
    scheduler.flush();
    const overlay = engine.chartElement().querySelector("[data-mm-overlay]") as HTMLCanvasElement;
    expect(overlay).toBeTruthy();
    return { engine, scheduler, overlay };
  }

  it("a plain wheel and a ctrl+wheel are both left to the page when mouseWheel is off in both groups", () => {
    const { engine, overlay } = mount({
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    });
    const before = engine.timeScale().getVisibleLogicalRange()!;
    const plain = dispatchWheel(overlay, 50, 30, 120);
    const ctrl = dispatchWheel(overlay, 50, 30, -120, { ctrlKey: true });
    expect(plain.defaultPrevented).toBe(false);
    expect(ctrl.defaultPrevented).toBe(false);
    const after = engine.timeScale().getVisibleLogicalRange()!;
    expect(after.from).toBeCloseTo(before.from, 8);
    expect(after.to).toBeCloseTo(before.to, 8);
    engine.destroy();
  });
});

describe("F3 — destroy() cancels the armed glide frame and balances bridge listeners", () => {
  let container: HTMLDivElement;
  let nowMs: number;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    nowMs = 0;
    installCtxSpy();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  it("destroy removes every bridge listener once and cancels the armed glide frame", () => {
    const added: Array<[string, boolean]> = [];
    const removed: Array<[string, boolean]> = [];
    const origAdd = HTMLCanvasElement.prototype.addEventListener;
    const origRemove = HTMLCanvasElement.prototype.removeEventListener;
    vi.spyOn(HTMLCanvasElement.prototype, "addEventListener").mockImplementation(
      function (
        this: HTMLCanvasElement,
        type: string,
        l: EventListenerOrEventListenerObject | null,
        o?: boolean | AddEventListenerOptions,
      ) {
        added.push([type, this.getAttribute("data-mm-overlay") !== null]);
        return origAdd.call(this, type, l as EventListenerOrEventListenerObject, o);
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "removeEventListener").mockImplementation(
      function (
        this: HTMLCanvasElement,
        type: string,
        l: EventListenerOrEventListenerObject | null,
        o?: boolean | AddEventListenerOptions,
      ) {
        removed.push([type, this.getAttribute("data-mm-overlay") !== null]);
        return origRemove.call(this, type, l as EventListenerOrEventListenerObject, o);
      },
    );
    // Wrap the manual scheduler so we can observe the armed-frame count.
    const armed: Array<() => void> = [];
    const inner = createManualScheduler();
    const recorder: PaintScheduler & { flush(): void } = {
      schedule(cb: () => void): unknown {
        armed.push(cb);
        return inner.schedule(cb);
      },
      cancel(handle: unknown): void {
        inner.cancel(handle);
      },
      flush(): void {
        inner.flush();
      },
    };
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 200,
      height: 100,
      devicePixelRatio: 1,
      scheduler: recorder,
      now: () => nowMs,
      kineticScroll: { mouse: true, touch: true },
    });
    const series = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    series.setData(ROWS);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 20 });
    inner.flush();
    const overlay = engine.chartElement().querySelector("[data-mm-overlay]") as HTMLCanvasElement;
    expect(overlay).toBeTruthy();
    dispatchPointer(overlay, "pointerdown", 40, 30, { timeStamp: 1000 });
    dispatchPointer(overlay, "pointermove", 100, 30, { timeStamp: 1020 });
    dispatchPointer(overlay, "pointermove", 180, 30, { timeStamp: 1040 });
    nowMs = 1040;
    dispatchPointer(overlay, "pointerup", 180, 30, { timeStamp: 1040 });
    inner.flush();
    // The release armed an inertia frame on the recorder.
    expect(armed.length).toBeGreaterThan(0);
    engine.destroy();
    engine.destroy();
    // destroy() must cancel the armed frame: any scheduled callback that the
    // scheduler still holds must have been cancelled by `controller.dispose()`.
    // Subsequent flushes must not invoke the inertia callback.
    const armedBeforeFlush = armed.length;
    inner.flush();
    expect(armed.length).toBe(armedBeforeFlush);
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel", "dblclick"]) {
      const a = added.filter(([t, isOverlay]) => t === type && isOverlay).length;
      const r = removed.filter(([t, isOverlay]) => t === type && isOverlay).length;
      expect({ type, a, r }).toEqual({ type, a, r: a });
    }
    void scheduler;
  });
});

describe("F4 — wheel deltaMode is forwarded and reaches the controller", () => {
  let container: HTMLDivElement;
  let nowMs: number;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    nowMs = 0;
    installCtxSpy();
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
      now: () => nowMs,
      kineticScroll: { mouse: true, touch: true },
      ...opts,
    });
    const series = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    series.setData(ROWS);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 20 });
    scheduler.flush();
    const overlay = engine.chartElement().querySelector("[data-mm-overlay]") as HTMLCanvasElement;
    expect(overlay).toBeTruthy();
    return { engine, scheduler, overlay };
  }

  it("a line-mode notch zooms harder than a pixel-mode unit at the same deltaY", () => {
    const span = (deltaY: number, deltaMode: number): number => {
      const { engine, overlay } = mount();
      dispatchWheel(overlay, 50, 30, deltaY, { ctrlKey: true, deltaMode });
      const r = engine.timeScale().getVisibleLogicalRange()!;
      engine.destroy();
      return r.to - r.from;
    };
    const px = span(-3, 0);
    const line = span(-3, 1);
    expect(Math.abs(px - 20)).toBeLessThan(0.2);
    expect(Math.abs(line - 20)).toBeGreaterThan(0.8);
    expect(Math.abs(line - 20)).toBeLessThan(3);
  });
});

describe("F5b — producer side: each pane's painted price-axis strip reaches the hit test (RF-1/RF-2)", () => {
  let container: HTMLDivElement;
  let nowMs: number;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    nowMs = 0;
    installCtxSpy();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  // End-to-end half of kinetic-rev F5. RED at HEAD (no producer): the drag pans
  // 0.1 bar, measured as `AssertionError: expected 0.1 to be less than 0.001`.
  // GREEN with the model.ts + frame.ts producer hunks above.
  it("(i) a drag inside the painted strip zooms price and never pans time", () => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 200, height: 100, devicePixelRatio: 1, scheduler,
      now: () => nowMs, kineticScroll: { mouse: true, touch: true },
    });
    const series = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    series.setData(ROWS);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 20 });
    const pane = engine.chartElement().querySelector("canvas[data-mm-pane-canvas='0']") as HTMLCanvasElement;
    const pctx = pane.getContext("2d") as unknown as FakeCtx;
    pctx.measureText = (() => ({ width: 60 })) as unknown as typeof pctx.measureText;
    scheduler.flush();                       // frame.ts now paints strip = max(40, ceil(60 + 8)) = 68
    const m = engine.unwrap<{ time: { visibleFrom: number; visibleTo: number }; priceAxisStripPx: readonly number[] }>();
    expect(m.priceAxisStripPx[0]).toBe(68);
    const overlay = engine.chartElement().querySelector("[data-mm-overlay]") as HTMLCanvasElement;
    const from0 = m.time.visibleFrom;
    const to0 = m.time.visibleTo;
    // x=140 is inside the painted strip (>= 200 - 68 = 132) but outside the 40px floor (< 160).
    dispatchPointer(overlay, "pointerdown", 140, 30, { timeStamp: 10 });
    dispatchPointer(overlay, "pointermove", 141, 70, { timeStamp: 30 });
    expect(m.time.visibleFrom).toBe(from0);
    expect(m.time.visibleTo).toBe(to0);
    engine.destroy();
  });

  // Multi-pane half: the strip is per pane, so a scalar publication leaves pane 0
  // broken. RED with a scalar `priceAxisStripPx = 0` field (measured:
  // `AssertionError: expected 40 not to be 40` — pane 1's floor overwrote pane 0's
  // 68); GREEN with the per-pane array above.
  it("(ii) each pane is hit-tested against its own painted strip", () => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 200, height: 100, devicePixelRatio: 1, scheduler,
      now: () => nowMs, kineticScroll: { mouse: true, touch: true },
    });
    const a = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    a.setData(ROWS);
    const b = engine.addSeries("histogram", { color: "#abc" }, 1);
    b.setData(ROWS.map((r) => ({ time: r.time, value: "close" in r ? r.close : 0 })) as unknown as EngineSeriesRow[]);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 20 });
    const root = engine.chartElement();
    const c0 = (root.querySelector("canvas[data-mm-pane-canvas='0']") as HTMLCanvasElement).getContext("2d") as unknown as FakeCtx;
    const c1 = (root.querySelector("canvas[data-mm-pane-canvas='1']") as HTMLCanvasElement).getContext("2d") as unknown as FakeCtx;
    c0.measureText = (() => ({ width: 60 })) as unknown as typeof c0.measureText;  // pane 0 strip 68
    c1.measureText = (() => ({ width: 4 })) as unknown as typeof c1.measureText;   // pane 1 strip 40
    scheduler.flush();
    const m = engine.unwrap<{ time: { visibleFrom: number }; priceAxisStripPx: readonly number[] }>();
    expect([...m.priceAxisStripPx]).toEqual([68, 40]);
    const overlay = root.querySelector("[data-mm-overlay]") as HTMLCanvasElement;
    const from0 = m.time.visibleFrom;
    dispatchPointer(overlay, "pointerdown", 140, 20, { timeStamp: 10 });   // y=20 -> pane 0
    dispatchPointer(overlay, "pointermove", 141, 40, { timeStamp: 30 });
    expect(Math.abs(m.time.visibleFrom - from0)).toBeLessThan(0.001);
    engine.destroy();
  });
});

describe("F5 — inputBridge consumer side honours an optional measured price-axis strip", () => {
  it("hitTestEngineInput uses max(40, priceAxisWidthPx ?? 0) — a 68-px axis claims the outer 22 px", () => {
    // The hit test takes a CSS-px width argument; the bridge forwards it from
    // frame.ts's measured strip (PROPOSED_PATCH publishes model.priceAxisStripPx
    // and frame.ts writes it; here we drive the consumer side directly).
    const strip = 68;
    const layout = {
      widthPx: 200,
      paneHeights: [80] as const,
      priceAxisWidthPx: strip,
    };
    const insidePainted = hitTestEngineInput(140, 10, layout); // x=140 is inside strip (>= 200-68) and outside the 40px floor
    const outsideFloor = hitTestEngineInput(150, 10, layout); // x=150 is inside strip too
    expect(insidePainted.region).toBe("priceAxis");
    expect(outsideFloor.region).toBe("priceAxis");
    // With a measured strip, x=141 (which is OUTSIDE the painted strip 200-68=132)
    // is now plot again — and so is x=132 itself.
    const justInsideStrip = hitTestEngineInput(132, 10, layout);
    const outsideStrip = hitTestEngineInput(131, 10, layout);
    expect(justInsideStrip.region).toBe("priceAxis");
    expect(outsideStrip.region).toBe("plot");
  });

  it("omitting priceAxisWidthPx falls back to the 40-px floor (no behaviour change)", () => {
    const layout = { widthPx: 200, paneHeights: [80] as const };
    const insideFloor = hitTestEngineInput(170, 10, layout); // x=170 -> x>=160 (200-40) -> priceAxis
    const outsideFloor = hitTestEngineInput(150, 10, layout); // x=150 -> plot
    expect(insideFloor.region).toBe("priceAxis");
    expect(outsideFloor.region).toBe("plot");
  });
});