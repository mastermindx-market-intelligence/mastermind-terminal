import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isolateWatchlistStore } from "./watchlistStore";
import { closeInspector } from "./portfolioWorkspaceHelpers";

/**
 * The Portfolio event panel refreshes after a holding edit — native browser proof.
 *
 * WHAT THIS PROVES: the panel's own behaviour in a real browser at the three contract
 * viewports, in both registers — a committed holding edit retires the previous read, never
 * presents it as current, and re-reads the facts for the resulting book.
 *
 * WHAT THIS DOES NOT PROVE: the `/api/event-impact` route's own response is NOT executed here.
 * The macro calendar artifact is not reachable from this host, so the route would answer a
 * transport failure rather than a calendar, and the proof would be about that failure instead
 * of about the panel. The route's projection (`{id, ticker, shares, status}`) and its typed
 * failure states are source-verified in the unit suites, not executed here. The payload below is
 * the route's OWN response shape, served from the browser so the panel's states are
 * deterministic; it is a fixture, and it is labelled as one.
 *
 * The HOLDINGS side is real: the position is written through the product's own route
 * (`POST /api/portfolio` → lib/portfolio.ts → the fixture transport) and the page reads the same
 * store, so the edit, the canonical reread and the committed input change are the real path.
 */

test.setTimeout(120_000);

const MANIFEST = {
  symbols: {
    NVDA: { name: "NVIDIA", zh: "英伟达", col: "#76b900", last: 175, chg: 1.2, currency: "USD" },
  },
};
const QUOTES = { quotes: { NVDA: { last: 180, chg: 2.5, currency: "USD" } } };

/** The route's own typed payload shape, with the held size and a per-read marker. */
function eventPayload(shares: number, marker: string) {
  return {
    state: "ok",
    asof: "2026-11-02",
    heldTickers: 1,
    heldPositions: 1,
    unjoinable: [],
    events: [
      {
        eventId: "earnings|NVDA|2026-11-10",
        kind: "earnings",
        ticker: "NVDA",
        date: "2026-11-10",
        daysUntil: 8,
        positions: [{ id: "seeded-nvda", ticker: "NVDA", shares, status: "open" }],
        direction: { state: "not_stated" },
        mechanism: { state: "stated", text: marker, textZh: marker },
        timeframe: { state: "not_stated" },
        invalidation: {
          condition_en: "A last close has printed on the report date.",
          condition_zh: "报告日已经公布收盘价。",
          metric_owner: "hub/lib/anchor.js",
          comparator: "at or below",
          threshold: null,
          checked_against: "named date",
          named_date: "2026-11-10",
          null_reason: null,
        },
        sourcePath: "/data/portfolio_ctx.json",
      },
    ],
  };
}

type Fixture = { shares: number; reads: number };

/**
 * Install the routes and language. `fixture.shares` is the size the served event payload
 * reports; the test raises it as part of the edit, so the read that follows the canonical
 * reread answers for the resulting book.
 */
async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, zh: boolean) {
  await isolateWatchlistStore(page, testInfo, baseURL);
  await page.addInitScript((useZh) => {
    localStorage.setItem("mm.lang", useZh ? "zh" : "en");
    const root = document.documentElement;
    if (root) {
      root.setAttribute("data-lang", useZh ? "zh" : "en");
      root.setAttribute("lang", useZh ? "zh-CN" : "en");
    }
  }, zh);
  await page.route("**/data/manifest.json", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({ json: QUOTES }));
  await page.route("**/api/portfolio-brief", (route) =>
    route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ tier: "free" }) }));
}

async function seedPosition(page: Page) {
  const response = await page.request.post("/api/portfolio", {
    data: { action: "create", ticker: "NVDA", shares: "10", entryPrice: "100", entryCurrency: "USD" },
  });
  expect(response.ok(), `seeding NVDA failed: ${response.status()}`).toBe(true);
}

const panel = (page: Page) => page.getByTestId("event-impact");
const rows = (page: Page) => panel(page).getByTestId("event-impact-row");

