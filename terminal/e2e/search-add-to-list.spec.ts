import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { E2E_WLS_KEY, e2eWatchlistOwner, isolateWatchlistStore, seedOwnerWatchlists } from "./watchlistStore";

// Operator report (2026-08-05): a one-hit search for 明阳电气 showed a sliver of a panel behind the
// result row and the + button appeared to do nothing. With two or more watchlists, + opens the
// add-to-list picker — which was an absolute child of the row, so it sat inside BOTH `.sres`
// (overflow:auto, barely taller than the single row) and `.smodal` (overflow:hidden). 8px of a
// 123px popover showed; the list menu the add depends on was invisible, so nothing could be added.
// A1: local watchlist state is owner-scoped, so both the seed and every read below go through
// the signed-in owner's slot rather than a browser-global `mm.wls`.
let owner = e2eWatchlistOwner();
const savedLists = (page: Page) => page.evaluate(([key, slot]) => {
  try { return JSON.parse(localStorage.getItem(key) || "{}")[slot]?.lists ?? {}; } catch { return {}; }
}, [E2E_WLS_KEY, owner] as const);

const LISTS = {
  lists: {
    Default: [{ symbol: "NVDA", section: "EQUITIES" }],
    China: [{ symbol: "600519.SS", section: "EQUITIES" }],
  },
  active: "Default",
  meta: {},
};

async function openSearchWithTwoLists(page: Page, query: string, testInfo: TestInfo, baseURL?: string) {
  // Since W1b the seeded "China" list migrates to the server on mount, so this spec needs its own
  // fixture store (see e2e/watchlistStore.ts) to stay deterministic under the parallel matrix.
  const storeKey = await isolateWatchlistStore(page, testInfo, baseURL);
  owner = e2eWatchlistOwner(storeKey);
  // Seeded before any app code runs: TerminalShell persists its own list state on mount, so a seed
  // written after the first load races that write and loses.
  await seedOwnerWatchlists(page, storeKey, LISTS);
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  // W5 CHANGED THE RULE this poll was originally written for, and the poll is still required —
  // for a different reason. `handleAdd` now opens the picker whenever a PORTFOLIO destination
  // exists (`onAddToPortfolio`, passed for any signed-in user), so a single-list user gets the
  // picker too; the pre-W5 straight-to-active-list shortcut survives only where there is no
  // portfolio destination (a guest, and the rail's Add Symbol dialog). Both branches are pinned
  // at the bottom of this file.
  // What the poll still buys: this test asserts the picker lists CHINA, which only exists once the
  // mount-restore effect has applied the saved `mm.wls` — a commit that lands after first paint.
  // `.mm-ptag` proves the shell rendered, NOT that the restore landed, so on a starved runner the
  // click could beat it and open a picker with one list in it (that is how this spec failed on CI
  // at 26 minutes' runtime). The persist effect re-writes `mm.wls` from the restored state, so two
  // keys there is the precondition itself, observed rather than assumed.
  await expect.poll(async () => Object.keys(await savedLists(page)).length, { timeout: 30_000 }).toBeGreaterThan(1);
  await page.locator(".pair").first().click();
  await page.locator(".sh input").click();
  await page.keyboard.type(query);
  await expect(page.locator(".sres .r").first()).toBeVisible({ timeout: 20_000 });
}

test("the add-to-list picker is fully visible on a one-result search", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The picker is a pointer affordance; the phone sheet has its own layout.");

  await openSearchWithTwoLists(page, "AMD", testInfo, baseURL);
  expect(await page.locator(".sres .r").count()).toBe(1);   // the one-row shape that did the clipping

  await page.locator(".sres .r .add").first().click();
  const pick = page.locator(".s-pick");
  await expect(pick).toBeVisible();

  // Visible in the VIEWPORT and actually hit-testable — a clipped popover still reports a box.
  const state = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".s-pick")!;
    const r = el.getBoundingClientRect();
    const centre = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return {
      onScreen: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
      hitsPicker: !!centre?.closest(".s-pick"),
      rows: el.querySelectorAll(".s-pick-row").length,
      height: Math.round(r.height),
    };
  });
  expect(state.onScreen).toBe(true);
  expect(state.hitsPicker).toBe(true);        // the assertion the old markup failed
  expect(state.rows).toBeGreaterThanOrEqual(3);   // two lists + "New watchlist…"

  // …and picking a list actually adds the symbol to it.
  await page.locator(".s-pick-row", { hasText: "China" }).click();
  await expect.poll(async () => (await savedLists(page)).China?.map((r: { symbol: string }) => r.symbol) ?? [],
    { timeout: 10_000 }).toContain("AMD");
});

