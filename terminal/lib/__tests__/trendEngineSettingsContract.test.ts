import { describe, expect, it } from "vitest";
import type { ModuleCtx, SuiteBar, SuiteColors } from "@/lib/indicator-canvas/types";
import { TREND_ENGINE_MODULE } from "@/lib/suites/trend/trendEngine";

const colors: SuiteColors = {
  up: "var(--up)", down: "var(--down)", flowBuy: "var(--flow-buy)", flowSell: "var(--flow-sell)",
  warn: "var(--warn)", brand: "var(--brand-2)", text: "var(--text)", muted: "var(--muted)", neutral: "var(--text-dim)",
};

const levels = [
  100,101,102,103,104,105,106,107,108,109,110,
  109,108,107,106,105,104,103,102,101,100,
  101,102,103,104,105,106,107,108,109,110,
];

function bars(): SuiteBar[] {
  return levels.map((level, i) => ({
    t: 1_700_000_000 + i * 86_400,
    o: level, h: level + 2, l: level, c: level + 1, v: 1_000,
  }));
}

function run(s: Record<string, unknown>) {
  const ctx: ModuleCtx = {
    bars: bars(), tf: "1D", symbol: "TEST", isIntraday: false,
    s, suite: {}, colors, lang: "en",
  };
  return TREND_ENGINE_MODULE.compute(ctx);
}

describe("Trend Engine settings contract", () => {
  it("clamps persisted fixed TP percentages to the same 90% maximum exposed by settings", () => {
    const result = run({ sensitivity: 1, tpMode: "fixed", tpFixed1: 150, showLast: 6 });
    const tp1 = result.prims.find((prim) => prim.id === "te-tpc13-0") as { p?: number } | undefined;

    expect(tp1).toBeDefined();
    // First flip is short from 108. Settings declares TP1 max=90%, so even stale/foreign
    // persisted input must resolve to 108 * (1 - .90) = 10.8 rather than 100%/zero.
    expect(tp1!.p).toBeCloseTo(10.8, 10);
  });

  it("applies the same 90% maximum to TP2 and TP3", () => {
    const result = run({ sensitivity: 1, tpMode: "fixed", tpFixed1: 150, tpFixed2: 200, tpFixed3: 400, showLast: 6 });
    const chips = tpChips(result, 13);

    // Unclamped 200%/400% put a short's target below zero, so both chips used to vanish.
    expect(chips.map((chip) => chip?.text?.slice(0, 3))).toEqual(["TP1", "TP2", "TP3"]);
    for (const chip of chips) expect(chip!.p).toBeCloseTo(10.8, 10);
  });

  it("leaves defaults and in-range values unchanged", () => {
    const defaults = tpChips(run({ sensitivity: 1, tpMode: "fixed", showLast: 6 }), 13);
    expect(defaults.map((chip) => chip!.p)).toEqual([
      expect.closeTo(108 * 0.98, 10),
      expect.closeTo(108 * 0.96, 10),
      expect.closeTo(108 * 0.92, 10),
    ]);

    const inRange = tpChips(run({ sensitivity: 1, tpMode: "fixed", tpFixed1: 0.1, tpFixed2: 45, tpFixed3: 90, showLast: 6 }), 13);
    expect(inRange.map((chip) => chip!.p)).toEqual([
      expect.closeTo(108 * 0.999, 10),
      expect.closeTo(108 * 0.55, 10),
      expect.closeTo(108 * 0.1, 10),
    ]);
  });

  it("keeps the existing minimum and default rules for out-of-range low and malformed input", () => {
    const chips = tpChips(run({ sensitivity: 1, tpMode: "fixed", tpFixed1: 0, tpFixed2: "abc", tpFixed3: null, showLast: 6 }), 13);
    expect(chips.map((chip) => chip!.p)).toEqual([
      expect.closeTo(108 * 0.999, 10), // below the 0.1% minimum clamps up to it
      expect.closeTo(108 * 0.96, 10), // unparseable falls back to the TP2 default (4%)
      expect.closeTo(108 * 0.92, 10), // null falls back to the TP3 default (8%)
    ]);
  });
});

function tpChips(result: ReturnType<typeof run>, flipIndex: number) {
  return [0, 1, 2].map(
    (t) => result.prims.find((prim) => prim.id === `te-tpc${flipIndex}-${t}`) as { p?: number; text?: string } | undefined,
  );
}
