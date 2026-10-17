import { describe, expect, it, vi } from "vitest";
import { CFTC_TFF_SOURCE, cotSourceUrl, parseCotTff, readCotTff } from "../futuresCot";

const NOW = Date.parse("2026-10-16T20:00:00Z");
const makeRow = (pair: "ES" | "NQ" = "ES", date = "2026-10-13", factor = 1) => ({
  cftc_contract_market_code: pair === "ES" ? "13874A" : "209742",
  market_and_exchange_names: (pair === "ES" ? "E-MINI S&P 500" : "NASDAQ MINI") + " - CHICAGO MERCANTILE EXCHANGE",
  report_date_as_yyyy_mm_dd: date + "T00:00:00.000",
  open_interest_all: String(10000 * factor),
  dealer_positions_long_all: String(200 * factor), dealer_positions_short_all: String(250 * factor), dealer_positions_spread_all: "50",
  asset_mgr_positions_long: String(500 * factor), asset_mgr_positions_short: "100", asset_mgr_positions_spread: "40",
  lev_money_positions_long: String(300 * factor), lev_money_positions_short: String(400 * factor), lev_money_positions_spread: "20",
  other_rept_positions_long: "40", other_rept_positions_short: "20", other_rept_positions_spread: "10",
});
const rows = () => [makeRow(), makeRow("ES", "2026-10-06", 2)];

describe("CFTC futures-only weekly positioning contract", () => {
  it("only queries hard-coded official CFTC dataset and genuine ES/NQ codes", () => {
    for (const [pair, code] of [["ES", "13874A"], ["NQ", "209742"]] as const) {
      const url = new URL(cotSourceUrl(pair));
      expect(url.origin).toBe("https://publicreporting.cftc.gov");
      expect(url.pathname).toBe("/resource/gpe5-46if.json");
      expect(url.searchParams.get("$where")).toBe("cftc_contract_market_code = '" + code + "'");
      expect(url.searchParams.get("$limit")).toBe("2");
      expect(url.searchParams.get("$order")).toContain("DESC");
    }
  });
  it("preserves signed net and weekly change while excluding spreading from directional net", () => {
    const result = parseCotTff(rows(), "ES", NOW);
    expect(result).toMatchObject({
      kind: "weekly_cftc_tff_futures_only", pair: "ES", cftcCode: "13874A",
      reportDate: "2026-10-13", previousReportDate: "2026-10-06",
      openInterest: 10000, openInterestChange: -10000,
      replayEligible: false, retrievedAtMs: NOW, sourceUrl: CFTC_TFF_SOURCE,
    });
    expect(result?.categories.find(r => r.key === "dealer")).toEqual({
      key: "dealer", long: 200, short: 250, spread: 50, net: -50, weeklyNetChange: 50,
    });
    expect(result?.categories.find(r => r.key === "leveragedMoney")?.net).toBe(-100);
  });
  it("keeps NQ mini distinct from ES and the consolidated Nasdaq-100 contract", () => {
    expect(parseCotTff([makeRow("NQ")], "NQ", NOW)?.cftcCode).toBe("209742");
    expect(parseCotTff([makeRow("NQ")], "ES", NOW)).toBeNull();
    expect(parseCotTff([makeRow("ES")], "NQ", NOW)).toBeNull();
    expect(parseCotTff([{ ...makeRow("NQ"), cftc_contract_market_code: "20974+" }], "NQ", NOW)).toBeNull();
  });
  it("requires observed, nonnegative integer counts rather than manufacturing zeros", () => {
    for (const patch of [
      { open_interest_all: undefined },
      { dealer_positions_long_all: undefined },
      { dealer_positions_spread_all: null },
      { asset_mgr_positions_short: "bad" },
      { lev_money_positions_long: "-1" },
      { other_rept_positions_short: "Infinity" },
      { open_interest_all: "9007199254740999" },
    ]) {
      expect(parseCotTff([{ ...makeRow(), ...patch }], "ES", NOW)).toBeNull();
    }
  });
  it("refuses identity changes, duplicate/extra rows, mismatched previous rows and invalid dates", () => {
    expect(parseCotTff([], "ES", NOW)).toBeNull();
    expect(parseCotTff([makeRow(), makeRow(), makeRow()], "ES", NOW)).toBeNull();
    expect(parseCotTff([makeRow(), makeRow("NQ", "2026-10-06")], "ES", NOW)).toBeNull();
    expect(parseCotTff([makeRow(), makeRow("ES", "2026-10-13")], "ES", NOW)).toBeNull();
    expect(parseCotTff([{ ...makeRow(), report_date_as_yyyy_mm_dd: "2026-02-30T00:00:00.000" }], "ES", NOW)).toBeNull();
    expect(parseCotTff([{ ...makeRow(), report_date_as_yyyy_mm_dd: "2026-10-20T00:00:00.000" }], "ES", NOW)).toBeNull();
    expect(parseCotTff([makeRow()], "ES", Date.parse("2026-12-02T00:00:00Z"))).toBeNull();
  });
  it("does not invent weekly deltas without a comparable prior report", () => {
    const only = parseCotTff([makeRow()], "ES", NOW);
    expect(only?.previousReportDate).toBeNull();
    expect(only?.openInterestChange).toBeNull();
    expect(only?.categories.every(r => r.weeklyNetChange === null)).toBe(true);
    const far = parseCotTff([makeRow(), makeRow("ES", "2026-09-01")], "ES", NOW);
    expect(far?.categories.every(r => r.weeklyNetChange === null)).toBe(true);
  });
  it("returns unavailable for a denied, huge, or malformed upstream response", async () => {
    const previous = globalThis.fetch;
    try {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
        .mockResolvedValueOnce(new Response("[]", { status: 200, headers: { "content-length": "999999" } }))
        .mockResolvedValueOnce(new Response("{invalid json", { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify([makeRow("ES")]), { status: 200 })));
      expect(await readCotTff("ES", NOW)).toBeNull();
      expect(await readCotTff("ES", NOW)).toBeNull();
      expect(await readCotTff("ES", NOW)).toBeNull();
      expect((await readCotTff("ES", NOW))?.reportDate).toBe("2026-10-13");
    } finally { vi.stubGlobal("fetch", previous); vi.unstubAllGlobals(); }
  });
});
