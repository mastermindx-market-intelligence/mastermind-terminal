import { expect, test, type Page } from "@playwright/test";

// Fault the device boundary, not the component: the same route must recover only on a
// manual retry, and persisted bytes must agree with the displayed list after remount.
test.setTimeout(90_000);
const KEY = "mm.scrPresets";
const filters = { market: "all", asset: "all", sector: "all", signal: "any", uptrend: false, liq: 0, mcap: 0, w52: "any", move: "up3", unpriced: false };

type Fixture = { denyRead: boolean; denyWrite: boolean; writes: number; raw: () => string | null };
declare global { interface Window { __presetFixture: Fixture } }

async function installFixture(page: Page, lang: "en" | "zh", denyRead = false) {
  await page.addInitScript(({ key, f, locale, failRead }) => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    set.call(localStorage, "mm.lang", locale);
    // One seed per browser tab; reload must read the result of the tested transition.
    if (!sessionStorage.getItem("preset-fixture-seeded")) {
      set.call(localStorage, key, JSON.stringify({ v: 1, items: [{ id: "A", name: "A", f }] }));
      sessionStorage.setItem("preset-fixture-seeded", "1");
    }
    const fixture: Fixture = { denyRead: failRead, denyWrite: !failRead, writes: 0, raw: () => get.call(localStorage, key) };
    window.__presetFixture = fixture;
    Storage.prototype.getItem = function (name) {
      if (name === key && fixture.denyRead) throw new DOMException("blocked", "SecurityError");
      return get.call(this, name);
    };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) {
        fixture.writes++;
        if (fixture.denyWrite) throw new DOMException("full", "QuotaExceededError");
      }
      set.call(this, name, value);
    };
  }, { key: KEY, f: filters, locale: lang, failRead: denyRead });
  await page.route("**/data/manifest.json**", route => route.fulfill({ json: { as_of: "2026-10-09", symbols: {} } }));
}

const saved = (page: Page) => page.locator(".scr2-preset-wrap .fin-tab");
const editor = (page: Page) => page.locator(".scr2-preset-name");
// Next.js has a permanent page-level role=alert route announcer. Only this feature's
// inline error is dismissed by Cancel/Escape; the app announcer must remain intact.
const presetError = (page: Page) => page.locator(".screener-main").getByRole("alert");
async function saveB(page: Page) {
  await page.locator(".scr2-presets-tail button").click();
  await editor(page).fill("B");
  await editor(page).press("Enter");
}

for (const lang of ["en", "zh"] as const) {
  test(`${lang}: failed save retains the draft, keyboard retry is reachable, and remount agrees`, async ({ page }, testInfo) => {
    await installFixture(page, lang);
    await page.goto("/discover?tab=screener");
    await expect(saved(page)).toHaveText(["A"], { timeout: 45_000 });
    const original = await page.evaluate(() => window.__presetFixture.raw());
    await saveB(page);
    await expect(saved(page)).toHaveText(["A"]);
    await expect(editor(page)).toHaveValue("B");
    const error = presetError(page).filter({ hasText: lang === "zh" ? "未保存" : "not saved" });
    await expect(error).toBeVisible();
    const retry = error.getByRole("button", { name: lang === "zh" ? "重试保存: B" : "Retry saving: B", exact: true });
    const cancel = error.getByRole("button", { name: lang === "zh" ? "取消保存: B" : "Cancel saving: B", exact: true });
    await expect(retry).toBeVisible(); await expect(cancel).toBeVisible();
    await editor(page).press("Tab");
    await expect(retry).toBeFocused();
    expect(await page.evaluate(() => window.__presetFixture.writes)).toBe(1);
    expect(await page.evaluate(() => window.__presetFixture.raw())).toBe(original);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(themeName => document.documentElement.setAttribute("data-theme", themeName), theme);
      await retry.scrollIntoViewIfNeeded();
      const box = await retry.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const screenshot = testInfo.outputPath(`preset-save-failure-${lang}-${theme}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      await testInfo.attach(`preset-save-failure-${lang}-${theme}`, { path: screenshot, contentType: "image/png" });
    }
    await page.evaluate(() => { window.__presetFixture.denyWrite = false; });
    await retry.press("Enter");
    await expect(saved(page)).toHaveText(["A", "B"]);
    expect(await page.evaluate(() => window.__presetFixture.writes)).toBe(2);
    await page.reload();
    await expect(saved(page)).toHaveText(["A", "B"]);
    expect(await page.evaluate(() => window.__presetFixture.writes)).toBe(0);
  });

  test(`${lang}: unread baseline blocks writes and rejected Delete preserves the active filters`, async ({ page }) => {
    await installFixture(page, lang, true);
    await page.goto("/discover?tab=screener");
    await expect(page.locator(".scr2-presets-tail button")).toBeVisible({ timeout: 45_000 });
    const original = await page.evaluate(() => window.__presetFixture.raw());
    await saveB(page);
    expect(await page.evaluate(() => window.__presetFixture.writes)).toBe(0);
    expect(await page.evaluate(() => window.__presetFixture.raw())).toBe(original);
    await page.evaluate(() => { window.__presetFixture.denyRead = false; });
    await page.getByRole("button", { name: lang === "zh" ? "重试保存: B" : "Retry saving: B", exact: true }).press("Enter");
    await expect(saved(page)).toHaveText(["A", "B"]);
    expect(await page.evaluate(() => window.__presetFixture.writes)).toBe(1);
    await saved(page).filter({ hasText: /^A$/ }).click();
    const acknowledged = await page.evaluate(() => window.__presetFixture.raw());
    await page.evaluate(() => { window.__presetFixture.denyWrite = true; });
    await page.getByRole("button", { name: lang === "zh" ? "删除预设: A" : "Delete preset: A", exact: true }).click();
    await expect(saved(page).filter({ hasText: /^A$/ })).toHaveClass(/\bon\b/);
    const dayMove = page.getByRole("combobox", { name: lang === "zh" ? "当日波动" : "Day move", exact: true });
    await expect(dayMove).toHaveValue("up3");
    await page.getByRole("button", { name: lang === "zh" ? "重试删除: A" : "Retry deleting: A", exact: true }).press("Escape");
    await expect(presetError(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__presetFixture.writes)).toBe(2);
    expect(await page.evaluate(() => window.__presetFixture.raw())).toBe(acknowledged);
    await expect(saved(page)).toHaveText(["A", "B"]);
    await expect(saved(page).filter({ hasText: /^A$/ })).toHaveClass(/\bon\b/);
    await expect(dayMove).toHaveValue("up3");
  });
}
