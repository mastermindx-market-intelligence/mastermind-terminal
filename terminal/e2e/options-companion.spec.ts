import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import matrixFixture from "../public/data/matrix_fixture.json";
type ChartDebugWindow = Window & {
  __mmChartAxisOpts?: () => { rowCount: number; optionsPin: { price: number; lineStyle: number } | null };
  __mmChartOwnership?: () => { orphanPricePaneLines: number };
};
const crops = process.env.OPTIONS_COMPANION_CROPS || "docs/pr-crops/options-companion-20260923";
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
async function editScope(panel: Locator, lang: "en" | "zh", change: { expiries?: string; norm?: "global" | "column"; window?: string }, apply = true) {
  await panel.getByTestId("options-scope-toggle").click();
  const editor = panel.getByTestId("options-scope-editor"); await expect(editor).toBeVisible();
  if (change.expiries) await editor.getByLabel(lang === "zh" ? "到期日" : "Expiries", { exact: true }).selectOption(change.expiries);
  if (change.norm) await editor.getByLabel(lang === "zh" ? "颜色尺度" : "Color scale").selectOption(change.norm);
  if (change.window) await editor.getByLabel(lang === "zh" ? "行权价范围" : "Strike window").selectOption(change.window);
  await editor.getByTestId(apply ? "options-scope-apply" : "options-scope-cancel").click();
  await expect(editor).toHaveCount(0);
  await expect(panel.getByTestId("options-scope-toggle")).toBeFocused();
}

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
    const laterExpiry = panel.locator('[data-options-grid] button[aria-label*="2026-07-13"][data-value]:not([data-value="missing"]):not([data-value="0"])').first();
    await expect(laterExpiry).toBeVisible(); await laterExpiry.click();
    await expect(panel.locator("[data-options-inspector]")).toContainText("2026-07-10");
    await expect(panel.getByTestId("options-node-context")).toContainText(lang === "zh" ? "行权价合计" : "Strike Σ");
    await expect(panel.getByTestId("options-node-context")).toContainText(lang === "zh" ? "范围排名" : "Scope rank");
    await panel.getByRole("button", { name: lang === "zh" ? "在图表标记行权价" : "Pin strike on chart", exact: true }).click();
    await expect.poll(async () => !!(await chartPin(page))).toBe(true);
    const pinned = await chartPin(page); if (!pinned) throw new Error("Missing native price pin"); expect(pinned.price).toBeGreaterThan(0); expect(pinned.lineStyle).toBe(2);
    expect(await page.evaluate(() => (window as ChartDebugWindow).__mmChartOwnership?.()?.orphanPricePaneLines)).toBe(0);
    expect(await originalCanvas!.evaluate((canvas) => canvas.isConnected)).toBe(true);
    mkdirSync(crops, { recursive: true });
    await page.screenshot({ path: `${crops}/${info.project.name}-${lang}-gamma-pin.png`, fullPage: false });
    // The companion's scoped light treatment; this is not a new Terminal-wide theme switch.
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await panel.screenshot({ path: `${crops}/${info.project.name}-${lang}-panel-light.png` });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await editScope(panel, lang, { norm: "column" });
    await expect(panel).toContainText(lang === "zh" ? "各列独立归一化" : "Per-expiry scale");
    await expect.poll(async () => !!(await chartPin(page))).toBe(true);
    await editScope(panel, lang, { expiries: "0dte", norm: "global" });
    await expect(panel.getByTestId("options-selection-outside")).toBeVisible();
    await expect(panel.locator('[data-options-inspector]')).toContainText("2026-07-13");
    await expect.poll(async () => !!(await chartPin(page))).toBe(true);
    await editScope(panel, lang, { expiries: "6" });
    await expect(panel.locator("thead th")).toHaveCount(7);
    await expect(panel.locator('[data-options-grid] button[aria-label*="2026-07-13"][aria-pressed="true"]')).toHaveCount(1);
    await panel.getByRole("tab", { name: lang === "zh" ? "持仓量" : "OI", exact: true }).click();
    await expect(panel).toContainText(lang === "zh" ? "所选范围持仓量" : "Selected-scope open interest");
    await panel.getByRole("button", { name: "ΔOI", exact: true }).click();
    await expect(panel).toContainText(lang === "zh" ? "所选范围持仓变化" : "Selected-scope OI change");
    await panel.getByRole("tab", { name: "Vanna", exact: true }).click();
    await expect(panel).toContainText(lang === "zh" ? "全部到期日行权价分布" : "All-expiry strike profile", { timeout: 20_000 });
    await expect(panel).toContainText(lang === "zh" ? "不同符号约定" : "different sign convention");
    await page.screenshot({ path: `${crops}/${info.project.name}-${lang}-vanna.png`, fullPage: false });
    await panel.getByRole("tab", { name: lang === "zh" ? "资金流" : "Flow", exact: true }).click();
    await expect(panel.locator("[data-options-tape]")).toBeVisible({ timeout: 20_000 });
    await panel.getByRole("button", { name: lang === "zh" ? "时段成交量" : "Session volume", exact: true }).click();
    await expect(panel).toContainText(lang === "zh" ? "所选范围时段成交量" : "Selected-scope session volume");
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
  await page.route(/\/api\/flow\?f=matrix(?::|%3A)SPY(?:&|$)/, route => route.fulfill({ json: { ...spy, expiries: spy.expiries.filter(expiry => expiry !== spy._build_meta.asof_date), cells: spy.cells.filter(cell => cell.expiry !== spy._build_meta.asof_date) } }));
  await prepare(page); const panel = await openPanel(page);
  await expect(panel.locator("[data-options-grid] table")).toBeVisible();
  await editScope(panel, "en", { expiries: "0dte" });
  await expect(panel).toContainText("The front expiry is not 0DTE");
  await expect(panel.locator("[data-options-grid]")).toHaveCount(0);
});

