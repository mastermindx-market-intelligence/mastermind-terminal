import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

async function openLayers(page: Page, lang = "en") {
  await page.addInitScript((locale) => {
    localStorage.setItem("mm.lang", locale);
    (window as Window & { __layersReady?: boolean }).__layersReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => {
      (window as Window & { __layersReady?: boolean }).__layersReady = true;
    }, { once: true });
  }, lang);
  await page.goto("/terminal?symbol=NVDA");
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __layersReady?: boolean }).__layersReady)), { timeout: 20_000 }).toBe(true);
  await page.locator(".chart-wrap").first().click({ button: "right", position: { x: 80, y: 100 } });
  await page.locator('.ctx-menu [data-a="objtree"]').click();
  await expect(page.locator(".ot-root")).toBeVisible();
  return page.locator(".ot-root");
}

test("chart layers can be found, hidden, restored and removed without losing keyboard focus", async ({ page }, info) => {
  const panel = await openLayers(page);
  mkdirSync("docs/pr-crops/chart-layers-ux-20260922", { recursive: true });
  await page.screenshot({ path: `docs/pr-crops/chart-layers-ux-20260922/${info.project.name}-open.png` });
  const search = panel.getByRole("searchbox");
  await expect(search).toBeFocused();
  await search.fill("Moving Averages");
  await expect(panel.locator("[data-layer-key]")).toHaveCount(1);
  const row = panel.locator('[data-layer-key="ema"]');
  await row.getByRole("button", { name: "Hide Moving Averages", exact: true }).click();
  await expect(row).toHaveAttribute("data-hidden", "true");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.indHidden") ?? "[]"))).toContain("ema");
  await row.getByRole("button", { name: "Show Moving Averages", exact: true }).click();
  await expect(row).toHaveAttribute("data-hidden", "false");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.indHidden") ?? "[]"))).not.toContain("ema");
  await row.getByRole("button", { name: "Remove Moving Averages", exact: true }).click();
  await expect(row).toHaveCount(0); await expect(search).toBeFocused();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.inds") ?? "[]"))).not.toContain("ema");
  await search.press("Escape"); await expect(search).toHaveValue(""); await expect(panel).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await search.press("Escape"); await expect(panel).toHaveCount(0);
});

test("[zh] layer controls remain visible and touch-sized without hiding their meaning", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const panel = await openLayers(page, "zh");
  await expect(panel.getByRole("heading", { name: "图层树", exact: true })).toBeVisible();
  await expect(panel.getByRole("searchbox", { name: "搜索 指标" })).toBeVisible();
  const hide = panel.getByRole("button", { name: "隐藏 Moving Averages", exact: true });
  await expect(hide).toBeVisible();
  if (info.project.name !== "desktop") {
    const controls = panel.locator("button");
    for (const control of await controls.all()) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
      expect(await control.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return target !== null && button.contains(target);
      }), "the study action must not be covered by chart chrome or clipped by its pane").toBe(true);
      const rect = await control.boundingBox(); expect(rect).not.toBeNull();
      expect(rect!.width).toBeGreaterThanOrEqual(44); expect(rect!.height).toBeGreaterThanOrEqual(44);
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  mkdirSync("docs/pr-crops/chart-layers-ux-20260922", { recursive: true });
  await page.screenshot({ path: `docs/pr-crops/chart-layers-ux-20260922/${info.project.name}-zh.png` });
  await panel.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(panel).toHaveCount(0); expect(errors).toEqual([]);
});

test("an open study filter survives responsive layout changes in the same panel", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one breakpoint round trip from the desktop contract");
  const panel = await openLayers(page);
  await panel.getByRole("searchbox").fill("Volume");
  await expect(panel.locator("[data-layer-key]")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(panel).toHaveCount(1);
  await expect.poll(() => panel.evaluate((element) => element.matches(":popover-open"))).toBe(true);
  await expect(panel.getByRole("searchbox")).toHaveValue("Volume");
  await expect(panel.getByRole("button", { name: "Hide Volume", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => panel.evaluate((element) => element.hasAttribute("popover"))).toBe(false);
  await expect(panel.getByRole("searchbox")).toHaveValue("Volume");
  await expect(panel.locator("[data-layer-key]")).toHaveCount(1);
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(panel).toHaveCount(0);
});
