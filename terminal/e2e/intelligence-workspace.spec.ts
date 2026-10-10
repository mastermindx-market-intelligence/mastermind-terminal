import { expect, test } from "@playwright/test";

test("Golden Oracle and Research Desk open one responsive Intelligence workspace", async ({ page }, testInfo) => {
  await page.goto("/terminal?symbol=AAPL");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  await expect(page.locator(".sig-btn")).toBeVisible({ timeout: 25_000 });
  await page.locator(".sig-btn").click();
  const dialog = page.getByRole("dialog", { name: /Research Desk and Golden Oracle/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".sd-dock.sd-intelligence")).toBeVisible();
  await expect(dialog.locator(".sd-intel-summary")).toBeVisible();
  await expect(dialog.locator(".sd-intel-heading")).toContainText("AAPL");
  await dialog.locator(".sd-dock").screenshot({ path: testInfo.outputPath("intelligence-summary.png") });
  const tabs = dialog.locator(".sd-intel-tabs");
  await expect(tabs.getByRole("button", { name: "Summary" })).toHaveClass(/active/);
  await tabs.getByRole("button", { name: "Oracle" }).click();
  await expect(dialog.locator(".sd-go")).toBeVisible();
  await expect(dialog.locator(".sd-rd")).toBeHidden();
  await tabs.getByRole("button", { name: "Research" }).click();
  await expect(dialog.locator(".sd-rd")).toBeVisible();
  await expect(dialog.locator(".sd-go")).toBeHidden();
  await tabs.getByRole("button", { name: "Activity" }).click();
  await expect(dialog.locator(".sd-go")).toBeVisible();
  await expect(dialog.locator(".sd-go .od-sig-section").first()).toBeVisible();
  await tabs.getByRole("button", { name: "Summary" }).click();
  await expect(dialog.locator(".sd-intel-summary")).toBeVisible();

  const frame = await dialog.locator(".sd-dock").boundingBox();
  const viewport = page.viewportSize()!;
  expect(frame).not.toBeNull();
  expect(frame!.x).toBeGreaterThanOrEqual(-1);
  expect(frame!.y).toBeGreaterThanOrEqual(-1);
  expect(frame!.x + frame!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(frame!.y + frame!.height).toBeLessThanOrEqual(viewport.height + 1);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
