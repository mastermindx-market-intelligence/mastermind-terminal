import { test, expect } from "@playwright/test";

// Acceptance for a deliberately narrow change: the existing settings shell,
// controls, hierarchy, copy, and thirteen destinations must remain untouched.
const originalNavigation = [
  "Account", "Team", "Accuracy", "Billing", "Usage", "Preferences",
  "Alert delivery", "Terminal", "Sync", "Webhooks", "Developer access",
  "Sharing", "Portfolio targets",
];

test("the original account settings structure and animated edge are preserved", async ({ page }, info) => {
  await page.goto("/dev/settings?s=terminal&lang=en");
  const card = page.locator(".acs-overlay.open .acs-card");
  await expect(card).toBeVisible();
  await expect(card.locator(".acs-nav-b")).toHaveCount(originalNavigation.length);
  expect(await card.locator(".acs-nav-b").allTextContents()).toEqual(originalNavigation);
  await expect(card.locator(".acs-me-sub")).toHaveText("Synced across devices");
  await expect(card.locator(".acs-nav-b.active")).toHaveText("Terminal");
  await expect(card.locator(".acs-aurora")).toHaveCount(1);
  await expect(card.locator(".acs-aurora .acs-aurora-live > path")).toHaveCount(4);
  await expect(card.locator(".acs-aurora animate[attributeName='d']")).toHaveCount(4);
  await expect(card.locator(".acs-aurora-static")).toHaveCount(1);
  await expect(card.locator(".acs-check")).toHaveCount(6);
  await expect(card.locator(".acs-tfg button")).toHaveCount(18);
  await expect(card.locator(".acs-seg-b")).toHaveCount(2);
  const mobile = info.project.name === "mobile";
  if (!mobile && info.project.name === "desktop") {
    const bounds = await card.boundingBox();
    expect(Math.round(bounds?.width ?? 0)).toBe(1140);
    expect(Math.round(bounds?.height ?? 0)).toBe(772);
  }
  if (mobile) {
    const tabScroll = await card.locator(".acs-nav").evaluate(el => ({
      overflow: getComputedStyle(el).overflowX,
      scroll: el.scrollWidth, client: el.clientWidth,
    }));
    expect(tabScroll.overflow).toBe("auto");
    expect(tabScroll.scroll).toBeGreaterThan(tabScroll.client);
  }
  if (process.env.TERMINAL_AURORA_CAPTURE === "1") {
    const { mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "docs/pr-crops/terminal-settings-aurora");
    await mkdir(dir, { recursive: true });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(850); // Allow the actual SMIL edge to settle into its ordinary phase.
    await page.screenshot({ path: join(dir, `${info.project.name}-original-settings.png`) });
  }
});

test("the moving top edge blends into Terminal instead of floating above the modal", async ({ page }, info) => {
  await page.goto("/dev/settings?s=terminal");
  const card = page.locator(".acs-overlay.open .acs-card");
  await expect(card).toBeVisible();
  const style = await card.locator(".acs-aurora").evaluate(el => {
    const css = getComputedStyle(el);
    const bloom = getComputedStyle(el.querySelector(".acs-aurora-bloom")!);
    const core = getComputedStyle(el.querySelector(".acs-aurora-core")!);
    const stop = getComputedStyle(el.querySelector("linearGradient stop")!);
    return {
      height: el.getBoundingClientRect().height,
      top: css.top, filter: css.filter, lineOpacity: parseFloat(bloom.opacity),
      bloomWidth: parseFloat(bloom.strokeWidth), coreWidth: parseFloat(core.strokeWidth),
      stopColor: stop.stopColor,
    };
  });
  expect(style.height).toBeLessThanOrEqual(info.project.name === "mobile" ? 28 : 28);
  expect(parseFloat(style.top)).toBeGreaterThanOrEqual(-15);
  expect(style.filter).toBe("none");
  expect(style.lineOpacity).toBeLessThanOrEqual(0.13);
  expect(style.bloomWidth).toBeLessThanOrEqual(8);
  expect(style.coreWidth).toBeLessThanOrEqual(1.8);
  expect(style.stopColor).not.toBe("rgb(34, 211, 255)");
});

test("reduced-motion users see the same edge without motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dev/settings?s=terminal");
  const card = page.locator(".acs-overlay.open .acs-card");
  await expect(card).toBeVisible();
  const css = await card.locator(".acs-aurora").evaluate(el => ({
    animation: getComputedStyle(el).animationName,
    movingDisplay: getComputedStyle(el.querySelector(".acs-aurora-live")!).display,
    staticDisplay: getComputedStyle(el.querySelector(".acs-aurora-static")!).display,
  }));
  expect(css.animation).toBe("none");
  expect(css.movingDisplay).toBe("none");
  expect(css.staticDisplay).toBe("block");
});
