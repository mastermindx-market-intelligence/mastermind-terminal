import { describe, expect, it } from "vitest";
import { boatsChartCoverage, boatsChartHistoryBars } from "../extQuoteCopy";
const evidence = { schema: "terminal.tiingo_boats_history_evidence.v1", status: "available", source: "tiingo-boats-rest", venue: "BOATS", complete: false, volume_basis: "vendor_reported_shares", returned_bars: 25 };
describe("overnight history coverage copy", () => {
 it("requires accepted available source evidence", () => {
  expect(boatsChartHistoryBars(evidence)).toBe(25);
  for (const changed of [{status:"missing"}, {complete:true}, {returned_bars:-1}, {returned_bars:20001}, {returned_bars:1.5}, {volume_basis:"unknown"}, {source:"quotes"}]) expect(boatsChartHistoryBars({...evidence,...changed})).toBe(0);
  expect(boatsChartHistoryBars(null)).toBe(0);
 });
 it("never carries coverage across a symbol or timeframe change", () => {
  const history = {symbol:"AMD",timeframe:"5m",bars:25};
  expect(boatsChartCoverage("en","AMD","5m",history)).toContain("Captured history available");
  expect(boatsChartCoverage("zh","AMD","5m",history)).toContain("已载入历史K线");
  expect(boatsChartCoverage("en","NVDA","5m",history)).toContain("history and volume unavailable");
  expect(boatsChartCoverage("en","AMD","1h",history)).toContain("history and volume unavailable");
 });
});
