import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

test("a cached symbol picker stays usable during refresh and receives the corrected company", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one real client-navigation regression; cache semantics are viewport-independent");
  const result = await page.request.get("/data/manifest.json");
  expect(result.ok()).toBe(true);
  const current = await result.json();
  expect(current.symbols.NVDA).toBeTruthy();
  const cached = structuredClone(current);
  cached.symbols.NVDA.name = "Cached NVIDIA company";
  current.symbols.NVDA.name = "Refreshed NVIDIA company";
  // Let the real chart initialize on its real clock. This contract controls only the
  // cache-expiry transition AFTER warm data and chart readiness have been observed.
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "en");
    const state = window as Window & { __warmPickerChartReady?: boolean };
    state.__warmPickerChartReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => { state.__warmPickerChartReady = true; }, { once: true });
  });
  let release!: () => void, refreshes = 0;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/data/manifest.json", async (route) => {
    refreshes++;
    if (refreshes === 1) { await route.fulfill({ json: cached }); return; }
    await held; await route.fulfill({ json: current });
  });
  try {
    await page.goto("/terminal?symbol=NVDA");
    await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => page.evaluate(() => (window as Window & { __warmPickerChartReady?: boolean }).__warmPickerChartReady)).toBe(true);
    await expect(page.locator(".app").first()).toContainText("Cached NVIDIA company");
    const warmedAt = await page.evaluate(() => Date.now());
    await page.clock.setFixedTime(new Date(warmedAt + 90_000));
    // The first real client navigation starts a refresh; the second must not await it.
    await page.locator('.appnav a[href^="/portfolio"]').click();
    await expect(page).toHaveURL(/\/portfolio/);
    await expect.poll(() => refreshes).toBe(2);
    await page.locator('.appnav a[href^="/analysis"]').click();
    await expect(page).toHaveURL(/\/analysis/);
    await page.locator("button.sym-pick").click();
    const dialog = page.locator(".smodal");
    await dialog.getByRole("combobox").first().fill("NVDA");
    await expect(dialog).toContainText("Cached NVIDIA company");
    expect(refreshes).toBe(2);
    mkdirSync("docs/pr-crops/warm-symbol-picker-20260921", { recursive: true });
    await page.screenshot({ path: "docs/pr-crops/warm-symbol-picker-20260921/cached-while-refreshing.png" });
    release();
    await expect(dialog).toContainText("Refreshed NVIDIA company");
    await expect(dialog).not.toContainText("Cached NVIDIA company");
    expect(refreshes).toBe(2);
    await page.screenshot({ path: "docs/pr-crops/warm-symbol-picker-20260921/corrected-after-refresh.png" });
  } finally { release(); }
});
