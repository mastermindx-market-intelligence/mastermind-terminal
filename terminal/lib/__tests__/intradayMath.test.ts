// intradayMath.test.ts — spec §1 unit tests for session math foundation.
// All inputs are deterministic (no Date.now, no Math.random).
// Run with: npm test  (vitest run)

import { describe, it, expect } from "vitest";
import {
  minOfDay, dayKey, sessionOpenMin, sessionSlices,
  sessionVwap, openingRange, rvolSeries, ttmSqueeze,
  adx, cvdApprox, pivotLevels, sessionLevels,
  type Bar, type DailyBar,
} from "../intradayMath";
import { sessionEpoch } from "../intradayShared";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/**
 * Build a 5-minute ET display-epoch grid starting at a given base date.
 * Base date is assumed to be a Monday (or any weekday) at 00:00 UTC display-epoch.
 * The grid includes:
 *   - premarket bars from 04:00 ET (240 min) to 09:25 ET (5-bar run ending at 09:25)
 *   - RTH bars from 09:30 ET (570 min) to 15:55 ET (20 min before 16:00 close)
 *
 * Display-epoch: ET wall-clock reinterpreted as UTC seconds.
 * 04:00 ET = 240 min = 14400 sec into day
 * 09:30 ET = 570 min = 34200 sec into day
 * 15:55 ET = 955 min = 57300 sec into day  (last RTH bar opens at 15:55, closes at 16:00)
 *
 * @param baseDayEpoch  Midnight display-epoch of the target day in seconds.
 * @param includePm     Whether to include premarket bars.
 */
function buildEtDay(baseDayEpoch: number, includePm = true, closePrice?: number): Bar[] {
  const bars: Bar[] = [];
  const step = 5 * 60; // 5 min

  const pmStart = 4 * 60 * 60;   // 04:00 = 14400s
  const rthStart = 9.5 * 3600;   // 09:30 = 34200s
  const rthEnd = (15 * 60 + 55) * 60; // 15:55 = 57300s

  let price = closePrice ?? 100;
  const vol = 10000;

  if (includePm) {
    // PM bars: 04:00, 04:05, ..., 09:25 (gap-free 5m grid)
    for (let t = pmStart; t < rthStart; t += step) {
      const p = price + (Math.sin(t / 3600) * 0.5); // small wiggle
      bars.push({ time: baseDayEpoch + t, o: p, h: p + 0.1, l: p - 0.1, c: p, v: vol / 5 });
    }
  }

  // RTH bars: 09:30, 09:35, ..., 15:55
  for (let t = rthStart; t <= rthEnd; t += step) {
    const p = price + (Math.sin(t / 7200) * 1.0);
    bars.push({ time: baseDayEpoch + t, o: p, h: p + 0.5, l: p - 0.5, c: p + 0.1, v: vol });
  }

  return bars;
}

/**
 * Build 3+ complete trading sessions (Mon–Wed) with 5m ET grid.
 * Returns bars from 3 consecutive display-days.
 */
function buildEtSessions(n = 3, includePm = true): Bar[] {
  const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000); // 2024-01-02 = Tuesday
  const dayStep = 86400;
  const all: Bar[] = [];
  for (let d = 0; d < n; d++) {
    all.push(...buildEtDay(day0 + d * dayStep, includePm));
  }
  return all;
}

/**
 * CN-style lunch-gap grid: 09:30–11:30 then 13:00–15:00 (UTC+8 display-epoch).
 * For simplicity we use the same display-epoch convention (values are just offsets).
 * 09:30 = 570 min, 11:30 = 690 min, 13:00 = 780 min, 15:00 = 900 min
 */
function buildCnDay(baseDayEpoch: number): Bar[] {
  const bars: Bar[] = [];
  const step = 5 * 60;
  const morningStart = 570 * 60;
  const morningEnd = 690 * 60;  // 11:30
  const afterStart = 780 * 60;  // 13:00
  const afterEnd = 900 * 60;    // 15:00
  const vol = 10000;
  const price = 50;

  for (let t = morningStart; t < morningEnd; t += step) {
    const p = price + Math.sin(t / 3600) * 0.3;
    bars.push({ time: baseDayEpoch + t, o: p, h: p + 0.2, l: p - 0.2, c: p, v: vol });
  }
  // lunch gap: no bars from 11:30 to 13:00
  for (let t = afterStart; t <= afterEnd; t += step) {
    const p = price + Math.sin(t / 3600) * 0.3;
    bars.push({ time: baseDayEpoch + t, o: p, h: p + 0.2, l: p - 0.2, c: p, v: vol });
  }
  return bars;
}

function buildCnSessions(n = 3): Bar[] {
  const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
  const all: Bar[] = [];
  for (let d = 0; d < n; d++) {
    all.push(...buildCnDay(day0 + d * 86400));
  }
  return all;
}

/**
 * Crypto UTC grid: 00:00–23:55 each day (every 5 min, no premarket concept).
 */
function buildCryptoDay(baseDayEpoch: number, price = 40000): Bar[] {
  const bars: Bar[] = [];
  const step = 5 * 60;
  const vol = 1000;
  for (let t = 0; t < 86400; t += step) {
    const p = price + Math.sin(t / 7200) * 100;
    bars.push({ time: baseDayEpoch + t, o: p, h: p + 50, l: p - 50, c: p + 10, v: vol });
  }
  return bars;
}

function buildCryptoSessions(n = 3): Bar[] {
  const day0 = Math.floor(Date.UTC(2024, 0, 1) / 1000);
  const all: Bar[] = [];
  for (let d = 0; d < n; d++) {
    all.push(...buildCryptoDay(day0 + d * 86400));
  }
  return all;
}

// ─── Helper assertions ────────────────────────────────────────────────────────

function assertNoNaN(arr: (number | null)[], label: string) {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] !== null) {
      expect(isNaN(arr[i]!), `${label}[${i}] is NaN`).toBe(false);
      expect(isFinite(arr[i]!), `${label}[${i}] is not finite`).toBe(true);
    }
  }
}

// ─── §1 Session helpers ───────────────────────────────────────────────────────

