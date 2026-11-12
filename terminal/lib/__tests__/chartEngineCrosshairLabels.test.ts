import { describe, expect, it } from "vitest";
import { LWC_CROSSHAIR, paintOverlayFrame, type PaneAxisState } from "../chart-engine/canvas/frame";
import type { ChartModel } from "../chart-engine/canvas/model";

type Call = { method: string; args: unknown[]; fillStyle?: unknown; dash?: number[] };

function recorder() {
  const calls: Call[] = [];
  let dash: number[] = [];
  const ctx: Record<string, unknown> = {
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "left", textBaseline: "alphabetic",
    setLineDash: (d: number[]) => { dash = d; },
    measureText: (t: string) => ({ width: t.length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
  };
  for (const m of ["clearRect", "beginPath", "moveTo", "lineTo", "stroke", "fill", "fillRect", "fillText", "save", "restore", "rect", "closePath", "arc"]) {
    ctx[m] = (...args: unknown[]) => { calls.push({ method: m, args, fillStyle: ctx.fillStyle, dash: [...dash] }); };
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function model(options: Record<string, unknown> = {}): ChartModel {
  const time = Date.UTC(2026, 0, 6) / 1000;
  return {
    options: { timeScale: { visible: true }, ...options },
    time: { widthPx: 400 },
    totalHeight: 300,
    dpr: 1,
    panes: [{ height: 200 }, { height: 100 }],
    chartWidthPx: () => 460,
    xOfLogical: (i: number) => i * 10 + 5,
    logicalOfX: (x: number) => (x - 5) / 10,
    coordinateToTime: () => time as never,
  } as unknown as ChartModel;
}

const axis = {
  axisVisible: true, hasFirst: true, ticksVisible: true,
  scale: { mode: 0, heightPx: 200, range: { from: 0, to: 200 }, margins: { top: 0, bottom: 0 }, invertScale: false },
  fmt: { formatPrice: (p: number) => `P${Math.round(p)}` },
  ro: { tickLength: 5, paddingInner: 5, paddingOuter: 5, paddingTop: 2.5, paddingBottom: 2.5, borderSize: 1, fontSize: 12, font: "12px x", baselineOffset: 0 },
} as unknown as PaneAxisState;

describe("mm crosshair overlay (LWC parity)", () => {
  it("draws LargeDashed lines snapped to the bar, a formatted price label and a dd MMM 'yy time label", () => {
    const { ctx, calls } = recorder();
    paintOverlayFrame({ ctx, model: model(), point: { x: 103, y: 50 }, axes: [axis] });
    const moves = calls.filter((c) => c.method === "moveTo");
    expect(moves).toHaveLength(2);
    expect(moves[0].args[0]).toBe(105.5); // bar 10 centre, not the raw pointer x
    expect(moves[0].dash).toEqual([6, 6]);
    const texts = calls.filter((c) => c.method === "fillText").map((c) => String(c.args[0]));
    expect(texts.some((t) => t.startsWith("P"))).toBe(true);
    expect(texts).toContain("06 Jan '26");
    const label = calls.find((c) => c.method === "fillText" && c.args[0] === "06 Jan '26")!;
    expect(label.fillStyle).not.toBe(LWC_CROSSHAIR.labelBackground);
  });

  it("draws nothing over the price axis strip, in Hidden mode, or for an empty line colour", () => {
    for (const [opts, point] of [
      [{}, { x: 430, y: 50 }],
      [{ crosshair: { mode: 2 } }, { x: 103, y: 50 }],
    ] as const) {
      const { ctx, calls } = recorder();
      paintOverlayFrame({ ctx, model: model(opts as Record<string, unknown>), point, axes: [axis] });
      expect(calls.filter((c) => c.method !== "clearRect")).toHaveLength(0);
    }
    const { ctx, calls } = recorder();
    paintOverlayFrame({ ctx, model: model({ crosshair: { vertLine: { color: "", labelVisible: false }, horzLine: { color: "", labelVisible: false } } }), point: { x: 103, y: 50 }, axes: [axis] });
    expect(calls.filter((c) => c.method === "moveTo" || c.method === "fillText")).toHaveLength(0);
  });

  it("keeps the horizontal line and price label to the hovered pane and adds the clock when timeVisible", () => {
    const { ctx, calls } = recorder();
    paintOverlayFrame({ ctx, model: model({ timeScale: { visible: true, timeVisible: true } }), point: { x: 103, y: 250 }, axes: [axis] });
    const texts = calls.filter((c) => c.method === "fillText").map((c) => String(c.args[0]));
    expect(texts.some((t) => t.startsWith("P"))).toBe(false); // pane 1 has no settled axis
    expect(texts).toContain("06 Jan '26   00:00");
  });
});
