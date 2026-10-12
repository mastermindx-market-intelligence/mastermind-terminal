// F5 — chart-TF time_close must honour ChartPanel's session-group `closeTime`
// (and the engine's own `timeClose`), with `timeClose` winning when both exist.
import { describe, it, expect } from "vitest";
import { runPine, type Bar } from "../pine-engine";
import { NA } from "../pine-engine/builtins";
import { barsToColumns, columnsToBars, parseSessionStampMs } from "../pine-engine/host-shared";

function runClose(bars: Bar[]) {
  const out = runPine(`
//@version=6
indicator("t")
plot(time, "t")
plot(time_close, "c")
`, bars, { timeframe: "3D", symbol: "TEST" });
  expect(out.ok, JSON.stringify(out.errors)).toBe(true);
  const t = out.result!.plots.find((p) => p.title === "t")!.data.map((p) => p.value);
  const c = out.result!.plots.find((p) => p.title === "c")!.data.map((p) => p.value);
  return { t, c, warnings: out.result!.warnings };
}

describe("chart-TF time_close reads closeTime / timeClose", () => {
  it("a 3D session-group bar with closeTime (no timeClose) uses closeTime for time_close", () => {
    const bars = [
      { time: "2025-01-06", closeTime: "2025-01-08", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
      { time: "2025-01-09", closeTime: "2025-01-13", o: 2, h: 3, l: 1.5, c: 2.5, v: 10 },
    ] as Bar[];
    const { t, c } = runClose(bars);
    expect(t[0]).toBe(Date.parse("2025-01-06T00:00:00Z"));
    expect(c[0]).toBe(Date.parse("2025-01-08T00:00:00Z"));
    expect(c[0]).not.toBe(t[0]);
    expect(t[1]).toBe(Date.parse("2025-01-09T00:00:00Z"));
    expect(c[1]).toBe(Date.parse("2025-01-13T00:00:00Z"));
  });

  it("a bar with timeClose (no closeTime) uses timeClose for time_close", () => {
    const bars: Bar[] = [
      { time: "2025-01-06", timeClose: "2025-01-08", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
    ];
    const { t, c } = runClose(bars);
    expect(t[0]).toBe(Date.parse("2025-01-06T00:00:00Z"));
    expect(c[0]).toBe(Date.parse("2025-01-08T00:00:00Z"));
  });

  it("when both exist, timeClose takes precedence over closeTime", () => {
    const bars = [
      { time: "2025-01-06", timeClose: "2025-01-10", closeTime: "2025-01-08", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
    ] as Bar[];
    const { c } = runClose(bars);
    expect(c[0]).toBe(Date.parse("2025-01-10T00:00:00Z"));
    expect(c[0]).not.toBe(Date.parse("2025-01-08T00:00:00Z"));
  });

  it("barsToColumns preserves closeTime as timeClose through the worker pack", () => {
    const bars = [
      { time: "2025-01-06", closeTime: "2025-01-08", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
      { time: "2025-01-09", timeClose: "2025-01-13", o: 2, h: 3, l: 1.5, c: 2.5, v: 10 },
    ] as Bar[];
    const { payload } = barsToColumns(bars);
    const back = columnsToBars(payload);
    expect(back[0].timeClose).toBe("2025-01-08");
    expect(back[1].timeClose).toBe("2025-01-13");
    const { c } = runClose(back);
    expect(c[0]).toBe(Date.parse("2025-01-08T00:00:00Z"));
    expect(c[1]).toBe(Date.parse("2025-01-13T00:00:00Z"));
  });

  it("bars without a close stamp still have time_close equal to time", () => {
    const bars: Bar[] = [
      { time: "2025-01-06", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
    ];
    const { t, c } = runClose(bars);
    expect(c[0]).toBe(t[0]);
  });
});

function runIsoClose(bars: Bar[]) {
  const out = runPine(`
//@version=6
indicator("iso")
plot(time, "t")
plot(time_close, "c")
plot(time_close == time_close ? 1 : 0, "eq")
plot(na(time_close) ? 1 : 0, "isna")
`, bars, { timeframe: "D", symbol: "TEST" });
  expect(out.ok, JSON.stringify(out.errors)).toBe(true);
  const val = (title: string) => out.result!.plots.find((p) => p.title === title)!.data.map((p) => p.value);
  return { t: val("t"), c: val("c"), eq: val("eq"), isna: val("isna") };
}

describe("chart-TF time / time_close parse ISO date-time session stamps", () => {
  it("time_close of an ISO date-time close stamp equals Date.parse of that string", () => {
    const iso = "2026-10-09T20:00:00Z";
    const bars: Bar[] = [
      { time: "2026-10-09", timeClose: iso, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
    ];
    const { t, c, eq, isna } = runIsoClose(bars);
    expect(t[0]).toBe(Date.parse("2026-10-09T00:00:00Z"));
    expect(c[0]).toBe(Date.parse(iso));
    expect(c[0]).not.toBe(t[0]);
    expect(eq[0]).toBe(1);
    expect(isna[0]).toBe(0);
  });

  it("an unparseable close stamp yields Pine na, not a leaked NaN timestamp", () => {
    const bars: Bar[] = [
      { time: "2026-10-09", timeClose: "not-a-session", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
    ];
    const { t, c, eq, isna } = runIsoClose(bars);
    expect(t[0]).toBe(Date.parse("2026-10-09T00:00:00Z"));
    // plot(time_close) is a gap (no finite value). na(time_close) is true. A
    // leaked Date.parse NaN is the same IEEE value as Pine na, so the engine
    // contract is: never a finite timestamp, and na() is true.
    expect(c[0]).toBeUndefined();
    expect(Number.isFinite(c[0] as number)).toBe(false);
    expect(eq[0]).toBe(0);
    expect(isna[0]).toBe(1);
  });

  it("a date-only close stamp is still UTC midnight (byte-identical with the old parse)", () => {
    const bars: Bar[] = [
      { time: "2025-01-06", timeClose: "2025-01-08", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
    ];
    const { t, c, eq, isna } = runIsoClose(bars);
    expect(t[0]).toBe(Date.parse("2025-01-06T00:00:00Z"));
    expect(c[0]).toBe(Date.parse("2025-01-08T00:00:00Z"));
    expect(eq[0]).toBe(1);
    expect(isna[0]).toBe(0);
  });

  it("barsToColumns admits an ISO date-time close stamp and the engine parses it as-is", () => {
    const iso = "2026-10-09T20:00:00Z";
    const bars = [
      { time: "2026-10-09", closeTime: iso, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
    ] as Bar[];
    const { payload } = barsToColumns(bars);
    expect(payload.timeClose?.[0]).toBe(iso);
    const back = columnsToBars(payload);
    const { c, eq } = runIsoClose(back);
    expect(c[0]).toBe(Date.parse(iso));
    expect(eq[0]).toBe(1);
  });
});

describe("parseSessionStampMs is the one session-stamp rule", () => {
  it("date-only is UTC midnight; ISO date-time is Date.parse as-is; unparseable is Pine na", () => {
    expect(parseSessionStampMs("2026-10-09")).toBe(Date.parse("2026-10-09T00:00:00Z"));
    expect(parseSessionStampMs("2026-10-09T20:00:00Z")).toBe(Date.parse("2026-10-09T20:00:00Z"));
    expect(parseSessionStampMs("not-a-session")).toBe(NA);
    expect(Number.isFinite(parseSessionStampMs("not-a-session"))).toBe(false);
    expect(parseSessionStampMs("")).toBe(NA);
    expect(parseSessionStampMs(undefined)).toBe(NA);
  });
});
