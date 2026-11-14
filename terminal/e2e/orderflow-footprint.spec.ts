import { expect, test, type Page } from "@playwright/test";
import { browserFuturesFixture } from "./fixtures/futuresPublished";
import { parseFuturesRequest } from "../lib/futuresRequest";

// Synthetic HTTP data exercise the real mounted renderer; this is NOT a CME feed.
async function selectChartType(page: Page, type: "Footprint · ES/NQ" | "Candles") {
  await page.locator(".pophost:has(.chart-type-pop) > button.tbtn").first().click();
  if ((page.viewportSize()?.width ?? 1440) <= 860) {
    const picker = page.getByRole("dialog", { name: "Chart type" });
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: type, exact: true }).click();
  } else {
    await expect(page.locator(".chart-type-pop.show").first()).toBeVisible({ timeout: 8_000 });
    await page.locator(".chart-type-pop .chart-type-row").filter({ hasText: type }).first().click();
  }
}
async function selectTimeframe(page: Page, value: string) {
  await page.locator(".tfbtn-edit").first().click();
  if ((page.viewportSize()?.width ?? 1440) <= 860) {
    const picker = page.getByRole("dialog", { name: "Timeframe" });
    await expect(picker).toBeVisible();
    await picker.locator(".msheet-row").filter({ hasText: new RegExp(`^${value}$`) }).first().click();
  } else {
    await expect(page.locator(".tfgrid.show").first()).toBeVisible();
    await page.locator(".tfgrid.show .it").filter({ hasText: new RegExp(`^${value}$`) }).first().click();
  }
}
test("chart-type selection shows honest coverage boundaries and restores regular candles", async ({ page }) => {
  test.skip(test.info().project.name === "mobile", "Phone uses the Analysis Hub chart picker.");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap").first()).toBeVisible();
  await selectChartType(page, "Footprint · ES/NQ");
  await expect(page.getByTestId("footprint-unavailable")).toBeVisible();
  await expect(page.getByTestId("footprint-unavailable")).toContainText("stock candles cannot provide bid/ask volume");
  await expect(page.getByTestId("futures-chart")).toHaveCount(0);
  await selectChartType(page, "Candles");
  await expect(page.locator(".chart-wrap").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("a captured NQ tape renders bid/ask price cells through the chart-type view", async ({ page }) => {
  test.skip(test.info().project.name === "mobile", "Phone uses the roller interval wheel.");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/futures?*", async route => {
    const request = parseFuturesRequest(new URL(route.request().url()).searchParams);
    if (!request) throw new Error("invalid footprint request");
    await route.fulfill({ json: browserFuturesFixture(request) });
  });
  await page.goto("/terminal?symbol=NQ");
  await expect(page.locator(".chart-wrap").first()).toBeVisible();
  // The app restores its own workspace state after hydration: exercise the live controls.
  await selectChartType(page, "Footprint · ES/NQ");
  await expect(page.getByTestId("footprint-unavailable")).toContainText("1m and 5m");
  await selectTimeframe(page, "1m");
  await expect(page.locator(".pane-tf").first()).toHaveText("1m");
  const footprint = page.getByTestId("terminal-footprint");
  await expect(footprint).toBeVisible({ timeout: 30_000 });
  await expect(footprint).toHaveAttribute("data-pair", "NQ");
  await expect(page.getByTestId("footprint-source-basis")).toContainText("Historical capture");
  expect(await page.getByTestId("footprint-cell").count()).toBeGreaterThan(0);
  await expect(page.getByTestId("futures-volume-profile")).toBeVisible();
  await expect(page.getByTestId("futures-cvd")).toBeVisible();
  expect(errors).toEqual([]);
});

test("phone Analysis Hub exposes Footprint and preserves the honest unsupported-data state", async ({ page }) => {
  test.skip(test.info().project.name !== "mobile", "Phone-specific Chart Type sheet.");
  await page.goto("/terminal?symbol=NVDA");
  const trigger = page.getByTestId("roller-more");
  await expect(trigger).toBeVisible();
  await trigger.click();
  const hub = page.getByRole("dialog", { name: /Analysis hub|分析中心/ });
  await expect(hub).toBeVisible();
  await hub.getByTestId("hub-tile-chartType").click();
  const picker = page.getByRole("dialog", { name: "Chart type" });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: /Footprint · ES\/NQ/ }).click();
  await expect(page.getByTestId("footprint-unavailable")).toBeVisible();
  await expect(page.getByTestId("footprint-unavailable")).toContainText("stock candles cannot provide bid/ask volume");
  const geometry = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.viewport + 1);

  await trigger.click();
  await page.getByRole("dialog", { name: /Analysis hub|分析中心/ }).getByTestId("hub-tile-chartType").click();
  const restored = page.getByRole("dialog", { name: "Chart type" });
  await restored.getByRole("button", { name: /^Candles(?: ✓)?$/ }).click();
  await expect(page.locator(".chart-wrap").first()).toBeVisible();
});
