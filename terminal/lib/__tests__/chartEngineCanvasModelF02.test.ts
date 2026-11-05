// @vitest-environment jsdom
// F-02: Canvas ChartModel honours log / percent / indexed100 end to end.
// Fails on BASE because priceScaleMath is linear-only and autoscale skips
// non-normal modes; applyOptions does not forward right/left price-scale bags.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChartModel } from "@/lib/chart-engine/canvas/model";
import { createCanvasEngine, createManualScheduler } from "@/lib/chart-engine/canvas";
import type { EngineSeriesRow } from "@/lib/chart-engine/api";

type Call = { method: string; args: unknown[] };
const ctxByCanvas = new WeakMap<HTMLCanvasElement, { __calls: Call[] }>();

function makeFakeCtx(): CanvasRenderingContext2D & { __calls: Call[] } {
  const calls: Call[] = [];
  const rec = (method: string) => (...args: unknown[]) => { calls.push({ method, args }); };
  const ctx: Record<string, unknown> = { __calls: calls };
  for (const m of [
    "setTransform", "fillRect", "clearRect", "drawImage", "beginPath", "moveTo", "lineTo", "stroke",
    "fill", "save", "restore", "scale", "translate", "rect", "closePath", "fillText", "strokeRect",
  ]) ctx[m] = rec(m);
  ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  return ctx as unknown as CanvasRenderingContext2D & { __calls: Call[] };
}

function relErr(a: number, b: number): number {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-12);
  return Math.abs(a - b) / scale;
}

function makeModel(): ChartModel {
  return new ChartModel({ onInvalidate: () => undefined, onStructure: () => undefined });
}

const RATIO_ROWS: EngineSeriesRow[] = [
  { time: 1000, value: 10 },
  { time: 2000, value: 100 },
  { time: 3000, value: 1000 },
];

// coordOffset 0.0001 (axisZoom.ts / LWC defLogFormula, dev:4180-4183) is negligible
// at these magnitudes, so equal ratios must yield equal pixel gaps within 1e-6.
const LOG_ROWS: EngineSeriesRow[] = [
  { time: 1000, value: 1e6 },
  { time: 2000, value: 1e7 },
  { time: 3000, value: 1e8 },
];

