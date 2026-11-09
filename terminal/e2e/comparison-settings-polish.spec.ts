import { expect, test, type Page } from "@playwright/test";
import { isolateLayoutStore, useLang } from "./layoutStore";
import { openLayoutMenu } from "./terminalToolbar";

async function seedComparison(page: Page) {
  const menu = await openLayoutMenu(page);
  await menu.locator("[data-layout-save] input").fill("Comparison seed");
  await menu.locator("[data-layout-save-btn]").click();
  await expect(menu.locator('[data-layout-feedback="saved"]')).toBeVisible();
  const saved = await page.evaluate(async () => {
    const list = await fetch("/api/layouts");
    const rows = (await list.json()).layouts as { name: string; config: { widgets: { type: string; config: Record<string, unknown> }[] } }[];
    const seed = rows.find((row) => row.name === "Comparison seed");
    if (!seed) return 0;
    const envelope = structuredClone(seed.config);
    const chart = envelope.widgets.find((widget) => widget.type === "chart")!;
    chart.config.compare = ["SPY"];
    chart.config.compareCfg = { SPY: { color: "rgba(25, 194, 194, 0.4)", lineStyle: 2, lineWidth: 2, mode: "percent" } };
    const response = await fetch("/api/layouts", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "save_workspace", name: "Comparison controls", envelope, expectedRevision: null }) });
    return response.status;
  });
  expect(saved).toBe(200);
  await page.reload();
  const layouts = await openLayoutMenu(page);
  await layouts.locator('[data-layout-row="Comparison controls"]').click();
  await expect(page.locator('[data-cmp-study]')).toBeVisible();
}

async function openComparison(page: Page, lang: "en" | "zh") {
  const row = page.locator(".lg-row").filter({ has: page.locator(".lg-name").getByText("SPY", { exact: true }) }).first();
  const toggle = page.locator(".lg-collapse").first();
  await expect(row).toBeAttached();
  if (!await row.isVisible()) await toggle.click();
  await expect(row).toBeVisible();
  const opener = row.getByRole("button", { name: lang === "zh" ? "设置" : "Settings", exact: true });
  if (page.viewportSize()!.width <= 860) { await row.locator(".lg-name").click(); await opener.click(); }
  else { await row.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await expect(opener).toBeFocused(); await page.keyboard.press("Enter"); }
  const dialog = page.getByRole("dialog", { name: "SPY", exact: true });
  await expect(dialog).toBeVisible(); await expect(dialog).toBeFocused();
  return { dialog, opener };
}

for (const lang of ["en", "zh"] as const) {
  test(`${lang} comparison controls preserve edits and keyboard ownership`, async ({ page, baseURL }, info) => {
    await isolateLayoutStore(page, info, baseURL); await useLang(page, lang);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => { localStorage.setItem("mm.startTf", JSON.stringify("D")); localStorage.removeItem("mm.ws"); });
    await page.goto("/terminal?symbol=AAPL");
    await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 20_000 });
    await seedComparison(page);
    const previousOverflow = await page.evaluate(() => document.body.style.overflow);
    let { dialog, opener } = await openComparison(page, lang);
    await expect(dialog.locator('input[type="color"]')).toHaveValue("#19c2c2");
    const close = dialog.getByRole("button", { name: lang === "zh" ? "关闭" : "Close", exact: true });
    const done = dialog.getByRole("button", { name: lang === "zh" ? "完成" : "Done", exact: true });
    await done.focus(); await page.keyboard.press("Tab"); await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab"); await expect(done).toBeFocused();
    await page.keyboard.press("A");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    const dotted = dialog.getByRole("button", { name: lang === "zh" ? "点线" : "Dotted", exact: true });
    await dotted.focus(); await page.keyboard.press("Space"); await expect(dotted).toHaveAttribute("aria-pressed", "true");
    await expect(dotted).toBeFocused();
    await dialog.getByRole("button", { name: `${lang === "zh" ? "颜色" : "Color"}: #26c281`, exact: true }).press("Space");
    await expect(dialog.locator('input[type="color"]')).toHaveValue("#26c281");
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.cmpCfg") || "{}").SPY?.color)).toBe("rgba(38, 194, 129, 0.4)");
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (info.project.use.hasTouch) {
      for (const control of await dialog.locator('.is-sw, .cmp-set-opt, .is-stepper button').all()) {
        const b = await control.boundingBox(); expect(b!.height).toBeGreaterThanOrEqual(44);
      }
    }
    const crop = info.outputPath(`comparison-settings-${lang}.png`); await page.screenshot({ path: crop });
    await info.attach("comparison-settings", { path: crop, contentType: "image/png" });
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(previousOverflow);
    if (page.viewportSize()!.width > 860) await expect(opener).toBeFocused();
    ({ dialog, opener } = await openComparison(page, lang));
    await expect(dialog.getByRole("button", { name: lang === "zh" ? "点线" : "Dotted", exact: true })).toHaveAttribute("aria-pressed", "true");
    await dialog.getByRole("button", { name: lang === "zh" ? "完成" : "Done", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}
