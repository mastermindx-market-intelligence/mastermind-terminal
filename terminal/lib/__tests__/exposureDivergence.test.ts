import { describe, expect, it } from "vitest";
import { closedDailyBars, closedIntradayBars, confirmedExposureDivergence, latestExposureBarClose, type ClosedExposureBar } from "../exposureDivergence";
import { etDisplay } from "../intradaySources";
import type { Bar6 } from "../intradayShared";
const epoch = (s: string) => Date.parse(s + "Z") / 1000;
const bars = (start: string, n: number): Bar6[] => Array.from({ length: n }, (_, i) => [epoch(start) + i * 300, 100, 102, 99, 101, 5]);
const daily = (dates: string[]) => dates.map((time) => ({ time, o: 100, h: 102, l: 99, c: 101, v: 5 }));

describe("confirmed exposure timeframe clocks", () => {
  it("excludes forming 2h candles and marks the 30-minute final regular-session stub", () => {
    const source = bars("2026-10-19T09:30:00", 78);
    expect(closedIntradayBars(source, "2h", epoch("2026-10-19T11:29:00"))).toHaveLength(0);
    expect(closedIntradayBars(source, "2h", epoch("2026-10-19T11:30:00"))).toHaveLength(1);
    const all = closedIntradayBars(source, "2h", epoch("2026-10-19T16:00:00"));
    expect(all.map((b) => b.shortened)).toEqual([false, false, false, true]);
    expect(all.at(-1)?.closedAtDisplay).toBe(epoch("2026-10-19T16:00:00"));
  });
  it("does not convert missing constituent bars into a complete higher-timeframe candle", () => {
    const source = bars("2026-10-19T09:30:00", 24); source.splice(10, 1);
    expect(() => closedIntradayBars(source, "2h", epoch("2026-10-19T12:00:00"))).toThrow("INCOMPLETE_BUCKET");
  });
  it("uses the exchange early close and DST-aware display clock", () => {
    const clock = etDisplay(Date.parse("2026-11-27T18:00:00Z")).epoch;
    expect(clock).toBe(epoch("2026-11-27T13:00:00"));
    expect(latestExposureBarClose("D", clock)).toBe(clock);
    const all = closedIntradayBars(bars("2026-11-27T09:30:00", 42), "2h", clock);
    expect(all).toHaveLength(2); expect(all[1].shortened).toBe(true);
    expect(latestExposureBarClose("D", etDisplay(Date.parse("2026-07-03T21:00:00Z")).epoch)).toBe(epoch("2026-07-02T16:00:00"));
  });
  it("never bridges a wholly missing candle or trading session", () => {
    const source = bars("2026-10-19T09:30:00", 30); source.splice(10, 1);
    expect(() => closedIntradayBars(source, "5m", epoch("2026-10-19T12:00:00"))).toThrow("MISSING_SESSION_BARS");
    const gap = daily(["2026-10-15", "2026-10-19"]);
    expect(() => closedDailyBars(gap, "D", epoch("2026-10-19T16:00:00"))).toThrow("MISSING_SESSION_BARS");
    expect(closedDailyBars(daily(["2026-10-16", "2026-10-19"]), "D", epoch("2026-10-19T16:00:00"))).toHaveLength(2);
  });
  it("waits for the actual last weekly session, including Friday holidays", () => {
    const source = daily(["2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02"]);
    expect(closedDailyBars(source, "W", epoch("2026-07-02T15:59:00"))).toHaveLength(0);
    expect(closedDailyBars(source, "W", epoch("2026-07-02T16:00:00"))).toHaveLength(1);
    expect(latestExposureBarClose("W", epoch("2026-07-03T16:00:00"))).toBe(epoch("2026-07-02T16:00:00"));
  });
  it("separates unavailable history, stale bars and no divergence; confirms at a later close", () => {
    const source: ClosedExposureBar[] = Array.from({ length: 160 }, (_, i) => {
      const c = 100 + i * .05 + 5 * Math.sin(i / 4) * (1 - i / 300);
      return { t: i * 300, o: c, h: c + 1, l: c - 1, c, v: 1, closedAtDisplay: (i + 1) * 300, shortened: false };
    });
    expect(confirmedExposureDivergence(source.slice(0, 15), false).state).toBe("insufficient");
    expect(confirmedExposureDivergence(source, false, true).state).toBe("stale");
    const full = confirmedExposureDivergence(source, true);
    expect(full.event).not.toBeNull();
    const e = full.event!;
    expect(e.confirmedAt).toBe(e.iB + 2);
    expect(e.confirmedAtDisplay).toBe(source[e.iB + 2].closedAtDisplay);
    expect(confirmedExposureDivergence(source.slice(0, e.confirmedAt), true).event?.confirmedAt).not.toBe(e.confirmedAt);
    expect(confirmedExposureDivergence(source.slice(0, e.confirmedAt + 1), true).event?.confirmedAtDisplay).toBe(e.confirmedAtDisplay);
  });
});
