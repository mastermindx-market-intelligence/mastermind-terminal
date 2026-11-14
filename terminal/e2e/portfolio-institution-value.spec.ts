import { expect, test } from "@playwright/test";
import { isolateWatchlistStore } from "./watchlistStore";
import { inspectRecord } from "./portfolioWorkspaceHelpers";

test("a broker-reported total survives missing unit prices in the overview, holdings and record", async ({ page, baseURL }, info) => {
  await isolateWatchlistStore(page, info, baseURL);
  const bookKey = "a".repeat(64);
  const position = {
    id: "broker:example", ticker: "OPT", shares: 1, entryPrice: null, entryCurrency: null,
    entryDate: null, notes: null, status: "open", createdAt: null,
    brokerage: { account: "Retirement plan", name: "Example contract", type: "derivative", symbol: "OPT",
      value: 2000, price: null, costBasis: 1750, currency: "USD", asOf: "2026-01-12", syncedAt: "2026-01-13T06:30:00Z" },
  };
  await page.route("**/api/portfolio?view=positions", route => route.fulfill({ json: { bookKey, positions: [position] } }));
  await page.goto("/portfolio");
  await expect(page.locator("#portfolio-panel-overview")).toContainText("USD 2,000.00");
  const detail = await inspectRecord(page, "OPT");
  await expect(detail).toContainText("USD 2,000.00");
  await expect(detail).toContainText("USD 1,750.00");
  await expect(detail).toContainText("2026-01-12");
  await expect(detail.getByRole("button", { name: "Edit OPT" })).toHaveCount(0);
  await detail.getByRole("button", { name: "Close details" }).click();
  await page.getByRole("searchbox").last().fill("Retirement plan");
  const row = page.getByTestId("portfolio-open").locator("tr[data-ticker='OPT']");
  await expect(row).toContainText("USD 2,000.00");
});
