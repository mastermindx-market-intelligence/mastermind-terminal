import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

test("chart clock keeps ticking without interrupting navigation or an open settings menu", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "en");
    const state = window as Window & { __clockChartReady?: boolean };
    window.addEventListener("mm:terminal-visual-ready", () => { state.__clockChartReady = true; }, { once: true });
  });
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => (window as Window & { __clockChartReady?: boolean }).__clockChartReady), { timeout: 20_000 }).toBe(true);
  const clock = page.locator(".cfb-clock").first();
  const cropDir = "docs/pr-crops/chart-clock-isolation-20260921";
  mkdirSync(cropDir, { recursive: true });
  await page.screenshot({ path: `${cropDir}/${testInfo.project.name}.png` });
  if (page.viewportSize()!.width <= 640) {
    await expect(clock).toBeHidden();
    await expect(page.getByTestId("roller-more")).toBeVisible();
    return;
  }
  await expect(clock).toBeVisible();
  await expect(clock).toContainText(/\d{2}:\d{2}:\d{2}\s+UTC[+-]\d/);
  const original = await clock.innerText();
  await expect.poll(() => clock.innerText()).not.toBe(original);
  if (page.viewportSize()!.width > 860) {
    // Tablet dock hit-testing is covered by the separate settings/control-access repair (#701).
    const gear = page.locator(".cfb-gear").first();
    await gear.click();
    const menu = page.locator(".qsg-menu").first();
    await expect(menu).toBeVisible();
    const openedAt = await clock.innerText();
    await expect.poll(() => clock.innerText()).not.toBe(openedAt);
    await expect(menu).toBeVisible();
    await gear.click();
    await expect(menu).toHaveCount(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