describe("minOfDay / dayKey", () => {
  it("returns 0 for midnight", () => {
    expect(minOfDay(0)).toBe(0);
    expect(minOfDay(86400)).toBe(0); // next day midnight
  });

  it("returns 570 for 09:30", () => {
    expect(minOfDay(570 * 60)).toBe(570);
  });

  it("returns correct dayKey", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    expect(dayKey(day0)).toBe(Math.floor(Date.UTC(2024, 0, 2) / 86400000));
    expect(dayKey(day0 + 86399)).toBe(dayKey(day0)); // same day
    expect(dayKey(day0 + 86400)).toBe(dayKey(day0) + 1); // next day
  });
});

describe("sessionOpenMin", () => {
  it("returns 0 for crypto", () => {
    expect(sessionOpenMin("crypto")).toBe(0);
  });
  it("returns 570 for us/cn/hk/ca", () => {
    expect(sessionOpenMin("us")).toBe(570);
    expect(sessionOpenMin("cn")).toBe(570);
    expect(sessionOpenMin("hk")).toBe(570);
    expect(sessionOpenMin("ca")).toBe(570);
  });
});

describe("sessionSlices", () => {
  it("empty bars → empty slices", () => {
    expect(sessionSlices([])).toEqual([]);
  });

  it("groups bars by dayKey", () => {
    const bars = buildEtSessions(3);
    const slices = sessionSlices(bars);
    expect(slices.length).toBe(3);
    // Each slice's start/end cover the full bar range for that day
    for (const s of slices) {
      expect(s.start).toBeLessThanOrEqual(s.end);
      expect(dayKey(bars[s.start].time)).toBe(s.day);
      expect(dayKey(bars[s.end].time)).toBe(s.day);
    }
  });

  it("handles single bar", () => {
    const bar: Bar = { time: 0, o: 1, h: 1, l: 1, c: 1, v: 1 };
    const slices = sessionSlices([bar]);
    expect(slices.length).toBe(1);
    expect(slices[0].start).toBe(0);
    expect(slices[0].end).toBe(0);
  });
});

// ─── sessionVwap ─────────────────────────────────────────────────────────────

describe("sessionVwap", () => {
  it("VWAP resets exactly at open bar of each session", () => {
    const bars = buildEtSessions(3);
    const { vwap } = sessionVwap(bars, "us", false);
    const slices = sessionSlices(bars);

    for (const s of slices) {
      // Find first RTH bar in this session
      let firstRthIdx = -1;
      for (let i = s.start; i <= s.end; i++) {
        if (minOfDay(bars[i].time) >= 570) { firstRthIdx = i; break; }
      }
      if (firstRthIdx === -1) continue;
      // VWAP at first RTH bar should equal that bar's typical price (no history yet)
      const bar = bars[firstRthIdx];
      const tp = (bar.h + bar.l + bar.c) / 3;
      expect(vwap[firstRthIdx]).toBeCloseTo(tp, 6);
    }
  });

  it("premarket bars are null when includePm=false", () => {
    const bars = buildEtSessions(2, true);
    const { vwap } = sessionVwap(bars, "us", false);
    for (let i = 0; i < bars.length; i++) {
      if (minOfDay(bars[i].time) < 570) {
        expect(vwap[i]).toBeNull();
      }
    }
  });

  it("premarket bars contribute when includePm=true", () => {
    const bars = buildEtSessions(2, true);
    const { vwap } = sessionVwap(bars, "us", true);
    // First premarket bar of session 0 should have a non-null VWAP
    const firstPm = bars.findIndex((b) => minOfDay(b.time) < 570);
    if (firstPm >= 0) expect(vwap[firstPm]).not.toBeNull();
  });

  it("bands are symmetric and σ² ≥ 0", () => {
    const bars = buildEtSessions(2);
    const { vwap, bands } = sessionVwap(bars, "us", false, [1, 2]);
    for (let i = 0; i < bars.length; i++) {
      const v = vwap[i];
      if (v == null) continue;
      for (const band of bands) {
        const u = band.up[i], d = band.dn[i];
        if (u == null || d == null) continue;
        // Symmetric around VWAP
        expect(u - v).toBeCloseTo(v - d, 8);
        // σ ≥ 0 → band width ≥ 0
        expect(u - d).toBeGreaterThanOrEqual(-1e-10);
      }
    }
  });

  it("zero-volume bars contribute 0", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    const bars: Bar[] = [
      { time: day0 + 570 * 60, o: 100, h: 101, l: 99, c: 100, v: 0 },   // zero vol
      { time: day0 + 575 * 60, o: 100, h: 101, l: 99, c: 100, v: 1000 }, // normal
    ];
    const { vwap } = sessionVwap(bars, "us", false);
    expect(vwap[0]).toBeNull(); // no cumV > 0
    expect(vwap[1]).not.toBeNull();
  });

  it("no NaN in output on synthetic data", () => {
    const bars = buildEtSessions(3);
    const { vwap, bands } = sessionVwap(bars, "us", false);
    assertNoNaN(vwap, "vwap");
    for (const b of bands) {
      assertNoNaN(b.up, "band.up");
      assertNoNaN(b.dn, "band.dn");
    }
  });

  it("crypto: all bars included (openMin=0)", () => {
    const bars = buildCryptoSessions(2);
    const { vwap } = sessionVwap(bars, "crypto");
    // First bar of each day should be non-null (no premarket skipping)
    const slices = sessionSlices(bars);
    for (const s of slices) {
      const bar = bars[s.start];
      const tp = (bar.h + bar.l + bar.c) / 3;
      expect(vwap[s.start]).toBeCloseTo(tp, 6);
    }
  });

  it("CN lunch gap: no NaN artifacts across gap", () => {
    const bars = buildCnSessions(2);
    const { vwap, bands } = sessionVwap(bars, "cn", false);
    assertNoNaN(vwap, "cn-vwap");
    for (const b of bands) {
      assertNoNaN(b.up, "cn-band.up");
      assertNoNaN(b.dn, "cn-band.dn");
    }
  });
});

// ─── openingRange ─────────────────────────────────────────────────────────────

