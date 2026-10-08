import { expect, test } from "@playwright/test";

// Uses the repository's existing local fixture server and real route bodies.
// This opt-in file also runs in the ordinary suite as an explicit skip, rather
// than changing the normal customer shell or creating another browser harness.
test.skip(process.env.MMX_INVESTOR_SHELL_PREVIEW !== "1", "Private shell preview is default off");

for (const route of ["/analysis?symbol=NVDA", "/discover"] as const) {
  test(`existing ${route} uses the preview without losing its page or mobile owner`, async ({ page }, testInfo) => {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    const shell = page.locator('[data-investor-shell="preview"]');
    await expect(shell).toBeVisible();
    await expect(shell.locator(".main2").first()).toBeVisible();
    await expect(shell.locator(".main2").first()).not.toHaveText("");
    await expect(shell.locator("#investor-primary-navigation")).toHaveCount(1);
    const desktop = testInfo.project.name === "desktop";
    if (desktop) {
      const nav = shell.locator("nav.appnav");
      await expect(nav).toBeVisible();
      await expect(nav.locator("a")).toHaveCount(8);
      await expect(nav.locator(".investor-nav-label")).toHaveCount(9);
      const rail = await nav.boundingBox();
      expect(Math.round(rail!.width)).toBe(224);
      const toggle = shell.locator("[data-investor-compact-toggle]");
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect(nav.locator(".investor-nav-label")).toHaveCount(0);
      await expect(nav.locator("a[aria-label]")).toHaveCount(8);
      expect(Math.round((await nav.boundingBox())!.width)).toBe(72);
      await page.screenshot({ path: testInfo.outputPath(`${route.startsWith("/analysis") ? "analysis" : "discover"}-compact.png`) });
      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expect(nav.locator(".investor-nav-label")).toHaveCount(9);
    } else {
      await expect(shell.locator("header.topbar")).toBeHidden();
      await expect(shell.locator("nav.appnav")).toBeHidden();
      await expect(shell.locator(".mobilebar")).toBeVisible();
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      await expect(page.locator(".m-drawer.open")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(".m-drawer.open")).toBeHidden();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${route.startsWith("/analysis") ? "analysis" : "discover"}-${testInfo.project.name}.png`) });
  });
}

test("native navigation preserves the same shell and the chart route stays excluded", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop link keyboard path; mobile ownership is exercised separately");
  await page.goto("/analysis?symbol=NVDA");
  const nav = page.locator("#investor-primary-navigation");
  await nav.getByRole("link", { name: "Discover", exact: true }).click();
  await expect(page).toHaveURL(/\/discover/);
  await expect(page.locator('[data-investor-shell="preview"]')).toBeVisible();
  await nav.getByRole("link", { name: "Analysis", exact: true }).click();
  await expect(page).toHaveURL(/\/analysis/);
  await expect(nav.getByRole("link", { name: "Analysis", exact: true })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "Chart", exact: true }).click();
  await expect(page).toHaveURL(/\/terminal/);
  await expect(page.locator("[data-investor-shell]")).toHaveCount(0);
});

for (const lang of ["en", "zh"] as const) {
  test(`preview navigation labels remain readable in ${lang}`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem("mm.lang", value), lang);
    await page.goto("/analysis?symbol=NVDA");
    const shell = page.locator('[data-investor-shell="preview"]');
    await expect(shell).toBeVisible();
    if (testInfo.project.name === "desktop") {
      const nav = shell.locator("nav.appnav");
      await expect(nav.getByRole("link", { name: lang === "en" ? "Analysis" : "分析", exact: true })).toBeVisible();
      await expect(shell.locator("[data-investor-compact-toggle]")).toHaveAttribute("aria-label", lang === "en" ? "Compact" : "紧凑");
    } else {
      // This is a layout/locale check, not acceptance of the separately failing
      // inherited Escape/keyboard-containment contract owned by PR #697.
      await page.setViewportSize({ width: 320, height: 844 });
      await expect(shell.locator(".mobilebar")).toBeVisible();
      await expect(shell.locator("header.topbar")).toBeHidden();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`navigation-${lang}-${testInfo.project.name}.png`) });
  });
}
