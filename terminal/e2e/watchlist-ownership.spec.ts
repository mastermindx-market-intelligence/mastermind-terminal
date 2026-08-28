import { expect, test, type Page } from "@playwright/test";
import { E2E_WLS_KEY, e2eWatchlistOwner, seedOwnerWatchlists } from "./watchlistStore";

// A1 + A3 acceptance, in a real browser.
//
// A1 — local watchlist state used to be BROWSER-GLOBAL (`mm.wls`, `mm.flags`, `mm.symbolNotes`,
// `mm.wls.migrated.v1`). One user's rows were restored under the next user's session in the same
// browser, and the mount reconcile's heal step then POSTed them into that user's authenticated
// server list. This spec drives the account switch and asserts BOTH halves: nothing of A's renders
// or persists under B, and nothing of A's reaches B's server inventory.
//
// A3 — a delete whose DELETE never reached the server used to come back on the next mount, because
// additive server adoption cannot tell "another device added it" from "this device deleted it".
//
// The identity switch is real, not simulated: `app/terminal/page.tsx` derives the fixture user id
// from the `mm_e2e_wl` store cookie (`fixtureUserId`), so a different cookie value IS a different
// account — its own auth id AND its own server-side store. (A signed-OUT guest cannot be driven
// here: the fixture email is a process-wide env var. Guest↔account transitions are covered in
// lib/__tests__/watchlistOwner.test.ts.)

const ACCOUNT_A = "own-acct-a";
const ACCOUNT_B = "own-acct-b";
// Deliberately absent from the seeded Default, so their presence anywhere under B is unambiguous.
const A_ONLY = ["PLTR", "ASTS"];

type ServerList = { id: string; name: string; symbols: { symbol: string }[] };

const inventory = (page: Page): Promise<ServerList[]> => page.evaluate(async () => {
  const response = await fetch("/api/watchlist", { headers: { Accept: "application/json" } });
  return (await response.json()).lists as ServerList[];
});

const everyServerSymbol = async (page: Page) =>
  (await inventory(page)).flatMap((list) => list.symbols.map((row) => row.symbol));

/** Every owner slot present in the browser, so a leak into ANY slot is visible. */
const allSlots = (page: Page) => page.evaluate((key) => {
  try { return JSON.parse(localStorage.getItem(key) || "{}") as Record<string, { lists?: Record<string, { symbol: string }[]> }>; }
  catch { return {}; }
}, E2E_WLS_KEY);

async function signInAs(page: Page, storeKey: string, baseURL?: string) {
  await page.context().clearCookies({ name: "mm_e2e_wl" });
  await page.context().addCookies([{ name: "mm_e2e_wl", value: storeKey, url: baseURL ?? "http://127.0.0.1:3108" }]);
}

async function boot(page: Page) {
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
}

