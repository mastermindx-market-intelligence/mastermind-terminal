import { expect, test } from "@playwright/test";
import { DEFAULT_SECTOR_STATE } from "../lib/sectorIntelligence";
import { encodeExposureOrigin, sectorOriginFromState } from "../lib/exposureOrigin";

// Synthetic navigation owners. This does not qualify an options source or model.
const sectors = [{ id: "xlk", ticker: "XLK", name: "Technology", name_zh: "科技", heat: {}, momentum: {} }];
const tiles = ["AAA", "BBB", "CCC", "DDD", "EEE"].map((t, index) => ({ t, name: `Synthetic ${t}`,
  sector: "Technology", industry: index < 3 ? "Hardware" : "Software", size: (500 - index * 80) * 1e9,
  perf: { "1D": index, "1M": index + 1 } }));
const group = { key: "semiconductors", kind: "subsector", sector: "Technology", label: "Hardware", label_zh: "硬件",
  n_members: 2, n_priced: 2, members: ["AAA", "BBB"].map(ticker => ({ ticker, price: 100, ret_20d: 1, vs_basket: 1, stock_buyable: false })) };

function comparable(href: string): string {
  const url = new URL(href); url.searchParams.sort();
  return url.pathname + url.search + url.hash;
}

test("an over-budget cohort step is disabled without changing the current symbol or valid origin", async ({ page }, testInfo) => {
  const state = { ...DEFAULT_SECTOR_STATE, workspace: "detail" as const, finvizTheme: "科".repeat(31), company: "A" };
  const origin = sectorOriginFromState({ state, depthReturn: DEFAULT_SECTOR_STATE, company: "A", roster: ["A", "ABCDEFGHIJ"],
    asOf: "2026-10-20", contentHash: "sha256:123456789", benchmark: "SPY" })!;
  const wire = encodeExposureOrigin(origin)!;
  expect(wire.length).toBe(1008);
  await page.route("**/api/**", route => route.fulfill({ json: {} }));
  await page.route("**/api/sector-intelligence?**", route => route.fulfill({ json: {
    data: { ok: true, sectors: [], subsectors: [{ ...group, members: ["A", "ABCDEFGHIJ"].map(ticker => ({ ticker, price: 100 })) }] },
    receipt: { source: "confluence", status: "ready", contentHash: "sha256:123456789", asOf: "2026-10-20" },
  } }));
  await page.goto(`/options?tab=prism&symbol=A&view=chart&origin=${wire}`);
  const strip = page.getByTestId("exposure-origin-strip");
  await expect(strip).toHaveAttribute("data-state", "exact");
  await expect(strip.getByTestId("exposure-origin-next")).toBeDisabled();
  expect(new URL(page.url()).searchParams.get("symbol")).toBe("A");
  expect(JSON.parse(new URL(page.url()).searchParams.get("origin")!).company).toBe("A");
  await expect(strip.getByTestId("exposure-origin-back")).toHaveAttribute("href", origin.returnHref);
  await testInfo.attach("over-budget-step-disabled", { body: await strip.screenshot(), contentType: "image/png" });
});

test("stepping and Back preserve unrelated query and existing appearance preferences", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("sector-test-seeded")) {
      localStorage.setItem("mmx.shell.theme", "light"); localStorage.setItem("mm.lang", "en");
      sessionStorage.setItem("sector-test-seeded", "1");
    }
  });
  const origin = sectorOriginFromState({ state: { ...DEFAULT_SECTOR_STATE, workspace: "detail", company: "AAA" },
    depthReturn: DEFAULT_SECTOR_STATE, company: "AAA", roster: ["AAA", "BBB"],
    asOf: "2026-10-20", contentHash: "sha256:123456789", benchmark: "SPY" })!;
  await page.route("**/api/**", route => route.fulfill({ json: {} }));
  await page.route("**/api/sector-intelligence?**", route => {
    const source = new URL(route.request().url()).searchParams.get("source");
    const data = source === "confluence" ? { ok: true, sectors: [], subsectors: [group] }
      : source === "sector" ? { sectors } : { size_basis: "marketcap", n_tiles: tiles.length, tiles };
    return route.fulfill({ json: { data, receipt: { source, status: "ready", contentHash: "sha256:123456789", asOf: "2026-10-20" } } });
  });
  await page.goto(`/options?tab=prism&symbol=AAA&view=chart&comparison=SPY&returnNote=a%26b&origin=${encodeExposureOrigin(origin)}`);
  const strip = page.getByTestId("exposure-origin-strip");
  await expect(strip).toHaveAttribute("data-state", "exact");
  const checkPreferences = async (company: string) => {
    const params = new URL(page.url()).searchParams;
    expect(params.get("symbol")).toBe(company);
    expect(params.get("comparison")).toBe("SPY"); expect(params.get("returnNote")).toBe("a&b");
    expect(JSON.parse(params.get("origin")!).company).toBe(company);
    expect(await page.evaluate(() => localStorage.getItem("mmx.shell.theme"))).toBe("light");
  };
  await strip.getByTestId("exposure-origin-next").click(); await checkPreferences("BBB");
  await page.goBack(); await expect(page).toHaveURL(/symbol=AAA/); await checkPreferences("AAA");
  await page.goForward(); await expect(page).toHaveURL(/symbol=BBB/); await checkPreferences("BBB");
  await testInfo.attach("light-origin-and-preserved-preferences", { body: await strip.screenshot(), contentType: "image/png" });
  await strip.getByTestId("exposure-origin-back").click();
  await expect(page.getByTestId("sector-intelligence")).toHaveAttribute("data-sector-workspace", "detail");
  expect(await page.evaluate(() => localStorage.getItem("mmx.shell.theme"))).toBe("light");
  await expect(page.getByTestId("sector-detail-return")).toContainText("Back to Discover");
});

