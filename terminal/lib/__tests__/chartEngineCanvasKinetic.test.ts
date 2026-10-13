// @vitest-environment jsdom
// Engine-level pointer / wheel / kinetic wiring for the canvas ("mm") renderer.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEngine } from "@/lib/chart-engine";
import {
  createCanvasEngine,
  createManualScheduler,
  EngineRefusalError,
} from "@/lib/chart-engine/canvas";
import { logicalOfX } from "@/lib/chart-engine/canvas/input";
import type { EngineSeriesRow } from "@/lib/chart-engine/api";
import { chartTimeAxisOptions } from "@/lib/chartTimeAxis";

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

const ROWS: EngineSeriesRow[] = Array.from({ length: 20 }, (_, i) => ({
  time: 1_700_000_000 + i * 60,
  open: 10,
  high: 12,
  low: 9,
  close: 11,
}));

/** ChartPanel mount bag (F4) with literal values; CrosshairMode.Normal = 0. */
function chartPanelBag() {
  return {
    width: 900,
    height: 600,
    layout: {
      background: { color: "transparent" },
      textColor: "#c8cdd8",
      fontSize: 12,
      attributionLogo: false,
      panes: { separatorColor: "#222", separatorHoverColor: "#333" },
    },
    grid: { vertLines: { color: "#1a1d24" }, horzLines: { color: "#1a1d24" } },
    crosshair: {
      mode: 0,
      vertLine: { color: "rgba(214,218,227,.32)", width: 1, labelBackgroundColor: "#2a2e38" },
      horzLine: { color: "rgba(214,218,227,.32)", width: 1, labelBackgroundColor: "#2a2e38" },
    },
    rightPriceScale: {
      borderVisible: true,
      borderColor: "#3a3f4b",
      tickMarkDensity: 3,
      scaleMargins: { top: 0.1, bottom: 0.08 },
    },
    timeScale: {
      borderColor: "#3a3f4b",
      rightOffset: 24,
      barSpacing: 8,
      ...chartTimeAxisOptions("24", () => 30),
    },
    kineticScroll: { mouse: true, touch: true },
  };
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

describe("canvas engine ChartPanel bag (T1)", () => {
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

  it("createEngine(container, ChartPanel bag, mm) does not throw EngineRefusalError", () => {
    let engine: ReturnType<typeof createEngine> | undefined;
    try {
      engine = createEngine(container, chartPanelBag(), "mm");
    } catch (err) {
      if (err instanceof EngineRefusalError) {
        expect.fail(
          `EngineRefusalError unsupported=[${err.unsupported.join(",")}] reason=${err.reason}`,
        );
      }
      throw err;
    }
    expect(engine?.impl).toBe("mm");
    engine?.destroy();
    engine?.destroy();
  });
});

describe("canvas engine pointer / wheel / kinetic (T3)", () => {
  let container: HTMLDivElement;
  let nowMs: number;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    nowMs = 0;
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

  it("(a) a mouse drag pan moves the visible logical range by dx / barSpacing", () => {
    const { engine, overlay } = mount();
    const before = engine.timeScale().getVisibleLogicalRange();
    expect(before).toEqual({ from: 0, to: 20 });
    const spacing = engine.timeScale().options().barSpacing as number;
    expect(spacing).toBeCloseTo(10, 8);
    dispatchPointer(overlay, "pointerdown", 40, 30, { timeStamp: 10 });
    dispatchPointer(overlay, "pointermove", 140, 30, { timeStamp: 30 });
    const after = engine.timeScale().getVisibleLogicalRange();
    expect(after).not.toBeNull();
    const dx = 100;
    expect(after!.from).toBeCloseTo(before!.from - dx / spacing, 8);
    expect(after!.to).toBeCloseTo(before!.to - dx / spacing, 8);
    expect(after!.to - after!.from).toBeCloseTo(20, 8);
    engine.destroy();
  });

  it("(b) a wheel event zooms about the cursor (anchor within 0.5 bar)", () => {
    const { engine, overlay } = mount();
    const x = 50;
    const ts = engine.unwrap<{ time: { visibleFrom: number; visibleTo: number; barSpacing: number; widthPx: number; rightOffset: number } }>().time;
    const beforeLogical = logicalOfX(x, ts);
    const beforeWidth = ts.visibleTo - ts.visibleFrom;
    const ev = dispatchWheel(overlay, x, 30, -120, { ctrlKey: true, deltaMode: 0 });
    expect(ev.defaultPrevented).toBe(true);
    const after = engine.timeScale().getVisibleLogicalRange()!;
    const afterTs = engine.unwrap<{ time: typeof ts }>().time;
    const afterLogical = logicalOfX(x, afterTs);
    expect(Math.abs(afterLogical - beforeLogical)).toBeLessThanOrEqual(0.5);
    expect(Math.abs((after.to - after.from) - beforeWidth)).toBeGreaterThan(0.01);
    engine.destroy();
  });

  it("(c) kineticScroll mouse:true keeps gliding; mouse:false stops at release", () => {
    const on = mount({ kineticScroll: { mouse: true, touch: true } });
    dispatchPointer(on.overlay, "pointerdown", 40, 30, { timeStamp: 1000 });
    dispatchPointer(on.overlay, "pointermove", 100, 30, { timeStamp: 1020 });
    dispatchPointer(on.overlay, "pointermove", 180, 30, { timeStamp: 1040 });
    nowMs = 1040;
    dispatchPointer(on.overlay, "pointerup", 180, 30, { timeStamp: 1040 });
    const released = on.engine.timeScale().getVisibleLogicalRange()!;
    nowMs += 16;
    on.scheduler.flush();
    nowMs += 16;
    on.scheduler.flush();
    nowMs += 16;
    on.scheduler.flush();
    const glided = on.engine.timeScale().getVisibleLogicalRange()!;
    expect(Math.abs(glided.from - released.from)).toBeGreaterThan(0.01);
    on.engine.destroy();

    nowMs = 0;
    const off = mount({ kineticScroll: { mouse: false, touch: true } });
    dispatchPointer(off.overlay, "pointerdown", 40, 30, { timeStamp: 1000 });
    dispatchPointer(off.overlay, "pointermove", 100, 30, { timeStamp: 1020 });
    dispatchPointer(off.overlay, "pointermove", 180, 30, { timeStamp: 1040 });
    nowMs = 1040;
    dispatchPointer(off.overlay, "pointerup", 180, 30, { timeStamp: 1040 });
    const frozen = off.engine.timeScale().getVisibleLogicalRange()!;
    nowMs += 16;
    off.scheduler.flush();
    nowMs += 16;
    off.scheduler.flush();
    const still = off.engine.timeScale().getVisibleLogicalRange()!;
    expect(still.from).toBe(frozen.from);
    expect(still.to).toBe(frozen.to);
    off.engine.destroy();
  });

  it("(c) applyOptions({ kineticScroll }) reaches the live controller", () => {
    const { engine, overlay, scheduler } = mount({ kineticScroll: { mouse: true, touch: true } });
    engine.applyOptions({ kineticScroll: { mouse: false, touch: true } });
    dispatchPointer(overlay, "pointerdown", 40, 30, { timeStamp: 1000 });
    dispatchPointer(overlay, "pointermove", 100, 30, { timeStamp: 1020 });
    dispatchPointer(overlay, "pointermove", 180, 30, { timeStamp: 1040 });
    nowMs = 1040;
    dispatchPointer(overlay, "pointerup", 180, 30, { timeStamp: 1040 });
    const frozen = engine.timeScale().getVisibleLogicalRange()!;
    nowMs += 16;
    scheduler.flush();
    nowMs += 16;
    scheduler.flush();
    const still = engine.timeScale().getVisibleLogicalRange()!;
    expect(still.from).toBe(frozen.from);
    engine.destroy();
  });

  it("(d) pointercancel mid-drag ends the gesture without inertia or a stuck press", () => {
    const { engine, overlay, scheduler } = mount();
    dispatchPointer(overlay, "pointerdown", 40, 30, { timeStamp: 10 });
    dispatchPointer(overlay, "pointermove", 120, 30, { timeStamp: 30 });
    const mid = engine.timeScale().getVisibleLogicalRange()!;
    dispatchPointer(overlay, "pointercancel", 120, 30, { timeStamp: 40 });
    nowMs = 40;
    nowMs += 16;
    scheduler.flush();
    nowMs += 16;
    scheduler.flush();
    const afterCancel = engine.timeScale().getVisibleLogicalRange()!;
    expect(afterCancel.from).toBe(mid.from);
    dispatchPointer(overlay, "pointermove", 180, 30, { timeStamp: 80 });
    const afterStray = engine.timeScale().getVisibleLogicalRange()!;
    expect(afterStray.from).toBe(mid.from);
    dispatchPointer(overlay, "pointerdown", 40, 30, { pointerId: 2, timeStamp: 100 });
    dispatchPointer(overlay, "pointermove", 90, 30, { pointerId: 2, timeStamp: 120 });
    const afterNew = engine.timeScale().getVisibleLogicalRange()!;
    expect(afterNew.from).not.toBeCloseTo(mid.from, 6);
    engine.destroy();
  });

  it("(e) after destroy, dispatched events change nothing and throw nothing", () => {
    const { engine, overlay } = mount();
    const overlayRef = overlay;
    engine.destroy();
    engine.destroy();
    expect(engine.inventory()).toEqual({
      alive: false,
      panes: 0,
      series: 0,
      seriesByPane: [],
      priceLines: 0,
      watermarks: 0,
    });
    expect(() => {
      dispatchPointer(overlayRef, "pointerdown", 40, 30, { timeStamp: 1 });
      dispatchPointer(overlayRef, "pointermove", 140, 30, { timeStamp: 20 });
      dispatchWheel(overlayRef, 50, 30, -120, { ctrlKey: true });
    }).not.toThrow();
    expect(engine.timeScale().getVisibleLogicalRange()).toBeNull();
  });

  it("(f) destroy() removes every listener the bridge added to the overlay", () => {
    const { engine, overlay } = mount();
    const removeSpy = vi.spyOn(overlay, "removeEventListener");
    engine.destroy();
    const types = removeSpy.mock.calls.map((call) => String(call[0]));
    for (const t of [
      "pointerdown", "pointermove", "pointerup", "pointercancel", "wheel", "dblclick",
    ]) {
      expect(types, t).toContain(t);
    }
  });

  it("(g) destroy() cancels an in-flight inertia frame", () => {
    let seq = 0;
    const pending = new Map<unknown, () => void>();
    const recorder = {
      schedule(cb: () => void): unknown { const h = ++seq; pending.set(h, cb); return h; },
      cancel(h: unknown): void { pending.delete(h); },
    };
    const engine = createCanvasEngine(container, {
      width: 200, height: 100, devicePixelRatio: 1, scheduler: recorder,
      now: () => nowMs, kineticScroll: { mouse: true, touch: true },
    });
    const series = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    series.setData(ROWS);
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 20 });
    const overlay = engine.chartElement().querySelector("[data-mm-overlay]") as HTMLCanvasElement;
    dispatchPointer(overlay, "pointerdown", 40, 30, { timeStamp: 0 });
    nowMs = 10;
    dispatchPointer(overlay, "pointermove", 70, 30, { timeStamp: 10 });
    nowMs = 20;
    dispatchPointer(overlay, "pointermove", 100, 30, { timeStamp: 20 });
    dispatchPointer(overlay, "pointerup", 100, 30, { timeStamp: 20 });
    expect(pending.size).toBeGreaterThan(0);
    engine.destroy();
    expect(pending.size).toBe(0);
  });
});
