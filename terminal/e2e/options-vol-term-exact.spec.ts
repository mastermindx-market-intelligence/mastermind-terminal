import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { applyD08BPanelPresentation } from "./d08bPanelPresentation";

const longExpiry = "2027-05-01";
function payload() {
  return {
    schema: "options_hub.vol/v1", root: "SPY", asof: "2026-11-02", atm_iv: 17.2,
    iv_rank_252: 41, iv_rank_all: 52, coverage_days_all: 300, since_all: "2025-07-01",
    iv_52w_hi: 25, iv_52w_lo: 10, rv20: 16.8, vrp: 0.4,
    term: [
      { exp: "2026-11-06", dte: 4, atm_iv: 0 },
      { exp: "2026-11-13", dte: 11, atm_iv: null },
      { exp: "2026-11-20", dte: 18, atm_iv: 17.2 },
      { exp: "2026-12-18", dte: 46, atm_iv: 18.1 },
      { exp: "2026-12-18", dte: 46, atm_iv: 99 },
      { exp: "2027-01-31", dte: 90, atm_iv: 20 },
      { exp: longExpiry, dte: 180, atm_iv: 25.1234567890123 },
    ],
    smile: ["2026-11-20", "2027-01-31", longExpiry].map(exp => ({ exp, points: [
      { strike: 90, call_iv: 22, put_iv: 23 }, { strike: 100, call_iv: 20, put_iv: 20 }, { strike: 110, call_iv: 21, put_iv: 22 },
    ] })),
    history: Array.from({ length: 12 }, (_, i) => ({ date: `2026-10-${String(12 + i).padStart(2, "0")}`, atm_iv: 16 + i / 10, close: null, iv_rank: null })),
  };
}
async function enter(page: Page, lang: "en" | "zh") {
  await page.clock.install({ time: new Date("2026-11-02T22:00:00Z") });
  await page.addInitScript(locale => { localStorage.setItem("mm.lang", locale); Reflect.deleteProperty(window, "EventSource"); }, lang);
  await page.route(url => url.pathname === "/api/flow/stream", route => route.abort("failed"));
  await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "vol:SPY", route => route.fulfill({ json: payload() }));
  await page.goto("/options?tab=volatility&symbol=SPY");
  const panel = page.getByTestId("vol-term-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}
async function fit(panel: Locator) {
  const bad = await panel.evaluate(root => {
    const box = root.getBoundingClientRect(); let left = Math.max(0, box.left), right = Math.min(innerWidth, box.right);
    for (let parent = root.parentElement; parent; parent = parent.parentElement) {
      if (!/hidden|clip|auto|scroll/.test(getComputedStyle(parent).overflowX)) continue;
      const r = parent.getBoundingClientRect(); left = Math.max(left, r.left); right = Math.min(right, r.right);
    }
    const failures: string[] = [];
    for (const el of root.querySelectorAll("button,select,summary,table,th,td,caption,dt,dd,p,svg")) {
      if (!el.getClientRects().length) continue;
      const rects = [el.getBoundingClientRect()];
      for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        const range = document.createRange(); range.selectNodeContents(node); rects.push(...range.getClientRects());
      }
      if (rects.some(r => r.width && (r.left < left - 1 || r.right > right + 1))) failures.push(`${el.tagName}: ${el.textContent?.slice(0, 60)}`);
    }
    return failures;
  });
  expect(bad).toEqual([]);
}
async function target(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect.poll(() => locator.evaluate(el => {
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
    const texts = [...root.querySelectorAll("button,summary,p,caption,th,td,dt,dd,select,svg text,[role=group]>span,.fin-card-h>span,[data-testid=term-conflict-status]")].filter(el => el.getClientRects().length);
    if (root.lastElementChild?.firstElementChild) texts.push(root.lastElementChild.firstElementChild);
    const text = texts.map(el => ({ text: el.textContent?.slice(0, 70), ratio: ratio(rgba(getComputedStyle(el)[el instanceof SVGElement ? "fill" : "color"]), background(el)) }));
    const marks = [...root.querySelectorAll("svg path,svg circle,[data-testid=term-selected-guide]")].filter(el => el.getClientRects().length).map(el => {
      const style = getComputedStyle(el), color = parseFloat(style.strokeWidth) > 0 && style.stroke !== "none" ? style.stroke : style.fill;
      return { shape: el.tagName, ratio: ratio(rgba(color), background(el)) };
    });
    return { text, marks };
  });
}

for (const lang of ["en", "zh"] as const) {
  test(`Term ${lang}: exact long expiry to smile, unavailable recovery and token presentation`, async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    const panel = await enter(page, lang), table = panel.getByTestId("term-exact-table");
    const toggle = panel.locator("button[aria-expanded]");
    await toggle.focus(); await page.keyboard.press("Enter"); await expect(toggle).toBeFocused();
    await expect(table.locator("tbody tr")).toHaveCount(6);
    const long = table.getByRole("button", { name: longExpiry, exact: true });
    await long.focus(); await page.keyboard.press("Enter"); await expect(long).toBeFocused();
    await expect(long).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("term-expiry-select")).toHaveValue(longExpiry);
    await expect(page.getByTestId("vol-expiry-context")).toContainText(longExpiry);
    await expect(page.getByTestId("vol-skew-panel").getByRole("button", { name: longExpiry, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByTestId("term-exact-selected")).toContainText("25.1234567890123%");
    await expect(panel.locator('[data-selected-expiry="2027-05-01"]')).toHaveCount(1);
    const marker = panel.locator('[data-selected-expiry="2027-05-01"]');
    await expect(panel.getByTestId("term-selected-guide")).toHaveAttribute("x1", (await marker.getAttribute("cx"))!);
    for (const theme of ["dark", "light-tokens"] as const) {
      await applyD08BPanelPresentation(panel, theme); await fit(panel);
      const contrast = await measureContrast(panel);
      writeFileSync(`test-results/d08b-term-${info.project.name}-${lang}-${theme}-contrast.json`, JSON.stringify(contrast, null, 2));
      expect(contrast.text.filter(item => item.ratio < 4.5)).toEqual([]);
      expect(contrast.marks.filter(item => item.ratio < 3)).toEqual([]);
      await target(panel.getByTestId("term-exact-selected"));
      await page.screenshot({ path: `test-results/d08b-term-${info.project.name}-${lang}-${theme}-readout.png` });
      await target(long);
      await page.screenshot({ path: `test-results/d08b-term-${info.project.name}-${lang}-${theme}-long-expiry.png` });
    }
    const small = await panel.locator("button:visible,select:visible,summary:visible").evaluateAll(elements => elements.filter(el => {
      const r = el.getBoundingClientRect(); return r.width < 44 || r.height < 44;
    }).map(el => el.textContent));
    expect(small).toEqual([]);

    await table.getByRole("button", { name: "2026-11-13", exact: true }).click();
    await expect(panel.getByTestId("term-exact-selected")).toContainText("2026-11-13");
    await expect(panel.getByTestId("term-exact-selected")).toContainText(lang === "en" ? "Unavailable" : "不可用");
    await expect(panel.getByTestId("term-selected-guide")).toHaveAttribute("data-expiry", "2026-11-13");
    await expect(panel.locator("[data-selected-expiry]")).toHaveCount(0);
    await expect(page.getByTestId("vol-skew-panel").locator("svg")).toHaveCount(0);
    await fit(panel); await target(panel.getByTestId("term-exact-selected"));
    await page.screenshot({ path: `test-results/d08b-term-${info.project.name}-${lang}-missing-iv.png` });
    await table.getByRole("button", { name: "2026-12-18", exact: true }).click();
    await expect(panel.getByTestId("term-exact-selected")).toContainText(lang === "en" ? "Conflicting records" : "记录冲突");
    await expect(panel.locator("[data-selected-expiry]")).toHaveCount(0);
    await table.getByRole("button", { name: "2026-11-06", exact: true }).click();
    await expect(panel.getByTestId("term-exact-selected")).toContainText("0%");
    await expect(panel.locator('[data-selected-expiry="2026-11-06"]')).toHaveCount(1);
    await panel.getByTestId("term-expiry-select").selectOption("2027-01-31");
    await expect(panel.locator('[data-selected-expiry="2027-01-31"]')).toHaveCount(1);
    await expect(table.getByRole("button", { name: "2027-01-31", exact: true })).toHaveAttribute("aria-pressed", "true");
    await panel.locator("summary").focus(); await page.keyboard.press("Enter"); await fit(panel);
    await target(panel.locator("summary"));
    await page.screenshot({ path: `test-results/d08b-term-${info.project.name}-${lang}-source-method.png` });
    expect(errors).toEqual([]);
  });
}

test("Term 320px and narrow composition retain exact long-expiry keyboard selection", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Explicit extra widths are exercised once.");
  await page.setViewportSize({ width: 320, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" });
  const panel = await enter(page, "zh");
  const toggle = panel.locator("button[aria-expanded]");
  await toggle.focus(); await page.keyboard.press("Enter");
  const long = panel.getByTestId("term-exact-table").getByRole("button", { name: longExpiry, exact: true });
  await long.focus(); await page.keyboard.press("Enter"); await fit(panel); await target(long);
  await page.screenshot({ path: "test-results/d08b-term-320-zh-selected-row.png" });
  await target(panel.getByTestId("term-exact-selected"));
  await page.screenshot({ path: "test-results/d08b-term-320-zh-exact-readout.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await fit(panel); await target(panel.getByTestId("term-exact-selected"));
  await page.screenshot({ path: "test-results/d08b-term-css-200percent-zh-readout.png" });
  await target(long); await page.screenshot({ path: "test-results/d08b-term-css-200percent-zh-row.png" });
  await page.evaluate(() => { document.documentElement.style.zoom = "1"; });
  await panel.evaluate(el => { el.style.width = "230px"; });
  await toggle.click(); await expect(panel.getByTestId("term-exact-table")).toHaveCount(0);
  await expect(panel.locator("svg")).toBeHidden(); await fit(panel);
  const narrowAction = panel.getByRole("button", { name: "精确到期日数值", exact: true }).first();
  await narrowAction.focus(); await page.keyboard.press("Enter");
  await expect(panel.getByRole("button", { name: "精确到期日数值", exact: true }).last()).toBeFocused();
  await expect(panel.getByTestId("term-exact-table")).toBeVisible(); await fit(panel);
  await target(toggle);
  await page.screenshot({ path: "test-results/d08b-term-narrow-230-zh-controls.png" });
  await target(long);
  await page.screenshot({ path: "test-results/d08b-term-narrow-230-zh-row.png" });
});
