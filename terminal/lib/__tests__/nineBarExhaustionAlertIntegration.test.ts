import { beforeEach, describe, expect, it } from "vitest";
import { clearSuiteMemo, computeSuite, type SuiteHostInput } from "../indicator-canvas/host";
import type { SuiteColors, SuiteEvent } from "../indicator-canvas/types";
import { evalSuiteEvent, suiteAlertEventDef, validateSuiteCondition } from "../suiteAlerts";
import { parseSuiteDailyBars, suiteEventsAtDefaults } from "../suiteAlertInputs";
import { suiteDefaults } from "../suites/registry";
import { TREND_SUITE } from "../suites/runtime/trend";

const COLORS: SuiteColors = {
  up: "up",
  down: "down",
  flowBuy: "buy",
  flowSell: "sell",
  warn: "warn",
  brand: "brand",
  text: "text",
  muted: "muted",
  neutral: "neutral",
};

const rows = Array.from({ length: 13 }, (_, i) => ({
  time: 1_700_000_000 + i * 60,
  o: 100 + i,
  h: 100.5 + i,
  l: 99.5 + i,
  c: 100 + i,
  v: 1_000 + i,
}));

const params = () => {
  const out = suiteDefaults("trend");
  for (const suiteModule of TREND_SUITE.modules) out[`${suiteModule.key}.on`] = suiteModule.key === "nine";
  return out;
};

const input = (formingBarIndex: number | null): SuiteHostInput => ({
  bars: rows,
  tf: "1m",
  symbol: "TEST",
  isIntraday: true,
  lang: "en",
  formingBarIndex,
  session: "regular",
});

beforeEach(() => clearSuiteMemo());

describe("Nine-Bar Exhaustion host finality", () => {
  it("withholds the ninth-bar event while forming, then emits it when the same bar finalizes", () => {
    const forming = computeSuite(TREND_SUITE, params(), input(12), "free", COLORS);
    expect(forming.events.filter((event) => event.type.startsWith("nine_"))).toEqual([]);

    const finalized = computeSuite(TREND_SUITE, params(), input(null), "free", COLORS);
    expect(finalized.events.filter((event) => event.type.startsWith("nine_"))).toEqual([
      expect.objectContaining({
        eventId: expect.stringContaining("nine-bar-v1.0.0|TEST|1m|regular|rising|1"),
        type: "nine_rising",
        dir: "bear",
        i: 12,
        confirmedAt: 12,
      }),
    ]);
  });

  it("separates session identity in otherwise identical event computations", () => {
    const regular = computeSuite(TREND_SUITE, params(), input(null), "free", COLORS);
    const extended = computeSuite(TREND_SUITE, params(), { ...input(null), session: "extended" }, "free", COLORS);
    const regularEvent = regular.events.find((event) => event.type === "nine_rising");
    const extendedEvent = extended.events.find((event) => event.type === "nine_rising");
    expect(regularEvent).toBeDefined();
    expect(extendedEvent).toBeDefined();
    expect(regularEvent?.eventId).not.toBe(extendedEvent?.eventId);
    expect([...regular.tooltips.keys()]).not.toEqual([...extended.tooltips.keys()]);
  });
});

