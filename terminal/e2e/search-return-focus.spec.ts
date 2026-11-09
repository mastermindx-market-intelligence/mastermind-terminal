import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

async function roundtrip(page: Page, opener: Locator, input: Locator, info: TestInfo, scope: string) {
  const original = page.viewportSize()!;
  const alternate = original.width <= 600 ? { width: 1440, height: 900 } : { width: 390, height: 844 };
  const outerScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  await opener.click(); await input.fill("AAPL");
  for (const viewport of [alternate, original]) {
    await page.setViewportSize(viewport); await expect(input).toBeVisible(); await expect(input).toHaveValue("AAPL");
  }
  await page.keyboard.press("Escape"); await expect(input).toBeHidden(); await expect(opener).toBeFocused();
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(outerScroll);
  await page.screenshot({ path: info.outputPath(`${scope}-return-${info.project.name}.png`) });
  // A second ordinary session must not reuse a detached presentation target.
  await opener.click(); await expect(input).toBeVisible();
  await page.keyboard.press("Escape"); await expect(input).toBeHidden(); await expect(opener).toBeFocused();
}

test("ordinary Search restores its opener across responsive presentations", async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  const opener = info.project.name === "desktop" ? page.locator(".pair").first() : page.locator(".m-symbar [data-symbol-search]");
  await roundtrip(page, opener, page.locator(".sh input"), info, "ordinary");
});

test("Shared Search restores its opener across responsive presentations", async ({ page }, info) => {
  test.setTimeout(90_000);
  test.skip(process.env.MMX_SHARED_SHELL !== "1", "Existing Shared Shell beta opt-in");
  await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
  await page.route("**/data/manifest.json", route => route.fulfill({ json: { as_of: null, symbols: { AAPL: { name: "Apple Inc.", col: "#777", verdict: null, sec: "Stock", mkt: "NASDAQ" } } } }));
  await page.goto("/discover");
  await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible({ timeout: 30_000 });
  const opener = info.project.name === "desktop" ? page.locator(".topbar .shared-shell-company-search") : page.locator(".mobilebar").getByRole("button", { name: "Search companies", exact: true });
  await roundtrip(page, opener, page.getByRole("dialog").getByRole("combobox"), info, "shared");
});
