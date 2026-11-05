import { expect, test, type Locator, type Page } from "@playwright/test";
import { applyD08BPanelPresentation } from "./d08bPanelPresentation";
import { writeFileSync } from "node:fs";

// Controlled data at the existing /api/flow seam. This exercises the real VolView
// route and shared expiry owner; it is not live-provider or production-auth proof.
function payload(dense = false) {
  const point = (strike: number, call_iv: number | null, put_iv: number | null) => ({ strike, call_iv, put_iv });
  const points = dense
    ? Array.from({ length: 41 }, (_, i) => point(80 + i, i === 20 ? 20 : 20 + i / 100, i === 20 ? 20 : 21 + i / 100))
    : [point(50, 38, 40), point(90, 0, 22), point(100.00000001, 17.1234567890123, 1e-9),
      point(105, 20, 20), point(110, null, 21), point(115, 22, 23), point(115, 88, 89), point(150, 31, 34)];
  return {
    schema: "options_hub.vol/v1", root: "SPY", asof: "2026-11-02", atm_iv: 17.2,
    iv_rank_252: 41, iv_rank_all: 52, coverage_days_all: 300, since_all: "2025-07-01",
    iv_52w_hi: 25, iv_52w_lo: 10, rv20: 16.8, vrp: 0.4,
    term: [{ exp: "2026-11-13", dte: 11, atm_iv: null }, { exp: "2026-11-20", dte: 18, atm_iv: 17.2 }, { exp: "2026-12-18", dte: 46, atm_iv: 18.1 }],
    smile: [{ exp: "2026-11-20", points }, { exp: "2026-12-18", points: [point(100, 19, 20)] }],
    history: Array.from({ length: 12 }, (_, i) => ({ date: `2026-10-${String(12 + i).padStart(2, "0")}`, atm_iv: 16 + i / 10, close: null, iv_rank: null })),
  };
}

async function enter(page: Page, lang: "en" | "zh", dense = false) {
  await page.clock.install({ time: new Date("2026-11-02T22:00:00Z") });
  await page.addInitScript(locale => { localStorage.setItem("mm.lang", locale); Reflect.deleteProperty(window, "EventSource"); }, lang);
  await page.route(url => url.pathname === "/api/flow/stream", route => route.abort("failed"));
  await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "vol:SPY", route => route.fulfill({ json: payload(dense) }));
  await page.goto("/options?tab=volatility&symbol=SPY");
  const panel = page.getByTestId("vol-skew-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByRole("button", { name: "2026-11-20", exact: true })).toHaveAttribute("aria-pressed", "true");
  return panel;
}

// A parent's overflow clipping can conceal broken content from scrollWidth.
// Check the actual element/text bounds against the panel and clipping ancestors.
async function expectFit(panel: Locator) {
  const failures = await panel.evaluate(root => {
    const bounds = root.getBoundingClientRect();
    let left = Math.max(0, bounds.left), right = Math.min(innerWidth, bounds.right);
    for (let parent = root.parentElement; parent; parent = parent.parentElement) {
      if (!/hidden|clip|auto|scroll/.test(getComputedStyle(parent).overflowX)) continue;
      const rect = parent.getBoundingClientRect(); left = Math.max(left, rect.left); right = Math.min(right, rect.right);
    }
    const bad: string[] = [];
    for (const el of root.querySelectorAll<HTMLElement>("button,summary,table,caption,th,td,p,svg,[role=img]")) {
      if (!el.getClientRects().length) continue;
      const rects = [el.getBoundingClientRect()];
      for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        const range = document.createRange(); range.selectNodeContents(node); rects.push(...range.getClientRects());
      }
      for (const rect of rects) if (rect.width && (rect.left < left - 1 || rect.right > right + 1)) bad.push(`${el.tagName}: ${el.textContent?.slice(0, 60)}`);
    }
    return bad;
  });
  expect(failures).toEqual([]);
}

async function expectTarget(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await expect.poll(() => target.evaluate(el => {
    const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 && !!hit && (el === hit || el.contains(hit));
  })).toBe(true);
}

