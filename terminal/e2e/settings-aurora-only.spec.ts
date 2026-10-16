import { test, expect } from "@playwright/test";

// Acceptance for a deliberately narrow change: the existing settings shell,
// controls, hierarchy, copy, and thirteen destinations must remain untouched.
const originalNavigation = [
  "Account", "Team", "Accuracy", "Billing", "Usage", "Preferences",
  "Alert delivery", "Terminal", "Sync", "Webhooks", "Developer access",
  "Sharing", "Portfolio targets",
];

test("the original account settings structure remains unchanged", async ({ page }, info) => {
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
    // Entry animation scales the rendered bounds until it completes.
    await expect(card).toHaveCSS("transform", "none");
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

test("the prismatic light follows the original rim and never floats above it", async ({ page }, info) => {
  await page.goto("/dev/settings?s=terminal");
  const card = page.locator(".acs-overlay.open .acs-card");
  await expect(card).toBeVisible();
  await expect(card.locator(".acs-aurora")).toBeHidden();
  const styles = await card.locator(".acs-card-surface").evaluate(el => {
    const rim = getComputedStyle(el, "::before");
    const light = getComputedStyle(el, "::after");
    return {
      top: rim.top, left: rim.left, height: parseFloat(rim.height),
      pointer: rim.pointerEvents, fieldPointer: light.pointerEvents,
      radius: rim.borderTopLeftRadius, content: rim.content,
      mask: rim.maskComposite, image: rim.backgroundImage,
      glowHeight: parseFloat(light.height), glowImage: light.backgroundImage,
    };
  });
  expect(styles.content).toBe('""');
  expect(styles.top).toBe("0px");
  expect(styles.left).toBe("0px");
  expect(styles.height).toBeLessThanOrEqual(34);
  expect(styles.glowHeight).toBeLessThanOrEqual(26);
  expect(styles.pointer).toBe("none");
  expect(styles.fieldPointer).toBe("none");
  expect(styles.radius).toBe(info.project.name === "mobile" ? "0px" : "22px");
  expect(styles.mask).toContain("exclude");
  expect(styles.image).toContain("linear-gradient");
  expect(styles.glowImage).toContain("radial-gradient");
});

test("light drifts across fixed geometry rather than waving or flashing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/dev/settings?s=terminal");
  const card = page.locator(".acs-card-surface");
  await expect(card).toBeVisible();
  const evidence = await card.evaluate(el => {
    // Pseudo-element animations are exposed by the subtree query.
    const animations = el.getAnimations({ subtree: true }).filter(a =>
      a instanceof CSSAnimation && a.animationName.startsWith("acsRefraction"));
    const sample = (time: number) => {
      animations.forEach(a => { a.pause(); a.currentTime = time; });
      const rim = getComputedStyle(el, "::before");
      return { position: rim.backgroundPosition, transform: rim.transform,
        opacity: rim.opacity, height: rim.height, duration: rim.animationDuration };
    };
    return { count: animations.length, a: sample(1000), b: sample(8000) };
  });
  expect(evidence.count).toBe(2);
  expect(evidence.a.position).not.toBe(evidence.b.position);
  expect(evidence.a.transform).toBe(evidence.b.transform);
  expect(evidence.a.height).toBe(evidence.b.height);
  expect(evidence.a.opacity).toBe(evidence.b.opacity);
  expect(parseFloat(evidence.a.duration)).toBeGreaterThanOrEqual(12);
});

test("reduced motion keeps the same material without animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dev/settings?s=terminal");
  const card = page.locator(".acs-card-surface");
  await expect(card).toBeVisible();
  const styles = await card.evaluate(el => ["::before", "::after"].map(pseudo => {
    const s = getComputedStyle(el, pseudo);
    return { name: s.animationName, content: s.content, image: s.backgroundImage };
  }));
  for (const s of styles) {
    expect(s.name).toBe("none");
    expect(s.content).toBe('""');
    expect(s.image).not.toBe("none");
  }
});

test("the original close button stays clickable beneath decorative light", async ({ page }, info) => {
  await page.goto("/dev/settings?s=terminal");
  const card = page.locator(".acs-card");
  await expect(card).toBeVisible();
  await card.locator(info.project.name === "mobile" ? ".acs-x-m" : ".acs-head .acs-x").click();
  await expect(card).toBeHidden();
  const paused = await card.locator(".acs-card-surface").evaluate(el =>
    ["::before", "::after"].map(pseudo => getComputedStyle(el, pseudo).animationPlayState));
  expect(paused).toEqual(["paused", "paused"]);
});
