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
    AAPL: { name: "Apple", zh: "苹果", col: "#a2aaad", last: 225, chg: -0.4, currency: "USD" },
  },
};
const QUOTES = {
  quotes: {
    NVDA: { last: 180, chg: 2.5, currency: "USD" },
    AAPL: { last: 230, chg: -0.8, currency: "USD" },
  },
};

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
 * Seven events naming the held positions, so the panel offers its "Show all" control — the panel
 * collapses past six rows. The route's own response shape again, served from the browser so the
 * panel's states are deterministic; it is a fixture and it is labelled as one.
 */
function expansionPayload(openTickers: readonly string[], marker: string) {
  return {
    state: "ok",
    asof: "2026-11-02",
    heldTickers: openTickers.length,
    heldPositions: openTickers.length,
    unjoinable: [],
    events: Array.from({ length: 7 }, (_, i) => {
      const date = `2026-11-${String(10 + i).padStart(2, "0")}`;
      return {
        eventId: `earnings|NVDA|${date}`,
        kind: "earnings",
        ticker: "NVDA",
        date,
        daysUntil: 8 + i,
        positions: openTickers.map(ticker => ({ id: `seeded-${ticker.toLowerCase()}`, ticker, shares: 10, status: "open" })),
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
          named_date: date,
          null_reason: null,
        },
        sourcePath: "/data/portfolio_ctx.json",
      };
    }),
  };
}


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

/** A second holding, so a count boundary can move without emptying the book. */
async function seedSecondPosition(page: Page) {
  const response = await page.request.post("/api/portfolio", {
    data: { action: "create", ticker: "AAPL", shares: "10", entryPrice: "150", entryCurrency: "USD" },
  });
  expect(response.ok(), `seeding AAPL failed: ${response.status()}`).toBe(true);
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

      // Capture request-time facts. A replacement initial setup still reads the initial book;
      // only the response for the edited holding is held for the stale-state assertions.
      let releaseEditedRead!: () => void;
      const editedReadGate = new Promise<void>((resolve) => {
        releaseEditedRead = resolve;
      });
      await page.route("**/api/event-impact", async (route) => {
        const read = ++fixture.reads;
        const shares = fixture.shares;
        const marker = `READ-${read}-SHARES-${shares}`;
        if (shares === 25) await editedReadGate;
        await route.fulfill({ json: eventPayload(shares, marker) });
      });

      try {
        await seedPosition(page);
        await page.goto("/portfolio");
        await openEvents(page);

        const mechanism = panel(page).locator('[data-slot="mechanism"] dd');
        await expect(rows(page)).toHaveCount(1);
        await expect(panel(page)).toContainText(zh ? "你持有 10 股" : "You hold 10 shares");
        await expect(mechanism).toHaveText(/^READ-\d+-SHARES-10$/);
        const initialMarker = (await mechanism.innerText()).trim();
        const initialRead = Number(/^READ-(\d+)-SHARES-10$/.exec(initialMarker)![1]);
        expect(initialRead).toBeGreaterThan(0);
        expect(fixture.reads).toBe(initialRead);

        // The real edit: the workspace's record inspector → the position modal → save.
        const edit = await openEditorFromOverview(page, "NVDA");
        await edit.locator("input[name='shares']").fill("25");
        fixture.shares = 25;
        await edit.getByRole("button", { name: /^(Save position|保存持仓)$/ }).click();
        await expect(edit).not.toBeVisible();
        await closeInspector(page);

        // Exactly one read follows the semantic edit. Its response remains outstanding
        // while the panel retires the previous facts and shows its neutral checking state.
        await expect.poll(() => fixture.reads).toBe(initialRead + 1);
        await expect(panel(page).getByTestId("event-impact-checking")).toBeVisible();
        await expect(panel(page)).not.toContainText(initialMarker);
        await expect(panel(page)).not.toContainText(zh ? "你持有 10 股" : "You hold 10 shares");
        await expect(rows(page)).toHaveCount(0);

        releaseEditedRead();
        await expect(panel(page)).toContainText(`READ-${initialRead + 1}-SHARES-25`, { timeout: 20_000 });
        await expect(panel(page)).toContainText(zh ? "你持有 25 股" : "You hold 25 shares");
        await expect(rows(page)).toHaveCount(1);
        await expect(panel(page)).not.toContainText("SHARES-10");
        expect(fixture.reads).toBe(initialRead + 1);

        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await panel(page).screenshot({ path: testInfo.outputPath("event-impact-refreshed.png") });
      } finally {
        releaseEditedRead();
      }
    });
  }
});

