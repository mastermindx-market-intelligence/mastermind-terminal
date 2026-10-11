import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type APIRequestContext, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { E2E_WL_FLAGS_KEY, E2E_WL_NOTES_KEY, e2eWatchlistOwner, seedOwnerWatchlists } from "./watchlistStore";
// A Playwright helper, not a React hook: aliased so the hooks lint does not read the per-language loop as a hook call.
import { useLang as pinLanguage } from "./layoutStore";
import { ANNOTATION_OWNER_HEADER } from "../lib/watchlistAnnotations";
import { ANNOTATION_SYNC_KEY } from "../lib/watchlistAnnotationSync";
import { GUEST_OWNER } from "../lib/accountIdentity";
import { fixtureUserId } from "../lib/watchlistsFixtureDb";

// E05 — cross-device watchlist notes and flags, in a real browser against the shipped route,
// adapter and component. The fixture transport behind `/api/watchlist/annotations`
// (lib/watchlistAnnotationsFixtureDb.ts) is one row set per database key with NO RLS, so a key of
// `<db>::alice` and `<db>::bob` are two accounts over one physical table: the adapter's own
// `user_id` filter and the route's owner check are what keep them apart.
//
// A "second device" is a second browser context (empty localStorage) signed in to the same
// account, or — where only the server state matters — the Playwright request fixture posting as
// that account. Faults are the `mm_e2e_fault` cookie; a lost network is `page.route(...).abort()`.
//
// Touch widths hide the watchlist rail (`.rail .wl-board{display:none}` ≤ 860px), and the sync
// chip lives in that rail, so on tablet/phone the component is a mounted-but-hidden mirror: its
// `data-sync-state` is still asserted (it never claims "synced" falsely), and the hub's flag bars
// prove the second-device read. Conflict and import choosers are reachable at desktop width only.

const ENDPOINT = "/api/watchlist/annotations";
const DEFAULT_BASE = "http://127.0.0.1:3108";
const RUN = randomUUID().slice(0, 8);
const SYNC = '[data-testid="wl-annotation-sync"]';
const RED = "#f23645";
const RED_RGB = "rgb(242, 54, 69)";
const BLUE = "#2962ff";
const BLUE_RGB = "rgb(41, 98, 255)";
const GREEN = "#089981";
const CJK_NOTE = "财报后回调 · 关注 120 支撑位";

type ServerRecord = { symbol: string; note: string | null; noteRevision: number; flag: string | null; flagRevision: number };
type Write = { symbol: string; field: "note" | "flag"; value: string | null; baseRevision: number };

const isDesktop = (testInfo: TestInfo) => testInfo.project.name === "desktop";

/** One fixture database per test (and per run/retry/project) — the store is process-global. */
function dbKey(testInfo: TestInfo, slug: string): string {
  return `e05-${testInfo.project.name}-${slug}-${testInfo.retry}-${testInfo.repeatEachIndex}-${RUN}`
    .toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 80);
}

async function signIn(context: BrowserContext, key: string, baseURL?: string) {
  await context.clearCookies({ name: "mm_e2e_wl" });
  await context.clearCookies({ name: "mm_e2e_guest" });
  await context.addCookies([{ name: "mm_e2e_wl", value: key, url: baseURL ?? DEFAULT_BASE }]);
}

async function asGuest(context: BrowserContext, baseURL?: string) {
  await context.addCookies([{ name: "mm_e2e_guest", value: "1", url: baseURL ?? DEFAULT_BASE }]);
}

async function setFault(context: BrowserContext, tokens: string[], baseURL?: string) {
  await context.clearCookies({ name: "mm_e2e_fault" });
  if (tokens.length) await context.addCookies([{ name: "mm_e2e_fault", value: tokens.join(","), url: baseURL ?? DEFAULT_BASE }]);
}

async function boot(page: Page) {
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
}

// ── the "other device" as a bare HTTP client of the same account ──
const remoteHeaders = (key: string) => ({ cookie: `mm_e2e_wl=${key}`, [ANNOTATION_OWNER_HEADER]: fixtureUserId(key) });

async function serverRead(request: APIRequestContext, key: string): Promise<ServerRecord[]> {
  const response = await request.get(ENDPOINT, { headers: remoteHeaders(key) });
  expect(response.status()).toBe(200);
  return (await response.json()).annotations as ServerRecord[];
}

