import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import type { VolHistoryRow } from "../components/vol/volTypes";
import { applyD08BPanelPresentation } from "./d08bPanelPresentation";

const point = (date: string, atm_iv: number | null): VolHistoryRow => ({ date, atm_iv, close: null, iv_rank: null });

function suppliedHistory() {
  const rows = Array.from({ length: 16 }, (_, i) => point(`2026-10-${String(i + 1).padStart(2, "0")}`, 17 + i / 10));
  rows[0].atm_iv = 0;
  rows[1].atm_iv = 17.1234567890123;
  rows[2].atm_iv = 1e-9;
  rows[4].atm_iv = null;
  rows.push(point("2026-10-09", 99), point("2026-02-30", 123));
  return rows;
}
function longHistory() {
  return Array.from({ length: 90 }, (_, i) => point(
    new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10),
    i === 89 ? 25.1234567890123 : 17 + i / 100,
  ));
}
function payload(history: VolHistoryRow[] | undefined) {
  return {
    schema: "options_hub.vol/v1", root: "SPY", asof: "2026-11-02", atm_iv: 17.2,
    iv_rank_252: 41, iv_rank_all: 52, coverage_days_all: 300, since_all: "2025-07-01",
    iv_52w_hi: 19, iv_52w_lo: 0, rv20: 16.8, vrp: 0.4,
    term: [
      { exp: "2026-11-20", dte: 18, atm_iv: 17.2 },
      { exp: "2026-12-18", dte: 46, atm_iv: 18.1 },
    ],
    smile: ["2026-11-20", "2026-12-18"].map(exp => ({ exp, points: [
      { strike: 90, call_iv: 22, put_iv: 23 }, { strike: 100, call_iv: 20, put_iv: 20 }, { strike: 110, call_iv: 21, put_iv: 22 },
    ] })),
    history,
  };
}

