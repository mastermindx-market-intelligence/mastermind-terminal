// @vitest-environment jsdom
// PERF-A C2 / PERF-RR2 ruling 3 tests (T4/T5): pointer-anchored zoom keeps the
// FLOAT INDEX under the pointer fixed (the continuous time coordinate — LWC
// _internal_zoom dev:6277-6288, performance-budget.md line 62 'the pointer
// must stay the anchor'), so the drift metric built only from integer
// logicals (coordOf) measures the engine against the <= 1 CSS px law at every
// barSpacing. Bar-centre anchoring breaks the law once barSpacing grows past
// ~13 px. 40,000-row daily fixture, 1378 CSS px time scale, dpr 2, real DOM
// listeners, createEngine(..., "mm").
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEngine } from "@/lib/chart-engine";
import { createManualScheduler } from "@/lib/chart-engine/canvas";
import type { ChartModel } from "@/lib/chart-engine/canvas/model";
import { createKeyboardController } from "@/lib/chart-engine/canvas/keyboard";
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
/** LWC default max = plot width * 0.5 (dev:6533-6541); the plot is the chart less the price axis. */
const maxSpacing = (m: { model: ChartModel }): number => m.model.time.widthPx / 2;

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

/** Float-index anchor under x (mirrors bench/mount.ts floatAnchorAt). The
 *  engine's coordinateToLogical is float-exact; the interpolation matches
 *  the bench so the same metric is asserted here. In jsdom the overlay's
 *  rect.left is 0, so clientX === x. */
function floatAnchorAt(m: Mount, x: number): { x: number; logical: number } {
  const ts = m.engine.timeScale();
  const i = ts.coordinateToLogical(x);
  expect(i).not.toBeNull();
  const c0 = ts.logicalToCoordinate(i as number);
  const c1 = ts.logicalToCoordinate((i as number) + 1);
  expect(c0).not.toBeNull();
  expect(c1).not.toBeNull();
  if ((c0 as number) === (c1 as number)) {
    throw new Error("floatAnchorAt: degenerate spacing, cannot interpolate");
  }
  const logical = (i as number) + (x - (c0 as number)) / ((c1 as number) - (c0 as number));
  return { x, logical };
}

/** coordOf(L): the pixel the engine would paint for the float index L
 *  (mirrors bench/mount.ts coordinateOfLogical). */
