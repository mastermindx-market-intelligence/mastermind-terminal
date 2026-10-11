import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

async function openSettings(page: Page, touch: boolean) {
  const row = page.locator(".lg-row.is-cmp").filter({ hasText: "AAPL" }).first();
  await expect(row).toBeAttached();
  const expand = page.getByTitle(/^(Show indicator list|展开指标列表)$/).first();
  if (await expand.count()) await expand.click();
  await expect(row).toBeVisible();
  if (touch) await row.locator(".lg-name").click(); else await row.hover();
  await row.getByRole("button", { name: /^(Settings|设置)$/ }).click();
  const dialog = page.getByRole("dialog", { name: "AAPL", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function addComparison(page: Page, width: number, captureName: string) {
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".lg-row.is-cmp")).toHaveCount(0);
  if (width > 860) await page.locator(".cmp-btn").first().click();
  else if (width <= 640) {
    await page.getByTestId("roller-more").click();
    await page.getByTestId("hub-tile-compare").click();
  } else {
    // Begin with an empty comparison workspace and use physical touch on tablet chrome.
    await page.getByTestId("toolbar-more").tap();
    const compare = page.locator('[data-toolbar-menu-action="compare"]');
    await expect(compare).toBeVisible();
    const rect = await compare.boundingBox();
    expect(rect!.height).toBeGreaterThanOrEqual(44);
    mkdirSync("docs/pr-crops/compare-settings-ux-20260922", { recursive: true });
    await page.screenshot({ path: `docs/pr-crops/compare-settings-ux-20260922/${captureName}-entry.png` });
    await compare.tap();
    await expect(page.locator("#chart-toolbar-overflow")).not.toBeVisible();
  }
  const picker = page.locator(".smodal");
  await picker.getByRole("combobox").fill("AAPL");
  await picker.locator('[role="option"]').first().click();
  await picker.locator(".cmp-seg-half").nth(1).click();
  await picker.locator(".esc").click();
  await expect(picker).toHaveCount(0);
}

for (const lang of ["en", "zh"] as const) {
  test(`[${lang}] comparison settings edit the real overlay without losing modal or saved state`, async ({ page }, info) => {
    await page.addInitScript((language) => localStorage.setItem("mm.lang", language), lang);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const width = page.viewportSize()!.width;
    await addComparison(page, width, `${info.project.name}-${lang}`);
    const dialog = await openSettings(page, width <= 860);
    expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
    const thickness = dialog.getByRole("spinbutton", { name: /Thickness|粗细/ });
    const previous = await thickness.inputValue();
    await thickness.fill(""); await expect(thickness).toHaveValue("");
    await thickness.press("Tab"); await expect(thickness).toHaveValue(previous);
    await thickness.fill("4"); await thickness.press("Tab");
    const increase = dialog.getByRole("button", { name: /^(Thickness|粗细) \+$/ });
    await expect(increase).toBeDisabled();
    await dialog.getByRole("button", { name: /^(Dashed|虚线)$/ }).click();
    await dialog.getByRole("button", { name: /^(Price|价格)$/ }).click();
    await dialog.getByRole("button", { name: /^(Color|颜色) #26c281$/ }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.cmpCfg") || "{}").AAPL))
      .toEqual({ color: "#26c281", lineWidth: 4, lineStyle: 2, mode: "price" });
    for (const button of await dialog.getByRole("button").all()) {
      const rect = await button.boundingBox(); expect(rect).not.toBeNull();
      if (width <= 860) { expect(rect!.width).toBeGreaterThanOrEqual(44); expect(rect!.height).toBeGreaterThanOrEqual(44); }
      expect(await button.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      })).toBe(true);
    }
    await dialog.getByRole("button", { name: /^(Close|关闭)$/ }).focus();
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    mkdirSync("docs/pr-crops/compare-settings-ux-20260922", { recursive: true });
    await page.screenshot({ path: `docs/pr-crops/compare-settings-ux-20260922/${info.project.name}-${lang}.png` });
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
    if (width <= 860) await expect(page.locator(".lg-collapse").first()).toBeFocused();
    const reopened = await openSettings(page, width <= 860);
    await expect(reopened.getByRole("spinbutton")).toHaveValue("4");
    await expect(reopened.getByRole("button", { name: /^(Dashed|虚线)$/ })).toHaveAttribute("aria-pressed", "true");
    await reopened.getByRole("button", { name: /^(Ok|确定)$/ }).click();
    await expect(reopened).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
