import { expect, test, type Page } from "@playwright/test";

async function prepare(page: Page) {
  const baseURL = test.info().project.use.baseURL || process.env.PLAYWRIGHT_BASE_URL ||
    "http://127.0.0.1:" + (process.env.TERMINAL_E2E_PORT || "3596");
  await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", url: baseURL }]);
}
function sample(pair: "ES" | "NQ") {
  return {
    kind: "weekly_cftc_tff_futures_only", pair, cftcCode: pair === "ES" ? "13874A" : "209742",
    market: (pair === "ES" ? "E-MINI S&P 500" : "NASDAQ MINI") + " - CHICAGO MERCANTILE EXCHANGE",
    reportDate: "2026-10-13", previousReportDate: "2026-10-06",
    retrievedAtMs: Date.parse("2026-10-16T20:00:00Z"), openInterest: pair === "ES" ? 1931607 : 279515,
    openInterestChange: -620, replayEligible: false,
    sourceUrl: "https://publicreporting.cftc.gov/Commitments-of-Traders/TFF-Futures-Only/gpe5-46if",
    categories: [
      { key: "dealer", long: 200, short: 250, spread: 50, net: -50, weeklyNetChange: 15 },
      { key: "assetManager", long: 500, short: 100, spread: 40, net: 400, weeklyNetChange: 40 },
      { key: "leveragedMoney", long: 300, short: pair === "ES" ? 400 : 900,
        spread: 20, net: pair === "ES" ? -100 : -600, weeklyNetChange: -33 },
      { key: "otherReportable", long: 40, short: 20, spread: 10, net: 20, weeklyNetChange: 0 },
    ],
  };
}
test("weekly CFTC ES/NQ positioning is visible even when futures depth has no authorized publisher", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await prepare(page);
  await page.route("**/api/futures?*", r => r.fulfill({ status: 503, json: { error: "source_unavailable" } }));
  await page.route("**/api/futures/cot?*", r => {
    const pair = new URL(r.request().url()).searchParams.get("pair");
    return r.fulfill({ json: sample(pair === "NQ" ? "NQ" : "ES") });
  });
  await page.goto("/options/futures?pair=ES");
  await expect(page.getByTestId("futures-unavailable")).toBeVisible();
  await expect(page.getByTestId("futures-chart")).toHaveCount(0);
  await expect(page.getByTestId("cot-net-leveragedMoney")).toHaveText("-100");
  await expect(page.getByTestId("cot-report-date")).toContainText("2026-10-13");
  await expect(page.getByTestId("futures-cot-panel")).toContainText("Not live order flow");
  await page.getByLabel("Instrument", { exact: true }).selectOption("NQ");
  await expect(page.getByTestId("cot-market")).toContainText("NASDAQ MINI");
  await expect(page.getByTestId("cot-net-leveragedMoney")).toHaveText("-600");
  await page.getByRole("button", { name: "Language" }).click();
  await expect(page.getByTestId("futures-cot-panel")).toContainText("每周机构持仓");
  const width = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth,
  }));
  expect(width.content).toBeLessThanOrEqual(width.viewport + 1);
  expect(errors).toEqual([]);
});
test("missing/mismatched CFTC report never appears as measured zero", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/futures?*", r => r.fulfill({ status: 503, json: { error: "source_unavailable" } }));
  await page.route("**/api/futures/cot?*", r =>
    r.fulfill({ json: sample("NQ") }));
  await page.goto("/options/futures?pair=ES");
  await expect(page.getByTestId("cot-unavailable")).toBeVisible();
  await expect(page.getByTestId("cot-net-leveragedMoney")).toHaveCount(0);
});
test("the CFTC API cannot be exposed with a browser fixture flag", async ({ page }) => {
  await prepare(page);
  const response = await page.request.get("/api/futures/cot?pair=ES");
  expect(response.status()).toBe(403);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(await response.json()).toEqual({ error: "access_required" });
});
