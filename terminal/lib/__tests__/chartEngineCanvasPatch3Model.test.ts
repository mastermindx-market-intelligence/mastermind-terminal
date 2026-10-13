// @vitest-environment jsdom
// PATCH3M — independent-review findings F-1 / F-1b / F-2 / F-3 / F-5 / F-6 / F-7 / F-10
// from model2-rev / paint2-rev against the integrated head H2.
//
// One `describe("<finding id> ...")` per finding. Each test is the falsifier
// the review report names; the verdict on the LEDGER row comes from running
// this file against the (possibly patched) H2 head. Comments above every test
// name the LWC clause the finding is checked against.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCanvasEngine, createManualScheduler } from "@/lib/chart-engine/canvas";
import { ChartModel, type ModelClock } from "@/lib/chart-engine/canvas/model";
import { priceToDisplay, displayToPrice } from "@/lib/chart-engine/canvas/scales";
import { barTimeFacts } from "@/lib/chart-engine/time";
import type { EngineSeriesKind, EngineSeriesRow } from "@/lib/chart-engine/api";

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
        calls.push({ method: `set:${p}`, args: [v] });
        props[p] = v;
      },
      enumerable: true,
      configurable: true,
    });
  }
  return ctx as unknown as FakeCtx;
}

const ctxByCanvas = new WeakMap<HTMLCanvasElement, FakeCtx>();

function makeClock(): ModelClock & { nowMs: number; flush(): void } {
  const queued: Array<() => void> = [];
  const clock: ModelClock & { nowMs: number; flush(): void } = {
    nowMs: 0,
    now: () => clock.nowMs,
    schedule(cb) {
      queued.push(cb);
      return cb;
    },
    cancel(handle) {
      const i = queued.indexOf(handle as () => void);
      if (i >= 0) queued.splice(i, 1);
    },
    flush() {
      const batch = queued.splice(0);
      for (const cb of batch) cb();
    },
  };
  return clock;
}

function mounted(clock?: ModelClock, kind: EngineSeriesKind = "line"): ChartModel {
  const m = new ChartModel({
    onInvalidate: () => undefined,
    onStructure: () => undefined,
    clock,
  });
  m.applyOptions({ width: 200, height: 100 });
  m.addSeries(kind).setData(
    Array.from({ length: 10 }, (_, i) => ({ time: 1000 * (i + 1), value: i })),
  );
  return m;
}

// ============================================================================
// F-1 / F-1b — model2 F-1, paint2 F1b — 40k-point autoscale stack overflow
// ============================================================================
describe("model2 F-1 / paint2 F1b — 40k-point autoscale is stack-safe", () => {
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
      return ctx;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  // LWC autoscale accepts any number of rows; impl "mm" must do the same.
  it("fitContent of 40,000 candles yields a finite priceToCoordinate and paints", () => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 200,
      height: 100,
      devicePixelRatio: 1,
      scheduler,
    });
    const s = engine.addSeries("candles", { upColor: "U", downColor: "D" });
    const rows: EngineSeriesRow[] = [];
    for (let i = 0; i < 40_000; i++) {
      const close = 10 + (i % 7);
      rows.push({ time: 1_700_000_000 + i, open: 10, high: 18, low: 8, close });
    }
    s.setData(rows);
    engine.timeScale().fitContent();
    const y = s.priceToCoordinate(16);
    expect(y).not.toBeNull();
    expect(Number.isFinite(y!)).toBe(true);
    expect(() => scheduler.flush()).not.toThrow();
    engine.destroy();
  });
});

