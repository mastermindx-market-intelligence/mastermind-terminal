import { expect, test, type Page } from "@playwright/test";

async function openSettings(page: Page) {
  const row = page.locator(".lg-row").filter({ has: page.locator(".lg-name").getByText("RSI", { exact: true }) }).first();
  const toggle = page.locator(".lg-collapse").first();
  if (await toggle.count() && (await toggle.getAttribute("title")) === "Show indicator list") await toggle.click();
  await expect(row).toBeVisible({ timeout: 20_000 });
  const opener = row.getByRole("button", { name: "Settings", exact: true });
  if (page.viewportSize()!.width <= 860) {
    await row.locator(".lg-name").click();
    await opener.click();
  } else {
    await expect(row).toHaveAttribute("tabindex", "0");
    await row.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(opener).toBeFocused();
    await page.keyboard.press("Enter");
  }
  const dialog = page.locator("dialog.ind-set");
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  return { dialog, opener };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "en");
    localStorage.setItem("mm.startTf", JSON.stringify("D"));
    localStorage.setItem("mm.inds", JSON.stringify(["rsi"]));
    localStorage.setItem("mm.indParams", JSON.stringify({ rsi: { length: 21 } }));
    localStorage.setItem("mm.indHidden", "[]");
    localStorage.removeItem("mm.ws");
  });
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 20_000 });
});

test("indicator settings contain focus, preserve live edits and keep Cancel reversible", async ({ page }, info) => {
  const overflowBefore = await page.evaluate(() => document.body.style.overflow);
  let { dialog, opener } = await openSettings(page);
  const ok = dialog.getByRole("button", { name: "Ok", exact: true });
  await ok.focus();
  await page.keyboard.press("Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  await expect(ok).toBeFocused();
  const background = page.viewportSize()!.width <= 640 ? page.getByTestId("roller-more") : page.locator(".cfb-gear").first();
  await background.evaluate((element) => (element as HTMLElement).focus());
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  // The existing phone sheet animates into place; prove settled geometry without a fixed sleep.
  await expect.poll(async () => {
    const bounds = await dialog.boundingBox();
    return !!bounds && bounds.x >= 0 && bounds.y >= 0
      && bounds.x + bounds.width <= page.viewportSize()!.width
      && bounds.y + bounds.height <= page.viewportSize()!.height;
  }).toBe(true);
  const crop = info.outputPath("indicator-settings.png");
  await page.screenshot({ path: crop });
  await info.attach("indicator-settings", { path: crop, contentType: "image/png" });

  await dialog.getByRole("spinbutton", { name: "Length", exact: true }).fill("27");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(overflowBefore);
  // Desktop's persistent legend control remains revealed by keyboard focus.
  // Touch legend controls are transient and keep their existing close behavior.
  if (page.viewportSize()!.width > 860) await expect(opener).toBeFocused();

  ({ dialog, opener } = await openSettings(page));
  await expect(dialog.getByRole("spinbutton", { name: "Length", exact: true })).toHaveValue("27");
  await dialog.getByRole("spinbutton", { name: "Length", exact: true }).fill("5");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).press("Enter");
  ({ dialog } = await openSettings(page));
  await expect(dialog.getByRole("spinbutton", { name: "Length", exact: true })).toHaveValue("27");
  await dialog.getByRole("button", { name: "Visibility", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Visibility", exact: true })).toHaveAttribute("aria-pressed", "true");
  const days = dialog.getByRole("checkbox", { name: "Days", exact: true });
  await days.press("Space");
  await expect(dialog.getByRole("spinbutton", { name: "Days minimum", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("slider", { name: "Days maximum", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).press("Enter");
  await expect(dialog).toHaveCount(0);
});
