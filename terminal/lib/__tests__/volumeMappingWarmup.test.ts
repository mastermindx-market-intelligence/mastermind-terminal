import { describe, expect, it } from "vitest";
import type { ModuleCtx, SuiteBar, SuiteColors } from "@/lib/indicator-canvas/types";
import { VOLUME_MAPPING_MODULE } from "@/lib/suites/pulse/volumeMapping";

const colors: SuiteColors = {
  up: "#0a0", down: "#a00", flowBuy: "#0c0", flowSell: "#c00",
  warn: "#aa0", brand: "#00a", text: "#fff", muted: "#888", neutral: "#777",
};

function bar(i: number, buyFrac: 0 | 1): SuiteBar {
  return {
    t: 1_700_000_000 + i * 60,
    o: 100,
    h: 101,
    l: 99,
    c: buyFrac ? 101 : 99,
    v: 100,
  };
}

function run(bars: SuiteBar[]) {
  const ctx: ModuleCtx = {
    bars, tf: "1m", symbol: "TEST", isIntraday: true,
    s: { window: 50 }, suite: {}, colors, lang: "en",
  };
  return VOLUME_MAPPING_MODULE.compute(ctx);
}

describe("Volume Mapping five-bar dominance warmup", () => {
  it("bootstraps on bar 5 and publishes the first real flip on the next bar", () => {
    // Bars 0..4 have buy share 60%, so the 5-bar state is buy-dominant at index 4.
    // Replacing bar 0 (buy) with bar 5 (sell) moves the rolling share to 40%,
    // which is a real buy -> sell flip and must be emitted at index 5.
    const bars = [1, 1, 1, 0, 0, 0].map((side, i) => bar(i, side as 0 | 1));
    const events = run(bars).events ?? [];

    expect(events.map((event) => [event.type, event.dir, event.i])).toEqual([
      ["vmap_flip", "bear", 5],
    ]);
  });
});
