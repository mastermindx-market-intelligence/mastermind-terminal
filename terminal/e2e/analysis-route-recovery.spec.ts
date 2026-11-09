import { expect, test, type Locator, type Page } from "@playwright/test";

const sharedShell = process.env.MMX_SHARED_SHELL === "1";
const labels = {
  en: { title: "This analysis view is not supported", action: "Company research" },
  zh: { title: "不支持此分析视图", action: "公司研究" },
} as const;

async function reachable(page: Page, link: Locator) {
  await page.keyboard.press("Tab");
  await link.focus();
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeFocused();
  await expect(link).toHaveCSS("outline-style", "solid");
  const box = await link.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  expect(await link.evaluate(node => {
    const box = node.getBoundingClientRect();
    return [box.top + 3, box.top + box.height / 2, box.bottom - 3].every(y => {
      const hit = document.elementFromPoint(box.left + box.width / 2, y);
      return hit === node || node.contains(hit);
    });
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

for (const lang of ["en", "zh"] as const) {
  test(`unsupported analysis link recovers to company research in ${lang}`, async ({ page }, info) => {
    const theme = sharedShell && lang === "zh" ? "light" : "dark";
    if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
    await page.addInitScript(({ language, appearance }) => {
      localStorage.setItem("mm.lang", language);
      localStorage.setItem("mmx.shell.theme", appearance);
    }, { language: lang, appearance: theme });
    await page.route("https://www.mastermind-x.com/mm_brain.js", route => route.fulfill({
      contentType: "application/javascript", body: "",
    }));
    await page.goto("/analysis?view=nope");
    await expect(page.getByRole("heading", { name: labels[lang].title, exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const link = page.getByRole("link", { name: labels[lang].action, exact: true });
    await expect(link).toHaveAttribute("href", "/analysis");
    await reachable(page, link);
    await page.screenshot({ animations: "disabled", path: info.outputPath(`recovery-${lang}.png`) });
    if (info.project.name === "mobile") {
      // Rotation must retain an accessible recovery action inside the real shell.
      await page.setViewportSize({ width: 568, height: 320 });
      const heading = page.getByRole("heading", { name: labels[lang].title, exact: true });
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeInViewport();
      await reachable(page, link);
      if (sharedShell) {
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        expect((await page.locator(".mobilebar").boundingBox())!.y).toBeGreaterThanOrEqual(0);
      }
      await page.screenshot({ animations: "disabled", path: info.outputPath(`recovery-${lang}-landscape.png`) });
    }
    await link.press("Enter");
    await expect(page).toHaveURL(url => url.pathname === "/analysis" && !url.searchParams.has("view"));
    await expect(page.locator(".analysis-shell")).toBeVisible();
    await expect(page.getByRole("heading", { name: labels[lang].title, exact: true })).toHaveCount(0);
  });
}
