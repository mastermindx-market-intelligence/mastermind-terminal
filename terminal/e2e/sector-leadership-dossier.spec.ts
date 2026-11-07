import { expect, test, type Locator, type Page, type Route, type TestInfo } from "@playwright/test";
import { sectorFixture } from "./fixtures/sector-company-v3";
import dossier from "../lib/__tests__/fixtures/sector_dossiers_v1.json";
import outage from "../lib/__tests__/fixtures/sector_dossiers_unavailable_v1.json";
import complete from "../lib/__tests__/fixtures/sector_window_measurements.complete.v1.json";
import unavailable from "../lib/__tests__/fixtures/sector_window_measurements.unavailable.v1.json";

/** The clearly labelled synthetic November 5 parent. It carries the producer's own exact-session
 * companion and no legacy dossier, so the companion is proved on its own in the browser. It is
 * NOT the October 9 legacy fixture with its dates moved. */
const nov5Parent = (read: unknown) => ({
  schema: "leadership_rotation_context.measured_group_read/v1",
  status: "available",
  generation: {
    benchmark: "SPY", cohort_id: "us_sectors_11", history_as_of: "2026-11-05",
    history_schema: "sector_cycles.rs_history.v1", id: "2026-11-05|SPY|us_sectors_11",
    price_basis: "total_return", session_end: "2026-11-05",
  },
  groups: [],
  sector_window_measurements: read,
});

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
  /** Serve the producer's exact-session companion inside a synthetic November 5 parent. */
  companion?: unknown;
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
    const read = options.companion !== undefined ? nov5Parent(options.companion)
      : options.read === undefined ? dossier : options.read;
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
const exact = (page: Page) => page.getByTestId("sector-exact-window-returns");
const exactWindow = (page: Page, window: string) =>
  exact(page).locator(`[data-testid="sector-exact-window"][data-window="${window}"]`);

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

/* -------------------------------------------------------------------------- *
 * The exact-session companion.
 *
 * The producer's own frozen companion document, served inside a clearly labelled synthetic
 * November 5 parent. The October 9 legacy dossier is never combined with it.
 * -------------------------------------------------------------------------- */

test("the exact-session companion renders in the research depth on its own", async ({ page }) => {
  await prepare(page, { companion: complete }); await page.goto(detail);
  // The legacy dossier is absent from this owner document, and the companion is still there.
  await expect(panel(page)).toContainText("Leadership evidence is not available for this sector");
  const companion = exact(page);
  await expect(companion).toBeVisible();
  await expect(companion.getByRole("heading", { name: "Exact session returns", exact: true })).toBeVisible();
  await expect(companion).toContainText("Technology · XLK");
  await expect(companion).toContainText("2026-11-05");
  await expect(companion).toContainText("6, 21 and 64");
  await expect(companion).toContainText("a wealth ratio");
  await expect(companion).toContainText("not the legacy 21-session window");
  await noOverflow(page);
});

test("the companion shows the three exact windows, the benchmark and all eleven rows", async ({ page }) => {
  await prepare(page, { companion: complete }); await page.goto(detail);
  const companion = exact(page);
  await expect(companion.locator('[data-testid="sector-exact-window"]')).toHaveCount(3);
  // The owner's own values for Technology over 5, 20 and 63 exact sessions.
  await expect(exactWindow(page, "5").locator('[data-testid="sector-exact-absolute"]')).toHaveText("-0.70%");
  await expect(exactWindow(page, "5").locator('[data-testid="sector-exact-relative"]')).toHaveText("-1.78%");
  await expect(exactWindow(page, "20").locator('[data-testid="sector-exact-absolute"]')).toHaveText("-2.86%");
  await expect(exactWindow(page, "63").locator('[data-testid="sector-exact-absolute"]')).toHaveText("-8.85%");
  // The exact session span is the producer's own, and so is the coverage.
  await expect(exactWindow(page, "63").locator('[data-testid="sector-exact-span"]'))
    .toContainText("2026-08-07 → 2026-11-05");
  await expect(exactWindow(page, "63").locator('[data-testid="sector-exact-coverage"]'))
    .toContainText("64 of 64 observations");
  // The benchmark is disclosed separately, with its own return and coverage.
  const benchmark = companion.getByTestId("sector-exact-benchmark");
  await expect(benchmark).toContainText("Benchmark SPY");
  await expect(benchmark.locator('[data-testid="sector-exact-benchmark-return"][data-window="63"]'))
    .toContainText("+14.38%");
  await expect(benchmark).toContainText("64 of 64 observations");
  // The comparison keeps all eleven identities in the producer's own order.
  const compare = companion.getByTestId("sector-exact-compare");
  await compare.locator("summary").click();
  const rows = compare.locator("tbody tr");
  await expect(rows).toHaveCount(11);
  expect(await rows.evaluateAll(list => list.map(row => row.getAttribute("data-sector"))))
    .toEqual(["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"]);
  await expect(rows.filter({ hasText: "Technology" })).toHaveAttribute("data-selected", "true");
  await noOverflow(page);
});

