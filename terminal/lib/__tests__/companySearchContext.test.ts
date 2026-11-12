import { describe, expect, it } from "vitest";
import {
  COMPANY_SEARCH_HISTORY_KEY,
  companySearchAnalysisHref,
  normalizeCompanySearchQuery,
  readCompanySearchQuery,
  readCompanySearchSelection,
  tradingCurrencyFor,
  venueFor,
} from "@/lib/companySearchContext";

// P12.T25 fixtures, reduced to the fields this module reads. The listing pair is the whole
// point: BABA (NYSE, USD-traded) and 9988.HK (HKEX, HKD-traded) are one company with two
// listings, and BOTH carry stmt_currency "CNY" — which must never surface as a trading
// currency.
const BABA_FUND = { ticker: "BABA", quote_currency: "USD", stmt_currency: "CNY" };
const HK9988_FUND = { ticker: "9988.HK", quote_currency: "HKD", stmt_currency: "CNY" };
const MANIFEST = {
  as_of: "2026-11-02",
  symbols: {
    BABA: { name: "Alibaba", mkt: "NYSE", sec: "Equities" },
    "9988.HK": { name: "Alibaba", mkt: "HKEX", sec: "Equities" },
    "600519.SS": { name: "Kweichow Moutai", mkt: "SHH", sec: "Equities" },
    "BTC-USD": { name: "Bitcoin", mkt: "Crypto", sec: "Crypto" },
  },
};

describe("normalizeCompanySearchQuery", () => {
  it("trims surrounding whitespace and keeps the typed query", () => {
    expect(normalizeCompanySearchQuery("  alibaba  ")).toBe("alibaba");
    expect(normalizeCompanySearchQuery("阿里巴巴")).toBe("阿里巴巴");
  });

  it("allows the empty string — a browse selection is a real selection", () => {
    expect(normalizeCompanySearchQuery("")).toBe("");
    expect(normalizeCompanySearchQuery("   ")).toBe("");
  });

  it("rejects rather than truncates an over-long query", () => {
    expect(normalizeCompanySearchQuery("a".repeat(160))).toBe("a".repeat(160));
    expect(normalizeCompanySearchQuery("a".repeat(161))).toBeNull();
  });

  it("refuses control characters and non-strings", () => {
    expect(normalizeCompanySearchQuery("ali\u0000baba")).toBeNull();
    expect(normalizeCompanySearchQuery("ali\nbaba")).toBeNull();
    expect(normalizeCompanySearchQuery("tab\tinside")).toBeNull();
    expect(normalizeCompanySearchQuery(null)).toBeNull();
    expect(normalizeCompanySearchQuery(undefined)).toBeNull();
    expect(normalizeCompanySearchQuery(42)).toBeNull();
    expect(normalizeCompanySearchQuery(["alibaba"])).toBeNull();
  });
});

describe("readCompanySearchSelection", () => {
  it("accepts a canonical symbol with its typed query", () => {
    expect(readCompanySearchSelection({ symbol: "BABA", query: "alibaba" })).toEqual({
      symbol: "BABA",
      query: "alibaba",
    });
    expect(readCompanySearchSelection({ symbol: "9988.HK", query: "" })).toEqual({
      symbol: "9988.HK",
      query: "",
    });
  });

  it("demands the canonical form exactly — non-canonical spellings never re-enter as picks", () => {
    expect(readCompanySearchSelection({ symbol: "baba", query: "alibaba" })).toBeNull();
    expect(readCompanySearchSelection({ symbol: " BABA ", query: "alibaba" })).toBeNull();
    expect(readCompanySearchSelection({ symbol: "BABA/", query: "alibaba" })).toBeNull();
  });

  it("refuses arrays, non-objects, and objects carrying extra authority fields", () => {
    expect(readCompanySearchSelection(["BABA", "alibaba"])).toBeNull();
    expect(readCompanySearchSelection("BABA")).toBeNull();
    expect(readCompanySearchSelection(null)).toBeNull();
    expect(readCompanySearchSelection({ symbol: "BABA", query: "alibaba", venue: "NYSE" })).toBeNull();
  });

  it("refuses an invalid query instead of quietly dropping the selection", () => {
    expect(readCompanySearchSelection({ symbol: "BABA", query: "bad\nquery" })).toBeNull();
    expect(readCompanySearchSelection({ symbol: "BABA", query: 7 })).toBeNull();
  });
});

describe("companySearchAnalysisHref", () => {
  it("routes the full ticker and the typed query to /analysis", () => {
    expect(companySearchAnalysisHref({ symbol: "BABA", query: "alibaba" })).toBe(
      "/analysis?symbol=BABA&company_query=alibaba",
    );
    expect(companySearchAnalysisHref({ symbol: "9988.HK", query: "" })).toBe(
      "/analysis?symbol=9988.HK&company_query=",
    );
  });

  it("encodes the query through URLSearchParams", () => {
    expect(companySearchAnalysisHref({ symbol: "BABA", query: "阿里巴巴" })).toBe(
      `/analysis?symbol=BABA&company_query=${encodeURIComponent("阿里巴巴")}`,
    );
  });

  it("answers null for invalid selections instead of a malformed URL", () => {
    expect(companySearchAnalysisHref(null)).toBeNull();
    expect(companySearchAnalysisHref({ symbol: "baba", query: "alibaba" })).toBeNull();
    expect(companySearchAnalysisHref({ symbol: "BABA", query: "a\nb" })).toBeNull();
  });
});

