import { describe, expect, it } from "vitest";
import { axisValueAtCoordinate, zoomAxisRange } from "@/lib/chart-engine/axisZoom";
import {
  classifyRegion,
  createAxisGestureController,
  cursorFor,
  MAX_BAR_SPACING_WIDTH_FRACTION,
  MIN_BAR_SPACING,
  MIN_PRICE_SPAN,
  PRICE_AXIS_DRAG_K,
  TIME_AXIS_DRAG_K,
  type AxisGestureDeps,
  type AxisHandleScaleOptions,
  type AxisLayout,
  type AxisPointerEvent,
  type PriceScaleState,
  type TimeScaleState,
} from "@/lib/chart-engine/canvas/axisGestures";

const MARGINS = { top: 0.1, bottom: 0.08 };
const PANE_H = 400;
const PLOT_W = 800;
const AXIS_W = 60;
const TIME_H = 28;

function rightLayout(): AxisLayout {
  return {
    panes: [{
      index: 0,
      plotRect: { x: 0, y: 0, width: PLOT_W, height: PANE_H },
      priceAxisRect: { x: PLOT_W, y: 0, width: AXIS_W, height: PANE_H + TIME_H },
    }],
    timeAxisRect: { x: 0, y: PANE_H, width: PLOT_W + AXIS_W, height: TIME_H },
  };
}

function leftLayout(): AxisLayout {
  return {
    panes: [{
      index: 0,
      plotRect: { x: AXIS_W, y: 0, width: PLOT_W, height: PANE_H },
      priceAxisRect: { x: 0, y: 0, width: AXIS_W, height: PANE_H + TIME_H },
    }],
    timeAxisRect: { x: 0, y: PANE_H, width: PLOT_W + AXIS_W, height: TIME_H },
  };
}

function twoPaneLayout(): AxisLayout {
  return {
    panes: [
      {
        index: 0,
        plotRect: { x: 0, y: 0, width: PLOT_W, height: 250 },
        priceAxisRect: { x: PLOT_W, y: 0, width: AXIS_W, height: 250 },
      },
      {
        index: 1,
        plotRect: { x: 0, y: 250, width: PLOT_W, height: 150 },
        priceAxisRect: { x: PLOT_W, y: 250, width: AXIS_W, height: 150 + TIME_H },
      },
    ],
    timeAxisRect: { x: 0, y: PANE_H, width: PLOT_W + AXIS_W, height: TIME_H },
  };
}

function yOfValue(
  range: { from: number; to: number },
  value: number,
  height: number,
  margins: { top: number; bottom: number },
  inverted = false,
): number {
  const topPx = margins.top * height;
  const bottomPx = margins.bottom * height;
  const internalHeight = height - topPx - bottomPx;
  const ratio = (value - range.from) / (range.to - range.from);
  const inverseCoordinate = bottomPx + ratio * (internalHeight - 1);
  return inverted ? inverseCoordinate : height - 1 - inverseCoordinate;
}

function ev(partial: Partial<AxisPointerEvent>): AxisPointerEvent {
  return {
    type: "pointerdown",
    pointerId: 1,
    pointerType: "mouse",
    x: 0,
    y: 0,
    timeStamp: 0,
    region: "plot",
    paneIndex: 0,
    ...partial,
  };
}

function defaultOptions(over: Partial<AxisHandleScaleOptions> = {}): { handleScale: AxisHandleScaleOptions } {
  return {
    handleScale: {
      axisPressedMouseMove: { time: true, price: true, ...over.axisPressedMouseMove },
      axisDoubleClickReset: { time: true, price: true, ...over.axisDoubleClickReset },
    },
  };
}