async function serverWrite(request: APIRequestContext, key: string, writes: Write[]) {
  const response = await request.post(ENDPOINT, { headers: { ...remoteHeaders(key), "content-type": "application/json" }, data: { writes } });
  expect(response.status()).toBe(200);
  const results = (await response.json()).results as { status: string }[];
  expect(results.map((result) => result.status)).toEqual(writes.map(() => "ok"));
}

const serverSymbol = async (request: APIRequestContext, key: string, symbol: string) =>
  (await serverRead(request, key)).find((record) => record.symbol === symbol) ?? null;

// ── browser state ──
/** Seed owner slots ONCE per context: `addInitScript` reruns on every navigation, and a retired
 *  guest slot must not be re-seeded by the next reload. */
async function seedSlots(page: Page, tag: string, entries: [storageKey: string, owner: string, map: Record<string, string>][]) {
  await page.addInitScript(([marker, list]) => {
    if (localStorage.getItem(marker as string)) return;
    for (const [key, owner, map] of list as [string, string, Record<string, string>][]) {
      let envelope: Record<string, unknown> = {};
      try { envelope = JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch { envelope = {}; }
      localStorage.setItem(key, JSON.stringify({ ...envelope, [owner]: map }));
    }
    localStorage.setItem(marker as string, "1");
  }, [`e05.seeded.${tag}`, entries] as const);
}

const slot = (page: Page, storageKey: string, owner: string) => page.evaluate(([key, who]) => {
  try { return (JSON.parse(localStorage.getItem(key) || "{}")[who] ?? {}) as Record<string, unknown>; } catch { return {}; }
}, [storageKey, owner] as const);

/** Edit a note/flag the way a page that is closed would see it: the owner's saved slot. */
const editSlot = (page: Page, storageKey: string, owner: string, symbol: string, value: string) => page.evaluate(([key, who, sym, text]) => {
  const envelope = JSON.parse(localStorage.getItem(key) || "{}");
  envelope[who] = { ...(envelope[who] || {}), [sym]: text };
  localStorage.setItem(key, JSON.stringify(envelope));
}, [storageKey, owner, symbol, value] as const);

/** Every `data-sync-state` the chip passes through on this page load (adjacent duplicates collapsed). */
async function recordSyncStates(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __e05States: string[] };
    w.__e05States = [];
    const push = (state: string | null | undefined) => {
      if (!state) return;
      if (w.__e05States[w.__e05States.length - 1] !== state) w.__e05States.push(state);
    };
    const chipIn = (node: Node): Element | null => {
      if (!(node instanceof Element)) return null;
      return node.matches('[data-testid="wl-annotation-sync"]') ? node : node.querySelector('[data-testid="wl-annotation-sync"]');
    };
    // Records arrive in batches, after the fact: a node's CURRENT attribute is its end-of-batch
    // value, so the value at any earlier point is the oldValue of the next change to that node.
    new MutationObserver((records) => {
      const valueAfter = (index: number, node: Element) => {
        const next = records.slice(index + 1).find((later) => later.type === "attributes" && later.target === node);
        return next ? next.oldValue : node.getAttribute("data-sync-state");
      };
      records.forEach((record, index) => {
        if (record.type === "attributes") {
          push(record.oldValue);
          push(valueAfter(index, record.target as Element));
          return;
        }
        record.removedNodes.forEach((node) => push(chipIn(node)?.getAttribute("data-sync-state")));
        record.addedNodes.forEach((node) => {
          const chip = chipIn(node);
          if (chip) push(valueAfter(index, chip));
        });
      });
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ["data-sync-state"] });
  });
}

const syncStates = (page: Page) => page.evaluate(() => (window as unknown as { __e05States: string[] }).__e05States.slice());

/** The states from the first save attempt on (whatever the chip showed before the edit dropped). */
const fromFirstSave = (states: string[]) => {
  const first = states.findIndex((state) => state === "saving" || state === "retrying");
  return first < 0 ? [] : states.slice(first);
};
const resetSyncStates = (page: Page) => page.evaluate(() => { (window as unknown as { __e05States: string[] }).__e05States = []; });

function trackAnnotationRequests(page: Page) {
  const seen: { method: string; owner: string | null }[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname !== ENDPOINT) return;
    seen.push({ method: request.method(), owner: request.headers()[ANNOTATION_OWNER_HEADER] ?? null });
  });
  return seen;
}

const goOnline = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("online")));

const expectSync = (page: Page, state: string, timeout = 20_000) =>
  expect(page.locator(SYNC)).toHaveAttribute("data-sync-state", state, { timeout });

