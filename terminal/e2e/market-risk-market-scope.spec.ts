import { expect, test } from "@playwright/test";
import { MARKET_RISK_NOW, marketRiskSourceFixture, riskEnvelopeFixture } from "../lib/__tests__/marketRiskFixture";

// Existing local fixture server and actual Oracle overlay. No production/auth proof.
test.setTimeout(90_000);
for (const lang of ["en", "zh"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`risk scope follows its source market / ${lang} / ${theme}`, async ({ page }, testInfo) => {
      await page.addInitScript(({ lang, theme, now }) => {
        localStorage.setItem("mm.lang", lang); localStorage.setItem("theme", theme); localStorage.setItem("theme_auto", "0");
        Date.now = () => now;
      }, { lang, theme, now: MARKET_RISK_NOW });
      let market: string | null = "US";
      await page.route("**/data/market_risk.json", route => route.fulfill({ json: {
        ...marketRiskSourceFixture(), schema: "market_risk/v1", risk_envelope: { ...riskEnvelopeFixture(), market },
      } }));
      await page.goto("/terminal?symbol=NVDA");
      // This fixture tests the existing CSS theme root, not saved-preference delivery.
      // Storage alone leaves layout.tsx's server dark attribute unchanged.
      await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.locator(".sig-btn").click();
      const chip = page.getByTestId("market-risk-chip"), summary = chip.locator("summary");
      await expect(chip).toBeVisible();
      await expect(summary).toContainText(lang === "zh" ? "风险阶段：脆弱" : "Hazard: Fragile");
      market = "CN";
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(summary).toContainText("51/100");
      await expect(summary).toContainText(lang === "zh" ? "风险阶段不可用" : "Hazard unavailable");
      await expect(summary).not.toContainText(lang === "zh" ? "脆弱" : "Fragile");
      await summary.focus(); await page.keyboard.press("Enter");
      await expect(chip.getByTestId("market-risk-details")).toBeVisible();
      await expect(chip).toContainText(lang === "zh" ? "不会被视为平静市场" : "does not imply calm conditions");
      expect(await chip.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const themeEvidence = await chip.evaluate(el => ({
        actualTheme: document.documentElement.getAttribute("data-theme"),
        foreground: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor,
      }));
      await testInfo.attach("actual-theme", { body: JSON.stringify(themeEvidence), contentType: "application/json" });
      await chip.screenshot({ path: testInfo.outputPath(`market-scope-${testInfo.project.name}-${lang}-${theme}.png`) });
      market = null;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(summary).toContainText(lang === "zh" ? "风险阶段不可用" : "Hazard unavailable");
      market = "US";
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(summary).toContainText(lang === "zh" ? "风险阶段：脆弱" : "Hazard: Fragile");
      await expect(summary).toContainText("51/100");
    });
  }
}
