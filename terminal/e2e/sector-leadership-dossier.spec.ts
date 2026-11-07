import { expect, test, type Locator, type Page, type Route, type TestInfo } from "@playwright/test";
import { sectorFixture } from "./fixtures/sector-company-v3";
import dossier from "../lib/__tests__/fixtures/sector_dossiers_v1.json";
import outage from "../lib/__tests__/fixtures/sector_dossiers_unavailable_v1.json";

/** The owner's own sector rows. The dossier identifies a sector by its ETF proxy ticker, so the
 * owner row and the cohort row are the same identity here. */
const sectors = [
  { id: "xlk", name: "Technology", name_zh: "科技", ticker: "XLK",
    momentum: { rs_21d_rank: 1, rs_rank: 3, above_200d: true, lead: "leading" },
    heat: { breadth_pct: 58, adv: 46, dec: 33, heat_1M: 7.01 },
    cycle: { phaseLabel: "Rolling over" }, conviction: { label_en: "Cautious" }, rotation: { state: "TURN SIGNALED" } },
  { id: "xle", name: "Energy", name_zh: "能源", ticker: "XLE",
    momentum: { rs_21d_rank: 2, rs_rank: 1, above_200d: true, lead: "leading" },
    heat: { breadth_pct: 62, adv: 40, dec: 25, heat_1M: 5.5 },
    cycle: { phaseLabel: "Rolling over" }, conviction: { label_en: "Cautious" }, rotation: { state: "TURN SIGNALED" } },
];

test.setTimeout(90000);
const detail = "/discover?tab=sectors&sector=xlk&group=semiconductors";

/** A synthetic heatmap population, so the Discover representations have company rows to open. */
const tiles = ["AAA", "BBB", "CCC", "DDD", "EEE"].map((ticker, index) => ({ t: ticker,
  name: `Synthetic ${ticker}`, sector: "Technology", industry: index < 3 ? "Hardware" : "Software",
  size: (500 - index * 80) * 1e9, perf: { "1D": index, "1M": index + 1 } }));

/** Serve every owner feed from the shared fixture, then carry the owner's own dossier on the
 * sector feed, so a case can exercise a specific owner state without disturbing the rest of the
 * overview. The dossier is the owner's own `measured_read` document, delivered exactly as the
 * producer delivers it — no new gateway and no new route. */
async function prepare(page: Page, options: {
  language?: string; read?: unknown; denied?: boolean; withdrawAfterFirst?: boolean;
} = {}) {
  await page.addInitScript(lang => {
    localStorage.setItem("mm.lang", lang); document.documentElement?.setAttribute("data-lang", lang);
  }, options.language || "en");
  let sectorReads = 0;
  await page.route("**/api/sector-intelligence?**", async (route: Route) => {
    const source = new URL(route.request().url()).searchParams.get("source") || "";
    if (source === "heatmap") return route.fulfill({ status: 200, json: { data: {
      asof: "2026-10-09", size_basis: "marketcap", n_tiles: tiles.length, tiles },
      receipt: { source, path: "/marketdata/sp500_heatmap.json", status: "ready", asOf: "2026-10-09",
        observedAt: "2026-10-09T21:00:00Z", stale: false, contentHash: null } } });
    if (source !== "sector") return sectorFixture(route);
    sectorReads += 1;
    const withdrawn = options.denied || (options.withdrawAfterFirst && sectorReads > 1);
    if (withdrawn) return route.fulfill({ status: 401, json: { data: null, receipt: {
      source, path: "/sectordata/sector_central.json", status: "access", asOf: null,
      observedAt: null, stale: false, contentHash: null } } });
    const read = options.read === undefined ? dossier : options.read;
    const data = read === null ? { as_of: "2026-10-09", sectors }
      : { as_of: "2026-10-09", sectors, measured_read: read };
    return route.fulfill({ status: 200, json: { data, receipt: {
      source, path: "/sectordata/sector_central.json", status: "ready", asOf: "2026-10-09",
      observedAt: "2026-10-09T21:00:00Z", stale: false, contentHash: "sha256:transport" } } });
  });
}

