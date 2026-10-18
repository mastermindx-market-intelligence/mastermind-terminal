import { expect, test } from "@playwright/test";

/**
 * The standalone Research Workspace uses the same FinPage routing as the chart
 * overlay, but no longer stacks the family and local menus in one row.
 */
test("desktop: company families live beside symbol, views live in the page subheader", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/analysis?symbol=NVDA&page=earnings");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });

  const context = page.locator(".analysis-context-bar");
  await expect(context.getByText("Back to chart")).toHaveCount(0);
  await expect(context.locator('[data-fin-family="earnings"]')).toHaveAttribute("aria-selected", "true");
  await expect(context.locator(".fin-local-tabs")).toHaveCount(0);

  const local = page.locator(".fin-pane--workspace .fin-page-subnav");
  await expect(local).toBeVisible();
  await expect(local.locator(".fin-page-subnav-title")).toHaveText("Earnings");
  await page.screenshot({ path: testInfo.outputPath("analysis-earnings-1440.png") });
  await expect(local.locator('[data-fin-local="earnings"]')).toHaveAttribute("aria-selected", "true");
  await local.locator('[data-fin-local="forecast"]').click();
  await expect(page).toHaveURL(/[?&]page=forecast\b/);
  await expect(context.locator('[data-fin-family="earnings"]')).toHaveAttribute("aria-selected", "true");

  await context.locator('[data-fin-family="lab"]').click();
  await expect(page).toHaveURL(/[?&]page=lab\b/);
  await expect(page.locator(".fin-pane--workspace .fin-page-subnav")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("compact: family picker remains reachable and local views remain available", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/analysis?symbol=NVDA&page=earnings");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });

  const context = page.locator(".analysis-context-bar");
  await expect(context.locator(".analysis-context-back")).toHaveCount(0);
  const family = context.locator(".fin-family-mobile-trigger");
  await expect(family).toBeVisible();
  await expect(family).toContainText("Earnings");
  await page.screenshot({ path: testInfo.outputPath("analysis-earnings-390.png") });
  await expect(page.locator(".fin-local-tabs-mobile [data-fin-local]")).toHaveCount(0);
  await expect(page.locator(".fin-local-tabs-mobile .fin-local-mobile-tab")).toHaveCount(3);

  await family.click();
  const sheet = page.locator(".fin-family-sheet");
  await expect(sheet).toBeVisible();
  await sheet.locator('[data-fin-family-sheet="financials"]').click();
  await expect(page).toHaveURL(/[?&]page=statements\b/);
  await expect(page.locator(".fin-local-tabs-mobile .fin-local-mobile-tab")).toHaveCount(5);

  await context.locator(".analysis-context-more summary").click();
  await expect(context.getByText("Saved research")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

/** At the mobile family breakpoint, no sibling context action may force horizontal chrome overflow. */
test("tablet and narrow phone keep ticker, family picker, and company actions reachable", async ({ page }) => {
  for (const viewport of [
    { width: 820, height: 1180 },
    { width: 320, height: 740 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/analysis?symbol=MSFT&page=transcripts");
    const context = page.locator(".analysis-context-bar");
    await expect(context.locator(".sym-pick strong")).toHaveText("MSFT", { timeout: 45_000 });
    await expect(context.locator(".fin-family-mobile-trigger")).toBeVisible();
    await expect(context.locator(".fin-family-mobile-trigger")).toContainText("Earnings");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `viewport ${viewport.width}px must not create horizontal overflow`).toBeLessThanOrEqual(1);

    // The 320px design intentionally moves both research actions into overflow.
    await context.locator(".analysis-context-more summary").click();
    await expect(context.locator(".analysis-context-more-menu").getByText("Saved research")).toBeVisible();
    await expect(context.locator(".analysis-context-more-menu").getByText("Your theses")).toBeVisible();
  }
});

test("medium desktop: all multi-view families keep their subpages separate and deep-linkable", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/analysis?symbol=NVDA&page=statements");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });
  const familyBar = page.locator(".analysis-context-bar");
  const sub = page.locator(".fin-pane--workspace .fin-page-subnav");

  await expect(familyBar.locator('[data-fin-family="financials"]')).toHaveAttribute("aria-selected", "true");
  await expect(sub.locator(".fin-local-tab")).toHaveCount(5);
  await sub.locator('[data-fin-local="compare"]').click();
  await expect(page).toHaveURL(/[?&]page=compare\b/);
  await expect(familyBar.locator('[data-fin-family="financials"]')).toHaveAttribute("aria-selected", "true");

  await familyBar.locator('[data-fin-family="market"]').click();
  await expect(page).toHaveURL(/[?&]page=technicals\b/);
  await expect(sub.locator(".fin-local-tab")).toHaveCount(2);
  await sub.locator('[data-fin-local="seasonals"]').click();
  await expect(page).toHaveURL(/[?&]page=seasonals\b/);

  await familyBar.locator('[data-fin-family="ownership"]').click();
  await expect(page).toHaveURL(/[?&]page=ownership\b/);
  await expect(sub.locator(".fin-local-tab")).toHaveCount(2);

  await familyBar.locator('[data-fin-family="intelligence"]').click();
  await expect(page).toHaveURL(/[?&]page=intelligence\b/);
  await expect(sub).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("analysis-intelligence-1024.png") });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