async function enter(page: Page, lang: "en" | "zh", getHistory: () => VolHistoryRow[] | undefined = suppliedHistory) {
  await page.clock.install({ time: new Date("2026-11-02T22:00:00Z") });
  await page.addInitScript(locale => { localStorage.setItem("mm.lang", locale); Reflect.deleteProperty(window, "EventSource"); }, lang);
  await page.route(url => url.pathname === "/api/flow/stream", route => route.abort("failed"));
  await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "vol:SPY", route => route.fulfill({ json: payload(getHistory()) }));
  await page.goto("/options?tab=volatility&symbol=SPY");
  const panel = page.getByTestId("vol-history-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}
function viewControls(panel: Locator, lang: "en" | "zh") {
  const group = panel.getByRole("group", { name: lang === "en" ? "History view" : "历史视图", exact: true });
  return {
    chart: group.getByRole("button", { name: lang === "en" ? "Chart" : "图表", exact: true }),
    exact: group.getByRole("button", { name: lang === "en" ? "Exact history values" : "精确历史数值", exact: true }),
  };
}
async function fit(panel: Locator) {
  const bad = await panel.evaluate(root => {
    const box = root.getBoundingClientRect(); let left = Math.max(0, box.left), right = Math.min(innerWidth, box.right);
    for (let parent = root.parentElement; parent; parent = parent.parentElement) {
      if (!/hidden|clip|auto|scroll/.test(getComputedStyle(parent).overflowX)) continue;
      const r = parent.getBoundingClientRect(); left = Math.max(left, r.left); right = Math.min(right, r.right);
    }
    const failures: string[] = [];
    for (const el of root.querySelectorAll("button,summary,table,th,td,caption,p,svg,.fin-card-h>span")) {
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
async function visibleTarget(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect.poll(() => locator.evaluate(el => {
    const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 && !!hit && (el === hit || el.contains(hit));
  })).toBe(true);
}
async function capture(page: Page, target: Locator, name: string) {
  // Capture the actual viewport after revealing and hit-testing one bounded target.
  // Oversized Locator.screenshot can resize a capture inside Options' fixed scroller.
  await visibleTarget(target);
  const viewport = page.viewportSize();
  const observed = await target.evaluate(el => {
    const r = el.getBoundingClientRect();
    return {
      innerWidth, innerHeight, devicePixelRatio,
      cssZoom: getComputedStyle(document.documentElement).zoom,
      target: { tag: el.tagName, text: el.textContent?.slice(0, 140), left: r.left, top: r.top, width: r.width, height: r.height },
    };
  });
  await page.screenshot({ path: `test-results/${name}.png`, fullPage: false });
  expect(page.viewportSize()).toEqual(viewport);
  await visibleTarget(target);
  writeFileSync(`test-results/${name}-capture.json`, JSON.stringify({
    schema: "d08b.viewport_capture.v1", viewport, fullPage: false, ...observed,
  }, null, 2));
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
    const texts = [...root.querySelectorAll("button,summary,p,caption,th,td,svg text,.fin-card-h>span,[data-testid=history-conflict-status]")].filter(el => el.getClientRects().length);
    if (root.lastElementChild?.firstElementChild) texts.push(root.lastElementChild.firstElementChild);
    const text = texts.map(el => ({ text: el.textContent?.slice(0, 70), ratio: ratio(rgba(getComputedStyle(el)[el instanceof SVGElement ? "fill" : "color"]), background(el)) }));
    const marks = [...root.querySelectorAll("svg path,svg line[stroke-dasharray]")].filter(el => el.getClientRects().length).map(el => ({
      shape: el.tagName, ratio: ratio(rgba(getComputedStyle(el).stroke), background(el)),
    }));
    return { text, marks };
  });
}

for (const lang of ["en", "zh"] as const) {
  test(`History ${lang}: exact observations, honest gaps, keyboard and token presentation`, async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    const panel = await enter(page, lang), table = panel.getByTestId("history-exact-table");
    const { chart, exact } = viewControls(panel, lang);
    // History view changes must not create or move the shared expiry selection.
    await page.getByTestId("term-expiry-select").selectOption("2026-12-18");
    const originalPaths = await panel.locator('path[stroke="var(--brand-2)"]').evaluateAll(elements => elements.map(el => el.getAttribute("d")));
    expect(originalPaths).toHaveLength(3);

    for (const theme of ["dark", "light-tokens"] as const) {
      await applyD08BPanelPresentation(panel, theme);
      await chart.focus(); await page.keyboard.press("Enter");
      await expect(chart).toBeFocused(); await expect(chart).toHaveAttribute("aria-pressed", "true");
      await fit(panel);
      const chartContrast = await measureContrast(panel);
      writeFileSync(`test-results/d08b-history-${info.project.name}-${lang}-${theme}-chart-contrast.json`, JSON.stringify(chartContrast, null, 2));
      expect(chartContrast.text.filter(item => item.ratio < 4.5)).toEqual([]);
      expect(chartContrast.marks.filter(item => item.ratio < 3)).toEqual([]);
      await capture(page, panel.locator("svg"), `d08b-history-${info.project.name}-${lang}-${theme}-chart`);

      await exact.focus(); await page.keyboard.press("Enter");
      await expect(exact).toBeFocused(); await expect(exact).toHaveAttribute("aria-pressed", "true");
      await expect(table.locator("tbody tr")).toHaveCount(16);
      await expect(table.getByRole("columnheader")).toHaveCount(2);
      await expect(table.getByRole("button")).toHaveCount(0);
      await expect(table.locator("tbody tr").filter({ hasText: "2026-10-01" }).locator("td")).toHaveText("0");
      await expect(table.locator("tbody tr").filter({ hasText: "2026-10-02" }).locator("td")).toHaveText("17.1234567890123");
      await expect(table.locator("tbody tr").filter({ hasText: "2026-10-03" }).locator("td")).toHaveText("1e-9");
      await expect(table.locator("tbody tr").filter({ hasText: "2026-10-05" }).locator("td")).toHaveText(lang === "en" ? "Unavailable" : "不可用");
      await expect(table.locator("tbody tr").filter({ hasText: "2026-10-09" }).locator("td")).toHaveText(lang === "en" ? "Conflicting records" : "记录冲突");
      await expect(table).not.toContainText("2026-02-30");
      await expect(panel.getByTestId("history-values-status")).toHaveText(lang === "en"
        ? "14 IV observations · 16 supplied dates" : "14 个 IV 观测值 · 16 个已提供日期");
      await expect(page.getByTestId("term-expiry-select")).toHaveValue("2026-12-18");
      await expect(page.getByTestId("vol-expiry-context")).toContainText("2026-12-18");
      await fit(panel);
      const tableContrast = await measureContrast(panel);
      writeFileSync(`test-results/d08b-history-${info.project.name}-${lang}-${theme}-table-contrast.json`, JSON.stringify(tableContrast, null, 2));
      expect(tableContrast.text.filter(item => item.ratio < 4.5)).toEqual([]);
      await capture(page, table.locator("tbody tr").filter({ hasText: "2026-10-02" }), `d08b-history-${info.project.name}-${lang}-${theme}-exact-precision`);
      await capture(page, table.locator("tbody tr").last(), `d08b-history-${info.project.name}-${lang}-${theme}-exact-last-row`);
    }

    await exact.focus(); await page.keyboard.press("Tab");
    const source = panel.locator("summary");
    await expect(source).toBeFocused(); await page.keyboard.press("Enter");
    await expect(panel.locator("details")).toHaveAttribute("open", "");
    await fit(panel);
    await capture(page, panel.locator("details"), `d08b-history-${info.project.name}-${lang}-source-method`);
    const small = await panel.locator("button:visible,summary:visible").evaluateAll(elements => elements.filter(el => {
      const r = el.getBoundingClientRect(); return r.width < 44 || r.height < 44;
    }).map(el => el.textContent));
    expect(small).toEqual([]);
    await chart.focus(); await page.keyboard.press("Enter");
    expect(await panel.locator('path[stroke="var(--brand-2)"]').evaluateAll(elements => elements.map(el => el.getAttribute("d")))).toEqual(originalPaths);
    expect(errors).toEqual([]);
  });
}

test("History sparse, all-missing and absent source states remain distinct", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Source-state route cases are exercised once.");
  let current: VolHistoryRow[] | undefined = Array.from({ length: 9 }, (_, i) => point(`2026-10-${String(i + 1).padStart(2, "0")}`, 17 + i / 10));
  const panel = await enter(page, "en", () => current);
  await expect(panel.locator("svg")).toHaveCount(0);
  await expect(panel).toContainText("The history line needs at least 10 sessions");
  let controls = viewControls(panel, "en");
  await controls.exact.focus(); await page.keyboard.press("Enter");
  await expect(panel.getByTestId("history-exact-table").locator("tbody tr")).toHaveCount(9);
  await fit(panel);
  await capture(page, panel.getByTestId("history-exact-table").locator("tbody tr").last(), "d08b-history-sparse-exact-last-row");

  current = [point("2026-10-01", null), point("2026-10-02", null)];
  await page.reload(); await expect(panel).toBeVisible();
  await expect(panel.locator("svg")).toHaveCount(0);
  controls = viewControls(panel, "en");
  await controls.exact.focus(); await page.keyboard.press("Enter");
  await expect(panel.getByTestId("history-exact-table").locator('td[data-state="unavailable"]')).toHaveCount(2);
  await expect(panel.getByTestId("history-values-status")).toHaveText("0 IV observations · 2 supplied dates");
  await fit(panel);
  await capture(page, panel.getByTestId("history-exact-table"), "d08b-history-all-missing-exact");

  current = undefined;
  await page.reload(); await expect(panel).toBeVisible();
  await expect(panel.locator("svg,table")).toHaveCount(0);
  await expect(panel.getByTestId("history-view-controls")).toHaveCount(0);
  await expect(panel).not.toContainText("2026-10-01");
  await capture(page, panel.locator(".fin-empty-title"), "d08b-history-no-source");
});

test("History 320px, magnified and narrow layouts retain every exact observation", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Explicit extra widths are exercised once.");
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const panel = await enter(page, "zh", longHistory);
  const { chart, exact } = viewControls(panel, "zh");
  await exact.focus(); await page.keyboard.press("Enter");
  const table = panel.getByTestId("history-exact-table");
  await expect(table.locator("tbody tr")).toHaveCount(90);
  await expect(table.locator("tbody tr").last().locator("td")).toHaveText("25.1234567890123");
  // Keep this supplied precision readable on one line at 320px; narrower panes
  // may wrap longer values rather than clipping or rounding them.
  expect(await table.locator("tbody tr").last().locator("td").evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el); return range.getClientRects().length;
  })).toBe(1);
  await fit(panel);
  await capture(page, exact, "d08b-history-320-zh-exact-controls");
  await capture(page, table.locator("tbody tr").last(), "d08b-history-320-zh-exact-last-row");

  await exact.focus(); await page.keyboard.press("Tab");
  await expect(panel.locator("summary")).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await fit(panel);
  await capture(page, exact, "d08b-history-css-200percent-zh-controls");
  await capture(page, table.locator("tbody tr").last(), "d08b-history-css-200percent-zh-last-row");

  await page.evaluate(() => { document.documentElement.style.zoom = "1"; });
  await panel.evaluate(el => { el.style.width = "230px"; });
  await chart.focus(); await page.keyboard.press("Enter");
  await expect(panel.locator("svg")).toBeHidden(); await fit(panel);
  const narrow = panel.getByTestId("history-narrow-action");
  await narrow.focus(); await page.keyboard.press("Enter");
  await expect(exact).toBeFocused(); await expect(table).toBeVisible(); await fit(panel);
  await capture(page, exact, "d08b-history-narrow-230-zh-exact-controls");
  await capture(page, table.locator("tbody tr").last(), "d08b-history-narrow-230-zh-exact-last-row");
});