function makeHarness(options = defaultOptions()) {
  const time: TimeScaleState = {
    visibleFrom: 100,
    visibleTo: 200,
    barSpacing: 8,
    rightOffset: 24,
    widthPx: PLOT_W,
  };
  const prices = new Map<number, PriceScaleState>([[0, {
    mode: "normal",
    inverted: false,
    from: 100,
    to: 200,
    heightPx: PANE_H,
    margins: { ...MARGINS },
  }]]);
  const setTimeScale: Partial<TimeScaleState>[] = [];
  const setPriceRange: { paneIndex: number; from: number; to: number }[] = [];
  const setPriceScaleAuto: { paneIndex: number; auto: boolean }[] = [];
  let resetViewCalls = 0;
  const deps: AxisGestureDeps = {
    getTimeScale: () => ({ ...time }),
    setTimeScale: (partial) => {
      setTimeScale.push({ ...partial });
      Object.assign(time, partial);
    },
    getPriceScale: (paneIndex) => {
      const s = prices.get(paneIndex);
      return s ? { ...s, margins: { ...s.margins } } : null;
    },
    setPriceRange: (paneIndex, from, to) => {
      setPriceRange.push({ paneIndex, from, to });
      const s = prices.get(paneIndex);
      if (s) { s.from = from; s.to = to; }
    },
    setPriceScaleAuto: (paneIndex, auto) => { setPriceScaleAuto.push({ paneIndex, auto }); },
    resetView: () => { resetViewCalls += 1; },
    now: () => 1_000,
    options,
  };
  const ctl = createAxisGestureController(deps);
  ctl.setLayout(rightLayout());
  return {
    ctl, time, prices, setTimeScale, setPriceRange, setPriceScaleAuto,
    resetView: () => resetViewCalls,
  };
}

describe("classifyRegion", () => {
  it("classifies the plot, time axis, corner, and outside", () => {
    const layout = rightLayout();
    expect(classifyRegion(100, 100, layout)).toBe("plot");
    expect(classifyRegion(400, PANE_H + 4, layout)).toBe("timeAxis");
    expect(classifyRegion(PLOT_W + 10, PANE_H + 4, layout)).toBe("corner");
    expect(classifyRegion(-4, 10, layout)).toBe("outside");
    expect(classifyRegion(PLOT_W + AXIS_W + 1, 10, layout)).toBe("outside");
  });

  it("classifies a right price axis without assuming the side", () => {
    expect(classifyRegion(PLOT_W + 10, 120, rightLayout())).toBe("priceAxis");
  });

  it("classifies a left price axis without assuming the side", () => {
    const layout = leftLayout();
    expect(classifyRegion(10, 120, layout)).toBe("priceAxis");
    expect(classifyRegion(AXIS_W + 40, 120, layout)).toBe("plot");
    expect(classifyRegion(10, PANE_H + 4, layout)).toBe("corner");
    expect(classifyRegion(AXIS_W + 40, PANE_H + 4, layout)).toBe("timeAxis");
  });

  it("hits the price axis of the pane that owns the y band", () => {
    const layout = twoPaneLayout();
    expect(classifyRegion(PLOT_W + 8, 40, layout)).toBe("priceAxis");
    expect(classifyRegion(PLOT_W + 8, 300, layout)).toBe("priceAxis");
    expect(classifyRegion(PLOT_W + 8, PANE_H + 4, layout)).toBe("corner");
  });
});

describe("cursorFor", () => {
  it("returns resize, crosshair, and default hints", () => {
    expect(cursorFor("priceAxis", false)).toBe("ns-resize");
    expect(cursorFor("timeAxis", false)).toBe("ew-resize");
    expect(cursorFor("plot", false)).toBe("crosshair");
    expect(cursorFor("corner", false)).toBe("default");
    expect(cursorFor("outside", false)).toBe("default");
    expect(cursorFor("plot", true, "price")).toBe("ns-resize");
    expect(cursorFor("plot", true, "time")).toBe("ew-resize");
  });
});

