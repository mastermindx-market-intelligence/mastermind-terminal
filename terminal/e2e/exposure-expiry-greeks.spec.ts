import { test, expect } from "@playwright/test";
import { makeGexT } from "../components/gexdesk/gexStrings";

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
    {
      exp: "2026-10-24",
      gamma_net: 4,
      delta_net: 2,
      vanna_net: null,
      charm_net: 0.2,
      exposure_support: {
        basis: "admitted_input_contracts",
        vanna: { known_contracts: 1, admitted_contracts: 2, known_net: -0.25 },
        charm: { known_contracts: 2, admitted_contracts: 2, known_net: 0.2 },
      },
    },
    { exp: "2026-10-31", gamma_net: 1, delta_net: 4, vanna_net: null, charm_net: 0.3 },
  ],
};

for (const lang of ["en", "zh"] as const) {
test(`Exposure desk carries expiry Vanna/Charm through bars and drawer in ${lang}`, async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const t = makeGexT(lang);
  await page.addInitScript(value => localStorage.setItem("mm.lang", value), lang);

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

  await page.getByRole("button", { name: t("greekVannaFull"), exact: true }).click();
  if (testInfo.project.name === "mobile") {
    const disclosure = page.locator("details").filter({
      has: page.getByRole("group", { name: t("viewAria"), exact: true, includeHidden: true }),
    });
    await disclosure.locator(":scope > summary").click();
  }
  await page.getByRole("button", { name: t("viewByExpiry"), exact: true }).click();

  // The existing expiry bar view must consume the enriched by_expiry fields rather
  // than fall back to the legacy "gamma & delta only" state.
  await expect(page.getByText("+2.4M", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("-1.2M", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText(t("expiryLensNA"), { exact: true }),
  ).toHaveCount(0);

  const expiryRegion = page.locator(".obs-gexdesk-ladder-region");
  await expect(expiryRegion.locator("[data-expiry]")).toHaveCount(5);
  const missing = expiryRegion.locator('[data-expiry="2026-10-31"]');
  await expect(missing.locator(".num")).toHaveText("—");
  expect(await missing.evaluate(row => row.children[1].childElementCount)).toBe(0);
  const zero = expiryRegion.locator('[data-expiry="2026-10-17"]');
  await expect(zero.locator(".num")).toHaveText("0");
  expect(await zero.evaluate(row => row.children[1].childElementCount)).toBe(0);
  const partial = expiryRegion.locator('[data-expiry="2026-10-24"]');
  await expect(partial).toHaveAttribute("data-partial", "true");
  await expect(partial).toContainText(t("expiryKnownSubtotal"));
  await expect(partial).toContainText("-250K");
  await expect(expiryRegion.getByTestId("expiry-support")).toContainText("4/5");

  // Follow the actual scroll container and require the values to reach the viewport.
  // DOM visibility alone can pass for clipped/off-screen rows.
  for (const exp of GEX.by_expiry.map(row => row.exp)) {
    const value = expiryRegion.locator(`[data-expiry="${exp}"] .num`);
    await value.scrollIntoViewIfNeeded();
    await expect(value).toBeInViewport();
  }
  await expiryRegion.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-${lang}-expiry-vanna-bars.png`),
    fullPage: false,
  });

  // Open the existing term-structure drawer: it must consume the SAME selected
  // Greek and the SAME by_expiry payload, not a parallel derived fixture.
  const drawer = page.locator(".obs-xdrawer-hd");
  await expect(drawer).toBeVisible();
  await drawer.click();
  await expect(drawer).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("img", { name: t("exposureByExpiry") })).toBeVisible();
  await expect(page.getByText("+2.4M", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("-1.2M", { exact: true }).last()).toBeVisible();

  const headerCount = await page.locator(".obs-xdrawer-count").textContent();
  expect(headerCount).toContain("5");
  await expect(page.getByTestId("xdrawer-unresolved")).toContainText("1");
  const plot = page.locator(".obs-xdrawer-plot");
  for (const exp of ["2026-09-19", "2026-09-26", "2026-10-17", "2026-10-24"]) {
    const value = plot.locator(`[data-expiry="${exp}"] text`).first();
    await value.scrollIntoViewIfNeeded();
    await expect(value).toBeInViewport();
  }
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-${lang}-expiry-vanna-drawer.png`),
    fullPage: false,
  });

  // Change only the lens. Both the bars and drawer must now show owner-native CHEX.
  await page.getByRole("button", { name: t("greekCharmFull"), exact: true }).click();
  await expect(page.getByText("-600K", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("+400K", { exact: true }).first()).toBeVisible();

  await expect(page.locator(".obs-xdrawer-count")).toHaveText(headerCount!);
  await expect(expiryRegion.locator("[data-expiry]")).toHaveCount(5);
  await expect(expiryRegion.locator('[data-expiry="2026-10-31"] .num')).toHaveText("+300K");
  await expect(page.getByTestId("xdrawer-unresolved")).toHaveCount(0);
  await expect(expiryRegion.getByTestId("expiry-support")).toHaveCount(0);

  // Exact zero is a third, neutral state — it must remain visually/data-distinct
  // from an unavailable field and from a directional +/- exposure.
  await expect(page.getByText("0", { exact: true }).first()).toBeVisible();

  for (const exp of GEX.by_expiry.map(row => row.exp)) {
    const value = plot.locator(`[data-expiry="${exp}"] text`).first();
    await value.scrollIntoViewIfNeeded();
    await expect(value).toBeInViewport();
  }
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-${lang}-expiry-charm-drawer.png`),
    fullPage: false,
  });
  await drawer.click();
  await expect(drawer).toHaveAttribute("aria-expanded", "false");
  for (const exp of GEX.by_expiry.map(row => row.exp)) {
    const value = expiryRegion.locator(`[data-expiry="${exp}"] .num`);
    await value.scrollIntoViewIfNeeded();
    await expect(value).toBeInViewport();
  }
  await expiryRegion.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-${lang}-expiry-charm-bars.png`),
    fullPage: false,
  });
});
}
