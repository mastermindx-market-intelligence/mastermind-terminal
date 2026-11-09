import { expect, test } from "@playwright/test";
import { isolateLayoutStore, useLang as pinLanguage } from "./layoutStore";
import { openLayoutMenu } from "./terminalToolbar";

for (const lang of ["en", "zh"] as const) {
  test(`workspace rename keeps the keyboard task intact (${lang})`, async ({ page, baseURL }, info) => {
    test.setTimeout(90_000);
    await isolateLayoutStore(page, info, baseURL); await pinLanguage(page, lang);
    await page.goto("/terminal?symbol=NVDA");
    await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
    let menu = await openLayoutMenu(page);
    const create = menu.locator("[data-layout-save] input");
    await create.fill("Alpha"); await menu.locator("[data-layout-save-btn]").click();
    let row = menu.locator('[data-layout-row="Alpha"]');
    await expect(row).toBeVisible();
    await row.locator("[data-ws-more]").click(); await row.locator('[data-ws-act="rename"]').click();
    const name = lang === "zh" ? "顺畅工作区" : "Smooth workspace";
    let input = menu.locator("[data-ws-rename-input]");
    await input.fill(name);
    await page.keyboard.press("Tab"); await expect(menu.locator("[data-ws-rename-commit]")).toBeFocused();
    await expect(input).toHaveValue(name);
    await page.keyboard.press("Shift+Tab"); await expect(input).toBeFocused();
    await page.keyboard.press("Tab");
    await page.screenshot({ path: info.outputPath(`rename-save-${info.project.name}-${lang}.png`) });
    await page.keyboard.press("Enter");
    await expect(menu.locator('[data-layout-feedback="renamed"]')).toBeVisible();
    row = menu.locator(`[data-layout-row="${name}"]`);
    await expect(row).toBeVisible(); await expect(row.locator("[data-ws-more]")).toBeFocused();

    // Both authored controls remain reachable; Cancel preserves the confirmed name.
    await row.locator('[data-ws-act="rename"]').click(); input = menu.locator("[data-ws-rename-input]");
    await input.fill("Discard this draft");
    await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
    await expect(menu.locator("[data-ws-rename-cancel]")).toBeFocused();
    await page.keyboard.press("Space"); await expect(input).toBeHidden();
    await expect(row.locator("[data-ws-more]")).toBeFocused(); await expect(menu).toBeVisible();

    // Escape cancels the editor, then the row, then its containing popover/sheet.
    await row.locator('[data-ws-act="rename"]').click();
    await page.keyboard.press("Tab"); await expect(menu.locator("[data-ws-rename-commit]")).toBeFocused();
    await page.keyboard.press("Escape"); await expect(input).toBeHidden();
    await expect(row.locator("[data-ws-more]")).toBeFocused(); await expect(menu).toBeVisible();
    await expect(row.locator('[data-ws-act="rename"]')).toBeVisible();
    await page.keyboard.press("Escape"); await expect(row.locator('[data-ws-act="rename"]')).toBeHidden();
    await expect(menu).toBeVisible(); await page.keyboard.press("Escape"); await expect(menu).toBeHidden();

    menu = await openLayoutMenu(page); row = menu.locator(`[data-layout-row="${name}"]`);
    await row.locator("[data-ws-more]").click(); await row.locator('[data-ws-act="rename"]').click();
    await menu.locator("[data-ws-rename-input]").fill("Leave without saving");
    await menu.locator("[data-layout-save] input").click();
    await expect(menu.locator("[data-ws-rename-input]")).toBeHidden();
    await expect(menu.locator("[data-layout-save] input")).toBeFocused();
    await expect(row).toBeVisible();

    // A fresh real read confirms that keyboard Save persisted and cancellation did not write.
    await page.reload(); await expect(page.locator(".mm-ptag")).toBeVisible();
    menu = await openLayoutMenu(page);
    await expect(menu.locator(`[data-layout-row="${name}"]`)).toBeVisible();
    await expect(menu.locator('[data-layout-row="Discard this draft"], [data-layout-row="Leave without saving"]')).toHaveCount(0);
  });
}
