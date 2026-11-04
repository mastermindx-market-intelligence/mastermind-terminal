import { expect, test, type Locator, type Page } from "@playwright/test";
import { applyD08BPanelPresentation } from "./d08bPanelPresentation";
import producer from "../lib/__tests__/fixtures/exposure-projection.json";

// Controlled source values exercise the production /options route and its
// incumbent qualification owner. They are not evidence of a live market feed.
const now = new Date("2026-10-19T20:00:00Z");
const session = "2026-10-15";
function source(dense = false) {
  const projection = structuredClone(producer), proto = projection.cells[0]!;
  const expiries = dense ? Array.from({ length: 9 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`) : ["2026-10-16", "2026-10-23"];
  const strikes = dense ? Array.from({ length: 9 }, (_, i) => 96 + i) : [100, 103];
  projection.cells = expiries.flatMap((expiry, e) => strikes.map((strike, s) => {
    const cell = structuredClone(proto), net = (s % 2 ? -1 : 1) * strike * 1e6 * (e + 1);
    cell.expiry = expiry; cell.economic_expiry_at = `${expiry}T20:00:00Z`; cell.strike = strike;
    cell.gamma = { ...cell.gamma, net, gross: Math.abs(net) * 2, known_net: net, known_gross: Math.abs(net) * 2 };
    if (!dense && strike === 103 && expiry === "2026-10-23") cell.gamma = { ...cell.gamma, net: null, gross: null, known_net: null, known_gross: null, qualified: 0, missing: 2, status: "unavailable" } as unknown as typeof cell.gamma;
    return cell;
  }));
  projection.cell_count = projection.cells.length;
  return { schema: "options_hub.gex/v1", root: "SPY", asof: session, spot_ref: 100, by_strike: [], by_expiry: [], exposure_projection: projection };
}
async function enter(page: Page, lang: "en" | "zh", dense = false) {
  await page.clock.install({ time: now });
  await page.addInitScript(locale => { localStorage.setItem("mm.lang", locale); Reflect.deleteProperty(window, "EventSource"); }, lang);
  await page.route(url => url.pathname === "/api/flow/stream", route => route.abort("failed"));
  await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex:SPY", route => route.fulfill({ json: source(dense) }));
  await page.goto("/options?tab=prism&symbol=SPY&view=chart");
  const map = page.getByTestId("exposure-map");
  await expect(map).toBeVisible({ timeout: 30_000 });
  await map.getByRole("button", { name: lang === "en" ? "Surface" : "曲面", exact: true }).click();
  const surface = map.locator("[data-surface-status]");
  await expect(surface).toHaveAttribute("data-surface-status", "ready");
  return surface;
}

// Parent overflow:hidden can conceal a broken child while document.scrollWidth
// still passes. Measure owned elements and their text, including offscreen rows.
async function expectHorizontalFit(surface: Locator) {
  const overflow = await surface.evaluate(root => {
    const bounds = root.getBoundingClientRect();
    let left = Math.max(0, bounds.left), right = Math.min(innerWidth, bounds.right);
    for (let parent = root.parentElement; parent; parent = parent.parentElement) {
      if (!/hidden|clip|auto|scroll/.test(getComputedStyle(parent).overflowX)) continue;
      const clip = parent.getBoundingClientRect(); left = Math.max(left, clip.left); right = Math.min(right, clip.right);
    }
    const failures: { tag: string; text: string | null; left: number; right: number }[] = [];
    for (const el of root.querySelectorAll<HTMLElement>("button:enabled,select,summary,table,th,td,aside,aside span,aside strong,dt,dd,h3,p")) {
      if (!el.getClientRects().length) continue;
      const rects = [el.getBoundingClientRect()];
      for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        const range = document.createRange(); range.selectNodeContents(node); rects.push(...range.getClientRects());
      }
      for (const rect of rects) if (rect.width && (rect.left < left - 1 || rect.right > right + 1)) failures.push({ tag: el.tagName, text: el.textContent?.slice(0,80) ?? null, left: rect.left, right: rect.right });
    }
    return failures;
  });
  expect(overflow).toEqual([]);
}

async function expectViewportTarget(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await expect.poll(() => target.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1 && !!hit && (el === hit || el.contains(hit));
  })).toBe(true);
}

for (const lang of ["en", "zh"] as const) {
  test(`Surface exact 2D ${lang}: keyboard, crop retention, 3D parity and theme geometry`, async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const surface = await enter(page, lang);
    const geometry = await surface.getByTestId("surface-field").evaluate(svg => {
      const box = (svg as unknown as SVGSVGElement).viewBox.baseVal;
      const groups = [...svg.querySelectorAll<SVGGElement>("[data-surface-cell]")];
      return groups.map(group => ({ sign: group.dataset.sign,
        fill: getComputedStyle(group.querySelector("polygon")!).fill,
        within: [...group.querySelectorAll<SVGPolygonElement>("polygon")].every(polygon => [...polygon.points].every(p => p.x >= 0 && p.x <= box.width && p.y >= 0 && p.y <= box.height)),
      }));
    });
    expect(geometry).toHaveLength(3);
    expect(geometry.every(cell => cell.within && cell.fill !== "rgb(0, 0, 0)")).toBe(true);
    expect(geometry.find(cell => cell.sign === "positive")?.fill).not.toBe(geometry.find(cell => cell.sign === "negative")?.fill);
    for (const theme of ["dark", "light-tokens"] as const) {
      await applyD08BPanelPresentation(surface, theme);
      await expectHorizontalFit(surface);
      await surface.screenshot({ path: `test-results/d08b-surface-${info.project.name}-${lang}-${theme}-3d.png` });
    }
    const exact = surface.getByRole("button", { name: lang === "en" ? "Exact 2D values" : "精确 2D 数值", exact: true });
    await exact.focus(); await page.keyboard.press("Enter");
    const table = surface.getByTestId("surface-exact-table");
    await expect(table.locator("tbody tr")).toHaveCount(4);
    const target = table.locator('[data-strike="103"][data-expiry="2026-10-16"] [data-cell-button]');
    await target.focus(); await page.keyboard.press("Space");
    await expect(target).toHaveAttribute("aria-pressed", "true");
    await expect(surface.getByTestId("surface-exact-selected-value")).toHaveText("-103");
    await page.keyboard.press("Tab");
    await expect(table.getByRole("button", { name: lang === "en" ? "Cell details" : "单元详情", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(surface.getByTestId("surface-inspector")).toBeFocused();
    await surface.getByRole("button", { name: lang === "en" ? "Back to selected cell" : "返回所选单元" }).focus();
    await page.keyboard.press("Enter"); await expect(target).toBeFocused();
    await surface.locator("select").nth(0).selectOption("2");
    await expect(surface).toHaveAttribute("data-selection-state", "outside-window");
    await expect(surface.getByTestId("surface-selection-status")).toContainText("103 × 2026-10-16");
    await expect(surface.getByTestId("surface-inspector")).toHaveCount(0);
    await surface.screenshot({ path: `test-results/d08b-surface-${info.project.name}-${lang}-retained.png` });
    await surface.getByRole("button", { name: lang === "en" ? "Restore selection window" : "恢复所选单元窗口" }).click();
    await expect(target).toHaveAttribute("aria-pressed", "true");
    const metric = surface.getByRole("group", { name: lang === "en" ? "Surface metric" : "曲面指标" });
    await metric.getByRole("button", { name: "|Net|", exact: true }).or(metric.getByRole("button", { name: "|净|", exact: true })).click();
    await expect(surface.getByTestId("surface-exact-selected-value")).toHaveText("103");
    await metric.getByRole("button", { name: lang === "en" ? "Net" : "净", exact: true }).click();
    const unavailable = table.locator('tr[data-strike="103"][data-expiry="2026-10-23"]');
    await expect(unavailable).toHaveAttribute("data-value", "unavailable");
    await unavailable.getByRole("button").click();
    await expect(surface.getByTestId("surface-exact-selected-value")).toHaveText("—");
    await target.click();
    await surface.locator("summary").filter({ hasText: lang === "en" ? "Source and scope" : "来源与范围" }).click();
    await expect(surface).toContainText(session);
    await expect(surface).toContainText(producer.source_snapshot_ref);
    for (const theme of ["dark", "light-tokens"] as const) {
      await applyD08BPanelPresentation(surface, theme);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expectHorizontalFit(surface);
      const measured = await surface.evaluate(el => {
        const bounds = el.getBoundingClientRect();
        return [...el.querySelectorAll<HTMLButtonElement>("[data-cell-button]")].map(button => {
          const rect = button.getBoundingClientRect();
          return { width: rect.width, height: rect.height, within: rect.left >= bounds.left && rect.right <= bounds.right + 1 };
        });
      });
      expect(measured.every(x => x.height >= 44 && x.width >= 44 && x.within)).toBe(true);
      if (info.project.name !== "desktop") {
        const targets = await surface.locator("button:enabled, select, summary").evaluateAll(elements => elements.map(el => ({ text: el.textContent, height: el.getBoundingClientRect().height })));
        expect(targets.filter(el => el.height < 44)).toEqual([]);
        await info.attach(`${lang}-${theme}-all-touch-targets`, { body: JSON.stringify(targets, null, 2), contentType: "application/json" });
      }
      await surface.screenshot({ path: `test-results/d08b-surface-${info.project.name}-${lang}-${theme}-exact.png` });
      await info.attach(`${lang}-${theme}-cell-targets`, { body: JSON.stringify(measured, null, 2), contentType: "application/json" });
    }
    await surface.getByRole("button", { name: lang === "en" ? "3D surface" : "3D 曲面", exact: true }).click();
    await expect(surface.getByTestId("surface-pill")).toHaveText("103 × 2026-10-16");
    await surface.getByRole("button", { name: lang === "en" ? "Rotate ⟳" : "旋转 ⟳" }).click();
    await expect(surface).toHaveAttribute("data-surface-rotation", "90");
    expect(errors).toEqual([]);
  });
}

test("Surface dense exact path at 320px and 200% zoom retains the last row and all controls", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Single explicit narrow and zoom sequence");
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const surface = await enter(page, "zh", true);
  await surface.getByRole("button", { name: "精确 2D 数值", exact: true }).click();
  const rows = surface.getByTestId("surface-exact-table").locator("tbody tr");
  await expect(rows).toHaveCount(81);
  const last = rows.last().locator("[data-cell-button]");
  await last.focus(); await page.keyboard.press("Enter");
  await expect(last).toHaveAttribute("aria-pressed", "true");
  await expect(surface.getByTestId("surface-pill")).toHaveText("96 × 2026-11-09");
  await page.keyboard.press("Tab");
  await expect(rows.last().getByRole("button", { name: "单元详情", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(surface.getByTestId("surface-inspector")).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expectHorizontalFit(surface);
  await expectViewportTarget(surface.getByTestId("surface-inspector").getByRole("heading"));
  await expectViewportTarget(surface.getByTestId("surface-exact-selected-value"));
  await page.screenshot({ path: "test-results/d08b-surface-320-zh-dense-last-cell.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expectHorizontalFit(surface);
  await surface.getByRole("button", { name: "返回所选单元" }).click(); await expect(last).toBeFocused();
  await expectViewportTarget(last);
  await expectViewportTarget(rows.last().locator("td").first());
  await page.screenshot({ path: "test-results/d08b-surface-css-200percent-zh-selected-row.png" });
  await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  await expect(surface.getByTestId("surface-inspector")).toBeFocused();
  await surface.getByTestId("surface-inspector").getByRole("heading").evaluate(el => el.scrollIntoView({ block: "start" }));
  await expectViewportTarget(surface.getByTestId("surface-inspector").getByRole("heading"));
  await expectViewportTarget(surface.getByTestId("surface-exact-selected-value"));
  await page.screenshot({ path: "test-results/d08b-surface-css-200percent-zh-inspector.png" });
  await expectViewportTarget(surface.getByRole("button", { name: "返回所选单元" }));
  await page.screenshot({ path: "test-results/d08b-surface-css-200percent-zh-return-control.png" });
});
