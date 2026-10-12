// F5 — chart-TF time_close must honour ChartPanel's session-group `closeTime`
// (and the engine's own `timeClose`), with `timeClose` winning when both exist.
import { describe, it, expect } from "vitest";
import { runPine, type Bar } from "../pine-engine";
import { barsToColumns, columnsToBars } from "../pine-engine/host-shared";

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
