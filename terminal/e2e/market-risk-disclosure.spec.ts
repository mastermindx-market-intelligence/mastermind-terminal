import { expect, test } from "@playwright/test";
import { MARKET_RISK_NOW, marketRiskSourceFixture, riskEnvelopeFixture } from "../lib/__tests__/marketRiskFixture";

// Existing fixture server + actual Terminal component. Synthetic presentation,
// not authenticated production delivery or a forecast/policy test.
test.setTimeout(90_000);
for (const [lang, theme] of [["en", "light"], ["zh", "dark"]] as const) {
  test(`market risk remains visible across source changes / ${lang} / ${theme}`, async ({ page }, testInfo) => {
    await page.addInitScript(({ lang, theme, now }) => {
      localStorage.setItem("mm.lang", lang); localStorage.setItem("theme", theme); localStorage.setItem("theme_auto", "0");
      Date.now = () => now;
    }, { lang, theme, now: MARKET_RISK_NOW });
    let scenario = "healthy";
    const extraSource = "unavailable-source-" + "x".repeat(80);
    await page.route("**/data/market_risk.json", async route => {
      const env = riskEnvelopeFixture();
      const hazard = scenario === "healthy" ? "NONE" : scenario === "stale" ? null : "FRAGILE";
      const risk = scenario === "conflict";
      const stale = scenario === "stale";
      await route.fulfill({ json: {
        ...marketRiskSourceFixture(), schema: "market_risk/v1",
        ...(risk ? { verdict: "RISK_ON", label_en: "Risk on", label_zh: "风险偏好", score: 65, color: "green" } : {}),
        ...(scenario === "invalid" ? { asof: "2026-09-01" } : {}),
        risk_envelope: {
          ...env, data_state: stale ? "DEGRADED" : "PARTIAL",
          hazard_summary: { stage: hazard, unreadable_sources: stale ? ["leadership-crack-latest", extraSource] : [], display_only: true },
          coherence: { state: risk ? "CONTRADICTORY" : "ALIGNED", contradiction_count: risk ? 1 : 0 },
          coverage: { required: ["market-state-latest", "leadership-crack-latest", ...(stale ? [extraSource] : [])],
            optional: ["optional-context"], stale: stale ? ["leadership-crack-latest", extraSource] : [], missing: ["optional-context"] },
          freshness: { source_session: "2026-10-07", per_source: {
            "leadership-crack-latest": { as_of: stale ? "2026-10-06" : "2026-10-07", state: stale ? "STALE" : "FRESH" },
            [extraSource]: { as_of: "2026-10-06", state: "STALE" },
          } },
        },
      } });
    });
    await page.goto("/terminal?symbol=NVDA");
    await page.locator(".sig-btn").click();
    const chip = page.getByTestId("market-risk-chip"), summary = chip.locator("summary");
    await expect(chip).toBeVisible(); await expect(summary).toContainText("51/100");
    await expect(summary).toContainText(lang === "zh" ? "美国市场风险" : "US market risk");
    await expect(summary).not.toContainText(lang === "zh" ? "风险阶段不可用" : "Hazard unavailable");
    scenario = "damaged";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(summary).toContainText(lang === "zh" ? "风险阶段：脆弱" : "Hazard: Fragile");
    await expect(summary).toContainText("51/100");
    expect(await chip.evaluate(el => (el as HTMLDetailsElement).open)).toBe(false);
    await chip.screenshot({ path: testInfo.outputPath(`risk-fragile-${testInfo.project.name}-${lang}-${theme}.png`) });
    scenario = "stale";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(summary).toContainText(lang === "zh" ? "风险阶段不可用" : "Hazard unavailable");
    await summary.focus(); await page.keyboard.press("Enter");
    await expect(chip.locator('[data-testid="market-risk-details"]')).toBeVisible();
    await expect(chip).toContainText("leadership-crack-latest"); await expect(chip).toContainText("2026-10-06");
    expect(await chip.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await chip.screenshot({ path: testInfo.outputPath(`risk-stale-required-${testInfo.project.name}-${lang}-${theme}.png`) });
    await summary.click();
    scenario = "conflict";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(summary).toContainText("65/100");
    await expect(summary).toContainText(lang === "zh" ? "信号存在分歧" : "Conflicting signals");
    await expect(summary).toContainText(lang === "zh" ? "风险阶段：脆弱" : "Hazard: Fragile");
    expect(await chip.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await chip.screenshot({ path: testInfo.outputPath(`risk-conflict-${testInfo.project.name}-${lang}-${theme}.png`) });
    scenario = "invalid";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(summary).toContainText(lang === "zh" ? "市场风险不可用" : "Market risk unavailable");
    await expect(summary).not.toContainText("/100");
    await expect(summary).not.toContainText(lang === "zh" ? "风险阶段：脆弱" : "Hazard: Fragile");
  });
}
