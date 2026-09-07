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

// This spec is inherently slower than the 30s default: it seeds 300 rows, drives the list picker,
// and then has to OBSERVE several 6-second poll cycles to see a full rotation. The default cap
// silently truncates the observation window — the poll for "3 batches" died at 2 with
// "Test timeout of 30000ms exceeded", which reads like a demand-planner failure and is not one.
test.setTimeout(150_000);

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

// Seed the list through the REAL /api/watchlist route, then reload — the pattern
// e2e/watchlist-server-migration.spec.ts uses. Seeding `mm.wls` and relying on the W1b
// localStorage->server migration proved unreproducible on CI: the rows sometimes never reached the
// server, so the list never appeared in the picker at all. Creating it server-side removes that
// race entirely; the shell then restores it on mount the way it does for any real account.
const LIST = "Bulk Quotes";

async function openWithWatchlist(
  page: Page, testInfo: TestInfo, baseURL: string | undefined, symbols: string[],
) {
  await isolateWatchlistStore(page, testInfo, baseURL);
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });

  await page.evaluate(async ({ list, symbols }) => {
    const created = await (await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createList", name: list }),
    })).json();
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", listId: created.list.id, symbols, section: "EQUITIES" }),
    });
  }, { list: LIST, symbols });

  await page.reload();
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });

  // Make it the ACTIVE list through the picker — the user's own path, and immune to whatever the
  // mount restores as active.
  const listRow = page.locator(".wl-list-row").filter({ hasText: LIST });
  await expect(async () => {
    if ((await page.locator(".wl-select").innerText()).includes(LIST)) return;
    if (!(await listRow.isVisible().catch(() => false))) {
      await page.locator(".wl-select").click();
      await expect(listRow).toBeVisible({ timeout: 10_000 });
    }
    await listRow.locator(".wl-list-nm").click({ timeout: 10_000 });
    await expect(page.locator(".wl-select")).toContainText(LIST, { timeout: 10_000 });
  }).toPass({ timeout: 90_000 });

  // PRECONDITION, asserted rather than assumed: a fixture that never landed must report as a
  // fixture problem, not as "symbol #1 was not covered".
  await expect(page.locator(".wl-row")).toHaveCount(symbols.length, { timeout: 30_000 });
}

/** Discard polls issued while the rail was still on `Default`; only the steady state is the subject. */
function measureFrom(batches: string[][]) { batches.length = 0; }

test("a 300-symbol watchlist reaches every row, without a bigger request", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Demand planning is viewport-independent; one viewport proves the wiring.");

  const batches = await recordQuoteBatches(page);
  await openWithWatchlist(page, testInfo, baseURL, SYMBOLS);
  measureFrom(batches);

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
  const symbols = [...SYMBOLS];
  symbols.splice(250, 0, composite);
  await openWithWatchlist(page, testInfo, baseURL, symbols);
  measureFrom(batches);

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
