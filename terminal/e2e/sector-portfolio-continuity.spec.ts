import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { isolateWatchlistStore } from "./watchlistStore";
import { sectorFixture } from "./fixtures/sector-company-v3";
import dossier from "../lib/__tests__/fixtures/sector_dossiers_v1.json";
import outage from "../lib/__tests__/fixtures/sector_dossiers_unavailable_v1.json";
import complete from "../lib/__tests__/fixtures/sector_window_measurements.complete.v1.json";
import companionUnavailable from "../lib/__tests__/fixtures/sector_window_measurements.unavailable.v1.json";
import { nativeGenerationFixture, syntheticExactParent as nov5Parent } from "../lib/__tests__/fixtures/sectorNativeGeneration";

/** The clearly labelled synthetic November 5 parent. It carries the producer's own exact-session
 * companion and no legacy dossier, so the companion is proved on its own in the Portfolio. It is
 * NOT the October 9 legacy fixture with its dates moved. */
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
  /** The producer's exact-session companion, inside a synthetic November 5 parent. */
  companion?: unknown;
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
    if (source !== "sector" && source !== "generation") return sectorFixture(route);
    if (source === "generation") sectorReads += 1;
    const path = source === "generation" ? "/api/sector-generation?audience=preview" : "/sectordata/sector_central.json";
    if (source === "generation" && options.denied) return route.fulfill({ status: 401, json: { data: null, receipt: {
      source, path, status: "access", asOf: null,
      observedAt: null, stale: false, contentHash: null } } });
    if (source === "generation" && options.offline) return route.abort("failed");
    if (source === "generation" && options.holdFirst && sectorReads === 1) await new Promise<void>(resolve => { options.holdFirst!.release = resolve; });
    const read = options.companion !== undefined ? nov5Parent(options.companion)
      : options.read === undefined ? dossier : options.read;
    const session = options.companion !== undefined ? "2026-11-05" : "2026-10-09";
    const data = read === null ? { as_of: session, sectors }
      : { as_of: session, sectors, measured_read: read };
    try {
      return await route.fulfill({ status: 200, json: { data: source === "generation" ? nativeGenerationFixture(data) : data, receipt: {
        source, path, status: "ready", asOf: session,
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
  expect(reads.some(url => url.includes("/api/sector-intelligence?source=generation"))).toBe(true);
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

test("a parent without native generation clocks cannot revive a static Portfolio dossier", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, { read: outage });
  await page.goto(portfolioAddress("XLK"));
  await expect(dossierPanel(page)).toHaveAttribute("data-state", "invalid");
  await expect(dossierPanel(page)).toContainText("Leadership evidence could not be verified");
  await expect(page.locator('[data-testid="sector-dossier-metric"][data-window="21"] strong')).toHaveCount(0);
  await expect(dossierPanel(page)).not.toContainText("-0.50%");
  await expect(dossierPanel(page).getByTestId("sector-dossier-compare")).toHaveCount(0);
});

test("an absent dossier stays bounded and claims no figure", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, { read: null });
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

/* -------------------------------------------------------------------------- *
 * The exact-session companion inside the Portfolio.
 *
 * The Portfolio reads the same owner feed again under this owner's own identity. The companion
 * is a separate document from the legacy dossier, and it is read the same way.
 * -------------------------------------------------------------------------- */

test("Portfolio Risk shows the fresh same-ETF companion and the exact opener and filter return", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, { companion: complete });
  await seed(page, { ticker: "XLE", shares: "10", entryPrice: "100", entryCurrency: "USD" });
  await page.goto("/discover?tab=sectors&sectorWorkspace=rotation&sectorRotationMode=list");
  await sectorRoot(page).locator('[data-sector-rotation-row="xle"]').click();
  await sectorRoot(page).getByTestId("rotation-inspector")
    .getByRole("button", { name: "Open sector research" }).click();
  await expect(sectorRoot(page)).toHaveAttribute("data-sector-workspace", "detail");
  await viewLink(page).click();
  await expect(page).toHaveURL(/\/portfolio\?sector=XLE/);
  await expect(block(page)).toHaveAttribute("data-etf", "XLE");
  // The Portfolio reads the owner feed again: the companion is fresh and for the same ETF.
  const companion = page.getByTestId("sector-exact-window-returns");
  await expect(companion).toBeVisible();
  await expect(companion).toContainText("Energy · XLE");
  await expect(companion.locator('[data-testid="sector-exact-window"][data-window="63"] [data-testid="sector-exact-absolute"]'))
    .toHaveText("+33.00%");
  await expect(companion.locator('[data-testid="sector-exact-window"][data-window="63"] [data-testid="sector-exact-relative"]'))
    .toHaveText("+16.28%");
  // The exact opener and its filter come back.
  const back = backLink(page);
  const href = await back.getAttribute("href");
  expect(href).toContain("sector=xle");
  expect(href).toContain("sectorRotationMode=list");
  await back.click();
  await expect(sectorRoot(page)).toHaveAttribute("data-sector-workspace", "rotation");
  await expect(sectorRoot(page).locator('[data-sector-rotation-row="xle"]')).toHaveAttribute("aria-pressed", "true");
  await noOverflow(page);
});

test("a valid all-null companion block stays visible in the Portfolio", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, { companion: companionUnavailable });
  await page.goto(portfolioAddress("XLK"));
  const companion = page.getByTestId("sector-exact-window-returns");
  await expect(companion).toBeVisible();
  await expect(companion).toContainText("Exact-session returns are unavailable");
  // No prior positive figure survives the refusal.
  await expect(companion).not.toContainText("-8.85%");
  await companion.getByTestId("sector-exact-compare").locator("summary").click();
  await expect(companion.locator("tbody tr")).toHaveCount(11);
  await expect(companion).toContainText("The source panel holds sessions after the end of the measurement cut.");
});