describe("F-02 log/percent/indexed100 end to end", () => {
  it("ChartModel.applyOptions forwards right/left mode, invertScale, scaleMargins", () => {
    const m = makeModel();
    m.applyOptions({
      width: 200,
      height: 400,
      rightPriceScale: { mode: "log", invertScale: true, scaleMargins: { top: 0.05, bottom: 0.25 } },
      leftPriceScale: { mode: "percent", invertScale: false, scaleMargins: { top: 0.1, bottom: 0.1 } },
    });
    expect(m.priceScaleHandle("right").options()).toMatchObject({
      mode: "log",
      invertScale: true,
      scaleMargins: { top: 0.05, bottom: 0.25 },
    });
    expect(m.priceScaleHandle("left").options()).toMatchObject({
      mode: "percent",
      invertScale: false,
      scaleMargins: { top: 0.1, bottom: 0.1 },
    });
  });

  it("accepts LWC numeric PriceScaleMode 0|1|2|3 on priceScale().applyOptions", () => {
    const m = makeModel();
    m.applyOptions({ width: 200, height: 400 });
    const right = m.priceScaleHandle("right");
    right.applyOptions({ mode: 1 });
    expect(right.options().mode).toBe("log");
    right.applyOptions({ mode: 2 });
    expect(right.options().mode).toBe("percent");
    right.applyOptions({ mode: 3 });
    expect(right.options().mode).toBe("indexed100");
    right.applyOptions({ mode: 0 });
    expect(right.options().mode).toBe("normal");
    right.applyOptions({ mode: "indexed100" });
    expect(right.options().mode).toBe("indexed100");
  });

  it("log: equal ratios → equal pixel gaps, round-trip, autoscale fits visible data", () => {
    const m = makeModel();
    m.applyOptions({ width: 200, height: 400, rightPriceScale: { mode: "log" } });
    const s = m.addSeries("line");
    s.setData(LOG_ROWS);
    const y6 = s.priceToCoordinate(1e6);
    const y7 = s.priceToCoordinate(1e7);
    const y8 = s.priceToCoordinate(1e8);
    expect(y6).not.toBeNull();
    expect(y7).not.toBeNull();
    expect(y8).not.toBeNull();
    const gapA = y7! - y6!;
    const gapB = y8! - y7!;
    expect(Math.abs(gapA - gapB)).toBeLessThan(1e-6);

    for (const p of [1e6, 1e7, 1e8, 5e6, 2.5e7, Math.PI * 1e6]) {
      const y = s.priceToCoordinate(p);
      expect(y).not.toBeNull();
      const back = s.coordinateToPrice(y!);
      expect(back).not.toBeNull();
      expect(relErr(back!, p)).toBeLessThan(1e-9);
    }

    expect(s.priceScale().getVisibleRange()).toEqual({ from: 1e6, to: 1e8 });
  });

  it("percent maps the first visible value to 0 on the axis", () => {
    const m = makeModel();
    m.applyOptions({ width: 200, height: 400 });
    const s = m.addSeries("line");
    s.setData(RATIO_ROWS);
    s.priceScale().applyOptions({ mode: "percent" });
    const range = s.priceScale().getVisibleRange();
    expect(range).not.toBeNull();
    expect(range!.from).toBeCloseTo(0, 9);
    expect(range!.to).toBeCloseTo(9900, 6);

    const yBase = s.priceToCoordinate(10);
    expect(yBase).not.toBeNull();
    // Autoscale puts display 0 (the base) on the internal bottom edge.
    const yRestored = s.coordinateToPrice(yBase!);
    expect(yRestored).not.toBeNull();
    expect(relErr(yRestored!, 10)).toBeLessThan(1e-9);

    m.setVisibleLogicalRange({ from: 1, to: 3 });
    const shifted = s.priceScale().getVisibleRange();
    expect(shifted).not.toBeNull();
    expect(shifted!.from).toBeCloseTo(0, 9);
    expect(s.coordinateToPrice(s.priceToCoordinate(100)!)!).toBeCloseTo(100, 6);
  });

  it("indexed100 maps the first visible value to 100 on the axis", () => {
    const m = makeModel();
    m.applyOptions({ width: 200, height: 400 });
    const s = m.addSeries("line");
    s.setData(RATIO_ROWS);
    s.priceScale().applyOptions({ mode: "indexed100" });
    const range = s.priceScale().getVisibleRange();
    expect(range).not.toBeNull();
    expect(range!.from).toBeCloseTo(100, 9);
    expect(range!.to).toBeCloseTo(10000, 6);
    expect(relErr(s.coordinateToPrice(s.priceToCoordinate(10)!)!, 10)).toBeLessThan(1e-9);
  });
});

describe("F-02 via engine priceScale().applyOptions (construction still refuses log)", () => {
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
      return ctx as unknown as CanvasRenderingContext2D;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  it("priceScale().applyOptions({mode:'log'}) is a log mapping through the engine", () => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, { width: 200, height: 400, devicePixelRatio: 1, scheduler });
    const s = engine.addSeries("line");
    s.setData(LOG_ROWS);
    s.priceScale().applyOptions({ mode: "log" });
    expect(s.priceScale().options().mode).toBe("log");
    const y6 = s.priceToCoordinate(1e6)!;
    const y7 = s.priceToCoordinate(1e7)!;
    const y8 = s.priceToCoordinate(1e8)!;
    expect(Math.abs((y7 - y6) - (y8 - y7))).toBeLessThan(1e-6);
    expect(s.priceScale().getVisibleRange()).toEqual({ from: 1e6, to: 1e8 });
    engine.destroy();
  });
});
