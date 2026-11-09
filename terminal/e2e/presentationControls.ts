import { expect, type Page } from "@playwright/test";

// Use the same visible preference action as the reader. A direct root attribute
// write races the canonical account presentation owner and is not theme intent.
export async function selectAppearance(page: Page, lang: "en" | "zh", theme: "light" | "dark") {
  const topbar = page.locator("header.topbar");
  const host = await topbar.isVisible() ? topbar : page.locator(".mobilebar");
  await host.getByRole("button", { name: lang === "en" ? "Settings" : "设置", exact: true }).click();
  await page.getByRole("tab", { name: lang === "en" ? "Preferences" : "偏好", exact: true }).click();
  const choice = page.getByRole("group", { name: lang === "en" ? "Appearance" : "外观", exact: true })
    .getByRole("button", { name: theme === "light" ? (lang === "en" ? "Light" : "浅色") : (lang === "en" ? "Dark" : "深色"), exact: true });
  await choice.click();
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: lang === "en" ? "Close" : "关闭", exact: true }).first().click();
  await expect(page.locator(".acs-overlay")).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}
