// @vitest-environment jsdom
// PERF-A C2 tests (T4/T5): pointer-anchored zoom keeps the bar under the
// pointer at its own pixel centre (<= 1 CSS px drift over 60 wheel notches,
// bench/chart-engine.bench.ts drift construction), pinch and keyboard zoom
// keep their anchor bar, and the time-axis drag keeps the RIGHT edge
// (LWC _internal_scaleTo, dev:6305-6317). 40,000-row daily fixture, 1378 CSS
// px time scale, dpr 2, real DOM listeners, createEngine(..., "mm").
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEngine } from "@/lib/chart-engine";
import { createManualScheduler } from "@/lib/chart-engine/canvas";
import type { ChartModel } from "@/lib/chart-engine/canvas/model";
import { createKeyboardController } from "@/lib/chart-engine/canvas/keyboard";
import type { EngineSeriesRow, EngineTime } from "@/lib/chart-engine/api";

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

const WIDTH_PX = 1378;
const ROWS = 40_000;
const MAX_SPACING = WIDTH_PX / 2; // LWC default max = width * 0.5 (dev:6533-6541)

function dailyRows(): EngineSeriesRow[] {
  const rows: EngineSeriesRow[] = [];
  for (let i = 0; i < ROWS; i++) {
    const close = 10 + (i % 7);
    rows.push({ time: 1_700_000_000 + i * 86_400, open: 10, high: 18, low: 8, close });
  }
  return rows;
}

let host: HTMLDivElement;

type Mount = {
  engine: ReturnType<typeof createEngine>;
  model: ChartModel;
  overlay: HTMLCanvasElement;
};

