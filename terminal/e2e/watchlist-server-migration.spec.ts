import { expect, test, type Page } from "@playwright/test";
import {
  E2E_WLS_KEY,
  E2E_WLS_MIGRATED_KEY,
  e2eWatchlistOwner,
  isolateWatchlistStore,
  seedOwnerWatchlists,
} from "./watchlistStore";

// W1b acceptance: `mm.wls` named lists become SERVER-BACKED for a signed-in user, via a one-time
// additive migration that is safe to run twice and never touches `Default`.
//
// Determinism comes from TERMINAL_E2E_FIXTURE (playwright.config.ts) — the API route serves the
// in-memory transport in lib/watchlistsFixtureDb.ts, never live Supabase — plus a per-test
// `mm_e2e_wl` store (e2e/watchlistStore.ts), so the parallel viewport projects cannot see each
// other's writes.

// A1: both the lists cache and the migration receipt are owner-scoped envelopes now, so this spec
// reads and writes the SIGNED-IN owner's slot rather than a browser-global key.
const MIGRATED_KEY = E2E_WLS_MIGRATED_KEY;
let owner = e2eWatchlistOwner();
let storeKey = "default";

// Local Default is a REORDERED SUBSET of the server's seeded six. That makes the TRAP-1 assertion
// exact: the reconcile has no local-only row to heal, so any change to the server's Default would
// have to have come from the migration — which is precisely what must never happen.
const SEED = {
  lists: {
    Default: [
      { symbol: "MSFT", section: "Equities" },
      { symbol: "AAPL", section: "Equities" },
    ],
    "Gold Miners": [
      { symbol: "NEM", section: "Miners" },
      { symbol: "AEM", section: "Miners" },
    ],
    Space: [{ symbol: "RKLB", section: "Growth" }],
  },
  active: "Gold Miners",
  meta: {
    "Gold Miners": { sections: ["Miners"], collapsed: [] },
    Space: { sections: ["Growth"], collapsed: [] },
  },
};

const SERVER_DEFAULT = ["BTC-USD", "ETH-USD", "NVDA", "AAPL", "MSFT", "QQQ"];

type ServerList = { id: string; name: string; position: number; symbols: { symbol: string; section: string; position: number }[] };

/** Read the owner's inventory through the page so the request carries the store cookie. */
const inventory = (page: Page): Promise<ServerList[]> => page.evaluate(async () => {
  const response = await fetch("/api/watchlist", { headers: { Accept: "application/json" } });
  const payload = await response.json();
  return payload.lists as ServerList[];
});

const marker = (page: Page) => page.evaluate(([key, slot]) => {
  try { return JSON.parse(localStorage.getItem(key) || "{}")[slot] ?? null; } catch { return null; }
}, [MIGRATED_KEY, owner] as const);

/** This owner's saved local lists, from the owner-scoped envelope. */
const savedLists = (page: Page) => page.evaluate(([key, slot]) => {
  try { return JSON.parse(localStorage.getItem(key) || "{}")[slot]?.lists ?? {}; } catch { return {}; }
}, [E2E_WLS_KEY, owner] as const);

const named = (lists: ServerList[], name: string) => lists.find((list) => list.name === name);
const symbolsOf = (lists: ServerList[], name: string) => named(lists, name)?.symbols.map((row) => row.symbol) ?? null;

async function boot(page: Page) {
  await page.goto("/terminal?symbol=AAPL");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  // The migration completes asynchronously after mount; the marker is its receipt.
  await expect.poll(() => marker(page), { timeout: 30_000 }).toEqual({ "Gold Miners": true, Space: true });
}

test.beforeEach(async ({ page, baseURL }, testInfo) => {
  storeKey = await isolateWatchlistStore(page, testInfo, baseURL);
  owner = e2eWatchlistOwner(storeKey);
  await seedOwnerWatchlists(page, storeKey, SEED);
});

