import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

for (const lang of ["en", "zh"] as const) {
  test(`document language matches stored ${lang} before and after hydration`, async ({ page }, info) => {
    await page.addInitScript((locale: string) => {
      // Only set the EXISTING preference; never force data-lang or html lang.
      if (window.localStorage.getItem("mm.lang") === null) {
        window.localStorage.setItem("mm.lang", locale);
      }
    }, lang);
    await page.goto("/terminal?symbol=NVDA", { waitUntil: "domcontentloaded" });
    const expected = lang === "zh" ? "zh-CN" : "en";
    await expect(page.locator("html")).toHaveAttribute("lang", expected);
    await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
    await expect(page.locator(".mm-ptag").first()).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", expected);

    if (process.env.DOCUMENT_LANGUAGE_CROPS) {
      const dir = join(process.cwd(), "docs/pr-crops/document-language");
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: join(dir, `${info.project.name}-${lang}.png`), fullPage: true });
    }

    // A normal persisted preference transition must not resurrect the wrong root language.
    const other = lang === "zh" ? "en" : "zh";
    await page.evaluate((locale) => localStorage.setItem("mm.lang", locale), other);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-lang", other);
    await expect(page.locator("html")).toHaveAttribute("lang", other === "zh" ? "zh-CN" : "en");
  });
}

test.describe("browser locale without a saved preference", () => {
  test.use({ locale: "zh-CN" });
  test("prepaint and hydration use the existing Chinese browser-locale fallback", async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("mm.lang"));
    await page.goto("/terminal?symbol=NVDA", { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-lang", "zh");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.locator(".mm-ptag").first()).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  });
});