test.describe("A1 — one browser, two accounts", () => {
  test("account B inherits none of account A's watchlists, flags, notes or server rows", async ({ page, baseURL }, testInfo) => {
    test.setTimeout(150_000);
    const suffix = `${testInfo.project.name}-${testInfo.retry}`;
    const keyA = `${ACCOUNT_A}-${suffix}`;
    const keyB = `${ACCOUNT_B}-${suffix}`;

    // ── Account A builds local state, which migrates to A's own server store ──
    await signInAs(page, keyA, baseURL);
    await seedOwnerWatchlists(page, keyA, {
      lists: {
        Default: [{ symbol: "NVDA", section: "Equities" }],
        "Alpha A": A_ONLY.map((symbol) => ({ symbol, section: "Growth" })),
      },
      active: "Alpha A",
      meta: {},
    });
    await boot(page);
    await expect(page.locator(".wl-select")).toContainText("Alpha A");
    await expect.poll(() => everyServerSymbol(page), { timeout: 30_000 }).toContain("PLTR");

    // ── Account B signs in on the same browser ──
    await signInAs(page, keyB, baseURL);
    await boot(page);

    // 1. Nothing of A's renders. The rail shows B's own Default, not A's list.
    await expect(page.locator(".wl-select")).not.toContainText("Alpha A");
    for (const symbol of A_ONLY) {
      await expect(page.locator(`[data-watchlist-symbol="${symbol}"]`)).toHaveCount(0);
    }

    // 2. Nothing of A's persists under B's owner slot — the restore is namespaced, not global.
    const slots = await allSlots(page);
    const ownerB = e2eWatchlistOwner(keyB);
    const bLists = slots[ownerB]?.lists ?? {};
    expect(Object.keys(bLists)).not.toContain("Alpha A");
    expect(Object.values(bLists).flat().map((row) => row.symbol)).not.toContain("PLTR");
    // A's slot is still there, untouched and separately keyed.
    expect(Object.keys(slots[e2eWatchlistOwner(keyA)]?.lists ?? {})).toContain("Alpha A");

    // 3. THE WRITE PATH — the half that made this a data-integrity bug rather than a display one.
    //    Give the mount's heal + migration a full window to misbehave, then prove they did not.
    await page.waitForTimeout(4_000);
    const bServerSymbols = await everyServerSymbol(page);
    for (const symbol of A_ONLY) expect(bServerSymbols).not.toContain(symbol);
    expect((await inventory(page)).map((list) => list.name)).not.toContain("Alpha A");

    // ── …and back to A, whose state must be exactly as they left it ──
    await signInAs(page, keyA, baseURL);
    await boot(page);
    await expect(page.locator(".wl-select")).toContainText("Alpha A");
    await expect.poll(() => everyServerSymbol(page), { timeout: 30_000 }).toContain("ASTS");
  });
});

