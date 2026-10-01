import { expect, test } from "@playwright/test";

test("MTF momentum confluence renders the five closed-timeframe series", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("mm.startTf", JSON.stringify("D"));
    localStorage.setItem("mm.inds", JSON.stringify(["mtfconfluence"]));
  });

  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 20_000 });

  await expect.poll(
    async () => (await page.evaluate(() => (window as any).__mmChartSeriesTitles?.() ?? [])) as string[],
    { timeout: 20_000, message: "MTF confluence should construct all five timeframe series" },
  ).toEqual(expect.arrayContaining(["D", "3D", "W", "2W", "1M"]));

  const paneCount = await page.evaluate(() =>
    (window as any).__mmChartAxisOpts?.()?.paneTickMarkDensity?.length ?? 0);
  expect(paneCount).toBeGreaterThan(1);
});
