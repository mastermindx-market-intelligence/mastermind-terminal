import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { isolateWatchlistStore } from "./watchlistStore";
import { sectorFixture } from "./fixtures/sector-company-v3";
import dossier from "../lib/__tests__/fixtures/sector_dossiers_v1.json";
import outage from "../lib/__tests__/fixtures/sector_dossiers_unavailable_v1.json";

/**
 * Persistent Sector Leadership → Portfolio continuity.
 *
 * The selected sector's journey: Discover or Rotation opens the research depth, the depth
 * offers "View in Portfolio", and the Portfolio lands on its Risk section with the same
 * selected native sector ETF, the same owner evidence and the same exact selection to return
 * to. The journey is read-only end to end: it issues GETs and no write of any kind.
 *
 * Every owner feed comes from the shared fixture, and the sector feed carries the owner's own
 * dossier document exactly as the producer delivers it — no new gateway and no new route. The
 * Portfolio's own book is written through the real route, so what the page renders is the
 * product's own read of the product's own store.
 */
test.setTimeout(150_000);

/** The owner's own sector rows. The dossier identifies a sector by its ETF proxy ticker, so
 * the owner row and the cohort row are the same identity here. */
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

/** A synthetic heatmap population, so the Discover representations have company rows to open. */
const tiles = ["AAA", "BBB", "CCC", "DDD", "EEE"].map((ticker, index) => ({ t: ticker,
  name: `Synthetic ${ticker}`, sector: "Technology", industry: index < 3 ? "Hardware" : "Software",
  size: (500 - index * 80) * 1e9, perf: { "1D": index, "1M": index + 1 } }));

const MANIFEST = {
  symbols: {
    XLK: { name: "Technology Select Sector SPDR", zh: "科技行业SPDR", last: 120, chg: 1, currency: "USD" },
    XLF: { name: "Financial Select Sector SPDR", zh: "金融行业SPDR", last: 42, chg: -0.2, currency: "USD" },
    NVDA: { name: "NVIDIA", zh: "英伟达", last: 175, chg: 1.2, currency: "USD" },
  },
};
const QUOTES = { quotes: { XLK: { last: 120, chg: 1, currency: "USD" }, XLF: { last: 42, chg: -0.2, currency: "USD" } } };

type SectorFeedOptions = {
  language?: string;
  /** The owner's measured_read document. `null` serves a feed with no dossier at all. */
  read?: unknown;
  /** The owner refuses the read. */
  denied?: boolean;
  /** The transport fails before any answer. */
  offline?: boolean;
  /** Hold the first sector read so a late answer can be released late. */
  holdFirst?: { release: () => void } | null;
};

/** Language, owner feeds, the Portfolio's own reads and the identity. Installed before any
 * navigation, so the journey sees exactly the owner's own bytes. */
async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined,
  options: SectorFeedOptions = {}) {
  await isolateWatchlistStore(page, testInfo, baseURL);
  await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", url: baseURL ?? "http://127.0.0.1:3108" }]);
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
    if (options.denied) return route.fulfill({ status: 401, json: { data: null, receipt: {
      source, path: "/sectordata/sector_central.json", status: "access", asOf: null,
      observedAt: null, stale: false, contentHash: null } } });
    if (options.offline) return route.abort("failed");
    if (options.holdFirst && sectorReads === 1) await new Promise<void>(resolve => { options.holdFirst!.release = resolve; });
    const read = options.read === undefined ? dossier : options.read;
    const data = read === null ? { as_of: "2026-10-09", sectors }
      : { as_of: "2026-10-09", sectors, measured_read: read };
    try {
      return await route.fulfill({ status: 200, json: { data, receipt: {
        source, path: "/sectordata/sector_central.json", status: "ready", asOf: "2026-10-09",
        observedAt: "2026-10-09T21:00:00Z", stale: false, contentHash: "sha256:transport" } } });
    } catch {
      // A retired read is aborted by the component that owned it; the answer has nowhere to go.
      return undefined;
    }
  });
  await page.route("**/data/manifest.json", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({ json: QUOTES }));
  await page.route("**/api/portfolio-brief", (route) =>
    route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ tier: "free" }) }));
}

