import { describe, expect, it } from "vitest";
import { GEX_AUTOCOMPLETE_ROOTS } from "../optionsRoots";

describe("options root startup catalog", () => {
  it("covers the core index, macro, sector, and liquid-name roots without duplicates", () => {
    const required = [
      "SPY", "QQQ", "IWM", "DIA", "SPX", "NDX", "RUT",
      "GLD", "SLV", "TLT", "HYG",
      "XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY",
      "KRE", "SMH", "SOXX", "XBI", "ARKK",
      "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA",
      "AMD", "AVGO", "MU", "WDC", "STX", "SNDK",
      "JPM", "BAC", "GS", "XOM", "CVX", "UNH", "LLY",
    ];

    expect(new Set(GEX_AUTOCOMPLETE_ROOTS).size).toBe(GEX_AUTOCOMPLETE_ROOTS.length);
    expect(GEX_AUTOCOMPLETE_ROOTS.length).toBeGreaterThanOrEqual(75);
    for (const root of required) expect(GEX_AUTOCOMPLETE_ROOTS).toContain(root);
  });
});
