import { describe, expect, it } from "vitest";
import { logicalAtTime, toLogicalRange, type AxisClock } from "@/lib/timeWindow";

const DAY = 86_400_000;

function countedClock(n = 4096) {
  const times = Array.from({ length: n }, (_, i) => Date.UTC(2020, 0, 1) + i * DAY);
  let calls = 0;
  const clock: AxisClock = {
    first: 0,
    last: n - 1,
    step: DAY,
    msAt(index) {
      calls++;
      return Number.isInteger(index) && index >= 0 && index < times.length ? times[index] : NaN;
    },
  };
  return {
    clock,
    times,
    calls: () => calls,
    resetCalls: () => { calls = 0; },
  };
}

describe("timeWindow hot-path inverse mapping", () => {
  it("reuses validated nearby brackets for consecutive viewport windows", () => {
    const c = countedClock();
    const warm = toLogicalRange(c.clock, {
      from: c.times[1700] + DAY * 0.25,
      to: c.times[1950] + DAY * 0.75,
    });
    expect(warm).not.toBeNull();

    c.resetCalls();
    const next = toLogicalRange(c.clock, {
      from: c.times[1700] + DAY * 0.35,
      to: c.times[1950] + DAY * 0.85,
    });
    expect(next?.from).toBeCloseTo(1700.35, 9);
    expect(next?.to).toBeCloseTo(1950.85, 9);

    // Two endpoints still validate the clock's first/last values and their local brackets.
    // What must disappear is the two full O(log N) searches through the same unchanged axis.
    expect(c.calls(), "nearby pan windows should use local validated brackets").toBeLessThanOrEqual(10);
  });

  it("never trusts a stale hint when the underlying clock changes in place", () => {
    const c = countedClock(512);
    const target = c.times[100] + DAY * 0.5;
    expect(logicalAtTime(c.clock, target)).toBeCloseTo(100.5, 9);

    // A generic AxisClock is allowed to be backed by mutable data. Move only the old hint bracket
    // later while preserving monotonicity: the target now belongs between bars 99 and 100.
    c.times[100] += DAY * 0.75;
    c.times[101] += DAY * 0.75;

    expect(logicalAtTime(c.clock, target)).toBeCloseTo(99.8571428571, 8);
  });
});