const root = (page: Page) => page.getByTestId("sector-intelligence");
const panel = (page: Page) => page.getByTestId("sector-leadership-dossier");
const metric = (page: Page, window: string) =>
  panel(page).locator(`[data-testid="sector-dossier-metric"][data-window="${window}"]`);

async function noOverflow(page: Page) {
  const board = root(page);
  expect(await board.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(1);
}

/** Operation-specific screenshot receipt, written outside the source tree so the returned commit
 * carries source only. The viewport is captured with the named part of the section in view, so
 * every receipt is readable rather than a clipped element box. */
async function receipt(page: Page, info: TestInfo, name: string, target?: Locator) {
  const path = `${process.env.PSL_RECEIPT_DIR || "/tmp/psl-receipts"}/${info.project.name}-${name}.png`;
  await (target || panel(page)).scrollIntoViewIfNeeded();
  const png = await page.screenshot({ animations: "disabled" });
  await page.screenshot({ path, animations: "disabled" });
  await info.attach(`dossier-${info.project.name}-${name}`, { body: png, contentType: "image/png" });
  return path;
}

test("the detail overview renders the owner's measured leadership evidence", async ({ page }) => {
  await prepare(page); await page.goto(detail);
  const section = panel(page);
  await expect(section.getByRole("heading", { name: "Leadership evidence", exact: true })).toBeVisible();
  await expect(section).toContainText("Technology · XLK");
  await expect(section).toContainText("Through date");
  await expect(section.locator("time")).toHaveText("2026-10-09");

  // The two exact windows, against the admitted benchmark.
  await expect(metric(page, "21")).toContainText("21 sessions");
  await expect(metric(page, "21")).toContainText("-0.50%");
  await expect(metric(page, "63")).toContainText("63 sessions");
  await expect(metric(page, "63")).toContainText("0.00%");
  // A signed zero carries no direction and no sign.
  await expect(metric(page, "63").locator("strong")).not.toHaveAttribute("data-sign", /./);
  await expect(section).toContainText("Relative wealth vs SPY");

  await expect(section).toContainText("Compare the evidence before acting");
  await expect(section).toContainText("These are observed relative moves. No forecast is available from this source.");
  await expect(section).toContainText("21 sessions: 5 of 9 measured ETF sectors are positive (11 expected).");
  await expect(section).toContainText("ETF sector proxies, not constituent breadth.");
  await expect(section).toContainText("Mechanism and sector-risk context are unavailable from this source.");
  await noOverflow(page);
});

test("the comparison disclosure holds all eleven owner-order rows with their own null reasons", async ({ page }) => {
  await prepare(page); await page.goto(detail);
  const compare = panel(page).getByTestId("sector-dossier-compare");
  await compare.locator("summary").click();
  const rows = compare.locator("tbody tr");
  await expect(rows).toHaveCount(11);
  expect(await rows.evaluateAll(list => list.map(row => row.getAttribute("data-sector"))))
    .toEqual(["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"]);
  await expect(rows.filter({ hasText: "Real Estate" })).toContainText("This sector group was not supplied.");
  await expect(rows.filter({ hasText: "Utilities" })).toContainText("Not enough history for this window.");
  await expect(compare).not.toContainText("missing_group");
  await expect(compare).not.toContainText("thin_history");
  await noOverflow(page);
});

test("the source disclosure keeps the owner's qualifications and the exact machine reasons", async ({ page }) => {
  await prepare(page); await page.goto(detail);
  const source = panel(page).getByTestId("sector-dossier-source");
  await source.locator("summary").click();
  await expect(source).toContainText("Unverified — the owner supplied no freshness receipt.");
  await expect(source).toContainText("Reconstructed from prices; not naturally observed.");
  await expect(source).toContainText("The original availability time was not supplied.");
  await expect(source).toContainText("The native revision selection was not supplied.");
  await expect(source).toContainText("The immutable generation was not supplied.");
  await expect(source).toContainText("2026-10-09|SPY|us_sectors_11");
  await expect(source).toContainText("It is not an immutable generation.");
  await expect(source).toContainText("Not qualified by the owner; no forecast is available.");
  await expect(source).toContainText("XLRE: missing_group");
  await expect(source).toContainText("XLU: thin_history");
  await expect(source).toContainText("owner_freshness_receipt_not_supplied");
  await expect(source).toContainText("immutable_generation_not_supplied");
  await expect(source).toContainText("not_qualified");
  await expect(source).toContainText("Transport evidence only");
  await noOverflow(page);
});

test("the real journey opens research, changes sector, and returns by Back and by reload", async ({ page }) => {
  await prepare(page); await page.goto("/discover?tab=sectors&sectorDiscoveryMode=table");
  await expect(root(page)).toHaveAttribute("data-sector-workspace", "discover");
  await root(page).getByTestId("company-table-selection")
    .getByRole("button", { name: "Open sector intelligence" }).click();
  await expect(root(page)).toHaveAttribute("data-sector-workspace", "detail");
  await expect(panel(page)).toContainText("Technology · XLK");
  await expect(metric(page, "21")).toContainText("-0.50%");

  // Changing the sector changes the evidence, and never falls back to the previous sector.
  await root(page).getByRole("combobox", { name: "Sector" }).selectOption("xle");
  await expect(panel(page)).toContainText("Energy · XLE");
  await expect(metric(page, "21")).toContainText("+2.40%");
  await expect(metric(page, "63")).toContainText("+4.10%");
  await expect(panel(page)).not.toContainText("Technology · XLK");

  await root(page).getByTestId("sector-detail-return").click();
  await expect(root(page)).toHaveAttribute("data-sector-workspace", "discover");

  // A reload of the research depth brings the same evidence back.
  await page.goto(detail);
  await expect(root(page)).toHaveAttribute("data-sector-workspace", "detail");
  await expect(panel(page)).toContainText("Technology · XLK");
  await expect(metric(page, "21")).toContainText("-0.50%");
  await page.reload();
  await expect(panel(page)).toContainText("Technology · XLK");
  await expect(metric(page, "21")).toContainText("-0.50%");
  await page.goBack();
  await expect(root(page)).toHaveAttribute("data-sector-workspace", "discover");
  await noOverflow(page);
});

test("the rotation workspace opens the same research depth", async ({ page }) => {
  await prepare(page); await page.goto("/discover?tab=sectors&sectorWorkspace=rotation");
  await expect(root(page)).toHaveAttribute("data-sector-workspace", "rotation");
  const inspector = root(page).getByTestId("rotation-inspector");
  await inspector.getByRole("button", { name: "Open sector research" }).click();
  await expect(root(page)).toHaveAttribute("data-sector-workspace", "detail");
  await expect(panel(page)).toContainText("Technology · XLK");
  await expect(metric(page, "21")).toContainText("-0.50%");
  await noOverflow(page);
});

test("a withdrawn access clears every figure and leaves the rest of the overview intact", async ({ page }) => {
  await prepare(page, { withdrawAfterFirst: true }); await page.goto(detail);
  await expect(metric(page, "21")).toContainText("-0.50%");
  await root(page).getByRole("button", { name: "Refresh" }).click();
  await expect(panel(page)).toContainText("Leadership evidence requires access");
  await expect(metric(page, "21")).toHaveCount(0);
  await expect(panel(page)).not.toContainText("-0.50%");
  await expect(panel(page)).not.toContainText("0.00%");
  await expect(root(page).getByTestId("sector-detail-return")).toBeVisible();
  await noOverflow(page);
});

test("an owner document with no leadership evidence reads as a missing capability", async ({ page }) => {
  await prepare(page, { read: {} }); await page.goto(detail);
  await expect(panel(page)).toContainText("Leadership evidence is not available for this sector");
  await expect(metric(page, "21")).toHaveCount(0);
  await expect(root(page)).toHaveAttribute("data-sector-workspace", "detail");
  await noOverflow(page);
});

test("a valid unavailable dossier retains all eleven null rows and source qualifications", async ({ page }) => {
  await prepare(page, { read: outage }); await page.goto(detail);
  await expect(panel(page)).toContainText("Leadership evidence is unavailable");
  await expect(metric(page, "21").locator("strong")).toHaveText("—");
  await expect(metric(page, "21")).toContainText("The source session date is missing or invalid.");
  await panel(page).getByTestId("sector-dossier-compare").locator("summary").click();
  await expect(panel(page).locator("tbody tr")).toHaveCount(11);
  await expect(panel(page).locator("tbody")).not.toContainText("source_session_missing_or_invalid");
  await panel(page).getByTestId("sector-dossier-source").locator("summary").click();
  await expect(panel(page).getByTestId("sector-dossier-source")).toContainText("XLK: source_session_missing_or_invalid");
  await expect(panel(page)).not.toContainText("0.00%");
  await noOverflow(page);
});

test("the section localizes fully in Chinese light and never leaks English", async ({ page }) => {
  await prepare(page, { language: "zh" }); await page.goto(`${detail}&sectorTheme=light`);
  const section = panel(page);
  await expect(section.getByRole("heading", { name: "领涨证据", exact: true })).toBeVisible();
  await expect(section).toContainText("科技 · XLK");
  await expect(section).toContainText("21个交易日");
  await expect(section).toContainText("先核对证据，再作判断");
  await expect(section).toContainText("已测量的9个ETF板块中5个为正（预期11个）");
  await expect(section).not.toContainText("Leadership evidence");
  await expect(section).not.toContainText("Compare the evidence before acting");
  await noOverflow(page);
});

test("the disclosures open from the keyboard and keep their content reachable", async ({ page }) => {
  await prepare(page); await page.goto(detail);
  const compare = panel(page).getByTestId("sector-dossier-compare");
  const summary = compare.locator("summary");
  await summary.focus();
  await expect(summary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(compare.locator("tbody tr")).toHaveCount(11);
  await page.keyboard.press("Tab");
  await expect(panel(page).getByTestId("sector-dossier-source").locator("summary")).toBeFocused();
  await noOverflow(page);
});

test("the section fits the narrowest supported width without overflowing the page", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(detail);
  await expect(panel(page)).toBeVisible();
  await panel(page).getByTestId("sector-dossier-compare").locator("summary").click();
  await expect(panel(page).locator("tbody tr")).toHaveCount(11);
  expect(await root(page).evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(1);
});

for (const [language, theme] of [["en", "dark"], ["zh", "light"]] as const) {
  test(`the rendered evidence is receipted: ${language} ${theme}`, async ({ page }, info) => {
    await prepare(page, { language }); await page.goto(`${detail}&sectorTheme=${theme}`);
    await expect(panel(page)).toBeVisible();
    const paths: string[] = [];
    paths.push(await receipt(page, info, `overview-${language}-${theme}`));
    await panel(page).getByTestId("sector-dossier-compare").locator("summary").click();
    paths.push(await receipt(page, info, `compare-${language}-${theme}`,
      panel(page).getByTestId("sector-dossier-compare")));
    await panel(page).getByTestId("sector-dossier-source").locator("summary").click();
    paths.push(await receipt(page, info, `source-${language}-${theme}`,
      panel(page).getByTestId("sector-dossier-source")));
    await page.setViewportSize({ width: 320, height: 800 });
    paths.push(await receipt(page, info, `narrow-320-${language}-${theme}`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);
    await info.attach(`receipt-paths-${language}-${theme}`, {
      body: JSON.stringify(paths, null, 1), contentType: "application/json" });
  });
}