describe("openingRange", () => {
  it("ORB ignores premarket bars", () => {
    const bars = buildEtSessions(3, true);
    const sessions = openingRange(bars, "us", 15, [1, 2]);
    for (const s of sessions) {
      // startIdx should point to a bar with minOfDay >= 570
      expect(minOfDay(bars[s.startIdx].time)).toBeGreaterThanOrEqual(570);
    }
  });

  it("returns one session per trading day", () => {
    const bars = buildEtSessions(3);
    const sessions = openingRange(bars, "us", 15);
    expect(sessions.length).toBe(3);
  });

  it("hi >= lo, mid = (hi+lo)/2", () => {
    const bars = buildEtSessions(3);
    const sessions = openingRange(bars, "us", 15);
    for (const s of sessions) {
      expect(s.hi).toBeGreaterThanOrEqual(s.lo);
      expect(s.mid).toBeCloseTo((s.hi + s.lo) / 2, 8);
    }
  });

  it("extensions match formula: up = hi + k*(hi-lo), dn = lo - k*(hi-lo)", () => {
    const bars = buildEtSessions(2);
    const sessions = openingRange(bars, "us", 15, [1, 2]);
    for (const s of sessions) {
      const height = s.hi - s.lo;
      for (const ext of s.exts) {
        expect(ext.up).toBeCloseTo(s.hi + ext.k * height, 8);
        expect(ext.dn).toBeCloseTo(s.lo - ext.k * height, 8);
      }
    }
  });

  it("window is locked: bars after openMin+rangeMin don't affect hi/lo", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    // Bars: ORB window (09:30–09:44), then a bar at 09:45 with extreme prices
    const bars: Bar[] = [
      { time: day0 + 570 * 60, o: 100, h: 102, l: 99, c: 100, v: 1000 }, // ORB
      { time: day0 + 575 * 60, o: 100, h: 101, l: 99.5, c: 100, v: 1000 }, // ORB
      { time: day0 + 585 * 60, o: 100, h: 200, l: 1, c: 100, v: 1000 },   // after window
    ];
    const sessions = openingRange(bars, "us", 15);
    expect(sessions.length).toBe(1);
    expect(sessions[0].hi).toBeLessThan(200); // extreme bar excluded
    expect(sessions[0].lo).toBeGreaterThan(1);
  });

  it("skips sessions with no window bars", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    // Day 1: only premarket bars (should be skipped since ORB ignores premarket)
    // Day 2: normal
    const bars: Bar[] = [
      { time: day0 + 4 * 3600, o: 100, h: 101, l: 99, c: 100, v: 1000 }, // premarket day1
      { time: day0 + 86400 + 570 * 60, o: 100, h: 101, l: 99, c: 100, v: 1000 }, // RTH day2
    ];
    const sessions = openingRange(bars, "us", 15);
    expect(sessions.length).toBe(1); // day1 has no RTH window bars
    expect(sessions[0].day).toBe(dayKey(bars[1].time));
  });

  it("CN lunch gap: handles sessions with missing afternoon bars", () => {
    const bars = buildCnSessions(3);
    const sessions = openingRange(bars, "cn", 15);
    expect(sessions.length).toBe(3);
    for (const s of sessions) {
      expect(s.hi).toBeGreaterThan(0);
    }
  });

  it("partial first session: window may start mid-day", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    // Only bars from 09:35 (after open) for the first session
    const bars: Bar[] = [
      { time: day0 + 575 * 60, o: 100, h: 101, l: 99, c: 100, v: 1000 }, // 09:35, inside 15m window
      { time: day0 + 580 * 60, o: 100, h: 101, l: 99, c: 100, v: 1000 }, // 09:40
    ];
    const sessions = openingRange(bars, "us", 15);
    expect(sessions.length).toBe(1);
    expect(sessions[0].hi).toBeGreaterThan(0);
  });
});

// ─── rvolSeries ───────────────────────────────────────────────────────────────

describe("rvolSeries", () => {
  it("returns all null when sessionsUsed < 3", () => {
    const bars = buildEtSessions(2); // only 2 sessions → 1 prior → < 3
    const result = rvolSeries(bars, "us", 10);
    expect(result.sessionsUsed).toBeLessThan(3);
    for (const v of result.cum) expect(v).toBeNull();
    for (const v of result.slot) expect(v).toBeNull();
  });

  it("returns non-null values when sessionsUsed >= 3", () => {
    const bars = buildEtSessions(5); // 5 sessions → 4 prior
    const result = rvolSeries(bars, "us", 3);
    expect(result.sessionsUsed).toBeGreaterThanOrEqual(3);
    // At least some values should be non-null in the current session
    const nonNull = result.cum.filter((v) => v !== null);
    expect(nonNull.length).toBeGreaterThan(0);
  });

  it("RVOL === 1.0 exactly when today's tape equals baseline mean", () => {
    // Build sessions where every bar has the same volume — so today's volume
    // equals the baseline average exactly
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    const step = 5 * 60;
    const vol = 1000;
    const price = 100;

    // Build 4 identical sessions: 3 baseline + 1 current
    const bars: Bar[] = [];
    for (let d = 0; d < 4; d++) {
      const base = day0 + d * 86400;
      for (let t = 570 * 60; t <= (570 + 30) * 60; t += step) {
        bars.push({ time: base + t, o: price, h: price + 1, l: price - 1, c: price, v: vol });
      }
    }

    const result = rvolSeries(bars, "us", 3);
    expect(result.sessionsUsed).toBe(3);

    // For the current (4th) session, RVOL cum at each slot should be ~1.0
    const lastDay = dayKey(bars[bars.length - 1].time);
    for (let i = 0; i < bars.length; i++) {
      if (dayKey(bars[i].time) !== lastDay) continue;
      if (result.cum[i] !== null) {
        expect(result.cum[i]!).toBeCloseTo(1.0, 4);
      }
    }
  });

  it("no NaN in output", () => {
    const bars = buildEtSessions(5);
    const result = rvolSeries(bars, "us", 3);
    assertNoNaN(result.cum, "rvol.cum");
    assertNoNaN(result.slot, "rvol.slot");
  });

  it("sessionsUsed is honest: reports actual prior sessions available", () => {
    const bars = buildEtSessions(3); // 3 sessions → 2 prior
    const r = rvolSeries(bars, "us", 10);
    expect(r.sessionsUsed).toBe(2);
  });

  it("crypto: no premarket exclusion, all bars counted", () => {
    const bars = buildCryptoSessions(5);
    const result = rvolSeries(bars, "crypto", 3);
    expect(result.sessionsUsed).toBeGreaterThanOrEqual(3);
  });
});