test("the companion keeps the producer's signed zero an ordinary zero", async ({ page }) => {
  await prepare(page, { companion: complete }); await page.goto(detail);
  const compare = exact(page).getByTestId("sector-exact-compare");
  await compare.locator("summary").click();
  const xlp = compare.locator('tbody tr[data-sector="XLP"]');
  // The producer published -0.0 for Consumer Staples over 63 sessions. It reads as a plain zero.
  await expect(xlp).toContainText("0.00%");
  await expect(xlp).not.toContainText("-0.00%");
  await expect(xlp.locator('[data-sign="down"]')).toHaveCount(0);
  await noOverflow(page);
});

test("a valid all-null companion block stays visible with its identities and cause", async ({ page }) => {
  await prepare(page, { companion: unavailable }); await page.goto(detail);
  const companion = exact(page);
  await expect(companion).toContainText("Exact-session returns are unavailable");
  // No prior positive figure survives the refusal.
  await expect(companion).not.toContainText("-8.85%");
  await expect(companion).not.toContainText("+14.38%");
  // The identities, the exact dates and the observed coverage are all kept.
  const compare = companion.getByTestId("sector-exact-compare");
  await compare.locator("summary").click();
  await expect(compare.locator("tbody tr")).toHaveCount(11);
  await expect(exactWindow(page, "63").locator('[data-testid="sector-exact-span"]'))
    .toContainText("2026-08-07 → 2026-11-05");
  await expect(exactWindow(page, "63").locator('[data-testid="sector-exact-coverage"]'))
    .toContainText("64 of 64 observations");
  // The cause is readable, and the raw reason stays in the companion's own source details.
  await expect(companion).toContainText("The source panel holds sessions after the end of the measurement cut.");
  await companion.getByTestId("sector-exact-source").locator("summary").click();
  await expect(companion.getByTestId("sector-exact-source")).toContainText("future_tail");
  await noOverflow(page);
});

test("a withdrawn access clears the companion and leaves the rest of the overview intact", async ({ page }) => {
  await prepare(page, { companion: complete, withdrawAfterFirst: true }); await page.goto(detail);
  await expect(exactWindow(page, "63").locator('[data-testid="sector-exact-absolute"]')).toHaveText("-8.85%");
  await root(page).getByRole("button", { name: "Refresh" }).click();
  await expect(panel(page)).toContainText("Leadership evidence requires access");
  await expect(exact(page)).toHaveCount(0);
  await expect(root(page).getByTestId("sector-detail-return")).toBeVisible();
  await noOverflow(page);
});

test("the companion adds no request of its own and never prefetches private members", async ({ page, context }) => {
  const sourcesOf = async (target: Page, companion?: unknown) => {
    const seen: string[] = [];
    target.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname.includes("/api/sector-intelligence")) seen.push(url.searchParams.get("source") || "");
    });
    await prepare(target, companion === undefined ? {} : { companion });
    await target.goto(detail);
    await expect((companion === undefined ? panel(target) : exact(target))).toBeVisible();
    return [...new Set(seen)].sort();
  };
  const withoutCompanion = await sourcesOf(page);
  const other = await context.newPage();
  const withCompanion = await sourcesOf(other, complete);
  await other.close();
  // The companion's presence adds no request at all: it is read from the feed it is handed.
  expect(withCompanion).toEqual(withoutCompanion);
});

test("the member open and the private identity chain are unchanged by the companion", async ({ page }) => {
  await prepare(page, { companion: complete }); await page.goto(detail);
  const evidence = page.getByTestId("sector-constituent-evidence");
  await expect(evidence).toBeVisible();
  // The membership record is the source's own, with its own date.
  await evidence.locator("select").selectOption("NVDA");
  const membership = evidence.getByTestId("sector-constituent-membership");
  await expect(membership).toContainText("NVDA");
  await expect(membership).toContainText("#1");
  await expect(membership).toContainText("2026-10-15");
  // Nothing private is shown before the member is explicitly opened.
  await expect(evidence).not.toHaveAttribute("data-open", "true");
  await evidence.getByRole("button", { name: "Open company evidence" }).click();
  await expect(evidence).toHaveAttribute("data-open", "true");
  await expect(evidence.getByTestId("sector-constituent-evidence-panel")).toBeVisible();
  await noOverflow(page);
});

