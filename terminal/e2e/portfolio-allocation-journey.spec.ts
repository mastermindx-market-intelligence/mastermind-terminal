import { expect, test } from "@playwright/test";
import { isolateWatchlistStore } from "./watchlistStore";

test("sample allocations give way to the owner's holdings and a sector drilldown", async ({ page, baseURL }, info) => {
  await isolateWatchlistStore(page, info, baseURL);
  const symbols = {
    AAPL: { name: "Apple", last: 200, chg: 1, currency: "USD", gics: "Information Technology", mkt: "us" },
    JPM: { name: "JPMorgan Chase", last: 100, chg: 1, currency: "USD", gics: "Financials", mkt: "us" },
  };
  await page.route("**/data/manifest.json", route => route.fulfill({ json: { symbols } }));
  await page.route("**/api/quote?**", route => route.fulfill({ json: { quotes: symbols } }));
  await page.route("**/api/portfolio/prices?**", route => route.fulfill({ json: { prices: {} } }));
  await page.goto("/portfolio");
  await expect(page.getByTestId("portfolio-sample")).toContainText("Illustrative quantities and prices");
  await page.getByRole("button", { name: "Add position", exact: true }).first().click();
  const form = page.getByRole("dialog").filter({ has: page.locator("input[name=ticker]") });
  await form.locator("[name=ticker]").fill("AAPL");
  await form.locator("[name=shares]").fill("3");
  await expect(form.locator("[name=entryCurrency]")).toHaveValue("");
  await form.getByRole("button", { name: "Use as entry price" }).click();
  await expect(form.locator("[name=entryPrice]")).toHaveValue("200");
  await expect(form.locator("[name=entryCurrency]")).toHaveValue("USD");
  await expect(form.locator("output")).toContainText("USD 600");
  if (process.env.PORTFOLIO_REVIEW_CROP_DIR) await form.screenshot({ path: process.env.PORTFOLIO_REVIEW_CROP_DIR + "/" + info.project.name + "-editor.png" });
  await form.getByRole("button", { name: "Save position", exact: true }).click();
  await expect(form).not.toBeVisible();
  for (const [ticker, shares, entryPrice] of [["JPM", "4", "95"]]) {
    const response = await page.request.post("/api/portfolio", { data: { action: "create", ticker, shares, entryPrice, entryCurrency: "USD" } });
    expect(response.ok()).toBe(true);
  }
  await page.getByRole("button", { name: "Refresh holdings", exact: true }).click();
  await expect(page.getByTestId("portfolio-sample")).toHaveCount(0);
  await expect(page.getByTestId("portfolio-allocation")).toContainText("60.0%");
  await page.locator("#portfolio-tab-risk").click();
  const panel = page.getByTestId("portfolio-market-risk");
  const financials = panel.getByRole("button", { name: /Financials/ });
  await financials.click();
  await expect(financials).toHaveAttribute("aria-pressed", "true");
  await expect(panel.locator('[aria-live="polite"]')).toContainText("JPM");
  await expect(panel.locator('[aria-live="polite"]')).toContainText("40.0%");
  await expect(page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).resolves.toBe(true);
  if (process.env.PORTFOLIO_REVIEW_CROP_DIR) {
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: process.env.PORTFOLIO_REVIEW_CROP_DIR + "/" + info.project.name + "-exposure.png", animations: "disabled" });
  }
});