type Draft = { ticker: string; shares?: string | number | null; entryPrice?: string | number | null;
  entryCurrency?: string | null };

/** Create a position through the product's own route, as the signed-in fixture user. */
async function seed(page: Page, draft: Draft) {
  const response = await page.request.post("/api/portfolio", { data: { action: "create", ...draft } });
  expect(response.ok(), `seeding ${draft.ticker} failed: ${response.status()}`).toBe(true);
  return (await response.json()).position as { id: string; ticker: string };
}

async function closeLot(page: Page, id: string) {
  const response = await page.request.post("/api/portfolio", { data: { action: "close", id } });
  expect(response.ok(), `closing ${id} failed: ${response.status()}`).toBe(true);
}

/** Flip the store fault on/off for every subsequent server read AND route call. */
async function setReadFault(page: Page, on: boolean, baseURL: string | undefined) {
  await page.context().addCookies([{
    name: "mm_e2e_fault", value: on ? "positions_read" : "", url: baseURL ?? "http://127.0.0.1:3108",
  }]);
}

const sectorRoot = (page: Page) => page.getByTestId("sector-intelligence");
const viewLink = (page: Page) => page.getByTestId("sector-view-in-portfolio");
const block = (page: Page) => page.getByTestId("portfolio-sector-context");
const dossierPanel = (page: Page) => page.getByTestId("sector-leadership-dossier");
const weight = (page: Page) => page.getByTestId("portfolio-sector-weight");
const unavailable = (page: Page) => page.getByTestId("portfolio-sector-weight-unavailable");
const noRecord = (page: Page) => page.getByTestId("portfolio-sector-no-record");
const backLink = (page: Page) => page.getByTestId("portfolio-sector-context-return");
const riskTab = (page: Page) => page.locator("#portfolio-tab-risk");

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(1);
}

/** The Portfolio address an admitted context carries. */
const portfolioAddress = (etf: string, snapshot = "sectorWorkspace=discover") =>
  `/portfolio?sector=${etf}&sectorReturn=${encodeURIComponent(snapshot)}`;

/** Open the sector research depth from the Discover table. */
async function openDepth(page: Page) {
  await sectorRoot(page).getByTestId("company-table-selection")
    .getByRole("button", { name: "Open sector intelligence" }).click();
  await expect(sectorRoot(page)).toHaveAttribute("data-sector-workspace", "detail");
}

test("Discover → Portfolio Risk shows the selected sector, its holding and the exact return", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seed(page, { ticker: "XLK", shares: "10", entryPrice: "100", entryCurrency: "USD" });
  await seed(page, { ticker: "XLF", shares: "10", entryPrice: "100", entryCurrency: "USD" });

  const writes: string[] = [];
  const reads: string[] = [];
  page.on("request", request => {
    const method = request.method();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") writes.push(`${method} ${request.url()}`);
    else reads.push(request.url());
  });

  await page.goto("/discover?tab=sectors&sectorWorkspace=discover&sectorDiscoveryMode=table");
  await expect(sectorRoot(page)).toHaveAttribute("data-sector-workspace", "discover");
  await openDepth(page);
  await expect(dossierPanel(page)).toContainText("Technology · XLK");

  const action = viewLink(page);
  await expect(action).toBeVisible();
  const href = await action.getAttribute("href");
  expect(href).toContain("/portfolio?sector=XLK");
  expect(href).toContain("sectorReturn=");

  await action.click();
  await expect(page).toHaveURL(/\/portfolio\?sector=XLK/);
  // The Portfolio lands on its Risk section, not on its overview.
  await expect(riskTab(page)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#portfolio-panel-risk")).toBeVisible();
  await expect(page.locator("#portfolio-panel-overview")).toBeHidden();

  await expect(block(page)).toHaveAttribute("data-etf", "XLK");
  await expect(dossierPanel(page)).toContainText("Technology · XLK");
  await expect(dossierPanel(page)).toContainText("-0.50%");
  await expect(weight(page)).toContainText("50.0% of eligible recorded cost");
  await expect(page.getByTestId("portfolio-sector-weight-coverage"))
    .toContainText("1 of 2 eligible lots · USD 2,000.00 recorded cost");

  // The admitted return goes back to the exact Discover selection.
  const back = backLink(page);
  expect(await back.getAttribute("href")).toContain("/discover?tab=sectors");
  await back.click();
  await expect(sectorRoot(page)).toHaveAttribute("data-sector-workspace", "discover");
  await expect(sectorRoot(page)).toHaveAttribute("data-sector-theme", "dark");

  // The whole journey was read-only. The reads are asserted too, so the empty write list
  // cannot be a listener that never fired.
  expect(writes).toEqual([]);
  expect(reads.some(url => url.includes("/api/sector-intelligence?source=sector"))).toBe(true);
  expect(reads.some(url => url.includes("/api/portfolio"))).toBe(true);
  expect(reads.every(url => !/\/api\/portfolio\b.*(create|update|close|reopen|delete)/.test(url))).toBe(true);
});

