import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const cropDir = "docs/pr-crops/chart-settings-ux-20260921";

// Exercise the real Terminal settings lifecycle without changing chart readiness ownership.
async function openSettings(page: Page) {
  if (page.viewportSize()!.width <= 640) {
    // Phone chrome deliberately retires the frame bar; use the existing chart context menu.
    const chart = page.locator(".chart-wrap").first();
    await chart.click({ button: "right", position: { x: 80, y: 100 } });
    await page.locator('.ctx-menu [data-a="settings"]').click();
  } else {
    await page.locator(".cfb-gear").first().click();
    await page.locator(".qsg-menu .qsg-item").last().click();
  }
  const dialog = page.locator("dialog.sm-backdrop");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }, testInfo) => {
  await page.addInitScript((locale) => {
    localStorage.setItem("mm.lang", locale);
    document.documentElement?.setAttribute("data-lang", locale);
    document.documentElement?.setAttribute("lang", locale === "zh" ? "zh-CN" : "en");
    const state = window as Window & { __settingsReady?: boolean; __settingsTemplateReads?: number };
    state.__settingsReady = false;
    state.__settingsTemplateReads = 0;
    window.addEventListener("mm:terminal-visual-ready", () => { state.__settingsReady = true; }, { once: true });
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      if (key === "mm.chartSettingTemplates") state.__settingsTemplateReads = (state.__settingsTemplateReads ?? 0) + 1;
      return getItem.call(this, key);
    };
  }, testInfo.title.startsWith("[zh]") ? "zh" : "en");
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => (window as Window & { __settingsReady?: boolean }).__settingsReady), { timeout: 20_000 }).toBe(true);
});

test("chart settings own focus, expose named controls and support arrow navigation", async ({ page }, testInfo) => {
  const dialog = await openSettings(page);
  await expect(dialog.locator('[aria-selected="true"]')).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await expect(dialog.locator('[data-settings-tab="status"]')).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(dialog.locator('[data-settings-tab="symbol"]')).toBeFocused();
  await page.keyboard.press("End");
  await expect(dialog.locator('[data-settings-tab="canvas"]')).toBeFocused();
  const unnamed = await dialog.locator('select,input:not([type="checkbox"])').evaluateAll((controls) => controls.filter((control) => {
    const input = control as HTMLInputElement | HTMLSelectElement;
    return !input.getAttribute("aria-label")?.trim() && !Array.from(input.labels ?? []).some((label) => label.textContent?.trim());
  }).map((control) => control.outerHTML));
  expect(unnamed).toEqual([]);
  mkdirSync(cropDir, { recursive: true });
  await page.screenshot({ path: `${cropDir}/${testInfo.project.name}-settings-en.png` });
  // Native modal inertness must defeat background programmatic focus too.
  const trigger = page.viewportSize()!.width <= 640 ? page.getByTestId("roller-more") : page.locator(".cfb-gear").first();
  await trigger.evaluate((element) => (element as HTMLElement).focus());
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("Cancel restores the opening snapshot while OK preserves edited settings", async ({ page }) => {
  let dialog = await openSettings(page);
  const before = await dialog.locator('input[type="checkbox"]').first().isChecked();
  await dialog.locator('input[type="checkbox"]').first().setChecked(!before);
  await dialog.locator(".sm-cancel").click();
  dialog = await openSettings(page);
  expect(await dialog.locator('input[type="checkbox"]').first().isChecked()).toBe(before);
  await dialog.locator('input[type="checkbox"]').first().setChecked(!before);
  await dialog.locator(".sm-ok").click();
  dialog = await openSettings(page);
  expect(await dialog.locator('input[type="checkbox"]').first().isChecked()).toBe(!before);
});

test("numeric drafts remain editable and only clamp on commit", async ({ page }) => {
  const dialog = await openSettings(page);
  await dialog.locator('[data-settings-tab="canvas"]').click();
  const number = dialog.locator(".sm-number").first();
  const before = await number.inputValue();
  await number.fill("");
  await expect(number).toHaveValue("");
  await number.press("Tab");
  await expect(number).toHaveValue(before);
  await number.fill("999");
  await expect(number).toHaveValue("999");
  await number.press("Tab");
  await expect(number).toHaveValue("50");
  await dialog.locator(".sm-cancel").click();
  const reopened = await openSettings(page);
  await reopened.locator('[data-settings-tab="canvas"]').click();
  await expect(reopened.locator(".sm-number").first()).toHaveValue(before);
});

test("live preview does not repeatedly read template storage", async ({ page }) => {
  const dialog = await openSettings(page);
  const reads = () => page.evaluate(() => (window as Window & { __settingsTemplateReads?: number }).__settingsTemplateReads ?? 0);
  const atOpen = await reads();
  expect(atOpen).toBeGreaterThan(0);
  for (let i = 0; i < 12; i += 1) await dialog.locator('input[type="checkbox"]').first().click();
  expect(await reads()).toBe(atOpen);
});

test("[zh] translated settings remain readable and bounded with reduced motion", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const dialog = await openSettings(page);
  for (const key of ["symbol", "status", "scales", "canvas"]) {
    const tab = dialog.locator(`[data-settings-tab="${key}"]`);
    await expect(tab.locator("span")).toBeVisible();
    await expect(tab).toContainText(/[\u4e00-\u9fff]/);
    await tab.click();
    const modal = await dialog.locator(".sm-modal").boundingBox();
    expect(modal).not.toBeNull();
    expect(modal!.x).toBeGreaterThanOrEqual(0);
    expect(modal!.y).toBeGreaterThanOrEqual(0);
    expect(modal!.x + modal!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(modal!.y + modal!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await expect(dialog.locator(".sm-reset")).toBeVisible();
    expect(await dialog.locator(".sm-content").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  mkdirSync(cropDir, { recursive: true });
  await page.screenshot({ path: `${cropDir}/${testInfo.project.name}-settings-zh.png` });
});

test("tablet dock never covers chart controls at its breakpoint edges", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "tablet", "Tablet-only geometry contract; phone uses its dedicated strip.");
  for (const width of [641, 700, 820, 860]) {
    await page.setViewportSize({ width, height: 1180 });
    const gear = page.locator(".cfb-gear").first();
    const dock = page.getByTestId("drawing-toolbar");
    await expect(dock).toBeVisible();
    await expect.poll(async () => {
      const button = await gear.boundingBox();
      const toolbar = await dock.boundingBox();
      return button && toolbar ? toolbar.y - (button.y + button.height) : -1;
    }).toBeGreaterThanOrEqual(0);
    await gear.click();
    await expect(page.locator(".qsg-menu")).toBeVisible();
    await gear.click();
  }
});