test("a withdrawn access clears the companion in the Portfolio too", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL, { companion: complete, denied: true });
  await page.goto(portfolioAddress("XLK"));
  await expect(dossierPanel(page)).toContainText("Leadership evidence requires access");
  await expect(page.getByTestId("sector-exact-window-returns")).toHaveCount(0);
});

test("a late answer for a retired selection never paints a companion figure", async ({ page, baseURL }, testInfo) => {
  const hold: { release: () => void } = { release: () => {} };
  await prepare(page, testInfo, baseURL, { companion: complete, holdFirst: hold });
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
  await expect(page.getByTestId("sector-exact-window-returns")).not.toContainText("Technology · XLK");
});

/* -------------------------------------------------------------------------- *
 * The corrected copy, in the Portfolio.
 *
 * The Portfolio reads the same owner feed under the same owner's identity, so the companion's
 * copy has to be accurate here too. Each case serves a clearly labelled synthetic companion
 * document derived from the canonical producer document.
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
// Exact 43b1cf owner output: absolute-percent overflow, finite relative wealth.
const partialCompanion = (): CompanionDoc => JSON.parse("{\"schema\":\"leadership_rotation_context.sector_window_measurements/v1\",\"status\":\"partial\",\"reason\":null,\"units\":\"pct\",\"price_basis\":\"total_return\",\"benchmark\":\"SPY\",\"cohort_id\":\"us_sectors_11\",\"population\":\"eleven_sector_etf_proxies\",\"source_session\":\"2026-11-05\",\"end_session\":\"2026-11-05\",\"windows_sessions\":[5,20,63],\"endpoint_definition\":\"Endpoint return: P(T)/P(S_N) - 1, where T is the explicit end session and S_N is the canonical US session exactly N positions before T, so a 5-session return spans 6 session endpoints. Relative wealth is (1+R_group)/(1+R_benchmark) - 1 -- a wealth ratio, never a return difference. Interior gaps never move an endpoint; they are disclosed as observed coverage. Prices are strictly positive, finite, total-return adjusted closes read at the two endpoints only.\",\"clocks\":{\"publication\":null,\"availability\":null,\"correction\":null,\"history\":null},\"source_roots\":[],\"receipt\":null,\"limitations\":{\"availability\":{\"status\":\"unknown\",\"reason\":\"owner_availability_clock_not_supplied\"},\"publication\":{\"status\":\"unknown\",\"reason\":\"owner_publication_clock_not_supplied\"},\"corrections\":{\"status\":\"unavailable\",\"reason\":\"native_revision_selection_not_supplied\"},\"history\":{\"status\":\"unknown\",\"reason\":\"owner_history_clock_not_supplied\"},\"freshness\":{\"status\":\"unverified\",\"reason\":\"owner_freshness_receipt_not_supplied\"},\"point_in_time\":{\"status\":\"not_qualified\",\"reason\":\"point_in_time_admission_not_supplied\"}},\"windows\":{\"5\":{\"window_sessions\":5,\"status\":\"available\",\"start_session\":\"2026-10-29\",\"end_session\":\"2026-11-05\",\"benchmark_return_pct\":-99.408284,\"benchmark_null_reason\":null,\"benchmark_coverage\":{\"observed_n\":6,\"expected_n\":6,\"ratio\":1.0},\"null_reason\":null},\"20\":{\"window_sessions\":20,\"status\":\"available\",\"start_session\":\"2026-10-08\",\"end_session\":\"2026-11-05\",\"benchmark_return_pct\":-99.350649,\"benchmark_null_reason\":null,\"benchmark_coverage\":{\"observed_n\":21,\"expected_n\":21,\"ratio\":1.0},\"null_reason\":null},\"63\":{\"window_sessions\":63,\"status\":\"partial\",\"start_session\":\"2026-08-07\",\"end_session\":\"2026-11-05\",\"benchmark_return_pct\":1e+307,\"benchmark_null_reason\":null,\"benchmark_coverage\":{\"observed_n\":64,\"expected_n\":64,\"ratio\":1.0},\"null_reason\":null}},\"groups\":[{\"group_id\":\"XLB\",\"name_en\":\"Materials\",\"name_zh\":\"\\u539f\\u6750\\u6599\",\"windows\":{\"5\":{\"status\":\"available\",\"absolute_return_pct\":3.164557,\"relative_wealth_pct\":17334.810127,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":6,\"expected_n\":6,\"ratio\":1.0}},\"20\":{\"status\":\"available\",\"absolute_return_pct\":13.986014,\"relative_wealth_pct\":17453.846154,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":21,\"expected_n\":21,\"ratio\":1.0}},\"63\":{\"status\":\"available\",\"absolute_return_pct\":63.0,\"relative_wealth_pct\":-100.0,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":64,\"expected_n\":64,\"ratio\":1.0}}}},{\"group_id\":\"XLC\",\"name_en\":\"Communication Services\",\"name_zh\":\"\\u901a\\u8baf\\u670d\\u52a1\",\"windows\":{\"5\":{\"status\":\"available\",\"absolute_return_pct\":3.144654,\"relative_wealth_pct\":17331.446541,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":6,\"expected_n\":6,\"ratio\":1.0}},\"20\":{\"status\":\"available\",\"absolute_return_pct\":13.888889,\"relative_wealth_pct\":17438.888889,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":21,\"expected_n\":21,\"ratio\":1.0}},\"63\":{\"status\":\"available\",\"absolute_return_pct\":62.376238,\"relative_wealth_pct\":-100.0,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":64,\"expected_n\":64,\"ratio\":1.0}}}},{\"group_id\":\"XLE\",\"name_en\":\"Energy\",\"name_zh\":\"\\u80fd\\u6e90\",\"windows\":{\"5\":{\"status\":\"available\",\"absolute_return_pct\":3.125,\"relative_wealth_pct\":17328.125,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":6,\"expected_n\":6,\"ratio\":1.0}},\"20\":{\"status\":\"available\",\"absolute_return_pct\":13.793103,\"relative_wealth_pct\":17424.137931,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":21,\"expected_n\":21,\"ratio\":1.0}},\"63\":{\"status\":\"available\",\"absolute_return_pct\":61.764706,\"relative_wealth_pct\":-100.0,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":64,\"expected_n\":64,\"ratio\":1.0}}}},{\"group_id\":\"XLF\",\"name_en\":\"Financials\",\"name_zh\":\"\\u91d1\\u878d\",\"windows\":{\"5\":{\"status\":\"available\",\"absolute_return_pct\":3.10559,\"relative_wealth_pct\":17324.84472,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":6,\"expected_n\":6,\"ratio\":1.0}},\"20\":{\"status\":\"available\",\"absolute_return_pct\":13.69863,\"relative_wealth_pct\":17409.589041,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":21,\"expected_n\":21,\"ratio\":1.0}},\"63\":{\"status\":\"available\",\"absolute_return_pct\":61.165049,\"relative_wealth_pct\":-100.0,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":64,\"expected_n\":64,\"ratio\":1.0}}}},{\"group_id\":\"XLI\",\"name_en\":\"Industrials\",\"name_zh\":\"\\u5de5\\u4e1a\",\"windows\":{\"5\":{\"status\":\"available\",\"absolute_return_pct\":3.08642,\"relative_wealth_pct\":17321.604938,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":6,\"expected_n\":6,\"ratio\":1.0}},\"20\":{\"status\":\"available\",\"absolute_return_pct\":13.605442,\"relative_wealth_pct\":17395.238095,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":21,\"expected_n\":21,\"ratio\":1.0}},\"63\":{\"status\":\"available\",\"absolute_return_pct\":60.576923,\"relative_wealth_pct\":-100.0,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":64,\"expected_n\":64,\"ratio\":1.0}}}},{\"group_id\":\"XLK\",\"name_en\":\"Technology\",\"name_zh\":\"\\u79d1\\u6280\",\"windows\":{\"5\":{\"status\":\"available\",\"absolute_return_pct\":-99.386503,\"relative_wealth_pct\":3.680982,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":6,\"expected_n\":6,\"ratio\":1.0}},\"20\":{\"status\":\"available\",\"absolute_return_pct\":-99.324324,\"relative_wealth_pct\":4.054054,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":21,\"expected_n\":21,\"ratio\":1.0}},\"63\":{\"status\":\"partial\",\"absolute_return_pct\":null,\"relative_wealth_pct\":9900.0,\"null_reasons\":{\"absolute_return_pct\":\"non_finite_input\",\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":64,\"expected_n\":64,\"ratio\":1.0}}}},{\"group_id\":\"XLP\",\"name_en\":\"Consumer Staples\",\"name_zh\":\"\\u5fc5\\u9700\\u6d88\\u8d39\",\"windows\":{\"5\":{\"status\":\"available\",\"absolute_return_pct\":3.04878,\"relative_wealth_pct\":17315.243902,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":6,\"expected_n\":6,\"ratio\":1.0}},\"20\":{\"status\":\"available\",\"absolute_return_pct\":13.422819,\"relative_wealth_pct\":17367.114094,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":21,\"expected_n\":21,\"ratio\":1.0}},\"63\":{\"status\":\"available\",\"absolute_return_pct\":59.433962,\"relative_wealth_pct\":-100.0,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":64,\"expected_n\":64,\"ratio\":1.0}}}},{\"group_id\":\"XLRE\",\"name_en\":\"Real Estate\",\"name_zh\":\"\\u623f\\u5730\\u4ea7\",\"windows\":{\"5\":{\"status\":\"available\",\"absolute_return_pct\":3.030303,\"relative_wealth_pct\":17312.121212,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":6,\"expected_n\":6,\"ratio\":1.0}},\"20\":{\"status\":\"available\",\"absolute_return_pct\":13.333333,\"relative_wealth_pct\":17353.333333,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":21,\"expected_n\":21,\"ratio\":1.0}},\"63\":{\"status\":\"available\",\"absolute_return_pct\":58.878505,\"relative_wealth_pct\":-100.0,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":64,\"expected_n\":64,\"ratio\":1.0}}}},{\"group_id\":\"XLU\",\"name_en\":\"Utilities\",\"name_zh\":\"\\u516c\\u7528\\u4e8b\\u4e1a\",\"windows\":{\"5\":{\"status\":\"available\",\"absolute_return_pct\":3.012048,\"relative_wealth_pct\":17309.036145,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":6,\"expected_n\":6,\"ratio\":1.0}},\"20\":{\"status\":\"available\",\"absolute_return_pct\":13.245033,\"relative_wealth_pct\":17339.735099,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":21,\"expected_n\":21,\"ratio\":1.0}},\"63\":{\"status\":\"available\",\"absolute_return_pct\":58.333333,\"relative_wealth_pct\":-100.0,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":64,\"expected_n\":64,\"ratio\":1.0}}}},{\"group_id\":\"XLV\",\"name_en\":\"Health Care\",\"name_zh\":\"\\u533b\\u7597\\u4fdd\\u5065\",\"windows\":{\"5\":{\"status\":\"available\",\"absolute_return_pct\":2.994012,\"relative_wealth_pct\":17305.988024,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":6,\"expected_n\":6,\"ratio\":1.0}},\"20\":{\"status\":\"available\",\"absolute_return_pct\":13.157895,\"relative_wealth_pct\":17326.315789,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":21,\"expected_n\":21,\"ratio\":1.0}},\"63\":{\"status\":\"available\",\"absolute_return_pct\":57.798165,\"relative_wealth_pct\":-100.0,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":64,\"expected_n\":64,\"ratio\":1.0}}}},{\"group_id\":\"XLY\",\"name_en\":\"Consumer Discretionary\",\"name_zh\":\"\\u975e\\u5fc5\\u9700\\u6d88\\u8d39\",\"windows\":{\"5\":{\"status\":\"available\",\"absolute_return_pct\":2.97619,\"relative_wealth_pct\":17302.97619,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":6,\"expected_n\":6,\"ratio\":1.0}},\"20\":{\"status\":\"available\",\"absolute_return_pct\":13.071895,\"relative_wealth_pct\":17313.071895,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":21,\"expected_n\":21,\"ratio\":1.0}},\"63\":{\"status\":\"available\",\"absolute_return_pct\":57.272727,\"relative_wealth_pct\":-100.0,\"null_reasons\":{\"absolute_return_pct\":null,\"relative_wealth_pct\":null},\"coverage\":{\"observed_n\":64,\"expected_n\":64,\"ratio\":1.0}}}}],\"diagnostics\":{\"panel_rows\":64,\"malformed_rows\":0,\"duplicate_sessions\":[],\"ambiguous_columns\":[],\"columns\":[\"SPY\",\"XLB\",\"XLC\",\"XLE\",\"XLF\",\"XLI\",\"XLK\",\"XLP\",\"XLRE\",\"XLU\",\"XLV\",\"XLY\"],\"binding_keys\":[],\"receipt_withheld\":false,\"future_tail_sessions\":[],\"expected_columns\":12,\"qualification_reasons\":[],\"measured_cells\":33,\"complete_cells\":32,\"total_cells\":33,\"coverage_note\":\"observed_n counts usable observations inside the window; an interior gap never moves an endpoint\"},\"authority\":{\"may_rank\":false,\"may_gate\":false,\"may_size\":false,\"may_trade\":false,\"may_escalate\":false}}");

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

const exactWindowValue = (page: Page, window: string, testId: string) =>
  page.getByTestId("sector-exact-window-returns")
    .locator(`[data-testid="sector-exact-window"][data-window="${window}"] [data-testid="${testId}"]`);

test("a partial companion in the Portfolio says so plainly and keeps every published value",
  async ({ page, baseURL }, testInfo) => {
    await prepare(page, testInfo, baseURL, { companion: partialCompanion() });
    await page.goto(portfolioAddress("XLK"));
    const companion = page.getByTestId("sector-exact-window-returns");
    await expect(companion).toBeVisible();
    await expect(companion).toContainText("Some exact-session measurements are missing");
    await expect(companion).not.toContainText("Exact-session returns are unavailable");
    await expect(companion).not.toContainText("The owner withheld every measurement for this cut.");
    await expect(exactWindowValue(page, "63", "sector-exact-absolute")).toHaveText("—");
    await expect(exactWindowValue(page, "63", "sector-exact-relative")).toHaveText("+9,900.00%");
    await noOverflow(page);
  });

test("a supplied owner clock in the Portfolio is shown and is not denied",
  async ({ page, baseURL }, testInfo) => {
    await prepare(page, testInfo, baseURL, { companion: suppliedClockCompanion() });
    await page.goto(portfolioAddress("XLK"));
    const companion = page.getByTestId("sector-exact-window-returns");
    await expect(companion).toBeVisible();
    await expect(companion).not.toContainText("The original availability, publication and history times were not supplied");
    await expect(companion).toContainText("A supplied clock does not establish verified freshness");
    await expect(companion).toContainText("2026-11-05T21:00:00Z");
    await expect(companion).toContainText("The owner supplied no freshness receipt.");
    await noOverflow(page);
  });

test("an unsupplied receipt in the Portfolio is not called a withheld receipt",
  async ({ page, baseURL }, testInfo) => {
    await prepare(page, testInfo, baseURL, { companion: complete });
    await page.goto(portfolioAddress("XLK"));
    const source = page.getByTestId("sector-exact-window-returns").getByTestId("sector-exact-source");
    await source.locator("summary").click();
    await expect(source).toContainText("The owner supplied no receipt.");
    await expect(source).not.toContainText("The owner withheld its receipt.");
    await noOverflow(page);
  });

test("an explicitly withheld receipt in the Portfolio is named as withheld",
  async ({ page, baseURL }, testInfo) => {
    await prepare(page, testInfo, baseURL, { companion: withheldReceiptCompanion() });
    await page.goto(portfolioAddress("XLK"));
    const withheld = page.getByTestId("sector-exact-window-returns").getByTestId("sector-exact-source");
    await withheld.locator("summary").click();
    await expect(withheld).toContainText("The owner withheld its receipt.");
    await expect(withheld).not.toContainText("The owner supplied no receipt.");
    await noOverflow(page);
  });