describe("price-axis drag", () => {
  it("keeps the origin price fixed within 1e-9 and 1 CSS px, and switches auto off on the first move", () => {
    const h = makeHarness();
    const originY = 200;
    const down = h.ctl.handle(ev({ type: "pointerdown", region: "priceAxis", x: PLOT_W + 10, y: originY }));
    expect(down.handled).toBe(true);
    expect(h.setPriceScaleAuto).toEqual([]);
    expect(h.ctl.isGestureActive()).toBe(true);
    expect(h.ctl.suppressCrosshair).toBe(true);

    const start = { from: 100, to: 200 };
    const originPrice = axisValueAtCoordinate(start, originY, PANE_H, MARGINS);
    const dy = 60;
    const move = h.ctl.handle(ev({ type: "pointermove", region: "priceAxis", x: PLOT_W + 10, y: originY + dy }));
    expect(move.handled).toBe(true);
    expect(h.setPriceScaleAuto).toEqual([{ paneIndex: 0, auto: false }]);

    const scale = h.prices.get(0)!;
    const expected = zoomAxisRange(start, originPrice, Math.exp(dy / PRICE_AXIS_DRAG_K));
    expect(scale.from).toBeCloseTo(expected.from, 12);
    expect(scale.to).toBeCloseTo(expected.to, 12);

    const priceAtOrigin = axisValueAtCoordinate(
      { from: scale.from, to: scale.to },
      originY,
      PANE_H,
      MARGINS,
    );
    expect(Math.abs(priceAtOrigin - originPrice)).toBeLessThan(1e-9);

    const yOfOrigin = yOfValue({ from: scale.from, to: scale.to }, originPrice, PANE_H, MARGINS);
    expect(Math.abs(yOfOrigin - originY)).toBeLessThanOrEqual(1);

    h.ctl.handle(ev({ type: "pointerup", region: "priceAxis", x: PLOT_W + 10, y: originY + dy }));
    expect(h.ctl.isGestureActive()).toBe(false);
    expect(h.ctl.suppressCrosshair).toBe(false);
    expect(h.setPriceScaleAuto.filter((c) => c.auto)).toEqual([]);
    expect(h.prices.get(0)!.from).toBeCloseTo(expected.from, 12);
    expect(h.prices.get(0)!.to).toBeCloseTo(expected.to, 12);
  });

  it("clamps the span to MIN_PRICE_SPAN instead of collapsing", () => {
    const h = makeHarness();
    const originY = 180;
    h.ctl.handle(ev({ type: "pointerdown", region: "priceAxis", x: PLOT_W + 10, y: originY }));
    h.ctl.handle(ev({ type: "pointermove", region: "priceAxis", x: PLOT_W + 10, y: originY - 8_000 }));
    const scale = h.prices.get(0)!;
    expect(scale.to - scale.from).toBeGreaterThanOrEqual(MIN_PRICE_SPAN * 0.999);
    expect(scale.to).toBeGreaterThan(scale.from);
    const originPrice = axisValueAtCoordinate({ from: 100, to: 200 }, originY, PANE_H, MARGINS);
    const priceAtOrigin = axisValueAtCoordinate(
      { from: scale.from, to: scale.to },
      originY,
      PANE_H,
      MARGINS,
    );
    expect(Math.abs(priceAtOrigin - originPrice)).toBeLessThan(1e-9);
  });

  it("returns autoscale on a price-axis double-click when the option allows it", () => {
    const h = makeHarness();
    const result = h.ctl.handle(ev({ type: "dblclick", region: "priceAxis", x: PLOT_W + 10, y: 120 }));
    expect(result.handled).toBe(true);
    expect(h.setPriceScaleAuto).toEqual([{ paneIndex: 0, auto: true }]);
  });

  it("no-ops a price-axis double-click when the option is off", () => {
    const h = makeHarness(defaultOptions({ axisDoubleClickReset: { time: true, price: false } }));
    const result = h.ctl.handle(ev({ type: "dblclick", region: "priceAxis", x: PLOT_W + 10, y: 120 }));
    expect(result.handled).toBe(true);
    expect(h.setPriceScaleAuto).toEqual([]);
  });
});

