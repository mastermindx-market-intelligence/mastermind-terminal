import { describe, expect, it } from "vitest";
import type { ModuleCtx, SuiteBar, SuiteColors } from "@/lib/indicator-canvas/types";
import { ORDER_BLOCKS_MODULE } from "@/lib/suites/structure/orderBlocks";

const colors: SuiteColors = {
  up: "#0a0", down: "#a00", flowBuy: "#0c0", flowSell: "#c00",
  warn: "#aa0", brand: "#00a", text: "#fff", muted: "#888", neutral: "#777",
};

function fixture(): SuiteBar[] {
  const bars: SuiteBar[] = Array.from({ length: 40 }, (_, i) => ({
    t: 1_700_000_000 + i * 60,
    o: 100, h: 101, l: 99, c: 100.2, v: 100,
  }));
  // Opposing origin candle in the five-bar scan before the impulse.
  bars[34] = { ...bars[34], o: 101, h: 102, l: 99, c: 100, v: 100 };
  // Candidate peak/impulse: large bullish body, extreme close, local volume maximum.
  bars[35] = { ...bars[35], o: 100, h: 111, l: 99, c: 110, v: 1_000 };
  // Confirmation bar closes one bar later and is deliberately clear of the origin zone.
  bars[36] = { ...bars[36], o: 112, h: 113, l: 111, c: 112, v: 100 };
  for (let i = 37; i < bars.length; i++) bars[i] = { ...bars[i], o: 112, h: 113, l: 111, c: 112, v: 100 };
  return bars;
}

function run(bars: SuiteBar[]) {
  const ctx: ModuleCtx = {
    bars, tf: "1m", symbol: "TEST", isIntraday: true, lang: "en", colors, suite: {},
    s: {
      method: "peak", kImpulse: 0.8, showLast: 6, type: "all", boundsMode: "range",
      mitigation: "close", breaker: true, showInternals: false, showRating: false,
      sizeDetail: "small", extendRight: true, macro: false,
    },
  };
  return ORDER_BLOCKS_MODULE.compute(ctx);
}

describe("Order Blocks peak confirmation timing", () => {
  it("publishes a peak block only on the bar that confirms the local-volume maximum", () => {
    const result = run(fixture());
    const created = (result.events ?? []).filter((event) => event.type === "ob_created");

    expect(created).toHaveLength(1);
    // Bar 35 is the candidate peak, but its local-maximum condition needs bar 36 volume.
    // The event is therefore knowable only when bar 36 closes; stamping it on 35 leaks future data.
    expect(created[0].i).toBe(36);
  });

  it("does not create the candidate when the confirmation bar is absent", () => {
    const result = run(fixture().slice(0, 36));
    expect((result.events ?? []).filter((event) => event.type === "ob_created")).toEqual([]);
  });
});
