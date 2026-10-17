import { describe, expect, it, vi } from "vitest";
import { createDrawingBridge, type DrawingAnchor } from "../chart-engine/drawingBridge";
import type {
  ChartEngine,
  EngineLogicalRangeHandler,
  EngineTime,
  EngineLogicalRange,
  SeriesHandle,
  TimeScaleHandle,
} from "../chart-engine/api";
import {
  FUTURE_ANCHOR_BARS,
  futureBarTimes,
  futureCadence,
  futureSlotOf,
} from "../chart-engine/futureTime";

// ─────────────────────────────────────────────────────────────────────────────
// Contract tests for the drawing bridge (lib/chart-engine/drawingBridge.ts).
//
// The bridge must work over ANY engine implementing the contract, so these
// tests drive a fake ChartEngine whose panes carry DIFFERENT linear price maps
// (the same price lands on different y per pane — the pane-scoping law) and
// whose time scale reproduces the LWC coordinate convention
// (x = (i - from + 0.5) * barSpacing, coordinateToTime rounds to the nearest
// known slot and answers null past the data). Degenerate panes (collapsed
// coordinate maps, removed series, missing panes) exercise the readiness gate.
// Future-slot expectations are cross-checked against the REAL futureTime
// helpers so the bridge's minted slots match the grid the caller feeds.
// ─────────────────────────────────────────────────────────────────────────────

// Only the projection pair is exercised; the bridge never touches the rest of
// SeriesHandle, so the fake implements those two and passes through a cast
// (house precedent: drawingPaneReadiness.test.ts).
type FakeSeries = {
  priceToCoordinate: (price: number) => number | null;
  coordinateToPrice: (y: number) => number | null;
};

type PaneSpec = {
  width: number;
  height: number;
  // Linear price map: the price at y=0 and at the bottom row y=height-1.
  priceAtTop: number;
  priceAtBottom: number;
};

// Two panes with different price ranges: price 50 → y≈149.5 in pane 0 but
// y≈249.2 in pane 1. Same width so the shared time scale math stays simple.
const SPECS: PaneSpec[] = [
  { width: 600, height: 300, priceAtTop: 200, priceAtBottom: -100 },
  { width: 600, height: 300, priceAtTop: 300, priceAtBottom: 0 },
];
// Ten daily bars; range {-1, 11} → barSpacing 600/12 = 50, bar i centred at (i + 1.5) * 50.
const TIMES = Array.from({ length: 10 }, (_, i) => new Date(Date.UTC(2026, 8, i + 1)).toISOString().slice(0, 10));

type HarnessOptions = {
  specs?: PaneSpec[];
  times?: (string | number)[];
  // Future whitespace the SCALE knows beyond the real bars (fed tail).
  scaleExtraTimes?: (string | number)[];
  // Pane indices that start with a collapsed (degenerate) coordinate map.
  collapsed?: number[];
};