test("Rotation → Portfolio Risk returns to the exact rotation selection", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seed(page, { ticker: "XLK", shares: "4", entryPrice: "250", entryCurrency: "USD" });

  await page.goto("/discover?tab=sectors&sectorWorkspace=rotation");
  await expect(sectorRoot(page)).toHaveAttribute("data-sector-workspace", "rotation");
  await sectorRoot(page).getByTestId("rotation-inspector")
    .getByRole("button", { name: "Open sector research" }).click();
  await expect(sectorRoot(page)).toHaveAttribute("data-sector-workspace", "detail");

  await viewLink(page).click();
  await expect(page).toHaveURL(/\/portfolio\?sector=XLK/);
  await expect(block(page)).toHaveAttribute("data-etf", "XLK");
  await expect(weight(page)).toContainText("100.0% of eligible recorded cost");

  const back = backLink(page);
  expect(await back.getAttribute("href")).toContain("sectorWorkspace=rotation");
  await back.click();
  await expect(sectorRoot(page)).toHaveAttribute("data-sector-workspace", "rotation");
});

test("the admitted filters and selection survive the round trip", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  // The Rotation list is the incumbent's own selection surface: a real click, a real filter,
  // and a selection the admitted snapshot has to carry.
  await page.goto("/discover?tab=sectors&sectorWorkspace=rotation&sectorRotationMode=list");
  await expect(sectorRoot(page)).toHaveAttribute("data-sector-workspace", "rotation");
  await sectorRoot(page).locator('[data-sector-rotation-row="xle"]').click();
  await sectorRoot(page).getByTestId("rotation-inspector")
    .getByRole("button", { name: "Open sector research" }).click();
  await expect(sectorRoot(page)).toHaveAttribute("data-sector-workspace", "detail");
  await expect(dossierPanel(page)).toContainText("Energy · XLE");

  await viewLink(page).click();
  await expect(page).toHaveURL(/\/portfolio\?sector=XLE/);
  await expect(block(page)).toHaveAttribute("data-etf", "XLE");

  const back = backLink(page);
  const href = await back.getAttribute("href");
  expect(href).toContain("sector=xle");
  expect(href).toContain("sectorRotationMode=list");
  await back.click();
  await expect(sectorRoot(page)).toHaveAttribute("data-sector-workspace", "rotation");
  await expect(sectorRoot(page).locator('[data-sector-rotation-row="xle"]')).toHaveAttribute("aria-pressed", "true");
});

test("Back, Forward and a reload keep the admitted context", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seed(page, { ticker: "XLK", shares: "10", entryPrice: "100", entryCurrency: "USD" });
  await page.goto("/discover?tab=sectors&sectorWorkspace=discover&sectorDiscoveryMode=table");
  await openDepth(page);
  await viewLink(page).click();
  await expect(block(page)).toHaveAttribute("data-etf", "XLK");

  // A reload of the Portfolio keeps the admitted context and the Risk section.
  await page.reload();
  await expect(riskTab(page)).toHaveAttribute("aria-selected", "true");
  await expect(block(page)).toHaveAttribute("data-etf", "XLK");
  await expect(dossierPanel(page)).toContainText("Technology · XLK");

  // Back reaches the depth, Forward reaches the Portfolio again.
  await page.goBack();
  await expect(sectorRoot(page)).toHaveAttribute("data-sector-workspace", "detail");
  await page.goForward();
  await expect(block(page)).toHaveAttribute("data-etf", "XLK");
  await expect(riskTab(page)).toHaveAttribute("aria-selected", "true");
});