// ─── ttmSqueeze ───────────────────────────────────────────────────────────────

describe("ttmSqueeze", () => {
  it("momentum output has correct length", () => {
    const bars = buildEtSessions(2);
    const { mom, squeeze } = ttmSqueeze(bars, 20);
    expect(mom.length).toBe(bars.length);
    expect(squeeze.length).toBe(bars.length);
  });

  it("squeeze tier is 0–3 (never >3)", () => {
    const bars = buildEtSessions(3);
    const { squeeze } = ttmSqueeze(bars, 20);
    for (const s of squeeze) {
      if (s !== null) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(3);
      }
    }
  });

  it("no NaN in output", () => {
    const bars = buildEtSessions(3);
    const { mom, squeeze } = ttmSqueeze(bars, 20);
    assertNoNaN(mom, "ttmsq.mom");
    // squeeze is 0|1|2|3|null: not NaN by type, but validate
    for (const s of squeeze) {
      if (s !== null) expect(isNaN(s as unknown as number)).toBe(false);
    }
  });

  it("warmup period: first len-1 bars have null squeeze", () => {
    const bars = buildEtSessions(3);
    const len = 20;
    const { squeeze } = ttmSqueeze(bars, len);
    for (let i = 0; i < len - 1; i++) {
      expect(squeeze[i]).toBeNull();
    }
  });

  it("tight consolidation gives squeeze tier >0 (narrow BB, wide KC from prior ATR)", () => {
    // Build bars with significant prior ATR, then flat consolidation.
    // Prior volatile bars produce non-zero ATR (via Wilder RMA, which decays slowly).
    // Flat consolidation produces near-zero BB width.
    // Since ATR decays slowly via RMA, KC width remains larger than BB width → squeeze detected.
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    const bars: Bar[] = [];
    // Phase 1: volatile bars to seed ATR (10 bars with wide range)
    for (let d = 0; d < 10; d++) {
      for (let t = 570 * 60; t <= (570 + 60) * 60; t += 5 * 60) {
        const p = 100;
        bars.push({ time: day0 + d * 86400 + t, o: p, h: p + 5, l: p - 5, c: p, v: 1000 });
      }
    }
    // Phase 2: very tight consolidation (bars with near-zero range after the volatile ones)
    for (let d = 10; d < 20; d++) {
      for (let t = 570 * 60; t <= (570 + 60) * 60; t += 5 * 60) {
        const p = 100;
        // h-l = 0.01 → very narrow BB, but ATR (Wilder RMA) still carries prior large values
        bars.push({ time: day0 + d * 86400 + t, o: p, h: p + 0.01, l: p - 0.01, c: p, v: 1000 });
      }
    }
    const { squeeze } = ttmSqueeze(bars, 10, 2, [1, 1.5, 2]);
    const nonNull = squeeze.filter((s) => s !== null);
    expect(nonNull.length).toBeGreaterThan(0);
    // tight consolidation after volatile phase → tier should be > 0 in late bars
    const lateSqueeze = squeeze.slice(-20).filter((s) => s !== null);
    const maxTier = lateSqueeze.length ? Math.max(...lateSqueeze.map((s) => s as number)) : 0;
    expect(maxTier).toBeGreaterThan(0);
  });

  it("tier mapping: steady ±d alternation with zero-range bars is exactly tier 2", () => {
    // h=l=c bars → TR = |c − prevC| = 2d each bar → ATR(RMA) → 2d steady.
    // closes alternate 100±d → population stdev over an even window = d exactly → BBwidth = 2·2·d = 4d.
    // KC widths: 1.0× → 4d (NOT strictly inside), 1.5× → 6d (inside), 2.0× → 8d (inside).
    // Tightest containing channel = 1.5× → tier 2. (The inverted mapping would report 3.)
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    const d = 1;
    const bars: Bar[] = [];
    for (let i = 0; i < 120; i++) {
      const p = 100 + (i % 2 === 0 ? d : -d);
      bars.push({ time: day0 + 570 * 60 + i * 300, o: p, h: p, l: p, c: p, v: 1000 });
    }
    const { squeeze } = ttmSqueeze(bars, 20, 2, [1, 1.5, 2]);
    // steady state: last 40 bars all tier 2
    for (const s of squeeze.slice(-40)) expect(s).toBe(2);
  });

  it("tier mapping: flat consolidation after volatility reaches tier 3 (inside tightest KC)", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    const bars: Bar[] = [];
    for (let i = 0; i < 40; i++) {
      const p = 100 + (i % 2 === 0 ? 3 : -3);
      bars.push({ time: day0 + 570 * 60 + i * 300, o: p, h: p + 3, l: p - 3, c: p, v: 1000 });
    }
    for (let i = 40; i < 80; i++) {
      bars.push({ time: day0 + 570 * 60 + i * 300, o: 100, h: 100.01, l: 99.99, c: 100, v: 1000 });
    }
    const { squeeze } = ttmSqueeze(bars, 20, 2, [1, 1.5, 2]);
    // once the BB window is fully inside the flat phase and ATR still carries prior volatility,
    // BB width ≈ 0 → inside the tightest 1.0×KC → tier 3
    for (const s of squeeze.slice(-10)) expect(s).toBe(3);
  });

  it("works on daily bars (all timeframes)", () => {
    // Build some daily-style bars (numeric times, but daily cadence)
    const bars: Bar[] = [];
    for (let d = 0; d < 50; d++) {
      const p = 100 + Math.sin(d / 5) * 5;
      bars.push({ time: d * 86400, o: p, h: p + 1, l: p - 1, c: p, v: 1000 });
    }
    const { mom, squeeze } = ttmSqueeze(bars, 20);
    expect(mom.length).toBe(50);
    expect(squeeze.length).toBe(50);
    assertNoNaN(mom, "daily-ttmsq.mom");
  });
});