// ── desktop rail controls (the existing context menu, unchanged by E05) ──
const row = (page: Page, symbol: string) => page.locator(`[data-watchlist-symbol="${symbol}"]`);
const tickerMenu = (page: Page) => page.getByRole("menu", { name: "Selected ticker actions" });

async function menuFlag(page: Page, symbol: string, colorIndex = 1) {
  await row(page, symbol).click({ button: "right" });
  await tickerMenu(page).getByRole("button", { name: `Flag color ${colorIndex}` }).click();
}

async function menuNote(page: Page, symbol: string, text: string) {
  await row(page, symbol).click({ button: "right" });
  const menu = tickerMenu(page);
  await menu.getByRole("menuitem", { name: new RegExp(`Add note for ${symbol}|Edit symbol note`) }).click();
  await page.locator("#wl-symbol-note").fill(text);
  await menu.getByRole("button", { name: "Save" }).click();
  await expect(row(page, symbol).locator(".wl-note-mark")).toHaveAttribute("title", text);
}

/** The touch hub's row for one watchlist symbol. */
async function hubRow(page: Page, symbol: string) {
  await page.locator(".m-symbar").click({ timeout: 20_000 });
  await expect(page.locator(".s-home")).toBeVisible({ timeout: 20_000 });
  return page.locator(".s-home .r", { has: page.locator(".tk", { hasText: new RegExp(`^${symbol}$`) }) }).first();
}

test.describe.configure({ timeout: 150_000 });

test("AC-E05-06 — a note and a flag written on one device are read on a second signed-in device", async ({ page, browser, request, baseURL }, testInfo) => {
  const key = dbKey(testInfo, "two-device");
  const owner = e2eWatchlistOwner(key);
  await signIn(page.context(), key, baseURL);
  await recordSyncStates(page);
  if (isDesktop(testInfo)) {
    await boot(page);
    await menuFlag(page, "NVDA");
    await menuNote(page, "NVDA", CJK_NOTE);
  } else {
    // Touch has no note/flag editor; the device's saved state is what it would have written.
    await seedSlots(page, "a", [[E2E_WL_NOTES_KEY, owner, { NVDA: CJK_NOTE }], [E2E_WL_FLAGS_KEY, owner, { NVDA: RED }]]);
    await boot(page);
  }
  await expectSync(page, "synced");
  if (isDesktop(testInfo)) await expect(page.locator(SYNC)).toHaveText("Synced");
  expect(await serverSymbol(request, key, "NVDA")).toMatchObject({ note: CJK_NOTE, noteRevision: 1, flag: RED, flagRevision: 1 });

  // ── device B: a fresh browser profile, same account ──
  const deviceB = await browser.newContext({ baseURL, viewport: testInfo.project.use.viewport, hasTouch: testInfo.project.use.hasTouch });
  try {
    const pageB = await deviceB.newPage();
    await signIn(deviceB, key, baseURL);
    await boot(pageB);
    await expectSync(pageB, "synced");
    await expect.poll(async () => (await slot(pageB, E2E_WL_NOTES_KEY, owner)).NVDA, { timeout: 15_000 }).toBe(CJK_NOTE);
    await expect.poll(async () => (await slot(pageB, E2E_WL_FLAGS_KEY, owner)).NVDA).toBe(RED);
    if (isDesktop(testInfo)) {
      await expect(row(pageB, "NVDA").locator(".wl-note-mark")).toHaveAttribute("title", CJK_NOTE);
      await expect(row(pageB, "NVDA").locator(".wl-flag-slot--set")).toHaveCSS("background-color", RED_RGB);
      // The existing editor opens on the synced text — readable CJK, not mojibake.
      await row(pageB, "NVDA").click({ button: "right" });
      await tickerMenu(pageB).getByRole("menuitem", { name: /Edit symbol note/ }).click();
      await expect(pageB.locator("#wl-symbol-note")).toHaveValue(CJK_NOTE);
      await pageB.keyboard.press("Escape");
    } else {
      const nvda = await hubRow(pageB, "NVDA");
      await expect(nvda.locator(".s-flag-bar--set")).toHaveCSS("background-color", RED_RGB);
    }
  } finally {
    await deviceB.close();
  }
  expect(await syncStates(page)).not.toContain("conflict");
});

