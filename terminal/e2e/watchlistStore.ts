import { randomUUID } from "node:crypto";
import type { Page, TestInfo } from "@playwright/test";
import { watchlistOwnerKey, WL_FLAGS_KEY, WL_NOTES_KEY, WLS_KEY, WLS_MIGRATED_KEY } from "../lib/watchlistOwner";
import { fixtureUserId } from "../lib/watchlistsFixtureDb";

/**
 * Give one test its own server-side watchlist store.
 *
 * Since W1b a signed-in TerminalShell mount migrates every non-`Default` `mm.wls` list into
 * `watchlists`, so any spec that SEEDS named lists also writes to the fixture store behind
 * `/api/watchlist` (lib/watchlistsFixtureDb.ts). That store is process-wide in the dev server,
 * while the suite is fullyParallel across three viewport projects — without a key per test, one
 * spec's deletes become another spec's re-inserts and the rail order stops being deterministic.
 *
 * Specs that seed nothing need no isolation: with only `Default` present the migration plans
 * nothing at all.
 */
// F9: `reuseExistingServer: !CI` means a second local run usually attaches to the FIRST run's
// dev server — and the fixture store is process-global, so without this nonce run N+1 inherits
// run N's rows and a clean branch fails on nothing. The module loads once per worker process, so
// the value is stable within a run and fresh across runs; `repeatEachIndex` separates --repeat-each
// copies of one title inside a single run, and `retry` separates a retry from the attempt it follows.
//
// `randomUUID`, not `Math.random`: since A1 this key also derives the OWNER the shell scopes its
// local watchlist state by (`e2eWatchlistOwner` below), and CodeQL correctly refuses to see an
// insecure PRNG flow into an identity. The value is test-only either way, and a UUID separates
// runs at least as well as six base-36 characters did.
const RUN_NONCE = `${process.env.TEST_WORKER_INDEX ?? "0"}${randomUUID().slice(0, 8)}`;

export async function isolateWatchlistStore(page: Page, testInfo: TestInfo, baseURL?: string) {
  const key = `${testInfo.project.name}-${testInfo.title}-${testInfo.repeatEachIndex}-${testInfo.retry}-${RUN_NONCE}`
    .toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 110);
  await page.context().addCookies([{
    name: "mm_e2e_wl",
    value: key,
    url: baseURL ?? "http://127.0.0.1:3108",
  }]);
  return key;
}

/**
 * A1: local watchlist state is OWNER-SCOPED, so a spec cannot seed it by writing `mm.wls` any more
 * — an unscoped payload now belongs to nobody and is swept into the guest namespace, exactly as a
 * real browser's pre-boundary leftovers are. Seeding goes through the same owner key the shell
 * derives from the signed-in user id, which is what makes these specs exercise the real path.
 *
 * `storeKey` is what `isolateWatchlistStore` returned (the `mm_e2e_wl` cookie); "default" is the
 * shared store used by specs that never isolate.
 */
export function e2eWatchlistOwner(storeKey = "default"): string {
  return watchlistOwnerKey(fixtureUserId(storeKey));
}

type SeededState = {
  lists: Record<string, { symbol: string; section: string }[]>;
  active?: string;
  meta?: Record<string, { sections: string[]; collapsed: string[] }>;
};

/**
 * Seed one owner's saved lists BEFORE the shell mounts.
 *
 * The seed is applied ONLY when that owner's slot is absent, and the guard is load-bearing:
 * `addInitScript` runs on EVERY navigation, so an unconditional write re-seeds on each reload and
 * silently discards whatever the test just did. (That is why the pre-A1 seeding in
 * `watchlist-bulk-actions.spec.ts` carried the same `if (!localStorage.getItem(...))` guard.)
 */
export async function seedOwnerWatchlists(page: Page, storeKey: string, state: SeededState) {
  const owner = e2eWatchlistOwner(storeKey);
  await page.addInitScript(([key, slot, payload]) => {
    let envelope: Record<string, unknown> = {};
    try { envelope = JSON.parse(localStorage.getItem(key as string) || "{}"); } catch { envelope = {}; }
    if (envelope && typeof envelope === "object" && (slot as string) in envelope) return;
    localStorage.setItem(key as string, JSON.stringify({ ...envelope, [slot as string]: payload }));
  }, [WLS_KEY, owner, { meta: {}, active: Object.keys(state.lists)[0], ...state }] as const);
}

export const E2E_WLS_KEY = WLS_KEY;
export const E2E_WL_FLAGS_KEY = WL_FLAGS_KEY;
export const E2E_WL_NOTES_KEY = WL_NOTES_KEY;
export const E2E_WLS_MIGRATED_KEY = WLS_MIGRATED_KEY;