// ─── adx ──────────────────────────────────────────────────────────────────────

describe("adx", () => {
  it("waits for len finite Wilder samples before seeding DI and ADX", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    const bars: Bar[] = Array.from({ length: 8 }, (_, i) => {
      const p = 100 + i;
      return { time: day0 + 570 * 60 + i * 300, o: p, h: p + 2, l: p - 1, c: p + 1, v: 1000 };
    });
    const result = adx(bars, 3);

    // DM starts at bar 1 because bar 0 has no predecessor. Wilder's 3-period seed therefore
    // needs bars 1,2,3 — emitting DI on bar 2 would silently average only two finite samples.
    expect(result.diPlus.slice(0, 3)).toEqual([null, null, null]);
    expect(result.diMinus.slice(0, 3)).toEqual([null, null, null]);
    expect(result.diPlus[3]).not.toBeNull();
    expect(result.diMinus[3]).not.toBeNull();

    // DX first becomes finite with DI on bar 3. ADX needs three finite DX observations
    // (bars 3,4,5), so its first valid value is bar 5.
    expect(result.adx.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(result.adx[5]).not.toBeNull();
  });

  it("ADX is always in [0, 100]", () => {
    const bars = buildEtSessions(3);
    const { adx: adxArr } = adx(bars, 10);
    for (const v of adxArr) {
      if (v !== null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it("DI+ and DI- are in [0, 100]", () => {
    const bars = buildEtSessions(3);
    const { diPlus, diMinus } = adx(bars, 10);
    for (const v of diPlus) {
      if (v !== null) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
    }
    for (const v of diMinus) {
      if (v !== null) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
    }
  });

  it("no NaN in output", () => {
    const bars = buildEtSessions(3);
    const { adx: a, diPlus, diMinus } = adx(bars, 10);
    assertNoNaN(a, "adx");
    assertNoNaN(diPlus, "diPlus");
    assertNoNaN(diMinus, "diMinus");
  });

  it("output arrays have correct length", () => {
    const bars = buildEtSessions(2);
    const result = adx(bars, 10);
    expect(result.adx.length).toBe(bars.length);
    expect(result.diPlus.length).toBe(bars.length);
    expect(result.diMinus.length).toBe(bars.length);
  });

  it("trending up: DI+ > DI- (staircase)", () => {
    const bars: Bar[] = [];
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    for (let d = 0; d < 10; d++) {
      for (let t = 570 * 60; t <= (570 + 30) * 60; t += 5 * 60) {
        const p = 100 + d * 5; // strictly ascending day-by-day
        bars.push({ time: day0 + d * 86400 + t, o: p, h: p + 2, l: p, c: p + 1, v: 1000 });
      }
    }
    const { diPlus, diMinus } = adx(bars, 5);
    // After warmup, DI+ should dominate
    const late = bars.length - 5;
    const plusLate = diPlus[late], minusLate = diMinus[late];
    if (plusLate !== null && minusLate !== null) {
      expect(plusLate).toBeGreaterThan(minusLate);
    }
  });

  it("handles h===l bars without NaN", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    const bars: Bar[] = [
      { time: day0 + 570 * 60, o: 100, h: 100, l: 100, c: 100, v: 1000 }, // doji
      { time: day0 + 575 * 60, o: 100, h: 100, l: 100, c: 100, v: 1000 },
      { time: day0 + 580 * 60, o: 100, h: 101, l: 99, c: 100, v: 1000 },
    ];
    const { adx: a } = adx(bars, 2);
    assertNoNaN(a, "doji-adx");
  });
});

// ─── cvdApprox ────────────────────────────────────────────────────────────────

describe("cvdApprox", () => {
  it("CVD resets per session (new dayKey → cumDelta = 0)", () => {
    const bars = buildEtSessions(3);
    const out = cvdApprox(bars);
    const slices = sessionSlices(bars);

    for (const s of slices) {
      // Find first RTH bar in this session
      let firstRth = -1;
      for (let i = s.start; i <= s.end; i++) {
        if (minOfDay(bars[i].time) >= 570) { firstRth = i; break; }
      }
      // The session's delta resets: cumulative starts fresh
      // We can't assert exact value without knowing delta[firstRth], but we can
      // assert that the value at firstRth equals a single-bar computation
      if (firstRth < 0) continue;
      const bar = bars[firstRth];
      const range = bar.h - bar.l;
      let expected: number;
      if (range === 0) {
        // sign(c - prevClose)*v — prevClose is cross-session so it uses the prior bar
        expected = 0; // we can't easily compute without knowing prev session's last close
      } else {
        expected = bar.v * ((bar.c - bar.l) - (bar.h - bar.c)) / range;
      }
      if (range > 0) {
        expect(out[firstRth]).toBeCloseTo(expected, 6);
      }
    }
  });

  it("h===l fallback: uses sign(c-prevClose)·v", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    const bars: Bar[] = [
      // First bar: prevClose = bar.c (no prior) → delta = 0
      { time: day0 + 570 * 60, o: 100, h: 100, l: 100, c: 100, v: 1000 },
      // Second bar h===l, c > prevClose (100) → positive delta
      { time: day0 + 575 * 60, o: 101, h: 101, l: 101, c: 101, v: 2000 },
      // Third bar h===l, c < prevClose (101) → negative delta
      { time: day0 + 580 * 60, o: 99, h: 99, l: 99, c: 99, v: 3000 },
    ];
    const out = cvdApprox(bars);
    // Bar 0: range=0, c-prevClose=0 → delta=0, cumDelta=0
    expect(out[0]).toBeCloseTo(0, 6);
    // Bar 1: range=0, c-prevClose=1>0 → delta=+2000, cumDelta=2000
    expect(out[1]).toBeCloseTo(2000, 6);
    // Bar 2: range=0, c-prevClose=-2<0 → delta=-3000, cumDelta=2000-3000=-1000
    expect(out[2]).toBeCloseTo(-1000, 6);
  });

  it("normal bar delta formula: v×((c-l)-(h-c))/(h-l)", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    const bars: Bar[] = [
      { time: day0 + 570 * 60, o: 100, h: 102, l: 98, c: 101, v: 1000 },
    ];
    const out = cvdApprox(bars);
    // delta = 1000 * ((101-98)-(102-101))/(102-98) = 1000 * (3-1)/4 = 500
    expect(out[0]).toBeCloseTo(500, 6);
  });

  it("zero volume bar contributes 0", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    const bars: Bar[] = [
      { time: day0 + 570 * 60, o: 100, h: 102, l: 98, c: 101, v: 0 },
      { time: day0 + 575 * 60, o: 100, h: 102, l: 98, c: 101, v: 1000 },
    ];
    const out = cvdApprox(bars);
    // First bar: v=0 → delta=0, cum=0
    expect(out[0]).toBeCloseTo(0, 6);
    // Second bar: delta = 1000*((101-98)-(102-101))/(102-98) = 500
    expect(out[1]).toBeCloseTo(500, 6);
  });

  it("session reset: cumDelta starts fresh on new day", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    const bars: Bar[] = [
      // Day 1
      { time: day0 + 570 * 60, o: 100, h: 102, l: 98, c: 101, v: 1000 },
      // Day 2: starts fresh
      { time: day0 + 86400 + 570 * 60, o: 100, h: 102, l: 98, c: 101, v: 1000 },
    ];
    const out = cvdApprox(bars);
    // Both bars have identical OHLCV → same delta, both should equal 500
    expect(out[0]).toBeCloseTo(500, 6);
    expect(out[1]).toBeCloseTo(500, 6); // reset: same as day1 first bar
  });

  it("no NaN in output", () => {
    const bars = buildEtSessions(3);
    const out = cvdApprox(bars);
    assertNoNaN(out, "cvd");
  });
});

