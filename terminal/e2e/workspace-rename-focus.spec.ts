import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { isolateLayoutStore, seedUnreadableWorkspace, useLang as pinLanguage } from "./layoutStore";
import { openLayoutMenu } from "./terminalToolbar";

for (const lang of ["en", "zh"] as const) {
  test(`workspace rename keeps the keyboard task intact (${lang})`, async ({ page, baseURL }, info) => {
    test.setTimeout(90_000);
    await isolateLayoutStore(page, info, baseURL); await pinLanguage(page, lang);
    await page.goto("/terminal?symbol=NVDA");
    await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
    let menu = await openLayoutMenu(page);
    const create = menu.locator("[data-layout-save] input");
    await create.fill("Alpha");
    // Exercise browser composition signals without pretending to operate an OS IME.
    for (const signal of [{ isComposing: true }, { keyCode: 229 }]) {
      for (const key of ["Enter", "Escape"]) {
        const defaultAllowed = await create.evaluate((node, options) => node.dispatchEvent(new KeyboardEvent("keydown", {
          ...options, bubbles: true, cancelable: true,
        })), { key, ...signal });
        expect(defaultAllowed).toBe(true);
        await expect(menu).toBeVisible(); await expect(create).toBeFocused();
        await expect(menu.locator('[data-layout-row="Alpha"]')).toHaveCount(0);
      }
    }
    await create.press("Enter");
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

test("late rename success never replays while a newer draft is being typed", async ({ page, baseURL }, info) => {
  test.setTimeout(90_000);
  test.skip(info.project.name !== "desktop", "One network-response case; the full keyboard flow covers all viewports");
  await isolateLayoutStore(page, info, baseURL); await pinLanguage(page, "en");
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  const menu = await openLayoutMenu(page);
  await menu.locator("[data-layout-save] input").fill("Original");
  await menu.locator("[data-layout-save-btn]").click();
  const row = menu.locator('[data-layout-row="Original"]');
  await expect(row).toBeVisible(); await row.locator("[data-ws-more]").click();
  await row.locator('[data-ws-act="rename"]').click();
  const input = menu.locator("[data-ws-rename-input]");
  let release = () => {};
  let started = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  let renameRequests = 0;
  await page.route("**/api/layouts", async route => {
    const request = route.request();
    if (request.method() === "POST" && request.postDataJSON()?.op === "rename") {
      renameRequests += 1;
      if (renameRequests === 1) { started(); await held; }
    }
    await route.continue();
  });
  try {
    await input.fill("Submitted"); await input.press("Enter"); await requestStarted;
    await input.fill("Newer draft"); release();
    await expect(menu.locator('[data-layout-feedback="renamed"]')).toBeVisible();
    await expect(menu.locator('[data-layout-row="Submitted"]')).toBeVisible();
    await expect(input).toHaveValue("Newer draft"); await expect(input).toBeFocused();
    // The exact old-name prefix previously replayed the consumed close request.
    await input.fill("Submitted"); await expect(input).toHaveValue("Submitted");
    await page.keyboard.type(" extended"); await expect(input).toHaveValue("Submitted extended");
    await expect(input).toBeFocused(); expect(renameRequests).toBe(1);
    await page.screenshot({ path: info.outputPath("late-rename-draft.png") });
    await input.press("Escape"); await expect(input).toBeHidden();
    await expect(menu.locator('[data-ws-more="Submitted"]')).toBeFocused();
  } finally { release(); await page.unroute("**/api/layouts"); }
});

test("unreadable workspace actions stay keyboard accessible without opening the workspace", async ({ page, baseURL }, info) => {
  test.setTimeout(90_000);
  await isolateLayoutStore(page, info, baseURL); await pinLanguage(page, "en");
  await page.goto("/terminal?symbol=NVDA"); await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  const name = "Research archive — saved by a newer workspace format";
  await seedUnreadableWorkspace(page, name);
  await page.reload(); await expect(page.locator(".mm-ptag")).toBeVisible();
  const stored = await (await page.request.get("/api/layouts")).json() as { layouts: { name: string; config: unknown }[] };
  const expectedRaw = stored.layouts.find(layout => layout.name === name)?.config;
  expect(expectedRaw).toBeDefined();
  const menu = await openLayoutMenu(page);
  const row = menu.locator(`[data-layout-row="${name}"]`);
  const open = row.locator("[data-ws-open]");
  const more = row.locator("[data-ws-more]");
  await expect(open).toBeDisabled(); await expect(more).toBeEnabled();
  expect(await more.evaluate(element => element.tagName)).toBe("BUTTON");
  expect(await more.evaluate(element => element.parentElement?.closest("button") === null)).toBe(true);

  for (const key of ["Enter", "Space"]) {
    await more.focus(); await more.press(key);
    const exportAction = row.locator('[data-ws-act="export"]');
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(exportAction).toBeFocused();
    await exportAction.press("Escape");
    await expect(more).toBeFocused(); await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeVisible();
  }
  await more.press("Enter");
  const download = page.waitForEvent("download");
  await row.locator('[data-ws-act="export"]').press("Enter");
  const exported = await download;
  expect(exported.suggestedFilename()).toMatch(/\.json$/);
  const exportedPath = info.outputPath("unreadable-workspace.json");
  await exported.saveAs(exportedPath);
  expect(JSON.parse(await readFile(exportedPath, "utf8"))).toEqual(expectedRaw);
  // A programmatic download can dismiss the surrounding desktop popover. Reopen through
  // its existing owner and confirm the unreadable workspace was preserved, not loaded.
  const reopened = await openLayoutMenu(page);
  await expect(reopened.locator("[data-ws-open]")).toBeDisabled();
  const actions = reopened.locator("[data-ws-more]");
  if (await actions.getAttribute("aria-expanded") !== "true") await actions.click();
  expect(await reopened.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await reopened.screenshot({ path: info.outputPath(`workspace-actions-${info.project.name}.png`) });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await reopened.screenshot({ path: info.outputPath(`workspace-actions-${info.project.name}-light.png`) });
});
