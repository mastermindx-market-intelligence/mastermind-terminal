import { expect, type Locator, type Page } from "@playwright/test";

/** Drive the public workspace controls; the menu renders options in a portal. */
export async function openDiscoverFilters(page: Page, legacy = false) {
  const toggle = page.locator('[aria-controls="discover-advanced"]');
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await expect(page.locator("#discover-advanced")).toBeVisible();
  if (legacy) {
    const presets = page.locator("#discover-advanced details");
    if (await presets.getAttribute("open") === null) await presets.locator("summary").click();
  }
}

export async function chooseDiscoverOption(control: Locator, value: string) {
  if (await control.getAttribute("aria-expanded") !== "true") await control.click();
  // A quoted attribute selector handles spaces and punctuation in native taxonomy labels.
  await control.page().locator(`[role="option"][data-value=${JSON.stringify(value)}]`).click();
  await expect(control).toHaveAttribute("data-value", value);
}

export async function showDiscoverColumn(page: Page, id: string) {
  await page.locator("[data-discover-columns]").click();
  const dialog = page.getByRole("dialog");
  await dialog.locator(`[data-discover-column="${id}"]`).check();
  await dialog.press("Escape");
  await expect(page.locator(`thead [data-column="${id}"]`)).toBeAttached();
}
