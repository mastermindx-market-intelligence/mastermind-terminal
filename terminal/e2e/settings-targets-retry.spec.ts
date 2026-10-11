import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { isolateWatchlistStore } from "./watchlistStore";

// Existing local fixture identity only. No production sign-in or write is used.
for (const lang of ["en", "zh"] as const) {
  test(`Settings targets recover with one explicit GET-only retry (${lang})`, async ({ page, baseURL }, info) => {
    await isolateWatchlistStore(page, info, baseURL);
    await page.addInitScript((locale) => localStorage.setItem("mm.lang", locale), lang);
    await page.route("**/data/manifest.json", (route) => route.fulfill({ json: {
      symbols: { NVDA: { name: "NVIDIA", zh: "英伟达", last: 175, chg: 1.2 } },
    } }));
    await page.route("**/api/quote**", (route) => route.fulfill({ json: { quotes: {} } }));
    const methods: string[] = [];
    let available = false;
    await page.route(/\/api\/portfolio\/targets(\?|$)/, async (route) => {
      methods.push(route.request().method());
      expect(route.request().method()).toBe("GET");
      if (!available) {
        await route.fulfill({ status: 503, json: { error: "fixture unavailable" } });
      } else {
        await route.fulfill({ json: { summary: {
          schema: "portfolio_targets.v1", weightBasis: "cost", targetsSumPct: 0,
          targetsSumOffBy100: 0, drifts: [], untargeted: [], orphaned: [],
        } } });
      }
    });
    await page.goto("/terminal?symbol=NVDA");
    const settingsName = lang === "en" ? "Settings" : "设置";
    await page.locator(`button[aria-label="${settingsName}"]:visible`).first().click();
    await page.getByRole("tab", {
      name: lang === "en" ? "Portfolio targets" : "组合目标权重", exact: true,
    }).click();
    const unavailable = page.getByTestId("portfolio-targets-unreadable");
    await expect(unavailable).toBeVisible();
    await expect(page.getByTestId("portfolio-targets-empty")).toHaveCount(0);
    const retry = unavailable.getByRole("button", { name: lang === "en" ? "Try again" : "重试", exact: true });
    await expect(retry).toBeVisible();
    // Development StrictMode can abandon one initial mount GET. Keep all
    // initial reads failed until the service actually recovers, then measure
    // the explicit Retry against that settled request count.
    expect(methods.length).toBeGreaterThan(0);
    expect(methods.every((method) => method === "GET")).toBe(true);
    const initialMethods = [...methods];
    const capture = async (state: string) => {
      if (!process.env.MO_SETTINGS_CAPTURE) return;
      const directory = join(process.cwd(), "docs/pr-crops/mo-b-settings-retry");
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: join(directory, `${info.project.name}-${lang}-${state}.png`) });
    };
    await capture("unavailable");
    available = true;
    await retry.click();
    await expect(page.getByTestId("portfolio-targets-empty")).toBeVisible();
    await expect(unavailable).toHaveCount(0);
    expect(methods).toEqual([...initialMethods, "GET"]);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await capture("recovered");
  });
}
