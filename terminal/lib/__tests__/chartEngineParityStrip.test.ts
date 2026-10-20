// @vitest-environment jsdom
// PAR-STRIP — mm engine price-axis strip parity against LWC.
//
// LWC settles the price-axis strip in ChartWidget._adjustSizeImpl
// (lightweight-charts.development.mjs:10938): every pane's PriceAxisWidget reports
// _internal_optimalWidth() (:9107, measured from that pane's own labels), the strip
// takes the WIDEST per side (:10944-10947), suggestPriceScaleWidth rounds it even
// (:7943), and the pane — the plot — keeps width - strip (:10955). mm mirrors this in
// canvas/index.ts settlePriceAxis(), which publishes model.priceAxisStripPx (per pane)
// and model.priceAxisWidthPx (shared). inputBridge.hitTestEngineInput must treat a
// published 0 as "the plot runs to the right edge"; only an OMITTED publication falls
// back to the 40-px PRICE_AXIS_HIT_WIDTH_PX floor.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanvasEngine, createManualScheduler } from "../chart-engine/canvas";
import { hitTestEngineInput, PRICE_AXIS_HIT_WIDTH_PX } from "../chart-engine/canvas/inputBridge";
import type { EngineSeriesRow } from "../chart-engine/api";

type Call = { method: string; args: unknown[] };
type Ctx = CanvasRenderingContext2D & { __calls: Call[] };
type Engine = ReturnType<typeof createCanvasEngine>;
const ctxByCanvas = new WeakMap<HTMLCanvasElement, Ctx>();

// Labels measure 7 px per character so label LENGTH moves the measured strip
// (PriceAxisWidget._internal_optimalWidth maxes the label text width, dev:9120-9144).
function makeFakeCtx(): Ctx {
  const calls: Call[] = [];
  const rec = (method: string) => (...args: unknown[]) => { calls.push({ method, args }); };
  const ctx: Record<string, unknown> = { __calls: calls };
  for (const m of [
    "setTransform", "fillRect", "clearRect", "drawImage", "beginPath", "moveTo", "lineTo",
    "stroke", "fill", "save", "restore", "scale", "translate", "rect", "closePath",
    "fillText", "strokeRect", "arc", "clip", "setLineDash", "roundRect",
  ]) ctx[m] = rec(m);
  ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  ctx.measureText = (text: string) => ({ width: String(text).length * 7 }) as TextMetrics;
  return ctx as unknown as Ctx;
}

const WIDTH = 700;
const HEIGHT = 300;
// Two panes split HEIGHT 1:1 (layoutHeights floors the first half); a lone-probe
// engine must give its series the SAME pane height so the price marks — and with
// them the measured optimal width — come out identical.
const PANE_HEIGHT = HEIGHT / 2;

const CANDLE_ROWS: EngineSeriesRow[] = Array.from({ length: 40 }, (_, i) => ({
  time: 1700000000 + i * 3600, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i,
}));
/** ~1,000,000-scale labels measure far wider than ~100-scale ones at 7 px/char. */
const MILLION_ROWS: EngineSeriesRow[] = Array.from({ length: 40 }, (_, i) => ({
  time: 1700000000 + i * 3600, value: 1000000 + i * 137,
}));
const HUNDRED_MILLION_ROWS: EngineSeriesRow[] = Array.from({ length: 40 }, (_, i) => ({
  time: 1700000000 + i * 3600, value: 100000000 + i * 137,
}));
/** ~100-scale line values that still vary, so the axis has real labels to draw. */
const HUNDRED_ROWS: EngineSeriesRow[] = Array.from({ length: 40 }, (_, i) => ({
  time: 1700000000 + i * 3600, value: 100 + (i % 7) * 0.5,
}));

let container: HTMLDivElement;
let nowMs = 0;

function dispatchPointer(el: EventTarget, type: string, x: number, y: number, ts: number): void {
  const ev = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  Object.defineProperty(ev, "pointerType", { value: "mouse" });
  Object.defineProperty(ev, "timeStamp", { value: ts });
  el.dispatchEvent(ev);
}

