import { describe, it, expect } from "vitest";
import {
  clampLogicalRange, logicalAtTime, sameLogicalRange, sampleStep, timeAtLogical, timeToMs,
  toLogicalRange, toTimeWindow, type AxisClock,
} from "../timeWindow";

const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

function clockOf(times: number[], step: number): AxisClock {
  return {
    first: 0,
    last: times.length - 1,
    msAt: (i) => (Number.isInteger(i) && i >= 0 && i < times.length ? times[i] : NaN),
    step,
  };
}

/** Weekday sessions: a 1-day step four times a week and a 3-day step over each weekend. */
function sessions(startISO: string, n: number): number[] {
  const out: number[] = [];
  const d = new Date(`${startISO}T00:00:00Z`);
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.getTime());
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe("timeToMs", () => {
  it("reads every horizontal-scale shape lightweight-charts accepts", () => {
    expect(timeToMs(1_700_000_000)).toBe(1_700_000_000_000);      // UTCTimestamp is SECONDS
    expect(timeToMs("2024-06-14")).toBe(ms("2024-06-14"));
    expect(timeToMs({ year: 2024, month: 6, day: 14 })).toBe(ms("2024-06-14"));
  });

  it("returns NaN rather than a plausible-looking zero for junk", () => {
    expect(timeToMs(undefined)).toBeNaN();
    expect(timeToMs(null)).toBeNaN();
    expect(timeToMs("not-a-date")).toBeNaN();
    expect(timeToMs(Number.NaN)).toBeNaN();
    expect(timeToMs({ year: 2024 })).toBeNaN();
  });
});

describe("index ↔ time mapping", () => {
  const times = sessions("2020-01-01", 500);
  const clock = clockOf(times, DAY);

  it("round-trips a fractional index through the calendar and back", () => {
    for (const logical of [0, 1.5, 123.25, 371.75, 499]) {
      expect(logicalAtTime(clock, timeAtLogical(clock, logical))).toBeCloseTo(logical, 9);
    }
  });

  it("round-trips outside the data too, where whitespace is projected at the axis step", () => {
    for (const logical of [-42.5, -1, 512, 903.25]) {
      expect(logicalAtTime(clock, timeAtLogical(clock, logical))).toBeCloseTo(logical, 9);
    }
  });

  it("puts a half-bar offset halfway between the two sessions it sits between", () => {
    const friday = times.findIndex((t, i) => i > 0 && times[i + 1] - t === 3 * DAY);
    expect(friday).toBeGreaterThan(0);
    // Half a bar past Friday is Saturday noon — the same instant a peer trading that weekend
    // will map back onto its own Saturday bar.
    expect(timeAtLogical(clock, friday + 0.5)).toBe(times[friday] + 1.5 * DAY);
  });

  it("refuses a degenerate axis instead of inventing a mapping", () => {
    expect(timeAtLogical(clockOf([ms("2024-01-02")], DAY), 0)).toBeNaN();
    expect(logicalAtTime(clockOf(times, 0), ms("2020-03-02"))).toBeNaN();
    expect(timeAtLogical(clock, Number.NaN)).toBeNaN();
  });
});

describe("window conversion between two different histories", () => {
  const long = sessions("2015-01-01", 1500);
  const short = long.slice(1000);                    // same sessions, a much later listing

  it("lands a window on the same dates in both, at different bar numbers", () => {
    const a = clockOf(long, DAY);
    const b = clockOf(short, DAY);
    const win = toTimeWindow(a, { from: 1100, to: 1300 })!;
    expect(win).toEqual({ from: long[1100], to: long[1300] });

    const target = toLogicalRange(b, win)!;
    expect(target).toEqual({ from: 100, to: 300 });   // the SAME dates, 1000 bars earlier
    expect(toTimeWindow(b, target)).toEqual(win);
  });

  it("returns null rather than a collapsed range when the window has no width", () => {
    const a = clockOf(long, DAY);
    expect(toTimeWindow(a, { from: 500, to: 500 })).toBeNull();
    expect(toLogicalRange(a, { from: long[500], to: long[500] })).toBeNull();
  });
});

describe("clampLogicalRange mirrors the library's own scroll limit", () => {
  const clock = clockOf(sessions("2020-01-01", 400), DAY);   // indexes 0…399

  it("leaves a reachable window untouched, whitespace and all", () => {
    const r = { from: -30, to: 210 };
    expect(clampLogicalRange(clock, r)).toEqual(r);
  });

  it("pins a window that is entirely before the data, keeping its width", () => {
    const out = clampLogicalRange(clock, { from: -600, to: -400 })!;
    expect(out.to).toBe(1);
    expect(out.to - out.from).toBe(200);
  });

  it("pins a window that is entirely after the data, keeping its width", () => {
    const out = clampLogicalRange(clock, { from: 900, to: 1100 })!;
    expect(out.from).toBe(399 - 1);
    expect(out.to - out.from).toBe(200);
  });

  it("tracks an axis whose first bar is not index 0", () => {
    const shifted: AxisClock = { first: 40, last: 300, msAt: clock.msAt, step: DAY };
    const out = clampLogicalRange(shifted, { from: -500, to: -300 })!;
    expect(out.to).toBe(41);                       // firstIndex + 1, not a hardcoded 1
    expect(out.to - out.from).toBe(200);
  });

  it("widens a degenerate span to the two bars lightweight-charts requires", () => {
    const out = clampLogicalRange(clock, { from: 10, to: 10 })!;
    expect(out.to - out.from).toBe(1);
  });
});

describe("sampleStep", () => {
  it("reports one day for weekday sessions, where the mean would report ~1.4", () => {
    const times = sessions("2020-01-01", 1000);
    const step = sampleStep((i) => times[i], 0, times.length - 1);
    expect(step).toBe(DAY);
    const mean = (times[times.length - 1] - times[0]) / (times.length - 1);
    expect(mean / DAY).toBeGreaterThan(1.35);        // …which is why the median is used
  });

  it("agrees between a five-day and a seven-day calendar of the same timeframe", () => {
    const equity = sessions("2020-01-01", 400);
    const crypto = Array.from({ length: 400 }, (_, i) => ms("2020-01-01") + i * DAY);
    expect(sampleStep((i) => equity[i], 0, 399)).toBe(sampleStep((i) => crypto[i], 0, 399));
  });

  it("falls back to the mean when no adjacent pair is usable", () => {
    expect(sampleStep(() => Number.NaN, 0, 10)).toBeNaN();
    expect(sampleStep((i) => (i === 0 ? 0 : i === 10 ? 10 * DAY : Number.NaN), 0, 10)).toBe(DAY);
  });
});

describe("sameLogicalRange", () => {
  it("treats sub-pixel float drift as the same viewport and a real move as different", () => {
    expect(sameLogicalRange({ from: 10, to: 20 }, { from: 10 + 1e-9, to: 20 - 1e-9 })).toBe(true);
    expect(sameLogicalRange({ from: 10, to: 20 }, { from: 10.5, to: 20.5 })).toBe(false);
    expect(sameLogicalRange(null, { from: 10, to: 20 })).toBe(false);
    expect(sameLogicalRange({ from: 10, to: 20 }, null)).toBe(false);
  });
});