// ============================================================================
// F-2 — two autoscale truths (model.autoscaleScale vs series.ts extentsOf)
// ============================================================================
// At H2 frame.ts delegates displayScale to model.autoscaleScale (dab8e54c),
// so the painted range equals the contract range for any non-empty window.
describe("model2 F-2 — model.autoscaleScale and series.ts extentsOf agree on the window rule", () => {
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
      return ctx;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    container.remove();
  });

  // LWC visibleStrictRange = [floor(left), ceil(right)] (dev:1945).
  // With window {from:0, to:2.5} the last partial bar at index 2 must be in the range.
  it("fractional visibleTo includes the last partial bar across all six kinds", () => {
    const KINDS = ["candles", "bars", "line", "area", "histogram", "baseline"] as const;
    for (const kind of KINDS) {
      const scheduler = createManualScheduler();
      const engine = createCanvasEngine(container, {
        width: 240,
        height: 100,
        devicePixelRatio: 1,
        scheduler,
      });
      const opts: Record<string, unknown> = kind === "histogram"
        ? { color: "c", base: 0 }
        : kind === "baseline"
        ? { color: "c", baseValue: { price: 0 } }
        : kind === "candles" || kind === "bars"
        ? { upColor: "U", downColor: "D" }
        : { color: "c" };
      const s = engine.addSeries(kind, opts as never);
      const makeRow = (i: number): EngineSeriesRow => {
        if (kind === "candles" || kind === "bars") {
          return { time: i, open: 10, high: 12, low: 9, close: 11 };
        }
        return { time: i, value: 11 };
      };
      s.setData([0, 1, 2, 3, 4].map((i) => makeRow(i)));
      engine.timeScale().setVisibleLogicalRange({ from: 0, to: 2.5 });
      scheduler.flush();
      const range = s.priceScale().getVisibleRange();
      expect(range, `kind=${kind}`).not.toBeNull();
      // Close of row 2 is 11; last partial row 2 (to:2.5) must be in range.
      // Pad/contracted to >= 11 in normal mode (autoscale pads up).
      expect(range!.to, `kind=${kind}`).toBeGreaterThanOrEqual(11);
      engine.destroy();
    }
  });

  // Histogram must include the series base (dev:1925 special-case).
  it("histogram base 0 keeps 0 inside the autoscaled range", () => {
    const scheduler = createManualScheduler();
    const engine = createCanvasEngine(container, {
      width: 200,
      height: 100,
      devicePixelRatio: 1,
      scheduler,
    });
    const s = engine.addSeries("histogram", { color: "c", base: 0 });
    s.setData([
      { time: 1, value: 4 },
      { time: 2, value: 8 },
      { time: 3, value: 12 },
    ]);
    engine.timeScale().fitContent();
    scheduler.flush();
    const range = s.priceScale().getVisibleRange();
    expect(range).not.toBeNull();
    expect(range!.from).toBeLessThanOrEqual(0);
    expect(range!.to).toBeGreaterThanOrEqual(12);
    engine.destroy();
  });
});

// ============================================================================
// F-3 — scrollToRealtime() targets the OPTION rightOffset, not the live one
// ============================================================================
// LWC dev:6347-6350: scrollToRealTime = scrollToOffsetAnimated(options.rightOffset)
// over 400 ms. After any pan, options.rightOffset != time.rightOffset, so
// scrollToRealtime must re-anchor the live window to the option rightOffset,
// otherwise it is a no-op.
describe("model2 F-3 — scrollToRealtime targets the OPTION rightOffset", () => {
  it("after a pan, scrollToRealtime animates back to timeScaleBehaviour.rightOffset", () => {
    const clock = makeClock();
    const m = mounted(clock);
    // option rightOffset = 5; after a pan, live offset is -5
    m.timeScaleHandleFor().applyOptions({ rightOffset: 5 });
    expect(m.timeScaleHandleFor().options().rightOffset).toBe(5);
    m.timeScaleHandleFor().setVisibleLogicalRange({ from: -5, to: 5 });
    expect(m.time.rightOffset).toBe(-5);
    // Trigger the realtime scroll (animated, default)
    m.timeScaleHandleFor().scrollToRealtime();
    // 400 ms of animation
    clock.nowMs = 400;
    clock.flush();
    // After animation, the window must put the rightmost data bar at the right
    // edge of the pane (i.e. visibleTo == n + optionRightOffset).
    expect(m.time.rightOffset).toBe(5);
    expect(m.getVisibleLogicalRange()).toEqual({ from: 5, to: 15 });
  });

  it("scrollToRealtime is animated (does not snap)", () => {
    const clock = makeClock();
    const m = mounted(clock);
    m.timeScaleHandleFor().applyOptions({ rightOffset: 8 });
    m.timeScaleHandleFor().setVisibleLogicalRange({ from: 0, to: 5 });
    m.timeScaleHandleFor().scrollToRealtime();
    // Mid-flight: should be between 0 and 8, not yet at the target.
    clock.nowMs = 200;
    clock.flush();
    expect(m.time.rightOffset).toBeGreaterThan(0);
    expect(m.time.rightOffset).toBeLessThan(8);
  });
});

