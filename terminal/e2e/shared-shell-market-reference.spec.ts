import { expect, test } from "@playwright/test";

test.skip(process.env.MMX_SHARED_SHELL !== "1", "Shared Shell fixture");
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    { name: "mm_e2e_rs30", value: "1", url: baseURL! },
    { name: "mm_e2e_guest", value: "1", url: baseURL! },
  ]);
});

test("a Macro term bookmark opens its native definition, source and related terms", async ({ page }) => {
  await page.goto("/reference.html?q=risk#market-regime");
  await expect(page).toHaveURL(/\/market-reference\?q=risk#market-regime$/);
  const entry = page.locator("article#market-regime");
  await expect(entry.getByRole("heading", { name: "Why it matters" })).toBeVisible();
  await expect(entry.getByRole("link", { name: /AI Briefing/ })).toHaveAttribute("href", "https://www.mastermind-x.com/aibrief.html");
  await entry.getByRole("link", { name: "Market State Score" }).click();
  await expect(page.locator("#market-state-score")).toHaveAttribute("data-open", "true");
  await page.goBack();
  await expect(entry).toHaveAttribute("data-open", "true");
  await page.getByRole("searchbox").fill("unlikely-unmatched-query");
  await expect(page.getByText("No terms match your filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator("article")).toHaveCount(46);
  await page.goto("/market-reference#coverage");
  await expect(page.locator("details#coverage")).toHaveAttribute("open", "");
  await expect(page.locator("iframe")).toHaveCount(0);
});

test.describe("server-rendered reference", () => {
  test.use({ javaScriptEnabled: false });
  test("the deep-linked entry exposes its evidence before hydration", async ({ page }) => {
    await page.goto("/market-reference#market-regime");
    await expect(page.locator("#market-regime").getByRole("heading", { name: "Why it matters" })).toBeVisible();
    await expect(page.locator("#market-state-score").getByRole("heading", { name: "Why it matters" })).toBeHidden();
  });
});
