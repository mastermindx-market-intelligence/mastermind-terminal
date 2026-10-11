import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { isolateWatchlistStore } from "./watchlistStore";

// Actual Settings section on the existing localhost fixture identity. Malformed
// successful reads must stay unavailable until a valid authoritative GET arrives.
for (const lang of ["en", "zh"] as const) {
  test(`Settings rejects an unusable targets summary and recovers without a write (${lang})`, async ({ page, baseURL }, info) => {
    await isolateWatchlistStore(page, info, baseURL);
    await page.addInitScript((locale) => localStorage.setItem("mm.lang", locale), lang);
    await page.route("**/data/manifest.json", (route) => route.fulfill({ json: {
      symbols: { NVDA: { name: "NVIDIA", zh: "英伟达", last: 175, chg: 1.2 } },
    } }));
    await page.route("**/api/quote**", (route) => route.fulfill({ json: { quotes: {} } }));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const methods: string[] = [];
    let available = false;
    await page.route(/\/api\/portfolio\/targets(\?|$)/, async (route) => {
      methods.push(route.request().method());
      expect(route.request().method()).toBe("GET");
      await route.fulfill({ json: { summary: {
        schema: "portfolio_targets.v1", weightBasis: "cost", targetsSumPct: null,
        targetsSumOffBy100: null, drifts: available ? [] : null,
        untargeted: [], orphaned: [],
      } } });
    });
    await page.goto("/terminal?symbol=NVDA");
    await page.locator(`button[aria-label="${lang === "en" ? "Settings" : "设置"}"]:visible`).first().click();
    await page.getByRole("tab", {
      name: lang === "en" ? "Portfolio targets" : "组合目标权重", exact: true,
    }).click();
    const unavailable = page.getByTestId("portfolio-targets-unreadable");
    await expect(unavailable).toBeVisible();
    await expect(page.getByTestId("portfolio-targets-empty")).toHaveCount(0);
    await expect(page.getByTestId("portfolio-targets-loaded")).toHaveCount(0);
    const retry = unavailable.getByRole("button", {
      name: lang === "en" ? "Try again" : "重试", exact: true,
    });
    await expect(retry).toBeVisible();
    const capture = async (state: string) => {
      const directory = process.env.MO_SETTINGS_SUMMARY_CAPTURE_DIRECTORY;
      if (!directory) return;
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: join(directory, `${info.project.name}-${lang}-${state}.png`) });
    };
    await capture("unusable");
    const initial = [...methods];
    available = true;
    await retry.click();
    await expect(page.getByTestId("portfolio-targets-empty")).toBeVisible();
    await expect(unavailable).toHaveCount(0);
    expect(methods).toEqual([...initial, "GET"]);
    expect(errors).toEqual([]);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await capture("recovered");
  });
}
