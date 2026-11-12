import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const baseIntel = JSON.parse(readFileSync(join(process.cwd(), "public/data/SPY.intel.json"), "utf8"));

async function openEventDetails(page: Page, zh: boolean) {
  await page.addInitScript(({ language, theme }) => {
    localStorage.setItem("mm.lang", language);
    localStorage.setItem("mmx.shell.theme", theme);
    document.documentElement.setAttribute("data-lang", language);
    document.documentElement.setAttribute("data-theme", theme);
  }, { language: zh ? "zh" : "en", theme: zh ? "light" : "dark" });
  await page.route(url => url.pathname === "/data/SPY.intel.json", route => route.fulfill({ json: {
    ...baseIntel,
    analysis: {
      ...baseIntel.analysis,
      decision: {
        ...baseIntel.analysis.decision,
        trust_en: "Event context is one input to the research process. Read the underlying earnings and revision evidence before drawing a conclusion. ".repeat(8),
        trust_zh: "事件背景只是研究过程中的一项信息。请先阅读相关财报与评级调整的证据，再形成自己的判断。".repeat(12),
      },
      analyst: {
        ...baseIntel.analysis.analyst,
        drivers: Array.from({ length: 8 }, (_, index) => `Evidence context ${index + 1}: ${"source_reference_".repeat(12)}`),
      },
    },
  } }));
  await page.goto("/terminal?symbol=SPY");
  const badge = page.locator(".sa-trust").first();
  await expect(badge).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", zh ? "light" : "dark");
  await expect(page.locator("html")).toHaveAttribute("data-lang", zh ? "zh" : "en");
  await badge.scrollIntoViewIfNeeded();
  await badge.focus();
  await badge.press("Enter");
  const dialog = page.getByRole("dialog", { name: zh ? "事件驱动详情" : "Event edge details", exact: true });
  await expect(dialog).toBeVisible();
  return { badge, dialog };
}

async function expectContained(page: Page) {
  const dialog = page.locator(".eep-pop");
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(7);
  expect(bounds!.y).toBeGreaterThanOrEqual(7);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width - 7);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height - 7);
  const overflow = await dialog.evaluate(el => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const driversWrap = await dialog.locator(".eep-chip-driver .eep-chip-v").evaluateAll(elements =>
    elements.every(el => el.scrollWidth <= el.clientWidth + 1));
  expect(driversWrap).toBe(true);
  const unobstructed = await dialog.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return [rect.top + 5, rect.top + rect.height / 2, rect.bottom - 5].every(y =>
      el.contains(document.elementFromPoint(rect.left + rect.width / 2, y)));
  });
  expect(unobstructed).toBe(true);
}

for (const zh of [false, true]) {
  test(`event details remain readable and dismissible — ${zh ? "Chinese light" : "English dark"}`, async ({ page }, testInfo) => {
    if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
    const { badge, dialog } = await openEventDetails(page, zh);
    await page.screenshot({ path: testInfo.outputPath("opened.png"), animations: "disabled" });
    await expectContained(page);
    await badge.press("Tab");
    await expect(dialog).toBeFocused();
    await page.keyboard.press("End");
    const footer = dialog.locator(".eep-footer");
    await expect(footer).toBeInViewport();
    const lastDriver = dialog.locator(".eep-chip-driver").last();
    await expect(lastDriver).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("scrolled.png"), animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(badge).toBeFocused();
    await badge.press("Space");
    await expect(dialog).toBeVisible();
    await expectContained(page);
    await page.mouse.click(2, 2);
    await expect(dialog).toHaveCount(0);
  });
}

test("an open event detail follows viewport changes and remains internally scrollable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One actual resize journey covers the same shared component.");
  const { dialog } = await openEventDetails(page, false);
  for (const viewport of [{ width: 568, height: 320 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const rect = await dialog.boundingBox();
      return rect ? rect.x >= 7 && rect.y >= 7 && rect.x + rect.width <= viewport.width - 7 && rect.y + rect.height <= viewport.height - 7 : false;
    }).toBe(true);
    await expectContained(page);
    await dialog.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(dialog.locator(".eep-footer")).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`resized-${viewport.width}x${viewport.height}.png`), animations: "disabled" });
  }
  await dialog.focus();
  await page.keyboard.press("Tab");
  const outside = await page.locator(":focus").elementHandle();
  expect(await outside?.evaluate(el => el !== document.body && !el.closest(".eep-pop"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await outside?.evaluate(el => el === document.activeElement)).toBe(true);
});
