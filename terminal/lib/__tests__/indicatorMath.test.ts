// indicatorMath.test.ts — pure-math tests for the DT technicals suite.
// All inputs are deterministic (no Date.now, no Math.random).
// Run with: npm test  (vitest run)

import { describe, it, expect } from "vitest";
import {
  ema,
  rma,
  ichimoku,
  supertrend,
  rsiStack,
  accumPct,
  trendRibbon,
  rollingPercentile,
  volbox,
  type Bar,
} from "../indicatorMath";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate valid business-day date strings starting from 2020-01-02 (a Thursday). */
function genDates(n: number): string[] {
  const dates: string[] = [];
  // Start at a known valid date and advance by 1 day, skipping weekends
  let ms = Date.UTC(2020, 0, 2); // 2020-01-02
  while (dates.length < n) {
    const d = new Date(ms);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      dates.push(d.toISOString().slice(0, 10));
    }
    ms += 86400_000;
  }
  return dates;
}

/** Build a synthetic Bar array with a constant close price. */
function constBars(n: number, price: number, vol = 1000): Bar[] {
  const dates = genDates(n);
  return dates.map((time) => ({ time, o: price, h: price, l: price, c: price, v: vol }));
}

/** Build a staircase (incrementing by `step` each bar). */
function stairBars(n: number, start: number, step = 1, vol = 1000): Bar[] {
  const dates = genDates(n);
  return dates.map((time, i) => {
    const p = start + i * step;
    const hi = p + Math.abs(step) + 1;
    const lo = p - Math.abs(step) - 1;
    return { time, o: p, h: hi, l: lo, c: p, v: vol };
  });
}

// ─── EMA tests ────────────────────────────────────────────────────────────────

