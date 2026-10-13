// F-4: canvas engine honours EngineOptions.localization.locale on time-axis
// labels instead of silently dropping it. Before the fix, `timeAxisTicks` in
// frame.ts (a) called `timeTicks` without a locale so ticks.ts fell back to
// "en-US" for the month formatter, and (b) passed a hardcoded "en-US" as the
// third argument to the caller's tickMarkFormatter. The falsifier below proves
// both bindings: a tickMarkFormatter spy records the locale it actually saw,
// and a month-level tick label is compared against the in-test Intl output for
// the configured locale.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// K1 (review patch): the de-DE label assertion below compares two
// `Intl.DateTimeFormat` results, so on a small-ICU Node both sides collapse to
// the root locale and a dropped `timeTicks` locale argument goes undetected.
// This pass-through mock records the locale `timeAxisTicks` actually hands to
// canvas/ticks.ts, which is ICU-independent. `vi.hoisted` and `vi.mock` are
// hoisted above the imports by vitest.
const ticksCalls = vi.hoisted(() => ({ locales: [] as Array<string | undefined> }));

vi.mock("@/lib/chart-engine/canvas/ticks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chart-engine/canvas/ticks")>();
  type TimeTicksArgs = Parameters<typeof actual.timeTicks>;
  return {
    ...actual,
    timeTicks: (rows: TimeTicksArgs[0], state: TimeTicksArgs[1], options: TimeTicksArgs[2]) => {
      ticksCalls.locales.push(options.locale);
      return actual.timeTicks(rows, state, options);
    },
  };
});

import { ChartModel } from "@/lib/chart-engine/canvas/model";
import { timeAxisTicks } from "@/lib/chart-engine/canvas/frame";
import type { EngineSeriesRow, EngineTime } from "@/lib/chart-engine/api";
import { timeToMs } from "@/lib/chart-engine/canvas/model";

// Monthly rows across a year so every row boundary produces a month-level tick
// in `timeTicks`. With de-DE these become "Jan", "Feb.", "März", "Apr.", "Mai",
// "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez." (the dotted forms
// are the locale's standard short-month abbreviations; the test compares
// against the in-test `Intl.DateTimeFormat` for the same locale, so the exact
// punctuation does not matter — what matters is that we DO NOT get the en-US
// strings the old hardcoded "en-US" produced).
const MONTHLY_2026: EngineSeriesRow[] = [
  { time: "2026-01-15", value: 1 },
  { time: "2026-02-15", value: 2 },
  { time: "2026-03-15", value: 3 },
  { time: "2026-04-15", value: 4 },
  { time: "2026-05-15", value: 5 },
  { time: "2026-06-15", value: 6 },
  { time: "2026-07-15", value: 7 },
  { time: "2026-08-15", value: 8 },
  { time: "2026-09-15", value: 9 },
  { time: "2026-10-15", value: 10 },
  { time: "2026-11-15", value: 11 },
  { time: "2026-12-15", value: 12 },
];

function makeModel(): ChartModel {
  const m = new ChartModel({ onInvalidate: () => undefined, onStructure: () => undefined });
  m.applyOptions({ width: 1000, height: 200 });
  m.addSeries("line").setData(MONTHLY_2026);
  return m;
}

// weight for the month-level tick in canvas/ticks.ts (mirrors TIME_TICK_WEIGHT.month).
const MONTH_WEIGHT = 4;

function monthLabelFor(locale: string, time: EngineTime): string {
  const ms = timeToMs(time);
  if (!Number.isFinite(ms)) throw new Error(`non-finite ms for ${String(time)}`);
  return new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(new Date(ms));
}

