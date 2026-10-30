import { expect, test } from "@playwright/test";

// Source fixtures intentionally separate the source report date from the wall clock.
// This checks displayed semantics only, without provider, auth or Save evidence.
for (const lang of ["en", "zh"] as const) {
  for (const asof of ["2026-10-22T20:00:00Z", "unavailable"] as const) {
    test(`DOI report date stays source bound ${lang} ${asof}`, async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-10-24T12:00:00Z"));
      await page.addInitScript(l => localStorage.setItem("mm.lang", l), lang);
      await page.route(/\/api\/flow\?f=oi$/, route => route.fulfill({ json: {
        schema: "options_hub.oi_movers/v1", asof,
        movers: [{ root: "SPY", right: "P", exp: "2026-10-30", strike: 760, oi: 42, oi_prev: 20, d_oi: 22, mid: 5.47 }],
      } }));
      await page.goto("/options?tab=screener");
      await page.getByRole("button", { name: lang === "en" ? "ΔOI Builds" : "持仓增长", exact: true }).click();
      const card = page.locator(".obs-card").filter({ has: page.getByText(lang === "en" ? "Open interest builds" : "未平仓增加", { exact: true }) });
      await expect(card.locator("tbody")).toContainText("SPY");
      const label = asof === "unavailable"
        ? (lang === "en" ? "Report date unavailable" : "报告日期不可用")
        : (lang === "en" ? "Report dated 2026-10-22" : "报告日期 2026-10-22");
      await expect(card).toContainText(label);
      await expect(card.getByRole("columnheader", { name: lang === "en" ? "Reported open interest" : "报告未平仓量" })).toBeVisible();
      await expect(card).toContainText(lang === "en" ? "prior trading close" : "前一交易日收盘持仓");
      await expect(card).not.toContainText(/2026-10-24|yesterday|previous session|昨日未平仓|截至上一交易日/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    });
  }
}
