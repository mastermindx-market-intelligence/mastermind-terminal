import { expect, test } from "@playwright/test";
import { MARKET_RISK_NOW, marketRiskSourceFixture, riskEnvelopeFixture } from "../lib/__tests__/marketRiskFixture";

// This is a synthetic transport/visual contract, NOT authenticated production,
// independently verified source history, dealer pressure, or trade authority.
test.setTimeout(90_000);

const firstSession = "2026-10-01";
const lastSession = "2026-10-07";
const digest = "a".repeat(64);
const limits = [
  "not_intraday", "not_native_foreign_market_returns", "not_observed_fund_flows",
  "not_point_in_time_backtest_evidence", "funds_may_overlap",
  "cash_is_separate_from_short_duration_funds", "not_an_allocation_recommendation",
];

function asset(instrument_id: string, label_en: string, label_zh: string, totalReturn: number) {
  const bench = -0.05;
  const benchmark = instrument_id === "SPY";
  const relative = (1 + totalReturn) / (1 + bench) - 1;
  return {
    instrument_id, label_en, label_zh, asset_class: "equity",
    exposure_region: instrument_id === "SPY" ? "US" : "EM",
    listing_market: "US", currency: "USD", return_basis: "total_return",
    start_session: firstSession, end_session: lastSession,
    last_source_session: lastSession, status: "OBSERVED", reasons: [],
    absolute_return: totalReturn,
    relative_return: benchmark ? null : relative,
    classification: benchmark ? null : relative > 0
      ? totalReturn > 0 ? "POSITIVE_AND_OUTPERFORMING" : "RELATIVE_RESILIENCE_ONLY"
      : relative < 0 ? "UNDERPERFORMING" : "IN_LINE",
    source_ref: `data/yahoo/${instrument_id}.parquet`,
    source_digest: digest, evidence_family_id: "yahoo_daily_adjusted_prices",
    ...(benchmark ? {} : { comparison_status: "OBSERVED" }),
  };
}
function multiAssetFixture() {
  return {
    schema: "mastermind.multi_asset_daily_context/v1",
    method_version: "same_us_cash_session_snapshot.v1",
    captured_at: "2026-10-07T21:00:00Z",
    alignment_basis: "US_CASH_SESSION_LABEL_NOT_QUOTE_TIMESTAMP",
    window: {
      start_session: firstSession, end_session: lastSession,
      expected_session: lastSession, horizon_sessions: 4,
      calendar_owner: "lib.nyse_calendar", listing_timezone: "America/New_York",
    },
    status: "AVAILABLE", reasons: [] as string[],
    benchmark_instrument_id: "SPY", benchmark_return: -0.05,
    base_currency: "USD",
    rows: [
      asset("SPY", "US equity benchmark", "美国股票基准", -0.05),
      asset("EEM", "Emerging-market equities", "新兴市场股票", -0.02),
      asset("EFA", "Developed ex-US equities", "美国以外发达市场股票", 0.01),
    ],
    coverage: { requested: 3, observed: 3, comparable: 2, invalid_sources: 0 },
    source_kind: "captured_mutable_daily_cache", provider_available_at: null,
    historical_original_availability_proven: false,
    capture_coherence: "individually_hashed_not_atomic_bundle",
    display_only: true, no_predictive_claim: true,
    authority: { can_rank: false, can_gate: false, can_size: false, can_trade: false },
    limitations: limits.slice(), context_digest: digest,
  };
}
for (const [lang, theme] of [["en", "light"], ["zh", "dark"]] as const) {
  test(`optional cross-asset source respects original risk and degraded semantics / ${lang} / ${theme}`,
    async ({ page }, testInfo) => {
      await page.addInitScript(({ lang, theme, now }) => {
        localStorage.setItem("mm.lang", lang);
        localStorage.setItem("theme", theme);
        localStorage.setItem("theme_auto", "0");
        Date.now = () => now;
        const flag = window as Window & { __mmResponsiveVisualReady?: boolean };
        flag.__mmResponsiveVisualReady = false;
        window.addEventListener("mm:terminal-visual-ready",
          () => { flag.__mmResponsiveVisualReady = true; }, { once: true });
      }, { lang, theme, now: MARKET_RISK_NOW });
      let mode: "qualified" | "stale" | "unauthorized" = "qualified";
      await page.route("**/data/market_risk.json", route => {
        const multi = multiAssetFixture();
        if (mode === "stale") {
          multi.window.end_session = "2026-10-06";
          multi.status = "STALE";
          multi.reasons = ["older_than_expected_session"];
          for (const r of multi.rows) {
            r.end_session = "2026-10-06";
            r.last_source_session = "2026-10-06";
          }
        } else if (mode === "unauthorized") {
          multi.authority.can_trade = true;
        }
        return route.fulfill({ json: {
          ...marketRiskSourceFixture(), schema: "market_risk/v1",
          risk_envelope: { ...riskEnvelopeFixture(), multi_asset_context: multi },
        } });
      });
      await page.goto("/terminal?symbol=NVDA");
      await expect.poll(() => page.evaluate(() =>
        Boolean((window as Window & { __mmResponsiveVisualReady?: boolean }).__mmResponsiveVisualReady)),
        { timeout: 20_000, message: "the genuine Terminal launcher should hydrate" }).toBe(true);
      const launcher = page.getByTestId("intelligence-launcher");
      await expect(async () => {
        if (await launcher.getAttribute("aria-expanded") !== "true") await launcher.click();
        await expect(launcher).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
      const chip = page.getByTestId("market-risk-chip");
      const summary = chip.locator("summary");
      await expect(summary).toContainText("51/100");
      await summary.focus();
      await page.keyboard.press("Enter");
      const details = chip.getByTestId("market-risk-details");
      await expect(details).toBeVisible();
      const em = lang === "zh" ? "新兴市场股票（EEM）" : "Emerging-market equities (EEM)";
      await expect(details).toContainText(em);
      await expect(details).toContainText(lang === "zh" ? "绝对收益未上涨" : "not an absolute gain");
      await expect(details).toContainText(lang === "zh" ? "不是实时资金流" : "Not live fund flow");
      await expect(details).toContainText(lang === "zh" ? "-2.00%" : "-2.00%");
      await expect(summary).toContainText("51/100");
      await expect(details).not.toContainText(lang === "zh" ? "建议买入" : "should buy");
      expect(await chip.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      await chip.screenshot({ path: testInfo.outputPath(`cross-asset-${testInfo.project.name}-${lang}-${theme}.png`) });

      mode = "stale";
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(details).toContainText(lang === "zh" ? "已过期" : "stale");
      await expect(details).toContainText("2026-10-06");
      await expect(summary).toContainText("51/100");

      mode = "unauthorized";
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(details).not.toContainText(em);
      await expect(summary).toContainText("51/100");
      await expect(details).toContainText(lang === "zh" ? "没有生效的风险政策" : "No risk policy is active");
      await chip.screenshot({ path: testInfo.outputPath(`cross-asset-rejected-${testInfo.project.name}-${lang}-${theme}.png`) });
    });
}