async function measureContrast(panel: Locator) {
  return panel.evaluate(root => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    const rgba = (color: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
    const background = (el: Element): number[] => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const c = rgba(getComputedStyle(node).backgroundColor); if (c[3] === 255) return c;
      }
      throw new Error("No opaque background found for contrast sample");
    };
    const luminance = (color: number[]) => color.slice(0, 3).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a: number[], b: number[]) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const texts = [...root.querySelectorAll("button,summary,p,caption,th,td,svg text,[role=img]:not(svg),[data-testid=smile-conflict-status]")].filter(el => el.getClientRects().length);
    if (root.lastElementChild?.firstElementChild) texts.push(root.lastElementChild.firstElementChild);
    const text = texts.map(el => ({ text: el.textContent?.slice(0, 70), ratio: ratio(rgba(getComputedStyle(el)[el instanceof SVGElement ? "fill" : "color"]), background(el)) }));
    const marks = [...root.querySelectorAll("[data-vol-leg]")].map(el => ({ leg: el.getAttribute("data-vol-leg"), ratio: ratio(rgba(getComputedStyle(el).fill), background(el)) }));
    return { text, marks };
  });
}

for (const lang of ["en", "zh"] as const) {
  test(`Skew ${lang}: exact IV, range, shared missing expiry, keyboard and themes`, async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    const panel = await enter(page, lang);
    const exact = panel.getByRole("group", { name: lang === "en" ? "Smile view" : "微笑曲线视图" }).getByRole("button", { name: lang === "en" ? "Exact IV" : "精确 IV", exact: true });
    const chart = panel.getByRole("button", { name: lang === "en" ? "Chart" : "图表", exact: true });
    const full = panel.getByRole("button", { name: lang === "en" ? "Full supplied range" : "全部已提供范围", exact: true });
    const table = panel.getByTestId("smile-exact-table");
    const row = (strike: string) => table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: strike, exact: true }) });

    await expect(panel.locator('circle[data-vol-leg="call"]')).toHaveCount(3);
    await expect(panel.locator('polygon[data-vol-leg="put"]')).toHaveCount(4);
    await expect(panel.locator('path[stroke="var(--ai)"]').first()).toHaveAttribute("stroke-dasharray", "5 4");
    for (const theme of ["dark", "light-tokens"] as const) {
      await applyD08BPanelPresentation(panel, theme);
      await expectFit(panel);
      const contrast = await measureContrast(panel);
      expect(contrast.text.filter(item => item.ratio < 4.5)).toEqual([]);
      expect(contrast.marks.filter(item => item.ratio < 3)).toEqual([]);
      await info.attach(`${lang}-${theme}-chart-contrast`, { body: JSON.stringify(contrast, null, 2), contentType: "application/json" });
      writeFileSync(`test-results/d08b-skew-${info.project.name}-${lang}-${theme}-chart-contrast.json`, JSON.stringify(contrast, null, 2));
      await panel.screenshot({ path: `test-results/d08b-skew-${info.project.name}-${lang}-${theme}-chart.png` });
    }
    await exact.focus(); await page.keyboard.press("Enter"); await expect(exact).toBeFocused();
    await expect(table.locator("tbody tr")).toHaveCount(5);
    await expect(row("90").locator("td").first()).toHaveText("0");
    await expect(row("100.00000001").locator("td")).toHaveText(["17.1234567890123", "1e-9"]);
    await expect(row("110").locator("td").first()).toHaveText(lang === "en" ? "Unavailable" : "不可用");
    await expect(row("115").locator("td")).toHaveText(lang === "en" ? ["Conflicting records", "Conflicting records"] : ["记录冲突", "记录冲突"]);
    await expectTarget(row("100.00000001").locator("td").first());
    for (const theme of ["dark", "light-tokens"] as const) {
      await applyD08BPanelPresentation(panel, theme);
      await expectFit(panel);
      const contrast = await measureContrast(panel);
      expect(contrast.text.filter(item => item.ratio < 4.5)).toEqual([]);
      await info.attach(`${lang}-${theme}-table-contrast`, { body: JSON.stringify(contrast, null, 2), contentType: "application/json" });
      writeFileSync(`test-results/d08b-skew-${info.project.name}-${lang}-${theme}-table-contrast.json`, JSON.stringify(contrast, null, 2));
      await panel.screenshot({ path: `test-results/d08b-skew-${info.project.name}-${lang}-${theme}-exact.png` });
    }
    const small = await panel.locator("button:visible,summary:visible").evaluateAll(buttons => buttons.filter(button => {
      const r = button.getBoundingClientRect(); return r.width < 44 || r.height < 44;
    }).map(button => button.textContent));
    expect(small).toEqual([]);
    const source = panel.locator("summary");
    await source.focus(); await page.keyboard.press("Enter");
    await expect(panel.getByText(lang === "en" ? "Quote inputs and IV method are not supplied in this read." : "本次读数未提供报价输入或 IV 计算方法。", { exact: true })).toBeVisible();
    await expectFit(panel);
    await panel.screenshot({ path: `test-results/d08b-skew-${info.project.name}-${lang}-source-method.png` });
    await page.keyboard.press("Enter"); await expect(source).toBeFocused();

    await full.focus(); await page.keyboard.press("Space");
    await expect(full).toHaveAttribute("aria-pressed", "true"); await expect(table.locator("tbody tr")).toHaveCount(7);
    await expect(row("150").locator("td")).toHaveText(["31", "34"]);
    await chart.focus(); await page.keyboard.press("Enter");
    await expect(panel.locator('circle[data-vol-leg="call"]')).toHaveCount(5);
    await expect(panel.locator('polygon[data-vol-leg="put"]')).toHaveCount(6);
    await exact.click(); await full.click(); await expect(table.locator("tbody tr")).toHaveCount(5);

    await page.getByTestId("term-expiry-select").selectOption("2026-11-13");
    await expect(page.getByTestId("vol-expiry-context")).toContainText("2026-11-13");
    await expect(table).toHaveCount(0); await expect(panel.locator("svg")).toHaveCount(0);
    await expect(panel).toContainText(lang === "en" ? "No smile for the selected expiry" : "所选到期日暂无微笑曲线");
    await expectFit(panel);
    await panel.screenshot({ path: `test-results/d08b-skew-${info.project.name}-${lang}-missing.png` });
    const expiry = panel.getByRole("button", { name: "2026-12-18", exact: true });
    await expiry.focus(); await page.keyboard.press("Enter");
    await expect(page.getByTestId("term-expiry-select")).toHaveValue("2026-12-18");
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(table.locator("tbody td")).toHaveText(["19", "20"]);
    await expectFit(panel); expect(errors).toEqual([]);
  });
}