/**
 * The expansion grant is retired at a committed count boundary.
 *
 * WHAT THIS PROVES: in a real browser, an expanded panel stays collapsed when the open-position
 * count changes and then comes back. Masking the grant (storing it, comparing it against the
 * current boundaries) only makes the panel LOOK collapsed while the boundaries differ: expand
 * under two positions, close one (count one), reopen it (count two again) and the stored grant
 * matches once more, so "Show all" reopens for a boundary the user never granted.
 *
 * TWO holdings, so the count moves without emptying the book: the workspace renders its empty
 * state — and unmounts the panel with it — when no position is open.
 *
 * The HOLDINGS side is real: the positions are written through the product's own route and the
 * close/reopen go through the workspace's own record inspector, so the committed input change is
 * the real path. The event payload is the route's own shape, served from the browser.
 *
 * ONE exercise per register, at the desktop viewport: the responsive assurance for this surface
 * is the existing six-case capture, which this run preserves rather than recaptures.
 */
test.describe("Portfolio event panel expansion is retired at a count boundary", () => {
  for (const lang of ["en", "zh"] as const) {
    test(`${lang}: an expanded panel stays collapsed when the count comes back`, async ({ page, baseURL }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "one exercise per register; the responsive proof is the existing six-case capture");
      const zh = lang === "zh";
      const fixture: Fixture & { openTickers: string[] } = { shares: 10, reads: 0, openTickers: ["NVDA", "AAPL"] };
      await prepare(page, testInfo, baseURL, zh);

      await page.route("**/api/event-impact", async (route) => {
        fixture.reads += 1;
        const read = fixture.reads;
        // Every read after the first is deliberately slow, so the window between the committed
        // input and the fresh read is observable rather than instantaneous.
        if (read > 1) await new Promise((done) => setTimeout(done, 1200));
        await route.fulfill({ json: expansionPayload(fixture.openTickers, `READ-${read}`) });
      });

      await seedPosition(page);
      await seedSecondPosition(page);
      await page.goto("/portfolio");
      await openEvents(page);

      // Seven events, collapsed to six rows, with the control that expands them.
      await expect(rows(page)).toHaveCount(6);
      const showAll = panel(page).getByRole("button");
      await expect(showAll).toHaveText(zh ? /显示全部 7 个事件/ : /Show all 7 events/);
      await showAll.click();
      await expect(rows(page)).toHaveCount(7);

      // The count boundary changes: AAPL is closed, so the book has ONE open position. The
      // panel stays mounted (the book is not empty), and the grant ends with the boundary it
      // was granted under.
      fixture.openTickers = ["NVDA"];
      const row = page.locator('tr[data-ticker="AAPL"]').filter({ visible: true }).first();
      await expect(row).toBeVisible();
      await row.getByRole("button").first().click();
      const inspector = page.getByRole("dialog").filter({ has: page.locator("#portfolio-record-title") });
      await expect(inspector).toBeVisible();
      await inspector.getByRole("button", { name: zh ? "平仓 AAPL" : "Close AAPL", exact: true }).click();

      // The committed input changed, so the previous read is retired: the panel shows the neutral
      // busy state while the fresh read is in flight. Waiting for THAT is what makes the row
      // count below a statement about the fresh read and not about the read still on screen.
      await expect(panel(page).getByTestId("event-impact-checking")).toBeVisible();
      await expect(rows(page)).toHaveCount(6);
      await expect(panel(page).getByRole("button")).toHaveText(zh ? /显示全部 7 个事件/ : /Show all 7 events/);

      // The count comes BACK to two — the same boundary the grant was made under. The retired
      // grant must not come back with it: the panel must be collapsed, not expanded, and it must
      // be showing a fresh read of the book rather than the facts it was showing before.
      fixture.openTickers = ["NVDA", "AAPL"];
      const reopen = inspector.getByRole("button", { name: zh ? "重新开仓 AAPL" : "Reopen AAPL", exact: true });
      await expect(reopen).toBeVisible();
      await reopen.click();

      await expect(panel(page).getByTestId("event-impact-checking")).toBeVisible();
      await expect(rows(page)).toHaveCount(6);
      await expect(panel(page).getByRole("button")).toHaveText(zh ? /显示全部 7 个事件/ : /Show all 7 events/);
      await expect(panel(page)).not.toContainText("READ-1");

      // Responsive finding: the panel adds no horizontal document overflow at this viewport.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      const shot = page.getByTestId("event-impact");
      await shot.screenshot({
        path: `docs/verification/portfolio-event-refresh-20261102/browser/${testInfo.project.name}-${lang}-expansion-retired.png`,
      });
    });
  }
});