function mountPerf(): Mount {
  const scheduler = createManualScheduler();
  const engine = createEngine(host, {
    width: WIDTH_PX,
    height: 600,
    devicePixelRatio: 2,
    scheduler,
    now: () => 0,
  }, "mm");
  const series = engine.addSeries("candles", { upColor: "U", downColor: "D" });
  series.setData(dailyRows());
  scheduler.flush();
  const overlay = engine.chartElement().querySelector("[data-mm-overlay]") as HTMLCanvasElement;
  expect(overlay).toBeTruthy();
  return { engine, model: engine.unwrap<ChartModel>(), overlay };
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

function dispatchWheel(el: EventTarget, x: number, y: number, deltaY: number): void {
  el.dispatchEvent(new WheelEvent("wheel", {
    clientX: x,
    clientY: y,
    deltaY,
    deltaX: 0,
    deltaMode: 0,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  }));
}

/** The bench's anchor construction (bench/mount.ts anchorTimeAt + drift). */
function anchorBarAt(m: Mount, x: number): { time: EngineTime; x0: number } {
  const t = m.engine.timeScale().coordinateToTime(x);
  expect(t).not.toBeNull();
  const x0 = m.engine.timeScale().timeToCoordinate(t as EngineTime);
  expect(x0).not.toBeNull();
  return { time: t as EngineTime, x0: x0 as number };
}

describe("PERF-A anchored zoom (T4): wheel drift <= 1 CSS px", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
      type: string,
    ) {
      if (type !== "2d") return null;
      return makeFakeCtx();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    host.remove();
  });

  it("T4 60 wheel notches at the plot centre keep the anchor bar within 1 px, saturate at the max clamp (F4, dev:6277-6289)", () => {
    const m = mountPerf();
    expect(m.model.time.barSpacing).toBe(0.5);
    const centre = WIDTH_PX / 2;
    const spanBefore = m.model.time.visibleTo - m.model.time.visibleFrom;
    const { time, x0 } = anchorBarAt(m, centre);
    for (let i = 0; i < 60; i++) {
      dispatchWheel(m.overlay, centre, 300, -120);
    }
    const after = m.engine.timeScale().timeToCoordinate(time);
    expect(after).not.toBeNull();
    expect(Math.abs((after as number) - x0)).toBeLessThanOrEqual(1);
    // The zoom genuinely happened and the spacing clamped at width * 0.5.
    expect(m.model.time.visibleTo - m.model.time.visibleFrom).toBeLessThan(spanBefore - 100);
    expect(m.model.time.barSpacing).toBeLessThanOrEqual(MAX_SPACING + 1e-9);
    expect(m.model.time.barSpacing).toBe(MAX_SPACING);
    m.engine.destroy();
  });

  it("T4b pointer 0.3 bar right of a bar centre: same law (the bar under the pointer is the anchor, F4)", () => {
    const m = mountPerf();
    const centre = WIDTH_PX / 2;
    // Bar 38622's centre sits at centre + 0.25 px; 0.3 bar at spacing 0.5 is
    // 0.15 px, so the pointer lands 0.3 bar right of that bar centre.
    const pointerX = centre + 0.4;
    const { time, x0 } = anchorBarAt(m, pointerX);
    for (let i = 0; i < 60; i++) {
      dispatchWheel(m.overlay, pointerX, 300, -120);
    }
    const after = m.engine.timeScale().timeToCoordinate(time);
    expect(after).not.toBeNull();
    expect(Math.abs((after as number) - x0)).toBeLessThanOrEqual(1);
    expect(m.model.time.barSpacing).toBe(MAX_SPACING);
    m.engine.destroy();
  });

  it("T5a a two-finger pinch keeps the bar under the start midpoint within 1 px over 20 spread steps (§5.2)", () => {
    const m = mountPerf();
    const mid = WIDTH_PX / 2;
    const { time, x0 } = anchorBarAt(m, mid);
    let t = 1_000;
    dispatchPointer(m.overlay, "pointerdown", mid - 89, 200, { pointerId: 1, pointerType: "touch", timeStamp: t });
    dispatchPointer(m.overlay, "pointerdown", mid + 89, 200, { pointerId: 2, pointerType: "touch", timeStamp: t });
    for (let i = 1; i <= 20; i++) {
      t += 20;
      dispatchPointer(m.overlay, "pointermove", mid - 89 - i * 10, 200, { pointerId: 1, pointerType: "touch", timeStamp: t });
      dispatchPointer(m.overlay, "pointermove", mid + 89 + i * 10, 200, { pointerId: 2, pointerType: "touch", timeStamp: t });
    }
    dispatchPointer(m.overlay, "pointerup", mid - 89 - 200, 200, { pointerId: 2, pointerType: "touch", timeStamp: t });
    dispatchPointer(m.overlay, "pointerup", mid + 89 + 200, 200, { pointerId: 1, pointerType: "touch", timeStamp: t });
    const after = m.engine.timeScale().timeToCoordinate(time);
    expect(after).not.toBeNull();
    expect(Math.abs((after as number) - x0)).toBeLessThanOrEqual(1);
    expect(m.model.time.barSpacing).toBeGreaterThan(0.5);
    m.engine.destroy();
  });

  it("T5b keyboard zoom keeps the crosshair bar's pixel centre within 1 px over 20 steps", () => {
    const m = mountPerf();
    const model = m.model;
    let crosshair: { logical: number | null; paneIndex: number } = { logical: null, paneIndex: 0 };
    const keyboard = createKeyboardController({
      getTimeScale: () => model.time,
      setVisibleLogicalRange: (from, to) => model.setVisibleLogicalRange({ from, to }),
      getCrosshair: () => crosshair,
      setCrosshair: (logical, paneIndex) => {
        crosshair = { logical, paneIndex };
      },
      clearCrosshair: () => {
        crosshair = { logical: null, paneIndex: crosshair.paneIndex };
      },
      resetView: () => undefined,
      paneCount: () => model.panes.length,
      announce: () => undefined,
      now: () => 0,
      barCount: () => ROWS,
    });
    keyboard.focus();
    // Materialise the crosshair on the centre-visible bar, then zoom in 20x.
    keyboard.handleKey({ key: "ArrowRight", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, timeStamp: 100, repeat: false });
    expect(crosshair.logical).not.toBeNull();
    const anchorBar = crosshair.logical as number;
    const x0 = model.xOfLogical(anchorBar);
    for (let i = 1; i <= 20; i++) {
      keyboard.handleKey({ key: "+", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, timeStamp: 100 + i * 200, repeat: false });
      expect(Math.abs(model.xOfLogical(anchorBar) - x0)).toBeLessThanOrEqual(1);
    }
    expect(model.time.barSpacing).toBeGreaterThan(0.5);
    m.engine.destroy();
  });

  it("T5c time-axis drag zoom keeps the RIGHT edge pinned (LWC _internal_scaleTo, dev:6305-6317)", () => {
    const m = mountPerf();
    // Start inside the spacing bounds (the 40k fit sits exactly on the 0.5
    // minimum, where a zoom-out drag would clamp to a no-op).
    m.engine.timeScale().applyOptions({ barSpacing: 6 });
    const before = { ...m.model.time };
    expect(before.barSpacing).toBeCloseTo(6, 9);
    const y = 600 - 10; // inside the 24-px time-axis hit strip
    let t = 2_000;
    dispatchPointer(m.overlay, "pointerdown", 1_000, y, { timeStamp: t });
    for (let i = 1; i <= 20; i++) {
      t += 20;
      dispatchPointer(m.overlay, "pointermove", 1_000 + i * 6, y, { timeStamp: t });
    }
    dispatchPointer(m.overlay, "pointerup", 1_000 + 120, y, { timeStamp: t });
    expect(m.model.time.visibleTo).toBe(before.visibleTo);
    // Right edge anchored: spacing scales by (width - x) / (width - downX).
    const expected = before.barSpacing * (WIDTH_PX - (1_000 + 120)) / (WIDTH_PX - 1_000);
    expect(m.model.time.barSpacing).toBeCloseTo(expected, 9);
    m.engine.destroy();
  });
});
