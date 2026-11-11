// @vitest-environment jsdom
// Series-marker parity with lightweight-charts (series-markers/utils + pane-view +
// PriceScale._recalculatePriceRangeImpl): the glyph size/margin formulas, the
// autoscale pixel bands a series with markers reserves, and how those bands reach
// every coordinate mapping (painter, ticks, gestures) through effectiveMargins.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanvasEngine, createManualScheduler } from "../chart-engine/canvas";
import {
  markerAutoscaleMargins,
  markerShapeHeight,
  markerShapeMargin,
  markerShapeSize,
} from "../chart-engine/canvas/decorations";
import type { ChartModel } from "../chart-engine/canvas/model";
import { effectiveMargins, type PriceScaleState } from "../chart-engine/canvas/scales";
import type { MarkerSpec } from "../chart-engine/api";

describe("LWC marker size formulas", () => {
  it("size(bs, coeff) = ceiledOdd(clamp(bs, 12, 30) × coeff) per shape", () => {
    // bs 10 clamps to 12: arrow 11, circle ceiledOdd(9.6) = 9, square ceiledOdd(8.4) = 9
    expect(markerShapeSize("arrowUp", 10)).toBe(11);
    expect(markerShapeSize("arrowDown", 10)).toBe(11);
    expect(markerShapeSize("circle", 10)).toBe(9);
    expect(markerShapeSize("square", 10)).toBe(9);
    // bs 20: arrow 19, circle ceiledOdd(16) = 15, square ceiledOdd(14) = 13
    expect(markerShapeSize("arrowUp", 20)).toBe(19);
    expect(markerShapeSize("circle", 20)).toBe(15);
    expect(markerShapeSize("square", 20)).toBe(13);
    // bs 100 clamps to 30: arrow 29, circle ceiledOdd(24) = 23, square 21
    expect(markerShapeSize("arrowUp", 100)).toBe(29);
    expect(markerShapeSize("circle", 100)).toBe(23);
    expect(markerShapeSize("square", 100)).toBe(21);
  });

  it("calculateShapeHeight is ceiledEven(size(bs, 1)); shapeMargin is max(size(bs, 0.1), 3)", () => {
    expect(markerShapeHeight(10)).toBe(10);
    expect(markerShapeHeight(20)).toBe(18);
    expect(markerShapeHeight(30)).toBe(28);
    expect(markerShapeMargin(10)).toBe(3);
    expect(markerShapeMargin(20)).toBe(3); // ceiledOdd(2) = 1 -> floor 3
    expect(markerShapeMargin(30)).toBe(3); // ceiledOdd(3) = 3
  });
});

describe("markerAutoscaleMargins (LWC _getAutoScaleMargins)", () => {
  const m = (position: MarkerSpec["position"], time = 1): MarkerSpec => ({ time, position, shape: "circle", color: "c" });
  // bs 10: marginValue = 10 × 1.5 + 3 × 2 = 21
  const FULL = 21;

  it("reserves the full margin on a side that has markers, half (ceil) for inBar only, 0 otherwise", () => {
    expect(markerAutoscaleMargins([m("aboveBar")], 10)).toEqual({ above: FULL, below: 0 });
    expect(markerAutoscaleMargins([m("belowBar")], 10)).toEqual({ above: 0, below: FULL });
    expect(markerAutoscaleMargins([m("inBar")], 10)).toEqual({ above: 11, below: 11 });
    expect(markerAutoscaleMargins([m("aboveBar"), m("inBar")], 10)).toEqual({ above: FULL, below: 11 });
    expect(markerAutoscaleMargins([m("aboveBar"), m("belowBar")], 10)).toEqual({ above: FULL, below: FULL });
  });

  it("price markers reserve nothing; no markers or a NaN bar spacing yields null", () => {
    expect(markerAutoscaleMargins([m("atPriceTop"), m("atPriceBottom"), m("atPriceMiddle")], 10))
      .toEqual({ above: 0, below: 0 });
    expect(markerAutoscaleMargins([], 10)).toBeNull();
    expect(markerAutoscaleMargins([m("aboveBar")], NaN)).toBeNull();
  });

  it("scales with the bar spacing", () => {
    // bs 20: 18 × 1.5 + 3 × 2 = 33
    expect(markerAutoscaleMargins([m("aboveBar")], 20)).toEqual({ above: 33, below: 0 });
  });
});

