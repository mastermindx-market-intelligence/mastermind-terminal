import { expect, test } from "@playwright/test";

test("covered ticker catalog keeps quiet roots searchable and honest", async ({ page }, testInfo) => {
  const zh = testInfo.project.name === "tablet";
  if (zh) {
    await page.addInitScript(() => {
      localStorage.setItem("mm.lang", "zh");
    });
  }

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const httpErrors: string[] = [];
  const absentTickerFetches: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
  });
  page.on("request", (request) => {
    if (request.url().includes("f=ticker%3AHYG") || request.url().includes("f=ticker:HYG")) {
      absentTickerFetches.push(request.url());
    }
  });

  let signalSpyRequest!: () => void;
  const spyRequestStarted = new Promise<void>((resolve) => { signalSpyRequest = resolve; });
  await page.route(/\/api\/flow\?f=ticker(?:%3A|:)SPY$/, async (route) => {
    signalSpyRequest();
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.continue();
  });

  await page.goto("/options?tab=tickers");
  const workspace = page.locator('[data-options-ia="seven-category-stage-a"]');
  await expect(workspace).toBeVisible({ timeout: 15_000 });

  const catalogRail = page.locator('[data-options-root-source="catalog"]');
  await expect(catalogRail).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("ticker-coverage-summary")).toContainText(
    zh ? "27 个覆盖 · 23 个活跃" : "27 covered · 23 active",
  );

  const search = page.getByRole("searchbox", {
    name: zh ? "搜索期权覆盖代码" : "Search covered options tickers",
  });

  // A slow prior-root response must never replace the authoritative empty state
  // of the newer HYG selection.
  await search.fill("$spy");
  await page.getByRole("button", {
    name: zh ? "打开 SPY 期权详情" : "Open SPY ticker drill",
  }).click();
  await spyRequestStarted;
  await search.fill("$hyg");

  const hyg = page.getByRole("button", {
    name: zh ? "打开 HYG 期权详情" : "Open HYG ticker drill",
  });
  await expect(hyg).toBeVisible();
  await expect(hyg).toContainText(zh ? "核心" : "CORE");
  await hyg.click();

  const empty = page.getByTestId("ticker-drill-empty");
  await expect(empty).toBeVisible();
  await expect(empty).toContainText(zh ? "HYG 已覆盖" : "HYG is covered");
  await expect(empty).toContainText(
    zh ? "本时段尚未积累达标的期权成交" : "no qualifying options prints have accumulated this session",
  );
  expect(absentTickerFetches).toEqual([]);
  await page.waitForTimeout(850);
  await expect(empty).toBeVisible();
  await expect(empty).toContainText(zh ? "HYG 已覆盖" : "HYG is covered");

  const containment = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    railRight: document.querySelector<HTMLElement>('[data-options-root-source="catalog"]')
      ?.getBoundingClientRect().right ?? Infinity,
  }));
  expect(containment.documentWidth).toBeLessThanOrEqual(containment.viewport + 1);
  expect(containment.railRight).toBeLessThanOrEqual(containment.viewport + 1);

  // Next dev/Turbopack emits one stable, nondiscriminating 404 for an unused
  // grouped dynamic chunk on /options (`components_<hash>._.js`). The rendered
  // journey is complete and no page error follows it. Keep API/document/product
  // failures strict while excluding only that exact harness artifact.
  const ignoredDevChunk = /\/_next\/static\/chunks\/components_[^/]+\._\.js$/;
  const productHttpErrors = httpErrors.filter((entry) => !ignoredDevChunk.test(entry));
  const onlyIgnoredResource404s = productHttpErrors.length === 0
    && httpErrors.length > 0
    && httpErrors.every((entry) => ignoredDevChunk.test(entry));
  const productConsoleErrors = consoleErrors.filter((entry) => !(
    onlyIgnoredResource404s
    && entry === "Failed to load resource: the server responded with a status of 404 (Not Found)"
  ));
  expect({ productConsoleErrors, pageErrors, productHttpErrors }).toEqual({
    productConsoleErrors: [],
    pageErrors: [],
    productHttpErrors: [],
  });

  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-options-ticker-root-catalog.png`),
    fullPage: false,
  });
});
