// F2 — a present-but-unparseable `closeTime` aliases `time` in chart-TF `time_close`.
// host-shared.ts ~:60-64 (`resolveBarTimeClose` returns undefined for junk) +
// runtime.ts `time_close` = parse(`b.timeClose ?? b.time`) — falls back to `time` even when
// `closeTime` is present but garbage, so the bar silently lands on midnight of `time` instead of na.
//
// Required: a present-but-unparseable `closeTime` makes `time_close` na for that bar (same as
// junk engine `timeClose`); a MISSING `closeTime` keeps the documented fallback (= `time`).
import { describe, it, expect } from "vitest";
import { runPine, type Bar } from "../pine-engine";

function runClose(bars: Bar[]) {
  const out = runPine(`
//@version=6
indicator("t")
plot(time, "t")
plot(time_close, "c")
plot(time_close == time_close ? 1 : 0, "eq")
plot(na(time_close) ? 1 : 0, "isna")
`, bars, { timeframe: "D", symbol: "TEST" });
  expect(out.ok, JSON.stringify(out.errors)).toBe(true);
  const val = (title: string) => out.result!.plots.find((p) => p.title === title)!.data.map((p) => p.value);
  return { t: val("t"), c: val("c"), eq: val("eq"), isna: val("isna") };
}

describe("chart-TF time_close when ChartPanel's closeTime is present but unparseable", () => {
  it("a junk closeTime makes time_close na (NOT midnight of `time`)", () => {
    const bars = [
      { time: "2026-10-09", closeTime: "nope", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
    ] as Bar[];
    const { t, c, eq, isna } = runClose(bars);
    expect(t[0]).toBe(Date.parse("2026-10-09T00:00:00Z"));
    // time_close must be na (whitespace point on a line plot), not midnight of `time`.
    expect(c[0]).toBeUndefined();
    expect(Number.isFinite(c[0] as number)).toBe(false);
    expect(eq[0]).toBe(0);
    expect(isna[0]).toBe(1);
  });

  it("a missing closeTime keeps the documented behavior: time_close = time (midnight)", () => {
    const bars: Bar[] = [{ time: "2026-10-09", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }];
    const { t, c, eq, isna } = runClose(bars);
    expect(t[0]).toBe(Date.parse("2026-10-09T00:00:00Z"));
    expect(c[0]).toBe(Date.parse("2026-10-09T00:00:00Z"));
    expect(eq[0]).toBe(1);
    expect(isna[0]).toBe(0);
  });

  it("a parseable closeTime still wins (existing test pinned by pineTimeClose.test.ts)", () => {
    const bars = [
      { time: "2025-01-06", closeTime: "2025-01-08", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
    ] as Bar[];
    const { c } = runClose(bars);
    expect(c[0]).toBe(Date.parse("2025-01-08T00:00:00Z"));
  });

  it("a junk timeClose (engine's own field) is also na", () => {
    const bars = [
      { time: "2026-10-09", timeClose: "nope", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
    ] as Bar[];
    const { c, isna } = runClose(bars);
    expect(c[0]).toBeUndefined();
    expect(isna[0]).toBe(1);
  });

  it("a present-but-unparseable closeTime alongside a parseable timeClose: timeClose wins", () => {
    const bars = [
      { time: "2026-10-09", timeClose: "2026-10-10", closeTime: "nope", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
    ] as Bar[];
    const { c, isna } = runClose(bars);
    expect(c[0]).toBe(Date.parse("2026-10-10T00:00:00Z"));
    expect(isna[0]).toBe(0);
  });
});