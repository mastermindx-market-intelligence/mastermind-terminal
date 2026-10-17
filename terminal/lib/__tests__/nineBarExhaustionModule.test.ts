import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ModuleCtx, SuiteBar, SuiteColors } from "../indicator-canvas/types";
import { getSuiteModuleCatalogEntry } from "../suites/catalog";
import { TREND_SUITE_META } from "../suites/meta";
import { TREND_SUITE } from "../suites/runtime/trend";
import { NINE_BAR_EXHAUSTION_META } from "../suites/trend/nineBarExhaustion.meta";
import { NINE_BAR_EXHAUSTION_MODULE } from "../suites/trend/nineBarExhaustion";

const COLORS: SuiteColors = {
  up: "token-up",
  down: "token-down",
  flowBuy: "token-flow-buy",
  flowSell: "token-flow-sell",
  warn: "token-warn",
  brand: "token-brand",
  text: "token-text",
  muted: "token-muted",
  neutral: "token-neutral",
};

const bars = (direction: "rising" | "falling", comparisons = 9): SuiteBar[] =>
  Array.from({ length: 4 + comparisons }, (_, i) => {
    const c = direction === "rising" ? 100 + i : 100 - i;
    return { t: 1_700_000_000 + i * 60, o: c, h: c + 0.5, l: c - 0.5, c, v: 100 + i };
  });

const ctx = (
  source: SuiteBar[],
  settings: Record<string, unknown> = {},
  extra: Partial<ModuleCtx> = {},
): ModuleCtx => ({
  bars: source,
  tf: "1m",
  symbol: "TEST",
  isIntraday: true,
  s: { ...NINE_BAR_EXHAUSTION_META.defaults, ...settings },
  suite: {},
  colors: COLORS,
  lang: "en",
  ...extra,
});