function mount(opts: Record<string, unknown> = {}): {
  engine: Engine;
  scheduler: ReturnType<typeof createManualScheduler>;
} {
  const scheduler = createManualScheduler();
  const engine = createCanvasEngine(container, {
    width: WIDTH, height: HEIGHT, devicePixelRatio: 1, scheduler, now: () => nowMs, ...opts,
  });
  return { engine, scheduler };
}

/** The strip an engine publishes for ONE series alone, in a pane of `height` px. */
function stripOfLoneSeries(kind: "candles" | "line", rows: EngineSeriesRow[], height = PANE_HEIGHT): number {
  const holder = document.createElement("div");
  document.body.appendChild(holder);
  try {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(holder, {
      width: WIDTH, height, devicePixelRatio: 1, scheduler, now: () => nowMs,
    });
    const s = engine.addSeries(kind, kind === "candles" ? { upColor: "U", downColor: "D" } : { color: "L" });
    s.setData(rows);
    scheduler.flush();
    const strip = WIDTH - engine.timeScale().width();
    engine.destroy();
    return strip;
  } finally {
    holder.remove();
  }
}

function paneCtxOf(engine: Engine, paneIndex: number): Ctx {
  const canvas = engine.chartElement().querySelector(
    `canvas[data-mm-pane-canvas="${paneIndex}"]`,
  ) as HTMLCanvasElement;
  const ctx = ctxByCanvas.get(canvas);
  if (!ctx) throw new Error(`no fake ctx recorded for pane ${paneIndex}`);
  return ctx;
}

/**
 * The x where the pane's price-axis strip painted last. paintPriceAxisStrip opens with
 * ctx.clearRect(x0, 0, width, h) at x0 = the plot edge (frame.ts:621) — the ONLY
 * clearRect with x > 0 a pane frame issues.
 */
function stripXOf(engine: Engine, paneIndex: number): number {
  const calls = paneCtxOf(engine, paneIndex).__calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (c.method === "clearRect" && (c.args[0] as number) > 0) return c.args[0] as number;
  }
  return -1;
}