describe("effectiveMargins", () => {
  const base = (over: Partial<PriceScaleState> = {}): PriceScaleState => ({
    mode: "normal", inverted: false, from: 0, to: 100, heightPx: 200,
    margins: { top: 0.2, bottom: 0.1 }, ...over,
  });

  it("returns the option margins untouched when no pixel band is reserved", () => {
    const state = base();
    expect(effectiveMargins(state)).toBe(state.margins);
    expect(effectiveMargins(base({ marginAbovePx: 0, marginBelowPx: 0 }))).toEqual({ top: 0.2, bottom: 0.1 });
    expect(effectiveMargins(base({ marginAbovePx: NaN, marginBelowPx: -4 }))).toEqual({ top: 0.2, bottom: 0.1 });
  });

  it("adds each band as a fraction of the height on its own side", () => {
    expect(effectiveMargins(base({ marginAbovePx: 20, marginBelowPx: 10 })))
      .toEqual({ top: 0.2 + 0.1, bottom: 0.1 + 0.05 });
  });

  it("swaps the whole pair on an inverted scale (LWC _topMarginPx / _bottomMarginPx)", () => {
    // Inverted: the inverse coordinate starts at the screen top, so `bottom` (its
    // origin) carries scaleMargins.top + the above band and `top` carries
    // scaleMargins.bottom + the below band. Option fractions swap even with no bands.
    expect(effectiveMargins(base({ inverted: true })))
      .toEqual({ top: 0.1, bottom: 0.2 });
    expect(effectiveMargins(base({ inverted: true, marginAbovePx: 20, marginBelowPx: 10 })))
      .toEqual({ top: 0.1 + 0.05, bottom: 0.2 + 0.1 });
  });

  it("ignores the bands on a zero-height scale", () => {
    const state = base({ heightPx: 0, marginAbovePx: 20 });
    expect(effectiveMargins(state)).toBe(state.margins);
    expect(effectiveMargins(base({ heightPx: 0, inverted: true, marginAbovePx: 20 })))
      .toEqual({ top: 0.1, bottom: 0.2 });
  });
});

// ── Engine level: markers push the autoscaled range inward by the reserved band ──