for (const [language, theme] of [["en", "dark"], ["zh", "light"]] as const) {
  test(`the rendered companion is receipted: ${language} ${theme}`, async ({ page }, info) => {
    await prepare(page, { language, companion: complete });
    await page.goto(`${detail}&sectorTheme=${theme}`);
    await expect(exact(page)).toBeVisible();
    const paths: string[] = [];
    paths.push(await receipt(page, info, `exact-overview-${language}-${theme}`, exact(page)));
    await exact(page).getByTestId("sector-exact-compare").locator("summary").click();
    paths.push(await receipt(page, info, `exact-compare-${language}-${theme}`,
      exact(page).getByTestId("sector-exact-compare")));
    await exact(page).getByTestId("sector-exact-source").locator("summary").click();
    paths.push(await receipt(page, info, `exact-source-${language}-${theme}`,
      exact(page).getByTestId("sector-exact-source")));
    await page.setViewportSize({ width: 320, height: 800 });
    paths.push(await receipt(page, info, `exact-narrow-320-${language}-${theme}`, exact(page)));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);
    await info.attach(`exact-receipt-paths-${language}-${theme}`, {
      body: JSON.stringify(paths, null, 1), contentType: "application/json" });
  });
}

/* -------------------------------------------------------------------------- *
 * The corrected copy, in the browser.
 *
 * Each case serves a clearly labelled synthetic companion document derived from the canonical
 * producer document, and each one changes only the field under test. The documents are synthetic
 * fixtures: the screenshots are receipts of the rendered copy, not proof of a source admission.
 * -------------------------------------------------------------------------- */

type CompanionDoc = {
  status: string;
  reason: string | null;
  windows: Record<string, { status: string }>;
  groups: { group_id: string; windows: Record<string, {
    absolute_return_pct: number | null; relative_wealth_pct: number | null;
    null_reasons: { absolute_return_pct: string | null; relative_wealth_pct: string | null };
    status: string;
  }> }[];
  clocks: Record<string, string | null>;
  limitations: Record<string, { status: string; reason?: string; clock?: string }>;
  receipt: Record<string, unknown> | null;
  diagnostics: { complete_cells: number; measured_cells: number; receipt_withheld: boolean };
};

/** One withheld value inside an otherwise complete packet. Technology is the sixth cohort row. */
const partialCompanion = () => {
  const source = structuredClone(complete) as unknown as CompanionDoc;
  const xlk63 = source.groups[5].windows["63"];
  xlk63.absolute_return_pct = null;
  xlk63.null_reasons.absolute_return_pct = "missing_input";
  xlk63.status = "partial";
  source.windows["63"].status = "partial";
  source.diagnostics.complete_cells = 32;
  source.status = "partial";
  return source;
};

/** The owner's own publication, availability and history clocks, supplied unchanged. */
const suppliedClockCompanion = () => {
  const source = structuredClone(complete) as unknown as CompanionDoc;
  for (const name of ["publication", "availability", "history"]) {
    source.clocks[name] = "2026-11-05T21:00:00Z";
    source.limitations[name] = { status: "supplied", clock: "2026-11-05T21:00:00Z" };
  }
  return source;
};

/** A receipt the owner explicitly withheld. */
const withheldReceiptCompanion = () => {
  const source = structuredClone(complete) as unknown as CompanionDoc;
  source.receipt = null;
  source.diagnostics.receipt_withheld = true;
  return source;
};

test("a partial companion says so plainly and keeps every published value", async ({ page }) => {
  await prepare(page, { companion: partialCompanion() }); await page.goto(detail);
  const companion = exact(page);
  await expect(companion).toBeVisible();
  // A partial packet is not an unavailable one, and nothing is called withheld that is missing.
  await expect(companion).toContainText("Some exact-session measurements are missing");
  await expect(companion).not.toContainText("Exact-session returns are unavailable");
  await expect(companion).not.toContainText("The owner withheld every measurement for this cut.");
  // The withheld value keeps its own reason and the published one survives beside it.
  await expect(exactWindow(page, "63").locator('[data-testid="sector-exact-absolute"]')).toHaveText("—");
  await expect(exactWindow(page, "63").locator('[data-testid="sector-exact-relative"]')).toHaveText("-20.30%");
  await expect(exactWindow(page, "63")).toContainText("The source supplied no value for this measurement.");
  await expect(exactWindow(page, "5").locator('[data-testid="sector-exact-absolute"]')).toHaveText("-0.70%");
  await noOverflow(page);
});