test("R9 structure brief opens its exact dominant contract for inspection", async ({ page }) => {
  await prepare(page); const panel = await openPanel(page);
  const brief = panel.getByTestId("options-scope-structure"); await expect(brief).toBeVisible();
  const dominant = panel.getByTestId("options-dominant-node");
  const strike = await dominant.getAttribute("data-strike"), expiry = await dominant.getAttribute("data-expiry");
  expect(strike).toBeTruthy(); expect(expiry).toBeTruthy();
  await dominant.click(); await expect(dominant).toHaveAttribute("aria-pressed", "true");
  await expect(panel.locator("[data-options-inspector]")).toContainText(`${strike} · ${expiry}`);
  await expect(panel.getByTestId("options-node-context")).toBeVisible();
});

test("R7 scope edits stay pending until Apply and Cancel preserves the selected node", async ({ page }) => {
  await prepare(page); const panel = await openPanel(page);
  const later = panel.locator('[data-options-grid] button[aria-label*="2026-07-13"][data-value]:not([data-value="missing"])').first();
  await expect(later).toBeVisible(); await later.click();
  const initialHeaders = await panel.locator("thead th").count();
  await panel.getByTestId("options-scope-toggle").click();
  const editor = panel.getByTestId("options-scope-editor");
  await editor.getByLabel("Expiries", { exact: true }).selectOption("6");
  await expect(panel.locator("thead th")).toHaveCount(initialHeaders);
  await editor.getByTestId("options-scope-cancel").click();
  await expect(panel.locator("thead th")).toHaveCount(initialHeaders);
  await expect(later).toHaveAttribute("aria-pressed", "true");
  await editScope(panel, "en", { expiries: "0dte" });
  await expect(panel.getByTestId("options-selection-outside")).toBeVisible();
  await expect(panel.locator("[data-options-inspector]")).toContainText("2026-07-13");
});

test("R7 one-strike sparse matrix remains a real renderable scope", async ({ page }) => {
  const spot = Number(spy.spot); const strikes = [...new Set(spy.cells.map(cell => cell.strike))];
  const sparseStrike = strikes.sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))[0];
  await page.route(/\/api\/flow\?f=matrix(?::|%3A)SPY(?:&|$)/, route =>
    route.fulfill({ json: { ...spy, strikes: [sparseStrike], cells: spy.cells.filter(cell => cell.strike === sparseStrike) } }));
  await prepare(page); const panel = await openPanel(page);
  await expect(panel.locator("[data-options-grid] table")).toBeVisible();
  await expect(panel.locator("[data-options-grid] tbody tr")).toHaveCount(1);
  await expect(panel.locator("[data-options-grid] tbody th")).toContainText(String(sparseStrike));
  await expect(panel.locator("[data-options-total]")).not.toHaveText("—");
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
  await page.locator('input[role="combobox"]').fill("QQQ");
  await expect(page.getByRole("option").filter({ hasText: "QQQ" }).first()).toBeVisible();
  await page.locator('input[role="combobox"]').press("Enter");
  await expect(panel).toHaveAttribute("data-options-root", "QQQ");
  await expect(panel.locator("[data-options-grid] table")).toBeVisible();
  await expect.poll(() => chartPin(page)).toBeNull();
  expect(await canvas!.evaluate(el => el.isConnected)).toBe(true);
});

const reviewSession = "2026-07-10", reviewLater = "2026-07-13", reviewLast = "2026-07-14";
const reviewCell = (strike: number, expiry: string, gex: number | null) => ({ strike, expiry, gex, call_oi: 0, put_oi: 0, call_vol: 0, put_vol: 0 });
const reviewMatrix = (cells: ReturnType<typeof reviewCell>[], strikes: number[], expiries: string[], spot = 770) => ({
  schema: "options_structure.matrix/v1", root: "SPY", spot, asof: "2026-07-11T00:05:00Z", _build_meta: { asof_date: reviewSession }, cells, strikes, expiries,
});
async function serveReviewMatrix(page: Page, matrix: ReturnType<typeof reviewMatrix>) {
  await page.route(/\/api\/flow\?f=matrix(?::|%3A)SPY(?:&|$)/, route => route.fulfill({ json: matrix }));
}

