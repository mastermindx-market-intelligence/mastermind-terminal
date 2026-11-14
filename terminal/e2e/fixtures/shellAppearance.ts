import { expect, type Page } from "@playwright/test";

/** Load the same saved presentation users recover when returning to Beta. */
export async function setShellAppearance(page: Page, lang: "en" | "zh", theme: "dark" | "light") {
  await page.evaluate(({ lang, theme }) => {
    localStorage.setItem("mm.lang", lang);
    localStorage.setItem("mmx.shell.theme", theme);
  }, { lang, theme });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}
