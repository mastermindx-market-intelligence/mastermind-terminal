import { expect, test } from "@playwright/test";

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


test("Financials vNext keeps statement summary, explorer and integrity on one canonical page", async ({ page }) => {
  await page.goto("/analysis?symbol=NVDA&page=statements");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });

  const financials = page.locator("[data-financials-vnext]");
  await expect(financials).toBeVisible({ timeout: 15_000 });
  await expect(financials.locator("[data-financials-vnext-head]")).toContainText("FINANCIAL STATEMENTS");
  await expect(financials.locator("[data-financials-vnext-head]")).toContainText("Reported fundamentals with source-aware period handling");
  await expect(financials.locator("[data-financials-vnext-head]").getByRole("button", { name: "Annual" })).toBeVisible();
  await expect(financials.locator("[data-financials-vnext-head]").getByRole("button", { name: "Income" })).toBeVisible();
  await expect(financials.locator("[data-financials-vnext-head]").getByRole("button", { name: "Balance" })).toBeVisible();
  await expect(financials.locator("[data-financials-vnext-head]").getByRole("button", { name: "Cash flow" })).toBeVisible();

  const summary = financials.locator("[data-financials-vnext-summary]");
  await expect(summary).toContainText("Revenue");
  await expect(summary).toContainText("Gross profit");
  await expect(summary).toContainText("Operating income");
  await expect(summary).toContainText("Free cash flow");

  await expect(financials.locator("[data-financials-vnext-explorer]")).toContainText("STATEMENT EXPLORER");
  const integrity = financials.locator("[data-financials-vnext-integrity]");
  await expect(integrity).toContainText("Balance-sheet snapshot");
  await expect(integrity).toContainText("Cash conversion");
  await expect(integrity).toContainText("Source & normalization");
  await expect(integrity).toContainText("Reporting cadence");
  await expect(integrity).toContainText("Normalization");
  await expect(integrity).toContainText("Currency");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Financials vNext remains bilingual and overflow-safe on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one mobile bilingual Financials contract is sufficient");
  await page.addInitScript(() => window.localStorage.setItem("mm.lang", "zh"));
  await page.goto("/analysis?symbol=NVDA&page=statements");

  const financials = page.locator("[data-financials-vnext]");
  await expect(financials).toBeVisible({ timeout: 45_000 });
  await expect(financials).toContainText("财务报表");
  await expect(financials).toContainText("财务摘要");
  await expect(financials).toContainText("营业利润");
  await expect(financials).toContainText("自由现金流");
  await expect(financials).toContainText("报表浏览器");
  await expect(financials).toContainText("资产负债表快照");
  await expect(financials).toContainText("现金转换");
  await expect(financials).toContainText("来源与标准化");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
