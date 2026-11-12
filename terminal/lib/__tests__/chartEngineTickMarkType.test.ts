// P03 — the mm time axis hands the caller's tickMarkFormatter lightweight-charts'
// TickMarkType, not its own tick weight. ChartPanel's formatter (chartTimeAxis.ts) is
// written against TickMarkType, so with the raw weight day ticks read as Time and were
// labelled "12:00 AM" on the 12-hour setting, and the >120-day orphan-date blanking never
// applied. These tests run that real formatter through timeAxisTicks.
import { describe, expect, it, vi } from "vitest";
import { TickMarkType } from "lightweight-charts";

import type { EngineSeriesRow, EngineTime } from "@/lib/chart-engine/api";
import { timeAxisTicks, tickMarkTypeOfWeight } from "@/lib/chart-engine/canvas/frame";
import { ChartModel } from "@/lib/chart-engine/canvas/model";
import { TIME_TICK_WEIGHT } from "@/lib/chart-engine/canvas/ticks";
import { chartTimeAxisOptions } from "@/lib/chartTimeAxis";

const HOUR = 3600;
const DAY = 86_400;
const MON_2026_10_12 = Date.UTC(2026, 9, 12) / 1000;

function model(rows: EngineSeriesRow[], timeScale: Record<string, unknown>): ChartModel {
  const m = new ChartModel({ onInvalidate: () => undefined, onStructure: () => undefined });
  m.applyOptions({ width: 1000, height: 200, timeScale });
  m.addSeries("line").setData(rows);
  return m;
}

const hourly = (days: number): EngineSeriesRow[] =>
  Array.from({ length: days * 24 }, (_, i) => ({ time: (MON_2026_10_12 + i * HOUR) as EngineTime, value: i }));

const daily = (days: number): EngineSeriesRow[] =>
  Array.from({ length: days }, (_, i) => ({ time: (MON_2026_10_12 + i * DAY) as EngineTime, value: i }));

describe("mm tickMarkFormatter receives the LWC TickMarkType", () => {
  it("maps every renderer tick weight onto the TickMarkType LWC gives the same tick", () => {
    expect(tickMarkTypeOfWeight(TIME_TICK_WEIGHT.year)).toBe(TickMarkType.Year);
    expect(tickMarkTypeOfWeight(TIME_TICK_WEIGHT.month)).toBe(TickMarkType.Month);
    expect(tickMarkTypeOfWeight(TIME_TICK_WEIGHT.day)).toBe(TickMarkType.DayOfMonth);
    expect(tickMarkTypeOfWeight(TIME_TICK_WEIGHT.hour)).toBe(TickMarkType.Time);
    expect(tickMarkTypeOfWeight(TIME_TICK_WEIGHT.minute)).toBe(TickMarkType.Time);
  });

  it("hands the formatter the mapped type for each placed tick", () => {
    const spy = vi.fn<(time: EngineTime, mark: number, locale: string) => string | null>(() => null);
    const ticks = timeAxisTicks(model(hourly(5), { timeVisible: true, tickMarkFormatter: spy }));
    expect(spy).toHaveBeenCalledTimes(ticks.length);
    const marks = new Set(spy.mock.calls.map((c) => c[1]));
    expect(marks).toEqual(new Set(ticks.map((t) => tickMarkTypeOfWeight(t.weight))));
    expect(marks.has(TickMarkType.DayOfMonth)).toBe(true);
    expect(marks.has(TickMarkType.Time)).toBe(true);
  });

  it("12-hour setting: intraday ticks get clock labels and day ticks keep the date", () => {
    const ticks = timeAxisTicks(model(hourly(5), { timeVisible: true, ...chartTimeAxisOptions("12") }));
    const day = ticks.filter((t) => t.weight === TIME_TICK_WEIGHT.day);
    const intraday = ticks.filter((t) => t.weight < TIME_TICK_WEIGHT.day);
    expect(day.length).toBeGreaterThan(0);
    expect(intraday.length).toBeGreaterThan(0);
    for (const t of day) expect(t.label).not.toMatch(/AM|PM/);
    for (const t of intraday) expect(t.label).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
  });

  it("over 120 days: day ticks become a month name or a deliberate blank", () => {
    // The span rule reads the caller's visible-span callback, so 60 daily bars (dense
    // enough for day ticks) stand in for a zoomed-in view of a longer history.
    const ticks = timeAxisTicks(model(daily(60), { ...chartTimeAxisOptions("24", () => 200) }));
    const day = ticks.filter((t) => t.weight === TIME_TICK_WEIGHT.day);
    expect(day.length).toBeGreaterThan(0);
    for (const t of day) expect(t.label).toMatch(/^(|[A-Z][a-z]{2})$/);
    expect(day.some((t) => t.label === "")).toBe(true);
  });

  it("a null from the formatter keeps the renderer's own label", () => {
    const plain = timeAxisTicks(model(hourly(5), { timeVisible: true }));
    const nulls = timeAxisTicks(model(hourly(5), { timeVisible: true, tickMarkFormatter: () => null }));
    expect(nulls.map((t) => t.label)).toEqual(plain.map((t) => t.label));
  });
});
