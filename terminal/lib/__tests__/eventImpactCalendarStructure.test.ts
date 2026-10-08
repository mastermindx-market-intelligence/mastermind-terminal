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

const event = { earnings: { next: "2026-10-12", days_to: 4 } };

describe("event impact held ticker structure", () => {
  it.each([null, [], "", 42, false])("rejects present malformed held row %j", (row) => {
    expect(joinEventImpact({ positions, ctx: ctx({ AAPL: row }) })).toEqual({
      state: "calendar_unreadable",
      detail: "bad ticker row",
    });
  });

  it("keeps an absent held ticker as uncovered", () => {
    expect(joinEventImpact({ positions, ctx: ctx({}) }).state).toBe("no_events");
  });

  it("keeps a valid empty held ticker object as uncovered", () => {
    expect(joinEventImpact({ positions, ctx: ctx({ AAPL: {} }) }).state).toBe("no_events");
  });

  it("ignores a malformed ticker outside the open book", () => {
    const result = joinEventImpact({ positions, ctx: ctx({ AAPL: event, MSFT: null }) });
    expect(result.state).toBe("ok");
    if (result.state === "ok") expect(result.events.map((e) => e.ticker)).toEqual(["AAPL"]);
  });

  it("keeps covered events when another held ticker is absent", () => {
    const result = joinEventImpact({
      positions: [...positions, { id: "p2", ticker: "MSFT", shares: 2, status: "open" }],
      ctx: ctx({ AAPL: event }),
    });
    expect(result.state).toBe("ok");
    if (result.state === "ok") expect(result.events.map((e) => e.ticker)).toEqual(["AAPL"]);
  });

  it.each([
    { AAPL: event, MSFT: null },
    { AAPL: null, MSFT: event },
  ])("rejects a broken held row before or after a valid event", (tickers) => {
    expect(joinEventImpact({
      positions: [...positions, { id: "p2", ticker: "MSFT", shares: 2, status: "open" }],
      ctx: ctx(tickers),
    }).state).toBe("calendar_unreadable");
  });
});