test("AC-E05-01 — one account's annotations are never read, written or adopted under another", async ({ page, request, baseURL }, testInfo) => {
  const base = dbKey(testInfo, "accounts");
  const alice = `${base}::alice`;
  const bob = `${base}::bob`;
  const aliceOwner = e2eWatchlistOwner(alice);
  const bobOwner = e2eWatchlistOwner(bob);
  const ALICE_NOTE = "alice 私人笔记 — only hers";
  await serverWrite(request, alice, [{ symbol: "NVDA", field: "note", value: ALICE_NOTE, baseRevision: 0 }, { symbol: "NVDA", field: "flag", value: RED, baseRevision: 0 }]);

  // An actor key (`db::actor`) gets no seeded server Default, so give each account the same rail.
  const rail = { lists: { Default: ["NVDA", "AAPL", "MSFT"].map((symbol) => ({ symbol, section: "Equities" })) } };
  await seedOwnerWatchlists(page, alice, rail);
  await seedOwnerWatchlists(page, bob, rail);

  const seen = trackAnnotationRequests(page);
  await signIn(page.context(), alice, baseURL);
  await boot(page);
  await expectSync(page, "synced");
  await expect.poll(async () => (await slot(page, E2E_WL_NOTES_KEY, aliceOwner)).NVDA).toBe(ALICE_NOTE);

  // The session changes to bob under a tab still rendered for alice (another tab signed in).
  await signIn(page.context(), bob, baseURL);
  await goOnline(page);
  await expectSync(page, "auth");
  const postsBefore = seen.filter((entry) => entry.method === "POST").length;
  if (isDesktop(testInfo)) {
    await expect(page.locator(SYNC)).toHaveText("Sync paused");
    // An edit in alice's tab is kept locally for alice and is NOT sent under bob's session.
    await menuNote(page, "AAPL", "typed after the switch");
    await page.waitForTimeout(1_500);
    await expectSync(page, "auth");
  }
  expect(seen.filter((entry) => entry.method === "POST").length).toBe(postsBefore);
  expect(await serverRead(request, bob)).toEqual([]);
  expect(await serverRead(request, alice)).toEqual([expect.objectContaining({ symbol: "NVDA", note: ALICE_NOTE, noteRevision: 1 })]);

  // ── bob's own page load in the same browser ──
  seen.length = 0;
  await boot(page);
  await expect.poll(() => seen.filter((entry) => entry.method === "GET").length, { timeout: 20_000 }).toBeGreaterThan(0);
  // Bob has nothing, so the chip stays out of the way (synced or absent) — never alice's rows.
  await expect.poll(async () => page.locator(SYNC).count()).toBe(0);
  if (isDesktop(testInfo)) {
    await expect(row(page, "NVDA").locator(".wl-note-mark")).toHaveCount(0);
    await expect(row(page, "NVDA").locator(".wl-flag-slot--set")).toHaveCount(0);
  }
  expect(seen.every((entry) => entry.owner === fixtureUserId(bob))).toBe(true);
  expect(seen.some((entry) => entry.method === "POST")).toBe(false);
  expect(await slot(page, E2E_WL_NOTES_KEY, bobOwner)).toEqual({});
  expect(await slot(page, E2E_WL_FLAGS_KEY, bobOwner)).toEqual({});
  expect(JSON.stringify(await slot(page, ANNOTATION_SYNC_KEY, bobOwner))).not.toContain("alice");
  // Alice's browser copy is still hers, untouched by bob's load.
  expect((await slot(page, E2E_WL_NOTES_KEY, aliceOwner)).NVDA).toBe(ALICE_NOTE);
  expect(await serverRead(request, bob)).toEqual([]);
});

test("AC-E05-04 — a failed save never shows Synced and never overwrites the local edit", async ({ page, request, baseURL }, testInfo) => {
  const key = dbKey(testInfo, "failed-save");
  const owner = e2eWatchlistOwner(key);
  await serverWrite(request, key, [{ symbol: "NVDA", field: "note", value: "v1 from the other device", baseRevision: 0 }]);
  await signIn(page.context(), key, baseURL);
  await recordSyncStates(page);
  await boot(page);
  await expectSync(page, "synced");
  await expect.poll(async () => (await slot(page, E2E_WL_NOTES_KEY, owner)).NVDA).toBe("v1 from the other device");

  await setFault(page.context(), ["annotations_write"], baseURL);
  const V2 = "v2 本设备 — not yet saved";
  if (isDesktop(testInfo)) {
    await resetSyncStates(page);
    await menuNote(page, "NVDA", V2);
    await expectSync(page, "retrying");
    await expect(page.locator(SYNC)).toHaveText("Not synced · 1");
    const attempt = fromFirstSave(await syncStates(page));
    expect(attempt).toContain("retrying");
    expect(attempt).not.toContain("synced");
  } else {
    await editSlot(page, E2E_WL_NOTES_KEY, owner, "NVDA", V2);
  }

  // Reload with the save still failing: the local edit survives the server read (no overwrite).
  await boot(page);
  await expectSync(page, "retrying");
  expect((await slot(page, E2E_WL_NOTES_KEY, owner)).NVDA).toBe(V2);
  if (isDesktop(testInfo)) await expect(row(page, "NVDA").locator(".wl-note-mark")).toHaveAttribute("title", V2);
  await page.waitForTimeout(2_500); // one backoff retry fires and fails again
  await expectSync(page, "retrying");
  expect(await syncStates(page)).not.toContain("synced");
  expect(await serverSymbol(request, key, "NVDA")).toMatchObject({ note: "v1 from the other device", noteRevision: 1 });

  // The save path returns: an explicit retry (desktop chip) or the network-back event (touch).
  await setFault(page.context(), [], baseURL);
  if (isDesktop(testInfo)) await page.locator(SYNC).click();
  else await goOnline(page);
  await expectSync(page, "synced");
  expect(await serverSymbol(request, key, "NVDA")).toMatchObject({ note: V2, noteRevision: 2 });
});

