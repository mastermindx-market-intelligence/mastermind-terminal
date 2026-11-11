import { describe, expect, it } from "vitest";
import { TickMarkType, type UTCTimestamp } from "lightweight-charts";
import { formatChartTimeTick } from "@/lib/chartTimeAxis";
import {
  AUTOSCALE_PAD_RATIO,
  MAX_BAR_SPACING,
  MIN_BAR_SPACING,
  autoscaleRange,
  barSpacingOf,
  coordinateToPrice,
  logicalOfX,
  panLogicalRange,
  panPriceRange,
  priceToCoordinate,
  xOfLogical,
  zoomLogicalRange,
  zoomPriceRange,
  type PriceScaleMode,
  type PriceScaleState,
  type TimeScaleState,
} from "@/lib/chart-engine/canvas/scales";
import {
  TIME_TICK_WEIGHT,
  priceTicks,
  timeTicks,
} from "@/lib/chart-engine/canvas/ticks";

const MODES: PriceScaleMode[] = ["normal", "log", "percent", "indexed100"];
const HEIGHTS = [64, 100, 240, 401, 800];
const MARGINS = { top: 0.1, bottom: 0.1 };

function expectRel(a: number, b: number, tol = 1e-9, label = ""): void {
  const diff = Math.abs(a - b);
  const scale = Math.max(Math.abs(a), Math.abs(b));
  const err = scale < 1e-12 ? diff : diff / scale;
  const limit = scale < 1e-12 ? 1e-12 : tol;
  expect(err, label || `${a} vs ${b}`).toBeLessThanOrEqual(limit);
}

function baseState(mode: PriceScaleMode, inverted: boolean, heightPx: number): PriceScaleState {
  if (mode === "percent") {
    return { mode, inverted, from: -25, to: 25, heightPx, margins: MARGINS, baseValue: 100 };
  }
  if (mode === "indexed100") {
    return { mode, inverted, from: 70, to: 130, heightPx, margins: MARGINS, baseValue: 100 };
  }
  if (mode === "log") {
    return { mode, inverted, from: 1e-6, to: 1e6, heightPx, margins: MARGINS };
  }
  return { mode, inverted, from: -50, to: 250, heightPx, margins: MARGINS };
}

function samplePrices(mode: PriceScaleMode): number[] {
  const prices: number[] = [];
  if (mode === "log") {
    for (let i = 0; i < 35; i += 1) prices.push(10 ** (-8 + i * 0.35));
    for (const n of [-1e-6, -1e-4, -0.02, -1, -8, -80, Math.PI, 42, 99, 250, 800, 2.5, 0.03, 123.4, Math.E]) {
      prices.push(n);
    }
  } else if (mode === "normal") {
    for (let i = 0; i < 35; i += 1) prices.push(-45 + i * 8);
    for (const n of [0, -0.25, 0.25, -1, 1, Math.PI, Math.E * 10, 12.5, 99.5, 200.25, -12.5, 7.5, 33.3, -33.3, 249]) {
      prices.push(n);
    }
  } else {
    for (let i = 0; i < 50; i += 1) prices.push(75 + i);
  }
  return prices.slice(0, 50);
}

function isNiceDisplay(value: number): boolean {
  if (value === 0) return true;
  const abs = Math.abs(value);
  const exp = Math.floor(Math.log10(abs));
  const mantissa = abs / 10 ** exp;
  return [1, 2, 2.5, 5].some((n) => Math.abs(mantissa - n) < 1e-6);
}