describe("readCompanySearchQuery", () => {
  it("reads the single param, empty string included", () => {
    expect(readCompanySearchQuery(new URLSearchParams("symbol=BABA&company_query=alibaba"))).toBe("alibaba");
    expect(readCompanySearchQuery(new URLSearchParams("symbol=BABA&company_query="))).toBe("");
  });

  it("answers null for an absent param", () => {
    expect(readCompanySearchQuery(new URLSearchParams("symbol=BABA"))).toBeNull();
  });

  it("answers null for a duplicated param rather than picking one", () => {
    expect(readCompanySearchQuery(new URLSearchParams("company_query=a&company_query=b"))).toBeNull();
    expect(readCompanySearchQuery(new URLSearchParams("company_query=&company_query="))).toBeNull();
  });

  it("answers null for a malformed param", () => {
    expect(readCompanySearchQuery(new URLSearchParams("company_query=bad%0Aquery"))).toBeNull();
  });
});

describe("tradingCurrencyFor", () => {
  it("answers quote_currency only when the row's ticker is exactly the requested symbol", () => {
    expect(tradingCurrencyFor(BABA_FUND, "BABA")).toBe("USD");
    expect(tradingCurrencyFor(HK9988_FUND, "9988.HK")).toBe("HKD");
  });

  it("never surfaces the statement currency — USD vs CNY and HKD vs CNY", () => {
    expect(tradingCurrencyFor(BABA_FUND, "BABA")).not.toBe("CNY");
    expect(tradingCurrencyFor(HK9988_FUND, "9988.HK")).not.toBe("CNY");
    expect(tradingCurrencyFor({ ticker: "BABA", stmt_currency: "CNY" }, "BABA")).toBeNull();
  });

  it("refuses a cross-listed row — the 9988.HK row never answers for BABA", () => {
    expect(tradingCurrencyFor(HK9988_FUND, "BABA")).toBeNull();
    expect(tradingCurrencyFor(BABA_FUND, "9988.HK")).toBeNull();
  });

  it("refuses malformed currencies, rows, and non-canonical requests", () => {
    expect(tradingCurrencyFor({ ticker: "BABA", quote_currency: "usd" }, "BABA")).toBeNull();
    expect(tradingCurrencyFor({ ticker: "BABA", quote_currency: "US" }, "BABA")).toBeNull();
    expect(tradingCurrencyFor({ ticker: "BABA" }, "BABA")).toBeNull();
    expect(tradingCurrencyFor(null, "BABA")).toBeNull();
    expect(tradingCurrencyFor([BABA_FUND], "BABA")).toBeNull();
    expect(tradingCurrencyFor(BABA_FUND, "baba")).toBeNull();
    expect(tradingCurrencyFor(BABA_FUND, "BABA/../../x")).toBeNull();
  });
});

describe("venueFor", () => {
  it("answers the manifest venue verbatim for the exact equity symbol", () => {
    expect(venueFor(MANIFEST, "BABA")).toBe("NYSE");
    expect(venueFor(MANIFEST, "9988.HK")).toBe("HKEX");
    expect(venueFor(MANIFEST, "600519.SS")).toBe("SHH");
  });

  it("answers null for an unknown symbol instead of guessing a venue", () => {
    expect(venueFor(MANIFEST, "FOO")).toBeNull();
    expect(venueFor({}, "BABA")).toBeNull();
    expect(venueFor(null, "BABA")).toBeNull();
    expect(venueFor({ symbols: [] }, "BABA")).toBeNull();
  });

  it("answers null unless the row's asset class is explicitly Equities", () => {
    expect(venueFor(MANIFEST, "BTC-USD")).toBeNull();
    expect(venueFor({ symbols: { LTEST: { mkt: "NYSE", sec: "Funds" } } }, "LTEST")).toBeNull();
    expect(venueFor({ symbols: { LTEST: { mkt: "NYSE" } } }, "LTEST")).toBeNull();
    expect(venueFor({ symbols: { LTEST: { sec: "Equities" } } }, "LTEST")).toBeNull();
  });

  it("refuses an oversized or control-bearing venue string", () => {
    expect(venueFor({ symbols: { L: { mkt: "M".repeat(80), sec: "Equities" } } }, "L")).toBe("M".repeat(80));
    expect(venueFor({ symbols: { L: { mkt: "M".repeat(81), sec: "Equities" } } }, "L")).toBeNull();
    expect(venueFor({ symbols: { L: { mkt: "NY\nSE", sec: "Equities" } } }, "L")).toBeNull();
  });
});

describe("COMPANY_SEARCH_HISTORY_KEY", () => {
  it("is the agreed device-local bucket for company-search picks", () => {
    expect(COMPANY_SEARCH_HISTORY_KEY).toBe("mmxCompanySearch");
  });
});
