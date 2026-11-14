import { describe, expect, it } from "vitest";
import { footprintEligibility } from "../footprintChartMode";

describe("main-chart order-flow eligibility", () => {
  it.each(["ES", "es", " ES ", "NQ", "nq"])("admits an exact captured futures root: %s", symbol => {
    const eligibility = footprintEligibility(symbol, "1m");
    expect(eligibility.status).toBe("supported");
    if (eligibility.status === "supported") {
      expect(eligibility.pair).toBe(symbol.trim().toUpperCase());
      expect(eligibility.intervalMinutes).toBe(1);
    }
  });

  it("maps the accepted chart timeframe exactly to the futures feed", () => {
    expect(footprintEligibility("NQ", "1m")).toEqual({ status: "supported", pair: "NQ", intervalMinutes: 1 });
    expect(footprintEligibility("ES", "5m")).toEqual({ status: "supported", pair: "ES", intervalMinutes: 5 });
    for (const timeframe of ["D", "1s", "15m", "1h", "W", "", "5M"]) {
      expect(footprintEligibility("NQ", timeframe)).toEqual({ status: "unsupported_timeframe", pair: "NQ" });
    }
  });

  it.each(["NVDA", "QQQ", "SPX", "NDX", "/NQ", "NQZ6", "ESZ26", "ES1!", "MNQ", "MES", "", "NQ.NQ"])(
    "never derives order flow for an equity, cash index, or unadmitted futures alias: %s", symbol => {
      expect(footprintEligibility(symbol, "1m")).toEqual({ status: "unsupported_symbol" });
    }
  );
});