test("AC-E05-04 — an uncertain save (landed, response lost) resolves to its own revision, not a duplicate", async ({ page, request, baseURL }, testInfo) => {
  const key = dbKey(testInfo, "uncertain");
  const owner = e2eWatchlistOwner(key);
  const NOTE = "腾讯：等回购公告";
  await signIn(page.context(), key, baseURL);
  await setFault(page.context(), ["annotations_write_uncertain"], baseURL);
  await recordSyncStates(page);
  if (isDesktop(testInfo)) {
    await boot(page);
    await menuNote(page, "AAPL", NOTE);
  } else {
    await seedSlots(page, "u", [[E2E_WL_NOTES_KEY, owner, { AAPL: NOTE }]]);
    await boot(page);
  }
  await expectSync(page, "synced", 30_000);
  // The lost response is a failure the chip shows; Synced comes only after the retry is answered.
  const attempt = fromFirstSave(await syncStates(page));
  expect(attempt).toContain("retrying");
  expect(attempt.indexOf("synced")).toBeGreaterThan(attempt.indexOf("retrying"));
  expect(attempt[attempt.length - 1]).toBe("synced");
  expect(await serverSymbol(request, key, "AAPL")).toMatchObject({ note: NOTE, noteRevision: 1 });
});

test("AC-E05-06 — a lost network keeps local notes and says the read failed, then recovers", async ({ page, request, baseURL }, testInfo) => {
  const key = dbKey(testInfo, "network");
  const owner = e2eWatchlistOwner(key);
  await serverWrite(request, key, [{ symbol: "NVDA", field: "note", value: CJK_NOTE, baseRevision: 0 }, { symbol: "NVDA", field: "flag", value: RED, baseRevision: 0 }]);
  await signIn(page.context(), key, baseURL);
  await recordSyncStates(page);
  await boot(page);
  await expectSync(page, "synced");

  await page.route(`**${ENDPOINT}`, (route) => route.abort("internetdisconnected"));
  await boot(page);
  await expectSync(page, "readFailed");
  expect(await syncStates(page)).not.toContain("synced");
  expect((await slot(page, E2E_WL_NOTES_KEY, owner)).NVDA).toBe(CJK_NOTE);
  expect((await slot(page, E2E_WL_FLAGS_KEY, owner)).NVDA).toBe(RED);
  if (isDesktop(testInfo)) {
    await expect(page.locator(SYNC)).toHaveText("Sync read failed");
    await expect(row(page, "NVDA").locator(".wl-note-mark")).toHaveAttribute("title", CJK_NOTE);
    await expect(row(page, "NVDA").locator(".wl-flag-slot--set")).toHaveCSS("background-color", RED_RGB);
  } else {
    const nvda = await hubRow(page, "NVDA");
    await expect(nvda.locator(".s-flag-bar--set")).toHaveCSS("background-color", RED_RGB);
    await page.keyboard.press("Escape");
  }

  await page.unroute(`**${ENDPOINT}`);
  if (isDesktop(testInfo)) await page.locator(SYNC).click();
  else await goOnline(page);
  await expectSync(page, "synced");
  expect((await slot(page, E2E_WL_NOTES_KEY, owner)).NVDA).toBe(CJK_NOTE);
});