test("the direct holding counts exact open records only", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seed(page, { ticker: "XLK", shares: "10", entryPrice: "100", entryCurrency: "USD" });
  await seed(page, { ticker: "XLK", shares: "5", entryPrice: "200", entryCurrency: "USD" });
  await seed(page, { ticker: "XLF", shares: "10", entryPrice: "100", entryCurrency: "USD" });
  await page.goto(portfolioAddress("XLK"));
  await expect(weight(page)).toContainText("66.7% of eligible recorded cost");
  await expect(page.getByTestId("portfolio-sector-weight-coverage"))
    .toContainText("2 of 3 eligible lots · USD 3,000.00 recorded cost");
  await expect(page.getByTestId("portfolio-sector-open-records")).toContainText("2 open records for XLK");
});

test("a closed lot is not a holding and a technology stock is not a sector exposure", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  const closed = await seed(page, { ticker: "XLK", shares: "10", entryPrice: "100", entryCurrency: "USD" });
  await closeLot(page, closed.id);
  await seed(page, { ticker: "NVDA", shares: "10", entryPrice: "100", entryCurrency: "USD" });
  await page.goto(portfolioAddress("XLK"));
  await expect(noRecord(page)).toContainText("No directly held ETF record for XLK");
  await expect(page.getByTestId("portfolio-sector-no-record-hint")).toContainText("do not imply XLK exposure");
  await expect(weight(page)).toHaveCount(0);
});

test("an empty book is a verified absence, not a missing capability", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await page.goto(portfolioAddress("XLK"));
  await expect(noRecord(page)).toContainText("No directly held ETF record for XLK");
  await expect(weight(page)).toHaveCount(0);
  await expect(page.locator("[data-portfolio='w5-positions']")).toHaveAttribute("data-portfolio-state", "empty");
});

test("an unreadable and a stale book withhold the number", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seed(page, { ticker: "XLK", shares: "10", entryPrice: "100", entryCurrency: "USD" });

  // The store goes dark: the book is unreadable, so nothing about it is claimed.
  await setReadFault(page, true, baseURL);
  await page.goto(portfolioAddress("XLK"));
  await expect(page.getByTestId("portfolio-unreadable")).toBeVisible();
  await expect(unavailable(page)).toHaveAttribute("data-gap", "unreadable");
  await expect(weight(page)).toHaveCount(0);
  await expect(noRecord(page)).toHaveCount(0);
  // An unreadable book proves nothing about what is held — not even a count of zero.
  await expect(page.getByTestId("portfolio-sector-open-records")).toHaveCount(0);

  // The store comes back, then fails only on the client's own re-read: the book is stale.
  await setReadFault(page, false, baseURL);
  await page.goto(portfolioAddress("XLK"));
  await expect(weight(page)).toContainText("100.0% of eligible recorded cost");
  await setReadFault(page, true, baseURL);
  await page.getByRole("button", { name: "Refresh holdings", exact: true }).click();
  await expect(page.locator("[data-portfolio] [role=status]").first()).toContainText("last");
  await expect(unavailable(page)).toHaveAttribute("data-gap", "stale");
  await expect(weight(page)).toHaveCount(0);
});

test("an unknown or mixed currency, a missing basis and an overflow withhold the number", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seed(page, { ticker: "XLK", shares: "10", entryPrice: "100" });
  await seed(page, { ticker: "XLF", shares: "10", entryPrice: "100", entryCurrency: "USD" });
  await page.goto(portfolioAddress("XLK"));
  await expect(unavailable(page)).toHaveAttribute("data-gap", "currency_unknown");
  await expect(weight(page)).toHaveCount(0);
});