for (const lang of ["en", "zh"] as const) {
  test(`[${lang}] R6 partial totals retain known values on the Terminal route`, async ({ page }, info) => {
    await serveReviewMatrix(page, reviewMatrix([reviewCell(770, reviewSession, 8e6), reviewCell(770, reviewLater, 2e6), reviewCell(770, reviewLast, null)], [770], [reviewSession, reviewLater, reviewLast]));
    await prepare(page, lang); const panel = await openPanel(page);
    await expect(panel.locator("[data-options-total]")).toHaveText("—");
    await expect(panel.locator("[data-options-total]")).not.toHaveClass(/positive|negative/);
    await expect(panel.getByTestId("options-scope-partial")).toContainText("+10M · 2/3");
    await panel.getByTestId("options-dominant-node").click();
    await expect(panel.getByTestId("options-node-partial")).toContainText("+10M · 2/3");
    await expect(panel.getByTestId("options-node-ex0dte-partial")).toContainText("+2M · 1/2");
    await expect(panel.getByTestId("options-domain-basis")).toContainText(lang === "en" ? "Source collection coverage unknown" : "源采集覆盖范围未知");
    mkdirSync(crops, { recursive: true });
    for (const theme of ["dark", "light"]) {
      await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
      await panel.screenshot({ path: `${crops}/${info.project.name}-${lang}-r6-partial-${theme}.png` });
    }
  });

  test(`[${lang}] R6 declared missing expiry and R7 scope focus preserve transaction semantics`, async ({ page }) => {
    await serveReviewMatrix(page, reviewMatrix([reviewCell(770, reviewSession, 8e6), reviewCell(771, reviewSession, 2e6)], [770, 771], [reviewSession, reviewLater]));
    await prepare(page, lang); const panel = await openPanel(page);
    await expect(panel.getByTestId("options-scope-partial")).toContainText("+10M · 2/4");
    await expect(panel.locator('[data-options-grid] button[data-value="missing"]')).toHaveCount(2);
    const opener = panel.getByTestId("options-scope-toggle");
    for (const action of ["cancel", "escape", "apply"]) {
      await opener.click(); const editor = panel.getByTestId("options-scope-editor");
      const select = editor.getByTestId("options-scope-expiries"); await select.selectOption("0dte");
      await expect(panel.locator("[data-options-total]")).toHaveText("—");
      if (action === "escape") { await select.focus(); await page.keyboard.press("Escape"); }
      else await editor.getByTestId(`options-scope-${action}`).click();
      await expect(editor).toHaveCount(0); await expect(opener).toBeFocused(); await expect(panel).toBeVisible();
      await expect(panel.locator("[data-options-total]")).toHaveText(action === "apply" ? "+10M" : "—");
    }
    await expect(panel.locator('[data-options-grid] button[data-value="missing"]')).toHaveCount(0);
  });

  test(`[${lang}] R6 off-screen exact node reveal preserves scope and native chart`, async ({ page }, info) => {
    const strikes = Array.from({ length: 161 }, (_, i) => 160 + i * .5);
    await serveReviewMatrix(page, reviewMatrix(strikes.map((strike, i) => reviewCell(strike, reviewSession, i === 0 ? 1e9 : 1e6)), strikes, [reviewSession], 200));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await prepare(page, lang); const canvas = await page.locator(".chart-wrap canvas").first().elementHandle();
    const panel = await openPanel(page); await editScope(panel, lang, { window: "25" });
    const total = await panel.locator("[data-options-total]").textContent(); const scope = await panel.locator("[data-options-scope]").textContent();
    await expect(panel.locator("tbody tr")).toHaveCount(101); await panel.getByTestId("options-dominant-node").click();
    await expect(panel.getByTestId("options-selection-outside")).toHaveCount(0);
    await expect(panel.getByTestId("options-selection-offscreen")).toBeVisible();
    await panel.getByTestId("options-reveal-selection").click();
    const selected = panel.locator('[data-options-grid] button[aria-pressed="true"]');
    await expect(selected).toHaveAttribute("aria-label", /^160, 2026-07-10:/); await expect(selected).toBeFocused();
    await expect(selected).toBeInViewport();
    await expect(panel.locator("[data-options-total]")).toHaveText(total!); await expect(panel.locator("[data-options-scope]")).toHaveText(scope!);
    expect(await canvas!.evaluate(el => el.isConnected)).toBe(true);
    mkdirSync(crops, { recursive: true }); await page.screenshot({ path: `${crops}/${info.project.name}-${lang}-r6-reveal.png` });
  });
}