function coordOfLogical(m: Mount, logical: number): number {
  const ts = m.engine.timeScale();
  const j = Math.floor(logical);
  const d0 = ts.logicalToCoordinate(j);
  const d1 = ts.logicalToCoordinate(j + 1);
  expect(d0).not.toBeNull();
  expect(d1).not.toBeNull();
  if ((d0 as number) === (d1 as number)) {
    throw new Error("coordOfLogical: degenerate spacing, cannot interpolate");
  }
  return (d0 as number) + (logical - j) * ((d1 as number) - (d0 as number));
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

  it("T4 60 wheel notches at the plot centre keep the float index within 1 px, saturate at the max clamp (F4, dev:6277-6289)", () => {
    const m = mountPerf();
    expect(m.model.time.barSpacing).toBe(0.5);
    const centre = m.model.time.widthPx / 2;
    const spanBefore = m.model.time.visibleTo - m.model.time.visibleFrom;
    // TEST-CORRECTION (seat ruling 3, float-index law): the bar-centre
    // quantity this test previously measured (anchorBarAt) moves by
    // d*(ratio-1) under float anchoring, so the assertion becomes invalid.
    // The new metric is the float index under the pointer.
    const a = floatAnchorAt(m, centre);
    for (let i = 0; i < 60; i++) {
      dispatchWheel(m.overlay, centre, 300, -120);
    }
    const afterX = coordOfLogical(m, a.logical);
    expect(Math.abs(afterX - a.x)).toBeLessThanOrEqual(1);
    // The zoom genuinely happened and the spacing clamped at width * 0.5.
    expect(m.model.time.visibleTo - m.model.time.visibleFrom).toBeLessThan(spanBefore - 100);
    expect(m.model.time.barSpacing).toBeLessThanOrEqual(maxSpacing(m) + 1e-9);
    expect(m.model.time.barSpacing).toBe(maxSpacing(m));
    m.engine.destroy();
  });

  it("T4b pointer 0.3 bar right of a bar centre: same law (the float index under the pointer is the anchor, F4)", () => {
    const m = mountPerf();
    const centre = m.model.time.widthPx / 2;
    // Bar 38622's centre sits at centre + 0.25 px; 0.3 bar at spacing 0.5 is
    // 0.15 px, so the pointer lands 0.3 bar right of that bar centre.
    const pointerX = centre + 0.4;
    // TEST-CORRECTION (seat ruling 3, float-index law): same metric swap.
    const a = floatAnchorAt(m, pointerX);
    for (let i = 0; i < 60; i++) {
      dispatchWheel(m.overlay, pointerX, 300, -120);
    }
    const afterX = coordOfLogical(m, a.logical);
    expect(Math.abs(afterX - a.x)).toBeLessThanOrEqual(1);
    expect(m.model.time.barSpacing).toBe(maxSpacing(m));
    m.engine.destroy();
  });

  it("T4c at barSpacing 50 a pointer 0.3 bar right of a bar centre keeps its float index within 1 px over 5 wheel notches (ruling 3)", () => {
    const m = mountPerf();
    m.engine.timeScale().applyOptions({ barSpacing: 50 });
    expect(m.model.time.barSpacing).toBeCloseTo(50, 9);
    const ts = m.engine.timeScale();
    const b = Math.round((ts.coordinateToLogical(m.model.time.widthPx / 2) as number));
    const x = (ts.logicalToCoordinate(b) as number) + 15; // 15 px = 0.3 bar at spacing 50
    const setup = floatAnchorAt(m, x);
    // The metric must start on the float index it claims to anchor — 0.3 bar
    // right of an integer bar centre.
    expect(Math.abs(setup.logical - (b + 0.3))).toBeLessThan(1e-9);
    for (let i = 0; i < 5; i++) {
      dispatchWheel(m.overlay, x, 300, -120);
    }
    const afterX = coordOfLogical(m, setup.logical);
    expect(Math.abs(afterX - setup.x)).toBeLessThanOrEqual(1);
    // A real, unclamped zoom (the max spacing is half the plot width, so
    // a 5-notch step from barSpacing 50 stays well under it).
    expect(m.model.time.barSpacing).toBeGreaterThan(50);
    expect(m.model.time.barSpacing).toBeLessThan(maxSpacing(m));
    m.engine.destroy();
  });

  it("T5a a two-finger pinch keeps the float index under the start midpoint within 1 px over 20 spread steps (§5.2)", () => {
    const m = mountPerf();
    const mid = m.model.time.widthPx / 2;
    // TEST-CORRECTION (seat ruling 3, float-index law): same metric swap.
    const a = floatAnchorAt(m, mid);
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
    const afterX = coordOfLogical(m, a.logical);
    expect(Math.abs(afterX - a.x)).toBeLessThanOrEqual(1);
    expect(m.model.time.barSpacing).toBeGreaterThan(0.5);
    m.engine.destroy();
  });

  it("T5d at barSpacing 50 a pinch whose midpoint is 0.3 bar right of a bar centre keeps its float index within 1 px (ruling 3)", () => {
    const m = mountPerf();
    m.engine.timeScale().applyOptions({ barSpacing: 50 });
    expect(m.model.time.barSpacing).toBeCloseTo(50, 9);
    const ts = m.engine.timeScale();
    const b = Math.round((ts.coordinateToLogical(m.model.time.widthPx / 2) as number));
    const mid = (ts.logicalToCoordinate(b) as number) + 15; // 0.3 bar at spacing 50
    const setup = floatAnchorAt(m, mid);
    expect(Math.abs(setup.logical - (b + 0.3))).toBeLessThan(1e-9);
    let t = 1_000;
    dispatchPointer(m.overlay, "pointerdown", mid - 89, 200, { pointerId: 1, pointerType: "touch", timeStamp: t });
    dispatchPointer(m.overlay, "pointerdown", mid + 89, 200, { pointerId: 2, pointerType: "touch", timeStamp: t });
    for (let i = 1; i <= 10; i++) {
      t += 20;
      dispatchPointer(m.overlay, "pointermove", mid - 89 - i * 10, 200, { pointerId: 1, pointerType: "touch", timeStamp: t });
      dispatchPointer(m.overlay, "pointermove", mid + 89 + i * 10, 200, { pointerId: 2, pointerType: "touch", timeStamp: t });
    }
    dispatchPointer(m.overlay, "pointerup", mid - 89 - 100, 200, { pointerId: 2, pointerType: "touch", timeStamp: t });
    dispatchPointer(m.overlay, "pointerup", mid + 89 + 100, 200, { pointerId: 1, pointerType: "touch", timeStamp: t });
    const afterX = coordOfLogical(m, setup.logical);
    expect(Math.abs(afterX - setup.x)).toBeLessThanOrEqual(1);
    expect(m.model.time.barSpacing).toBeGreaterThan(50);
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
    const expected = before.barSpacing * (m.model.time.widthPx - (1_000 + 120)) / (m.model.time.widthPx - 1_000);
    expect(m.model.time.barSpacing).toBeCloseTo(expected, 9);
    m.engine.destroy();
  });
});
