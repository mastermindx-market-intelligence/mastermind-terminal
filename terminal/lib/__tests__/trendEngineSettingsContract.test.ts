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
});