test("AC-E05-03 — concurrent edits merge disjoint fields and surface a same-field conflict", async ({ page, request, baseURL }, testInfo) => {
  const key = dbKey(testInfo, "conflict");
  const owner = e2eWatchlistOwner(key);
  const MINE = "mine · 本设备：等 118 回踩";
  const THEIRS = "theirs · 其他设备：120 上方加仓";
  await serverWrite(request, key, [{ symbol: "NVDA", field: "note", value: "shared base", baseRevision: 0 }]);
  await signIn(page.context(), key, baseURL);
  await boot(page);
  await expectSync(page, "synced");

  // This device edits the note while offline...
  await page.route(`**${ENDPOINT}`, (route) => route.abort("internetdisconnected"));
  if (isDesktop(testInfo)) {
    await menuNote(page, "NVDA", MINE);
    await expectSync(page, "retrying");
  } else {
    await editSlot(page, E2E_WL_NOTES_KEY, owner, "NVDA", MINE);
    await boot(page);
    await expectSync(page, "readFailed");
  }
  // ...while the other device changes the same note and, separately, the flag.
  await serverWrite(request, key, [{ symbol: "NVDA", field: "note", value: THEIRS, baseRevision: 1 }, { symbol: "NVDA", field: "flag", value: BLUE, baseRevision: 0 }]);

  await page.unroute(`**${ENDPOINT}`);
  await goOnline(page);
  await expectSync(page, "conflict");
  // Disjoint field: merged. Same field: neither text vanished.
  await expect.poll(async () => (await slot(page, E2E_WL_FLAGS_KEY, owner)).NVDA).toBe(BLUE);
  expect((await slot(page, E2E_WL_NOTES_KEY, owner)).NVDA).toBe(MINE);
  expect(await serverSymbol(request, key, "NVDA")).toMatchObject({ note: THEIRS, noteRevision: 2, flag: BLUE, flagRevision: 1 });

  if (!isDesktop(testInfo)) return; // the chooser lives in the desktop rail
  await expect(page.locator(SYNC)).toHaveText("Conflict · 1");
  await expect(row(page, "NVDA").locator(".wl-flag-slot--set")).toHaveCSS("background-color", BLUE_RGB);
  await page.locator(SYNC).click();
  const dialog = page.getByTestId("wl-annotation-conflict");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("wl-annotation-conflict-mine")).toContainText(MINE);
  await expect(dialog.getByTestId("wl-annotation-conflict-theirs")).toContainText(THEIRS);
  await dialog.getByRole("button", { name: "Keep this device's" }).click();
  await expect(dialog).toHaveCount(0);
  await expectSync(page, "synced");
  expect(await serverSymbol(request, key, "NVDA")).toMatchObject({ note: MINE, noteRevision: 3, flag: BLUE, flagRevision: 1 });
  await expect(row(page, "NVDA").locator(".wl-note-mark")).toHaveAttribute("title", MINE);
});