describe("Nine-Bar Exhaustion alert catalog and evaluator", () => {
  it("curates rising and falling completions as free directional, unscored events", () => {
    expect(suiteAlertEventDef("nine_rising")).toEqual({
      event: "nine_rising",
      suite: "trend",
      module: "nine",
      tier: "free",
      dirs: true,
      strength: false,
      tkey: "suiteEvNineRising",
      en: "Rising nine completed",
      zh: "上涨九转完成",
    });
    expect(suiteAlertEventDef("nine_falling")).toEqual({
      event: "nine_falling",
      suite: "trend",
      module: "nine",
      tier: "free",
      dirs: true,
      strength: false,
      tkey: "suiteEvNineFalling",
      en: "Falling nine completed",
      zh: "下跌九转完成",
    });
    expect(validateSuiteCondition({ type: "suite_event", suite: "trend", event: "nine_rising", dir: "bear" })).toBeNull();
    expect(validateSuiteCondition({ type: "suite_event", suite: "trend", event: "nine_rising", minStrength: 50 }))
      .toBe('event "nine_rising" carries no strength score');
  });

  it("fires once from the confirmed source bar and obeys confirmation-clock duplicate suppression", () => {
    const bundle = computeSuite(TREND_SUITE, params(), input(null), "free", COLORS);
    const event = bundle.events.find((candidate) => candidate.type === "nine_rising") as SuiteEvent;
    const times = rows.map((row) => Number(row.time));
    const condition = { type: "suite_event" as const, suite: "trend", event: "nine_rising", dir: "bear" as const };
    const first = evalSuiteEvent(condition, [event], times, 0);
    expect(first).toMatchObject({
      fired: true,
      eventId: event.eventId,
      state: { lastFiredT: times[12], clockVersion: 2 },
    });
    expect(first.note).toContain("Rising nine completed");
    expect(evalSuiteEvent({ ...condition, _se: first.state }, [event], times, 0)).toEqual({ fired: false });
    expect(evalSuiteEvent(condition, [event], times, times[12])).toEqual({ fired: false });
  });

  it("preserves a missing chart close as missing instead of synthesizing zero", () => {
    const bars = Array.from({ length: 18 }, (_, i) => ({
      time: `2026-01-${String(i + 1).padStart(2, "0")}`,
      o: i + 1,
      h: i + 2,
      l: i,
      c: i === 8 ? null as unknown as number : i + 1,
      v: 1_000,
    }));
    const bundle = computeSuite(TREND_SUITE, params(), {
      bars,
      tf: "D",
      symbol: "MISSING",
      isIntraday: false,
      lang: "en",
      formingBarIndex: null,
      session: "daily",
    }, "free", COLORS);
    expect(bundle.events.filter((event) => event.type.startsWith("nine_"))).toEqual([]);
  });

  it("rejects daily alert documents with missing OHLCV values", () => {
    const doc = { bars: Array.from({ length: 13 }, (_, i) => [
      `2026-02-${String(i + 1).padStart(2, "0")}`,
      i + 1,
      i + 2,
      i,
      i === 8 ? null : i + 1,
      1_000,
    ]) };
    expect(parseSuiteDailyBars(doc)).toBeNull();
  });

  it("uses the same canonical Trend runtime in the finalized daily sidecar adapter", async () => {
    const doc = {
      bars: Array.from({ length: 13 }, (_, i) => [
        `2026-01-${String(i + 2).padStart(2, "0")}`,
        100 + i,
        100.5 + i,
        99.5 + i,
        100 + i,
        1_000 + i,
      ]),
    };
    const parsed = parseSuiteDailyBars(doc);
    expect(parsed).not.toBeNull();
    const events = await suiteEventsAtDefaults("trend", "TEST", parsed!);
    const sidecarEvent = events.find((event) => event.type === "nine_rising");
    expect(sidecarEvent).toMatchObject({
      eventId: expect.stringContaining("nine-bar-v1.0.0|TEST|1d|daily|rising|1"),
      type: "nine_rising",
      dir: "bear",
      i: 12,
      confirmedAt: 12,
    });

    clearSuiteMemo();
    const chart = computeSuite(TREND_SUITE, params(), {
      bars: parsed!.bars,
      tf: "1d",
      symbol: "TEST",
      isIntraday: false,
      lang: "en",
      formingBarIndex: null,
      session: "daily",
    }, "free", COLORS);
    const chartEvent = chart.events.find((event) => event.type === "nine_rising");
    clearSuiteMemo();
    const replay = computeSuite(TREND_SUITE, params(), {
      bars: parsed!.bars,
      tf: "D",
      symbol: "TEST",
      isIntraday: false,
      lang: "en",
      formingBarIndex: null,
      session: "daily",
    }, "free", COLORS);
    const replayEvent = replay.events.find((event) => event.type === "nine_rising");
    expect(chartEvent?.eventId).toBe(sidecarEvent?.eventId);
    expect(replayEvent?.eventId).toBe(sidecarEvent?.eventId);
  });
});