describe("Nine-Bar Exhaustion native Trend module", () => {
  it("is registered exactly once in metadata, runtime, and the module-first catalog", () => {
    expect(TREND_SUITE_META.modules.filter((module) => module.key === "nine")).toHaveLength(1);
    expect(TREND_SUITE.modules.filter((module) => module.key === "nine")).toHaveLength(1);
    const entry = getSuiteModuleCatalogEntry("suite:trend/nine");
    expect(entry).toMatchObject({
      id: "suite:trend/nine",
      suiteKey: "trend",
      moduleKey: "nine",
      label: "Nine-Bar Exhaustion",
      surface: "overlay",
      tier: "free",
      defaultOn: false,
    });
    expect(entry?.module).toBe(NINE_BAR_EXHAUSTION_META);
  });

  it("publishes the frozen settings contract and conservative defaults", () => {
    expect(NINE_BAR_EXHAUSTION_META).toMatchObject({
      key: "nine",
      label: "Nine-Bar Exhaustion",
      tag: "9X",
      tier: "free",
      defaultOn: false,
      defaults: {
        displayPolicy: "retro6",
        density: "all",
        requireFlip: false,
        cycleMode: "single",
        showMarkers: true,
        historyBars: 500,
        labelSize: 10,
      },
    });
    expect(NINE_BAR_EXHAUSTION_META.fields.map((field) => field.key)).toEqual([
      "displayPolicy",
      "density",
      "requireFlip",
      "cycleMode",
      "showMarkers",
      "historyBars",
      "labelSize",
    ]);
  });

  it("renders rising counts above candles with the potential-exhaustion down token", () => {
    const out = NINE_BAR_EXHAUSTION_MODULE.compute(ctx(bars("rising")));
    const labels = out.prims.filter((prim) => prim.kind === "label");
    expect(labels).toHaveLength(9);
    expect(labels.map((label) => label.kind === "label" && label.text)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    for (const label of labels) {
      if (label.kind !== "label") continue;
      expect(label.place).toBe("above");
      expect(label.color).toBe(COLORS.down);
    }
    const completion = labels.at(-1);
    expect(completion).toMatchObject({ kind: "label", text: "9", style: "pill", bold: true, pointer: true });
    expect(out.prims.some((prim) => prim.kind === "marker" && prim.shape === "diamond" && prim.fill === COLORS.down)).toBe(true);
  });

  it("renders falling counts below candles with the potential-reversal up token", () => {
    const out = NINE_BAR_EXHAUSTION_MODULE.compute(ctx(bars("falling")));
    const labels = out.prims.filter((prim) => prim.kind === "label");
    expect(labels).toHaveLength(9);
    for (const label of labels) {
      if (label.kind !== "label") continue;
      expect(label.place).toBe("below");
      expect(label.color).toBe(COLORS.up);
    }
    expect(out.prims.some((prim) => prim.kind === "marker" && prim.shape === "diamond" && prim.fill === COLORS.up)).toBe(true);
  });

  it("emits only canonical confirmed completion events with source-bar timing", () => {
    const rising = NINE_BAR_EXHAUSTION_MODULE.compute(ctx(bars("rising")));
    const falling = NINE_BAR_EXHAUSTION_MODULE.compute(ctx(bars("falling")));
    expect(rising.events).toEqual([
      expect.objectContaining({
        type: "nine_rising",
        dir: "bear",
        i: 12,
        confirmedAt: 12,
        p: 112,
      }),
    ]);
    expect(falling.events).toEqual([
      expect.objectContaining({
        type: "nine_falling",
        dir: "bull",
        i: 12,
        confirmedAt: 12,
        p: 88,
      }),
    ]);
    expect(rising.events?.[0]).not.toHaveProperty("strength");
  });

  it("withholds a completion event on the explicit forming ninth bar", () => {
    const source = bars("rising");
    const out = NINE_BAR_EXHAUSTION_MODULE.compute(ctx(source, {}, { formingBarIndex: source.length - 1 }));
    expect(out.events).toEqual([]);
    const nine = out.prims.find((prim) => prim.kind === "label" && prim.text === "9");
    expect(nine).toMatchObject({ kind: "label", style: "tag", bold: false });
    const tip = out.tooltips?.find((tooltip) => tooltip.id === (nine && "tooltipId" in nine ? nine.tooltipId : undefined));
    expect(tip?.rows).toContainEqual(expect.objectContaining({ k: "Status", v: "Forming — waits for bar close" }));
  });

  it("keeps unfinished retro6 counts invisible after interruption and preserves completed history", () => {
    const partial = bars("rising", 6);
    const last = partial.at(-1)!;
    partial.push({ ...last, t: last.t + 60, c: partial[6].c });
    const canceled = NINE_BAR_EXHAUSTION_MODULE.compute(ctx(partial));
    expect(canceled.prims.filter((prim) => prim.kind === "label")).toHaveLength(0);

    const complete = bars("rising");
    const completeLast = complete.at(-1)!;
    complete.push({ ...completeLast, t: completeLast.t + 60, c: 1 });
    const retained = NINE_BAR_EXHAUSTION_MODULE.compute(ctx(complete));
    expect(retained.prims.filter((prim) => prim.kind === "label")).toHaveLength(9);
  });

  it("applies completion-only density without changing the completion event", () => {
    const source = bars("rising");
    const all = NINE_BAR_EXHAUSTION_MODULE.compute(ctx(source));
    const only = NINE_BAR_EXHAUSTION_MODULE.compute(ctx(source, { density: "completion" }));
    expect(only.events).toEqual(all.events);
    expect(only.prims.filter((prim) => prim.kind === "label")).toEqual([
      expect.objectContaining({ kind: "label", text: "9" }),
    ]);
  });

  it("provides inspectable, honest English and Chinese tooltip copy", () => {
    const en = NINE_BAR_EXHAUSTION_MODULE.compute(ctx(bars("rising")));
    const zh = NINE_BAR_EXHAUSTION_MODULE.compute(ctx(bars("falling"), {}, { lang: "zh" }));
    const enNine = en.tooltips?.at(-1);
    const zhNine = zh.tooltips?.at(-1);
    expect(enNine?.title).toBe("Rising nine completed");
    expect(enNine?.rows).toContainEqual({ k: "Meaning", v: "Possible exhaustion — not a guaranteed reversal" });
    expect(enNine?.rows).toContainEqual({ k: "Comparison", v: "112 > 108 (4 chart bars back)" });
    expect(zhNine?.title).toBe("下跌九转完成");
    expect(zhNine?.rows).toContainEqual({ k: "含义", v: "可能衰竭，并不保证反转" });
  });

  it("labels display-epoch source time honestly and exposes separate availability", () => {
    const source = bars("rising");
    const finalT = Date.parse("2026-10-15T10:30:00Z") / 1000;
    for (let i = 0; i < source.length; i++) {
      source[i] = { ...source[i], t: finalT - (source.length - 1 - i) * 60 };
    }
    source[source.length - 1] = {
      ...source[source.length - 1],
      availableT: Date.parse("2026-10-15T10:35:00Z") / 1000,
    };
    const out = NINE_BAR_EXHAUSTION_MODULE.compute(ctx(source));
    const tip = out.tooltips?.at(-1);
    expect(tip?.rows).toContainEqual({ k: "Source bar", v: "2026-10-15 10:30 chart time" });
    expect(tip?.rows).toContainEqual({ k: "Available", v: "2026-10-15 10:35 chart time" });
    expect(JSON.stringify(tip?.rows)).not.toContain("UTC");
  });

  it("uses only suite color tokens in its rendering implementation", () => {
    const source = readFileSync(path.resolve(__dirname, "../suites/trend/nineBarExhaustion.ts"), "utf8");
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source).not.toMatch(/rgba?\s*\(/i);
  });
});