test("AC-E05-02 — guest notes are imported only after a preview, and originals stay until acknowledged", async ({ page, request, baseURL }, testInfo) => {
  const key = dbKey(testInfo, "import");
  const owner = e2eWatchlistOwner(key);
  const GUEST_NVDA = "访客笔记：观察 NVDA 财报";
  await serverWrite(request, key, [{ symbol: "AAPL", field: "note", value: "account AAPL note", baseRevision: 0 }]);
  const seen = trackAnnotationRequests(page);

  // ── signed out: the guest's own notes and flags, with no sync at all ──
  await signIn(page.context(), key, baseURL);
  await asGuest(page.context(), baseURL);
  await seedSlots(page, "guest", [
    [E2E_WL_NOTES_KEY, GUEST_OWNER, { NVDA: GUEST_NVDA, AAPL: "guest AAPL note" }],
    [E2E_WL_FLAGS_KEY, GUEST_OWNER, { MSFT: GREEN }],
  ]);
  await boot(page);
  if (isDesktop(testInfo)) await expect(row(page, "NVDA").locator(".wl-note-mark")).toHaveAttribute("title", GUEST_NVDA);
  await page.waitForTimeout(1_000);
  await expect(page.locator(SYNC)).toHaveCount(0);
  expect(seen).toEqual([]);

  // ── signs in (a new page load): nothing of the guest's is adopted implicitly ──
  await signIn(page.context(), key, baseURL);
  await boot(page);
  await expectSync(page, "synced");
  expect(await slot(page, E2E_WL_NOTES_KEY, owner)).toEqual({ AAPL: "account AAPL note" });
  expect(await slot(page, E2E_WL_FLAGS_KEY, owner)).toEqual({});
  expect(await slot(page, E2E_WL_NOTES_KEY, GUEST_OWNER)).toEqual({ NVDA: GUEST_NVDA, AAPL: "guest AAPL note" });
  expect(await slot(page, E2E_WL_FLAGS_KEY, GUEST_OWNER)).toEqual({ MSFT: GREEN });
  expect(seen.some((entry) => entry.method === "POST")).toBe(false);
  if (!isDesktop(testInfo)) return; // the import chooser lives in the desktop rail

  await expect(row(page, "NVDA").locator(".wl-note-mark")).toHaveCount(0);
  const offer = page.getByTestId("wl-annotation-import");
  await expect(offer).toHaveText("Import guest · 2");
  await offer.click();
  const dialog = page.getByTestId("wl-annotation-import-dialog");
  await expect(dialog).toBeVisible();
  const items = dialog.getByTestId("wl-annotation-import-items");
  await expect(items.locator("li")).toHaveCount(2);
  await expect(items).toContainText("NVDA");
  await expect(items).toContainText(GUEST_NVDA);
  await expect(items).toContainText("MSFT");
  await expect(items).toContainText(GREEN);
  const collisions = dialog.getByTestId("wl-annotation-import-collisions");
  await expect(collisions).toContainText("AAPL");
  await expect(collisions).toContainText("guest AAPL note");
  await expect(collisions).toContainText("account AAPL note");

  // The save fails: the import is pending, and the guest originals are all still there.
  await setFault(page.context(), ["annotations_write"], baseURL);
  await dialog.getByRole("button", { name: "Import 2" }).click();
  await expectSync(page, "retrying");
  await expect(row(page, "NVDA").locator(".wl-note-mark")).toHaveAttribute("title", GUEST_NVDA);
  expect(await slot(page, E2E_WL_NOTES_KEY, GUEST_OWNER)).toEqual({ NVDA: GUEST_NVDA, AAPL: "guest AAPL note" });
  expect(await slot(page, E2E_WL_FLAGS_KEY, GUEST_OWNER)).toEqual({ MSFT: GREEN });

  // Acknowledged: exactly the imported originals retire; the collision's guest copy stays.
  await setFault(page.context(), [], baseURL);
  await page.locator(SYNC).click();
  await expectSync(page, "synced");
  await expect.poll(async () => slot(page, E2E_WL_NOTES_KEY, GUEST_OWNER)).toEqual({ AAPL: "guest AAPL note" });
  expect(await slot(page, E2E_WL_FLAGS_KEY, GUEST_OWNER)).toEqual({});
  await expect(offer).toHaveCount(0);
  const server = await serverRead(request, key);
  expect(server.find((record) => record.symbol === "NVDA")).toMatchObject({ note: GUEST_NVDA, noteRevision: 1 });
  expect(server.find((record) => record.symbol === "MSFT")).toMatchObject({ flag: GREEN, flagRevision: 1 });
  expect(server.find((record) => record.symbol === "AAPL")).toMatchObject({ note: "account AAPL note", noteRevision: 1 });
});

test("an absent annotations table reads as 'sync off', keeps local notes and sends nothing", async ({ page, request, baseURL }, testInfo) => {
  const key = dbKey(testInfo, "unavailable");
  const owner = e2eWatchlistOwner(key);
  const seen = trackAnnotationRequests(page);
  await signIn(page.context(), key, baseURL);
  await setFault(page.context(), ["annotations_unavailable"], baseURL);
  await seedSlots(page, "x", [[E2E_WL_NOTES_KEY, owner, { NVDA: CJK_NOTE }]]);
  await boot(page);
  await expectSync(page, "unavailable");
  if (isDesktop(testInfo)) {
    await expect(page.locator(SYNC)).toHaveText("Sync off");
    await expect(row(page, "NVDA").locator(".wl-note-mark")).toHaveAttribute("title", CJK_NOTE);
  }
  await page.waitForTimeout(1_500);
  expect((await slot(page, E2E_WL_NOTES_KEY, owner)).NVDA).toBe(CJK_NOTE);
  expect(seen.some((entry) => entry.method === "POST")).toBe(false);
  expect(await serverRead(request, key)).toEqual([]);
});

