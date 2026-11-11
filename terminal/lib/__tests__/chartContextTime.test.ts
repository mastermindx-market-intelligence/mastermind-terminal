import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/fund";
import type { SuiteColors } from "@/lib/indicator-canvas/types";
import { buildVisualSeries, EMPTY_VISUAL_CALENDAR, formatVisualTime, visualOverlayBundle, visualSettings } from "@/lib/visualIntelligence";

describe("chart-context time preserves the plotted coordinate", () => {
  it.each([
    ["US winter wall clock", Date.UTC(2026, 0, 15, 9, 30) / 1000, "2026-01-15 09:30"],
    ["US summer wall clock", Date.UTC(2026, 6, 15, 9, 30) / 1000, "2026-07-15 09:30"],
    ["CN session clock", Date.UTC(2026, 7, 7, 14, 55) / 1000, "2026-08-07 14:55"],
    ["HK session clock", Date.UTC(2026, 7, 7, 15, 59) / 1000, "2026-08-07 15:59"],
    ["crypto UTC-shaped coordinate", Date.UTC(2026, 7, 7, 23, 59) / 1000, "2026-08-07 23:59"],
  ])("does not apply another timezone conversion to %s", (_label, time, expected) => {
    expect(formatVisualTime(time as number, "1m")).toBe(expected);
  });

  it.each(["1s", "5s", "15s", "30s"])("keeps seconds visible for the supported %s interval", (timeframe) => {
    const time = Date.UTC(2026, 7, 7, 9, 30, 15) / 1000;
    expect(formatVisualTime(time, timeframe)).toBe("2026-08-07 09:30:15");
    expect(formatVisualTime(time + 1, timeframe)).toBe("2026-08-07 09:30:16");
  });

  it("retains minute precision for minute/hour and legacy callers", () => {
    const time = Date.UTC(2026, 7, 7, 9, 30, 15) / 1000;
    expect(formatVisualTime(time, "1m")).toBe("2026-08-07 09:30");
    expect(formatVisualTime(time, "1h")).toBe("2026-08-07 09:30");
    expect(formatVisualTime(time)).toBe("2026-08-07 09:30");
  });

  it("leaves a daily date unchanged", () => {
    expect(formatVisualTime("2026-08-07", "D")).toBe("2026-08-07");
  });

  it.each([NaN, Infinity, -Infinity, 1e20])("keeps invalid numeric time unavailable (%s)", (time) => {
    expect(formatVisualTime(time, "1s")).toBe("");
  });

  it("keeps the exact selected second in the existing prior-range tooltip without changing bar identity", () => {
    const start = Date.UTC(2026, 7, 7, 9, 30) / 1000;
    const bars: Bar[] = Array.from({ length: 24 }, (_, index) => ({
      time: start + index, o: 100 + index, h: 102 + index, l: 99 + index, c: 101 + index, v: 1000 + index,
    }));
    const series = buildVisualSeries("NVDA", "1s", bars, "momentum");
    const colors = { muted: "#aaa" } as SuiteColors;
    const overlay = visualOverlayBundle(series, visualSettings({ visualLevels: true }), colors,
      { i0: 0, i1: 23 }, 21, EMPTY_VISUAL_CALENDAR, false, "en");
    expect(overlay.tooltips.get("visual:range:high")?.rows[0].v).toBe("2026-08-07 09:30:21");
    expect(series.indexByTime.get(String(start + 21))).toBe(21);
    expect(series.bars.map((bar) => bar.time)).toEqual(bars.map((bar) => bar.time));
  });
});