describe("time-axis drag", () => {
  it("scales barSpacing by exp(dx / k) with the right edge pinned and rightOffset untouched", () => {
    const h = makeHarness();
    const x0 = 200;
    expect(h.ctl.handle(ev({ type: "pointerdown", region: "timeAxis", x: x0, y: PANE_H + 8 })).handled).toBe(true);
    const dx = 150;
    expect(h.ctl.handle(ev({ type: "pointermove", region: "timeAxis", x: x0 + dx, y: PANE_H + 8 })).handled).toBe(true);

    const expectedSpacing = 8 * Math.exp(dx / TIME_AXIS_DRAG_K);
    expect(h.time.barSpacing).toBeCloseTo(expectedSpacing, 12);
    expect(h.time.visibleTo).toBe(200);
    expect(h.time.visibleFrom).toBeCloseTo(200 - PLOT_W / expectedSpacing, 12);
    expect(h.time.rightOffset).toBe(24);
    for (const patch of h.setTimeScale) {
      expect(patch).not.toHaveProperty("rightOffset");
      expect(patch).not.toHaveProperty("visibleTo");
    }
  });

  it("clamps barSpacing to the documented min and max", () => {
    const h = makeHarness();
    const x0 = 400;
    h.ctl.handle(ev({ type: "pointerdown", region: "timeAxis", x: x0, y: PANE_H + 8 }));
    h.ctl.handle(ev({ type: "pointermove", region: "timeAxis", x: x0 + 8_000, y: PANE_H + 8 }));
    expect(h.time.barSpacing).toBeCloseTo(PLOT_W * MAX_BAR_SPACING_WIDTH_FRACTION, 12);
    expect(h.time.visibleTo).toBe(200);
    expect(h.time.rightOffset).toBe(24);

    h.ctl.handle(ev({ type: "pointerup", region: "timeAxis", x: x0 + 8_000, y: PANE_H + 8 }));
    h.time.barSpacing = 8;
    h.time.visibleFrom = 100;
    h.ctl.handle(ev({ type: "pointerdown", region: "timeAxis", x: x0, y: PANE_H + 8 }));
    h.ctl.handle(ev({ type: "pointermove", region: "timeAxis", x: x0 - 8_000, y: PANE_H + 8 }));
    expect(h.time.barSpacing).toBe(MIN_BAR_SPACING);
    expect(h.time.visibleTo).toBe(200);
  });

  it("calls resetView on a time-axis double-click when the option allows it", () => {
    const h = makeHarness();
    const result = h.ctl.handle(ev({ type: "dblclick", region: "timeAxis", x: 120, y: PANE_H + 8 }));
    expect(result.handled).toBe(true);
    expect(h.resetView()).toBe(1);
  });

  it("no-ops a time-axis double-click when the option is off", () => {
    const h = makeHarness(defaultOptions({ axisDoubleClickReset: { time: false, price: true } }));
    const result = h.ctl.handle(ev({ type: "dblclick", region: "timeAxis", x: 120, y: PANE_H + 8 }));
    expect(result.handled).toBe(true);
    expect(h.resetView()).toBe(0);
  });
});

describe("resize re-anchoring", () => {
  it("keeps the right-edge logical on a width change at the same barSpacing", () => {
    const h = makeHarness();
    h.ctl.onResize({ widthPx: 1_000, heightPx: PANE_H + TIME_H }, { widthPx: PLOT_W, heightPx: PANE_H + TIME_H });
    expect(h.time.visibleTo).toBe(200);
    expect(h.time.barSpacing).toBe(8);
    expect(h.time.rightOffset).toBe(24);
    expect(h.time.visibleFrom).toBeCloseTo(200 - 1_000 / 8, 12);
    expect(h.time.widthPx).toBe(1_000);
    for (const patch of h.setTimeScale) {
      expect(patch).not.toHaveProperty("rightOffset");
    }
  });

  it("keeps the price range on a height change", () => {
    const h = makeHarness();
    h.ctl.onResize({ widthPx: PLOT_W, heightPx: 700 }, { widthPx: PLOT_W, heightPx: PANE_H + TIME_H });
    expect(h.setPriceRange).toEqual([]);
    expect(h.prices.get(0)!.from).toBe(100);
    expect(h.prices.get(0)!.to).toBe(200);
    expect(h.setTimeScale).toEqual([]);
  });

  it("ends an active drag on resize without jumping the last applied range", () => {
    const h = makeHarness();
    h.ctl.handle(ev({ type: "pointerdown", region: "priceAxis", x: PLOT_W + 10, y: 200 }));
    h.ctl.handle(ev({ type: "pointermove", region: "priceAxis", x: PLOT_W + 10, y: 260 }));
    const frozen = { from: h.prices.get(0)!.from, to: h.prices.get(0)!.to };
    expect(h.ctl.isGestureActive()).toBe(true);
    h.ctl.onResize({ widthPx: PLOT_W, heightPx: 500 }, { widthPx: PLOT_W, heightPx: PANE_H + TIME_H });
    expect(h.ctl.isGestureActive()).toBe(false);
    expect(h.ctl.suppressCrosshair).toBe(false);
    expect(h.prices.get(0)!.from).toBe(frozen.from);
    expect(h.prices.get(0)!.to).toBe(frozen.to);
    const rangesAfter = h.setPriceRange.length;
    h.ctl.handle(ev({ type: "pointermove", region: "priceAxis", x: PLOT_W + 10, y: 320 }));
    expect(h.setPriceRange.length).toBe(rangesAfter);
    expect(h.prices.get(0)!.from).toBe(frozen.from);
  });
});

