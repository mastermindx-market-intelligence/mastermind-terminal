// @vitest-environment jsdom
// PERF-A C1/C3 tests: LWC-exact time-scale clamp + correctOffset bounds on
// every window write (T1, T2), the F3 drag that leaves the plot (T3), and
// wheel-stops-inertia parity (T6). Driven through createEngine(..., "mm") and
// the real DOM listeners on the overlay, with a 40,000-row daily fixture and a
// 1378-CSS-px chart (dpr 2), asserting against the model's own plot widthPx.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEngine } from "@/lib/chart-engine";
import { createManualScheduler } from "@/lib/chart-engine/canvas";
import type { ChartModel } from "@/lib/chart-engine/canvas/model";
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

/** 40k strictly-increasing daily-style rows (1 bar per 86400 s). */
function dailyRows(): EngineSeriesRow[] {
  const rows: EngineSeriesRow[] = [];
  for (let i = 0; i < ROWS; i++) {
    const close = 10 + (i % 7);
    rows.push({ time: 1_700_000_000 + i * 86_400, open: 10, high: 18, low: 8, close });
  }
  return rows;
}

type Mount = {
  engine: ReturnType<typeof createEngine>;
  model: ChartModel;
  scheduler: ReturnType<typeof createManualScheduler>;
  overlay: HTMLCanvasElement;
  setNow: (ms: number) => void;
};

/** Host div owned by the enclosing describe's beforeEach/afterEach. */
let host: HTMLDivElement;

