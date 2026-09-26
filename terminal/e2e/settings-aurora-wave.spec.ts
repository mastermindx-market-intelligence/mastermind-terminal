import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
  });
});

test("settings aurora is full-width, unclipped, and morphs its wave geometry", async ({ page }) => {
  await page.goto("/dev/settings?s=terminal&lang=en");
  const card = page.locator(".acs-overlay.open .acs-card");
  const aurora = page.getByTestId("settings-aurora");
  const core = page.locator(".acs-aurora-core");
  await expect(card).toBeVisible({ timeout: 45_000 });

  if (page.viewportSize()!.width <= 640) {
    await expect(aurora).toBeHidden();
    return;
  }

  await expect(aurora).toBeVisible();

  const geometry = await page.evaluate(() => {
    const cardEl = document.querySelector<HTMLElement>(".acs-card")!;
    const auroraEl = document.querySelector<HTMLElement>(".acs-aurora")!;
    const coreEl = document.querySelector<SVGPathElement>(".acs-aurora-core")!;
    const cardBox = cardEl.getBoundingClientRect();
    const auroraBox = auroraEl.getBoundingClientRect();
    const coreBox = coreEl.getBoundingClientRect();
    return {
      card: { left: cardBox.left, right: cardBox.right, top: cardBox.top, width: cardBox.width },
      aurora: { left: auroraBox.left, right: auroraBox.right, width: auroraBox.width },
      core: { top: coreBox.top, bottom: coreBox.bottom },
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(geometry.aurora.width).toBeGreaterThanOrEqual(geometry.card.width);
  expect(geometry.aurora.left).toBeLessThanOrEqual(geometry.card.left);
  expect(geometry.aurora.right).toBeGreaterThanOrEqual(geometry.card.right);
  // The luminous ribbon must straddle the physical modal edge: visible above
  // the card and spilling slightly inside it, never clipped behind the card.
  expect(geometry.core.top).toBeLessThan(geometry.card.top);
  expect(geometry.core.bottom).toBeGreaterThan(geometry.card.top);
  expect(geometry.pageOverflow).toBe(0);

  const sample = () => core.evaluate((path) => ({
    d: path.getAttribute("d"),
    height: path.getBBox().height,
    transform: getComputedStyle(path).transform,
  }));

  const first = await sample();
  await page.waitForTimeout(700);
  const second = await sample();
  await page.waitForTimeout(900);
  const third = await sample();

  expect(second.d).not.toBe(first.d);
  expect(third.d).not.toBe(second.d);
  // A translated frozen mask has constant path geometry. Changing SVG bbox
  // height proves the actual crest/trough shape is morphing over time.
  expect(Math.abs(third.height - first.height)).toBeGreaterThan(0.15);
  expect(first.transform).toBe("none");
  expect(second.transform).toBe("none");
});

test("settings aurora freezes honestly for reduced-motion users", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dev/settings?s=terminal&lang=en");
  const core = page.locator(".acs-aurora-core");
  await expect(page.locator(".acs-overlay.open .acs-card")).toBeVisible({ timeout: 45_000 });

  if (page.viewportSize()!.width <= 640) {
    await expect(page.getByTestId("settings-aurora")).toBeHidden();
    return;
  }

  const first = await core.getAttribute("d");
  await page.waitForTimeout(700);
  const second = await core.getAttribute("d");
  expect(second).toBe(first);

  await expect(page.locator(".acs-aurora-shimmer")).toHaveCSS("animation-name", "none");
});
