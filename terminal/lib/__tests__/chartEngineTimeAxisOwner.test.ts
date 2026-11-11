// @vitest-environment jsdom
// The mm engine draws its time axis INSIDE a pane (LWC keeps a separate always-visible
// row). When the product maximises a pane it squashes every other pane to ~0 px and
// hides it, so the axis must follow the last pane that is tall enough to hold it —
// otherwise maximising any pane but the last makes the time axis disappear.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanvasEngine, createManualScheduler } from "../chart-engine/canvas";
import { paintOverlayFrame } from "../chart-engine/canvas/frame";
import {
  hitTestEngineInput,
  TIME_AXIS_HIT_HEIGHT_PX,
  timeAxisOwnerBottom,
  timeAxisOwnerPane,
} from "../chart-engine/canvas/inputBridge";
import type { ChartModel } from "../chart-engine/canvas/model";

type Call = { method: string; args: unknown[] };
type Ctx = CanvasRenderingContext2D & { __calls: Call[] };
const ctxByCanvas = new WeakMap<HTMLCanvasElement, Ctx>();

function makeFakeCtx(): Ctx {
  const calls: Call[] = [];
  const rec = (method: string) => (...args: unknown[]) => { calls.push({ method, args }); };
  const ctx: Record<string, unknown> = { __calls: calls };
  for (const m of [
    "setTransform", "fillRect", "clearRect", "drawImage", "beginPath", "moveTo", "lineTo",
    "stroke", "fill", "save", "restore", "scale", "translate", "rect", "closePath",
    "fillText", "strokeRect", "arc", "clip", "setLineDash",
  ]) ctx[m] = rec(m);
  ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  ctx.measureText = (t: string) => ({ width: t.length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
  return ctx as unknown as Ctx;
}

// The in-pane time axis is the only painter of hh:mm labels (timeVisible: true);
// price labels carry decimals and the crosshair never reaches a pane canvas.
const CLOCK = /^\d{2}:\d{2}$/;
function clockLabels(canvas: HTMLCanvasElement): string[] {
  const calls = ctxByCanvas.get(canvas)?.__calls ?? [];
  return calls.filter((c) => c.method === "fillText" && CLOCK.test(String(c.args[0]))).map((c) => String(c.args[0]));
}
function resetCalls(root: HTMLElement): void {
  for (const canvas of Array.from(root.querySelectorAll("canvas"))) {
    const c = ctxByCanvas.get(canvas as HTMLCanvasElement);
    if (c) c.__calls.length = 0;
  }
}

const ROWS = Array.from({ length: 40 }, (_, i) => ({
  time: 1700000000 + i * 3600, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i,
}));

describe("timeAxisOwnerPane: the last pane tall enough for the band", () => {
  it("is the last pane on an ordinary layout and the maximised pane when the rest are squashed", () => {
    expect(timeAxisOwnerPane([200, 100])).toBe(1);
    expect(timeAxisOwnerPane([300])).toBe(0);
    // ChartPanel maximise: stretch 1000 vs 0.0001 -> others floor to 0, the last keeps the 1-px remainder.
    expect(timeAxisOwnerPane([0, 299, 1])).toBe(1);
    expect(timeAxisOwnerPane([299, 0, 1])).toBe(0);
    expect(timeAxisOwnerBottom([0, 299, 1])).toBe(299);
    expect(timeAxisOwnerBottom([200, 100])).toBe(300);
  });

  it("falls back to the last pane when no pane can hold the band", () => {
    expect(timeAxisOwnerPane([5, 3])).toBe(1);
    expect(timeAxisOwnerPane([])).toBe(0);
    expect(timeAxisOwnerPane([TIME_AXIS_HIT_HEIGHT_PX - 1, TIME_AXIS_HIT_HEIGHT_PX - 1])).toBe(1);
  });
});

describe("hitTestEngineInput: the time-axis band moves with the owner pane", () => {
  const strip = [68, 68, 68] as const;

  it("ordinary layout: only the last pane's bottom band is the time axis", () => {
    const layout = { widthPx: 400, paneHeights: [200, 100] as const, priceAxisWidthPx: [68, 68] as const };
    expect(hitTestEngineInput(100, 290, layout)).toEqual({ region: "timeAxis", paneIndex: 1 });
    expect(hitTestEngineInput(100, 190, layout)).toEqual({ region: "plot", paneIndex: 0 });
    expect(hitTestEngineInput(100, 310, layout)).toEqual({ region: "timeAxis", paneIndex: 1 }); // below the chart, as before
  });

  it("maximised middle pane: the band sits at the bottom of the maximised pane", () => {
    const layout = { widthPx: 400, paneHeights: [0, 299, 1] as const, priceAxisWidthPx: strip };
    expect(hitTestEngineInput(100, 290, layout)).toEqual({ region: "timeAxis", paneIndex: 1 });
    expect(hitTestEngineInput(100, 270, layout)).toEqual({ region: "plot", paneIndex: 1 });
    // The strip still wins over the band to the right of the plot.
    expect(hitTestEngineInput(380, 290, layout)).toEqual({ region: "priceAxis", paneIndex: 1 });
  });

  it("maximised first pane: the band is in pane 0, the squashed panes below are not the band", () => {
    const layout = { widthPx: 400, paneHeights: [299, 0, 1] as const, priceAxisWidthPx: strip };
    expect(hitTestEngineInput(100, 290, layout)).toEqual({ region: "timeAxis", paneIndex: 0 });
    expect(hitTestEngineInput(100, 299.5, layout).region).not.toBe("timeAxis");
  });
});

describe("overlay crosshair time label follows the owner pane", () => {
  function recorder() {
    const calls: Call[] = [];
    const ctx: Record<string, unknown> = {
      fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "left", textBaseline: "alphabetic",
      setLineDash: () => {},
      measureText: (t: string) => ({ width: t.length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    };
    for (const m of ["clearRect", "beginPath", "moveTo", "lineTo", "stroke", "fill", "fillRect", "fillText", "save", "restore", "rect", "closePath", "arc"]) {
      ctx[m] = (...args: unknown[]) => { calls.push({ method: m, args }); };
    }
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }
  function model(heights: number[]): ChartModel {
    const time = Date.UTC(2026, 0, 6) / 1000;
    return {
      options: { timeScale: { visible: true } },
      time: { widthPx: 400 },
      totalHeight: heights.reduce((a, b) => a + b, 0),
      dpr: 1,
      panes: heights.map((height) => ({ height })),
      chartWidthPx: () => 460,
      xOfLogical: (i: number) => i * 10 + 5,
      logicalOfX: (x: number) => (x - 5) / 10,
      coordinateToTime: () => time as never,
    } as unknown as ChartModel;
  }
  function labelBox(calls: Call[]): { y: number; h: number } {
    // roundRectPath falls back to rect(x, y, w, h) on a ctx without roundRect.
    const rect = calls.find((c) => c.method === "rect");
    expect(rect).toBeDefined();
    return { y: rect!.args[1] as number, h: rect!.args[3] as number };
  }

  it("sits on the chart bottom for an ordinary layout and on the maximised pane's bottom otherwise", () => {
    const a = recorder();
    paintOverlayFrame({ ctx: a.ctx, model: model([200, 100]), point: { x: 103, y: 50 }, axes: [] });
    const box = labelBox(a.calls);
    expect(box.y + box.h).toBe(300);

    const b = recorder();
    paintOverlayFrame({ ctx: b.ctx, model: model([0, 299, 1]), point: { x: 103, y: 150 }, axes: [] });
    const maxBox = labelBox(b.calls);
    expect(maxBox.y + maxBox.h).toBe(299);
  });
});

describe("engine paints the in-pane time axis in the owner pane", () => {
  let container: HTMLDivElement;
  beforeEach(() => {
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

  it("moves the axis from the last pane to the maximised pane and back", () => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 400, height: 300, devicePixelRatio: 1, scheduler, now: () => 0,
      timeScale: { timeVisible: true },
    });
    engine.addSeries("candles", { upColor: "U", downColor: "D" }, 0).setData(ROWS);
    engine.addSeries("line", { color: "L" }, 1).setData(ROWS.map((r) => ({ time: r.time, value: r.close })));
    engine.addSeries("line", { color: "L" }, 2).setData(ROWS.map((r) => ({ time: r.time, value: r.close })));
    engine.timeScale().setVisibleLogicalRange({ from: 0, to: 20 });
    scheduler.flush();
    const root = engine.chartElement();
    const canvas = (i: number) => root.querySelector(`canvas[data-mm-pane-canvas='${i}']`) as HTMLCanvasElement;
    expect(engine.panes()).toHaveLength(3);

    // Ordinary layout: the last pane holds the axis, nobody else does.
    expect(clockLabels(canvas(2)).length).toBeGreaterThan(0);
    expect(clockLabels(canvas(0))).toEqual([]);
    expect(clockLabels(canvas(1))).toEqual([]);

    // ChartPanel.doMaximize on pane 1: stretch 1000 vs 0.0001 for the rest.
    resetCalls(root);
    engine.panes()[0].setStretchFactor(0.0001);
    engine.panes()[1].setStretchFactor(1000);
    engine.panes()[2].setStretchFactor(0.0001);
    scheduler.flush();
    const heights = engine.panes().map((_, i) => engine.paneSize(i).height);
    expect(heights[1]).toBeGreaterThan(290);
    expect(heights[0]).toBeLessThan(TIME_AXIS_HIT_HEIGHT_PX);
    expect(heights[2]).toBeLessThan(TIME_AXIS_HIT_HEIGHT_PX);
    expect(clockLabels(canvas(1)).length).toBeGreaterThan(0);
    expect(clockLabels(canvas(2))).toEqual([]);
    expect(clockLabels(canvas(0))).toEqual([]);

    // Restore: the axis returns to the last pane.
    resetCalls(root);
    for (const p of engine.panes()) p.setStretchFactor(1);
    scheduler.flush();
    expect(clockLabels(canvas(2)).length).toBeGreaterThan(0);
    expect(clockLabels(canvas(1))).toEqual([]);
    engine.destroy();
  });
});