// ============================================================================
// F-5 — percent / indexed100 sign-flip for negative base (dev:4185-4194)
// ============================================================================
describe("model2 F-5 — percent / indexed100 sign-flip for negative base", () => {
  // percent with base -200: -50 should map to +75 (NOT -75).
  it("percent priceToDisplay flips sign when base is negative", () => {
    const state = {
      mode: "percent" as const,
      inverted: false,
      from: 0,
      to: 75,
      heightPx: 100,
      margins: { top: 0.1, bottom: 0.1 },
      baseValue: -200,
    };
    expect(priceToDisplay(-200, state)).toBeCloseTo(0, 9);
    expect(priceToDisplay(-50, state)).toBeCloseTo(75, 9);
  });

  // indexed100 with base -200: the LWC rule is "100 + 100*(price-base)/base, then
  // flip sign when base<0" (dev:4200-4205, 4207-4210). -200 (== base) maps to
  // -100 (the index baseline flipped); -50 maps to -25 (not +25).
  it("indexed100 priceToDisplay flips sign when base is negative", () => {
    const state = {
      mode: "indexed100" as const,
      inverted: false,
      from: 0,
      to: 75,
      heightPx: 100,
      margins: { top: 0.1, bottom: 0.1 },
      baseValue: -200,
    };
    expect(priceToDisplay(-200, state)).toBeCloseTo(-100, 9);
    expect(priceToDisplay(-50, state)).toBeCloseTo(-25, 9);
  });

  // displayToPrice must be the inverse: -50 -> +75 -> -50.
  it("percent displayToPrice round-trips negative-base prices", () => {
    const state = {
      mode: "percent" as const,
      inverted: false,
      from: 0,
      to: 75,
      heightPx: 100,
      margins: { top: 0.1, bottom: 0.1 },
      baseValue: -200,
    };
    expect(displayToPrice(75, state)).toBeCloseTo(-50, 9);
    expect(displayToPrice(-75, state)).toBeCloseTo(-350, 9);
  });
});

// ============================================================================
// F-6 — usableBase silently substitutes 1 for 0 (documented deviation)
// ============================================================================
// Deviation pinned: percent/indexed100 with base 0 (or undefined) yields a
// finite, round-trippable scale via the substitution to 1; LWC produces Infinity
// / NaN. Pin the engineering choice.
describe("model2 F-6 — usableBase fallback is finite and round-trippable", () => {
  it("percent base=0 yields a finite scale via the 1-substitution", () => {
    const state = {
      mode: "percent" as const,
      inverted: false,
      from: 0,
      to: 100,
      heightPx: 100,
      margins: { top: 0.1, bottom: 0.1 },
      baseValue: 0,
    };
    // pin: percent 0 with base 0 yields 0 - 100 (LWC would yield Infinity/NaN)
    expect(priceToDisplay(0, state)).toBeCloseTo(-100, 9);
    expect(priceToDisplay(5, state)).toBeCloseTo(400, 9);
    expect(Number.isFinite(displayToPrice(priceToDisplay(5, state), state))).toBe(true);
  });

  it("indexed100 base=undefined (no baseValue) yields a finite scale via the 1-substitution", () => {
    const state = {
      mode: "indexed100" as const,
      inverted: false,
      from: 0,
      to: 100,
      heightPx: 100,
      margins: { top: 0.1, bottom: 0.1 },
      // baseValue undefined
    };
    expect(Number.isFinite(priceToDisplay(5, state))).toBe(true);
    expect(Number.isFinite(priceToDisplay(0, state))).toBe(true);
  });
});

