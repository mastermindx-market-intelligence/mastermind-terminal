import { expect, test, type Route } from "@playwright/test";
import { openIndicatorLibrary } from "./phoneChrome";

/**
 * Real browser regression for the 2–3s false Upgrade flash seen by paid admins.
 *
 * The browser's canonical /api/me request is deliberately held unresolved.
 * Merely being signed in never grants paid access while the gateway is pending:
 * the actual upgrade link must also remain absent until a verified Free denial.
 */
test("premium indicator controls remain neutral until account access is verified", async ({ page }) => {
  test.slow();

  let announceRequest!: () => void;
  let releaseGateway!: () => void;
  const requestStarted = new Promise<void>((resolve) => { announceRequest = resolve; });
  const heldGateway = new Promise<void>((resolve) => { releaseGateway = resolve; });
  let released = false;
  const release = () => { if (!released) { released = true; releaseGateway(); } };

  await page.route("**/api/me", async (route: Route) => {
    announceRequest();
    await heldGateway;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tier: "pro", status: "active", features: ["terminal_live_options"] }),
    }).catch(() => { /* page may be closing after an assertion failure */ });
  });

  try {
    await page.goto("/terminal?symbol=NVDA", { waitUntil: "domcontentloaded" });
    // Prove this is a genuine network-pending case, not a guest fixture with
    // no entitlement request and a non-rendering placeholder.
    await requestStarted;

    await expect(page.locator(".workspace")).toBeVisible();
    await openIndicatorLibrary(page);
    const library = page.locator(".imodal-library");
    await expect(library).toBeVisible({ timeout: 15_000 });
    await library.getByRole("button", { name: "Systems & Presets" }).click();

    const profile = library.locator(".ipreset-row")
      .filter({ hasText: "Structure Core" })
      .locator("article")
      .filter({ hasText: "Complete Structure Research" });
    await expect(profile).toBeVisible();
    const control = profile.locator(".ipreset-add");

    // The fail-closed feature gate is intact, but the user is not wrongly
    // invited to buy another subscription during an unresolved account read.
    await expect(control).toBeDisabled();
    await expect(control).toContainText("Checking access");
    await expect(profile.locator('a[href]')).toHaveCount(0);
    await page.waitForTimeout(750);
    await expect(control).toContainText("Checking access");
    await expect(profile.locator('a[href]')).toHaveCount(0);

    release();
    await expect(profile.getByRole("button", { name: "Add: Complete Structure Research" }))
      .toBeVisible({ timeout: 12_000 });
    await expect(profile.locator('a[href]')).toHaveCount(0);
  } finally {
    release();
  }
});