describe("F-4 canvas engine honours localization.locale on time-axis labels", () => {
  beforeEach(() => {
    ticksCalls.locales.length = 0;
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("with no localization the labels and the tickMarkFormatter's 3rd arg stay 'en-US'", () => {
    const m = makeModel();
    const spy = vi.fn<(time: EngineTime, weight: number, locale: string) => string>();
    m.applyOptions({ timeScale: { tickMarkFormatter: spy } });

    const ticks = timeAxisTicks(m);
    expect(ticks.length).toBeGreaterThan(0);
    const monthTicks = ticks.filter((t) => t.weight === MONTH_WEIGHT);
    expect(monthTicks.length).toBeGreaterThan(0);

    // tickMarkFormatter spy: the third argument must be "en-US" when no locale is set.
    const calledLocales = spy.mock.calls.map((c) => c[2]);
    expect(calledLocales.length).toBeGreaterThan(0);
    for (const l of calledLocales) expect(l).toBe("en-US");

    // Month-level labels equal Intl("en-US", { month: "short", timeZone: "UTC" }).
    for (const t of monthTicks) {
      const row = m.primarySeries()?.rows[t.index];
      expect(row).toBeDefined();
      const expected = monthLabelFor("en-US", row!.time as EngineTime);
      expect(t.label).toBe(expected);
    }
  });

  it("localization.locale = 'de-DE' flows into both the labels and the tickMarkFormatter 3rd arg", () => {
    const m = makeModel();
    const spy = vi.fn<(time: EngineTime, weight: number, locale: string) => string>();
    m.applyOptions({
      localization: { locale: "de-DE" },
      timeScale: { tickMarkFormatter: spy },
    });

    const ticks = timeAxisTicks(m);
    expect(ticks.length).toBeGreaterThan(0);
    const monthTicks = ticks.filter((t) => t.weight === MONTH_WEIGHT);
    expect(monthTicks.length).toBeGreaterThan(0);

    // tickMarkFormatter spy: every call must receive "de-DE" as the third argument.
    const calledLocales = spy.mock.calls.map((c) => c[2]);
    expect(calledLocales.length).toBeGreaterThan(0);
    for (const l of calledLocales) expect(l).toBe("de-DE");

    // Month-level labels equal Intl("de-DE", { month: "short", timeZone: "UTC" }).
    for (const t of monthTicks) {
      const row = m.primarySeries()?.rows[t.index];
      expect(row).toBeDefined();
      const expected = monthLabelFor("de-DE", row!.time as EngineTime);
      expect(t.label).toBe(expected);
    }
  });

  it("a non-string localization.locale collapses to 'en-US' (default behaviour is byte-identical)", () => {
    const m = makeModel();
    const spy = vi.fn<(time: EngineTime, weight: number, locale: string) => string>();
    m.applyOptions({
      // Both flavours of a non-string locale value land back on "en-US".
      localization: { locale: 42 as unknown as string },
      timeScale: { tickMarkFormatter: spy },
    });

    const ticks = timeAxisTicks(m);
    expect(ticks.length).toBeGreaterThan(0);

    const calledLocales = spy.mock.calls.map((c) => c[2]);
    expect(calledLocales.length).toBeGreaterThan(0);
    for (const l of calledLocales) expect(l).toBe("en-US");
  });

  it("an empty-string localization.locale also collapses to 'en-US'", () => {
    const m = makeModel();
    const spy = vi.fn<(time: EngineTime, weight: number, locale: string) => string>();
    m.applyOptions({
      localization: { locale: "" },
      timeScale: { tickMarkFormatter: spy },
    });
    const ticks = timeAxisTicks(m);
    expect(ticks.length).toBeGreaterThan(0);
    const calledLocales = spy.mock.calls.map((c) => c[2]);
    for (const l of calledLocales) expect(l).toBe("en-US");
  });

  it("localization without a locale key is treated as 'en-US'", () => {
    const m = makeModel();
    const spy = vi.fn<(time: EngineTime, weight: number, locale: string) => string>();
    m.applyOptions({
      localization: { priceFormatter: (n: number) => String(n) },
      timeScale: { tickMarkFormatter: spy },
    });
    const ticks = timeAxisTicks(m);
    expect(ticks.length).toBeGreaterThan(0);
    const calledLocales = spy.mock.calls.map((c) => c[2]);
    for (const l of calledLocales) expect(l).toBe("en-US");
  });

  it("K1: timeAxisTicks hands the caller locale to canvas/ticks.ts (ICU-independent)", () => {
    const m = makeModel();
    m.applyOptions({ localization: { locale: "de-DE" } });
    expect(timeAxisTicks(m).length).toBeGreaterThan(0);
    expect(ticksCalls.locales.length).toBeGreaterThan(0);
    for (const l of ticksCalls.locales) expect(l).toBe("de-DE");
  });

  it("K1: with no localization timeAxisTicks still hands 'en-US' to canvas/ticks.ts", () => {
    const m = makeModel();
    expect(timeAxisTicks(m).length).toBeGreaterThan(0);
    expect(ticksCalls.locales.length).toBeGreaterThan(0);
    for (const l of ticksCalls.locales) expect(l).toBe("en-US");
  });
});