/** How many times the pane painted in the recorded window (one strip clear per paint). */
function paintCountOf(ctx: Ctx): number {
  return ctx.__calls.filter((c) => c.method === "clearRect" && (c.args[0] as number) > 0).length;
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

describe("mm price-axis strip parity (PAR-STRIP)", () => {
  it("S1 the strip takes the WIDEST pane's optimal width and every pane paints it at one shared x", () => {
    const { engine, scheduler } = mount();
    const candles = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    candles.setData(CANDLE_ROWS);
    const line = engine.addSeries("line", { color: "L" }, 1);
    line.setData(MILLION_ROWS);
    scheduler.flush();

    const plot = engine.timeScale().width();
    const strip = WIDTH - plot;
    // What each pane's data measures ALONE, in an equal-height pane: LWC takes the
    // widest pane's optimal width (ChartWidget._adjustSizeImpl, dev:10944-10947).
    const wideAlone = stripOfLoneSeries("line", MILLION_ROWS);
    const narrowAlone = stripOfLoneSeries("candles", CANDLE_ROWS);
    expect(narrowAlone).toBeGreaterThan(0);
    expect(wideAlone).toBeGreaterThan(narrowAlone); // "widest" is genuinely wider
    expect(strip).toBe(wideAlone);

    // One strip across panes: both panes paint it starting at the same x — the plot edge.
    expect(stripXOf(engine, 0)).toBe(plot);
    expect(stripXOf(engine, 1)).toBe(plot);
    // The published per-pane strip is the shared width for every pane.
    expect(engine.priceScale("right", 0).width()).toBe(strip);
    expect(engine.priceScale("right", 1).width()).toBe(strip);
    engine.destroy();
  });

  it("S2 the settled strip follows the data: longer labels shrink the plot, shorter labels grow it back", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("line", { color: "L" });
    s.setData(HUNDRED_ROWS);
    scheduler.flush();
    const before = engine.timeScale().width();
    expect(before).toBeLessThan(WIDTH); // a strip is published at all
    expect(engine.priceScale("right").width()).toBe(WIDTH - before);

    s.setData(HUNDRED_MILLION_ROWS); // longer labels -> a wider strip
    scheduler.flush();
    const wider = engine.timeScale().width();
    expect(wider).toBeLessThan(before);

    s.setData(HUNDRED_ROWS); // back to the original labels
    scheduler.flush();
    expect(engine.timeScale().width()).toBe(before);
    engine.destroy();
  });

  it("S3 a hidden price scale publishes 0: the plot runs to the right edge and the edge pointer hits the plot", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("line", { color: "L" });
    s.setData(HUNDRED_ROWS);
    scheduler.flush();
    expect(engine.timeScale().width()).toBeLessThan(WIDTH); // drawn and published before hiding

    engine.priceScale("right").applyOptions({ visible: false });
    scheduler.flush();
    expect(engine.timeScale().width()).toBe(WIDTH); // published 0: plot = full container

    // Capture AFTER the hide flush so only the pointer can move the window (the
    // resize itself also re-derives the visible range).
    const logicalBefore = engine.timeScale().getVisibleLogicalRange();
    const priceBefore = s.priceScale().getVisibleRange();
    const overlay = engine.chartElement().querySelector("[data-mm-overlay]") as HTMLElement;
    const y = HEIGHT / 2;
    dispatchPointer(overlay, "pointerdown", WIDTH - 3, y, 0);
    nowMs = 20;
    dispatchPointer(overlay, "pointermove", WIDTH - 43, y, 20);
    dispatchPointer(overlay, "pointerup", WIDTH - 43, y, 20);
    // A plot pointer pans time (the observable effect chartEngineInputHitRegions uses);
    // a pointer that landed on a price axis never does.
    expect(engine.timeScale().getVisibleLogicalRange()).not.toEqual(logicalBefore);
    expect(s.priceScale().getVisibleRange()).toEqual(priceBefore);
    engine.destroy();
  });

  it("S4 direct hitTestEngineInput: a published 0 is the axis-less edge; an omitted strip is the 40-px floor", () => {
    const zero = { widthPx: 400, paneHeights: [300] as const, priceAxisWidthPx: [0] as const };
    const omitted = { widthPx: 400, paneHeights: [300] as const };
    // Published 0: x=395 < 400 - 0 -> the plot reaches the right edge.
    expect(hitTestEngineInput(395, 150, zero).region).toBe("plot");
    // Omitted: the 40-px floor claims x=395 (>= 400 - 40).
    expect(hitTestEngineInput(395, 150, omitted).region).toBe("priceAxis");
    expect(hitTestEngineInput(395, 150, omitted)).toEqual({
      region: "priceAxis", paneIndex: 0,
    });
    // Published 0 in the 24-px time-axis band (y >= 300 - 24) below an axis-less plot.
    expect(hitTestEngineInput(395, 290, zero)).toEqual({ region: "timeAxis", paneIndex: 0 });
    expect(PRICE_AXIS_HIT_WIDTH_PX).toBe(40);
  });

  it("S5 one requested frame paints each pane canvas at most 3 times (settle re-measures at most twice)", () => {
    const { engine, scheduler } = mount();
    const s = engine.addSeries("line", { color: "L" });
    s.setData(MILLION_ROWS);
    scheduler.flush(); // initial frame: the strip settles before the observed window
    const ctx = paneCtxOf(engine, 0);
    ctx.__calls.length = 0;

    s.setData(HUNDRED_MILLION_ROWS); // a data change the strip must follow: settle re-measures
    scheduler.flush(); // exactly one requested frame
    const paints = paintCountOf(ctx);
    expect(paints).toBeGreaterThanOrEqual(1);
    expect(paints).toBeLessThanOrEqual(3);
    engine.destroy();
  });
});