test.describe("saved lists survive the mount window", () => {
  test("the mount pass never writes its seed over the owner's saved payload, nor leaves it on the rail", async ({ page, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    const storeKey = `own-mount-${testInfo.project.name}-${testInfo.retry}`;
    await signInAs(page, storeKey, baseURL);
    await seedOwnerWatchlists(page, storeKey, {
      lists: {
        Default: [{ symbol: "MSFT", section: "Equities" }],
        "Gold Miners": [{ symbol: "NEM", section: "Miners" }],
        Space: [{ symbol: "RKLB", section: "Growth" }],
      },
      active: "Gold Miners",
      meta: {},
    });

    const savedListNames = () => page.evaluate(([key, slot]) => {
      try { return Object.keys(JSON.parse(localStorage.getItem(key) || "{}")[slot]?.lists ?? {}); }
      catch { return ["<unreadable>"]; }
    }, [E2E_WLS_KEY, e2eWatchlistOwner(storeKey)] as const);

    await page.goto("/terminal?symbol=AAPL");
    // Sample as fast as the browser will answer, from the moment navigation commits. On the mount
    // pass `lists` still holds the useState seed (`{ Default: <server rows> }`) and the restore
    // effect has not committed, so an unguarded persist wrote a SINGLE-LIST default over the saved
    // payload — measured as ["Default","Gold Miners","Space"] → ["Default"] → back. A reload or a
    // closed tab inside that window destroyed a guest's named lists for good.
    const samples: string[][] = [];
    for (let i = 0; i < 40; i++) {
      samples.push(await savedListNames());
      if (samples.length > 2 && samples.at(-1)!.length > 1 && samples.at(-2)!.length > 1) break;
    }
    expect(samples.filter((names) => names.length === 1 && names[0] === "Default")).toEqual([]);

    // …and the SECOND thing the mount window owes this owner: their list has to be the one on
    // screen once the workspace is running. The rail's FIRST render is always the server's
    // `symbols` prop under the name `Default` — localStorage is not readable during render — but
    // a signed-in user still looking at that afterwards is looking at somebody else's watchlist.
    //
    // They used to, for a long time. The restore was a passive effect, so its update sat in a
    // lower-priority lane than the re-renders the shell takes all through boot and React committed
    // base state ahead of it — measured at +2.1s unthrottled, and at 4x CPU throttle the right list
    // never appeared inside a 300s budget at all. It is a layout effect now (see the comment on it
    // in TerminalShell), flushed before paint, so it cannot be outrun.
    //
    // Deliberately NOT a "settles within N ms" bound, which would only re-time the race on
    // whichever machine runs it. The assertion is ORDERING, read in ONE evaluate so no gap can
    // open between the two halves: at the first instant the chart has painted its price tag, the
    // rail must ALREADY name this owner's active list. That holds at any CPU speed, because the
    // chart mounts from effects that run after the layout effect this guards.
    const railAtFirstPaint = await page.waitForFunction(() => {
      if (!document.querySelector(".mm-ptag")) return null;
      return document.querySelector(".wl-select")?.textContent?.trim() || null;
    }, undefined, { timeout: 90_000 });
    expect(await railAtFirstPaint.jsonValue()).toContain("Gold Miners");
    expect(await savedListNames()).toEqual(expect.arrayContaining(["Default", "Gold Miners", "Space"]));
  });
});

test.describe("A3 — a delete survives a failed write", () => {
  test("a symbol deleted while the server is unreachable does not resurrect", async ({ page, baseURL }, testInfo) => {
    // The delete is driven through the rail's RIGHT-CLICK context menu, a pointer affordance the
    // touch viewports do not carry — the same reason `search-add-to-list` and the drawing specs
    // scope their menu-driven cases to desktop. What is desktop-only here is the INPUT, not the
    // behaviour: the tombstone, the reconcile guard and the retry are viewport-independent, and
    // the ownership case above runs on all three.
    test.skip(testInfo.project.name !== "desktop", "Right-click context menu is a pointer affordance.");
    test.setTimeout(180_000);
    const storeKey = `own-del-${testInfo.project.name}-${testInfo.retry}`;
    await signInAs(page, storeKey, baseURL);

    // Park every `remove` write; reads and other writes go through untouched, which is what an
    // offline window actually looks like from the shell's point of view.
    let removesBlocked = true;
    let blockedRemoves = 0;
    await page.route("**/api/watchlist", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") return route.fallback();
      let action = "";
      try { action = JSON.parse(request.postData() || "{}").action ?? ""; } catch { action = ""; }
      if (action !== "remove") return route.fallback();
      if (!removesBlocked) return route.fallback();
      blockedRemoves += 1;
      return route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"offline"}' });
    });

    await boot(page);
    const target = page.locator('[data-watchlist-symbol="AAPL"]');
    await expect(target).toBeVisible({ timeout: 30_000 });

    // Delete it through the rail's own context menu.
    await target.click({ button: "right" });
    await page.getByRole("menu", { name: "Selected ticker actions" })
      .getByRole("menuitem", { name: "Delete symbol" }).click();
    await expect(target).toHaveCount(0);
    await expect.poll(() => blockedRemoves, { timeout: 15_000 }).toBeGreaterThan(0);

    // The server still holds AAPL — the DELETE never landed.
    expect(await everyServerSymbol(page)).toContain("AAPL");

    // RELOAD while still offline. The mount reads that stale inventory; before A3 the row was
    // adopted back as an "other-device add" and the user's delete silently reversed itself.
    await boot(page);
    await page.waitForTimeout(4_000);
    await expect(page.locator('[data-watchlist-symbol="AAPL"]')).toHaveCount(0);

    // ── connectivity restored: the outstanding intent is retried and converges ──
    removesBlocked = false;
    await boot(page);
    await expect.poll(() => everyServerSymbol(page), { timeout: 30_000 }).not.toContain("AAPL");
    await expect(page.locator('[data-watchlist-symbol="AAPL"]')).toHaveCount(0);

    // One more reload: still deleted, and the tombstone has cleared (it has nothing left to guard).
    await boot(page);
    await page.waitForTimeout(2_000);
    await expect(page.locator('[data-watchlist-symbol="AAPL"]')).toHaveCount(0);
    const tombstones = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("mm.wls.deleted.v1") || "{}"); } catch { return {}; }
    });
    expect(JSON.stringify(tombstones)).not.toContain("AAPL");
  });
});