test("one-time migration is additive, per-list, and run-twice identical", async ({ page }) => {
  // Three full shell mounts (boot + two reloads) against Playwright's DEFAULT 30s per-test budget
  // — playwright.config.ts's 120_000 is the webServer start timeout, not a per-test one. That made
  // this the natural first casualty of CPU starvation on a loaded CI runner, reported as a flake
  // rather than as whatever it was actually measuring.
  test.setTimeout(120_000);
  await boot(page);

  const first = await inventory(page);
  expect(first.map((list) => list.name)).toEqual(["Default", "Gold Miners", "Space"]);
  // Created after the existing rows, never renumbering them.
  expect(first.map((list) => list.position)).toEqual([0, 1, 2]);
  expect(symbolsOf(first, "Gold Miners")).toEqual(["NEM", "AEM"]);
  expect(symbolsOf(first, "Space")).toEqual(["RKLB"]);
  // Local `section` survives the trip.
  expect(named(first, "Gold Miners")!.symbols.map((row) => row.section)).toEqual(["Miners", "Miners"]);
  expect(named(first, "Space")!.symbols.map((row) => row.section)).toEqual(["Growth"]);

  // TRAP-1: `Default` is reconciled by the mount effect alone. The migration must not have added,
  // removed or reordered a single row on the server's Default.
  expect(symbolsOf(first, "Default")).toEqual(SERVER_DEFAULT);
  // ...and the local cache still holds the user's own Default order (their two rows first, then
  // the server rows they did not have) — the TRAP-1 reconcile, unchanged by W1b.
  await expect.poll(async () => (await savedLists(page)).Default?.map((row: { symbol: string }) => row.symbol))
    .toEqual(["MSFT", "AAPL", "BTC-USD", "ETH-USD", "NVDA", "QQQ"]);

  // RUN TWICE: reload re-runs the whole effect against the same local state.
  await page.reload();
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => inventory(page), { timeout: 30_000 }).toEqual(first);

  // ...and a THIRD time with the marker wiped, proving idempotency comes from merge-by-name +
  // insert-missing rather than from the marker alone.
  await page.evaluate(([key, slot]) => {
    const envelope = JSON.parse(localStorage.getItem(key) || "{}");
    delete envelope[slot];
    localStorage.setItem(key, JSON.stringify(envelope));
  }, [MIGRATED_KEY, owner] as const);
  await page.reload();
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => marker(page), { timeout: 30_000 }).toEqual({ "Gold Miners": true, Space: true });
  expect(await inventory(page)).toEqual(first);
});

test("a partially-recorded marker retries only the lists it does not name", async ({ page }) => {
  await boot(page);
  const complete = await inventory(page);

  // Simulate the previous run having failed on "Space" only: drop its server list and its marker
  // entry, keep "Gold Miners" recorded. The next mount must re-create Space and leave Gold Miners
  // exactly as it is.
  const spaceId = named(complete, "Space")!.id;
  await page.evaluate(async ({ key, slot, listId }) => {
    localStorage.setItem(key, JSON.stringify({ [slot]: { "Gold Miners": true } }));
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deleteList", listId }),
    });
  }, { key: MIGRATED_KEY, slot: owner, listId: spaceId });
  expect(await inventory(page)).toHaveLength(2);

  await page.reload();
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => marker(page), { timeout: 30_000 }).toEqual({ "Gold Miners": true, Space: true });

  const healed = await inventory(page);
  expect(healed.map((list) => list.name)).toEqual(["Default", "Gold Miners", "Space"]);
  expect(symbolsOf(healed, "Space")).toEqual(["RKLB"]);
  // Gold Miners was skipped by the marker — no duplicate row, no re-inserted symbol.
  expect(named(healed, "Gold Miners")).toEqual(named(complete, "Gold Miners"));
  expect(symbolsOf(healed, "Default")).toEqual(SERVER_DEFAULT);
});

