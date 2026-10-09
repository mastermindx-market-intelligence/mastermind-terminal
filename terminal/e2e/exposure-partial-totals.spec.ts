import { expect, test } from "@playwright/test";
import gexFixture from "../public/data/gex_fixture.json";

// T09 — expiry partial-total integrity on the mounted Exposure desk. Synthetic source data
// (not market observations), delivered through the desk's ordinary HTTP/SSE readers.
// Adapted from the consumed #768 spec onto this carrier's desk.
const session = "2026-09-25";
const later = "2026-09-28";
const gex = {
  ...gexFixture.SPY, asof: `${session}T20:15:00Z`, spot_ref: 770.5,
  by_strike: gexFixture.SPY.by_strike.slice(0, 2).map((row, i) => ({ ...row, strike: 770 + i })),
  // The later expiration has no delta value: it must stay in the population under DEX.
  by_expiry: [{ exp: session, gamma_net: 10, delta_net: 0 }, { exp: later, gamma_net: 15 }],
};

for (const complete of [false, true]) {
  test(`Exposure 0DTE ${complete ? "complete grid shows its total" : "unknown cell withholds the total"}`, async ({ page }, info) => {
    const zh = info.project.name === "tablet";
    if (zh) await page.addInitScript(() => localStorage.setItem("mm.lang", "zh"));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Built after UTC midnight: the 0DTE anchor must be the source session, not the build clock.
    const matrix = {
      schema: "options_structure.matrix/v1", root: "SPY", spot: 770.5,
      asof: "2026-09-26T00:05:00Z", _build_meta: { asof_date: session },
      strikes: [770, 771], expiries: [session, later], cells: [
        { strike: 770, expiry: session, gex: 8e6 },
        { strike: 771, expiry: session, gex: complete ? -3e6 : null },
        { strike: 770, expiry: later, gex: 1e6 },
        { strike: 771, expiry: later, gex: 0 },
      ],
    };
    await page.route("**/api/flow?*", async (route) => {
      const feed = new URL(route.request().url()).searchParams.get("f");
      if (feed === "matrix:SPY") await route.fulfill({ json: matrix });
      else if (feed === "gex:SPY") await route.fulfill({ json: gex });
      else await route.fallback();
    });
    await page.route("**/api/flow/stream?*", async (route) => {
      if (new URL(route.request().url()).searchParams.get("f") === "gex:SPY") {
        await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(gex)}\n\n` });
      } else await route.fallback();
    });
    await page.goto("/options?tab=prism");
    await page.getByRole("button", { name: zh ? "按行权价" : "By Strike", exact: true }).click();

    // (a) 0DTE: one unknown required cell withholds the whole selected total.
    const zero = page.getByRole("button", { name: zh ? "当日到期" : "0DTE", exact: true });
    await expect(zero).toHaveAttribute("aria-disabled", "false", { timeout: 20_000 });
    await zero.click();
    await expect(zero).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
    const summary = page.locator('[data-tut="gex-summary"]').locator(":scope > *").first();
    await expect(summary.locator(":scope > *").last()).toHaveText(complete ? "+5.0M" : "—", { timeout: 20_000 });
    const partial = page.getByTestId("gex-lens-partial");
    if (complete) await expect(partial).toHaveCount(0, { timeout: 20_000 });
    else {
      await expect(partial).toContainText("+8.0M", { timeout: 20_000 });
      await expect(partial).toContainText(session, { timeout: 20_000 });
    }

    // (d) DEX: the 0DTE split is gamma-only, so the lens is released, never relabelled.
    await page.getByRole("button", { name: zh ? "德尔塔敞口" : "Delta exposure", exact: true }).click();
    await expect(zero).toHaveAttribute("aria-disabled", "true", { timeout: 20_000 });
    await expect(zero).toHaveAttribute("aria-pressed", "false", { timeout: 20_000 });
    await expect(partial).toHaveCount(0, { timeout: 20_000 });

    // (c) The expiration drawer counts the same population under DEX as under GEX, and
    // discloses the expiration that has no delta value instead of dropping it.
    const count = page.locator(".obs-xdrawer-count");
    await expect(count).toContainText("2", { timeout: 20_000 });
    await page.locator(".obs-xdrawer-hd").click();
    await expect(page.getByTestId("xdrawer-unresolved")).toContainText("1", { timeout: 20_000 });
    await page.getByRole("button", { name: zh ? "伽马敞口" : "Gamma exposure", exact: true }).click();
    await expect(count).toContainText("2", { timeout: 20_000 });
    await expect(page.getByTestId("xdrawer-unresolved")).toHaveCount(0, { timeout: 20_000 });

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await summary.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`${info.project.name}-exposure-${complete ? "complete" : "partial"}.png`), fullPage: false,
    });
  });
}
