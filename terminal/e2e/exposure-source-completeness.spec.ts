import { expect, test } from "@playwright/test";
import gexFixture from "../public/data/gex_fixture.json";

// Explicit synthetic source data, delivered through the desk's ordinary HTTP/SSE readers.
const session = "2026-09-25";
const gex = { ...gexFixture.SPY, asof: session, spot_ref: 770.5,
  by_strike: gexFixture.SPY.by_strike.slice(0, 2).map((row, i) => ({ ...row, strike: 770 + i })),
  by_expiry: [{ ...gexFixture.SPY.by_expiry[0], exp: session }] };

for (const lang of ["en", "zh"] as const) {
  for (const complete of [false, true]) {
    test(`[${lang}] Exposure ${complete ? "complete grid" : "known subtotal"} uses its source session`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(locale => localStorage.setItem("mm.lang", locale), lang);
      const matrix = { schema: "options_structure.matrix/v1", root: "SPY", spot: 770.5,
        asof: "2026-09-26T00:05:00Z", _build_meta: { asof_date: session },
        strikes: [770, 771], expiries: [session], cells: [
          { strike: 770, expiry: session, gex: 8e6 },
          { strike: 771, expiry: session, gex: complete ? -3e6 : null },
        ] };
      await page.route("**/api/flow?*", async route => {
        const feed = new URL(route.request().url()).searchParams.get("f");
        if (feed === "matrix:SPY") await route.fulfill({ json: matrix });
        else if (feed === "gex:SPY") await route.fulfill({ json: gex });
        else await route.fallback();
      });
      await page.route("**/api/flow/stream?*", async route => {
        if (new URL(route.request().url()).searchParams.get("f") === "gex:SPY") {
          await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(gex)}\n\n` });
        } else await route.fallback();
      });
      await page.goto("/options?tab=prism");
      await page.getByRole("button", { name: lang === "zh" ? "按行权价" : "By Strike", exact: true }).click();
      const zero = page.getByRole("button", { name: lang === "zh" ? "当日到期" : "0DTE", exact: true });
      await expect(zero).toHaveAttribute("aria-disabled", "false");
      await zero.click();
      await expect(zero).toHaveAttribute("aria-pressed", "true");
      const summary = page.locator('[data-tut="gex-summary"]').locator(":scope > *").first();
      await expect(summary).toContainText(lang === "zh" ? "源报告 GEX" : "Reported GEX");
      await expect(summary).toContainText(complete ? "+5.0M" : "—");
      const source = page.getByTestId("gex-lens-source");
      await expect(source).toContainText(session);
      await expect(source).toContainText(lang === "zh" ? "源数据完整性未知" : "Source completeness is unknown");
      if (complete) await expect(page.getByTestId("gex-lens-partial")).toHaveCount(0);
      else await expect(page.getByTestId("gex-lens-partial")).toContainText(lang === "zh" ? "已知小计 +8.0M" : "Known subtotal +8.0M");
      await expect(page.getByText(lang === "zh" ? /9月25日.*源交易日/ : "Fri, Sep 25 · source session", { exact: false })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
      await source.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`exposure-${lang}-${complete ? "complete" : "partial"}.png`), fullPage: false });
    });
  }
}