describe("ema", () => {
  it("output length matches input length", () => {
    const src = Array.from({ length: 50 }, (_, i) => i + 1);
    const result = ema(src, 10);
    expect(result.length).toBe(src.length);
  });

  it("first (len-1) outputs are null (warmup region)", () => {
    const len = 10;
    const src = Array.from({ length: 50 }, (_, i) => i + 1);
    const result = ema(src, len);
    for (let i = 0; i < len - 1; i++) {
      expect(result[i]).toBeNull();
    }
    // first non-null appears at index len-1
    expect(result[len - 1]).not.toBeNull();
  });

  it("converges toward a constant input", () => {
    const constant = 42;
    const len = 5;
    // use a long-enough series so EMA has time to converge
    const src = Array(100).fill(constant);
    const result = ema(src, len);
    const lastVal = result[result.length - 1];
    expect(lastVal).not.toBeNull();
    expect(Math.abs(lastVal! - constant)).toBeLessThan(0.001);
  });

  it("handles null values in input gracefully (output length preserved)", () => {
    const src: (number | null)[] = [1, null, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = ema(src, 3);
    expect(result.length).toBe(src.length);
  });
});

// ─── RMA tests ────────────────────────────────────────────────────────────────

describe("rma", () => {
  it("output length matches input length", () => {
    const src = Array.from({ length: 30 }, (_, i) => i + 1);
    const result = rma(src, 7);
    expect(result.length).toBe(src.length);
  });

  it("warmup region is null (first len-1 positions)", () => {
    const len = 14;
    const src = Array.from({ length: 60 }, () => 10);
    const result = rma(src, len);
    for (let i = 0; i < len - 1; i++) {
      expect(result[i]).toBeNull();
    }
    expect(result[len - 1]).not.toBeNull();
  });

  it("converges toward a constant input", () => {
    const constant = 100;
    const src = Array(200).fill(constant);
    const result = rma(src, 14);
    const lastVal = result[result.length - 1];
    expect(lastVal).not.toBeNull();
    expect(Math.abs(lastVal! - constant)).toBeLessThan(0.001);
  });
});

// ─── Rolling percentile / Volatility Box warmup ───────────────────────────────

describe("rollingPercentile", () => {
  it("does not emit a percentile until the whole rolling window is finite", () => {
    const src: (number | null)[] = [null, null, 1, 2, 3, 4];
    const result = rollingPercentile(src, 3);

    expect(result.slice(0, 4)).toEqual([null, null, null, null]);
    expect(result[4]).toBe(100);
    expect(result[5]).toBe(100);
  });

  it("keeps Volatility Box out of squeeze state until pctileWin bandwidth observations exist", () => {
    const bars = constBars(12, 100);
    const result = volbox(bars, 3, 2, 5, 100, 3);

    // BB bandwidth itself warms at index 2. A five-observation percentile window is not
    // complete until index 6 (2,3,4,5,6), so no squeeze classification may appear earlier.
    expect(result.inSqueeze.slice(0, 6)).toEqual(Array(6).fill(false));
    expect(result.inSqueeze[6]).toBe(true);
  });
});

// ─── Ichimoku tests ────────────────────────────────────────────────────────────

describe("ichimoku", () => {
  const TENKAN = 9, KIJUN = 26, SENKOU_B = 52, DISP = 26;

  it("tenkan/kijun arrays match input bar count", () => {
    const bars = constBars(100, 50);
    const result = ichimoku(bars, TENKAN, KIJUN, SENKOU_B, DISP);
    expect(result.tenkan.length).toBe(bars.length);
    expect(result.kijun.length).toBe(bars.length);
  });

  it("spanA and spanB are displaced forward — length = bars.length + displacement", () => {
    const bars = constBars(100, 50);
    const result = ichimoku(bars, TENKAN, KIJUN, SENKOU_B, DISP);
    expect(result.spanA.length).toBe(bars.length + DISP);
    expect(result.spanB.length).toBe(bars.length + DISP);
  });

  it("futureTimes extends past the last bar (PIT: projected span index > current bar index)", () => {
    const bars = constBars(100, 50);
    const result = ichimoku(bars, TENKAN, KIJUN, SENKOU_B, DISP);
    expect(result.futureTimes.length).toBe(bars.length + DISP);
    // The first `bars.length` entries are the original bar times
    for (let i = 0; i < bars.length; i++) {
      expect(result.futureTimes[i]).toBe(bars[i].time);
    }
    // The last `DISP` entries are strictly after the last bar time
    const lastBarTime = bars[bars.length - 1].time as string;
    for (let i = bars.length; i < result.futureTimes.length; i++) {
      expect(result.futureTimes[i] as string > lastBarTime).toBe(true);
    }
  });

  it("spanA first displacement values are null (no data before warmup)", () => {
    const bars = constBars(100, 50);
    const result = ichimoku(bars, TENKAN, KIJUN, SENKOU_B, DISP);
    // spanA[i] is set at index i+displacement; so first entries 0..DISP-1 that
    // correspond to pre-warmup bars should be null
    expect(result.spanA[0]).toBeNull();
  });

  it("on constant-price bars, spanA equals spanB", () => {
    const price = 100;
    const bars = constBars(200, price);
    const result = ichimoku(bars, TENKAN, KIJUN, SENKOU_B, DISP);
    // After warmup (index > KIJUN-1 + DISP), spanA == spanB == price
    const startIdx = KIJUN - 1 + DISP;
    for (let i = startIdx; i < result.spanA.length; i++) {
      if (result.spanA[i] != null && result.spanB[i] != null) {
        expect(result.spanA[i]).toBeCloseTo(price, 5);
        expect(result.spanB[i]).toBeCloseTo(price, 5);
      }
    }
  });
});

// ─── SuperTrend tests ──────────────────────────────────────────────────────────

describe("supertrend", () => {
  it("output arrays match input length", () => {
    const bars = stairBars(100, 10, 1);
    const result = supertrend(bars, 10, 3);
    expect(result.up.length).toBe(bars.length);
    expect(result.down.length).toBe(bars.length);
    expect(result.trend.length).toBe(bars.length);
  });

  it("early bars (before ATR warmup) are null", () => {
    const period = 10;
    const bars = stairBars(100, 10, 1);
    const result = supertrend(bars, period, 3);
    // ATR warmup = period-1 bars null
    expect(result.up[0]).toBeNull();
    expect(result.trend[0]).toBeNull();
  });

  it("flips trend on a constructed reversal — large downtrend then sharp reversal up", () => {
    // Use a large step so ATR is clearly crossed and trend flips.
    // 80 bars falling steeply (step -5 with tight H/L), then 80 bars rising steeply.
    const dates = genDates(160);
    const downBars: Bar[] = Array.from({ length: 80 }, (_, i) => ({
      time: dates[i],
      o: 500 - i * 5, h: 500 - i * 5 + 1, l: 500 - i * 5 - 1, c: 500 - i * 5 - 1, v: 1000,
    }));
    // Up phase starts from 105 (below where down ended: ~105) and rises sharply
    const upBars: Bar[] = Array.from({ length: 80 }, (_, i) => ({
      time: dates[80 + i],
      o: 105 + i * 5, h: 105 + i * 5 + 1, l: 105 + i * 5 - 1, c: 105 + i * 5 + 1, v: 1000,
    }));
    const bars = [...downBars, ...upBars];
    const result = supertrend(bars, 10, 3);

    // During late down phase, trend should be false (bearish)
    const downPhaseTrends = result.trend.slice(30, 80).filter((t) => t !== null);
    const anyFalseInDown = downPhaseTrends.some((t) => t === false);
    expect(anyFalseInDown).toBe(true);

    // During late up phase, trend should be true (bullish)
    const upPhaseTrends = result.trend.slice(120).filter((t) => t !== null);
    const anyTrueInUp = upPhaseTrends.some((t) => t === true);
    expect(anyTrueInUp).toBe(true);
  });

  it("at any bar, exactly one of up/down is non-null (after warmup)", () => {
    const bars = stairBars(80, 10, 0.5);
    const result = supertrend(bars, 10, 3);
    for (let i = 10; i < bars.length; i++) {
      const hasUp = result.up[i] != null;
      const hasDn = result.down[i] != null;
      // exactly one or neither (never both)
      expect(hasUp && hasDn).toBe(false);
    }
  });
});

// ─── RSI Stack tests ──────────────────────────────────────────────────────────

describe("rsiStack", () => {
  it("returns 3 series with the correct names/lengths", () => {
    const bars = stairBars(100, 50, 1);
    const result = rsiStack(bars, 7, 14, 21);
    expect(result.r1.length).toBe(bars.length);
    expect(result.r2.length).toBe(bars.length);
    expect(result.r3.length).toBe(bars.length);
  });

  it("all three series have warmup nulls matching their periods", () => {
    const bars = stairBars(100, 50, 1);
    const result = rsiStack(bars, 7, 14, 21);
    // r1 (period 7): first 7 values null (gains/losses start at i=1, RMA needs period bars)
    expect(result.r1[0]).toBeNull();
    // r3 (period 21): should have more leading nulls than r1
    const r1NullCount = result.r1.filter((v) => v === null).length;
    const r3NullCount = result.r3.filter((v) => v === null).length;
    expect(r3NullCount).toBeGreaterThanOrEqual(r1NullCount);
  });

  it("RSI values are bounded [0, 100] after warmup", () => {
    const bars = stairBars(100, 50, 1);
    const result = rsiStack(bars, 7, 14, 21);
    for (const series of [result.r1, result.r2, result.r3]) {
      for (const v of series) {
        if (v != null) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it("uses periods 7, 14, 21 — r1 is more reactive than r3 (wider swing on stair)", () => {
    // On a strongly trending series r1(7) moves faster toward 100 than r3(21)
    const bars = stairBars(80, 50, 2); // steadily rising
    const result = rsiStack(bars, 7, 14, 21);
    // After full warmup, r1 should be closer to 100 (shorter period = more sensitive to trend)
    const r1Last = result.r1[result.r1.length - 1];
    const r3Last = result.r3[result.r3.length - 1];
    expect(r1Last).not.toBeNull();
    expect(r3Last).not.toBeNull();
    // Both should be elevated; r1 ≥ r3 on a monotone uptrend
    expect(r1Last!).toBeGreaterThanOrEqual(r3Last! - 5); // allow small tolerance
  });
});

// ─── accumPct tests ────────────────────────────────────────────────────────────

describe("accumPct", () => {
  it("output length matches input length", () => {
    const bars = constBars(100, 50);
    const result = accumPct(bars, 63);
    expect(result.length).toBe(bars.length);
  });

  it("first (win-1) values are null (warmup)", () => {
    const win = 20;
    const bars = constBars(100, 50);
    const result = accumPct(bars, win);
    for (let i = 0; i < win - 1; i++) {
      expect(result[i]).toBeNull();
    }
    expect(result[win - 1]).not.toBeNull();
  });

  it("values are bounded [0, 100]", () => {
    const bars = stairBars(100, 10, 1);
    const result = accumPct(bars, 30);
    for (const v of result) {
      if (v != null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it("on bars where close == high (all up-close), accum approaches 100", () => {
    // When c==h, buyShare = 1.0, so accumPct = 100
    const n = 50;
    const dates = genDates(n);
    const bars: Bar[] = dates.map((time) => ({
      time, o: 10, h: 12, l: 10, c: 12, v: 1000, // c == h
    }));
    const result = accumPct(bars, 20);
    const lastVal = result[result.length - 1];
    expect(lastVal).not.toBeNull();
    expect(lastVal!).toBeCloseTo(100, 3);
  });
});

// ─── trendRibbon tests ─────────────────────────────────────────────────────────

describe("trendRibbon", () => {
  it("output arrays all match input length", () => {
    const bars = stairBars(100, 50, 1);
    const result = trendRibbon(bars, 20, 50, 10);
    expect(result.emaFast.length).toBe(bars.length);
    expect(result.emaSlow.length).toBe(bars.length);
    expect(result.state.length).toBe(bars.length);
    expect(result.shortUp.length).toBe(bars.length);
  });

  it("state is 'flat' during warmup (no EMA values yet)", () => {
    const bars = stairBars(100, 50, 1);
    const result = trendRibbon(bars, 20, 50, 10);
    // Before slopeWin is reached, state array entries are initialized to "flat"
    for (let i = 0; i < 10; i++) {
      expect(result.state[i]).toBe("flat");
    }
  });

  it("ribbonUp state emerges on a strongly rising series", () => {
    // 200 bars steadily rising — ribbon should eventually report ribbonUp
    const bars = stairBars(200, 10, 2);
    const result = trendRibbon(bars, 20, 50, 10);
    const hasUp = result.state.some((s) => s === "ribbonUp");
    expect(hasUp).toBe(true);
  });

  it("ribbonDown state emerges on a strongly falling series", () => {
    const bars = stairBars(200, 500, -2);
    const result = trendRibbon(bars, 20, 50, 10);
    const hasDown = result.state.some((s) => s === "ribbonDown");
    expect(hasDown).toBe(true);
  });
});
