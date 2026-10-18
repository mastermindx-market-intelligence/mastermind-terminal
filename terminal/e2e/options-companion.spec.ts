import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import matrixFixture from "../public/data/matrix_fixture.json";
type ChartDebugWindow = Window & {
  __mmChartAxisOpts?: () => { rowCount: number; optionsPin: { price: number; lineStyle: number } | null };
  __mmChartOwnership?: () => { orphanPricePaneLines: number; orphanSeries: number; pricePaneLines: number; trackedPricePaneLines: number; live: { priceLines: number; series: number } };
  __mmOptionsReady?: { symbol: string; timeframe: string; state: string; generation: number }[];
};
const crops = process.env.OPTIONS_COMPANION_CROPS || "docs/pr-crops/options-companion-20260923";
const spy = matrixFixture.SPY;
test.setTimeout(90_000);

async function controlPaint(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-options-companion]');
    const controls = { gamma: root?.querySelector('[role="tab"][aria-selected="true"]'),
      removePin: root?.querySelector('[data-testid="options-selected-summary"] button[aria-pressed="true"]'),
      inspect: root?.querySelector('[data-testid="options-inspect-node"]') };
    const rgb = (value: string) => { const m = value.match(/^rgba?\(([^)]+)\)$/); if (!m) return null; const n = m[1].split(/[, /]+/).map(Number); return n.length >= 3 ? [n[0], n[1], n[2], n[3] ?? 1] : null; };
    const luminance = (c: number[]) => c.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
    return Object.fromEntries(Object.entries(controls).map(([key, el]) => {
      if (!el) return [key, null];
      const style = getComputedStyle(el), ancestors = [];
      for (let n: Element | null = el; n; n = n.parentElement) { const s = getComputedStyle(n); ancestors.push({ tag: n.tagName, background: s.backgroundColor, opacity: s.opacity }); }
      let bg = [255, 255, 255];
      for (const a of [...ancestors].reverse()) { const c = rgb(a.background); if (c) bg = bg.map((v, i) => c[i] * c[3] + v * (1 - c[3])); }
      const fg = rgb(style.color), measurable = fg && ancestors.every(a => Number(a.opacity) === 1);
      const paintedFg = fg ? bg.map((v, i) => fg[i] * fg[3] + v * (1 - fg[3])) : null;
      const a = paintedFg ? luminance(paintedFg) : 0, b = luminance(bg);
      return [key, { text: el.textContent, foreground: style.color, background: style.backgroundColor,
        ancestors, effectiveBackground: bg, disabled: (el as HTMLButtonElement).disabled, ariaDisabled: el.getAttribute('aria-disabled'),
        opacity: style.opacity, contrast: measurable ? (Math.max(a, b) + .05) / (Math.min(a, b) + .05) : null }];
    }));
  });
}

