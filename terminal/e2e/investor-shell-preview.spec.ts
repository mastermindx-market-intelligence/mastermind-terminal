import { expect, test } from "@playwright/test";

// The inherited harness disables reuseExistingServer when CI is set.
// Refuse preview proof from a server another worktree could already own.
if (process.env.MMX_INVESTOR_SHELL_PREVIEW === "1" && !process.env.CI) {
  throw new Error("Run shell qualification with CI=1 and --retries=0 so the harness starts a fresh server.");
}

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
      await expect(nav.locator("a")).toHaveCount(9);
      await expect(nav.locator(".investor-nav-label")).toHaveCount(10);
      const rail = await nav.boundingBox();
      expect(Math.round(rail!.width)).toBe(224);
      const toggle = shell.locator("[data-investor-compact-toggle]");
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect(nav.locator(".investor-nav-label")).toHaveCount(0);
      await expect(nav.locator("a[aria-label]")).toHaveCount(9);
      expect(Math.round((await nav.boundingBox())!.width)).toBe(72);
      await page.screenshot({ path: testInfo.outputPath(`${route.startsWith("/analysis") ? "analysis" : "discover"}-compact.png`) });
      await page.keyboard.press("Enter");
      await expect(toggle).toHaveAttribute("aria-pressed", "false");
      await expect(nav.locator(".investor-nav-label")).toHaveCount(10);
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

test("direct native entry hands off to the existing Macro overview without inventing route state", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop bridge; the existing MobileNav owner stays unchanged");
  const target = "https://www.mastermind-x.com/macro.html";
  // A static local response tests the document handoff without touching the public site
  // or introducing an authenticated Macro/Terminal fixture identity.
  await page.route(target, route => route.fulfill({
    status: 200, contentType: "text/html",
    body: "<!doctype html><html><head><title>Retained Macro route fixture</title></head><body><main id='macro-return-target'>Retained Macro route fixture</main></body></html>",
  }));
  await page.goto("/analysis?symbol=NVDA");
  const nav = page.locator("#investor-primary-navigation");
  const bridge = nav.locator("[data-investor-overview-bridge]");
  await expect(bridge).toHaveAttribute("href", target);
  await expect(bridge).toHaveAttribute("aria-label", "Dashboard");
  await expect(nav.locator("a").first()).toHaveAttribute("data-investor-overview-bridge", "");
  await bridge.click();
  await expect(page).toHaveURL(target);
  await expect(page.locator("#macro-return-target")).toHaveText("Retained Macro route fixture");
});

test("a short desktop viewport keeps every investor navigation destination keyboard-reachable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop short-height scroll contract");
  await page.setViewportSize({ width: 1024, height: 520 });
  await page.goto("/analysis?symbol=NVDA");
  const nav = page.locator("#investor-primary-navigation");
  await expect(nav).toBeVisible();
  const geometry = await nav.evaluate(element => ({
    client: element.clientHeight,
    scroll: element.scrollHeight,
    overflow: getComputedStyle(element).overflowY,
  }));
  expect(geometry.scroll).toBeGreaterThan(geometry.client);
  expect(geometry.overflow).toBe("auto");
  const lastAction = nav.locator("button.navbtn").last();
  await lastAction.focus();
  await expect(lastAction).toBeInViewport();
  await expect(lastAction).toBeFocused();
});

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