test("a supplied owner clock is shown and is not denied", async ({ page }) => {
  await prepare(page, { companion: suppliedClockCompanion() }); await page.goto(detail);
  const companion = exact(page);
  await expect(companion).toBeVisible();
  // The summary no longer denies a clock the owner did supply.
  await expect(companion).not.toContainText("The original availability, publication and history times were not supplied");
  await expect(companion).toContainText("A supplied clock does not establish verified freshness");
  // The owner's own clock text is preserved unchanged.
  await expect(companion).toContainText("2026-11-05T21:00:00Z");
  // The separate limitations are untouched by a supplied clock.
  await expect(companion).toContainText("The owner supplied no freshness receipt.");
  await expect(companion).toContainText("The point-in-time admission was not supplied.");
  await expect(companion).toContainText("The native revision selection was not supplied.");
  await noOverflow(page);
});

test("an unsupplied receipt is not called a withheld receipt", async ({ page }) => {
  await prepare(page, { companion: complete }); await page.goto(detail);
  const source = exact(page).getByTestId("sector-exact-source");
  await source.locator("summary").click();
  await expect(source).toContainText("The owner supplied no receipt.");
  await expect(source).not.toContainText("The owner withheld its receipt.");
  await noOverflow(page);
});

test("an explicitly withheld receipt is named as withheld", async ({ page }) => {
  await prepare(page, { companion: withheldReceiptCompanion() }); await page.goto(detail);
  const source = exact(page).getByTestId("sector-exact-source");
  await source.locator("summary").click();
  await expect(source).toContainText("The owner withheld its receipt.");
  await expect(source).not.toContainText("The owner supplied no receipt.");
  await noOverflow(page);
});

for (const language of ["en", "zh"] as const) {
  test("the companion follows the workspace's real theme control: " + language, async ({ page }) => {
    await prepare(page, { language, companion: complete });
    await page.goto(detail);
    // The initial render is dark/Discover. Wait for URL adoption and admitted
    // selected-sector evidence before exercising the mounted owner's control.
    await expect(root(page)).toHaveAttribute("data-sector-workspace", "detail");
    await expect(root(page)).toHaveAttribute("data-sector-theme", "dark");
    await expect(exact(page)).toBeVisible();
    const absolute = exactWindow(page, "63").locator('[data-testid="sector-exact-absolute"]');
    await expect(absolute).toHaveText("-8.85%");

    for (const theme of ["light", "dark"] as const) {
      const name = language === "zh"
        ? (theme === "light" ? "使用浅色视图" : "使用深色视图")
        : (theme === "light" ? "Use light view" : "Use dark view");
      const toggle = root(page).getByRole("button", { name, exact: true });
      await expect(toggle).toHaveCount(1);
      await expect(toggle).toBeEnabled();
      await toggle.click();
      await expect(root(page)).toHaveAttribute("data-sector-theme", theme);
      await expect(root(page)).toHaveAttribute("data-sector-workspace", "detail");
      await expect(exact(page)).toBeVisible();
      await expect(absolute).toHaveText("-8.85%");
      const url = new URL(page.url());
      expect(url.pathname).toBe("/discover");
      expect(url.searchParams.get("tab")).toBe("sectors");
      expect(url.searchParams.get("sectorWorkspace")).toBe("detail");
      expect(url.searchParams.get("sector")).toBe("xlk");
      expect(url.searchParams.get("group")).toBe("semiconductors");
      expect(url.searchParams.get("sectorTheme")).toBe(theme);
      await noOverflow(page);
    }
  });
}

for (const [language, theme] of [["en", "light"], ["zh", "dark"]] as const) {
  test(`the rendered companion is receipted: ${language} ${theme}`, async ({ page }, info) => {
    await prepare(page, { language, companion: complete });
    await page.goto(`${detail}&sectorTheme=${theme}`);
    // The theme owner is the workspace's own, and it says which theme it applied.
    await expect(root(page)).toHaveAttribute("data-sector-theme", theme);
    await expect(exact(page)).toBeVisible();
    const paths: string[] = [];
    paths.push(await receipt(page, info, `exact-overview-${language}-${theme}`, exact(page)));
    await exact(page).getByTestId("sector-exact-source").locator("summary").click();
    paths.push(await receipt(page, info, `exact-source-${language}-${theme}`,
      exact(page).getByTestId("sector-exact-source")));
    await page.setViewportSize({ width: 320, height: 800 });
    paths.push(await receipt(page, info, `exact-narrow-320-${language}-${theme}`, exact(page)));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
      .toBeLessThanOrEqual(1);
    await info.attach(`exact-receipt-paths-${language}-${theme}`, {
      body: JSON.stringify(paths, null, 1), contentType: "application/json" });
  });
}
