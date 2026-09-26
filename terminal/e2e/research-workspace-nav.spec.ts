import { expect, test, type Page } from "@playwright/test";

function marketBarsFixture() {
  const bars: [string, number, number, number, number, number][] = [];
  let close = 100;
  for (let year = 2020; year <= 2026; year++) {
    const monthCount = year === 2026 ? 6 : 12;
    for (let month = 1; month <= monthCount; month++) {
      for (const day of [5, 12, 19, 26]) {
        const seasonal = Math.sin((month / 12) * Math.PI * 2) * 0.004;
        const drift = 0.0045 + seasonal + ((year - 2020) * 0.00008);
        const open = close;
        close = close * (1 + drift);
        const high = Math.max(open, close) * 1.012;
        const low = Math.min(open, close) * 0.988;
        const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        bars.push([date, open, high, low, close, 1_000_000 + bars.length * 2_500]);
      }
    }
  }
  return { bars };
}

async function installMarketBars(page: Page) {
  const fixture = marketBarsFixture();
  await page.route("**/data/NVDA.json**", async (route) => route.fulfill({ json: fixture }));
}

/**
 * Research Workspace navigation vNext keeps the existing FinPage URL/deep-link
 * authority while projecting those pages into scalable page families.
 */
test("company page families preserve exact FinPage deep links", async ({ page }) => {
  await page.goto("/analysis?symbol=NVDA&page=statements");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });

  const compact = page.viewportSize()!.width <= 860;
  if (compact) {
    const familyTrigger = page.locator(".fin-family-mobile-trigger");
    await expect(familyTrigger).toContainText("Financials");
    await expect(page.locator(".fin-local-mobile-tab.on")).toHaveText("Statements");
    await page.locator(".fin-local-mobile-tab", { hasText: "Revenue" }).click();
  } else {
    await expect(page.locator('[data-fin-family="financials"]')).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-fin-local="statements"]')).toHaveAttribute("aria-selected", "true");
    await page.locator('[data-fin-local="revenue"]').click();
  }

  await expect(page).toHaveURL(/[?&]page=revenue\b/);
  await expect.poll(() => page.evaluate(() => new URL(window.location.href).searchParams.has("pane"))).toBe(false);
});

test("family selection lands on the existing family default without a second router", async ({ page }) => {
  await page.goto("/analysis?symbol=NVDA&page=overview");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });

  const compact = page.viewportSize()!.width <= 860;
  if (compact) {
    await page.locator(".fin-family-mobile-trigger").click();
    const sheet = page.locator(".fin-family-sheet");
    await expect(sheet).toBeVisible();
    await sheet.locator('[data-fin-family-sheet="market"]').click();
    await expect(page.locator(".fin-local-mobile-tab.on")).toHaveText("Technicals");
    await page.locator(".fin-local-mobile-tab", { hasText: "Seasonality" }).click();
    await expect(page).toHaveURL(/[?&]page=seasonals\b/);
  } else {
    await page.locator('[data-fin-family="earnings"]').click();
    await expect(page).toHaveURL(/[?&]page=earnings\b/);
    await expect(page.locator('[data-fin-local="earnings"]')).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-fin-local="forecast"]')).toContainText("Analyst");
    await expect(page.locator('[data-fin-local="transcripts"]')).toContainText("Transcripts");
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});