// ─── pivotLevels ─────────────────────────────────────────────────────────────

describe("pivotLevels", () => {
  const pd = { h: 105, l: 95, c: 100 };
  const hl = pd.h - pd.l; // 10

  it("classic: hand-computed PP, R1-R3, S1-S3", () => {
    const levels = pivotLevels(pd, "classic");
    const byKey = Object.fromEntries(levels.map((l) => [l.key, l.value]));
    const pp = (105 + 95 + 100) / 3; // 100
    expect(byKey["PP"]).toBeCloseTo(pp, 8);
    expect(byKey["R1"]).toBeCloseTo(2 * pp - 95, 8);  // 105
    expect(byKey["R2"]).toBeCloseTo(pp + 10, 8);        // 110
    expect(byKey["R3"]).toBeCloseTo(2 * pp - 95 + 10, 8); // 115
    expect(byKey["S1"]).toBeCloseTo(2 * pp - 105, 8);  // 95
    expect(byKey["S2"]).toBeCloseTo(pp - 10, 8);        // 90
    expect(byKey["S3"]).toBeCloseTo(2 * pp - 105 - 10, 8); // 85
  });

  it("camarilla: hand-computed R1-R4, S1-S4", () => {
    const levels = pivotLevels(pd, "camarilla");
    const byKey = Object.fromEntries(levels.map((l) => [l.key, l.value]));
    const f = hl * 1.1; // 11
    expect(byKey["R1"]).toBeCloseTo(100 + f / 12, 8);
    expect(byKey["R2"]).toBeCloseTo(100 + f / 6, 8);
    expect(byKey["R3"]).toBeCloseTo(100 + f / 4, 8);
    expect(byKey["R4"]).toBeCloseTo(100 + f / 2, 8);
    expect(byKey["S1"]).toBeCloseTo(100 - f / 12, 8);
    expect(byKey["S2"]).toBeCloseTo(100 - f / 6, 8);
    expect(byKey["S3"]).toBeCloseTo(100 - f / 4, 8);
    expect(byKey["S4"]).toBeCloseTo(100 - f / 2, 8);
  });

  it("fib: hand-computed PP, R1-R3, S1-S3", () => {
    const levels = pivotLevels(pd, "fib");
    const byKey = Object.fromEntries(levels.map((l) => [l.key, l.value]));
    const pp = (105 + 95 + 100) / 3;
    expect(byKey["PP"]).toBeCloseTo(pp, 8);
    expect(byKey["R1"]).toBeCloseTo(pp + 0.382 * hl, 8);
    expect(byKey["R2"]).toBeCloseTo(pp + 0.618 * hl, 8);
    expect(byKey["R3"]).toBeCloseTo(pp + 1.0 * hl, 8);
    expect(byKey["S1"]).toBeCloseTo(pp - 0.382 * hl, 8);
    expect(byKey["S2"]).toBeCloseTo(pp - 0.618 * hl, 8);
    expect(byKey["S3"]).toBeCloseTo(pp - 1.0 * hl, 8);
  });

  it("returns PriceLevel objects with key/label/value", () => {
    for (const mode of ["classic", "camarilla", "fib"] as const) {
      const levels = pivotLevels(pd, mode);
      for (const lv of levels) {
        expect(typeof lv.key).toBe("string");
        expect(typeof lv.label).toBe("string");
        expect(typeof lv.value).toBe("number");
        expect(isNaN(lv.value)).toBe(false);
      }
    }
  });
});

// ─── sessionLevels ────────────────────────────────────────────────────────────

