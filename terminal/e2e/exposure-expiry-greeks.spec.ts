import { test, expect } from "@playwright/test";

const GEX = {
  schema: "options_hub.gex/v1",
  asof: "2026-09-18T20:00:00Z",
  root: "SPY",
  spot_ref: 660,
  net_gex_bn: 1.25,
  gamma_flip: 655,
  call_wall: 675,
  put_wall: 645,
  convention: "synthetic-e2e-owner-native",
  coverage: { n_days: 1, since: "2026-09-18" },
  by_strike: [
    {
      strike: 650,
      gamma_net: 12,
      gamma_call: 20,
      gamma_put: -8,
      delta_net: 150,
      vanna_net: 1.2,
      charm_net: -0.3,
    },
    {
      strike: 660,
      gamma_net: -4,
      gamma_call: 6,
      gamma_put: -10,
      delta_net: -40,
      vanna_net: -0.6,
      charm_net: 0.2,
    },
  ],
  by_expiry: [
    {
      exp: "2026-09-19",
      gamma_net: 10,
      delta_net: 120,
      vanna_net: 2.4,
      charm_net: -0.6,
    },
    {
      exp: "2026-09-26",
      gamma_net: -5,
      delta_net: -30,
      vanna_net: -1.2,
      charm_net: 0.4,
    },
    {
      exp: "2026-10-17",
      gamma_net: 0,
      delta_net: 0,
      vanna_net: 0,
      charm_net: 0,
    },
  ],
};

test("Exposure desk carries expiry Vanna/Charm through bars and drawer", async ({ page }, testInfo) => {
  test.setTimeout(60_000);

  // Exercise the real GexDeskView transport entry point. EventSource requests and
  // the polling fallback receive the same deterministic enriched payload.
  await page.route("**/api/flow**", async (route) => {
    const url = new URL(route.request().url());
    const f = url.searchParams.get("f");
    if (f !== "gex:SPY") {
      await route.fallback();
      return;
    }

    if (url.pathname.endsWith("/stream")) {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        },
        body: `data: ${JSON.stringify(GEX)}\n\n`,
      });
      return;
    }

    await route.fulfill({ status: 200, json: GEX });
  });

  await page.goto("/options?tab=gex");
  await expect(page.locator("#wtab-gex")).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });

  await page.getByRole("button", { name: "Vanna exposure", exact: true }).click();
  await page.getByRole("button", { name: "By Expiration", exact: true }).click();

  // The existing expiry bar view must consume the enriched by_expiry fields rather
  // than fall back to the legacy "gamma & delta only" state.
  await expect(page.getByText("+2.4M", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("-1.2M", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Vanna & Charm aren't provided per-expiration yet — gamma & delta only.", { exact: true }),
  ).toHaveCount(0);

  // Open the existing term-structure drawer: it must consume the SAME selected
  // Greek and the SAME by_expiry payload, not a parallel derived fixture.
  const drawer = page.getByRole("button", { name: /Exposure by expiry/ });
  await expect(drawer).toBeVisible();
  await drawer.click();
  await expect(drawer).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("img", { name: "Exposure by expiry term structure" })).toBeVisible();
  await expect(page.getByText("+2.4M", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("-1.2M", { exact: true }).last()).toBeVisible();

  // Change only the lens. Both the bars and drawer must now show owner-native CHEX.
  await page.getByRole("button", { name: "Charm exposure", exact: true }).click();
  await expect(page.getByText("-600K", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("+400K", { exact: true }).first()).toBeVisible();

  // Exact zero is a third, neutral state — it must remain visually/data-distinct
  // from an unavailable field and from a directional +/- exposure.
  await expect(page.getByText("0", { exact: true }).first()).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-expiry-vanna-charm.png`),
    fullPage: false,
  });
});
