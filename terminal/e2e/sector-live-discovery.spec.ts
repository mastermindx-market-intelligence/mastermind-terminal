import { expect, test } from "@playwright/test";
import { sectorFixture } from "./fixtures/sector-company-v3";

test("Sector Discover updates session returns and rankings in an open tab", async ({ page }, info) => {
  const now = Date.parse("2026-11-02T19:30:00Z");
  await page.clock.setFixedTime(now);
  await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
  const data = { asof: "2026-10-30", size_basis: "marketcap", n_tiles: 2, tiles:
    ["AAA", "BBB"].map(t => ({ t, name: t, sector: "Technology", industry: "Hardware", size: 1e9, perf: { "1D": -5, "1W": 4 } })) };
  await page.route("**/api/sector-intelligence?**", route => {
    if (new URL(route.request().url()).searchParams.get("source") !== "heatmap") return sectorFixture(route);
    return route.fulfill({ json: { data, receipt: { source: "heatmap", status: "ready", asOf: data.asof } } });
  });
  const quote = (value: number) => ({ market: "us", marketSession: "rth", regularSession: "rth", regularSessionDate: "2026-11-02",
    source: "polygon-snapshot-rt", basis: "REALTIME", asOfMs: now - 2000, regularPrice: 100 + value, regularChg: value, prevClose: 100 });
  let reads = 0;
  await page.route("**/api/quote?**", route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("view") !== "regular" || params.get("syms") !== "AAA,BBB") return route.fulfill({ json: { quotes: {} } });
    return route.fulfill({ json: { quotes: { AAA: quote(1), BBB: ++reads > 1 ? quote(3) : null } } });
  });
  await page.goto("/discover?tab=sectors&sectorWorkspace=discover&sectorDiscoveryMode=table&sector=xlk&sectorMatrixTimeframe=1D&sectorCompanyTableSort=performance");
  const table = page.getByTestId("sector-company-table");
  await expect(table).toBeVisible();
  await expect(table.getByTestId("company-table-answer")).toContainText("AAA leads 1D performance (+1.00%)");
  await expect(table.getByTestId("company-table-answer")).toContainText("BBB leads 1D performance (+3.00%)", { timeout: 16000 });
  await expect(table.locator("[data-company-table-row]").first()).toHaveAttribute("data-company-table-row", "BBB");
  await expect(page.getByTestId("sector-quote-coverage")).toContainText("2/2 quotes");
  await expect(page.getByTestId("sector-quote-coverage")).toContainText("Roster and cap snapshot 2026-10-30");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await info.attach("sector-current-session", { body: await table.screenshot(), contentType: "image/png" });
  await table.getByLabel("Performance window").selectOption("1W");
  await expect(table.getByTestId("company-table-answer")).toContainText("+4.00%");
  await expect(page.getByTestId("sector-quote-coverage")).toHaveCount(0);
});
