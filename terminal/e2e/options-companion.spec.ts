import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import matrixFixture from "../public/data/matrix_fixture.json";
type ChartDebugWindow = Window & {
  __mmChartAxisOpts?: () => { rowCount: number; optionsPin: { price: number; lineStyle: number } | null };
  __mmChartOwnership?: () => { orphanPricePaneLines: number };
};
const crops = "docs/pr-crops/options-companion-20260923";
const spy = matrixFixture.SPY;
test.setTimeout(90_000);

async function prepare(page: Page, lang = "en", symbol = "SPY") {
  await page.addInitScript((locale) => {
    localStorage.setItem("mm.lang", locale); localStorage.removeItem("mm.optionsCompanion.v1");
    document.documentElement?.setAttribute("data-lang", locale);
  }, lang);
  await page.goto(`/terminal?symbol=${symbol}`);
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => (window as ChartDebugWindow).__mmChartAxisOpts?.()?.rowCount ?? 0), { timeout: 30_000 }).toBeGreaterThan(0);
}
async function openPanel(page: Page) {
  if (page.viewportSize()!.width <= 640) {
    await page.getByTestId("roller-more").click();
    await page.getByTestId("hub-tile-options").click();
  } else if (page.viewportSize()!.width <= 860) {
    await page.getByTestId("toolbar-more").click();
    await page.locator('[data-toolbar-menu-action="options"]').click();
  } else await page.getByTestId("options-rail-toggle").click();
  const panel = page.locator("[data-options-companion]");
  await expect(panel).toBeVisible(); return panel;
}
const chartPin = (page: Page) => page.evaluate(() => (window as ChartDebugWindow).__mmChartAxisOpts?.()?.optionsPin ?? null);