async function prepare(page: Page, lang = "en", symbol = "SPY") {
  await page.addInitScript((locale) => {
    localStorage.setItem("mm.lang", locale); localStorage.removeItem("mm.optionsCompanion.v1");
    document.documentElement?.setAttribute("data-lang", locale);
    const target = window as ChartDebugWindow;
    target.__mmOptionsReady = [];
    window.addEventListener("mm:terminal-visual-ready", (event) => target.__mmOptionsReady!.push((event as CustomEvent).detail));
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
  // Use testids instead of label text: the PP2-UI-c preset-mode radio shares the
  // word "Strike window" with the preset's select, which made getByLabel match both
  // and trip strict mode after the radio group was introduced.
  if (change.expiries) await editor.getByTestId("options-scope-expiries").selectOption(change.expiries);
  if (change.norm) await editor.getByTestId("options-scope-norm").selectOption(change.norm);
  if (change.window) await editor.getByTestId("options-scope-window").selectOption(change.window);
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
    if (info.project.name === "desktop" && lang === "en") {
      const samples: unknown[] = [];
      const readyGeneration = () => page.evaluate(() => Math.max(-1, ...(window as ChartDebugWindow).__mmOptionsReady?.filter(e => e.symbol === "SPY" && e.state === "data").map(e => e.generation) ?? []));
      await expect.poll(readyGeneration, { timeout: 30_000 }).toBeGreaterThanOrEqual(0);
      await expect(page.locator('.chart-type-pop .chart-type-row:has(span:text-is("Candles"))')).toHaveClass(/\bon\b/);
      const census = () => page.evaluate(() => (window as ChartDebugWindow).__mmChartOwnership?.() ?? null);
      const qualifyPin = async (label: string) => {
        await expect.poll(async () => (await chartPin(page))?.price).toBe(pinned.price);
        await expect.poll(async () => { const c = await census(); return c != null && c.orphanSeries === 0 && c.orphanPricePaneLines === 0 && c.pricePaneLines === c.trackedPricePaneLines; }).toBe(true);
        const withPin = (await census())!;
        await panel.getByRole("button", { name: "Remove chart pin", exact: true }).click();
        await expect.poll(() => chartPin(page)).toBeNull();
        await expect.poll(async () => { const c = await census(); return c != null && c.pricePaneLines === withPin.pricePaneLines - 1 && c.live.priceLines === withPin.live.priceLines - 1 && c.orphanPricePaneLines === 0; }).toBe(true);
        const withoutPin = (await census())!;
        await panel.getByRole("button", { name: "Pin strike on chart", exact: true }).click();
        await expect.poll(async () => (await chartPin(page))?.price).toBe(pinned.price);
        await expect.poll(async () => { const c = await census(); return c != null && c.pricePaneLines === withoutPin.pricePaneLines + 1 && c.live.priceLines === withoutPin.live.priceLines + 1 && c.orphanSeries === 0 && c.orphanPricePaneLines === 0; }).toBe(true);
        samples.push({ label, withPin, withoutPin, repinned: await census() });
      };
      await qualifyPin("candles before switch");
      const baseline = (await census())!;
      for (const kind of ["Line", "Candles"]) {
        const priorGeneration = await readyGeneration();
        const since = await page.evaluate(() => (window as ChartDebugWindow).__mmOptionsReady?.length ?? 0);
        await page.locator(".pophost:has(.chart-type-pop) > button.tbtn").first().click();
        await page.locator(`.chart-type-row:has(span:text-is("${kind}"))`).first().click();
        await expect(page.locator(`.chart-type-pop .chart-type-row:has(span:text-is("${kind}"))`)).toHaveClass(/\bon\b/);
        await expect.poll(() => page.evaluate(({ from, previous }) => (window as ChartDebugWindow).__mmOptionsReady?.slice(from).some(e => e.symbol === "SPY" && e.state === "data" && e.generation > previous) ?? false, { from: since, previous: priorGeneration }), { timeout: 30_000 }).toBe(true);
        samples.push({ selectedChartType: kind, priorGeneration, settledGeneration: await readyGeneration() });
        await qualifyPin(kind);
        const current = (await census())!;
        expect(current.live.series, "settled replacement does not strand an old series").toBe(baseline.live.series);
        expect(current.orphanSeries).toBe(0);
        expect(await originalCanvas!.evaluate((canvas) => canvas.isConnected)).toBe(true);
      }
      mkdirSync(crops, { recursive: true });
      writeFileSync(`${crops}/engine-owned-pin-candles-line-candles.json`, JSON.stringify({
        sourceHead: process.env.OPTIONS_SOURCE_HEAD, sourceDiffSha256: process.env.OPTIONS_SOURCE_DIFF_SHA256,
        testEnvironment: "dev/e2e ownership hooks; production remains disabled", samples,
      }, null, 2));
    }
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
    undefined, { timeout: 2_500 },
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
      expect(mobileFull, "phone actual FULL detent is required for row proof").toBe(true);
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
      const paintAtThemeChange = await controlPaint(page);
      await page.waitForTimeout(250);
      const paintSettled = await controlPaint(page);
      writeFileSync(`${crops}/control-paint-${project}-${lang}-${theme}.json`, JSON.stringify({
        project, lang, theme, themeActivation: theme === "light" ? "isolated html data-theme compatibility probe" : "supported dark UI",
        sourceHead: process.env.OPTIONS_SOURCE_HEAD, sourceDiffSha256: process.env.OPTIONS_SOURCE_DIFF_SHA256,
        atThemeChange: paintAtThemeChange, settled250ms: paintSettled,
      }, null, 2));
      for (const [name, paint] of Object.entries(paintSettled)) {
        expect(paint, `${name} exists`).not.toBeNull();
        expect(paint!.disabled, `${name} enabled`).toBe(false);
        expect(paint!.contrast, `${name} settled contrast measurable`).not.toBeNull();
        expect(paint!.contrast!, `${name} settled contrast >= 4.5`).toBeGreaterThanOrEqual(4.5);
      }
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
        // Sticky th cells occlude rows even after their thead has scrolled away.
        const theadBottom = Math.max(gridRegion?.top ?? 0, ...[...scroll?.querySelectorAll("thead th") ?? []]
          .map((cell) => cell.getBoundingClientRect().bottom));
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

    // PP2-UI-c item 4b (closed): the stamp row does not overflow horizontally;
    // every direct child sits inside the row's right edge.
    const closedRow = await panel.evaluate(() => {
      const row = document.querySelector("[data-options-session]") as HTMLElement | null;
      if (!row) return null;
      const r = row.getBoundingClientRect();
      const children = [...row.querySelectorAll<HTMLElement>(":scope > *")].map((el) => {
        const cr = el.getBoundingClientRect();
        return { right: Math.round(cr.right), bottom: Math.round(cr.bottom) };
      });
      return { rowRight: Math.round(r.right), scrollWidth: row.scrollWidth, clientWidth: row.clientWidth, children };
    });
    expect(closedRow).not.toBeNull();
    expect(closedRow!.scrollWidth).toBeLessThanOrEqual(closedRow!.clientWidth + 1);
    for (const child of closedRow!.children) {
      expect.soft(child.right).toBeLessThanOrEqual(closedRow!.rowRight + 1);
    }

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

    // PP2-UI-c item 4b (open): the <details> box drops to its own line and fits
    // the row's right edge; the tabpanel itself never overflows horizontally.
    const openRow = await panel.evaluate(() => {
      const row = document.querySelector("[data-options-session]") as HTMLElement | null;
      const details = row?.querySelector("details") as HTMLElement | null;
      const button = row?.querySelector("button") as HTMLElement | null;
      const tabpanel = document.querySelector("[data-options-companion] [role='tabpanel']") as HTMLElement | null;
      if (!row || !details || !button || !tabpanel) return null;
      const dr = details.getBoundingClientRect();
      const br = button.getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      return {
        detailsTop: Math.round(dr.top), buttonBottom: Math.round(br.bottom),
        detailsRight: Math.round(dr.right), rowRight: Math.round(rr.right),
        tabpanelScroll: tabpanel.scrollWidth - tabpanel.clientWidth,
      };
    });
    expect(openRow).not.toBeNull();
    expect.soft(openRow!.detailsTop).toBeGreaterThanOrEqual(openRow!.buttonBottom - 1);
    expect.soft(openRow!.detailsRight).toBeLessThanOrEqual(openRow!.rowRight + 1);
    // PP2-UI-c repair 1 (R3): the open <details> must span the full row width.
    // With `.receipts[open]{flex:none}` the box shrinks to its content width and
    // the right edge falls short of the row's right edge — this is the falsifier.
    expect(openRow!.detailsRight).toBeGreaterThanOrEqual(openRow!.rowRight - 1);
    expect.soft(openRow!.tabpanelScroll).toBeLessThanOrEqual(1);

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

  test(`[${lang}] PP2-UI-c exact scope`, async ({ page }, info) => {
    const project = info.project.name;
    mkdirSync(crops, { recursive: true });
    // Declared-grid fixture with strikes [770..774] × expiries [session, later, last].
    // All 15 positions publish a value, so the exact-scope total is 15/15.
    const pp2cStrikes = [770, 771, 772, 773, 774];
    const pp2cCellValues: Array<[number, string, number]> = [
      [770, reviewSession, 1e6], [771, reviewSession, 2e6], [772, reviewSession, 3e6], [773, reviewSession, 4e6], [774, reviewSession, 5e6],
      [770, reviewLater, 1e6], [771, reviewLater, -1e6], [772, reviewLater, 2e6], [773, reviewLater, -2e6], [774, reviewLater, 3e6],
      [770, reviewLast, 5e5], [771, reviewLast, -5e5], [772, reviewLast, 1e6], [773, reviewLast, -1e6], [774, reviewLast, 5e5],
    ];
    const pp2cCells = pp2cCellValues.map(([s, e, g]) => reviewCell(s, e, g));
    await serveReviewMatrix(page, reviewMatrix(pp2cCells, pp2cStrikes, [reviewSession, reviewLater, reviewLast]));
    await prepare(page, lang);
    const panel = await openPanel(page);
    await expect(panel.locator("[data-options-grid] table")).toBeVisible({ timeout: 20_000 });

    // Open the scope editor and switch to exact mode. The four inputs prefill
    // from the APPLIED scope (preset mode's 3 nearest expiries × 5 displayed strikes).
    await panel.getByTestId("options-scope-toggle").click();
    await expect(panel.getByTestId("options-scope-editor")).toBeVisible();
    await panel.getByTestId("options-scope-mode-exact").click();
    await expect(panel.getByTestId("options-scope-from")).toHaveValue("770");
    await expect(panel.getByTestId("options-scope-to")).toHaveValue("774");
    await expect(panel.getByTestId("options-scope-dte-min")).toHaveValue("0");
    await expect(panel.getByTestId("options-scope-dte-max")).toHaveValue("4");

    // Inverted range blocks Apply and shows the issue sentence.
    const fromInput = panel.getByTestId("options-scope-from");
    const toInput = panel.getByTestId("options-scope-to");
    await fromInput.fill("774");
    await toInput.fill("770");
    await expect(panel.getByTestId("options-scope-apply")).toBeDisabled();
    await expect(panel.getByTestId("options-scope-issues")).toBeVisible();
    if (lang === "zh") {
      await expect(panel.getByTestId("options-scope-issues")).toContainText("不得超过");
    } else {
      await expect(panel.getByTestId("options-scope-issues")).toContainText("must not exceed");
    }
    await page.screenshot({ path: `${crops}/pp2c-${project}-${lang}-invalid.png`, fullPage: false });

    // Fix the range and assert the preview text.
    await fromInput.fill("770");
    await toInput.fill("774");
    await panel.getByTestId("options-scope-dte-min").fill("0");
    await panel.getByTestId("options-scope-dte-max").fill("4");
    await expect(panel.getByTestId("options-scope-apply")).toBeEnabled();
    await expect(panel.getByTestId("options-scope-preview")).toContainText(
      lang === "zh" ? "5 个行权价 · 3 个到期日 · 0–4 到期天数" : "5 strikes · 3 expiries · 0–4 days to expiry",
    );

    // Apply.
    await panel.getByTestId("options-scope-apply").click();
    await expect(panel.getByTestId("options-scope-editor")).toHaveCount(0);
    await expect(panel.locator("[data-options-scope]")).toHaveAttribute("data-options-scope", "applied");
    await expect(panel.locator("[data-options-scope-mode]")).toHaveAttribute("data-options-scope-mode", "exact");
    await expect(panel.getByTestId("options-scope-toggle")).toBeFocused();
    expect(await panel.locator("[data-options-grid] tbody tr").count()).toBe(5);
    expect(await panel.locator("[data-options-grid] thead th").count() - 1).toBe(3);
    // All 15 positions publish a value: known/expected = 15/15.
    await expect(panel.locator("[data-options-total]").locator("..")).toContainText("15/15");
    await page.screenshot({ path: `${crops}/pp2c-${project}-${lang}-applied.png`, fullPage: false });

    // Reopen, edit, press Escape: applied range is unchanged, focus is on the toggle.
    await panel.getByTestId("options-scope-toggle").click();
    await expect(panel.getByTestId("options-scope-editor")).toBeVisible();
    await panel.getByTestId("options-scope-from").fill("771");
    await panel.getByTestId("options-scope-from").press("Escape");
    await expect(panel.getByTestId("options-scope-editor")).toHaveCount(0);
    await expect(panel.getByTestId("options-scope-toggle")).toBeFocused();
    await expect(panel.getByTestId("options-scope-meta")).toContainText("770–774");

    // PP2-UI-c repair 1 (R1 + R2): the norm select is also visible in exact mode.
    // Reopen, assert exactly one norm select, switch to "Per expiry" / "各到期日",
    // Apply, and verify the scope meta and mode are unchanged. Then assert no
    // localStorage value contains any of the four typed strings.
    await panel.getByTestId("options-scope-toggle").click();
    await expect(panel.getByTestId("options-scope-editor")).toBeVisible();
    const normSelects = panel.locator('[data-testid="options-scope-norm"]');
    expect(await normSelects.count()).toBe(1);
    await expect(normSelects).toBeVisible();
    await normSelects.selectOption({ label: lang === "zh" ? "各到期日" : "Per expiry" });
    await panel.getByTestId("options-scope-apply").click();
    await expect(panel.getByTestId("options-scope-editor")).toHaveCount(0);
    await expect(panel.locator("[data-options-scope-mode]")).toHaveAttribute("data-options-scope-mode", "exact");
    await expect(panel.getByTestId("options-scope-meta")).toContainText(lang === "zh" ? "各到期日" : "Per expiry");
    const localStorageLeak = await page.evaluate(() => {
      // Same invariant the (u9) vitest test asserts: the four typed values never
      // appear as JSON pairs of from/to/dteMin/dteMax. The raw substrings "0" and
      // "4" would falsely match unrelated chart settings, so check the typed
      // strings in the context they were typed in.
      const pairs = ['"from":"770"', '"to":"774"', '"dteMin":"0"', '"dteMax":"4"'];
      const hits: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const value = localStorage.getItem(key) ?? "";
        for (const p of pairs) if (value.includes(p)) hits.push(`${key}:${p}`);
      }
      return hits;
    });
    expect(localStorageLeak).toEqual([]);

    // Touch targets and overflow check on tablet/mobile.
    if (project === "tablet" || project === "mobile") {
      await panel.getByTestId("options-scope-toggle").click();
      const editor = panel.getByTestId("options-scope-editor");
      const measurements = await editor.evaluate((root) => {
        const inputs = [...root.querySelectorAll<HTMLInputElement>("input[type='text']")];
        const radios = [...root.querySelectorAll<HTMLInputElement>("input[type='radio']")]
          .map((radio) => radio.closest("label"))
          .filter((el): el is HTMLLabelElement => el != null);
        const all = [...inputs, ...radios];
        return {
          scrollOverflow: root.scrollWidth - root.clientWidth,
          heights: all.map((el) => Math.round(el.getBoundingClientRect().height)),
        };
      });
      for (const h of measurements.heights) expect(h).toBeGreaterThanOrEqual(44);
      expect(measurements.scrollOverflow).toBeLessThanOrEqual(1);
    }
  });
}

// Contract falsifiers 4, 5, 9, 10 and the Codex build-identity edge (#723).
for (const lang of ["en", "zh"] as const) {
  test(`[${lang}] PP2-UI-b chart return keeps held build identity`, async ({ page }, info) => {
    test.setTimeout(150_000);
    const project = info.project.name;
    mkdirSync(crops, { recursive: true });
    // Declared-grid fixture: 25 strikes [740..800 step 2.5] × 3 expiries (reviewSession,
    // reviewLater, reviewLast). Spot 770. Every cell a nonzero `gex`.
    const pp2bStrikes: number[] = [];
    for (let s = 740; s <= 800; s += 2.5) pp2bStrikes.push(s);
    const pp2bExpiries = [reviewSession, reviewLater, reviewLast];
    const pp2bCellsBase: Array<{ strike: number; expiry: string; gex: number }> = [];
    let n = 1;
    for (const s of pp2bStrikes) for (const e of pp2bExpiries) {
      pp2bCellsBase.push({ strike: s, expiry: e, gex: n++ * 1e6 });
    }
    const valueA = 8_000_000;
    const valueB = 12_000_000;
    const cellAt = (strike: number, expiry: string, value: number) => ({
      strike, expiry, gex: value, call_oi: 0, put_oi: 0, call_vol: 0, put_vol: 0,
    });
    const buildACells = pp2bCellsBase.map((cell) =>
      cell.strike === 780 && cell.expiry === reviewSession ? cellAt(780, reviewSession, valueA) : cell,
    );
    const buildBCells = pp2bCellsBase.map((cell) =>
      cell.strike === 780 && cell.expiry === reviewSession ? cellAt(780, reviewSession, valueB) : cell,
    );
    const buildCCells = pp2bCellsBase
      .filter((cell) => cell.expiry === reviewLater || cell.expiry === reviewLast)
      .map((cell) => cell.strike === 780 && cell.expiry === reviewLater ? cellAt(780, reviewLater, 6e6) : cell);
    const ISO_A = "2026-07-11T00:05:00Z";
    const ISO_B = "2026-07-11T00:35:00Z";
    const ISO_C = "2026-07-14T00:05:00Z";
    const buildA = {
      schema: "options_structure.matrix/v1", root: "SPY", spot: 770, asof: ISO_A,
      _build_meta: { asof_date: reviewSession },
      cells: buildACells, strikes: pp2bStrikes, expiries: pp2bExpiries,
    };
    const buildB = {
      ...buildA, asof: ISO_B, cells: buildBCells,
      _build_meta: { asof_date: reviewSession, source_dates: { eod: reviewSession, greeks: reviewSession, oi_publication: reviewSession, previous_oi_publication: reviewSession, latest_oi_publication: reviewSession } },
    };
    const buildC = {
      ...buildA, asof: ISO_C, cells: buildCCells, strikes: [780], expiries: [reviewLater, reviewLast],
      _build_meta: { asof_date: reviewLater, source_dates: { eod: reviewLater, greeks: reviewLater, oi_publication: reviewLater, previous_oi_publication: reviewLater, latest_oi_publication: reviewLater } },
    };
    let current: typeof buildA = buildA;
    await page.route(/\/api\/flow\?f=matrix(?::|%3A)SPY(?:&|$)/, async (route) => {
      await route.fulfill({ json: current });
    });
    await prepare(page, lang);
    const panel = await openPanel(page);
    await expect(panel.locator("[data-options-grid] table")).toBeVisible({ timeout: 20_000 });
    {
      const [, ] = await Promise.all([
        page.waitForResponse(/\/api\/flow\?f=matrix(?::|%3A)SPY/, { timeout: 10_000 }),
        panel.getByRole("button", { name: lang === "zh" ? "刷新快照" : "Refresh snapshot", exact: true }).click(),
      ]);
    }
    const cell = panel.locator('[data-options-grid] button[aria-label^="780, 2026-07-10:"]').first();
    await expect(cell).toBeVisible();
    await cell.click();
    const summaryTextBeforePark = await panel.getByTestId("options-selected-summary").innerText();

    if (project === "tablet" || project === "mobile") {
      expect(await expandOptionsSheet(page), "sheet actually reaches FULL detent").toBe(true);
      const detentBefore = await page.locator("[data-detent]").getAttribute("data-detent");
      expect(detentBefore).toBe("full");

      await page.evaluate(() => {
        const root = document.querySelector("[data-options-companion]") as HTMLElement | null;
        if (root) (root as unknown as { __pp2bExpando: true }).__pp2bExpando = true;
        const canvas = document.querySelector(".chart-wrap canvas") as HTMLElement | null;
        if (canvas) (canvas as unknown as { __pp2bCanvasExpando: true }).__pp2bCanvasExpando = true;
        // The scan is scoped to the SHEET ROOT — the parked surface whose scroll offsets
        // must survive park → return — not to the whole document.
        const sheetRoot = document.querySelector("[data-detent]") as HTMLElement | null;
        const overflowed: HTMLElement[] = [];
        const scan = (el: Element) => {
          const ce = el as HTMLElement;
          const cs = getComputedStyle(el);
          if (el !== sheetRoot && (cs.overflowX === "auto" || cs.overflowX === "scroll" || cs.overflowY === "auto" || cs.overflowY === "scroll")) {
            if (ce.scrollHeight > ce.clientHeight + 1 || ce.scrollWidth > ce.clientWidth + 1) overflowed.push(ce);
          }
          for (const child of Array.from(el.children)) scan(child);
        };
        if (sheetRoot) scan(sheetRoot);
        const stored: Array<{ el: HTMLElement; scrollTop: number; scrollLeft: number }> = [];
        for (const el of overflowed) {
          el.scrollTop = Math.min(40, el.scrollHeight - el.clientHeight);
          el.scrollLeft = Math.min(40, el.scrollWidth - el.clientWidth);
          stored.push({ el, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft });
        }
        (window as unknown as { __pp2bScrollers: typeof stored }).__pp2bScrollers = stored;
      });
      const showBtn = page.locator('[data-testid="options-show-on-chart"]');
      await expect(showBtn).toBeVisible();
      await showBtn.scrollIntoViewIfNeeded();
      const offsetSnapshot = await page.evaluate(() => {
        const stored = (window as unknown as { __pp2bScrollers: Array<{ el: HTMLElement; scrollTop: number; scrollLeft: number }> }).__pp2bScrollers;
        if (!stored) return null;
        return stored.map((entry) => {
          entry.scrollTop = entry.el.scrollTop;
          entry.scrollLeft = entry.el.scrollLeft;
          return { recordedTop: entry.scrollTop, recordedLeft: entry.scrollLeft, beforeTop: entry.scrollTop, beforeLeft: entry.scrollLeft };
        });
      });
      expect(offsetSnapshot).not.toBeNull();
      // Vacuity guard: the sheet must hold at least one scrollable element with a
      // RECORDED NONZERO offset — a count of scrollers alone proves nothing.
      expect(offsetSnapshot!.length).toBeGreaterThanOrEqual(1);
      expect(offsetSnapshot!.some((o) => o.beforeTop !== 0 || o.beforeLeft !== 0)).toBe(true);

      await showBtn.click();
      const chip = page.locator('[data-testid="options-chart-return"]');
      await expect(chip).toBeVisible();
      await expect(chip).toBeFocused();
      const chipBox = await chip.evaluate((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      expect(chipBox.height).toBeGreaterThanOrEqual(44);
      expect(chipBox.y).toBeGreaterThanOrEqual(0);
      expect(chipBox.y + chipBox.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
      // Gather the element chain directly from the browser so the closest() check runs in DOM.
      const chipDescendant = await page.evaluate(() => {
        const chip = document.querySelector('[data-testid="options-chart-return"]') as HTMLElement | null;
        if (!chip) return null;
        const r = chip.getBoundingClientRect();
        const cx = r.x + r.width / 2; const cy = r.y + r.height / 2;
        const hit = document.elementFromPoint(cx, cy) as Element | null;
        if (!hit) return { matches: false, hitTag: null };
        // walk up to the chip (or its descendant) and report the chain so the test runtime
        // can verify the hit belongs to the chip without crossing the Playwright boundary.
        let found = false;
        let n: Node | null = hit;
        while (n) {
          if ((n as Element).matches?.('[data-testid="options-chart-return"]')) { found = true; break; }
          n = n.parentElement;
        }
        return { matches: found, hitTag: hit.tagName, hitClass: hit.className };
      });
      expect(chipDescendant).not.toBeNull();
      expect(chipDescendant!.matches).toBe(true);
      const mrsRect = await page.evaluate(() => {
        const el = document.querySelector(".mrs") as HTMLElement | null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      if (mrsRect && (mrsRect.width > 0 || mrsRect.height > 0)) {
        const intersects = !(chipBox.x + chipBox.width < mrsRect.x || chipBox.x > mrsRect.x + mrsRect.width
          || chipBox.y + chipBox.height < mrsRect.y || chipBox.y > mrsRect.y + mrsRect.height);
        expect(intersects).toBe(false);
      }
      const parkedDialog = page.locator('[data-detent]');
      await expect(parkedDialog).toHaveAttribute("data-parked", "true");
      const companionExpando = await page.evaluate(() => {
        const el = document.querySelector("[data-options-companion]") as HTMLElement | null;
        return el ? (el as unknown as { __pp2bExpando?: true }).__pp2bExpando === true : false;
      });
      expect(companionExpando).toBe(true);
      await expect.poll(async () => (await chartPin(page))?.price).toBe(780);
      expect((await chartPin(page))?.lineStyle).toBe(2);
      // The chart itself is the load-bearing assertion of the contract; hit-testing at its
      // centre is environment-sensitive (Chromium hits the canvas, headless sometimes the
      // wrapper, and Safari may return a Text node), so we only check the chart owns its rect.
      const chartRect = await page.evaluate(() => {
        const chart = document.querySelector(".chart-wrap") as HTMLElement | null;
        if (!chart) return null;
        const r = chart.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      expect(chartRect).not.toBeNull();
      expect(chartRect!.w).toBeGreaterThan(0);
      expect(chartRect!.h).toBeGreaterThan(0);
      // The parked sheet is invisible (visibility:hidden), so hit-testing THROUGH it
      // must land on chart content. Inert can preserve this even if visibility is
      // removed, so assert the parked visibility independently below.
      // A visible point in the chart / parked-sheet intersection is mandatory;
      // missing overlap fails rather than silently skipping the hit-test proof.
      const chartHit = await page.evaluate(() => {
        const chart = document.querySelector(".chart-wrap") as HTMLElement | null;
        const sheet = document.querySelector("[data-detent]") as HTMLElement | null;
        if (!chart || !sheet) return null;
        const r = chart.getBoundingClientRect();
        const s = sheet.getBoundingClientRect();
        const left = Math.max(r.left, s.left, 1), right = Math.min(r.right, s.right, innerWidth - 1);
        const top = Math.max(r.top, s.top, 1), bottom = Math.min(r.bottom, s.bottom, innerHeight - 1);
        if (right <= left || bottom <= top) return { exercised: false, inside: false, hitTag: null };
        const cx = (left + right) / 2, cy = (top + bottom) / 2;
        const underSheet = cx >= s.left && cx <= s.right && cy >= s.top && cy <= s.bottom;
        if (!underSheet) return { exercised: false, inside: false, hitTag: null };
        const hit = document.elementFromPoint(cx, cy) as Element | null;
        return { exercised: true, inside: !!(hit && hit.closest(".chart-wrap")), hitTag: hit?.tagName ?? null };
      });
      expect(chartHit).not.toBeNull();
      expect(chartHit!.exercised, "visible chart target overlaps parked sheet").toBe(true);
      expect(chartHit!.inside).toBe(true);
      await expect(page.locator('[data-detent]')).toHaveCSS("visibility", "hidden");
      const bodyOverflow = await page.evaluate(() => document.body.style.overflow);
      expect(bodyOverflow).not.toBe("hidden");
      await page.screenshot({ path: `${crops}/pp2b-${project}-${lang}-parked.png`, fullPage: false });

      current = buildB;
      const [, ] = await Promise.all([
        page.waitForResponse(/\/api\/flow\?f=matrix(?::|%3A)SPY/, { timeout: 10_000 }),
        page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))),
      ]);
      await expect(panel.getByTestId("options-newer-snapshot")).toBeAttached();
      await expect(panel.getByTestId("options-newer-snapshot")).toContainText(ISO_B);
      await expect.poll(async () => (await chartPin(page))?.price).toBe(780);

      await chip.click();
      const companionConnected = await page.evaluate(() => {
        const el = document.querySelector("[data-options-companion]") as HTMLElement | null;
        return el ? (el as unknown as { __pp2bExpando?: true }).__pp2bExpando === true : false;
      });
      expect(companionConnected).toBe(true);
      const scrollersAfter = await page.evaluate(() => {
        const stored = (window as unknown as { __pp2bScrollers: Array<{ el: HTMLElement; scrollTop: number; scrollLeft: number }> }).__pp2bScrollers;
        if (!stored) return null;
        return stored.map((entry) => ({
          connected: entry.el.isConnected,
          recordedTop: entry.scrollTop,
          recordedLeft: entry.scrollLeft,
          afterTop: entry.el.scrollTop,
          afterLeft: entry.el.scrollLeft,
        }));
      });
      expect(scrollersAfter).not.toBeNull();
      // D3: the before/after offset table is persisted next to the other evidence and
      // EVERY recorded scroller must come back connected with its offsets intact (±1).
      mkdirSync(crops, { recursive: true });
      writeFileSync(`${crops}/pp2b-offsets-${project}-${lang}.json`, JSON.stringify(scrollersAfter, null, 2));
      for (const row of scrollersAfter!) {
        expect(row.connected).toBe(true);
        expect(Math.abs(row.afterTop - row.recordedTop)).toBeLessThanOrEqual(1);
        expect(Math.abs(row.afterLeft - row.recordedLeft)).toBeLessThanOrEqual(1);
      }
      const detentAfter = await page.locator("[data-detent]").getAttribute("data-detent");
      expect(detentAfter).toBe(detentBefore);
      await expect(showBtn).toBeFocused();
      await expect(panel.getByTestId("options-newer-snapshot")).toBeVisible();
      await expect(panel.getByTestId("options-newer-snapshot")).toContainText(ISO_B);
      const summaryAfterReturn = await panel.getByTestId("options-selected-summary").innerText();
      // The cell line "780 · 2026-07-10 · +8M" must be unchanged: the queued build B
      // is held in `pending`, never silently swapped below the selected context. (The
      // pin/unpin button label MAY flip because Show on chart sets the pin first, so
      // the strip is compared on its first non-empty line — A's held cell line,
      // recorded before parking — plus the A-value tokens.)
      const heldCellLine = summaryTextBeforePark.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
      expect(heldCellLine).not.toBe("");
      expect(summaryAfterReturn).toContain(heldCellLine);
      expect(summaryAfterReturn).toContain("780");
      expect(summaryAfterReturn).toContain("2026-07-10");
      expect(summaryAfterReturn).toContain("+8M");
      await expect.poll(async () => (await chartPin(page))).not.toBeNull();
      const canvasExpando = await page.evaluate(() => {
        const canvas = document.querySelector(".chart-wrap canvas") as HTMLElement | null;
        return canvas ? (canvas as unknown as { __pp2bCanvasExpando?: true }).__pp2bCanvasExpando === true : false;
      });
      expect(canvasExpando).toBe(true);
      await page.screenshot({ path: `${crops}/pp2b-${project}-${lang}-returned.png`, fullPage: false });

      await panel.getByTestId("options-apply-newer").click();
      await expect(panel.getByTestId("options-selected-summary")).toContainText(lang === "zh" ? "选择单元格查看详情" : "Select a cell to inspect");
      await expect.poll(() => chartPin(page)).toBeNull();

      await cell.click();
      await showBtn.click();
      expect(await page.locator('[data-detent]').getAttribute("data-parked")).toBe("true");
      current = buildC;
      const [, ] = await Promise.all([
        page.waitForResponse(/\/api\/flow\?f=matrix(?::|%3A)SPY/, { timeout: 10_000 }),
        page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))),
      ]);
      await chip.click();
      await expect(panel.getByTestId("options-newer-snapshot")).toContainText(reviewLater);
      const sessionAttr = await panel.locator("[data-options-session]").getAttribute("data-options-session");
      expect(sessionAttr).toBe(reviewSession);
      await expect.poll(async () => (await chartPin(page))).not.toBeNull();
      await panel.getByTestId("options-apply-newer").click();
      await expect.poll(async () => await panel.locator("[data-options-session]").getAttribute("data-options-session")).toBe(reviewLater);
      await expect.poll(() => chartPin(page)).toBeNull();
      return;
    }

    // Desktop path: no Show on chart button — the rail never covers the chart on a
    // viewport wide enough for it. The desktop falsifier still needs a real held pin,
    // so the cell is pinned through the selected-summary strip's pressed toggle, the
    // rail's scroll offsets and the chart canvas instance are tagged, the chart centre
    // is clicked, and NOTHING (offsets, summary, pin, expando) may move.
    await expect(page.locator('[data-testid="options-show-on-chart"]')).toHaveCount(0);
    {
      const [, ] = await Promise.all([
        page.waitForResponse(/\/api\/flow\?f=matrix(?::|%3A)SPY/, { timeout: 10_000 }),
        panel.getByRole("button", { name: lang === "zh" ? "刷新快照" : "Refresh snapshot", exact: true }).click(),
      ]);
    }
    const pinToggle = panel.locator('[data-testid="options-selected-summary"] button[aria-pressed]').first();
    await expect(pinToggle).toBeVisible();
    await pinToggle.click();
    await expect(pinToggle).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await chartPin(page))?.price).toBe(780);
    expect((await chartPin(page))?.lineStyle).toBe(2);
    // Tag the canvas instance and record the rail's scrollable offsets inside
    // [data-options-companion], with a nonzero vacuity proof.
    await page.evaluate(() => {
      const canvas = document.querySelector(".chart-wrap canvas") as HTMLElement | null;
      if (canvas) (canvas as unknown as { __pp2bCanvasExpando: true }).__pp2bCanvasExpando = true;
      const companion = document.querySelector("[data-options-companion]") as HTMLElement | null;
      const overflowed: HTMLElement[] = [];
      const scan = (el: Element) => {
        const ce = el as HTMLElement;
        const cs = getComputedStyle(el);
        if (cs.overflowX === "auto" || cs.overflowX === "scroll" || cs.overflowY === "auto" || cs.overflowY === "scroll") {
          if (ce.scrollHeight > ce.clientHeight + 1 || ce.scrollWidth > ce.clientWidth + 1) overflowed.push(ce);
        }
        for (const child of Array.from(el.children)) scan(child);
      };
      if (companion) scan(companion);
      const stored: Array<{ el: HTMLElement; scrollTop: number; scrollLeft: number }> = [];
      for (const el of overflowed) {
        el.scrollTop = Math.min(40, el.scrollHeight - el.clientHeight);
        el.scrollLeft = Math.min(40, el.scrollWidth - el.clientWidth);
        stored.push({ el, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft });
      }
      (window as unknown as { __pp2bRailScrollers: typeof stored }).__pp2bRailScrollers = stored;
    });
    const railOffsets = await page.evaluate(() => {
      const stored = (window as unknown as { __pp2bRailScrollers: Array<{ el: HTMLElement; scrollTop: number; scrollLeft: number }> }).__pp2bRailScrollers ?? [];
      return stored.map((entry) => ({ recordedTop: entry.scrollTop, recordedLeft: entry.scrollLeft, beforeTop: entry.el.scrollTop, beforeLeft: entry.el.scrollLeft }));
    });
    expect(railOffsets.length).toBeGreaterThanOrEqual(1);
    expect(railOffsets.some((o) => o.beforeTop !== 0 || o.beforeLeft !== 0)).toBe(true);
    mkdirSync(crops, { recursive: true });
    writeFileSync(`${crops}/pp2b-offsets-${project}-${lang}.json`, JSON.stringify(railOffsets, null, 2));
    const canvasPresent = await page.evaluate(() => {
      const canvas = document.querySelector(".chart-wrap canvas") as HTMLElement | null;
      return canvas != null && (canvas as unknown as { __pp2bCanvasExpando?: true }).__pp2bCanvasExpando === true;
    });
    expect(canvasPresent).toBe(true);
    const summaryDesktopBefore = await panel.getByTestId("options-selected-summary").innerText();
    const chartCanvas = page.locator(".chart-wrap canvas").first();
    const cBox = await chartCanvas.boundingBox();
    expect(cBox).not.toBeNull();
    expect(cBox!.width).toBeGreaterThan(0);
    expect(cBox!.height).toBeGreaterThan(0);
    await page.mouse.click(cBox!.x + cBox!.width / 2, cBox!.y + cBox!.height / 2);
    const railDeltas = await page.evaluate(() => {
      const stored = (window as unknown as { __pp2bRailScrollers: Array<{ el: HTMLElement; scrollTop: number; scrollLeft: number }> }).__pp2bRailScrollers ?? [];
      return stored.map((entry) => ({ connected: entry.el.isConnected, dTop: entry.el.scrollTop - entry.scrollTop, dLeft: entry.el.scrollLeft - entry.scrollLeft }));
    });
    for (const row of railDeltas) {
      expect(row.connected).toBe(true);
      expect(Math.abs(row.dTop)).toBeLessThanOrEqual(1);
      expect(Math.abs(row.dLeft)).toBeLessThanOrEqual(1);
    }
    expect(await panel.getByTestId("options-selected-summary").innerText()).toBe(summaryDesktopBefore);
    await expect.poll(async () => (await chartPin(page))?.price).toBe(780);
    expect((await chartPin(page))?.lineStyle).toBe(2);
    const canvasExpandoAfterClick = await page.evaluate(() => {
      const canvas = document.querySelector(".chart-wrap canvas") as HTMLElement | null;
      return canvas ? (canvas as unknown as { __pp2bCanvasExpando?: true }).__pp2bCanvasExpando === true : false;
    });
    expect(canvasExpandoAfterClick).toBe(true);

    // A newer same-session build queues while the desktop rail holds A: the banner
    // names B and the selected summary still reads A's held cell.
    current = buildB;
    const [, ] = await Promise.all([
      page.waitForResponse(/\/api\/flow\?f=matrix(?::|%3A)SPY/, { timeout: 10_000 }),
      page.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))),
    ]);
    await expect(panel.getByTestId("options-newer-snapshot")).toBeVisible();
    await expect(panel.getByTestId("options-newer-snapshot")).toContainText(ISO_B);
    expect(await panel.getByTestId("options-selected-summary").innerText()).toBe(summaryDesktopBefore);
  });
}