test("scrolling the result list closes the picker instead of stranding it", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Pointer affordance; desktop is where the popover lives.");

  await openSearchWithTwoLists(page, "A", testInfo, baseURL);                  // many hits → a scrollable result list
  await page.locator(".sres .r .add").first().click();
  await expect(page.locator(".s-pick")).toBeVisible();
  // The popover is anchored to the row's viewport rect, so a scroll would leave it floating.
  await page.locator(".sres").evaluate((el) => { el.scrollTop += 120; el.dispatchEvent(new Event("scroll", { bubbles: false })); });
  await expect(page.locator(".s-pick")).toHaveCount(0);
});

// ── W5: the two branches of `handleAdd`, pinned ────────────────────────────────────────────────
//
// Before W5 a `+` on a search result added straight to the active watchlist whenever the user had
// a single list. Portfolio is now a second destination that means something different — what you
// HOLD, not what you watch — so a `+` that silently picks one of them is the conflation the whole
// programme exists to end. The shortcut survives only where no portfolio destination is passed.

test("a signed-in user with ONE list still gets the picker, because Portfolio is a destination", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Pointer affordance; desktop is where the popover lives.");

  const oneListKey = await isolateWatchlistStore(page, testInfo, baseURL);
  owner = e2eWatchlistOwner(oneListKey);
  // ONE list — the exact case that used to skip the picker entirely.
  await seedOwnerWatchlists(page, oneListKey, {
    lists: { Default: [{ symbol: "NVDA", section: "EQUITIES" }] },
    active: "Default",
    meta: {},
  });
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  // The restore commit, OBSERVED not assumed. Counting keys proves nothing here — one list is true
  // of the initial state too. The discriminator is ORDER: TRAP-1's mount reconcile puts the LOCAL
  // Default first and appends the server's own members after it, so `Default[0]` is "BTC-USD"
  // before the restore lands and the seeded "NVDA" after it.
  await expect.poll(async () => (await savedLists(page)).Default?.[0]?.symbol ?? "", { timeout: 30_000 }).toBe("NVDA");

  await page.locator(".pair").first().click();
  await page.locator(".sh input").click();
  await page.keyboard.type("AMD");
  await expect(page.locator(".sres .r").first()).toBeVisible({ timeout: 20_000 });
  await page.locator(".sres .r .add").first().click();

  // The picker opens, and it opens because there are TWO KINDS of destination, not two lists.
  const pick = page.locator(".s-pick");
  await expect(pick).toBeVisible();
  await expect(pick.getByTestId("add-to-portfolio")).toBeVisible();
  await expect(pick.locator(".s-pick-row", { hasText: "Default" })).toHaveCount(1);
  // AMD reached neither destination just by opening the menu.
  await expect.poll(async () => (await savedLists(page)).Default?.map((r: { symbol: string }) => r.symbol) ?? []).not.toContain("AMD");
});

test("with no Portfolio destination the one-click add survives — the rail's Add Symbol dialog", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Pointer affordance; desktop is where the rail lives.");

  const railKey = await isolateWatchlistStore(page, testInfo, baseURL);
  owner = e2eWatchlistOwner(railKey);
  await seedOwnerWatchlists(page, railKey, LISTS);
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  // Same observed precondition as above: this test asserts what `mm.wls` holds AFTER the add, so a
  // click that beats the restore would be measuring the pre-restore list. `.mm-ptag` proves the
  // shell painted, not that the restore committed.
  await expect.poll(async () => Object.keys(await savedLists(page)).length, { timeout: 30_000 }).toBeGreaterThan(1);

  // This dialog is mounted WITHOUT `lists` and without `onAddToPortfolio` — structurally the same
  // branch a signed-out visitor takes, and the only way to exercise it here (the fixture server's
  // email is a process-wide env var, so a guest cannot be simulated per test).
  await page.locator(".wl-acts button").first().click();
  const dialog = page.locator(".smodal");
  await expect(dialog).toBeVisible();
  await page.keyboard.type("AMD");
  await expect(page.locator(".sres .r").first()).toBeVisible({ timeout: 20_000 });
  await page.locator(".sres .r .add").first().click();

  // No picker, and the symbol landed in the active list directly.
  await expect(page.locator(".s-pick")).toHaveCount(0);
  await expect.poll(async () => (await savedLists(page)).Default?.map((r: { symbol: string }) => r.symbol) ?? [],
    { timeout: 10_000 }).toContain("AMD");
});