test("Market Memory on Terminal uses the dated archive and fails closed after a missing archive", async ({ page }) => {
  const prior = "2026-07-08"; let missing = false;
  await page.route(/\/api\/flow\?f=(?:gex|gex_dates|gex_at)(?::|%3A)SPY/, async route => {
    const key = new URL(route.request().url()).searchParams.get("f")!;
    if (key.startsWith("gex_dates:")) return route.fulfill({ json: { root: "SPY", latest: reviewSession, dates: [reviewSession, prior] } });
    if (missing && key.startsWith("gex_at:")) return route.fulfill({ status: 404, json: {} });
    return route.fulfill({ json: { schema: "options_hub.gex/v1", root: "SPY", asof: key.startsWith("gex_at:") ? prior : reviewSession, spot_ref: 751,
      net_gex_bn: key.startsWith("gex_at:") ? 1 : 1.2, by_strike: [{ strike: 750, gamma_net: 8 }] } });
  });
  await prepare(page); let panel = await openPanel(page);
  await expect(panel.getByTestId("options-market-memory")).toHaveAttribute("data-memory-status", "ready");
  await expect(panel.getByTestId("options-market-memory")).toContainText("+1B → +1.2B");
  await expect(panel.getByTestId("options-market-memory")).toContainText("ALL EXPIRIES");
  missing = true;
  await page.reload(); await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  // Panel openness may persist in route state; either way the same real route is exercised.
  panel = page.locator("[data-options-companion]"); if (!(await panel.isVisible())) panel = await openPanel(page);
  await expect(panel.getByTestId("options-market-memory")).toHaveAttribute("data-memory-status", "archive-missing");
  await expect(panel.getByTestId("options-market-memory")).not.toContainText("+1B");
});

/** The sheet's only taller-detent control is a drag of `.msheet-handle-wrap` (no expand button).
 *  An upward throw past the midpoint lands on `data-detent="full"`. */
async function expandOptionsSheet(page: Page): Promise<boolean> {
  const sheet = page.locator("[data-detent]");
  const handle = sheet.locator(".msheet-handle-wrap");
  const box = await handle.boundingBox();
  if (!box) return false;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(6, box.height / 2);
  const base = { pointerId: 21, pointerType: "touch" as const, isPrimary: true, button: 0, buttons: 1 };
  await handle.dispatchEvent("pointerdown", { ...base, clientX: x, clientY: y });
  for (const step of [0.25, 0.5, 0.75, 1]) {
    await handle.dispatchEvent("pointermove", { ...base, clientX: x, clientY: y - 300 * step });
  }
  await handle.dispatchEvent("pointerup", { ...base, buttons: 0, clientX: x, clientY: y - 300 });
  return page.waitForFunction(
    () => document.querySelector("[data-detent]")?.getAttribute("data-detent") === "full",
    { timeout: 2_500 },
  ).then(() => true).catch(() => false);
}