function makeFakeCtx(): CanvasRenderingContext2D {
  const ctx: Record<string, unknown> = {};
  for (const m of [
    "setTransform", "fillRect", "clearRect", "drawImage", "beginPath", "moveTo", "lineTo",
    "stroke", "fill", "save", "restore", "scale", "translate", "rect", "closePath",
    "fillText", "strokeRect", "arc", "clip", "setLineDash",
  ]) ctx[m] = () => {};
  ctx.getTransform = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  ctx.measureText = (t: string) => ({ width: t.length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
  return ctx as unknown as CanvasRenderingContext2D;
}

const ROWS = Array.from({ length: 40 }, (_, i) => ({
  time: 1700000000 + i * 3600, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i,
}));
const VISIBLE = { from: 0, to: 20 };

describe("autoscale reserves LWC marker margins on the price scale", () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (type: string) {
      return type === "2d" ? makeFakeCtx() : null;
    });
  });
  afterEach(() => { vi.restoreAllMocks(); container.remove(); });

  function setup() {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 400, height: 300, devicePixelRatio: 1, scheduler, now: () => 0,
    });
    const series = engine.addSeries("candles", { upColor: "U", downColor: "D" }, 0);
    series.setData(ROWS);
    engine.timeScale().setVisibleLogicalRange(VISIBLE);
    scheduler.flush();
    const model = engine.unwrap<ChartModel>();
    const barSpacing = Math.abs(model.xOfLogical(1) - model.xOfLogical(0));
    // The autoscaled window's own edges (LWC: the visible extents land exactly on
    // the internal band edges), captured before any marker is set.
    const { from: MIN_LOW, to: MAX_HIGH } = model.scale(0, "right");
    expect(MAX_HIGH).toBeGreaterThan(MIN_LOW);
    const yMax = () => series.priceToCoordinate(MAX_HIGH);
    const yMin = () => series.priceToCoordinate(MIN_LOW);
    const marker = (position: MarkerSpec["position"], i = 5): MarkerSpec =>
      ({ time: ROWS[i].time, position, shape: "circle", color: "c" });
    return { engine, series, scheduler, model, barSpacing, yMax, yMin, marker };
  }

  it("aboveBar markers move the visible high down by the full margin and leave the low alone", () => {
    const t = setup();
    const expected = markerAutoscaleMargins([t.marker("aboveBar")], t.barSpacing);
    expect(expected).not.toBeNull();
    expect(expected!.above).toBeGreaterThan(0);
    const top0 = t.yMax();
    const bottom0 = t.yMin();
    expect(top0).not.toBeNull();
    t.series.setMarkers([t.marker("aboveBar")]);
    t.scheduler.flush();
    expect(t.yMax()! - top0!).toBeCloseTo(expected!.above, 6);
    expect(t.yMin()).toBeCloseTo(bottom0!, 6);
    const scale = t.model.scale(0, "right");
    expect(scale.marginAbovePx).toBe(expected!.above);
    expect(scale.marginBelowPx).toBe(0);
  });

  it("belowBar markers move the visible low up; inBar reserves half on both sides", () => {
    const t = setup();
    const top0 = t.yMax()!;
    const bottom0 = t.yMin()!;
    const below = markerAutoscaleMargins([t.marker("belowBar")], t.barSpacing)!;
    t.series.setMarkers([t.marker("belowBar")]);
    t.scheduler.flush();
    expect(t.yMax()).toBeCloseTo(top0, 6);
    expect(bottom0 - t.yMin()!).toBeCloseTo(below.below, 6);

    const inBar = markerAutoscaleMargins([t.marker("inBar")], t.barSpacing)!;
    expect(inBar.above).toBe(Math.ceil(below.below / 2));
    t.series.setMarkers([t.marker("inBar")]);
    t.scheduler.flush();
    expect(t.yMax()! - top0).toBeCloseTo(inBar.above, 6);
    expect(bottom0 - t.yMin()!).toBeCloseTo(inBar.below, 6);
  });

  it("clearing the markers releases the band", () => {
    const t = setup();
    const top0 = t.yMax()!;
    t.series.setMarkers([t.marker("aboveBar"), t.marker("belowBar")]);
    t.scheduler.flush();
    expect(t.yMax()).not.toBeCloseTo(top0, 6);
    t.series.setMarkers([]);
    t.scheduler.flush();
    expect(t.yMax()).toBeCloseTo(top0, 6);
    expect(t.model.scale(0, "right").marginAbovePx).toBe(0);
  });

  it("on an inverted scale the above band stays at the SCREEN top, where the low now sits", () => {
    // LWC getPrice swaps high/low for aboveBar on inverted scales, so the glyphs are
    // still drawn upward from the screen-top edge of the bar and the reserved band
    // must be there too (_bottomMarginPx inverted = top × h + marginAbove).
    const t = setup();
    const topBand0 = t.yMax()!;      // not inverted yet: the high sits at the screen top
    t.engine.priceScale("right").applyOptions({ invertScale: true });
    t.scheduler.flush();
    const yLow0 = t.yMin()!;        // inverted: the low is at the screen top ...
    const yHigh0 = t.yMax()!;       // ... and the high near the bottom
    expect(yHigh0).toBeGreaterThan(yLow0);
    // Inversion keeps scaleMargins.top (0.2) at the screen top, like LWC.
    expect(yLow0).toBeCloseTo(topBand0, 6);
    const expected = markerAutoscaleMargins([t.marker("aboveBar")], t.barSpacing)!;
    t.series.setMarkers([t.marker("aboveBar")]);
    t.scheduler.flush();
    expect(t.yMin()! - yLow0).toBeCloseTo(expected.above, 6);
    expect(t.yMax()).toBeCloseTo(yHigh0, 6);
  });

  it("the painter's price ticks and the gesture bridge see the same band as the series mapping", () => {
    const t = setup();
    t.series.setMarkers([t.marker("aboveBar")]);
    t.scheduler.flush();
    const scale = t.model.scale(0, "right");
    const eff = effectiveMargins(scale);
    expect(eff.top).toBeGreaterThan(scale.margins.top);
    expect(eff.bottom).toBe(scale.margins.bottom);
    // The option readback stays the user's fractions, never the reserved band.
    const opts = t.engine.priceScale("right").options() as { scaleMargins: { top: number; bottom: number } };
    expect(opts.scaleMargins).toEqual(scale.margins);
    // Round trip through the series mapping lands on the same price.
    const y = t.yMax()!;
    expect(t.series.coordinateToPrice(y)).toBeCloseTo(scale.to, 6);
  });
});
