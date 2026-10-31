import { expect, test } from "@playwright/test";
import { isolateWatchlistStore } from "./watchlistStore";

test.setTimeout(90_000);

for (const lang of ["en", "zh"] as const) {
  test(`Portfolio incomplete summary opens the right review and keeps keyboard focus (${lang})`, async ({ page, baseURL }, testInfo) => {
    await isolateWatchlistStore(page, testInfo, baseURL);
    await page.addInitScript(locale => localStorage.setItem("mm.lang", locale), lang);
    // A real record with an unusable quote currency and missing entry details.
    // Neither absence may be presented as a zero or repaired by navigation.
    const manifest = { symbols: { NVDA: { name: "NVIDIA", zh: "英伟达", last: 180.2, chg: 2.5 } } };
    await page.route("**/data/manifest.json", route => route.fulfill({ json: manifest }));
    await page.route("**/api/quote**", route => route.fulfill({ json: { quotes: manifest.symbols } }));
    await page.route("**/api/portfolio-brief", route => route.fulfill({ status: 403, json: { tier: "free" } }));
    const created = await page.request.post("/api/portfolio", { data: { action: "create", ticker: "NVDA", shares: 10 } });
    expect(created.ok()).toBe(true);
    await page.goto("/portfolio");
    const value = page.getByTestId("portfolio-market-value");
    await expect(value).toHaveAttribute("data-available", "false");
    await expect(value.locator("strong")).toHaveText("—");
    await expect(page.getByTestId("portfolio-day-change").locator("strong")).toHaveText("—");
    await expect(page.getByTestId("portfolio-since-entry").locator("strong")).toHaveText("—");
    await page.screenshot({ path: testInfo.outputPath(`portfolio-incomplete-${lang}.png`), fullPage: false });

    const coverage = value.getByRole("button", { name: lang === "zh" ? "查看覆盖情况" : "Review coverage" });
    await coverage.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#portfolio-tab-holdings")).toBeFocused();
    await expect(page.locator("#portfolio-panel-holdings")).toBeVisible();
    await expect(page.locator("#portfolio-panel-holdings select")).toHaveValue("prices");
    await expect(page.getByTestId("portfolio-open").locator('tr[data-ticker="NVDA"]')).toHaveCount(1);

    await page.locator("#portfolio-tab-overview").click();
    await page.getByTestId("portfolio-since-entry").getByRole("button", { name: lang === "zh" ? "补充入场信息" : "Complete entry details" }).click();
    await expect(page.locator("#portfolio-tab-holdings")).toBeFocused();
    await expect(page.locator("#portfolio-panel-holdings select")).toHaveValue("details");
    await expect(page.getByTestId("portfolio-open").locator('tr[data-ticker="NVDA"]')).toHaveCount(1);
    await page.locator("#portfolio-tab-overview").click();
    await expect(value.locator("strong")).toHaveText("—");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test("Options keeps the tape visible and every market context filter reachable", async ({ page }, testInfo) => {
  await page.goto("/options?tab=tape");
  // The loading skeleton is visible too, but is replaced when the feed arrives.
  // Measure only settled tape rows so readiness cannot pass on a detached placeholder.
  const rows = page.locator('.scr-table table.scr:not([aria-busy="true"]) tbody tr').filter({ has: page.locator("td") });
  await expect(rows.first()).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) < 640) {
    const first = await rows.first().boundingBox();
    expect(first).not.toBeNull();
    expect(first!.y + first!.height).toBeLessThan(page.viewportSize()!.height);
  }
  await page.screenshot({ path: testInfo.outputPath("options-tape-context.png"), fullPage: false });
  const commodity = page.locator(".flow-heat-strip").getByRole("button", { name: /Commodities/ });
  await commodity.focus();
  await page.keyboard.press("Enter");
  await expect(rows.first()).toContainText("GLD");
  const bounds = await commodity.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("Chart readouts remain complete and clear of the price scale", async ({ page }, testInfo) => {
  await page.goto("/terminal?symbol=NVDA");
  const status = page.locator(".chart-wrap .statusline").first();
  await expect(status.locator(".status-ohlc b")).toHaveCount(4);
  const fit = await status.evaluate(line => {
    const lineBox = line.getBoundingClientRect();
    const chartBox = line.closest(".chart-wrap")!.getBoundingClientRect();
    return Array.from(line.querySelectorAll<HTMLElement>(".status-ohlc b,.status-change"))
      .map(element => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.left >= lineBox.left && box.right <= lineBox.right + 1
          && box.right <= chartBox.right - 60;
      });
  });
  expect(fit.length).toBeGreaterThanOrEqual(4);
  expect(fit.every(Boolean)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("chart-readout.png"), fullPage: false });
});
