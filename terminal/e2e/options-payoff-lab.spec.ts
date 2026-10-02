import { expect, test, type Page } from "@playwright/test";

async function preseedLanguage(page: Page, lang: "en" | "zh") {
  await page.addInitScript((value: "en" | "zh") => {
    localStorage.setItem("mm.lang", value);
    document.documentElement?.setAttribute("data-lang", value);
  }, lang);
}

test.describe("Options Payoff Lab", () => {
  test("deep-link opens the real Plan workspace and keeps deterministic expiration math usable", async ({ page }) => {
    await preseedLanguage(page, "en");
    await page.goto("/options?tab=payoff");

    const workspace = page.locator('[data-options-ia="eight-category-plan-stage"]');
    const lab = page.getByTestId("payoff-lab");
    await expect(workspace).toBeVisible();
    await expect(lab).toBeVisible();
    await expect(page).toHaveURL(/(?:\?|&)tab=payoff(?:&|$)/);
    await expect(workspace).toContainText("Plan");
    await expect(workspace).toContainText("Payoff Lab");

    await expect(lab).toContainText("Expiration-only");
    await expect(lab).toContainText("Manual premiums");
    await expect(lab).toContainText("$260");
    await expect(lab).toContainText("$102.6");
    await expect(lab).toContainText("$740");
    await expect(lab.locator('[data-leg]')).toHaveCount(2);
    await expect(page.locator("#payoff-expiration")).toHaveValue("2026-10-16");
    await expect(lab).toContainText("Calendar and diagonal spreads are not modeled");

    await page.locator("#payoff-scenario-price").fill("110");
    await expect(page.getByTestId("payoff-scenario-result")).toContainText("+$740");

    const geometry = await lab.locator('svg[role="img"]').evaluate((svg) => ({
      bad: [...svg.querySelectorAll("path,line,circle,rect,text")].some((node) =>
        [...node.attributes].some((attr) => /NaN|Infinity/.test(attr.value)),
      ),
      width: svg.getBoundingClientRect().width,
    }));
    expect(geometry.bad).toBe(false);
    expect(geometry.width).toBeGreaterThan(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });

  test("Workflow Plan stop opens Payoff Lab, then the native language switch keeps the planner intact", async ({ page }) => {
    await preseedLanguage(page, "en");
    await page.goto("/options?tab=tape");
    const launcher = page.locator('[data-options-workflow-guide="launcher"]');
    await expect(launcher).toBeVisible();
    await launcher.click();

    const plan = page.locator('[data-options-workflow-stage="plan"]');
    await expect(plan).toContainText("Shape the payoff");
    await expect(plan).toContainText("Open Payoff Lab");
    await plan.locator("button").click();

    const lab = page.getByTestId("payoff-lab");
    await expect(lab).toBeVisible();
    await expect(page).toHaveURL(/(?:\?|&)tab=payoff(?:&|$)/);

    await page.evaluate(() => {
      localStorage.setItem("mm.lang", "zh");
      document.documentElement.setAttribute("data-lang", "zh");
      window.dispatchEvent(new CustomEvent("mm:lang"));
    });
    await expect(page.locator("html")).toHaveAttribute("data-lang", "zh");
    await expect(lab).toContainText("到期收益实验室");
    await expect(lab).toContainText("仅到期损益");
    await expect(lab).toContainText("它不是预测、预期收益、概率、交易建议或可执行报价");
    await expect(lab.locator('[data-leg]')).toHaveCount(2);

    if (test.info().project.name === "mobile") {
      const heights = await lab.locator("button,input,select").evaluateAll((nodes) =>
        nodes.filter((node) => getComputedStyle(node).display !== "none").map((node) => node.getBoundingClientRect().height),
      );
      expect(heights.length).toBeGreaterThan(0);
      expect(heights.every((height) => height >= 43.5)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
});
