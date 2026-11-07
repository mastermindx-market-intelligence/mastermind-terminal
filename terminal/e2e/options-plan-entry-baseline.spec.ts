import { expect, test } from "@playwright/test";
import { response } from "../lib/__tests__/fixtures/optionsPlanPayoff";
import type { PlanExpiryRequest } from "../lib/optionsPlanPayoff";

// Synthetic owner responses only. No provider request, authentication or persistence.
// The incumbent Plan host is dark-only. Light art direction remains unqualified.
for (const lang of ["en", "zh"] as const) {
  const theme = "dark";
  test(`Plan entry baseline stays source-bound ${lang}/${theme}`, async ({ page }, info) => {
    let calls = 0;
    await page.route("**/api/options/plan/expiry", async route => {
      const request = route.request().postDataJSON() as PlanExpiryRequest;
      calls++;
      if (calls > 2) {
        await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ status: "UNAVAILABLE" }) });
        return;
      }
      expect(request.draft.legs[0].assumptions.entry?.premium_per_unit).toBe(calls === 1 ? 2 : 4);
      const body = response(request);
      if (calls === 2) {
        body.curve = { ...body.curve, cost: 400, max_loss: -400, breakevens: [769], pnl: request.spots.map(s => Math.max(s - 765, 0) * 100 - 400) };
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.goto(`/dev/options-plan?lang=${lang}`);
    await page.evaluate(value => document.documentElement.setAttribute("data-theme", value), theme);
    // Assert rendered material rather than mistaking a data attribute for theme coverage.
    const panel = page.getByTestId("options-plan-payoff-panel");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(10, 11, 14)");
    const calculate = panel.getByRole("button", { name: lang === "en" ? "Calculate expiry payoff" : "计算到期损益", exact: true });
    const keep = panel.getByRole("button", { name: lang === "en" ? "Keep as entry baseline" : "设为入场基准", exact: true });
    const clear = panel.getByRole("button", { name: lang === "en" ? "Clear baseline" : "清除基准", exact: true });
    await expect(clear).toHaveCount(0);
    await calculate.click();
    await keep.click();
    expect(calls).toBe(1);
    const entry = panel.getByLabel(lang === "en" ? "Your entry assumption — premium per unit" : "假设入场价——每单位权利金", { exact: true });
    await entry.fill("4");
    await expect(panel.locator('svg[role="img"]')).toHaveCount(0);
    await calculate.click();
    await expect(keep).toBeVisible();
    for (const details of await panel.locator("details").all()) {
      if (await details.getAttribute("open") === null) await details.locator(":scope > summary").click();
    }
    await expect(clear).toBeVisible();
    await expect(panel).toContainText("$200.00");
    await expect(panel).toContainText("$400.00");
    await expect(panel).toContainText(lang === "en" ? "No pre-expiry valuation is admitted" : "到期");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`entry-baseline-${lang}-${theme}-${info.project.name}.png`), fullPage: true });
    await entry.fill("5");
    await calculate.click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(clear).toHaveCount(0);
    await expect(panel.locator('svg[role="img"]')).toHaveCount(0);
    expect(calls).toBe(3);
  });
}
