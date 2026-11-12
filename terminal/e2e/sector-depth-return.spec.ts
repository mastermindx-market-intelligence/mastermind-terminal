import { expect, test, type Page } from "@playwright/test";

// Synthetic navigation fixtures, not current market evidence or a domain acceptance claim.
const sectors = [{ id: "xlk", name: "Technology", name_zh: "科技", ticker: "XLK",
  heat: { heat_1M: 7, breadth_pct: 60, adv: 3, dec: 2 }, momentum: { above_200d: true } }];
const tiles = ["AAA", "BBB", "CCC", "DDD", "EEE"].map((ticker, index) => ({ t: ticker,
  name: `Synthetic ${ticker}`, sector: "Technology", industry: index < 3 ? "Hardware" : "Software",
  size: (500 - index * 80) * 1e9, perf: { "1D": index, "1M": index + 1 } }));

async function prepare(page: Page, lang: "en" | "zh", longIndustry?: string) {
  await page.addInitScript(value => localStorage.setItem("mm.lang", value), lang);
  await page.route("**/api/sector-intelligence?**", route => {
    const source = new URL(route.request().url()).searchParams.get("source");
    const data = source === "sector" ? { as_of: "2026-10-20", sectors }
      : source === "heatmap" ? { asof: "2026-10-20", size_basis: "marketcap", n_tiles: tiles.length,
        tiles: longIndustry ? tiles.map(tile => ({ ...tile, industry: longIndustry })) : tiles } : null;
    return route.fulfill({ status: data ? 200 : 404, json: { data, receipt: {
      source, status: data ? "ready" : "unavailable", path: `/synthetic/${source}`,
      asOf: data ? "2026-10-20" : null, observedAt: null, contentHash: null, stale: false,
    } } });
  });
}

test("long permitted filters survive reload without inflating the public return query", async ({ page }) => {
  const industry = "科".repeat(120);
  await prepare(page, "en", industry);
  await page.goto("/discover?tab=sectors");
  const root = page.getByTestId("sector-intelligence");
  await expect(root.locator("[data-summary-industry-row]")).toHaveCount(1);
  await root.getByRole("group", { name: "Discover representation", exact: true }).getByRole("button", { name: "Table", exact: true }).click();
  const table = root.getByTestId("sector-company-table");
  await expect(table.locator("[data-company-table-row]")).toHaveCount(5);
  await table.locator('[data-company-table-row="AAA"]').getByRole("button").click();
  await table.locator("select").nth(2).selectOption(industry);
  await table.getByRole("searchbox").fill("科".repeat(60));
  const opener = page.url();
  await table.getByRole("button", { name: /^Open sector intelligence/ }).click();
  await expect(root).toHaveAttribute("data-sector-workspace", "detail");
  expect(new URL(page.url()).searchParams.get("sectorReturn")!.length).toBeLessThanOrEqual(1024);
  expect(await page.evaluate(() => window.history.state.mmxSectorDepthReturn.length)).toBeGreaterThan(1024);
  await page.reload();
  await expect(root).toHaveAttribute("data-sector-workspace", "detail");
  await expect(root.getByTestId("sector-detail-return")).toContainText("Back to Discover");
  await root.getByTestId("sector-detail-return").click();
  await expect(root).toHaveAttribute("data-sector-workspace", "discover");
  expect(comparable(page.url())).toBe(comparable(opener));
  await expect(table.locator("select").nth(2)).toHaveValue(industry);
  await expect(table.getByRole("searchbox")).toHaveValue("科".repeat(60));
  expect(await page.evaluate(() => Object.hasOwn(window.history.state, "mmxSectorDepthReturn"))).toBe(false);
});

function comparable(href: string): string {
  const url = new URL(href);
  url.searchParams.sort();
  return url.pathname + url.search + url.hash;
}

for (const lang of ["en", "zh"] as const) for (const theme of ["dark", "light"] as const) {
  test(`sector drill reload returns the exact filtered selection: ${lang} ${theme}`, async ({ page }, testInfo) => {
    await prepare(page, lang);
    await page.goto(`/discover?tab=sectors&from=sector-return-proof&sectorTheme=${theme}#selection`);
    const root = page.getByTestId("sector-intelligence");
    // Data rendered by the effect proves the dynamic workspace has hydrated before input.
    await expect(root.locator("[data-summary-industry-row]")).toHaveCount(2);
    await root.getByRole("group", { name: lang === "en" ? "Discover representation" : "发现视图", exact: true })
      .getByRole("button", { name: lang === "en" ? "Table" : "表格", exact: true }).click();
    const table = root.getByTestId("sector-company-table");
    await expect(table.locator("[data-company-table-row]")).toHaveCount(5);
    await table.locator("select").nth(1).selectOption("1M");
    await table.locator("select").nth(2).selectOption("Hardware");
    await table.locator('[data-company-table-row="AAA"]').getByRole("button").click();
    const opener = page.url();
    await table.getByRole("button", { name: lang === "en" ? /^Open sector intelligence/ : /^打开板块情报/ }).click();
    await expect(root).toHaveAttribute("data-sector-workspace", "detail");
    expect(new URL(page.url()).searchParams.get("sectorReturn")).toBeTruthy();
    await page.reload();
    await expect(root).toHaveAttribute("data-sector-workspace", "detail");
    await expect(root.getByTestId("sector-detail-return")).toContainText(lang === "en" ? "Back to Discover" : "返回发现");
    await testInfo.attach("research-after-reload", { body: await root.screenshot(), contentType: "image/png" });
    await root.getByTestId("sector-detail-return").click();
    await expect(root).toHaveAttribute("data-sector-workspace", "discover");
    expect(comparable(page.url())).toBe(comparable(opener));
    await expect(table.locator("select").nth(1)).toHaveValue("1M");
    await expect(table.locator("select").nth(2)).toHaveValue("Hardware");
    await expect(table.locator('[data-company-table-row="AAA"]')).toHaveAttribute("aria-selected", "true");
    expect(new URL(page.url()).searchParams.has("sectorReturn")).toBe(false);
    await testInfo.attach("restored-selection", { body: await root.screenshot(), contentType: "image/png" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await page.goBack();
    await expect(root).toHaveAttribute("data-sector-workspace", "detail");
    await expect(root.getByTestId("sector-detail-return")).toContainText(lang === "en" ? "Back to Discover" : "返回发现");
    await page.goBack();
    await expect(root).toHaveAttribute("data-sector-workspace", "discover");
    expect(comparable(page.url())).toBe(comparable(opener));

    // An unqualified external target cannot redirect the return control.
    await page.goto(`/discover?tab=sectors&sectorWorkspace=detail&sectorReturn=${encodeURIComponent("https://example.com")}&sectorTheme=${theme}`);
    await expect(root).toHaveAttribute("data-sector-workspace", "detail");
    await expect(root.getByTestId("sector-detail-return")).toContainText(lang === "en" ? "Back to Rotation" : "返回轮动");
    await root.getByTestId("sector-detail-return").click();
    await expect(root).toHaveAttribute("data-sector-workspace", "rotation");
    expect(new URL(page.url()).searchParams.has("sectorReturn")).toBe(false);
  });
}
