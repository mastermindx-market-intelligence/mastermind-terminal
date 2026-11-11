import { test, expect } from "@playwright/test";

// The avatar is optional chrome: opening profile/settings must not replace
// the active Terminal with the app-level error boundary. The same panel is
// used from desktop, tablet and mobile in the beta shared shell.
test("profile avatar opens settings without tearing down Terminal", async ({ page }) => {
  await page.goto("/terminal?symbol=NVDA");
  const avatar = page.locator("button.avatar:visible").first();
  await expect(avatar).toBeVisible();
  await avatar.click();

  const panel = page.locator(".acs-overlay.open");
  await expect(panel).toBeVisible();
  await expect(panel.locator('.acs-nav-b.active')).toContainText("Terminal");
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expect(page.locator('button.avatar:visible').first()).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
  await expect(page.locator('button.avatar:visible').first()).toBeVisible();
});
