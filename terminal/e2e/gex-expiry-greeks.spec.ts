import { expect, test } from "@playwright/test";

const GEX = {
  "schema": "options_hub.gex/v1",
  "asof": "2026-09-18T20:00:00Z",
  "root": "SPY",
  "spot_ref": 600,
  "net_gex_bn": 1.25,
  "gamma_flip": 598,
  "call_wall": 605,
  "put_wall": 595,
  "by_strike": [
    {
      "strike": 595,
      "gamma_net": -2,
      "gamma_call": 0,
      "gamma_put": -2,
      "delta_net": -4,
      "vanna_net": -0.8,
      "charm_net": 0.2
    },
    {
      "strike": 605,
      "gamma_net": 3,
      "gamma_call": 3,
      "gamma_put": 0,
      "delta_net": 5,
      "vanna_net": 1.1,
      "charm_net": -0.3
    }
  ],
  "by_expiry": [
    {
      "exp": "2026-09-25",
      "gamma_net": 8,
      "delta_net": 11,
      "vanna_net": 2.4,
      "charm_net": -0.6
    },
    {
      "exp": "2026-10-16",
      "gamma_net": -5,
      "delta_net": -7,
      "vanna_net": -1.2,
      "charm_net": 0.4
    }
  ]
};

test("Exposure desk renders expiry Vanna and Charm from the owner-native payload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one desktop journey proves the existing consumer path");

  await page.route(/\/api\/flow\/stream\?f=gex%3ASPY$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify(GEX)}\n\n`,
    });
  });
  await page.route(/\/api\/flow\?f=gex%3ASPY$/, async (route) => {
    await route.fulfill({ json: GEX });
  });

  await page.goto("/options?tab=gex");

  const greekLens = page.getByRole("group", { name: "Greek exposure" });
  const axis = page.getByRole("group", { name: "Exposure axis" });
  await expect(greekLens).toBeVisible({ timeout: 15_000 });
  await expect(axis).toBeVisible();

  await greekLens.getByRole("button", { name: "Vanna exposure" }).click();
  await axis.getByRole("button", { name: "By Expiration" }).click();

  const expiryRegion = page.locator(".obs-gexdesk-ladder-region");
  await expect(expiryRegion).toContainText("+2.4M");
  await expect(expiryRegion).toContainText("-1.2M");
  await expect(expiryRegion).not.toContainText("aren't provided per-expiration yet");

  const drawerButton = page.getByRole("button", { name: /Exposure by expiry/i });
  await drawerButton.scrollIntoViewIfNeeded();
  await drawerButton.click();

  const drawer = page.locator(".obs-xdrawer-body");
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('svg[aria-label="Exposure by expiry term structure"]')).toBeVisible();
  await expect(drawer).toContainText("+2.4M");
  await expect(drawer).toContainText("-1.2M");

  await greekLens.getByRole("button", { name: "Charm exposure" }).click();
  await expect(expiryRegion).toContainText("-600K");
  await expect(expiryRegion).toContainText("+400K");
  await expect(drawer).toContainText("-600K");
  await expect(drawer).toContainText("+400K");
  await expect(drawer).not.toContainText("aren't provided per-expiration yet");

  await page.screenshot({
    path: testInfo.outputPath("gex-expiry-vanna-charm.png"),
    fullPage: false,
  });
});
