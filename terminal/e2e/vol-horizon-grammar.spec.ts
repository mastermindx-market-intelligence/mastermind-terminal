import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import volFixture from "./fixtures/options-r1-w3b-vol.json";

// The real Options mount, with synthetic source rows. Copy follows computed
// weekdays; this does not change the producer dte or attach confidence to IV·√T.
const capture = process.env.VOL_HORIZON_GRAMMAR_CROPS === "1";
const theme = process.env.MMX_SHARED_SHELL === "1" ? "light" : "dark";
const out = path.resolve(__dirname, "../docs/verification/vol-horizon-grammar-20261104/browser");

for (const days of [1, 2]) {
  for (const lang of ["en", "zh"] as const) {
    test(`expected-move horizon grammar / ${lang} / ${days} weekdays`, async ({ page }) => {
      await page.addInitScript(({ lang, theme }) => {
        localStorage.setItem("mm.lang", lang);
        if (theme === "light") localStorage.setItem("mmx.shell.theme", "light");
      }, { lang, theme });
      await page.clock.setFixedTime(new Date(days === 1 ? "2026-10-30T15:00:00Z" : "2026-10-29T15:00:00Z"));
      await page.route("**/api/flow?*", async (route) => {
        const f = new URL(route.request().url()).searchParams.get("f");
        if (f === "vol:AAPL") await route.fulfill({ json: {
          ...volFixture, asof: "2026-10-23",
          term: [{ dte: 10, exp: "2026-11-02", atm_iv: 33 }], smile: [],
        } });
        else if (f === "moves:AAPL" || f === "agg:AAPL") await route.fulfill({ json: {} });
        else if (f === "vol:SPY") await route.fulfill({ status: 404, json: {} });
        else await route.fallback();
      });
      await page.route("**/data/AAPL.fund.json", route => route.fulfill({ json: {} }));
      await page.goto("/options?tab=volatility");
      const ticker = page.getByRole("combobox", { name: lang === "en" ? "Ticker" : "代码", exact: true });
      await ticker.fill("AAPL");
      await ticker.press("Enter");
      const move = page.getByTestId("vol-compare-move");
      await expect(move).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const expected = lang === "en"
        ? `${days} trading ${days === 1 ? "day" : "days"} · ${days === 1 ? "30" : "29"} Oct → 2 Nov close weekdays, exchange holidays not subtracted`
        : `${days} 个交易日 · 10月${days === 1 ? "30" : "29"}日 → 11月2日 收盘 按工作日计算，未扣除交易所假期`;
      const horizon = move.locator("dl > dd").nth(1);
      await expect(horizon).toHaveText(expected);
      await expect(move).toContainText(days === 1 ? "±2.1 %" : "±2.9 %");
      await expect(move).toContainText(lang === "en" ? "23 Oct nightly EOD" : "10月23日 每晚收盘");
      await expect(move).toContainText(lang === "en" ? "no confidence level is attached" : "不附带任何置信水平");
      const viewports = capture
        ? [{ width: 1440, height: 900 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]
        : [page.viewportSize()!];
      if (capture) mkdirSync(out, { recursive: true });
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await expect.poll(() => move.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await expect(horizon).toHaveText(expected);
        if (capture) await move.screenshot({ path: path.join(out, `${theme}-${lang}-${days}day-${viewport.width}.png`) });
      }
    });
  }
}