function make(options: HarnessOptions = {}) {
  const specs = options.specs ?? SPECS;
  const realTimes = [...(options.times ?? TIMES)];
  const scaleTimes = [...realTimes, ...(options.scaleExtraTimes ?? [])];
  const collapsed = specs.map((_, paneIndex) => options.collapsed?.includes(paneIndex) ?? false);
  const hasPrimary = specs.map(() => true);
  const series: FakeSeries[] = specs.map((spec, paneIndex) => ({
    priceToCoordinate: (price: number): number | null => {
      if (collapsed[paneIndex]) return 0;
      const { priceAtTop, priceAtBottom, height } = spec;
      return (priceAtTop - price) * (height - 1) / (priceAtTop - priceAtBottom);
    },
    coordinateToPrice: (y: number): number | null => {
      if (collapsed[paneIndex]) return 0;
      const { priceAtTop, priceAtBottom, height } = spec;
      return priceAtTop - y * (priceAtTop - priceAtBottom) / (height - 1);
    },
  }));

  let range: EngineLogicalRange = { from: -1, to: 11 };
  const rangeHandlers = new Set<EngineLogicalRangeHandler>();
  const barSpacing = () => specs[0].width / (range.to - range.from);

  const timeScale: TimeScaleHandle = {
    getVisibleLogicalRange: () => ({ ...range }),
    setVisibleLogicalRange: (next: EngineLogicalRange) => { range = { ...next }; },
    subscribeVisibleLogicalRangeChange: (handler: EngineLogicalRangeHandler) => {
      rangeHandlers.add(handler);
    },
    unsubscribeVisibleLogicalRangeChange: (handler: EngineLogicalRangeHandler) => {
      rangeHandlers.delete(handler);
    },
    timeToCoordinate: (time: EngineTime): number | null => {
      const index = scaleTimes.findIndex((known) => String(known) === String(time));
      return index < 0 ? null : (index - range.from + 0.5) * barSpacing();
    },
    coordinateToTime: (x: number): EngineTime | null => {
      const index = Math.round(x / barSpacing() + range.from - 0.5);
      return index >= 0 && index < scaleTimes.length ? scaleTimes[index] : null;
    },
  } as unknown as TimeScaleHandle;

  const engine = {
    timeScale: () => timeScale,
    paneSize: (paneIndex?: number) => {
      const spec = specs[paneIndex ?? 0];
      if (!spec) throw new Error(`chart-engine: no pane ${paneIndex}`);
      return { width: spec.width, height: spec.height };
    },
  } as unknown as ChartEngine;

  const tasks: { run: () => void }[] = [];
  let scheduled = 0;
  const bridge = createDrawingBridge(engine, {
    primaryByPane: (paneIndex: number): SeriesHandle | null =>
      hasPrimary[paneIndex] ? series[paneIndex] as unknown as SeriesHandle : null,
    cadence: () => futureCadence(realTimes),
    lastBarTime: (): EngineTime | null => (realTimes.length ? realTimes[realTimes.length - 1] : null),
    scheduler: (run: () => void) => {
      const task = { run };
      scheduled += 1;
      tasks.push(task);
      return () => { task.run = () => {}; };
    },
  });

  return {
    bridge,
    series,
    flushScheduler: () => { tasks.splice(0).forEach((task) => task.run()); },
    pendingTasks: () => tasks.length,
    totalScheduled: () => scheduled,
    engineSubscribed: () => rangeHandlers.size === 1,
    setRange: (from: number, to: number) => {
      range = { from, to };
      [...rangeHandlers].forEach((handler) => handler({ ...range }));
    },
    uncollapse: (paneIndex: number) => { collapsed[paneIndex] = false; },
    setPrimary: (paneIndex: number, present: boolean) => { hasPrimary[paneIndex] = present; },
    pushTimes: (more: (string | number)[]) => { realTimes.push(...more); scaleTimes.push(...more); },
    barSpacing: () => barSpacing(),
  };
}

const anchor = (overrides: Partial<DrawingAnchor> & Pick<DrawingAnchor, "paneIndex">): DrawingAnchor => ({
  time: null,
  logical: 4.5,
  price: 50,
  ...overrides,
});