test("a mixed currency, a missing basis and an overflow withhold the number", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seed(page, { ticker: "XLK", shares: "10", entryPrice: "100", entryCurrency: "HKD" });
  await seed(page, { ticker: "XLF", shares: "10", entryPrice: "100", entryCurrency: "USD" });
  await page.goto(portfolioAddress("XLK"));
  await expect(unavailable(page)).toHaveAttribute("data-gap", "currency_mismatch");
  await expect(weight(page)).toHaveCount(0);
});

test("a missing basis withholds the number instead of renormalizing", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seed(page, { ticker: "XLK", shares: null, entryPrice: "100", entryCurrency: "USD" });
  await seed(page, { ticker: "XLF", shares: "10", entryPrice: "100", entryCurrency: "USD" });
  await page.goto(portfolioAddress("XLK"));
  await expect(unavailable(page)).toHaveAttribute("data-gap", "missing_basis");
  await expect(weight(page)).toHaveCount(0);
});

test("an overflowing recorded cost withholds the number", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seed(page, { ticker: "XLK", shares: 1e308, entryPrice: 1e10, entryCurrency: "USD" });
  await seed(page, { ticker: "XLF", shares: "10", entryPrice: "100", entryCurrency: "USD" });
  await page.goto(portfolioAddress("XLK"));
  await expect(unavailable(page)).toHaveAttribute("data-gap", "amount_overflow");
  await expect(weight(page)).toHaveCount(0);
});

test("the owner's own dossier states reach the Portfolio unchanged", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, { read: outage });
  await page.goto(portfolioAddress("XLK"));
  await expect(dossierPanel(page)).toContainText("Leadership evidence is unavailable");
  await expect(page.locator('[data-testid="sector-dossier-metric"][data-window="21"] strong')).toHaveText("—");
  await expect(dossierPanel(page)).not.toContainText("-0.50%");
  await dossierPanel(page).getByTestId("sector-dossier-compare").locator("summary").click();
  await expect(dossierPanel(page).locator("tbody tr")).toHaveCount(11);
  await expect(dossierPanel(page).locator("tbody")).not.toContainText("source_session_missing_or_invalid");
});

test("an absent dossier stays bounded and claims no figure", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, { read: {} });
  await page.goto(portfolioAddress("XLK"));
  await expect(dossierPanel(page)).toContainText("Leadership evidence is not available");
  await expect(page.locator('[data-testid="sector-dossier-metric"]')).toHaveCount(0);
});

test("an invalid owner document stays bounded and claims no figure", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, { read: {
    schema: "leadership_rotation_context.measured_group_read/v1", status: "partial",
    sector_dossiers: { schema: "leadership_rotation_context.sector_dossiers/v2" } } });
  await page.goto(portfolioAddress("XLK"));
  await expect(dossierPanel(page)).toContainText("Leadership evidence could not be verified");
  await expect(page.locator('[data-testid="sector-dossier-metric"]')).toHaveCount(0);
});

test("a withdrawn access and a failed transport clear every figure", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, { denied: true });
  await page.goto(portfolioAddress("XLK"));
  await expect(dossierPanel(page)).toContainText("Leadership evidence requires access");
  await expect(page.locator('[data-testid="sector-dossier-metric"]')).toHaveCount(0);
});

test("a failed transport is one bounded state, not a figure", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, { offline: true });
  await page.goto(portfolioAddress("XLK"));
  await expect(dossierPanel(page)).toContainText("Leadership evidence could not be loaded");
  await expect(page.locator('[data-testid="sector-dossier-metric"]')).toHaveCount(0);
});

test("a late answer for a retired selection never reaches the screen", async ({ page, baseURL }, testInfo) => {
  const hold: { release: () => void } = { release: () => {} };
  await prepare(page, testInfo, baseURL, { holdFirst: hold });
  await page.goto(portfolioAddress("XLK"));
  await expect(block(page)).toHaveAttribute("data-etf", "XLK");

  // The selection changes while the first answer is still in flight.
  await page.evaluate(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("sector", "XLE");
    window.history.pushState({}, "", url.toString());
    window.dispatchEvent(new Event("mmx:shell-location"));
  });
  await expect(block(page)).toHaveAttribute("data-etf", "XLE");

  // The retired answer arrives late and must paint nothing.
  hold.release();
  await page.waitForTimeout(500);
  await expect(block(page)).toHaveAttribute("data-etf", "XLE");
  await expect(dossierPanel(page)).not.toContainText("Technology · XLK");
});

