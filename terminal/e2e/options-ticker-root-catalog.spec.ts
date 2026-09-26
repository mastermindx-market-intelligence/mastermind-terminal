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

  let staleMsftFetches = 0;
  await page.route(/\/api\/flow\?f=ticker(?:%3A|:)MSFT$/, async (route) => {
    staleMsftFetches += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schema: "live_flow.ticker/v1",
        asof: "2026-07-05T15:41:00Z",
        root: "MSFT",
        group: "Technology",
        group_zh: "科技",
        day: {
          gross: 123_000,
          net_soft: 21_000,
          call_share: 0.6,
          n_events: 1,
          prem_z: 1.2,
          baseline_source: "eod252",
        },
        minutes: [],
        strikes: [],
        expiries: [],
        top_contracts: [],
      }),
    });
  });

  // This case owns the initial click-path fail-closed contract. The separate
  // receipt-race test below owns automatic recovery after the matching artifact
  // arrives. A 204 tells EventSource not to reconnect, so stream recovery cannot
  // race this assertion and make the transient pending state timing-dependent.
  await page.route(/\/api\/flow\/stream\?f=ticker(?:%3A|:)MSFT$/, async (route) => {
    await route.fulfill({ status: 204, body: "" });
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

  // A same-root artifact from the prior receipt is also stale. It must not render
  // plausible MSFT statistics under the catalog's newer current-cycle claim.
  await search.fill("$msft");
  await page.getByRole("button", {
    name: zh ? "打开 MSFT 期权详情" : "Open MSFT ticker drill",
  }).click();
  await expect(empty).toBeVisible();
  await expect(empty).toContainText(
    zh ? "个股详情文件尚未到达" : "per-root drill artifact has not arrived yet",
  );
  expect(staleMsftFetches).toBe(1);

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

test("an open drill fails closed, then recovers when its catalog receipt advances", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one transport-race proof is sufficient");

  await page.clock.install();
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "EventSource");
  });

  const firstReceipt = "2026-07-05T15:41:00Z";
  const advancedReceipt = "2026-07-05T15:42:00Z";
  let catalogReceipt = firstReceipt;
  let tickerReceipt = firstReceipt;
  let tickerGross = 123_000;
  let metaRequests = 0;
  let tickerRequests = 0;

  await page.route(/\/api\/flow\?f=meta$/, async (route) => {
    metaRequests += 1;
    const response = await route.fetch();
    const meta = await response.json() as {
      asof?: string;
      built_at?: string;
      root_catalog?: Array<Record<string, unknown>>;
    };
    const row = meta.root_catalog?.find((entry) => entry.root === "MSFT");
    if (!row) throw new Error("fixture root catalog is missing MSFT");
    row.last_source_success = catalogReceipt;
    row.has_session_data = true;
    row.source_ok_this_cycle = true;
    meta.asof = catalogReceipt;
    meta.built_at = catalogReceipt;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(meta),
    });
  });

  await page.route(/\/api\/flow\?f=ticker(?:%3A|:)MSFT$/, async (route) => {
    tickerRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schema: "live_flow.ticker/v1",
        asof: tickerReceipt,
        root: "MSFT",
        group: "Technology",
        group_zh: "科技",
        day: {
          gross: tickerGross,
          net_soft: 21_000,
          call_share: 0.6,
          n_events: 1,
          prem_z: 1.2,
          baseline_source: "eod252",
        },
        minutes: [],
        strikes: [],
        expiries: [],
        top_contracts: [],
      }),
    });
  });

  await page.goto("/options?tab=tickers");
  await expect(page.locator('[data-options-root-source="catalog"]')).toBeVisible({ timeout: 15_000 });
  const search = page.getByRole("searchbox", { name: "Search covered options tickers" });
  await search.fill("$msft");
  await page.getByRole("button", { name: "Open MSFT ticker drill" }).click();
  await expect(page.getByText("$123K", { exact: true })).toBeVisible();

  // Metadata is published before the replacement ticker artifact. A mounted drill
  // must stop rendering the prior receipt as soon as the catalog advances.
  catalogReceipt = advancedReceipt;
  await page.clock.fastForward(60_100);
  await expect.poll(() => metaRequests).toBeGreaterThanOrEqual(2);
  await page.clock.fastForward(60_100);

  const empty = page.getByTestId("ticker-drill-empty");
  await expect(empty).toContainText("per-root drill artifact has not arrived yet");
  await expect(page.getByText("$123K", { exact: true })).toHaveCount(0);

  // The matching artifact can land after metadata without changing the catalog
  // receipt again. The next existing metadata poll must reuse the canonical
  // ticker fetch path and recover the open drill without a manual re-selection.
  tickerReceipt = advancedReceipt;
  tickerGross = 456_000;
  const metaBeforeRecovery = metaRequests;
  const tickerBeforeRecovery = tickerRequests;
  await page.clock.fastForward(60_100);
  await expect.poll(() => metaRequests).toBeGreaterThan(metaBeforeRecovery);
  await expect.poll(() => tickerRequests).toBeGreaterThan(tickerBeforeRecovery);
  await expect(page.getByText("$456K", { exact: true })).toBeVisible();
  await expect(empty).toHaveCount(0);
});

test("live coverage expands every per-root options selector", async ({ page }) => {
  const selectors = [
    { tab: "gex", datalist: "gex-roots" },
    { tab: "structure", datalist: "structure-roots" },
    { tab: "volatility", datalist: "vol-roots" },
    { tab: "positioning", datalist: "msc-roots" },
  ] as const;

  for (const { tab, datalist } of selectors) {
    await page.goto(`/options?tab=${tab}`);
    await expect(page.locator(`#${datalist}`)).toBeAttached({ timeout: 15_000 });
    await expect(page.locator(`#${datalist} option[value="HYG"]`)).toHaveCount(1);
    // Index roots remain available even though they are not in the intraday catalog.
    await expect(page.locator(`#${datalist} option[value="SPX"]`)).toHaveCount(1);
  }
});