/** The events live inside a collapsed disclosure in the workspace — open it. */
async function openEvents(page: Page) {
  const details = page.locator("details", { has: panel(page) });
  await expect(details).toHaveCount(1);
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await details.locator("summary").click();
  }
  await expect(details).toHaveAttribute("open", "");
}

/**
 * Open the position editor FROM THE OVERVIEW, so the events panel stays on screen for the whole
 * journey. (The workspace keeps every section mounted and hides the inactive one, so a trip to
 * the holdings tab would make the panel invisible exactly while its refresh is under proof.)
 */
async function openEditorFromOverview(page: Page, ticker: string) {
  const row = page.locator(`tr[data-ticker="${ticker}"]`).filter({ visible: true }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button").first().click();
  const inspector = page.getByRole("dialog").filter({ has: page.locator("#portfolio-record-title") });
  await expect(inspector).toBeVisible();
  // The record dialog's own controls are labelled `Edit <TICKER>` / `编辑 <TICKER>`; the ticker
  // suffix is language-neutral, so the control is found without hard-coding either register.
  await inspector.locator(`button[aria-label$=" ${ticker}"]`).first().click();
  const editor = page.getByRole("dialog").filter({ has: page.locator("input[name='ticker']") });
  await expect(editor).toBeVisible();
  return editor;
}

test.describe("Portfolio event panel refreshes after a holding edit", () => {
  for (const lang of ["en", "zh"] as const) {
    test(`${lang}: the committed edit retires the previous facts and re-reads the book`, async ({ page, baseURL }, testInfo) => {
      const zh = lang === "zh";
      const fixture: Fixture = { shares: 10, reads: 0 };
      await prepare(page, testInfo, baseURL, zh);

      // The served event read: the route's own shape, with the held size and a per-read marker
      // so a stale answer is visible as a different string, not merely a different length.
      await page.route("**/api/event-impact", async (route) => {
        fixture.reads += 1;
        const read = fixture.reads;
        // Every read after the first is deliberately SLOW, so the window between the committed
        // input and the fresh read is observable rather than instantaneous.
        if (read > 1) await new Promise((done) => setTimeout(done, 2500));
        await route.fulfill({
          json: eventPayload(fixture.shares, `READ-${read}-SHARES-${fixture.shares}`),
        });
      });

      await seedPosition(page);
      await page.goto("/portfolio");
      await openEvents(page);

      await expect(rows(page)).toHaveCount(1);
      await expect(panel(page)).toContainText("READ-1-SHARES-10");
      await expect(panel(page)).toContainText(zh ? "你持有 10 股" : "You hold 10 shares");
      expect(fixture.reads).toBe(1);

      // The real edit: the workspace's record inspector → the position modal → save.
      const edit = await openEditorFromOverview(page, "NVDA");
      await edit.locator("input[name='shares']").fill("25");
      fixture.shares = 25;
      await edit.getByRole("button", { name: /^(Save position|保存持仓)$/ }).click();
      await expect(edit).not.toBeVisible();
      await closeInspector(page);

      // The committed input changed, so the previous read is retired: the panel shows the
      // neutral busy state and NOT the facts it was showing a moment ago.
      await expect(panel(page).getByTestId("event-impact-checking")).toBeVisible();
      await expect(panel(page)).not.toContainText("READ-1-SHARES-10");
      await expect(panel(page)).not.toContainText(zh ? "你持有 10 股" : "You hold 10 shares");
      await expect(rows(page)).toHaveCount(0);

      // The fresh read answers for the resulting book.
      await expect(panel(page)).toContainText("READ-2-SHARES-25", { timeout: 20_000 });
      await expect(panel(page)).toContainText(zh ? "你持有 25 股" : "You hold 25 shares");
      await expect(rows(page)).toHaveCount(1);
      await expect(panel(page)).not.toContainText("SHARES-10");

      // Responsive finding: the panel adds no horizontal document overflow at this viewport.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      const shot = page.getByTestId("event-impact");
      await shot.screenshot({
        path: `docs/verification/portfolio-event-refresh-20261102/browser/${testInfo.project.name}-${lang}-refreshed.png`,
      });
    });
  }
});
