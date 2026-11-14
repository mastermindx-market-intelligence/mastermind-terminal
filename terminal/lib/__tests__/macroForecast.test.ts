import { describe, expect, it } from "vitest";
import { forecastContextAligned, forecastErrorDisplayable, forecastInterval, forecastIsOlder, forecastShadowDisplayable, primaryForecast, qualifiedForecast, releaseIdentity, releaseSelection } from "@/lib/shared-shell/macroForecast";
import { macroBookmarkDestination, macroDetailFromHash, macroRecord } from "@/lib/shared-shell/macroDashboard";
import { macroForecastFixture } from "./fixtures/macroForecast";

describe("source-qualified native Release Radar", () => {
 it("keeps historical publication age and no-authority binding separate", () => {
  const source = macroForecastFixture();
  expect(qualifiedForecast(source, "a".repeat(64))).toBe(true);
  expect(qualifiedForecast({ ...source, authority: { ...source.authority, can_trade: true } }, "a".repeat(64))).toBe(false);
  expect(qualifiedForecast(source, null)).toBe(false);
  expect(forecastIsOlder(source, new Date("2026-11-14T10:00:00Z"))).toBe(true);
 });
 it("binds blend point and intervals to their own basis without median or champion fallback", () => {
  const row = macroRecord(macroForecastFixture().upcoming[0]);
  expect(primaryForecast(row).point).toBe(.2);
  expect(primaryForecast({ ...row, combined: { ...macroRecord(row.combined), combined_point: null } }).point).toBeNull();
  expect(primaryForecast({ ...row, combined: { ...macroRecord(row.combined), authority: true } }).point).toBeNull();
  expect(primaryForecast(macroForecastFixture().upcoming[1]).point).toBeNull();
  expect(forecastContextAligned(row)).toBe(false);
  expect(forecastContextAligned({ ...row, context_metrics_basis: row.primary_forecast_basis })).toBe(true);
 });
 it("withholds benchmark-only and withdrawn numbers, rejects crossed quantiles", () => {
  const source = macroForecastFixture(), row = source.upcoming[0];
  expect(primaryForecast(source.upcoming[2]).benchmarkOnly).toBe(true);
  expect(primaryForecast(source.upcoming[2]).point).toBeNull();
  expect(forecastInterval({ point: 0, p10: -.1, p25: 0, p50: .1, p75: .2, p90: .3 })).toEqual([-.1, 0, .1, .2, .3]);
  expect(forecastInterval({ p10: 0, p25: .5, p50: .1, p75: .2, p90: .3 })).toBeNull();
  expect(forecastInterval({ p10: 0, p25: .1, p50: .2, p75: .3, p90: .4, claim_withdrawn: {} })).toBeNull();
  expect(forecastShadowDisplayable({ display_only: true, point: 777, claim_withdrawn: true }, "v3_factor", row)).toBe(false);
 });
 it("requires aligned first-print scores, the source threshold and an interval before showing error", () => {
  const track = { display_min_n: 12 }, row = { display_state: "display_only", clean_n: 12, first_print_matched_n: 12, target_epochs: ["first-print"], mae_ours: .1, mae_ours_ci: [.05, .2] };
  expect(forecastErrorDisplayable(row, track)).toBe(true);
  for (const delta of [{ first_print_matched_n: 11 }, { clean_n: 2 }, { target_epochs: ["a", "b"] }, { mae_ours_ci: null }, { benchmark_only: true }, { display_state: "proxy_or_mixed_target" }]) expect(forecastErrorDisplayable({ ...row, ...delta }, track)).toBe(false);
 });
 it("preserves exact release identity and existing bookmarked destinations", () => {
  const rows = macroForecastFixture().upcoming;
  expect(releaseIdentity(rows[0])).not.toBe(releaseIdentity(rows[1]));
  expect(releaseSelection("#releases?date=2026-11-19&target=claims")).toEqual({ date: "2026-11-19", target: "claims" });
  expect(macroDetailFromHash("#releases?date=2026-11-19")).toBe("releases");
  expect(macroDetailFromHash("#dlg-evidence")).toBe("factors");
  expect(macroBookmarkDestination("#holdings")).toBe("/us_stocks.html#holdings");
  expect(macroBookmarkDestination("#https://other.example")).toBeNull();
 });
});