describe("sessionLevels", () => {
  // Build a 5-day daily bar array
  const daily: DailyBar[] = [
    { time: "2024-01-01", h: 102, l: 98, c: 100 },  // Mon (prior week)
    { time: "2024-01-02", h: 105, l: 95, c: 101 },  // Tue
    { time: "2024-01-03", h: 106, l: 96, c: 102 },  // Wed
    { time: "2024-01-04", h: 107, l: 97, c: 103 },  // Thu
    { time: "2024-01-05", h: 108, l: 94, c: 104 },  // Fri (prior day)
  ];

  // Current session: 2024-01-08 (Mon next week)
  const currentDayBase = Math.floor(Date.UTC(2024, 0, 8) / 1000); // 2024-01-08

  it("PDH/PDL/PDC from last completed daily bar before session date", () => {
    const bars: Bar[] = [
      { time: currentDayBase + 570 * 60, o: 104, h: 105, l: 103, c: 104, v: 1000 },
    ];
    const levels = sessionLevels(bars, "us", daily);
    const byKey = Object.fromEntries(levels.map((l) => [l.key, l.value]));
    // Last daily bar before 2024-01-08 is 2024-01-05
    expect(byKey["PDH"]).toBe(108);
    expect(byKey["PDL"]).toBe(94);
    expect(byKey["PDC"]).toBe(104);
  });

  it("Open = first bar at or after openMin", () => {
    const bars: Bar[] = [
      { time: currentDayBase + 4 * 3600, o: 103, h: 104, l: 102, c: 103, v: 500 }, // premarket
      { time: currentDayBase + 570 * 60, o: 104, h: 105, l: 103, c: 104, v: 1000 }, // RTH open
      { time: currentDayBase + 575 * 60, o: 105, h: 106, l: 104, c: 105, v: 1000 },
    ];
    const levels = sessionLevels(bars, "us", daily);
    const byKey = Object.fromEntries(levels.map((l) => [l.key, l.value]));
    expect(byKey["Open"]).toBe(104); // open price of first RTH bar
  });

  it("PMH/PML from US premarket bars", () => {
    const bars: Bar[] = [
      { time: currentDayBase + 4 * 3600, o: 103, h: 106, l: 101, c: 103, v: 500 }, // pm bar
      { time: currentDayBase + 570 * 60, o: 104, h: 105, l: 103, c: 104, v: 1000 },
    ];
    const levels = sessionLevels(bars, "us", daily);
    const byKey = Object.fromEntries(levels.map((l) => [l.key, l.value]));
    expect(byKey["PMH"]).toBe(106);
    expect(byKey["PML"]).toBe(101);
  });

  it("no PMH/PML for CN market (not US)", () => {
    const bars: Bar[] = [
      { time: currentDayBase + 4 * 3600, o: 103, h: 106, l: 101, c: 103, v: 500 },
      { time: currentDayBase + 570 * 60, o: 104, h: 105, l: 103, c: 104, v: 1000 },
    ];
    const levels = sessionLevels(bars, "cn", daily);
    const keys = levels.map((l) => l.key);
    expect(keys.includes("PMH")).toBe(false);
    expect(keys.includes("PML")).toBe(false);
  });

  it("no PMH/PML when no premarket bars exist", () => {
    const bars: Bar[] = [
      { time: currentDayBase + 570 * 60, o: 104, h: 105, l: 103, c: 104, v: 1000 },
    ];
    const levels = sessionLevels(bars, "us", daily);
    const keys = levels.map((l) => l.key);
    expect(keys.includes("PMH")).toBe(false);
    expect(keys.includes("PML")).toBe(false);
  });

  it("empty bars or daily → returns []", () => {
    expect(sessionLevels([], "us", daily)).toEqual([]);
    const bars: Bar[] = [{ time: currentDayBase + 570 * 60, o: 100, h: 101, l: 99, c: 100, v: 1000 }];
    expect(sessionLevels(bars, "us", [])).toEqual([]);
  });

  it("returns PriceLevel objects with valid numeric values", () => {
    const bars: Bar[] = [
      { time: currentDayBase + 570 * 60, o: 104, h: 105, l: 103, c: 104, v: 1000 },
    ];
    const levels = sessionLevels(bars, "us", daily);
    for (const lv of levels) {
      expect(typeof lv.key).toBe("string");
      expect(typeof lv.value).toBe("number");
      expect(isNaN(lv.value)).toBe(false);
    }
  });
});

// ─── Pathology cases ─────────────────────────────────────────────────────────

describe("Pathology: partial first session", () => {
  it("sessionVwap: partial first session (window starts mid-day)", () => {
    // Only bars from 10:00 onward on day 1 (no 09:30 open)
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    const bars: Bar[] = [
      { time: day0 + 10 * 3600, o: 100, h: 101, l: 99, c: 100, v: 1000 }, // 10:00
      { time: day0 + 86400 + 570 * 60, o: 100, h: 101, l: 99, c: 100, v: 1000 }, // day2 open
    ];
    const { vwap } = sessionVwap(bars, "us", false);
    // 10:00 is minOfDay=600 >= 570, so should be non-null
    expect(vwap[0]).not.toBeNull();
    // Day 2 also should be non-null
    expect(vwap[1]).not.toBeNull();
    // Day 2 VWAP should equal tp of the single bar (session reset)
    const b2 = bars[1];
    const tp2 = (b2.h + b2.l + b2.c) / 3;
    expect(vwap[1]).toBeCloseTo(tp2, 6);
  });

  it("openingRange: partial session with only post-window bars", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    const bars: Bar[] = [
      // Only bars at 10:00 (past the 09:30-09:45 window for 15m range)
      { time: day0 + 10 * 3600, o: 100, h: 101, l: 99, c: 100, v: 1000 },
    ];
    const sessions = openingRange(bars, "us", 15);
    // 10:00 = minOfDay 600 >= 570+15=585, so no window bars → session skipped
    expect(sessions.length).toBe(0);
  });
});

describe("Pathology: h===l bars throughout all functions", () => {
  it("sessionVwap: doji bars produce valid (non-null, non-NaN) output", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    const bars: Bar[] = Array.from({ length: 10 }, (_, i) => ({
      time: day0 + 570 * 60 + i * 300,
      o: 100, h: 100, l: 100, c: 100, v: 1000,
    }));
    const { vwap, bands } = sessionVwap(bars, "us", false);
    assertNoNaN(vwap, "doji-vwap");
    for (const b of bands) {
      assertNoNaN(b.up, "doji-band.up");
      assertNoNaN(b.dn, "doji-band.dn");
    }
  });

  it("cvdApprox: h===l uses sign fallback", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    const bars: Bar[] = [
      { time: day0 + 570 * 60, o: 100, h: 100, l: 100, c: 100, v: 1000 }, // neutral
      { time: day0 + 575 * 60, o: 101, h: 101, l: 101, c: 101, v: 1000 }, // up
    ];
    const out = cvdApprox(bars);
    expect(out[0]).toBeCloseTo(0, 6); // c = prevClose = 100 → delta = 0
    expect(out[1]).toBeCloseTo(1000, 6); // c(101) > prevClose(100) → +v
  });
});

