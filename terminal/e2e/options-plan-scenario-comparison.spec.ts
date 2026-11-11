import { expect, test } from "@playwright/test";
import { response } from "../lib/__tests__/fixtures/optionsPlanPayoff";
import type { PlanExpiryRequest } from "../lib/optionsPlanPayoff";

for (const lang of ["en", "zh"] as const) {
  test("D08C exact research baseline, compare, clear — " + lang, async ({ page }, info) => {
    let requests = 0;
    await page.route("**/api/options/plan/expiry", async route => {
      requests++;
      const request = route.request().postDataJSON() as PlanExpiryRequest;
      const premium = request.draft.legs[0].assumptions.entry!.premium_per_unit;
      expect(premium).toBe(requests === 1 ? 2 : 4);
      expect(request.draft.legs[0].snapshot.row.mid).toBe(3);
      const result = response(request);
      result.curve.pnl = request.spots.map(spot => Math.max(spot - 765, 0) * 100 - premium * 100);
      result.curve.cost = premium * 100;
      result.curve.max_loss = -premium * 100;
      result.curve.breakevens = [765 + premium];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result) });
    });
    await page.goto("/dev/options-plan?lang=" + lang);
    await expect(page.getByTestId("options-plan-payoff-panel")).toBeVisible();
    await page.getByRole("button", { name: lang === "en" ? "Calculate expiry payoff" : "计算到期损益" }).click();
    await expect(page.getByTestId("plan-reference-basis")).toBeVisible();
    await page.getByTestId("plan-pin-baseline").click();
    await expect(page.getByTestId("plan-baseline-pending")).toBeVisible();
    await page.getByLabel(lang === "en" ? "Your entry assumption — premium per unit" : "假设入场价——每单位权利金").fill("4");
    await expect(page.getByTestId("plan-expiry-chart")).toHaveCount(0);
    await page.getByRole("button", { name: lang === "en" ? "Calculate expiry payoff" : "计算到期损益" }).click();
    await expect(page.getByTestId("plan-compare-overlay")).toBeVisible();
    await expect(page.getByTestId("plan-compare-overlay")).toHaveAttribute("data-chart-range", "focus");
    await expect(page.getByTestId("plan-comparison-sample")).toContainText("200.00");
    await page.getByTestId("plan-compare-range").click();
    await expect(page.getByTestId("plan-compare-overlay")).toHaveAttribute("data-chart-range", "full");
    await page.getByTestId("plan-compare-range").click();
    await expect(page.getByTestId("plan-compare-overlay")).toHaveAttribute("data-chart-range", "focus");
    await expect(page.getByTestId("plan-comparison-basis")).toContainText("2026-10-23");
    await expect(page.getByTestId("plan-assumption-diff")).toContainText("4");
    await expect(page.getByTestId("plan-comparison-points").locator("tbody tr")).toHaveCount(101);
    await page.getByTestId("plan-comparison-points").locator("tbody tr").last().scrollIntoViewIfNeeded();
    await expect(page.getByTestId("plan-comparison-points")).toContainText("-200");
    await expect(page.getByText(lang === "en" ? /Pinning does not save/ : /已有研究记录保持不变/)).toBeVisible();
    const baselineBtn = page.getByTestId("plan-pin-baseline");
    const rect = await baselineBtn.boundingBox();
    expect(rect?.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("d08c-compare-" + lang + "-" + info.project.name + ".png"), fullPage: true });
    if (info.project.name === "mobile") {
      await page.setViewportSize({ width: 320, height: 844 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath("d08c-compare-" + lang + "-320.png"), fullPage: true });
    }
    await page.getByTestId("plan-clear-baseline").click();
    await expect(page.getByTestId("plan-compare-overlay")).toHaveCount(0);
    expect(requests).toBe(2);
  });
}
