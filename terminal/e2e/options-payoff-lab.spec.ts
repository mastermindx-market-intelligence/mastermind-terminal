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

    const workspace = page.locator('[data-options-ia="seven-category-stage-a"]');
    const lab = page.getByTestId("payoff-lab");
    await expect(workspace).toBeVisible();
    await expect(workspace).toHaveAttribute("data-options-ia-version", "eight-category-plan-stage");
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

  test("distinct sub-tick break-evens stay visible and scenario-faithful in EN and ZH", async ({ page }) => {
    await preseedLanguage(page, "en");
    await page.goto("/options?tab=payoff");
    const lab = page.getByTestId("payoff-lab");
    await expect(lab).toBeVisible();

    await page.getByLabel("Premium 1").fill("0");
    await page.getByLabel("Qty 1").fill("2000");
    await page.getByLabel("Side 2").selectOption("long");
    await page.getByLabel("Type 2").selectOption("P");
    await page.getByLabel("Strike 2").fill("100");
    await page.getByLabel("Premium 2").fill("0");
    await page.getByLabel("Qty 2").fill("2000");
    await page.getByRole("button", { name: "Add leg" }).click();
    await page.getByLabel("Strike 3").fill("200");
    await page.getByLabel("Premium 3").fill("0.05");
    await page.getByLabel("Qty 3").fill("1");

    const breakEven = page.getByTestId("payoff-break-even-value");
    await expect(breakEven).toHaveText("$99.999975 · $100.000025");
    await expect(breakEven).toBeVisible();
    const breakEvenStyle = await breakEven.evaluate((node) => ({
      whiteSpace: getComputedStyle(node).whiteSpace,
      overflow: getComputedStyle(node).overflow,
      textOverflow: getComputedStyle(node).textOverflow,
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
    }));
    expect(breakEvenStyle.whiteSpace).not.toBe("nowrap");
    expect(breakEvenStyle.overflow).not.toBe("hidden");
    expect(breakEvenStyle.textOverflow).not.toBe("ellipsis");

    const markers = lab.locator("[data-break-even-root]");
    await expect(markers).toHaveCount(2);
    expect(await markers.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-break-even-root")))).toEqual([
      "99.999975",
      "100.000025",
    ]);
    expect(await markers.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")))).toEqual([
      "Break-even $99.999975",
      "Break-even $100.000025",
    ]);

    const scenario = page.locator("#payoff-scenario-price");
    await scenario.fill("99.999975");
    await expect(page.getByTestId("payoff-scenario-result")).toContainText("$0.00");
    await scenario.fill("100");
    await expect(page.getByTestId("payoff-scenario-result")).toContainText("−$5.00");
    await scenario.fill("100.000025");
    await expect(page.getByTestId("payoff-scenario-result")).toContainText("$0.00");

    await page.evaluate(() => {
      localStorage.setItem("mm.lang", "zh");
      document.documentElement.setAttribute("data-lang", "zh");
      window.dispatchEvent(new CustomEvent("mm:lang"));
    });
    await expect(page.locator("html")).toHaveAttribute("data-lang", "zh");
    await expect(breakEven).toHaveText("$99.999975 · $100.000025");
    expect(await markers.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")))).toEqual([
      "盈亏平衡 $99.999975",
      "盈亏平衡 $100.000025",
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });

});