describe("Pathology: zero volume bars", () => {
  it("sessionVwap: zero volume treated as contributing 0", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    const bars: Bar[] = [
      { time: day0 + 570 * 60, o: 100, h: 101, l: 99, c: 100, v: 0 },    // no vol
      { time: day0 + 575 * 60, o: 100, h: 101, l: 99, c: 100, v: 1000 }, // normal
    ];
    const { vwap } = sessionVwap(bars, "us", false);
    expect(vwap[0]).toBeNull(); // cumV=0 → null
    expect(vwap[1]).not.toBeNull();
  });
});

describe("Pathology: lunch gap (CN-style)", () => {
  it("no NaN artifacts across 11:30–13:00 gap in all functions", () => {
    const bars = buildCnSessions(4);

    const { vwap } = sessionVwap(bars, "cn", false);
    assertNoNaN(vwap, "cn-vwap");

    const orbSessions = openingRange(bars, "cn", 15);
    expect(orbSessions.length).toBeGreaterThan(0);

    const rvol = rvolSeries(bars, "cn", 3);
    assertNoNaN(rvol.cum, "cn-rvol.cum");

    const cvd = cvdApprox(bars);
    assertNoNaN(cvd, "cn-cvd");

    const { mom } = ttmSqueeze(bars, 10);
    assertNoNaN(mom, "cn-ttmsq.mom");

    const { adx: a } = adx(bars, 5);
    assertNoNaN(a, "cn-adx");
  });
});

describe("Pathology: crypto UTC day roll", () => {
  it("session resets at UTC midnight for crypto", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 1) / 1000);
    // Bar just before midnight and just after
    const bars: Bar[] = [
      { time: day0 + 86400 - 60, o: 40000, h: 40100, l: 39900, c: 40000, v: 100 }, // 23:59 day0
      { time: day0 + 86400,      o: 40050, h: 40150, l: 39950, c: 40050, v: 100 }, // 00:00 day1
    ];
    const { vwap } = sessionVwap(bars, "crypto");
    // Both bars should be non-null (crypto has no premarket exclusion)
    expect(vwap[0]).not.toBeNull();
    expect(vwap[1]).not.toBeNull();
    // Day1 bar is a session reset: VWAP should equal that bar's tp
    const b1 = bars[1];
    const tp1 = (b1.h + b1.l + b1.c) / 3;
    expect(vwap[1]).toBeCloseTo(tp1, 6);
  });

  it("cvdApprox resets at UTC midnight for crypto", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 1) / 1000);
    const bars: Bar[] = [
      { time: day0 + 86400 - 300, o: 100, h: 102, l: 98, c: 101, v: 1000 }, // day0 end
      { time: day0 + 86400,       o: 100, h: 102, l: 98, c: 101, v: 1000 }, // day1 start (reset)
    ];
    const out = cvdApprox(bars);
    // Both bars have same OHLCV → same delta formula result
    expect(out[0]).toBeCloseTo(out[1]!, 6);
  });
});

// ─── Integration: RVOL=1 when today equals baseline ──────────────────────────

describe("Integration: RVOL=1 when today equals baseline exactly", () => {
  it("cumulative RVOL equals 1.0 when today's volume profile matches baseline mean", () => {
    const day0 = Math.floor(Date.UTC(2024, 0, 2) / 1000);
    const step = 5 * 60;
    const vol = 1000;
    const bars: Bar[] = [];

    // 5 identical sessions → 4 prior, 1 current; each session same volume at each slot
    for (let d = 0; d < 5; d++) {
      for (let t = 570 * 60; t <= (570 + 60) * 60; t += step) {
        bars.push({
          time: day0 + d * 86400 + t,
          o: 100, h: 101, l: 99, c: 100,
          v: vol,
        });
      }
    }

    const result = rvolSeries(bars, "us", 4);
    expect(result.sessionsUsed).toBe(4);

    // Current session: last day
    const lastDay = dayKey(bars[bars.length - 1].time);
    let checked = 0;
    for (let i = 0; i < bars.length; i++) {
      if (dayKey(bars[i].time) !== lastDay) continue;
      if (result.cum[i] !== null) {
        expect(result.cum[i]!).toBeCloseTo(1.0, 3);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

// ─── display-epoch convention (B11) ─────────────────────────────────────────
describe("sessionEpoch — the display-epoch convention shared with etDisplay", () => {
  it("reads the ET wall clock AS UTC (09:31 ET → 09:31Z), not the true instant", () => {
    const e = sessionEpoch("2026-07-06", "09:31");
    expect(new Date(e * 1000).toISOString()).toBe("2026-07-06T09:31:00.000Z");
  });

  it("matches etDisplay's arithmetic exactly", () => {
    // etDisplay: Date.UTC(y, m-1, d, hh, mm) / 1000 from the ET wall-clock parts.
    expect(sessionEpoch("2026-07-06", "15:56")).toBe(Date.UTC(2026, 6, 6, 15, 56) / 1000);
  });

  it("does NOT apply a UTC offset — the EDT/EST gap must not shift the series", () => {
    const edt = sessionEpoch("2026-07-06", "09:31"); // summer
    const est = sessionEpoch("2026-01-06", "09:31"); // winter
    // Same wall-clock time → same time-of-day epoch component in both DST regimes.
    expect(edt % 86400).toBe(est % 86400);
    // And neither equals the true-UTC-instant reading, which is the bug this replaces.
    expect(edt).not.toBe(new Date("2026-07-06T09:31:00-04:00").getTime() / 1000);
  });

  it("is strictly increasing across a session", () => {
    const steps = ["09:31", "12:00", "15:56"];
    const es = steps.map((s) => sessionEpoch("2026-07-06", s));
    expect(es[1]).toBeGreaterThan(es[0]);
    expect(es[2]).toBeGreaterThan(es[1]);
  });

  it("returns NaN on malformed input rather than plotting at the epoch", () => {
    expect(sessionEpoch("", "09:31")).toBeNaN();
    expect(sessionEpoch("2026-07-06", "")).toBeNaN();
    expect(sessionEpoch("07/06/2026", "09:31")).toBeNaN();
    expect(sessionEpoch("2026-07-06", "9:31:00")).toBeNaN();
  });
});