test("Market vNext projects canonical technicals, pivots and five-year seasonality", async ({ page }) => {
  await installMarketBars(page);
  await page.goto("/analysis?symbol=NVDA&page=technicals");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });

  const market = page.locator("[data-market-vnext]");
  await expect(market).toBeVisible({ timeout: 45_000 });

  const state = market.locator("[data-market-vnext-state]");
  await expect(state).toContainText("MARKET TECHNICALS");
  await expect(state).toContainText("Deterministic indicator state");
  await expect(state).toContainText("RSI (14)");
  await expect(state).toContainText("MACD (12, 26, 9)");
  await expect(state).toContainText("vs SMA 20");
  await expect(state).toContainText("vs SMA 50");
  await expect(state).toContainText("vs SMA 200");

  const rating = market.locator("[data-market-vnext-rating]");
  await expect(rating).toContainText("TECHNICAL RATING");
  await expect(rating).toContainText("Oscillators");
  await expect(rating).toContainText("Moving Averages");
  await expect(rating).toContainText("not a trade signal");

  const pivots = market.locator("[data-market-vnext-pivots]");
  await expect(pivots).toContainText("PIVOT MAP");
  await expect(pivots).toContainText("R1");
  await expect(pivots).toContainText("S1");
  await expect(pivots).toContainText("Nearest support");
  await expect(pivots).toContainText("Nearest resistance");
  await expect(pivots).toContainText("not forecasts");

  const seasonality = market.locator("[data-market-vnext-seasonality]");
  await expect(seasonality).toContainText("SEASONALITY SNAPSHOT");
  await expect(seasonality).toContainText("5 completed yearly observations");
  await expect(seasonality).toContainText("Jan");
  await expect(seasonality).toContainText("Dec");
  await expect(seasonality).toContainText("Historical recurrence only");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Market vNext remains bilingual and overflow-safe on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one mobile bilingual Market contract is sufficient");
  await page.addInitScript(() => window.localStorage.setItem("mm.lang", "zh"));
  await installMarketBars(page);
  await page.goto("/analysis?symbol=NVDA&page=technicals");

  const market = page.locator("[data-market-vnext]");
  await expect(market).toBeVisible({ timeout: 45_000 });
  await expect(market).toContainText("市场技术面");
  await expect(market).toContainText("技术评级");
  await expect(market).toContainText("枢轴图");
  await expect(market).toContainText("季节性快照");
  await expect(market).toContainText("5 个完整年度观测");
  await expect(market).toContainText("并非交易信号");
  await expect(market).toContainText("而非预测");
  await expect(market).toContainText("小样本不能预测下一步走势");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Ownership family defaults to Institutional and preserves Insider as its sibling", async ({ page }) => {
  await page.route("**/api/company-intelligence/NVDA**", async (route) => {
    await route.fulfill({
      status: 404,
      json: {
        ok: false,
        state: "error",
        error: { code: "not_found", message: "Company context not covered in navigation fixture", retryable: false },
      },
    });
  });
  await page.goto("/analysis?symbol=NVDA&page=overview");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });

  const compact = page.viewportSize()!.width <= 860;
  if (compact) {
    await page.locator(".fin-family-mobile-trigger").click();
    const sheet = page.locator(".fin-family-sheet");
    await expect(sheet).toBeVisible();
    await sheet.locator('[data-fin-family-sheet="ownership"]').click();
    await expect(page).toHaveURL(/[?&]page=ownership\b/);
    await expect(page.locator(".fin-family-mobile-trigger")).toContainText("Ownership");
    await expect(page.locator(".fin-local-mobile-tab.on")).toHaveText("Institutional");
    await expect(page.locator(".fin-local-mobile-tab", { hasText: "Insider" })).toBeVisible();
    await page.locator(".fin-local-mobile-tab", { hasText: "Insider" }).click();
  } else {
    await page.locator('[data-fin-family="ownership"]').click();
    await expect(page).toHaveURL(/[?&]page=ownership\b/);
    await expect(page.locator('[data-fin-family="ownership"]')).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-fin-local="ownership"]')).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('[data-fin-local="ownership"]')).toContainText("Institutional");
    await expect(page.locator('[data-fin-local="insider"]')).toContainText("Insider");
    await page.locator('[data-fin-local="insider"]').click();
  }

  await expect(page).toHaveURL(/[?&]page=insider\b/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});


test("Market summary keeps seasonality ahead of deep indicator tables", async ({ page }) => {
  await installMarketBars(page);
  await page.goto("/analysis?symbol=NVDA&page=technicals");
  const market = page.locator("[data-market-vnext]");
  const seasonality = market.locator("[data-market-vnext-seasonality]");
  await expect(seasonality).toContainText("5 completed yearly observations", { timeout: 45_000 });
  const summaryBox = await seasonality.boundingBox();
  const detailsBox = await market.locator(":scope > .fin-grid2").boundingBox();
  expect(summaryBox).not.toBeNull();
  expect(detailsBox).not.toBeNull();
  // The overview must be discoverable before scrolling through the full metric tables.
  expect(summaryBox!.y).toBeLessThan(page.viewportSize()!.height - 72);
  expect(summaryBox!.y + summaryBox!.height).toBeLessThanOrEqual(detailsBox!.y);
  if (page.viewportSize()!.width <= 760) {
    const pivotsBox = await market.locator("[data-market-vnext-pivots]").boundingBox();
    expect(pivotsBox!.y).toBeGreaterThanOrEqual(summaryBox!.y + summaryBox!.height);
  }
});
