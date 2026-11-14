import { expect, test, type Locator, type Page } from "@playwright/test";

/** Account autosave makes a shared default fixture identity unsafe for parallel
 * screener tests. Preserve explicitly prepared cross-device identities. */
export async function isolateDiscoverAccount(page: Page) {
  const baseURL = String(test.info().project.use.baseURL ?? "http://127.0.0.1:3108");
  if ((await page.context().cookies(baseURL)).some(cookie => cookie.name === "mm_e2e_wl")) return;
  const key = `discover-${test.info().project.name}-${test.info().testId}-${test.info().retry}-${Math.random().toString(36).slice(2, 8)}`.replace(/[^a-zA-Z0-9-]/g, "-");
  await page.context().addCookies([{ name: "mm_e2e_wl", value: key, url: baseURL }]);
}

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
