import { expect, test, type Locator, type Page } from "@playwright/test";

const sharedShell = process.env.MMX_SHARED_SHELL === "1";
const missingPath = "/__beta_missing_route_ui_probe";
const destinations = [
  { path: "/today", en: "Go to Today", zh: "前往今日" },
  { path: "/discover", en: "Browse tools", zh: "浏览工具" },
  { path: "/terminal", en: "Go to chart", zh: "返回图表" },
];

async function openMissing(page: Page, lang: "en" | "zh") {
  const response = await page.goto(missingPath);
  expect(response?.status()).toBe(404);
  // The same recovery journey runs in default CI and the explicit beta shell.
  // Saved language must restore before any presentation control is used.
  await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
  await expect(page.getByRole("navigation", { name: lang === "zh" ? "返回入口" : "Recovery destinations", exact: true })).toBeVisible();
  const theme = sharedShell && lang === "zh" ? "light" : "dark";
  if (sharedShell) {
    await expect(page.locator("html")).toHaveAttribute("data-mmx-shared-shell", "1");
    await expect(page.getByRole("button", { name: /Chinese language|English language|中文界面|英文界面/ })).toBeVisible();
    const themeToggle = page.getByRole("button", { name: /Light theme|浅色主题/ });
    if (await themeToggle.getAttribute("aria-pressed") !== String(theme === "light")) await themeToggle.click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function reachable(page: Page, link: Locator) {
  await page.keyboard.press("Tab");
  await link.scrollIntoViewIfNeeded();
  await link.focus();
  const box = await link.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  await expect(link).toBeFocused();
  if (sharedShell) {
    // Beta keeps scrolling inside its content row. Legacy mobile uses page scrolling.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const header = page.locator(page.viewportSize()!.width <= 860 ? ".mobilebar" : ".topbar");
    expect((await header.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  }
  await expect(link).toHaveCSS("outline-style", "solid");
  await expect(link).toHaveCSS("outline-width", "2px");
  expect(await link.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit === node || node.contains(hit);
  })).toBe(true);
}

for (const lang of ["en", "zh"] as const) {
  test(`404 recovery exposes real keyboard destinations in ${lang}`, async ({ page }, info) => {
    if (info.project.name === "mobile") await page.setViewportSize({ width: 320, height: 568 });
    await page.addInitScript(language => localStorage.setItem("mm.lang", language), lang);
    for (const destination of destinations) {
      await openMissing(page, lang);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("404");
      const link = page.getByRole("link", { name: destination[lang], exact: true });
      await expect(link).toHaveAttribute("href", destination.path);
      await reachable(page, link);
      if (destination.path === "/today") {
        await page.screenshot({ animations: "disabled", path: info.outputPath(`not-found-${lang}.png`) });
      }
      await link.press("Enter");
      await expect(page).toHaveURL(url => url.pathname === destination.path);
      await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: "404" })).toHaveCount(0);
      if (destination.path === "/terminal") await expect(page.locator(".chart-body").first()).toBeVisible();
      else if (destination.path === "/today") await expect(page.getByRole("heading", { level: 1, name: /^(Sign in to open Today|登录后查看今日工作区)$/ })).toBeVisible();
      else if (sharedShell) await expect(page.getByRole("heading", { level: 1, name: /^(Discover|发现)$/ })).toBeVisible();
      else await expect(page.getByRole("tablist", { name: /^(Discover tabs|发现选项卡)$/ })).toBeVisible();
    }
  });
}

for (const lang of ["en", "zh"] as const) {
  test(`404 recovery keeps all destinations reachable on short and narrow screens in ${lang}`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "Explicit viewport loop runs once per language");
    await page.addInitScript(language => localStorage.setItem("mm.lang", language), lang);
    for (const viewport of [{ width: 568, height: 320 }, { width: 320, height: 568 }, { width: 320, height: 844 }]) {
      await page.setViewportSize(viewport);
      await openMissing(page, lang);
      for (const destination of destinations) {
        const link = page.getByRole("link", { name: destination[lang], exact: true });
        await reachable(page, link);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const first = page.getByRole("link", { name: destinations[0][lang], exact: true });
      await first.focus();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: destinations[1][lang], exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: destinations[2][lang], exact: true })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(page.getByRole("link", { name: destinations[1][lang], exact: true })).toBeFocused();
      await page.screenshot({ animations: "disabled", path: info.outputPath(`not-found-${lang}-${viewport.width}x${viewport.height}.png`) });
    }
  });
}
