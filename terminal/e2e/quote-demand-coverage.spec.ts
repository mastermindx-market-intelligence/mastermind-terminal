import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { isolateWatchlistStore } from "./watchlistStore";

/**
 * D2 — no supported symbol may lose its quote plane because of its POSITION in the demand set.
 *
 * `/api/quote?syms=` caps a batch at 200 and used to enforce that with a silent `slice(0, 200)`.
 * Canonical watchlist operations permit 500 symbols, so a long list showed live prices for its
 * early rows while everything past the boundary sat on EOD fallback — permanently, with nothing on
 * screen attributing it to list position rather than market support.
 *
 * lib/__tests__/quoteDemand.test.ts proves the planner. This spec proves the WIRING: that the real
 * shell, with a real 300-symbol watchlist, actually reaches the rows past the old boundary while
 * keeping request size (and therefore provider fan-out) exactly where it was.
 */

const WATCHLIST_SIZE = 300;
const SYM = (i: number) => `ZTEST${String(i).padStart(4, "0")}`;
const SYMBOLS = Array.from({ length: WATCHLIST_SIZE }, (_, i) => SYM(i));

/** Record every /api/quote batch the page issues, and how many symbols each carried. */
async function recordQuoteBatches(page: Page) {
  const batches: string[][] = [];
  await page.route("**/api/quote?**", async (route) => {
    const url = new URL(route.request().url());
    const syms = (url.searchParams.get("syms") || "").split(",").filter(Boolean);
    // The chart fast lane has its own tiny cap and its own contract; this spec is about the wide
    // watchlist batch, so only that lane is recorded.
    if (url.searchParams.get("cadence") !== "chart") batches.push(syms);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ quotes: Object.fromEntries(syms.map((s) => [s, { last: 1, chg: 0, basis: "EOD" }])) }),
    });
  });
  return batches;
}

// The seeded list must be a NON-DEFAULT named list. W1b migrates only non-`Default` lists from
// `mm.wls` into the server store behind /api/watchlist, so seeding `Default` races the fixture
// store's own seeded Default and the rows may never arrive. The first version of this spec did
// exactly that: it passed locally against a warm reused dev server carrying an earlier run's state,
// and failed on CI's cold server. Mirrors e2e/watchlist-bulk-actions.spec.ts.
const LIST = "Bulk Quotes";
const rowsFor = (symbols: string[]) => symbols.map((symbol) => ({ symbol, section: "EQUITIES" }));

async function openWithWatchlist(
  page: Page, testInfo: TestInfo, baseURL: string | undefined,
  rows: { symbol: string; section: string }[],
) {
  await isolateWatchlistStore(page, testInfo, baseURL);
  await page.addInitScript(({ list, rows }) => {
    localStorage.setItem("mm.wls", JSON.stringify({
      lists: { Default: [], [list as string]: rows },
      active: list,
      meta: {
        Default: { sections: [], collapsed: [] },
        [list as string]: { sections: ["EQUITIES"], collapsed: [] },
      },
    }));
  }, { list: LIST, rows });
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  // PRECONDITION, asserted rather than assumed. Without it the spec starts counting quote batches
  // before the rail holds the list, and a seed that never landed surfaces as
  // "symbol #1 must be covered" — a message that blames the demand planner for a fixture problem.
  await expect(page.locator(".wl-select")).toContainText(LIST, { timeout: 30_000 });
  await expect(page.locator(".wl-row")).toHaveCount(rows.length, { timeout: 30_000 });
}

test("a 300-symbol watchlist reaches every row, without a bigger request", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Demand planning is viewport-independent; one viewport proves the wiring.");

  const batches = await recordQuoteBatches(page);
  await openWithWatchlist(page, testInfo, baseURL, rowsFor(SYMBOLS));

  // The shell polls every 6s. Wait for enough polls that a full rotation must have completed
  // (300 rotating symbols against ~183 free slots per poll = 2 polls).
  await expect.poll(() => batches.length, { timeout: 60_000, message: "quote polls" }).toBeGreaterThanOrEqual(3);

  const covered = new Set(batches.flat());

  // 1. The four positions the handoff names — including the two past the old 200 boundary.
  for (const i of [0, 198, 200, 274]) {
    expect(covered.has(SYM(i)), `symbol #${i + 1} (${SYM(i)}) must be covered`).toBe(true);
  }

  // 2. Nothing is left behind at all.
  const missing = SYMBOLS.filter((s) => !covered.has(s));
  expect(missing, `every watchlist symbol must be reachable; missing: ${missing.slice(0, 5).join(",")}`).toHaveLength(0);

  // 3. Load is bounded: no request grew past the route's cap, and there is still ONE request per
  //    poll — the whole point of rotating rather than raising the cap.
  for (const b of batches) expect(b.length).toBeLessThanOrEqual(200);

  // 4. The charted symbol is in EVERY batch — it never waits for its turn in the rotation.
  for (const b of batches) expect(b).toContain("NVDA");

  // 5. No request was silently truncated by the route, because the client planned under the cap.
  const overCap = batches.filter((b) => b.length > 200);
  expect(overCap).toHaveLength(0);
});

test("a composite row past the boundary gets all of its legs in the same poll", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Demand planning is viewport-independent.");

  const batches = await recordQuoteBatches(page);
  // A composite sitting deep in a long list — the case where naive flat rotation would split its
  // legs across two polls and leave the row summing a fresh leg against a stale one.
  const composite = "AAPL+MSFT";
  const rows = rowsFor(SYMBOLS);
  rows.splice(250, 0, { symbol: composite, section: "EQUITIES" });
  await openWithWatchlist(page, testInfo, baseURL, rows);

  await expect.poll(() => batches.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(3);

  // Whichever poll carries the composite must carry BOTH legs.
  const withAnyLeg = batches.filter((b) => b.includes("AAPL") || b.includes("MSFT"));
  expect(withAnyLeg.length).toBeGreaterThan(0);
  for (const b of withAnyLeg) {
    expect(b).toContain("AAPL");
    expect(b).toContain("MSFT");
  }

  // …and the ordinary rows behind it still get their turn.
  const covered = new Set(batches.flat());
  expect(covered.has(SYM(280))).toBe(true);
});
