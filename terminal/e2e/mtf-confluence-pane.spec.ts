import { expect, test, type Page } from "@playwright/test";
import { openIndicatorLibrary } from "./phoneChrome";
const titles = (page: Page) => page.evaluate(() =>
  ((window as any).__mmChartSeriesTitles?.() ?? []) as string[]);

const paneCount = (page: Page) => page.evaluate(() =>
  (window as any).__mmChartAxisOpts?.()?.paneTickMarkDensity?.length ?? 0);

async function expectMtfSeriesOnce(page: Page) {
  await expect.poll(async () => {
    const current = await titles(page);
    return ["D", "3D", "W", "2W", "1M"].map((name) => current.filter((x) => x === name).length);
  }, { timeout: 20_000, message: "MTF confluence should own exactly five non-duplicated series" })
    .toEqual([1, 1, 1, 1, 1]);
}


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

  const count = await paneCount(page);
  expect(count).toBeGreaterThan(1);
  await expectMtfSeriesOnce(page);
});


test("MTF pane survives insert-between and incremental remove/re-add without lifecycle leaks", async ({ page }) => {
  test.slow();
  await page.addInitScript(() => {
    localStorage.setItem("mm.startTf", JSON.stringify("D"));
    localStorage.setItem("mm.inds", JSON.stringify(["mtfconfluence"]));
    localStorage.setItem("mm.mastermindCandles.v1", "1");
  });
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 20_000 });
  await expectMtfSeriesOnce(page);
  const mtfOnlyPanes = await paneCount(page);
  expect(mtfOnlyPanes).toBeGreaterThan(1);

  // MACD-RSI is before MTF, so adding it after load exercises insert-between rebuilding.
  await openIndicatorLibrary(page);
  const library = page.locator(".imodal-library");
  const search = library.getByRole("searchbox");
  await search.fill("MACD-RSI");
  const macd = library.getByRole("switch", { name: "MACD-RSI", exact: true });
  await expect(macd).toBeVisible();
  await macd.click();
  await expect(macd).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => paneCount(page), { timeout: 20_000 }).toBe(mtfOnlyPanes + 1);
  await expectMtfSeriesOnce(page);

  // MTF is now the highest sub-pane. Remove it, then re-add it: the re-add must take the
  // incremental tail-append dispatcher and still create exactly one pane with five owned series.
  await search.fill("MTF Momentum Confluence");
  const mtf = library.getByRole("switch", { name: "MTF Momentum Confluence", exact: true });
  await expect(mtf).toBeVisible();
  await mtf.click();
  await expect(mtf).toHaveAttribute("aria-checked", "false");
  await expect.poll(() => paneCount(page), { timeout: 20_000 }).toBe(mtfOnlyPanes);

  await mtf.click();
  await expect(mtf).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => paneCount(page), { timeout: 20_000 }).toBe(mtfOnlyPanes + 1);
  await expectMtfSeriesOnce(page);
});