test("Skew dense 320, CSS magnification and narrow-pane exact route", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "This case explicitly owns the extra widths once.");
  await page.setViewportSize({ width: 320, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" });
  const panel = await enter(page, "zh", true);
  await expectFit(panel);
  const exact = panel.getByRole("group", { name: "微笑曲线视图" }).getByRole("button", { name: "精确 IV", exact: true });
  await exact.focus(); await page.keyboard.press("Enter");
  await expect(panel.locator("tbody tr")).toHaveCount(41);
  await expectFit(panel);
  const last = panel.locator("tbody tr").last();
  await expectTarget(last); await expect(last).toContainText("120");
  await page.screenshot({ path: "test-results/d08b-skew-320-zh-dense-last-row.png" });
  await expectTarget(exact);
  await page.screenshot({ path: "test-results/d08b-skew-320-zh-dense-controls.png" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expectFit(panel); await expectTarget(last);
  await page.screenshot({ path: "test-results/d08b-skew-css-200percent-zh-last-row.png" });
  await expectTarget(exact);
  await page.screenshot({ path: "test-results/d08b-skew-css-200percent-zh-controls.png" });

  await page.evaluate(() => { document.documentElement.style.zoom = "1"; });
  // A composed desk can constrain this panel independently of the viewport.
  // The chart's shared 240px geometry is retained; the narrow notice offers data.
  await panel.evaluate(el => { el.style.width = "230px"; });
  await panel.getByRole("button", { name: "图表", exact: true }).click();
  const narrow = panel.getByText("此区域过窄", { exact: false });
  await expect(narrow).toBeVisible(); await expect(panel.locator("svg")).toBeHidden(); await expectFit(panel);
  const narrowAction = panel.getByRole("button", { name: "精确 IV", exact: true }).last();
  await narrowAction.focus(); await page.keyboard.press("Enter"); await expect(exact).toBeFocused();
  await expect(panel.locator("tbody tr")).toHaveCount(41); await expectFit(panel);
  await expectTarget(panel.locator("tbody tr").first());
  await page.screenshot({ path: "test-results/d08b-skew-narrow-230-zh-exact.png" });
});
