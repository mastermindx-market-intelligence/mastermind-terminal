import { expect, test, type Page, type TestInfo } from "./fixtures";
import { isolateWatchlistStore } from "./watchlistStore";

/**
 * B4 — an unreadable positions store must never render as "you hold nothing".
 *
 * `listPositions` fed its result through a helper that answers `[]` for any non-array `data` and
 * never inspected `error`, so a store failure came back as an empty book. `/api/portfolio` could
 * not tell an outage from an empty portfolio, and the page's own `try/catch` described `[]` as
 * "the honest empty state" — on a money surface, the worst available lie.
 *
 * The fault is injected at the TRANSPORT (the fixture db's `positions_read` fault, which returns
 * the supabase-js `{data:null, error}` shape), not at the browser's network layer. That is what
 * makes this a proof about the real path: server page -> readPositions -> PortfolioView, and the
 * route the client re-reads through, all failing the way Supabase would fail them.
 */

test.setTimeout(120_000);

const MANIFEST = {
  symbols: {
    NVDA: { name: "NVIDIA", col: "#76b900", last: 175, chg: 1.2 },
    AAPL: { name: "Apple", col: "#8e8e93", last: 228.1, chg: -0.4 },
    MSFT: { name: "Microsoft", col: "#00a4ef", last: 511.8, chg: 0.7 },
  },
};

const book = (page: Page) => page.locator("[data-portfolio='w5-positions']");
const rows = (page: Page) => page.getByTestId("portfolio-open").locator(".pf-table tbody tr[data-ticker]");
const unreadable = (page: Page) => page.getByTestId("portfolio-unreadable");

async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, zh = false) {
  await isolateWatchlistStore(page, testInfo, baseURL);
  await page.addInitScript((useZh) => {
    localStorage.setItem("mm.lang", useZh ? "zh" : "en");
    document.documentElement.setAttribute("data-lang", useZh ? "zh" : "en");
  }, zh);
  await page.route("**/data/manifest.json", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({ json: { quotes: {} } }));
  await page.route("**/api/portfolio-brief", (route) =>
    route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ tier: "free" }) }));
}

/** Flip the store fault on/off for every subsequent server read AND route call. */
async function setFault(page: Page, on: boolean, baseURL: string | undefined) {
  await page.context().addCookies([{
    name: "mm_e2e_fault",
    value: on ? "positions_read" : "",
    url: baseURL ?? "http://127.0.0.1:3108",
  }]);
}

async function seed(page: Page, ticker: string, shares: string, entryPrice: string) {
  const response = await page.request.post("/api/portfolio", { data: { action: "create", ticker, shares, entryPrice } });
  expect(response.ok(), `seeding ${ticker} failed: ${response.status()}`).toBe(true);
}

test("three seeded positions survive an unreadable store — no empty book, no zero KPI", async ({ page, baseURL }, testInfo) => {
  const zh = testInfo.project.name === "tablet";
  await prepare(page, testInfo, baseURL, zh);

  await seed(page, "NVDA", "10", "150");
  await seed(page, "AAPL", "4", "240");
  await seed(page, "MSFT", "6", "400");

  await page.goto("/portfolio");
  await expect(rows(page)).toHaveCount(3);
  await expect(book(page)).toHaveAttribute("data-portfolio-state", "book");

  // ── the store goes dark ──
  await setFault(page, true, baseURL);
  await page.reload();

  await expect(book(page)).toHaveAttribute("data-portfolio-state", "unreadable");
  await expect(unreadable(page)).toBeVisible();
  await expect(unreadable(page).locator("b"))
    .toHaveText(zh ? "无法读取你的投资组合" : "Could not read your portfolio");

  // NOTHING that asserts a holding may render off a read that did not land.
  await expect(page.getByTestId("portfolio-open")).toHaveCount(0);   // no empty-book table
  await expect(page.locator(".kpi")).toHaveCount(0);                 // no "0 positions held"
  await expect(page.locator(".pf-coverage")).toHaveCount(0);
  await expect(page.getByTestId("brief-population")).toHaveCount(0);
  await expect(book(page)).not.toHaveAttribute("data-position-count", /.*/);
  await expect(page.locator("body")).not.toContainText(zh ? "投资组合暂无持仓" : "Nothing in your portfolio yet");

  // The route that backs every client re-read tells the same story.
  const during = await page.request.get("/api/portfolio");
  expect(during.status()).toBe(503);
  expect((await during.json()).positions).toBeUndefined();

  // ── the store comes back: the retry re-reads in place, no reload ──
  await setFault(page, false, baseURL);
  await unreadable(page).locator("button").click();
  await expect(rows(page)).toHaveCount(3);
  await expect(unreadable(page)).toHaveCount(0);
  await expect(book(page)).toHaveAttribute("data-portfolio-state", "book");

  // …and the original three are exactly the original three.
  await expect(rows(page).locator("[data-ticker], .pf-tk")).toHaveCount(3);
  for (const ticker of ["NVDA", "AAPL", "MSFT"]) {
    await expect(page.getByTestId("portfolio-open").locator(`tr[data-ticker='${ticker}']`)).toHaveCount(1);
  }

  // A full reload agrees — the recovery is the store's, not a client-side patch.
  await page.reload();
  await expect(rows(page)).toHaveCount(3);
});

test("a genuinely empty book is still the empty state, not a failure", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await page.goto("/portfolio");
  await expect(book(page)).toHaveAttribute("data-portfolio-state", "empty");
  await expect(unreadable(page)).toHaveCount(0);
  await expect(page.locator(".pf-empty b")).toHaveText("Nothing in your portfolio yet");
  await expect(book(page)).toHaveAttribute("data-position-count", "0");   // a VERIFIED zero
});

test("a client re-read that fails does not blank a book already on screen", async ({ page, baseURL }, testInfo) => {
  await prepare(page, testInfo, baseURL);
  await seed(page, "NVDA", "10", "150");
  await page.goto("/portfolio");
  await expect(rows(page)).toHaveCount(1);

  // Break the store, then force the client's own re-read through /api/portfolio.
  await setFault(page, true, baseURL);
  const failed = await page.evaluate(async () => {
    const r = await fetch("/api/portfolio", { headers: { Accept: "application/json" } });
    return r.status;
  });
  expect(failed).toBe(503);
  await expect(rows(page)).toHaveCount(1);      // the rows the server already proved are still there
});