function mountPerf(opts: Record<string, unknown> = {}): Mount {
  const scheduler = createManualScheduler();
  let now = 0;
  const engine = createEngine(host, {
    width: WIDTH_PX,
    height: 600,
    devicePixelRatio: 2,
    scheduler,
    now: () => now,
    ...opts,
  }, "mm");
  const series = engine.addSeries("candles", { upColor: "U", downColor: "D" });
  series.setData(dailyRows());
  scheduler.flush();
  const overlay = engine.chartElement().querySelector("[data-mm-overlay]") as HTMLCanvasElement;
  expect(overlay).toBeTruthy();
  const model = engine.unwrap<ChartModel>();
  return {
    engine,
    model,
    scheduler,
    overlay,
    setNow: (ms) => {
      now = ms;
    },
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
  extra: { ctrlKey?: boolean; deltaMode?: number } = {},
): void {
  el.dispatchEvent(new WheelEvent("wheel", {
    clientX: x,
    clientY: y,
    deltaY,
    deltaX: 0,
    deltaMode: extra.deltaMode ?? 0,
    ctrlKey: extra.ctrlKey ?? false,
    bubbles: true,
    cancelable: true,
  }));
}

describe("PERF-A time scale (T1/T2): LWC clamp on every write", () => {
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

  it("T1 fitContent on 40k rows lands on minBarSpacing 0.5 with span widthPx/0.5 and the last bar at the right edge (dev:6404-6413, 6526-6531)", () => {
    const m = mountPerf();
    // The time scale is the chart width less the measured price axis strip (LWC
    // ChartWidget._adjustSizeImpl); every span below is relative to that plot width.
    expect(m.model.priceAxisWidthPx).toBeGreaterThan(0);
    expect(m.model.time.widthPx + m.model.priceAxisWidthPx).toBe(WIDTH_PX);
    m.engine.timeScale().fitContent();
    const ts = m.model.time;
    expect(ts.barSpacing).toBe(0.5);
    expect(ts.visibleTo - ts.visibleFrom).toBeCloseTo(m.model.time.widthPx / 0.5, 9);
    expect(ts.visibleTo).toBe(ROWS); // right edge = n + options.rightOffset (0)
    expect(ts.visibleFrom).toBeCloseTo(ROWS - m.model.time.widthPx / 0.5, 9);
    // options.rightOffset is included like dev:6404-6413.
    m.engine.timeScale().applyOptions({ rightOffset: 4 });
    m.engine.timeScale().fitContent();
    expect(m.model.time.visibleTo).toBe(ROWS + 4);
    m.engine.destroy();
  });

  it("T2 setVisibleLogicalRange clamps to min/max spacing exactly as LWC and round-trips in-bounds requests bitwise (dev:6499-6524, 6574-6603)", () => {
    const m = mountPerf();
    const tsHandle = m.engine.timeScale();
    const model = m.model;

    // 40k-bar request -> spacing below minBarSpacing 0.5 -> clamped, right
    // edge kept (dev:6393), span = widthPx/0.5.
    tsHandle.setVisibleLogicalRange({ from: 0, to: ROWS });
    expect(model.time.barSpacing).toBe(0.5);
    expect(model.time.visibleTo).toBe(ROWS);
    expect(model.time.visibleFrom).toBeCloseTo(ROWS - m.model.time.widthPx / 0.5, 9);

    // Half-bar request -> spacing above the max (width * 0.5, dev:6533-6541)
    // -> clamped to WIDTH_PX/2, right edge kept.
    tsHandle.setVisibleLogicalRange({ from: 100, to: 100.5 });
    expect(model.time.barSpacing).toBeCloseTo(m.model.time.widthPx / 2, 9);
    expect(model.time.visibleTo).toBe(100.5);
    expect(model.time.visibleFrom).toBeCloseTo(100.5 - 2, 9); // span 2 = width/(width/2)

    // A request already inside every bound round-trips unchanged — no
    // re-quantisation, and no duplicate notification.
    const inBounds = { from: model.time.visibleFrom, to: model.time.visibleTo };
    const handler = vi.fn();
    tsHandle.subscribeVisibleLogicalRangeChange(handler);
    tsHandle.setVisibleLogicalRange(inBounds);
    expect(model.time.visibleFrom).toBe(inBounds.from);
    expect(model.time.visibleTo).toBe(inBounds.to);
    expect(handler).toHaveBeenCalledTimes(0);
    tsHandle.unsubscribeVisibleLogicalRangeChange(handler);
    m.engine.destroy();
  });

  it("T2b the always-on correctOffset bounds stop a pan at 2 bars from each end (dev:6574-6603)", () => {
    const m = mountPerf();
    const model = m.model;
    const span = m.model.time.widthPx / 0.5;
    // Toward older (visibleTo -> min bound = min(2, n) = 2):
    m.engine.timeScale().setVisibleLogicalRange({ from: -5_000 - span, to: -5_000 });
    expect(model.time.visibleTo).toBe(2);
    expect(model.time.visibleFrom).toBeCloseTo(2 - span, 9);
    // Toward newer (visibleTo -> max bound = n + span - 2):
    m.engine.timeScale().setVisibleLogicalRange({ from: ROWS + 500, to: ROWS + 500 + span });
    expect(model.time.visibleTo).toBeCloseTo(ROWS + span - 2, 9);
    expect(model.time.visibleFrom).toBeCloseTo(ROWS - 2, 9);
    m.engine.destroy();
  });
});

describe("PERF-A input parity through the real DOM listeners (T3/T6)", () => {
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

  it("T3 a 1600 px rightward drag past the plot pans to OLDER data by exactly dx/barSpacing (LWC dev:6333), default kinetic {mouse:false} freezes on release", () => {
    const m = mountPerf(); // no kineticScroll bag: LWC default {mouse:false, touch:true}
    const model = m.model;
    expect(model.time.barSpacing).toBe(0.5);
    const before = { ...model.time };
    const centre = m.model.time.widthPx / 2;
    let t = 1_000;
    dispatchPointer(m.overlay, "pointerdown", centre, 300, { timeStamp: t });
    for (let i = 1; i <= 200; i++) {
      t += 16;
      dispatchPointer(m.overlay, "pointermove", centre + i * 8, 300, { timeStamp: t });
    }
    dispatchPointer(m.overlay, "pointerup", centre + 200 * 8, 300, { timeStamp: t });
    const after = { ...model.time };
    // 1600 px at 0.5 px/bar = 3200 bars toward OLDER; the correctOffset bound
    // (visibleTo >= 2) is 39,998 bars away, so the clamped amount IS 3200.
    expect(after.visibleFrom).toBeCloseTo(before.visibleFrom - 1600 / 0.5, 9);
    expect(after.visibleTo).toBeCloseTo(before.visibleTo - 1600 / 0.5, 9);
    expect(after.visibleTo - after.visibleFrom).toBeCloseTo(before.visibleTo - before.visibleFrom, 9);
    // mouse kinetic is OFF by default: later scheduler frames move nothing.
    for (let i = 0; i < 12; i++) {
      m.setNow(t + i * 16);
      m.scheduler.flush();
    }
    expect(model.time.visibleFrom).toBe(after.visibleFrom);
    expect(model.time.visibleTo).toBe(after.visibleTo);
    m.engine.destroy();
  });

  it("T3b a fast flick with explicit kineticScroll {mouse:true} glides in the SAME direction and stops exactly at the correctOffset bound (dev:6574-6603)", () => {
    const m = mountPerf({ kineticScroll: { mouse: true, touch: true } });
    const model = m.model;
    const span = m.model.time.widthPx / 0.5;
    // Park the window so the glide has room to reach the newer-side bound:
    // visibleTo max = n + span - 2.
    m.engine.timeScale().setVisibleLogicalRange({ from: ROWS - 2 - 900, to: ROWS - 2 - 900 + span });
    const before = { ...model.time };
    const centre = m.model.time.widthPx / 2;
    let t = 5_000;
    // LEFTWARD flick (toward newer data): 50 moves of -8 px, 2 ms apart. The
    // injected now() clock must track the event stamps or the inertia timer
    // sees a huge elapsed and self-cancels.
    dispatchPointer(m.overlay, "pointerdown", centre, 300, { timeStamp: t });
    for (let i = 1; i <= 50; i++) {
      t += 2;
      m.setNow(t);
      dispatchPointer(m.overlay, "pointermove", centre - i * 8, 300, { timeStamp: t });
    }
    m.setNow(t);
    dispatchPointer(m.overlay, "pointerup", centre - 400, 300, { timeStamp: t });
    const released = { ...model.time };
    // Drag itself: 400 px toward newer.
    expect(released.visibleTo).toBeCloseTo(before.visibleTo + 400 / 0.5, 9);
    // Glide continues in the SAME direction and must stop AT the bound.
    for (let i = 0; i < 120; i++) {
      m.setNow(t + 16 + i * 16);
      m.scheduler.flush();
    }
    const glided = model.time;
    expect(glided.visibleTo).toBeGreaterThanOrEqual(released.visibleTo);
    expect(glided.visibleTo).toBeCloseTo(ROWS + span - 2, 9);
    expect(glided.visibleFrom).toBeCloseTo(ROWS - 2, 9);
    m.engine.destroy();
  });

  it("T6 a wheel notch during inertia stops the inertia (no further window movement on later frames; LWC dev:6319-6328)", () => {
    const m = mountPerf({ kineticScroll: { mouse: true, touch: true } });
    const model = m.model;
    const centre = m.model.time.widthPx / 2;
    let t = 9_000;
    dispatchPointer(m.overlay, "pointerdown", centre, 300, { timeStamp: t });
    for (let i = 1; i <= 30; i++) {
      t += 2;
      m.setNow(t);
      dispatchPointer(m.overlay, "pointermove", centre + i * 8, 300, { timeStamp: t });
    }
    m.setNow(t);
    dispatchPointer(m.overlay, "pointerup", centre + 240, 300, { timeStamp: t });
    const released = { ...model.time };
    m.setNow(t + 16);
    m.scheduler.flush(); // one inertia frame has run
    const midGlide = { ...model.time };
    // The glide was genuinely live: it moved toward older data past release.
    expect(midGlide.visibleTo).toBeLessThan(released.visibleTo);
    // A wheel zoom notch must cancel the glide...
    dispatchWheel(m.overlay, centre, 300, -120, { ctrlKey: true });
    const afterWheel = { ...model.time };
    expect(afterWheel.visibleTo - afterWheel.visibleFrom)
      .toBeLessThan(midGlide.visibleTo - midGlide.visibleFrom);
    // ...and no later scheduler frame moves the window any further.
    for (let i = 0; i < 12; i++) {
      m.setNow(t + 32 + i * 16);
      m.scheduler.flush();
    }
    expect(model.time.visibleFrom).toBe(afterWheel.visibleFrom);
    expect(model.time.visibleTo).toBe(afterWheel.visibleTo);
    m.engine.destroy();
  });
});
