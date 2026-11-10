import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(name + ".png");
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
}

async function openSettings(page: Page, touch: boolean) {
  const row = page.locator(".lg-row.is-cmp").filter({ hasText: "AAPL" }).first();
  await expect(row).toBeAttached();
  const expand = page.getByTitle(/^(Show indicator list|展开指标列表)$/).first();
  if (await expand.count()) await expand.click();
  await expect(row).toBeVisible();
  if (touch) await row.locator(".lg-name").tap(); else await row.hover();
  const settings = row.getByRole("button", { name: /^(Settings|设置)$/ });
  if (touch) await settings.tap(); else await settings.click();
  const dialog = page.getByRole("dialog", { name: "AAPL", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function addComparison(page: Page, width: number, info: TestInfo) {
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".lg-row.is-cmp")).toHaveCount(0);
  if (width > 860) {
    await page.locator(".cmp-btn").first().click();
  } else if (width <= 640) {
    await page.getByTestId("roller-more").tap();
    await page.getByTestId("hub-tile-compare").tap();
    await expect(page.getByTestId("hub-tile-compare")).not.toBeVisible();
  } else {
    await page.getByTestId("toolbar-more").tap();
    const compare = page.locator('[data-toolbar-menu-action="compare"]');
    await expect(compare).toBeVisible();
    const rect = await compare.boundingBox();
    expect(rect!.height).toBeGreaterThanOrEqual(44);
    await capture(page, info, "compare-entry");
    await compare.tap();
    await expect(page.locator("#chart-toolbar-overflow")).not.toBeVisible();
  }
  const picker = page.locator(".smodal-cmp");
  await expect(picker).toBeVisible();
  await picker.getByRole("combobox").fill("AAPL");
  await expect(picker.getByRole("listbox")).toHaveAttribute("aria-busy", "false");
  const row = picker.locator(".r").filter({ has: page.locator(".tk", { hasText: /^AAPL$/ }) });
  await expect(row).toHaveCount(1);
  await row.getByRole("option").click();
  const percent = row.getByRole("button", { name: /^(Percent|百分比)$/ });
  await expect(percent).toBeEnabled();
  await percent.click();
  await picker.getByRole("button", { name: /^(Close comparison|关闭对比)$/ }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.locator(".lg-row.is-cmp").filter({ hasText: "AAPL" })).toHaveCount(1);
}

async function returnFocus(page: Page, info: TestInfo, label: string) {
  const state = () => page.evaluate(() => {
    const active = document.activeElement;
    const element = active instanceof HTMLElement ? active : null;
    const row = element?.closest(".lg-row.is-cmp");
    const relevant = Boolean(element && (
      (row && row.textContent?.includes("AAPL")) ||
      element.matches(".cmp-btn, .lg-collapse")
    ));
    return {
      connected: element?.isConnected ?? false,
      visible: Boolean(element?.getClientRects().length),
      relevant,
      tag: element?.tagName ?? null,
      className: element?.className ?? null,
      label: element?.getAttribute("aria-label") ?? null,
    };
  });
  try {
    await expect.poll(async () => {
      const value = await state();
      return value.connected && value.visible && value.relevant;
    }).toBe(true);
  } finally {
    await info.attach(label, { body: JSON.stringify(await state(), null, 2), contentType: "application/json" });
  }
}

for (const lang of ["en", "zh"] as const) {
  test(`[${lang}] comparison settings edit the real overlay without losing modal or saved state`, async ({ page }, info) => {
    await page.addInitScript((language) => localStorage.setItem("mm.lang", language), lang);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const width = page.viewportSize()!.width;
    await addComparison(page, width, info);
    const dialog = await openSettings(page, width <= 860);
    expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
    await expect(dialog).toBeFocused();
    const thickness = dialog.getByRole("spinbutton", { name: /^(Thickness|粗细)$/ });
    const previous = await thickness.inputValue();
    await thickness.fill(""); await expect(thickness).toHaveValue("");
    await thickness.press("Tab"); await expect(thickness).toHaveValue(previous);
    await thickness.fill("9"); await expect(thickness).toHaveValue("9");
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.cmpCfg") || "{}").AAPL?.lineWidth ?? 2)).toBe(Number(previous));
    await thickness.press("Enter"); await expect(thickness).toHaveValue("4");
    const increase = dialog.getByRole("button", { name: /^(Increase thickness|增大粗细)$/ });
    await expect(increase).toBeDisabled();
    await dialog.getByRole("button", { name: /^(Dashed|虚线)$/ }).click();
    await dialog.getByRole("button", { name: /^(Price|价格)$/ }).click();
    await dialog.getByRole("button", { name: /^(Color|颜色): #26c281$/ }).click();
    await expect(dialog.locator('input[type="color"]')).toHaveValue("#26c281");
    await expect(dialog.locator("code")).toHaveText("#26C281");
    const saved = { color: "#26c281", lineWidth: 4, lineStyle: 2, mode: "price" };
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.cmpCfg") || "{}").AAPL)).toEqual(saved);
    for (const button of await dialog.getByRole("button").all()) {
      const rect = await button.boundingBox(); expect(rect).not.toBeNull();
      if (width <= 860) {
        expect(rect!.width).toBeGreaterThanOrEqual(44);
        expect(rect!.height).toBeGreaterThanOrEqual(44);
      }
      expect(await button.evaluate((element) => {
        const r = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      })).toBe(true);
    }
    const close = dialog.getByRole("button", { name: /^(Close|关闭)$/ });
    const done = dialog.getByRole("button", { name: /^(Done|完成)$/ });
    await close.focus(); await page.keyboard.press("Shift+Tab"); await expect(done).toBeFocused();
    await page.keyboard.press("Tab"); await expect(close).toBeFocused();
    await capture(page, info, "comparison-settings");
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
    await returnFocus(page, info, "escape-return-focus");
    const reopened = await openSettings(page, width <= 860);
    await expect(reopened.getByRole("spinbutton")).toHaveValue("4");
    await expect(reopened.getByRole("button", { name: /^(Dashed|虚线)$/ })).toHaveAttribute("aria-pressed", "true");
    await reopened.getByRole("button", { name: /^(Done|完成)$/ }).click();
    await expect(reopened).toHaveCount(0);
    await returnFocus(page, info, "done-return-focus");
    const finalDialog = await openSettings(page, width <= 860);
    await finalDialog.getByRole("button", { name: /^(Close|关闭)$/ }).click();
    await expect(finalDialog).toHaveCount(0);
    await returnFocus(page, info, "close-return-focus");
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mm.cmpCfg") || "{}").AAPL)).toEqual(saved);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