function dailyKeys(startIso: string, count: number): string[] {
  const ms = Date.parse(`${startIso}T00:00:00Z`);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(new Date(ms + i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

describe("T02-A01 priceToCoordinate / coordinateToPrice round-trip", () => {
  it("inverts within 1e-9 relative across modes, inversion, heights, and prices", () => {
    let checks = 0;
    for (const mode of MODES) {
      for (const inverted of [false, true]) {
        for (const heightPx of HEIGHTS) {
          const state = baseState(mode, inverted, heightPx);
          for (const price of samplePrices(mode)) {
            const y = priceToCoordinate(price, state);
            expect(Number.isFinite(y), `${mode} y finite`).toBe(true);
            const restored = coordinateToPrice(y, state);
            expect(Number.isFinite(restored), `${mode} price finite`).toBe(true);
            expectRel(restored, price, 1e-9, `${mode} inv=${inverted} h=${heightPx} p=${price}`);
            checks += 1;
          }
        }
      }
    }
    expect(checks).toBe(MODES.length * 2 * HEIGHTS.length * 50);
  });

  it("maps display-range edges onto the internal band", () => {
    const state = baseState("normal", false, 100);
    const topPx = MARGINS.top * 100;
    const bottomPx = MARGINS.bottom * 100;
    expectRel(priceToCoordinate(state.to, state), topPx);
    expectRel(priceToCoordinate(state.from, state), 100 - 1 - bottomPx);
  });
});

describe("T02-A02 autoscale degenerate extents", () => {
  const state = baseState("normal", false, 240);

  it("keeps the last valid range when extents are null or all-missing", () => {
    const fromNull = autoscaleRange(null, state);
    expect(fromNull.unavailable).toBe(true);
    expect(fromNull.from).toBe(state.from);
    expect(fromNull.to).toBe(state.to);
    const missing = autoscaleRange({ min: Number.NaN, max: Number.NaN }, state);
    expect(missing.unavailable).toBe(true);
    expect(missing.from).toBe(state.from);
    expect(Number.isNaN(missing.from)).toBe(false);
    expect(Number.isNaN(missing.to)).toBe(false);
  });

  it("pads a constant / single-bar series by max(|v|*0.005, minMove)", () => {
    const constant = autoscaleRange({ min: 100, max: 100 }, state);
    const pad = Math.max(Math.abs(100) * AUTOSCALE_PAD_RATIO, 0);
    expect(constant.unavailable).toBeUndefined();
    expectRel(constant.from, 100 - pad);
    expectRel(constant.to, 100 + pad);
    expect(Number.isNaN(constant.from)).toBe(false);

    const withMove = autoscaleRange({ min: 100, max: 100 }, state, { minMove: 2 });
    expectRel(withMove.from, 98);
    expectRel(withMove.to, 102);

    const zero = autoscaleRange({ min: 0, max: 0 }, state);
    expect(zero.to - zero.from).toBeGreaterThan(0);
    expect(Number.isFinite(zero.from)).toBe(true);
  });

  it("honours margins: autoscaled min/max sit on the internal-band edges", () => {
    const next = autoscaleRange({ min: 40, max: 80 }, state);
    const scaled: PriceScaleState = { ...state, from: next.from, to: next.to };
    const topPx = MARGINS.top * state.heightPx;
    const bottomPx = MARGINS.bottom * state.heightPx;
    expectRel(priceToCoordinate(80, scaled), topPx, 1e-9);
    expectRel(priceToCoordinate(40, scaled), state.heightPx - 1 - bottomPx, 1e-9);
  });

  it("includes lockTo in the autoscaled window", () => {
    const next = autoscaleRange({ min: 10, max: 12 }, state, { lockTo: 0 });
    expect(next.from).toBeLessThanOrEqual(0);
    expect(next.to).toBeGreaterThanOrEqual(12);
  });

  it("autoscales percent and indexed100 in the display domain", () => {
    const percent = baseState("percent", false, 200);
    const next = autoscaleRange({ min: 90, max: 110 }, percent);
    expectRel(next.from, -10);
    expectRel(next.to, 10);
  });
});

describe("T02-A04 opposite-wheel restore", () => {
  it("returns to the baseline within 1e-9 after equal opposite deltas", () => {
    const anchorY = 120;
    for (const mode of MODES) {
      for (const inverted of [false, true]) {
        const baseline = baseState(mode, inverted, 240);
        let state = baseline;
        for (let i = 0; i < 6; i += 1) state = zoomPriceRange(state, anchorY, 120, 0);
        for (let i = 0; i < 6; i += 1) state = zoomPriceRange(state, anchorY, -120, 0);
        expectRel(state.from, baseline.from, 1e-9, `${mode} from`);
        expectRel(state.to, baseline.to, 1e-9, `${mode} to`);
      }
    }
  });

  it("keeps the price under the pointer fixed while zooming", () => {
    const state = baseState("normal", false, 240);
    const anchorY = 90;
    const price = coordinateToPrice(anchorY, state);
    const zoomed = zoomPriceRange(state, anchorY, -120, 0);
    expectRel(coordinateToPrice(anchorY, zoomed), price, 1e-9);
    expect(Math.abs(priceToCoordinate(price, zoomed) - anchorY)).toBeLessThanOrEqual(1);
  });

  it("pans the window so content follows dyPx", () => {
    const state = baseState("normal", false, 200);
    const y = 80;
    const price = coordinateToPrice(y, state);
    const panned = panPriceRange(state, 20);
    expectRel(coordinateToPrice(y + 20, panned), price, 1e-9);
  });
});

describe("T02-A03 priceTicks spacing and nice values", () => {
  it("keeps adjacent label y's at least minLabelGapPx apart with nice steps", () => {
    const minGap = 18;
    for (const mode of ["normal", "percent", "indexed100"] as PriceScaleMode[]) {
      const state = baseState(mode, false, 400);
      const ticks = priceTicks(state, { minLabelGapPx: minGap });
      expect(ticks.length).toBeGreaterThan(1);
      const step = Math.abs(ticks[1].value - ticks[0].value);
      expect(isNiceDisplay(step), `${mode} step ${step}`).toBe(true);
      for (let i = 1; i < ticks.length; i += 1) {
        expect(Math.abs(ticks[i].y - ticks[i - 1].y)).toBeGreaterThanOrEqual(minGap);
        expectRel(Math.abs(ticks[i].value - ticks[i - 1].value), step, 1e-6, `${mode} tick step`);
      }
    }
  });

  it("spaces log ticks by minLabelGapPx on the display log scale", () => {
    const state = baseState("log", false, 400);
    const minGap = 22;
    const ticks = priceTicks(state, { minLabelGapPx: minGap });
    expect(ticks.length).toBeGreaterThan(1);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(Math.abs(ticks[i].y - ticks[i - 1].y)).toBeGreaterThanOrEqual(minGap);
    }
  });

  it("respects inversion without overlapping", () => {
    const state = baseState("normal", true, 300);
    const ticks = priceTicks(state, { minLabelGapPx: 16 });
    for (let i = 1; i < ticks.length; i += 1) {
      expect(Math.abs(ticks[i].y - ticks[i - 1].y)).toBeGreaterThanOrEqual(16);
    }
  });
});

describe("timeTicks weight precedence and collision", () => {
  it("lets a year tick win over day ticks at narrow widths", () => {
    const rows = dailyKeys("2019-12-01", 80);
    const state: TimeScaleState = {
      visibleFrom: 0,
      visibleTo: rows.length,
      barSpacing: 0,
      rightOffset: 0,
      widthPx: 120,
    };
    const ticks = timeTicks(rows, state, { minGapPx: 40, hourFormat: "24" });
    expect(ticks.length).toBeGreaterThan(0);
    for (let i = 1; i < ticks.length; i += 1) {
      expect(Math.abs(ticks[i].x - ticks[i - 1].x)).toBeGreaterThanOrEqual(40);
    }
    expect(ticks.some((t) => t.weight === TIME_TICK_WEIGHT.year)).toBe(true);
    const newYear = ticks.find((t) => t.index === rows.indexOf("2020-01-01"));
    if (newYear) expect(newYear.weight).toBe(TIME_TICK_WEIGHT.year);
  });

  it("drops colliding lower-weight hour ticks in favour of the first higher-weight one", () => {
    const start = Date.UTC(2026, 6, 30, 16, 0, 0) / 1000;
    const rows: number[] = [];
    for (let i = 0; i < 180; i += 1) rows.push(start + i * 60);
    const state: TimeScaleState = {
      visibleFrom: 0,
      visibleTo: rows.length,
      barSpacing: 4,
      rightOffset: 0,
      widthPx: 80,
    };
    const ticks = timeTicks(rows, state, { minGapPx: 30, hourFormat: "12" });
    for (let i = 1; i < ticks.length; i += 1) {
      expect(Math.abs(ticks[i].x - ticks[i - 1].x)).toBeGreaterThanOrEqual(30);
    }
    const hours = ticks.filter((t) => t.weight === TIME_TICK_WEIGHT.hour);
    const minutes = ticks.filter((t) => t.weight === TIME_TICK_WEIGHT.minute);
    expect(hours.length).toBeGreaterThan(0);
    for (const minute of minutes) {
      for (const hour of hours) {
        expect(Math.abs(minute.x - hour.x)).toBeGreaterThanOrEqual(30);
      }
    }
  });

  it("matches formatChartTimeTick for 12-hour clock labels", () => {
    const instant = (Date.UTC(2026, 6, 30, 17, 5, 0) / 1000) as UTCTimestamp;
    const rows = [instant - 60, instant, instant + 60];
    const state: TimeScaleState = {
      visibleFrom: 0,
      visibleTo: 3,
      barSpacing: 40,
      rightOffset: 0,
      widthPx: 120,
    };
    const ticks = timeTicks(rows, state, { minGapPx: 8, hourFormat: "12" });
    const expected = formatChartTimeTick(instant, TickMarkType.Time, "12");
    expect(expected).toBe("5:05 PM");
    expect(ticks.some((t) => t.label === expected)).toBe(true);
  });
});

describe("timeScaleMath logical projection", () => {
  const state: TimeScaleState = {
    visibleFrom: 100,
    visibleTo: 200,
    barSpacing: 8,
    rightOffset: 5,
    widthPx: 800,
  };

  it("round-trips xOfLogical / logicalOfX", () => {
    expectRel(barSpacingOf(state), 8);
    for (const i of [100, 100.5, 150, 199.25]) {
      expectRel(logicalOfX(xOfLogical(i, state), state), i, 1e-9);
    }
  });

  it("keeps the logical index under the zoom anchor fixed within 1e-9", () => {
    const anchorX = 240;
    const before = logicalOfX(anchorX, state);
    const zoomed = zoomLogicalRange(state, anchorX, 0.5);
    expectRel(logicalOfX(anchorX, zoomed), before, 1e-9);
    const out = zoomLogicalRange(zoomed, anchorX, 2);
    expectRel(logicalOfX(anchorX, out), before, 1e-9);
    expectRel(out.visibleFrom, state.visibleFrom, 1e-9);
    expectRel(out.visibleTo, state.visibleTo, 1e-9);
  });

  it("clamps bar spacing to [0.5, 50] and visibleTo/from against the data window", () => {
    const tight = zoomLogicalRange(state, 400, 0.01);
    expect(barSpacingOf(tight)).toBeLessThanOrEqual(MAX_BAR_SPACING);
    expect(barSpacingOf(tight)).toBeGreaterThanOrEqual(MIN_BAR_SPACING);

    const wide = zoomLogicalRange(state, 400, 1000);
    expect(barSpacingOf(wide)).toBeGreaterThanOrEqual(MIN_BAR_SPACING);

    const left = panLogicalRange(
      { ...state, visibleFrom: -20, visibleTo: -5, barSpacing: 800 / 15, widthPx: 800 },
      20_000,
      { rowCount: 50 },
    );
    expect(left.visibleTo).toBeGreaterThanOrEqual(0);

    const right = panLogicalRange(
      { ...state, visibleFrom: 80, visibleTo: 120, barSpacing: 20, widthPx: 800 },
      -20_000,
      { rowCount: 50 },
    );
    expect(right.visibleFrom).toBeLessThanOrEqual(50 + state.rightOffset);
  });
});
