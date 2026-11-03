import { expect, test } from "@playwright/test";
import dated from "../lib/__tests__/fixtures/exposure-projection.json";

// Synthetic books exercise the mounted route and native select, not market acceptance.
for (const lang of ["en", "zh"] as const) {
  test(`Exposure retains a missing expiry until explicit recovery (${lang})`, async ({ page }, info) => {
    await page.clock.install();
    await page.addInitScript(locale => {
      localStorage.setItem("mm.lang", locale);
      Reflect.deleteProperty(window, "EventSource");
    }, lang);
    await page.route(url => url.pathname === "/api/flow/stream", route => route.abort("failed"));
    let phase: "original" | "failed" | "replacement" = "original";
    await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "gex:SPY", route => {
      if (phase === "failed") return route.fulfill({ status: 503, json: { error: "fixture refresh failure" } });
      const projection = phase === "original" ? dated : {
        ...dated, cells: dated.cells.map(cell => ({ ...cell, expiry: "2026-10-30" })),
      };
      return route.fulfill({ json: {
        schema: "options_hub.gex/v1", root: "SPY", asof: "2026-10-15", spot_ref: 100,
        by_strike: [], by_expiry: [], exposure_projection: projection,
      } });
    });
    await page.goto("/options?tab=prism&symbol=SPY&view=chart");
    const map = page.getByTestId("exposure-map");
    const scope = map.getByLabel(lang === "en" ? "Expiration scope" : "到期范围", { exact: true });
    await expect(map).toHaveAttribute("data-chart-ready", "true", { timeout: 30_000 });
    await scope.selectOption("2026-10-23");
    await expect(scope).toHaveValue("2026-10-23");
    phase = "failed";
    await page.clock.fastForward(30_001);
    const retry = map.getByRole("button", { name: lang === "en" ? "Retry source read" : "重试读取来源", exact: true });
    await expect(retry).toBeVisible();
    phase = "replacement";
    await retry.click();
    await expect(scope).toHaveValue("2026-10-23");
    await expect(scope.locator("option:checked")).toHaveText(`2026-10-23 · ${lang === "en" ? "Not listed in this book" : "此快照未列出"}`);
    await expect(map.locator("tbody tr[aria-selected]")).toHaveCount(0);
    const recover = map.getByRole("button", { name: lang === "en" ? "Show all expiries" : "显示所有到期日", exact: true });
    await expect(recover).toBeVisible();
    for (const theme of ["dark", "light"]) {
      await page.evaluate(value => document.documentElement.setAttribute("data-theme", value), theme);
      await scope.scrollIntoViewIfNeeded();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: info.outputPath(`missing-expiry-${lang}-${theme}.png`) });
    }
    await recover.click();
    await expect(scope).toHaveValue("all");
    await expect(map.locator("tbody tr[aria-selected]")).not.toHaveCount(0);
    await expect(recover).toHaveCount(0);
  });
}
