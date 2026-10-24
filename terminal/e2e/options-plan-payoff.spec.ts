import { expect, test } from "@playwright/test";
import { response } from "../lib/__tests__/fixtures/optionsPlanPayoff";
import type { PlanExpiryRequest } from "../lib/optionsPlanPayoff";

for (const lang of ["en", "zh"] as const) {
  test(`fixture exact Plan edit→curve→invalidated→unavailable ${lang}`, async ({ page }, info) => {
    let calls = 0;
    await page.route("**/api/options/plan/expiry", async route => {
      calls++;
      const request = route.request().postDataJSON() as PlanExpiryRequest;
      expect(request.draft.legs[0].assumptions.entry?.premium_per_unit).toBe(calls === 1 ? 2 : 4);
      expect(request.draft.legs[0].snapshot.row.mid).toBe(3);
      await route.fulfill(calls === 1 ? { status: 200, contentType: "application/json", body: JSON.stringify(response(request)) }
        : { status: 503, contentType: "application/json", body: JSON.stringify({ status: "UNAVAILABLE" }) });
    });
    await page.goto(`/dev/options-plan?lang=${lang}`);
    await page.getByRole("button", { name: lang === "en" ? "Calculate expiry payoff" : "计算到期损益", exact: true }).click();
    await expect(page.getByText(lang === "en" ? "Worst expiry outcome" : "最差到期结果", { exact: true })).toBeVisible();
    await expect(page.getByText(lang === "en" ? "Unbounded gain" : "收益无上限", { exact: true })).toBeVisible();
    await expect(page.locator('svg[role="img"]')).toBeVisible();
    await expect(page.getByTestId("draft-returned")).toHaveText("canonical-draft-returned");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`plan-${lang}-${info.project.name}.png`), fullPage: true });
    await page.getByLabel(lang === "en" ? "Your entry assumption — premium per unit" : "假设入场价——每单位权利金", { exact: true }).fill("4");
    await expect(page.locator('svg[role="img"]')).toHaveCount(0);
    expect(calls).toBe(1);
    await page.getByRole("button", { name: lang === "en" ? "Calculate expiry payoff" : "计算到期损益", exact: true }).click();
    await expect(page.getByTestId("options-plan-payoff-panel").getByRole("alert")).toContainText(lang === "en" ? "Contract terms unavailable" : "合约条款暂不可用");
    await expect(page.getByLabel(lang === "en" ? "Your entry assumption — premium per unit" : "假设入场价——每单位权利金", { exact: true })).toHaveValue("4");
    expect(calls).toBe(2);
    await expect(page.locator('svg[role="img"]')).toHaveCount(0);
  });
}
