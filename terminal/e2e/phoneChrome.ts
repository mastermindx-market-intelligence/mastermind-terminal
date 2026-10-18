import { expect, type Page } from "@playwright/test";

// Shared helpers for the phone chart chrome (R2). Not a spec file — Playwright's default
// testMatch only collects *.spec.ts, so this module is imported, never run.

/** Mirrors app/globals.css and lib/useMediaQuery.ts (PHONE_QUERY). */
export const PHONE_MAX = 640;

export const isPhoneViewport = (page: Page) => (page.viewportSize()?.width ?? 1440) <= PHONE_MAX;

/**
 * Opens the Indicator Library through whichever entry point the viewport ships: the chart
 * toolbar's "+ Indicators" button on tablet/desktop, and the roller strip's ••• → Indicators
 * tile on the phone, where R2.2 replaced the toolbar row with the Analysis hub.
 */
export async function openIndicatorLibrary(page: Page) {
  if (isPhoneViewport(page)) {
    await page.getByTestId("roller-more").click();
    await page.getByTestId("hub-tile-indicators").click();
    return;
  }
  const trigger = page.locator(".indicator-library-trigger");
  await expect(trigger).toBeVisible();
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
}

type ContextLang = "en" | "zh";
const contextTitle = (lang: ContextLang) => lang === "zh" ? "图表解读" : "Chart context";

export const chartContextReturnTarget = (page: Page, lang: ContextLang = "en") =>
  isPhoneViewport(page)
    ? page.getByTestId("roller-more")
    : page.getByRole("button", { name: contextTitle(lang), exact: true });

/** Open the reader through the visible entry without resetting chart or Options state. */
export async function openChartContext(page: Page, lang: ContextLang = "en") {
  // Chart startup collapses its temporary name tab; wait for the visible chart before targeting the toolbar.
  await expect(page.locator(".chart-wrap:visible canvas").first()).toBeVisible({ timeout: 20_000 });
  const opener = chartContextReturnTarget(page, lang);
  await expect(opener).toBeVisible({ timeout: 20_000 });
  await opener.scrollIntoViewIfNeeded();
  await opener.click();
  if (isPhoneViewport(page)) {
    const hub = page.getByTestId("analysis-hub");
    await expect(hub).toBeVisible();
    await hub.getByTestId("hub-tile-context").click();
    await expect(hub).toHaveCount(0);
  }
  const panel = page.getByRole("region", { name: contextTitle(lang), exact: true });
  await expect(panel).toBeVisible();
  return panel;
}