test("the section localizes fully in Chinese and never leaks English", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, { language: "zh" });
  await seed(page, { ticker: "XLK", shares: "10", entryPrice: "100", entryCurrency: "USD" });
  await page.goto(portfolioAddress("XLK"));
  await expect(block(page)).toContainText("所选板块");
  await expect(page.getByTestId("portfolio-sector-holding")).toContainText("您直接持有的 XLK");
  await expect(weight(page)).toContainText("占符合条件记录成本的 100.0%");
  await expect(block(page)).not.toContainText("Selected sector");
  await expect(block(page)).not.toContainText("Your direct holding");
});

test("the block is reachable by keyboard and fits the narrowest supported width", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seed(page, { ticker: "XLK", shares: "10", entryPrice: "100", entryCurrency: "USD" });
  await page.goto(portfolioAddress("XLK"));
  await expect(block(page)).toBeVisible();

  const back = backLink(page);
  await back.focus();
  await expect(back).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(sectorRoot(page)).toHaveAttribute("data-sector-workspace", "discover");

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(portfolioAddress("XLK"));
  await expect(block(page)).toBeVisible();
  await expect(weight(page)).toBeVisible();
  await noOverflow(page);
});

/** Operation-specific screenshot receipt, written outside the source tree. */
async function receipt(page: Page, info: TestInfo, name: string, target?: ReturnType<Page["locator"]>) {
  const path = `${process.env.PSL_RECEIPT_DIR || "/tmp/psl-receipts"}/${info.project.name}-${name}.png`;
  await (target || block(page)).scrollIntoViewIfNeeded();
  const png = await page.screenshot({ animations: "disabled" });
  await page.screenshot({ path, animations: "disabled" });
  await info.attach(`sector-portfolio-${info.project.name}-${name}`, { body: png, contentType: "image/png" });
  return path;
}

for (const [language, theme] of [["en", "dark"], ["zh", "light"]] as const) {
  test(`the rendered journey is receipted: ${language}, sector theme ${theme}`, async ({ page, baseURL }, info) => {
    await prepare(page, info, baseURL, { language });
    await seed(page, { ticker: "XLK", shares: "10", entryPrice: "100", entryCurrency: "USD" });
    await seed(page, { ticker: "XLF", shares: "10", entryPrice: "100", entryCurrency: "USD" });
    await page.goto(portfolioAddress("XLK"));
    await expect(block(page)).toBeVisible();
    const paths: string[] = [];
    // Portfolio currently has its incumbent default appearance; the selected
    // sector theme below is not a claim about Portfolio's own presentation.
    paths.push(await receipt(page, info, `risk-${language}-default`));

    // The action that opens the journey, in the sector detail it belongs to.
    await page.goto(`/discover?tab=sectors&sectorWorkspace=discover&sectorDiscoveryMode=table&sectorTheme=${theme}`);
    await expect(sectorRoot(page)).toHaveAttribute("data-sector-theme", theme);
    await sectorRoot(page).locator('[data-sector-return-focus="table-open-xlk"]').click();
    await expect(sectorRoot(page)).toHaveAttribute("data-sector-workspace", "detail");
    await expect(viewLink(page)).toBeVisible();
    paths.push(await receipt(page, info, `sector-depth-${language}-${theme}`,
      sectorRoot(page).getByTestId("sector-detail-depth")));
    await page.goto(portfolioAddress("XLK"));
    await expect(block(page)).toBeVisible();
    await page.setViewportSize({ width: 320, height: 800 });
    paths.push(await receipt(page, info, `narrow-320-${language}-default`));
    await noOverflow(page);
    await info.attach(`receipt-paths-${language}-${theme}`, {
      body: JSON.stringify(paths, null, 1), contentType: "application/json" });
  });
}