// ── PR evidence: EN + ZH, dark (the shipped theme), at the project's viewport ──
test("E05 evidence crops", async ({ page, request, baseURL }, testInfo) => {
  test.skip(process.env.E05_CAPTURE !== "1", "Evidence capture runs on demand (E05_CAPTURE=1).");
  test.setTimeout(240_000);
  const out = join(process.cwd(), "docs", "pr-crops", "e05-watchlist-annotation-sync");
  mkdirSync(out, { recursive: true });
  const shot = (name: string, target: Page) => target.screenshot({ path: join(out, `${testInfo.project.name}-${name}.png`), animations: "disabled" });
  const context = page.context();

  for (const lang of ["en", "zh"] as const) {
    const zh = lang === "zh";
    const key = dbKey(testInfo, `crops-${lang}`);
    const owner = e2eWatchlistOwner(key);
    const tab = await context.newPage();
    await pinLanguage(tab, lang);
    await signIn(context, key, baseURL);
    await setFault(context, [], baseURL);

    if (!isDesktop(testInfo)) {
      await seedSlots(tab, `crops-${lang}`, [
        [E2E_WL_NOTES_KEY, owner, { NVDA: CJK_NOTE }],
        [E2E_WL_FLAGS_KEY, owner, { NVDA: RED, MSFT: GREEN, AAPL: BLUE }],
      ]);
      await boot(tab);
      await expectSync(tab, "synced");
      const nvda = await hubRow(tab, "NVDA");
      await expect(nvda.locator(".s-flag-bar--set")).toHaveCSS("background-color", RED_RGB);
      await shot(`${lang}-hub-synced`, tab);
      await tab.close();
      continue;
    }

    await serverWrite(request, key, [
      { symbol: "AAPL", field: "note", value: zh ? "账户笔记：等 230 回踩" : "Account note: wait for 230 retest", baseRevision: 0 },
      { symbol: "QQQ", field: "flag", value: BLUE, baseRevision: 0 },
    ]);
    await seedSlots(tab, `crops-${lang}`, [
      [E2E_WL_NOTES_KEY, GUEST_OWNER, { NVDA: CJK_NOTE, AAPL: zh ? "访客笔记：AAPL" : "Guest note: AAPL" }],
      [E2E_WL_FLAGS_KEY, GUEST_OWNER, { NVDA: RED, MSFT: GREEN }],
    ]);
    await boot(tab);
    await expectSync(tab, "synced");
    const offer = tab.getByTestId("wl-annotation-import");
    await expect(offer).toHaveText(zh ? "导入访客 · 3" : "Import guest · 3");
    await offer.click();
    const importDialog = tab.getByTestId("wl-annotation-import-dialog");
    await expect(importDialog).toBeVisible();
    await shot(`${lang}-import-preview`, tab);
    await importDialog.getByRole("button", { name: zh ? "导入 3 项" : "Import 3" }).click();
    await expectSync(tab, "synced");
    await expect(tab.locator(SYNC)).toHaveText(zh ? "已同步" : "Synced");
    await expect(row(tab, "NVDA").locator(".wl-note-mark")).toHaveAttribute("title", CJK_NOTE);
    await shot(`${lang}-synced`, tab);

    // A same-field conflict: this tab's edit was made offline, the other device's landed first.
    await tab.route(`**${ENDPOINT}`, (route) => route.abort("internetdisconnected"));
    await editSlot(tab, E2E_WL_NOTES_KEY, owner, "NVDA", zh ? "本设备：等 118 回踩再加仓" : "This device: add on a 118 retest");
    await boot(tab);
    await expectSync(tab, "readFailed");
    await serverWrite(request, key, [{ symbol: "NVDA", field: "note", value: zh ? "其他设备：120 上方突破确认" : "Other device: breakout confirmed above 120", baseRevision: 1 }]);
    await tab.unroute(`**${ENDPOINT}`);
    await goOnline(tab);
    await expectSync(tab, "conflict");
    await expect(tab.locator(SYNC)).toHaveText(zh ? "冲突 · 1" : "Conflict · 1");
    await tab.locator(SYNC).click();
    const conflict = tab.getByTestId("wl-annotation-conflict");
    await expect(conflict).toBeVisible();
    await shot(`${lang}-conflict`, tab);
    await conflict.getByRole("button", { name: zh ? "保留本设备版本" : "Keep this device's" }).click();
    await expectSync(tab, "synced");

    // A save that cannot land.
    await setFault(context, ["annotations_write"], baseURL);
    await editSlot(tab, E2E_WL_NOTES_KEY, owner, "MSFT", zh ? "微软：云业务指引" : "MSFT: cloud guidance");
    await boot(tab);
    await expectSync(tab, "retrying");
    await expect(tab.locator(SYNC)).toHaveText(zh ? "未同步 · 1" : "Not synced · 1");
    await shot(`${lang}-not-synced`, tab);
    await setFault(context, [], baseURL);
    await tab.close();
  }
});
