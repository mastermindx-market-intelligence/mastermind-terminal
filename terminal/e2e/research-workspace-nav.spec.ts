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


test("Overview vNext keeps snapshot, ownership, capital and valuation in one research canvas", async ({ page }) => {
  await page.goto("/analysis?symbol=NVDA&page=overview");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });

  const overview = page.locator("[data-overview-vnext]");
  await expect(overview).toBeVisible({ timeout: 15_000 });
  await expect(overview.locator("[data-overview-vnext-snapshot]")).toContainText("COMPANY SNAPSHOT");
  await expect(overview.locator("[data-overview-vnext-snapshot]")).toContainText("Key facts");
  await expect(overview.locator("[data-overview-vnext-snapshot]")).toContainText("Market cap");
  await expect(overview.locator("[data-overview-vnext-snapshot]")).toContainText("P/E ratio");
  await expect(overview.locator("[data-overview-vnext-snapshot]")).toContainText("Basic EPS");
  await expect(overview.locator("[data-overview-vnext-mid]")).toContainText("Ownership");
  await expect(overview.locator("[data-overview-vnext-mid]")).toContainText("Capital structure");

  const valuation = overview.locator("[data-overview-vnext-valuation]");
  await expect(valuation).toContainText("Valuation");
  await expect(valuation).toContainText("CURRENT");
  await expect(valuation).toContainText("P/E TTM");
  await expect(valuation).toContainText("Historical P/E");
  await expect(valuation).toContainText("Revenue-relative context");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("Overview vNext remains bilingual and overflow-safe on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one mobile bilingual Overview contract is sufficient");
  await page.addInitScript(() => window.localStorage.setItem("mm.lang", "zh"));
  await page.goto("/analysis?symbol=NVDA&page=overview");

  const overview = page.locator("[data-overview-vnext]");
  await expect(overview).toBeVisible({ timeout: 45_000 });
  await expect(overview).toContainText("公司快照");
  await expect(overview).toContainText("关键数据");
  await expect(overview).toContainText("股权结构");
  await expect(overview).toContainText("资本结构");
  await expect(overview).toContainText("估值");
  await expect(overview).toContainText("当前");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