// ============================================================================
// F-7 — dataByIndex over whitespace rows
// ============================================================================
// LWC dev:3015-3039 / dev:13128-13136: dataByIndex searches the valued PlotList
// (whitespace is a miss). canvas indexes s.rows which contains whitespace.
describe("model2 F-7 — dataByIndex returns null at whitespace and skips whitespace for nearest-left/right", () => {
  it("dataByIndex(whitespace_index) is null (not the whitespace row)", () => {
    const m = mounted();
    const s = m.addSeries("line");
    s.setData([
      { time: 1000, value: 1 },
      { time: 2000 }, // whitespace
      { time: 3000, value: 3 },
    ]);
    expect(s.dataByIndex(1)).toBeNull();
  });

  it("dataByIndex(1.5, nearest-left) skips the whitespace row", () => {
    const m = mounted();
    const s = m.addSeries("line");
    s.setData([
      { time: 1000, value: 1 },
      { time: 2000 }, // whitespace
      { time: 3000, value: 3 },
    ]);
    // nearest-left of 1.5 over a valued list [1000, 3000] returns index 0 (time 1000)
    expect(s.dataByIndex(1.5, "nearest-left")).toEqual({ time: 1000, value: 1 });
  });

  it("dataByIndex(0.5, nearest-right) returns the next valued row (time 3000), not the whitespace at index 1", () => {
    const m = mounted();
    const s = m.addSeries("line");
    s.setData([
      { time: 1000, value: 1 },
      { time: 2000 }, // whitespace
      { time: 3000, value: 3 },
    ]);
    // nearest-right of 0.5 over valuedAt [0, 2] returns the smallest valued
    // index where valuedAt[i] >= 0.5, i.e. index 2 (time 3000).
    // At H2 Math.ceil(0.5)=1 returns the whitespace row.
    expect(s.dataByIndex(0.5, "nearest-right")).toEqual({ time: 3000, value: 3 });
  });

  // P-5 / REV-F1: setData must invalidate the valuedIdx cache. After a primed
  // read on data A, switching to data B (same times, but rows 2 and 3 are
  // whitespace) must NOT serve a stale index. Without invalidation the cached
  // valuedAt of A still points at row index 2 (which is whitespace in B).
  it("[P-5] setData invalidates valuedIdx so a primed cache cannot answer an after-stale nearest-right", () => {
    const m = mounted();
    const s = m.addSeries("line");
    // Data A: 5 valued rows at times 1000..5000.
    s.setData([
      { time: 1000, value: 1 },
      { time: 2000, value: 2 },
      { time: 3000, value: 3 },
      { time: 4000, value: 4 },
      { time: 5000, value: 5 },
    ]);
    // Prime the cache.
    const primed = s.dataByIndex(1.2, "nearest-right");
    expect(primed).toEqual({ time: 3000, value: 3 });
    // Data B: same times, but rows 2 and 3 are whitespace.
    s.setData([
      { time: 1000, value: 1 },
      { time: 2000, value: 2 },
      { time: 3000 }, // whitespace
      { time: 4000 }, // whitespace
      { time: 5000, value: 5 },
    ]);
    // nearest-right of 1.2 over B's valued list [0, 1, 4] must return row 4
    // (time 5000), not the stale row 2 (whitespace in B).
    expect(s.dataByIndex(1.2, "nearest-right")).toEqual({ time: 5000, value: 5 });
  });

  // P-5 / REV-F1: update() must invalidate the valuedIdx cache. After a primed
  // read on data A, an update that turns a previously valued row into
  // whitespace (or appends a row) must NOT serve a stale index. The F-7
  // semantics pin the answer: nearest-right of 1.2 over B's valuedAt [0, 3]
  // returns row index 3 (time 4000, value 4).
  it("[P-5] update() invalidates valuedIdx so a primed cache cannot answer an after-stale nearest-right", () => {
    const m = mounted();
    const s = m.addSeries("line");
    // Data A: 4 valued rows at times 1000..4000.
    s.setData([
      { time: 1000, value: 1 },
      { time: 2000, value: 2 },
      { time: 3000, value: 3 },
      { time: 4000, value: 4 },
    ]);
    const primed = s.dataByIndex(1.2, "nearest-right");
    expect(primed).toEqual({ time: 3000, value: 3 });
    // Historical update at time 3000 turns that row into whitespace (drops the value).
    s.update({ time: 3000 }, true);
    // nearest-right of 1.2 over valuedAt [0, 1, 3] returns row index 3.
    expect(s.dataByIndex(1.2, "nearest-right")).toEqual({ time: 4000, value: 4 });
  });
});