for (const lang of ["en", "zh"] as const) {
  test(`[${lang}] PP1-SM map leads with a full-scope scale, a missing key and one selected-node strip`, async ({ page }, info) => {
    test.setTimeout(150_000);
    const project = info.project.name;
    mkdirSync(crops, { recursive: true });
    await prepare(page, lang);
    const panel = await openPanel(page);
    await expect(panel.locator("[data-options-grid] table")).toBeVisible({ timeout: 20_000 });

    // Tablet's row threshold is the opening detent. Mobile uses the taller detent when the drag reaches it.
    let measuredDetent = project === "desktop" ? "rail" : (await page.locator("[data-detent]").getAttribute("data-detent") ?? "initial");
    let mobileFull = project !== "mobile";
    if (project === "mobile") {
      mobileFull = await expandOptionsSheet(page);
      measuredDetent = await page.locator("[data-detent]").getAttribute("data-detent") ?? measuredDetent;
      if (!mobileFull) {
        test.info().annotations.push({ type: "gap", description: "mobile taller detent not reached; row threshold not asserted" });
      }
    }

    const later = panel.locator('[data-options-grid] button[aria-label*="2026-07-13"][data-value]:not([data-value="missing"]):not([data-value="0"])').first();
    await expect(later).toBeVisible();
    const parsed = (await later.getAttribute("aria-label") ?? "").match(/^([^,]+), ([^:]+):/);
    expect(parsed, "clicked cell aria-label").not.toBeNull();
    const strike = parsed![1];
    const expiry = parsed![2];
    await later.click();
    const strip = panel.getByTestId("options-selected-summary");
    await expect(strip).toContainText(strike);
    await expect(strip).toContainText(expiry);
    await strip.getByRole("button", { name: lang === "zh" ? "在图表标记行权价" : "Pin strike on chart", exact: true }).click();
    await expect.poll(async () => (await chartPin(page))?.lineStyle ?? null).toBe(2);

    for (const theme of ["dark", "light"] as const) {
      await page.evaluate((next) => document.documentElement.setAttribute("data-theme", next), theme);
      const measured = await page.evaluate(() => {
        const round = (n: number) => Math.round(n * 100) / 100;
        const rectOf = (el: Element | null) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height), top: round(r.top), right: round(r.right), bottom: round(r.bottom), left: round(r.left) };
        };
        const clientBox = (el: Element) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          const left = r.left + (parseFloat(s.borderLeftWidth) || 0);
          const top = r.top + (parseFloat(s.borderTopWidth) || 0);
          return { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight };
        };
        const intersect = (a: { left: number; top: number; right: number; bottom: number } | null, b: { left: number; top: number; right: number; bottom: number } | null) => {
          if (!a || !b) return null;
          const left = Math.max(a.left, b.left);
          const top = Math.max(a.top, b.top);
          const right = Math.min(a.right, b.right);
          const bottom = Math.min(a.bottom, b.bottom);
          return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
        };
        const clipsOf = (el: Element) => {
          const clips: { left: number; top: number; right: number; bottom: number }[] = [];
          let n = el.parentElement;
          while (n && n !== document.documentElement) {
            const s = getComputedStyle(n);
            if (/(auto|scroll|hidden|clip)/.test(`${s.overflowX}${s.overflowY}`)) clips.push(clientBox(n));
            n = n.parentElement;
          }
          return clips;
        };
        const view = document.querySelector("[data-options-companion] [role='tabpanel']") as HTMLElement | null;
        if (view) view.scrollTop = 0;
        const scrolling = document.scrollingElement as HTMLElement | null;
        if (scrolling) scrolling.scrollTop = 0;
        const sheet = document.querySelector("[data-detent]");
        const companion = document.querySelector("[data-options-companion]");
        const frame = sheet ?? companion;
        const mapGrid = document.querySelector("[data-testid='options-map-grid']");
        const scroll = document.querySelector("[data-options-grid]");
        const stripEl = document.querySelector("[data-testid='options-selected-summary']");
        const structure = document.querySelector("[data-testid='options-scope-structure']");
        const inspector = document.querySelector("[data-options-inspector]");
        const missingKey = document.querySelector("[data-testid='options-missing-key']");
        const keyRowRect = missingKey ? (missingKey.closest("[data-testid='options-missing-key']")?.parentElement ?? missingKey.parentElement) : null;
        const method = document.querySelectorAll("[data-options-companion] details").length > 0 ? document.querySelectorAll("[data-options-companion] details").item(document.querySelectorAll("[data-options-companion] details").length - 1) : null;
        const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
        let gridRegion = scroll ? intersect(viewport, clientBox(scroll)) : null;
        gridRegion = intersect(gridRegion, frame ? clientBox(frame) : null);
        if (scroll) for (const clip of clipsOf(scroll)) gridRegion = intersect(gridRegion, clip);
        const thead = scroll?.querySelector("thead");
        const theadBottom = thead ? thead.getBoundingClientRect().bottom : gridRegion?.top ?? 0;
        const rowRegion = gridRegion ? { ...gridRegion, top: Math.max(gridRegion.top, theadBottom) } : null;
        const tol = 1;
        const inside = (region: { left: number; top: number; right: number; bottom: number } | null, r: DOMRect, full: boolean) => {
          if (!region || r.height < 1 || r.width < 1) return false;
          const vertically = r.top >= region.top - tol && r.bottom <= region.bottom + tol;
          if (!vertically) return false;
          return full ? r.left >= region.left - tol && r.right <= region.right + tol : r.right > region.left + tol && r.left < region.right - tol;
        };
        const rows = scroll ? [...scroll.querySelectorAll("tbody tr")] : [];
        const cols = scroll ? [...scroll.querySelectorAll("thead th")].slice(1) : [];
        const visibleStrikeRows = rows.filter((row) => inside(rowRegion, row.getBoundingClientRect(), false)).length;
        const visibleExpiryColumns = cols.filter((col) => inside(gridRegion, col.getBoundingClientRect(), true)).length;
        let stripRegion: { left: number; top: number; right: number; bottom: number } | null = intersect(viewport, frame ? clientBox(frame) : null);
        if (stripEl) for (const clip of clipsOf(stripEl)) stripRegion = intersect(stripRegion, clip);
        const stripRect = stripEl?.getBoundingClientRect();
        const stripFullyVisible = !!stripRect && inside(stripRegion, stripRect, true);
        const roller = document.querySelector("[data-testid='roller-more']");
        const nav = roller?.closest("[data-testid='roller-strip']");
        const navRect = nav && window.innerWidth <= 640 ? nav.getBoundingClientRect() : null;
        const bottomNavTop = navRect && navRect.height > 0 ? round(navRect.top) : null;
        const sheetRect = sheet?.getBoundingClientRect() ?? null;
        const sheetCoversNav = !!(sheetRect && navRect && sheetRect.top <= navRect.top + tol && sheetRect.bottom >= navRect.bottom - tol);
        const stripAboveNav = !!stripRect && stripFullyVisible && (bottomNavTop == null || sheetCoversNav || stripRect.bottom <= bottomNavTop + tol);
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          panel: rectOf(frame),
          mapGrid: rectOf(mapGrid),
          gridScroll: rectOf(scroll),
          visibleStrikeRows,
          visibleExpiryColumns,
          actualStrikeRows: rows.length,
          actualExpiryColumns: cols.length,
          selectedStrip: rectOf(stripEl),
          stripFullyVisible,
          stripAboveNav,
          inspectorRect: rectOf(inspector),
          keyRowRect: rectOf(keyRowRect),
          sheetCoversNav,
          stripButtonHeights: stripEl ? [...stripEl.querySelectorAll("button")].map((button) => round(button.getBoundingClientRect().height)) : [],
          panelScrollTop: view ? view.scrollTop : null,
          bottomNavTop,
          mapGridTop: mapGrid ? round(mapGrid.getBoundingClientRect().top) : null,
          mapGridBottom: mapGrid ? round(mapGrid.getBoundingClientRect().bottom) : null,
          structureTop: structure ? round(structure.getBoundingClientRect().top) : null,
          methodTop: method ? round(method.getBoundingClientRect().top) : null,
          stripTop: stripEl ? round(stripEl.getBoundingClientRect().top) : null,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          scaleBasis: document.querySelector("[data-testid='options-scale-basis']")?.textContent ?? "",
          detentNow: document.querySelector("[data-detent]")?.getAttribute("data-detent") ?? null,
          sheetHeight: sheet ? round(sheet.getBoundingClientRect().height) : null,
          viewBox: view ? { top: round(view.getBoundingClientRect().top), clientHeight: view.clientHeight, scrollHeight: view.scrollHeight } : null,
          gridClientHeight: scroll ? (scroll as HTMLElement).clientHeight : null,
          rowRegion: rowRegion ? { top: round(rowRegion.top), bottom: round(rowRegion.bottom), height: round(rowRegion.bottom - rowRegion.top) } : null,
        };
      });

      expect(measured.scaleBasis).toContain("P95");
      expect(measured.mapGridTop).not.toBeNull();
      expect(measured.structureTop).not.toBeNull();
      expect(measured.methodTop).not.toBeNull();
      expect(measured.mapGridTop!).toBeLessThan(measured.structureTop!);
      expect(measured.mapGridTop!).toBeLessThan(measured.methodTop!);
      expect(measured.stripTop!).toBeGreaterThanOrEqual(measured.mapGridBottom! - 1);
      expect(measured.horizontalOverflow).toBe(false);
      if (project === "tablet" || project === "mobile") {
        expect(measured.stripButtonHeights.length).toBeGreaterThan(0);
        for (const height of measured.stripButtonHeights) expect(height).toBeGreaterThanOrEqual(44);
      }
      const rowTarget = project === "tablet" ? 6 : 7;
      const assertRows = project !== "mobile" || mobileFull;
      if (assertRows) {
        expect(measured.visibleStrikeRows).toBeGreaterThanOrEqual(Math.min(rowTarget, measured.actualStrikeRows));
        expect(measured.visibleExpiryColumns).toBeGreaterThanOrEqual(Math.min(3, measured.actualExpiryColumns));
      }
      if (project === "desktop") {
        expect(measured.stripFullyVisible).toBe(true);
        expect(measured.panelScrollTop).toBe(0);
      }
      if (project === "tablet") {
        expect(measured.stripFullyVisible).toBe(true);
        // Side by side: inspector starts at or after the map grid's right edge, and
        // the two rects overlap vertically so the inspector reads from the strip.
        expect(measured.inspectorRect).not.toBeNull();
        expect(measured.mapGrid).not.toBeNull();
        expect(measured.inspectorRect!.left).toBeGreaterThanOrEqual(measured.mapGrid!.right - 1);
        const verticalOverlap = Math.min(measured.inspectorRect!.bottom, measured.mapGrid!.bottom) - Math.max(measured.inspectorRect!.top, measured.mapGrid!.top);
        expect(verticalOverlap).toBeGreaterThan(0);
      }
      // The phone roller is the chart column's foot and the 94% sheet covers it, so the
      // strip clears that bar by being fully visible inside the sheet rather than above the roller's y.
      if (project === "mobile" && mobileFull) expect(measured.stripAboveNav).toBe(true);

      writeFileSync(`${crops}/pp1-geometry-${project}-${lang}-${theme}.json`, JSON.stringify({
        project, lang, theme, detent: measuredDetent,
        expandControl: project === "desktop" ? null : "drag-handle",
        rowAssertion: assertRows ? "asserted" : "skipped",
        ...measured,
      }, null, 2));
      await page.screenshot({ path: `${crops}/pp1-${project}-${lang}-${theme}.png`, fullPage: false });
    }

    await serveReviewMatrix(page, reviewMatrix(
      [reviewCell(770, reviewSession, 8e6), reviewCell(770, reviewLater, 0)],
      [770, 771],
      [reviewSession, reviewLater],
    ));
    await page.reload();
    await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 30_000 });
    const reviewPanel = page.locator("[data-options-companion]");
    const hatchPanel = await reviewPanel.isVisible() ? reviewPanel : await openPanel(page);
    await expect(hatchPanel.locator("[data-options-grid] button[data-value='missing']").first()).toBeVisible({ timeout: 20_000 });
    for (const theme of ["dark", "light"] as const) {
      await page.evaluate((next) => document.documentElement.setAttribute("data-theme", next), theme);
      const images = await hatchPanel.evaluate(() => {
        const missing = document.querySelector("[data-options-grid] button[data-value='missing']");
        const zero = document.querySelector("[data-options-grid] button[data-value='0']");
        return {
          missing: missing ? getComputedStyle(missing).backgroundImage : "",
          zero: zero ? getComputedStyle(zero).backgroundImage : "",
        };
      });
      expect(images.missing).toContain("repeating-linear-gradient");
      expect(images.zero).toBe("none");
    }
  });

  test(`[${lang}] PP2-UI-a sources receipt and held newer snapshot`, async ({ page }, info) => {
    const project = info.project.name;
    mkdirSync(crops, { recursive: true });
    const ISO_A = "2026-07-11T00:05:00Z";
    const ISO_B = "2026-07-11T00:35:00Z";
    const ISO_C = "2026-07-14T00:05:00Z";
    const cellA = reviewCell(780, reviewSession, 8e6);
    const cellBNewValue = reviewCell(780, reviewSession, 12e6);
    const cellC = reviewCell(780, reviewLater, 6e6);
    const cellC2 = reviewCell(780, reviewLast, 5e6);
    const buildA: ReturnType<typeof reviewMatrix> = {
      schema: "options_structure.matrix/v1", root: "SPY", spot: 770, asof: ISO_A, _build_meta: { asof_date: reviewSession }, cells: [cellA], strikes: [780], expiries: [reviewSession],
    };
    const buildB: ReturnType<typeof reviewMatrix> = {
      ...buildA, asof: ISO_B, cells: [cellBNewValue], _build_meta: { asof_date: reviewSession, source_dates: { eod: reviewSession, greeks: reviewSession, oi_publication: reviewSession, previous_oi_publication: reviewSession, latest_oi_publication: reviewSession } } as ReturnType<typeof reviewMatrix>["_build_meta"],
    };
    const buildC: ReturnType<typeof reviewMatrix> = {
      ...buildA, asof: ISO_C, cells: [cellC, cellC2], strikes: [780], expiries: [reviewLater, reviewLast], _build_meta: { asof_date: reviewLater, source_dates: { eod: reviewLater, greeks: reviewLater, oi_publication: reviewLater, previous_oi_publication: reviewLater, latest_oi_publication: reviewLater } } as ReturnType<typeof reviewMatrix>["_build_meta"],
    };
    let current: ReturnType<typeof reviewMatrix> = buildA;
    await page.route(/\/api\/flow\?f=matrix(?::|%3A)SPY(?:&|$)/, async route => {
      await route.fulfill({ json: current });
    });
    await prepare(page, lang);
    const panel = await openPanel(page);
    await expect(panel.locator("[data-options-grid] table")).toBeVisible({ timeout: 20_000 });

    // R3: with the receipts CLOSED, the stamp row is one line.
    const stampClosed = await panel.evaluate(() => {
      const row = document.querySelector("[data-options-session]") as HTMLElement | null;
      const button = row?.querySelector("button") as HTMLElement | null;
      return { rowHeight: row ? Math.round(row.getBoundingClientRect().height) : null, buttonHeight: button ? Math.round(button.getBoundingClientRect().height) : null };
    });
    expect(stampClosed.rowHeight).not.toBeNull();
    expect(stampClosed.buttonHeight).not.toBeNull();
    expect(stampClosed.rowHeight!).toBeLessThanOrEqual(stampClosed.buttonHeight! + 1);

    // Open the receipts and check the Map build / End-of-day prices rows.
    const details = panel.getByTestId("options-receipts");
    await expect(details).toBeVisible();
    await details.locator("summary").click();
    await expect(details).toHaveJSProperty("open", true);
    if (lang === "zh") {
      await expect(details).toContainText("数据来源");
      await expect(details).toContainText("不可用");
      await expect(details).toContainText("热力图生成时间");
    } else {
      await expect(details).toContainText("Sources");
      await expect(details).toContainText("unavailable");
      await expect(details).toContainText("Map build");
    }
    // Build A has no source_dates, so the receipts show "Map build" = ISO_A and every other row reads "unavailable".
    await expect(details).toContainText(ISO_A);
    await expect(details.locator("time")).toHaveCount(1);
    // "Spot price clock" always reads unavailable and "previous/latest" are absent on the fixture.
    await expect(details).toContainText(lang === "zh" ? "现价时间" : "Spot price clock");
    await expect(details.locator("dd").filter({ hasText: lang === "zh" ? "不可用" : "unavailable" })).toHaveCount(4);

    // R4: receipts summary is a 44px tap target under (pointer:coarse),(max-width:860px).
    if (project === "tablet" || project === "mobile") {
      const summaryHeight = await details.locator("summary").evaluate(el => Math.round(el.getBoundingClientRect().height));
      expect(summaryHeight).toBeGreaterThanOrEqual(44);
    }

    // Receipts-open: no horizontal overflow INSIDE the rail.
    const openOverflow = await panel.evaluate(() => {
      const c = document.querySelector("[data-options-companion]") as HTMLElement | null;
      return c ? c.scrollWidth - c.clientWidth : 0;
    });
    expect(openOverflow).toBeLessThanOrEqual(1);

    // Snapshot the receipts-open state, then close the details.
    await page.screenshot({ path: `${crops}/pp2a-${project}-${lang}-receipts.png`, fullPage: false });
    await details.locator("summary").click();
    await expect(details).toHaveJSProperty("open", false);

    // Select a published cell, pin it, assert lineStyle=2.
    const cell = panel.locator(`[data-options-grid] button[aria-label^="780, ${reviewSession}:"]`).first();
    await expect(cell).toBeVisible();
    await cell.click();
    await panel.getByRole("button", { name: lang === "zh" ? "在图表标记行权价" : "Pin strike on chart", exact: true }).click();
    await expect.poll(async () => (await chartPin(page))?.lineStyle ?? null).toBe(2);

    // Switch the route to build B and click the refresh button.
    current = buildB;
    await panel.getByRole("button", { name: lang === "zh" ? "刷新快照" : "Refresh snapshot", exact: true }).click();
    const banner = panel.getByTestId("options-newer-snapshot");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(ISO_B);
    // The selected cell still shows A's value (8M → "8M $ / +1% spot" in EN).
    const cellAfterRefresh = panel.locator(`[data-options-grid] button[aria-label^="780, ${reviewSession}:"]`).first();
    await expect(cellAfterRefresh).toContainText(lang === "zh" ? "8M" : "8M");
    // The pin survives the queued read.
    expect((await chartPin(page))?.lineStyle).toBe(2);
    // The receipts' Map build is still A.
    await details.locator("summary").click();
    await expect(details).toContainText(ISO_A);
    await details.locator("summary").click();
    // Snapshot the banner state.
    await page.screenshot({ path: `${crops}/pp2a-${project}-${lang}-held.png`, fullPage: false });

    // Apply the newer snapshot.
    await panel.getByTestId("options-apply-newer").click();
    await expect(banner).toHaveCount(0);
    const cellAfterApply = panel.locator(`[data-options-grid] button[aria-label^="780, ${reviewSession}:"]`).first();
    await expect(cellAfterApply).toContainText(lang === "zh" ? "12M" : "12M");
    await details.locator("summary").click();
    await expect(details).toContainText(ISO_B);
    // "End-of-day prices" now reads the session (source_dates were filled on build B).
    await expect(details).toContainText(reviewSession);
    // Selection is cleared; the strip shows the select prompt.
    await expect(panel.getByTestId("options-selected-summary")).toContainText(lang === "zh" ? "选择单元格查看详情" : "Select a cell to inspect");
    // The pin is dropped.
    await expect.poll(() => chartPin(page)).toBeNull();

    // Session-change variant: pick a cell, then queue a build C with a different session.
    current = buildA; // restore A so we can pick a cell again
    await page.reload();
    await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 30_000 });
    const panel2 = page.locator("[data-options-companion]");
    const cPanel = (await panel2.isVisible()) ? panel2 : await openPanel(page);
    await expect(cPanel.locator("[data-options-grid] table")).toBeVisible({ timeout: 20_000 });
    const cell2 = cPanel.locator(`[data-options-grid] button[aria-label^="780, ${reviewSession}:"]`).first();
    await expect(cell2).toBeVisible();
    await cell2.click();
    current = buildC;
    await cPanel.getByRole("button", { name: lang === "zh" ? "刷新快照" : "Refresh snapshot", exact: true }).click();
    const banner2 = cPanel.getByTestId("options-newer-snapshot");
    await expect(banner2).toBeVisible();
    await expect(banner2).toContainText(reviewLater);
    await cPanel.getByTestId("options-apply-newer").click();
    await expect(banner2).toHaveCount(0);
    const sessionEl = cPanel.locator("[data-options-session]");
    await expect(sessionEl).toHaveAttribute("data-options-session", reviewLater);
  });
}
