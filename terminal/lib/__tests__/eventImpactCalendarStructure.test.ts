import { describe, expect, it } from "vitest";
import { joinEventImpact, type TouchedPosition } from "@/lib/eventImpact";

const positions: readonly TouchedPosition[] = [
  { id: "p1", ticker: "AAPL", shares: 10, status: "open" },
];
const ctx = (tickers: unknown) => ({
  schema: "portfolio_ctx.v2",
  asof: "2026-10-08",
  tickers,
});

describe("event impact calendar structure", () => {
  it.each([undefined, null, [], "", 42, false])(
    "rejects malformed ticker dictionary %j",
    (tickers) => {
      expect(joinEventImpact({ positions, ctx: ctx(tickers) })).toEqual({
        state: "calendar_unreadable",
        detail: "bad ticker map",
      });
    }
  );

  it.each(["portfolio_ctx.v1", "portfolio_ctx.v2"])(
    "preserves a genuinely empty %s dictionary",
    (schema) => {
      expect(
        joinEventImpact({ positions, ctx: { schema, asof: "2026-10-08", tickers: {} } }).state
      ).toBe("no_events");
    }
  );

  it("preserves known empty holdings before inspecting calendar structure", () => {
    expect(joinEventImpact({ positions: [], ctx: ctx(null) })).toEqual({ state: "no_holdings" });
  });

  it("preserves unreadable holdings before inspecting calendar structure", () => {
    expect(joinEventImpact({ positions: null, ctx: ctx(null) })).toEqual({ state: "holdings_unreadable" });
  });
});