// ============================================================================
// F-8 — timeToIndex findNearest tie-break
// ============================================================================
// DECISION_NEEDED: the fix breaks chartEngineCanvasC02.test.ts:148 which
// pins `expect(ts.timeToIndex("2026-01-06T15:00:00Z", true)).toBe(1)` —
// LWC's lowerBound rule returns 2 for that input (next index after a
// strict miss), and the C02 assertion would have to move to 2 to land
// the fix. C02 is not in OWNED FILES. Unified diff + the C02 correction
// are in RESULT.md PROPOSED_PATCHES.

// ============================================================================
// F-10 — barTimeFacts display-basis: openUtcMs is in the record's basis
// ============================================================================
// time.ts documents openUtcMs as "True UTC epoch ms" (line 33), but freezeFacts
// under keyBasis "display" stores the DISPLAY-epoch ms in openUtcMs. The record
// must carry a self-describing keyBasis field so consumers can tell.
describe("model2 F-10 — barTimeFacts records the keyBasis it was extracted under", () => {
  // A minimal Market shape (liveCandle.ts owns the real one; barTimeFacts just
  // needs the liveDisplayEpoch hookup to exist for this market).
  // Use a neutral market via the existing time helper.
  it("utc basis: openUtcMs is true UTC ms; displayEpochSec matches openUtcMs/1000", () => {
    const market = { displayTimezone: "UTC", ahead: undefined } as never;
    const facts = barTimeFacts({ time: 1_700_000_000 }, market, 100);
    expect(facts).not.toBeNull();
    expect((facts as unknown as { keyBasis: string }).keyBasis).toBe("utc");
    expect(facts!.openUtcMs).toBe(1_700_000_000 * 1000);
  });

  it("display basis: openUtcMs is DISPLAY ms; keyBasis field is 'display'", () => {
    // For a UTC market, display basis == utc basis (no shift), so this asserts
    // the field is present and equals the input keyBasis value.
    const market = { displayTimezone: "UTC", ahead: undefined } as never;
    const facts = barTimeFacts({ time: 1_700_000_000 }, market, 100, "display");
    expect(facts).not.toBeNull();
    expect((facts as unknown as { keyBasis: string }).keyBasis).toBe("display");
  });
});

// ============================================================================
// F-4 — correctRightOffset always clamps + setVisibleLogicalRange clamps spacing
// ============================================================================
// DECISION_NEEDED: the fix breaks existing assertions in
// chartEngineCanvasModelF15.test.ts (F-15 rightOffset 10 / {from:10,to:20}).
// The unified diff (implementation + the two F15 assertion corrections) is
// filed in RESULT.md PROPOSED_PATCHES. No test is committed for this finding.
// See RESULT.md DECISIONS for the option matrix.