describe("crosshair priority, handled flag, and dispose", () => {
  it("toggles suppressCrosshair only while an axis drag is active", () => {
    const h = makeHarness();
    expect(h.ctl.suppressCrosshair).toBe(false);
    h.ctl.handle(ev({ type: "pointerdown", region: "plot", x: 40, y: 40 }));
    expect(h.ctl.suppressCrosshair).toBe(false);
    h.ctl.handle(ev({ type: "pointerdown", region: "timeAxis", x: 80, y: PANE_H + 8 }));
    expect(h.ctl.suppressCrosshair).toBe(true);
    expect(h.ctl.isGestureActive()).toBe(true);
    h.ctl.handle(ev({ type: "pointerup", region: "timeAxis", x: 90, y: PANE_H + 8 }));
    expect(h.ctl.suppressCrosshair).toBe(false);
  });

  it("returns handled:true for axis pointerdown so the plot pan controller never sees it", () => {
    const h = makeHarness();
    expect(h.ctl.handle(ev({ type: "pointerdown", region: "priceAxis", x: PLOT_W + 10, y: 80 })).handled).toBe(true);
    h.ctl.handle(ev({ type: "pointerup", region: "priceAxis", x: PLOT_W + 10, y: 80 }));
    expect(h.ctl.handle(ev({ type: "pointerdown", region: "timeAxis", x: 40, y: PANE_H + 8 })).handled).toBe(true);
    h.ctl.handle(ev({ type: "pointerup", region: "timeAxis", x: 40, y: PANE_H + 8 }));
    expect(h.ctl.handle(ev({ type: "pointerdown", region: "corner", x: PLOT_W + 10, y: PANE_H + 8 })).handled).toBe(true);
    expect(h.ctl.handle(ev({ type: "pointerdown", region: "plot", x: 40, y: 40 })).handled).toBe(false);
    expect(h.ctl.handle(ev({ type: "pointerdown", region: "outside", x: -8, y: -8 })).handled).toBe(false);
  });

  it("still reports handled:true on a disabled axis so the gesture cannot leak into plot pan", () => {
    const h = makeHarness(defaultOptions({
      axisPressedMouseMove: { time: false, price: false },
    }));
    expect(h.ctl.handle(ev({ type: "pointerdown", region: "priceAxis", x: PLOT_W + 10, y: 80 })).handled).toBe(true);
    expect(h.ctl.isGestureActive()).toBe(false);
    expect(h.setPriceRange).toEqual([]);
  });

  it("exposes an active-drag cursor even after the pointer leaves the axis", () => {
    const h = makeHarness();
    h.ctl.handle(ev({ type: "pointerdown", region: "priceAxis", x: PLOT_W + 10, y: 80 }));
    expect(h.ctl.cursorFor("plot", true)).toBe("ns-resize");
    h.ctl.handle(ev({ type: "pointerup", region: "plot", x: 40, y: 80 }));
    expect(h.ctl.cursorFor("plot")).toBe("crosshair");
  });

  it("dispose is idempotent and freezes further handling", () => {
    const h = makeHarness();
    h.ctl.dispose();
    expect(() => h.ctl.dispose()).not.toThrow();
    expect(h.ctl.handle(ev({ type: "pointerdown", region: "priceAxis", x: PLOT_W + 10, y: 80 })).handled).toBe(false);
    expect(h.ctl.isGestureActive()).toBe(false);
    h.ctl.onResize({ widthPx: 500, heightPx: 400 }, { widthPx: PLOT_W, heightPx: PANE_H + TIME_H });
    expect(h.setTimeScale).toEqual([]);
  });
});