// F1 PROBE (commissioning round 2). The reviewer parked the inventory GET for 9s, deleted a row
// locally in that window, and watched the stale response replay it back into BOTH localStorage and
// the rail. Under the ORDER-SEMANTICS RULING the adopt step is additive-only for a list that
// exists locally, and the pre-read membership snapshot makes a row removed mid-flight ineligible
// for re-appending — so a stale read can no longer revert live local state.
test("F1 probe: an inventory read parked mid-flight cannot revert a live local delete", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Context menu is a desktop pointer workflow.");
  // This test deliberately spends 9s holding a response, on top of two full shell mounts. Under
  // the parallel matrix that overruns the 30s default and reports as a flake rather than as the
  // regression it exists to catch, so it gets its own budget.
  test.setTimeout(120_000);
  await boot(page);   // first mount migrates Gold Miners = [NEM, AEM] onto the server
  expect(symbolsOf(await inventory(page), "Gold Miners")).toEqual(["NEM", "AEM"]);

  // Park ONLY the shell's next inventory GET. The response is CAPTURED FIRST and delivered late,
  // which is what makes it genuinely stale — sleeping before `route.continue()` merely delays the
  // request, so the server would answer with post-delete state and the probe would prove nothing.
  // Everything else — the delete POST, and this spec's own reads — passes through untouched.
  let parkedOnce = false;
  let parkedBody: string | null = null;
  let delivered = false;
  await page.route("**/api/watchlist", async (route) => {
    if (parkedOnce || route.request().method() !== "GET") { await route.continue(); return; }
    parkedOnce = true;
    const captured = await route.fetch();               // pre-delete snapshot, taken NOW
    parkedBody = await captured.text();
    await new Promise((resolve) => setTimeout(resolve, 9_000));
    await route.fulfill({ response: captured, body: parkedBody });   // delivered late, still saying AEM
    delivered = true;
  });

  await page.reload();
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".wl-select")).toContainText("Gold Miners");

  // Delete AEM while the shell is still waiting on that parked read.
  await page.locator('[data-watchlist-symbol="AEM"]').click();
  await page.locator('[data-watchlist-symbol="AEM"]').click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Selected ticker actions" });
  await expect(menu).toBeVisible();
  // master #409 renamed the SINGLE-row action to "Delete symbol" (the counted
  // "Delete N symbols" is the multi-select form).
  await menu.getByRole("menuitem", { name: "Delete symbol" }).click();
  await expect(page.locator('[data-watchlist-symbol="AEM"]')).toHaveCount(0);

  // Wait for the STALE response to actually be delivered — the marker is no signal here, it was
  // already written by the first mount. Then give the adopt step room to run.
  await expect.poll(() => delivered, { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(2_000);
  // The response the shell received really did still list AEM; without this the probe could pass
  // by never having presented stale data at all.
  expect(JSON.parse(parkedBody!).lists.find((l: { name: string }) => l.name === "Gold Miners")
    .symbols.map((r: { symbol: string }) => r.symbol)).toEqual(["NEM", "AEM"]);

  // The rail DOM never gets AEM back...
  await expect(page.locator('[data-watchlist-symbol="AEM"]')).toHaveCount(0);
  // ...nor does the localStorage cache...
  expect((await savedLists(page))["Gold Miners"]?.map((row: { symbol: string }) => row.symbol)).toEqual(["NEM"]);
  // ...and F2 means the delete reached the server during the window (by exact NAME — no id was
  // known yet, because the very read that registers ids was the one parked).
  expect(symbolsOf(await inventory(page), "Gold Miners")).toEqual(["NEM"]);
});

test("a server-only list is kept, and a symbol edit on a NAMED list now reaches the server", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The bulk context menu is a desktop pointer workflow.");
  await boot(page);

  // A list this browser has never seen (another device made it) must survive the migration.
  await page.evaluate(async () => {
    const created = await (await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createList", name: "From Phone" }),
    })).json();
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", listId: created.list.id, symbols: ["ASTS"], section: "Growth" }),
    });
  });
  await page.evaluate(([key, slot]) => {
    const envelope = JSON.parse(localStorage.getItem(key) || "{}");
    delete envelope[slot];
    localStorage.setItem(key, JSON.stringify(envelope));
  }, [MIGRATED_KEY, owner] as const);
  await page.reload();
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => marker(page), { timeout: 30_000 }).toEqual({ "Gold Miners": true, Space: true });
  expect(symbolsOf(await inventory(page), "From Phone")).toEqual(["ASTS"]);

  // Before W1b a delete on a non-Default list was localStorage-only; it must now reach the server.
  await expect(page.locator(".wl-select")).toContainText("Gold Miners");
  await page.locator('[data-watchlist-symbol="AEM"]').click();
  await page.locator('[data-watchlist-symbol="AEM"]').click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Selected ticker actions" });
  await expect(menu).toBeVisible();
  // master #409 renamed the SINGLE-row action to "Delete symbol" (the counted
  // "Delete N symbols" is the multi-select form).
  await menu.getByRole("menuitem", { name: "Delete symbol" }).click();

  await expect.poll(async () => symbolsOf(await inventory(page), "Gold Miners"), { timeout: 15_000 }).toEqual(["NEM"]);
  // Scoped: the sibling lists are untouched by that write.
  const after = await inventory(page);
  expect(symbolsOf(after, "Space")).toEqual(["RKLB"]);
  expect(symbolsOf(after, "Default")).toEqual(SERVER_DEFAULT);
});