describe("drawing bridge: pane-scoped anchors (D01-A01)", () => {
  it("resolves the same price against each pane's own price scale", () => {
    const { bridge } = make();
    const inPane0 = bridge.anchorToPixel(anchor({ paneIndex: 0 }));
    const inPane1 = bridge.anchorToPixel(anchor({ paneIndex: 1 }));
    expect(inPane0).not.toBeNull();
    expect(inPane1).not.toBeNull();
    // price 50: pane 0 maps (200-50)*299/300, pane 1 maps (300-50)*299/300.
    expect(inPane0!.y).toBeCloseTo((200 - 50) * 299 / 300, 9);
    expect(inPane1!.y).toBeCloseTo((300 - 50) * 299 / 300, 9);
    expect(Math.abs(inPane0!.y - inPane1!.y)).toBeGreaterThan(50);
    // Each pane's inverse recovers the same price from its own pixel.
    expect(bridge.pixelToAnchor(0, inPane0!.x, inPane0!.y, "raw")!.price).toBeCloseTo(50, 9);
    expect(bridge.pixelToAnchor(1, inPane1!.x, inPane1!.y, "raw")!.price).toBeCloseTo(50, 9);
  });

  it("round-trips raw and snapped pixels through anchors within 1e-9", () => {
    const { bridge } = make();
    const raw = bridge.pixelToAnchor(0, 262.5, 123.25, "raw");
    expect(raw).not.toBeNull();
    const rawBack = bridge.anchorToPixel(raw!);
    expect(rawBack).not.toBeNull();
    expect(rawBack!.x).toBeCloseTo(262.5, 9);
    expect(rawBack!.y).toBeCloseTo(123.25, 9);

    const snapped = bridge.pixelToAnchor(0, 262.5, 123.25, "snapBar");
    expect(snapped).not.toBeNull();
    const snappedBack = bridge.anchorToPixel(snapped!);
    expect(snappedBack).not.toBeNull();
    expect(snappedBack!.x).toBeCloseTo(275, 9); // bar 4 centre: (4 + 1.5) * 50
    expect(snappedBack!.y).toBeCloseTo(123.25, 9);
  });

  it("prefers an exact bar time over a stale logical index", () => {
    const { bridge } = make();
    const resolved = bridge.anchorToPixel(anchor({ paneIndex: 0, time: TIMES[3], logical: 8.25 }));
    expect(resolved).not.toBeNull();
    expect(resolved!.x).toBeCloseTo((3 + 1.5) * 50, 9); // bar 3 centre: (3 + 1.5) * 50
  });
});

describe("drawing bridge: raw travel and pixel clamping (D01-A02)", () => {
  it("translates an anchor by an exact pixel delta without snapping", () => {
    const { bridge } = make();
    const start = bridge.pixelToAnchor(0, 262.5, 123.25, "raw")!;
    const moved = bridge.translateAnchor(start, 21.5, -13.25);
    expect(moved).not.toBeNull();
    expect(moved!.paneIndex).toBe(0);
    const pixel = bridge.anchorToPixel(moved!);
    expect(pixel).not.toBeNull();
    expect(pixel!.x).toBeCloseTo(284, 9);   // 262.5 + 21.5, no bar snap
    expect(pixel!.y).toBeCloseTo(110, 9);   // 123.25 - 13.25
    // Re-resolved through the pane's own price map, not moved in price space:
    // dp/dy = -(200 - (-100)) / 299.
    expect(moved!.price).toBeCloseTo(start.price + 13.25 * 300 / 299, 9);
    expect(moved!.logical).toBeCloseTo(start.logical + 21.5 / 50, 9);
    expect(moved!.time).toBeNull();
  });

  it("keeps travel raw across pane boundaries in the same engine", () => {
    const { bridge } = make();
    const start = bridge.pixelToAnchor(1, 262.5, 200, "raw")!;
    const moved = bridge.translateAnchor(start, -12.75, 33.5);
    const pixel = bridge.anchorToPixel(moved!);
    expect(pixel).not.toBeNull();
    expect(pixel!.x).toBeCloseTo(249.75, 9);
    expect(pixel!.y).toBeCloseTo(233.5, 9);
  });

  it("clamps gesture pixels at the pane rect in pixels", () => {
    const { bridge } = make();
    expect(bridge.clampToPane(0, -12, 40)).toEqual({ x: 0, y: 40, clamped: true });
    expect(bridge.clampToPane(0, 300, 999)).toEqual({ x: 300, y: 299, clamped: true });
    expect(bridge.clampToPane(1, 601, -5)).toEqual({ x: 600 - 1, y: 0, clamped: true });
    expect(bridge.clampToPane(0, 100, 200)).toEqual({ x: 100, y: 200, clamped: false });
    expect(bridge.clampToPane(0, 0, 299)).toEqual({ x: 0, y: 299, clamped: false });
    // A missing pane fails closed: the gesture keeps its raw pixel, unclamped.
    expect(bridge.clampToPane(2, -5, 4000)).toEqual({ x: -5, y: 4000, clamped: false });
  });
});

