import { expect, test } from "@playwright/test";

/**
 * The standalone Research Workspace uses the same FinPage routing as the chart
 * overlay, but no longer stacks the family and local menus in one row.
 */
test("desktop: company families live beside symbol, views live in the page subheader", async ({ page }) => {
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
  await expect(local.locator('[data-fin-local="earnings"]')).toHaveAttribute("aria-selected", "true");
  await local.locator('[data-fin-local="forecast"]').click();
  await expect(page).toHaveURL(/[?&]page=forecast\\b/);
  await expect(context.locator('[data-fin-family="earnings"]')).toHaveAttribute("aria-selected", "true");

  await context.locator('[data-fin-family="lab"]').click();
  await expect(page).toHaveURL(/[?&]page=lab\\b/);
  await expect(page.locator(".fin-pane--workspace .fin-page-subnav")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("compact: family picker remains reachable and local views remain available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/analysis?symbol=NVDA&page=earnings");
  await expect(page.locator(".sym-pick strong")).toHaveText("NVDA", { timeout: 45_000 });

  const context = page.locator(".analysis-context-bar");
  await expect(context.locator(".analysis-context-back")).toHaveCount(0);
  const family = context.locator(".fin-family-mobile-trigger");
  await expect(family).toBeVisible();
  await expect(family).toContainText("Earnings");
  await expect(page.locator(".fin-local-tabs-mobile [data-fin-local]")).toHaveCount(0);
  await expect(page.locator(".fin-local-tabs-mobile .fin-local-mobile-tab")).toHaveCount(3);

  await family.click();
  const sheet = page.locator(".fin-family-sheet");
  await expect(sheet).toBeVisible();
  await sheet.locator('[data-fin-family-sheet="financials"]').click();
  await expect(page).toHaveURL(/[?&]page=statements\\b/);
  await expect(page.locator(".fin-local-tabs-mobile .fin-local-mobile-tab")).toHaveCount(5);

  await context.locator(".analysis-context-more summary").click();
  await expect(context.getByText("Saved research")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