for (const lang of ["en", "zh"] as const) for (const theme of ["dark", "light"] as const) {
  test(`Exposure explicit return preserves the sector research opener: ${lang} ${theme}`, async ({ page }, testInfo) => {
    test.setTimeout(90000);
    await page.addInitScript(value => localStorage.setItem("mm.lang", value), lang);
    // Options can truthfully render its origin when the separate market feeds are unavailable.
    await page.route("**/api/**", route => route.fulfill({ json: {} }));
    await page.route("**/api/sector-intelligence?**", route => {
      const source = new URL(route.request().url()).searchParams.get("source");
      const data = source === "sector" ? { sectors }
        : source === "confluence" ? { ok: true, sectors: [], subsectors: [group] }
          : source === "heatmap" ? { size_basis: "marketcap", n_tiles: tiles.length, tiles } : null;
      return route.fulfill({ status: data ? 200 : 404, json: { data, receipt: {
        source, status: data ? "ready" : "unavailable", path: `/synthetic/${source}`, asOf: data ? "2026-10-20" : null,
        observedAt: null, contentHash: data ? "sha256:123456789" : null, stale: false,
      } } });
    });
    await page.goto(`/discover?tab=sectors&sectorTheme=${theme}`);
    const root = page.getByTestId("sector-intelligence");
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
    await root.getByRole("button", { name: lang === "en" ? "Browse company groups" : "浏览公司分组", exact: true }).click();
    await page.locator('[data-group-choice="semiconductors"]').click();
    await root.locator('[data-company-choice="AAA"]').click();
    const exposure = root.getByTestId("sector-open-exposure");
    await expect(exposure).toBeVisible();
    const href = (await exposure.getAttribute("href"))!;
    const origin = JSON.parse(new URL(href, page.url()).searchParams.get("origin")!);
    expect(new URL(origin.returnHref, page.url()).searchParams.get("sectorReturn")).toBeTruthy();
    expect(origin.returnHref.length).toBeLessThanOrEqual(512);
    await exposure.click();
    await expect(page).toHaveURL(/\/options\?/);
    const strip = page.getByTestId("exposure-origin-strip");
    await expect(strip).toHaveAttribute("data-state", "exact");
    await strip.getByTestId("exposure-origin-next").click();
    await expect(page).toHaveURL(/symbol=BBB/);
    await expect(strip).toHaveAttribute("data-state", "exact");
    const back = strip.getByTestId("exposure-origin-back");
    expect(new URL((await back.getAttribute("href"))!, page.url()).searchParams.get("sectorReturn")).toBeTruthy();
    await testInfo.attach("exposure-return-context", { body: await strip.screenshot(), contentType: "image/png" });
    await back.click();
    await expect(root).toHaveAttribute("data-sector-workspace", "detail");
    await expect(root.getByTestId("sector-detail-return")).toContainText(lang === "en" ? "Back to Discover" : "返回发现");
    await expect(root.getByTestId("sector-company-inspector").getByRole("heading", { name: "BBB", exact: true })).toBeVisible();
    await root.getByTestId("sector-detail-return").click();
    await expect(root).toHaveAttribute("data-sector-workspace", "discover");
    expect(comparable(page.url())).toBe(comparable(opener));
    await expect(table.locator('[data-company-table-row="AAA"]')).toHaveAttribute("aria-selected", "true");
    await testInfo.attach("restored-sector-selection", { body: await root.screenshot(), contentType: "image/png" });
  });
}