for (const lang of ["en", "zh"] as const) {
  test(`[${lang}] real chart + options companion, controls, native pins and restoration`, async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
    await prepare(page, lang);
    const originalCanvas = await page.locator(".chart-wrap canvas").first().elementHandle();
    const panel = await openPanel(page);
    await expect(panel.locator("[data-options-grid] table")).toBeVisible({ timeout: 20_000 });
    await expect(panel.locator("[data-options-session]")).toHaveAttribute("data-options-session", "2026-07-10");
    if (info.project.name === "desktop") {
      const chart = await page.locator(".chart-wrap").first().boundingBox(); const side = await panel.boundingBox();
      expect(side!.x).toBeGreaterThanOrEqual(chart!.x + chart!.width - 2);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const cells = panel.locator('[data-options-grid] button[data-value]:not([data-value="missing"]):not([data-value="0"])');
    await cells.first().click();
    await expect(panel.locator("[data-options-inspector]")).toContainText("2026-07-10");
    await panel.getByRole("button", { name: lang === "zh" ? "在图表标记行权价" : "Pin strike on chart", exact: true }).click();
    await expect.poll(async () => !!(await chartPin(page))).toBe(true);
    const pinned = await chartPin(page); expect(pinned.price).toBeGreaterThan(0); expect(pinned.lineStyle).toBe(2);
    expect(await page.evaluate(() => (window as ChartDebugWindow).__mmChartOwnership?.()?.orphanPricePaneLines)).toBe(0);
    expect(await originalCanvas!.evaluate((canvas) => canvas.isConnected)).toBe(true);
    mkdirSync(crops, { recursive: true });
    await page.screenshot({ path: `${crops}/${info.project.name}-${lang}-gamma-pin.png`, fullPage: false });
    // The companion's scoped light treatment; this is not a new Terminal-wide theme switch.
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await panel.screenshot({ path: `${crops}/${info.project.name}-${lang}-panel-light.png` });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await panel.getByLabel(lang === "zh" ? "颜色尺度" : "Color scale").selectOption("column");
    await expect(panel).toContainText(lang === "zh" ? "各列独立归一化" : "Per-expiry scale");
    await expect.poll(() => chartPin(page)).toBeNull();
    await panel.getByLabel(lang === "zh" ? "颜色尺度" : "Color scale").selectOption("global");
    await panel.getByLabel(lang === "zh" ? "到期日" : "Expiries", { exact: true }).selectOption("6");
    await expect(panel.locator("thead th")).toHaveCount(7);
    await panel.getByRole("tab", { name: lang === "zh" ? "持仓量" : "OI", exact: true }).click();
    await expect(panel).toContainText(lang === "zh" ? "可见持仓量" : "Visible open interest");
    await panel.getByRole("button", { name: "ΔOI", exact: true }).click();
    await expect(panel).toContainText(lang === "zh" ? "可见持仓变化" : "Visible OI change");
    await panel.getByRole("tab", { name: "Vanna", exact: true }).click();
    await expect(panel).toContainText(lang === "zh" ? "全部到期日行权价分布" : "All-expiry strike profile", { timeout: 20_000 });
    await expect(panel).toContainText(lang === "zh" ? "不同符号约定" : "different sign convention");
    await page.screenshot({ path: `${crops}/${info.project.name}-${lang}-vanna.png`, fullPage: false });
    await panel.getByRole("tab", { name: lang === "zh" ? "资金流" : "Flow", exact: true }).click();
    await expect(panel.locator("[data-options-tape]")).toBeVisible({ timeout: 20_000 });
    await panel.getByRole("button", { name: lang === "zh" ? "时段成交量" : "Session volume", exact: true }).click();
    await expect(panel).toContainText(lang === "zh" ? "可见时段成交量" : "Visible session volume");
    await page.getByRole("button", { name: lang === "zh" ? "关闭期权面板" : "Close options panel", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await expect.poll(() => chartPin(page)).toBeNull();
    expect(await originalCanvas!.evaluate((canvas) => canvas.isConnected)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("wrong-root source is refused; explicit refresh recovers without a page reload", async ({ page }) => {
  let corrected = false, calls = 0;
  await page.route(/\/api\/flow\?f=matrix(?::|%3A)SPY(?:&|$)/, async (route) => {
    calls++; await route.fulfill({ json: corrected ? spy : { ...spy, root: "QQQ" } });
  });
  await prepare(page); const panel = await openPanel(page);
  await expect(panel).toContainText("Source identity does not match this chart");
  await expect(panel.locator("[data-options-grid]")).toHaveCount(0);
  corrected = true; await panel.getByRole("button", { name: "Refresh snapshot", exact: true }).click();
  await expect(panel.locator("[data-options-grid] table")).toBeVisible(); expect(calls).toBe(2);
});

test("0DTE never silently becomes the nearest later expiry", async ({ page }) => {
  await page.route(/\/api\/flow\?f=matrix(?::|%3A)SPY(?:&|$)/, route => route.fulfill({ json: { ...spy, cells: spy.cells.filter(cell => cell.expiry !== spy._build_meta.asof_date) } }));
  await prepare(page); const panel = await openPanel(page);
  await expect(panel.locator("[data-options-grid] table")).toBeVisible();
  await panel.getByLabel("Expiries", { exact: true }).selectOption("0dte");
  await expect(panel).toContainText("The front expiry is not 0DTE");
  await expect(panel.locator("[data-options-grid]")).toHaveCount(0);
});

test("uncovered symbol does not inherit an index heatmap", async ({ page }) => {
  await prepare(page, "en", "NVDA"); const panel = await openPanel(page);
  await expect(panel).toContainText("No covered snapshot");
  await expect(panel).toContainText("No other symbol is substituted");
  await expect(panel.locator("[data-options-grid]")).toHaveCount(0);
  await panel.getByRole("tab", { name: "Vanna", exact: true }).click();
  await expect(panel).toContainText("All-expiry strike profile");
});

test("unentitled account never mounts an options data consumer", async ({ page }) => {
  const requested: string[] = [];
  await page.route("**/api/me", route => route.fulfill({ json: { tier: "free", features: [], status: "none" } }));
  page.on("request", request => { if (/f=(matrix|gex):|f=(matrix|gex)%3A/.test(request.url())) requested.push(request.url()); });
  await prepare(page); const panel = await openPanel(page);
  await expect(panel.getByRole("button").last()).toBeVisible();
  await expect(panel.locator("[data-options-grid]")).toHaveCount(0);
  expect(requested).toEqual([]);
});


test("keyboard grid inspection clears without closing, then Escape restores the opener", async ({ page }) => {
  await prepare(page); const panel = await openPanel(page);
  const initial = panel.locator('[data-options-grid] button[tabindex="0"]');
  await expect(initial).toBeVisible(); await initial.focus();
  const oldColumn = await initial.getAttribute("data-col");
  await page.keyboard.press("ArrowRight");
  const focused = panel.locator('[data-options-grid] button:focus');
  expect(await focused.getAttribute("data-col")).not.toBe(oldColumn);
  await page.keyboard.press("Enter");
  await expect(panel.locator('[data-options-grid] button[aria-pressed="true"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-options-grid] button[aria-pressed="true"]')).toHaveCount(0);
  await panel.getByRole("tab", { name: "Gamma", exact: true }).focus();
  await page.keyboard.press("Escape"); await expect(panel).toHaveCount(0);
  await expect(page.getByTestId(page.viewportSize()!.width <= 640 ? "roller-more" : page.viewportSize()!.width <= 860 ? "toolbar-more" : "options-rail-toggle")).toBeFocused();
});

test("switching the real chart symbol resets the pin and binds the new heatmap", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Desktop picker route; mobile snapshot race is separately component-tested.");
  await prepare(page); const canvas = await page.locator(".chart-wrap canvas").first().elementHandle();
  const panel = await openPanel(page);
  await panel.locator('[data-options-grid] button[data-value]:not([data-value="missing"])').first().click();
  await panel.getByRole("button", { name: "Pin strike on chart", exact: true }).click();
  await expect.poll(async () => !!(await chartPin(page))).toBe(true);
  await page.locator(".pair").click();
  await page.getByRole("combobox").fill("QQQ");
  await expect(page.getByRole("option").filter({ hasText: "QQQ" }).first()).toBeVisible();
  await page.getByRole("combobox").press("Enter");
  await expect(panel).toHaveAttribute("data-options-root", "QQQ");
  await expect(panel.locator("[data-options-grid] table")).toBeVisible();
  await expect.poll(() => chartPin(page)).toBeNull();
  expect(await canvas!.evaluate(el => el.isConnected)).toBe(true);
});