describe("drawing bridge: readiness gate (D01-A03)", () => {
  it("refuses to resolve anchors while the pane round trip is degenerate", () => {
    const h = make({ collapsed: [1] });
    expect(h.bridge.ready(0)).toBe(true);
    expect(h.bridge.ready(1)).toBe(false);
    expect(h.bridge.anchorToPixel(anchor({ paneIndex: 1 }))).toBeNull();
    expect(h.bridge.pixelToAnchor(1, 200, 150, "raw")).toBeNull();
    expect(h.bridge.pixelToAnchor(1, 200, 150, "snapBar")).toBeNull();
    expect(h.bridge.translateAnchor(anchor({ paneIndex: 1 }), 5, 5)).toBeNull();
    h.uncollapse(1);
    expect(h.bridge.ready(1)).toBe(true);
    expect(h.bridge.anchorToPixel(anchor({ paneIndex: 1 }))).not.toBeNull();
  });

  it("fails closed with no primary series or a removed series", () => {
    const h = make();
    h.setPrimary(1, false);
    expect(h.bridge.ready(1)).toBe(false);
    expect(h.bridge.anchorToPixel(anchor({ paneIndex: 1 }))).toBeNull();
    h.setPrimary(1, true);
    expect(h.bridge.ready(1)).toBe(true);
    h.series[0].priceToCoordinate = () => { throw new Error("removed"); };
    expect(h.bridge.ready(0)).toBe(false);
    expect(h.bridge.anchorToPixel(anchor({ paneIndex: 0 }))).toBeNull();
  });

  it("fires an already-ready pane's subscriber immediately, without an engine subscription", () => {
    const h = make();
    const onReady = vi.fn();
    const unsubscribe = h.bridge.subscribeReadiness(0, onReady);
    expect(onReady).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(h.engineSubscribed()).toBe(false);
  });

  it("notifies a pending pane's subscriber once the round trip heals", () => {
    const h = make({ collapsed: [1] });
    const onReady = vi.fn();
    const unsubscribe = h.bridge.subscribeReadiness(1, onReady);
    expect(onReady).not.toHaveBeenCalled();
    expect(h.engineSubscribed()).toBe(true);
    h.flushScheduler();
    expect(onReady).not.toHaveBeenCalled(); // still collapsed
    h.uncollapse(1);
    h.flushScheduler();
    expect(onReady).toHaveBeenCalledTimes(1);
    h.flushScheduler(); // the retired watcher never polls again
    expect(onReady).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("polls the round trip on each logical-range change", () => {
    const h = make({ collapsed: [1] });
    const onReady = vi.fn();
    h.bridge.subscribeReadiness(1, onReady);
    h.setRange(-2, 10);
    expect(onReady).not.toHaveBeenCalled();
    h.uncollapse(1);
    h.setRange(-3, 9);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("stops after a bounded number of retries, and a range change re-arms the watch", () => {
    const h = make({ collapsed: [1] });
    const onReady = vi.fn();
    h.bridge.subscribeReadiness(1, onReady);
    let rounds = 0;
    while (h.pendingTasks() > 0 && rounds < 500) { h.flushScheduler(); rounds += 1; }
    expect(onReady).not.toHaveBeenCalled();
    expect(h.pendingTasks()).toBe(0);
    expect(h.totalScheduled()).toBeLessThanOrEqual(40);
    h.flushScheduler();
    expect(onReady).not.toHaveBeenCalled(); // exhausted, not polling forever
    h.uncollapse(1);
    h.setRange(-1, 11); // fresh activity resets the retry budget
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("cancels a watcher on unsubscribe", () => {
    const h = make({ collapsed: [1] });
    const onReady = vi.fn();
    const unsubscribe = h.bridge.subscribeReadiness(1, onReady);
    unsubscribe();
    h.uncollapse(1);
    h.flushScheduler();
    h.setRange(-1, 11);
    expect(onReady).not.toHaveBeenCalled();
    expect(h.engineSubscribed()).toBe(false);
  });

  it("dispose unsubscribes from the engine and swallows late retries; double dispose is a no-op", () => {
    const h = make({ collapsed: [1] });
    const onReady = vi.fn();
    h.bridge.subscribeReadiness(1, onReady);
    expect(h.engineSubscribed()).toBe(true);
    h.bridge.dispose();
    h.bridge.dispose();
    expect(h.engineSubscribed()).toBe(false);
    h.uncollapse(1);
    h.flushScheduler();
    h.setRange(-1, 11);
    expect(onReady).not.toHaveBeenCalled();
    expect(h.pendingTasks()).toBe(0);
    expect(() => h.bridge.ready(0)).not.toThrow();
  });
});

describe("drawing bridge: future anchors (D01-A04)", () => {
  it("resolves a pixel past the last bar into a future cadence slot", () => {
    const h = make();
    // x = 625 is logical 11 = one slot past slot 0 (bar 9 is the last real bar).
    const snapped = h.bridge.pixelToAnchor(0, 625, 150, "snapBar");
    expect(snapped).not.toBeNull();
    expect(snapped!.future).toEqual({ slot: 1 });
    expect(snapped!.logical).toBe(11);
    expect(snapped!.time).toBe(futureBarTimes(TIMES, FUTURE_ANCHOR_BARS)[1]);
    // futureSlotOf classifies the time as future (its calendar-step slot measure
    // is knowingly approximate on weekend-skipping daily grids; see futureTime).
    expect(futureSlotOf(futureCadence(TIMES)!, snapped!.time as string)).toBeGreaterThanOrEqual(0);
    // The minted slot resolves back onto the slot's x through the cadence.
    const back = h.bridge.anchorToPixel(snapped!);
    expect(back).not.toBeNull();
    expect(back!.x).toBeCloseTo(625, 9);
    expect(back!.y).toBeCloseTo(150, 9);
  });

  it("keeps the fraction on a raw future position and still tags its slot", () => {
    const h = make();
    const raw = h.bridge.pixelToAnchor(0, 600, 150, "raw"); // logical 10.5, slot 1
    expect(raw).not.toBeNull();
    expect(raw!.logical).toBeCloseTo(10.5, 9);
    expect(raw!.future).toEqual({ slot: 1 });
    expect(raw!.time).toBeNull();
    const back = h.bridge.anchorToPixel(raw!);
    expect(back).not.toBeNull();
    expect(back!.x).toBeCloseTo(600, 9);
  });

  it("re-derives a stored future anchor's slot from the cadence after new bars shift the grid", () => {
    const h = make();
    const stored = h.bridge.pixelToAnchor(0, 625, 150, "snapBar");
    expect(stored).not.toBeNull();
    // One more real bar arrives: the stored slot number is now stale, the time is not.
    const arrived = futureBarTimes(TIMES, FUTURE_ANCHOR_BARS)[0];
    h.pushTimes([arrived]);
    const shiftedTimes = [...TIMES, arrived];
    const expectedSlot = futureSlotOf(futureCadence(shiftedTimes)!, stored!.time as string);
    const resolved = h.bridge.anchorToPixel({
      paneIndex: 0, time: stored!.time, logical: Number.NaN, price: stored!.price,
    });
    expect(resolved).not.toBeNull();
    const newLastLogical = 10; // bar index 10 is the arrived bar
    expect(resolved!.x).toBeCloseTo((newLastLogical + expectedSlot + 1 + 1.5) * 50, 9);
  });

  it("mints epoch-second future times on an intraday grid", () => {
    const times = Array.from({ length: 10 }, (_, i) => 1_700_000_000 + i * 3600);
    const h = make({ times });
    const snapped = h.bridge.pixelToAnchor(0, 625, 150, "snapBar");
    expect(snapped).not.toBeNull();
    expect(snapped!.future).toEqual({ slot: 1 });
    expect(snapped!.time).toBe(futureBarTimes(times, FUTURE_ANCHOR_BARS)[1]);
    // On a uniform intraday cadence the slot math is exact both ways.
    expect(futureSlotOf(futureCadence(times)!, snapped!.time as number)).toBe(1);
  });

  it("recognises a fed future whitespace tail and keeps the anchor future", () => {
    const tail = futureBarTimes(TIMES, FUTURE_ANCHOR_BARS);
    const h = make({ scaleExtraTimes: tail });
    const snapped = h.bridge.pixelToAnchor(0, 625, 150, "snapBar");
    expect(snapped).not.toBeNull();
    expect(snapped!.future).toEqual({ slot: 1 });
    expect(snapped!.time).toBe(tail[1]);
    // The scale knows the slot, so the time resolves directly.
    const back = h.bridge.anchorToPixel(snapped!);
    expect(back).not.toBeNull();
    expect(back!.x).toBeCloseTo(625, 9);
  });

  it("leaves a left-of-history snap without a time rather than inventing one", () => {
    const h = make();
    const snapped = h.bridge.pixelToAnchor(0, 10, 150, "snapBar"); // logical -1.3 → snap -1
    expect(snapped).not.toBeNull();
    expect(snapped!.time).toBeNull();
    expect(snapped!.future).toBeUndefined();
    expect(snapped!.logical).toBe(-1);
  });
});

describe("drawing bridge: Y-only projection (priceToY)", () => {
  it("answers each pane's own price scale and agrees with anchorToPixel when the pane is ready", () => {
    const h = make();
    for (const paneIndex of [0, 1]) {
      const y = h.bridge.priceToY(paneIndex, 50);
      expect(y).toBe(h.series[paneIndex].priceToCoordinate(50));
      expect(y).toBeCloseTo(h.bridge.anchorToPixel(anchor({ paneIndex }))!.y, 9);
    }
    expect(h.bridge.priceToY(0, 50)).not.toBeCloseTo(h.bridge.priceToY(1, 50)!, 3);
  });

  it("keeps answering while the time axis is unmeasured, where the full anchor projection is null", () => {
    const h = make();
    h.setRange(5, 5); // collapsed visible logical range: no x geometry at all
    expect(h.bridge.anchorToPixel(anchor({ paneIndex: 0 }))).toBeNull();
    expect(h.bridge.priceToY(0, 50)).toBe(h.series[0].priceToCoordinate(50));
    // An anchor whose x cannot resolve (unknown time, no logical) is null too; y is not.
    expect(h.bridge.anchorToPixel(anchor({ paneIndex: 0, time: "1999-01-01", logical: Number.NaN }))).toBeNull();
    expect(h.bridge.priceToY(0, 120)).toBe(h.series[0].priceToCoordinate(120));
  });

  it("fails closed with no primary series, a throwing series, a non-finite price or coordinate", () => {
    const h = make();
    h.setPrimary(1, false);
    expect(h.bridge.priceToY(1, 50)).toBeNull();
    h.setPrimary(1, true);
    expect(h.bridge.priceToY(1, 50)).not.toBeNull();
    expect(h.bridge.priceToY(0, Number.NaN)).toBeNull();
    expect(h.bridge.priceToY(0, Number.POSITIVE_INFINITY)).toBeNull();
    h.series[0].priceToCoordinate = () => null;
    expect(h.bridge.priceToY(0, 50)).toBeNull();
    h.series[0].priceToCoordinate = () => Number.NaN;
    expect(h.bridge.priceToY(0, 50)).toBeNull();
    h.series[0].priceToCoordinate = () => { throw new Error("removed"); };
    expect(h.bridge.priceToY(0, 50)).toBeNull();
  });
});
