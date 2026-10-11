import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { isPhoneViewport, openIndicatorLibrary } from "./phoneChrome";
import { renderAsGuest, useLang } from "./layoutStore";

// ── E07: portable study templates ─────────────────────────────────────────────────────────────────
//
// A template carries a chart's STUDIES (ids, settings, hidden flags) and nothing else. These tests
// prove, against the running Terminal:
//   · applying one changes only `mm.inds` / `mm.indParams` / `mm.indHidden` — never the symbol,
//     drawings, watchlists, alerts, data settings or Day Trade Mode — even when the stored record
//     names those things (the falsifier: run against the pre-E07 shell, the first test fails);
//   · the preview's planned triple is exactly the triple that lands, in replace and add modes, and
//     every entry that is not applied is listed with its reason;
//   · account templates reopen on a second signed-in device, stay invisible to other accounts and
//     guests, and a stale rename is refused with a reload path;
//   · a failed account or device write never says Saved;
//   · a legacy device list keeps working and is copied to an account only on an explicit click;
//   · the library and the save dialog are fully keyboard operable at every viewport.
//
// Account storage is the e2e fixture database behind `/api/study-templates` (TERMINAL_E2E_FIXTURE),
// keyed per test by the `mm_e2e_wl` cookie, so no two tests (or reruns on a warm server) share rows.
// RSI values are proven off the canvas series through the dev-only `__mmLiveBarGeneration` witness
// and compared with a Wilder RSI computed HERE from the fixture closes.

const SYMBOL = "NVDA";
const LAST_SESSION = "2026-08-06";
const APPLIED_EVENT = "mm:study-template-applied";
const STUDY_KEYS = new Set(["mm.inds", "mm.indParams", "mm.indHidden"]);
// Account-scoped, user-owned server state a template apply must never write.
const FORBIDDEN_WRITE = /^\/api\/(drawings|watchlist|alerts|layouts|scripts|study-templates|account|me|teams|portfolio)(\/|$)/;
const UNTOUCHED_EN = "Symbol, drawings, watchlists, alerts, data settings and Day Trade Mode are not changed.";

function sessionDates(count: number, lastISO: string): string[] {
  const out: string[] = [];
  const d = new Date(`${lastISO}T00:00:00Z`);
  while (out.length < count) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

const BARS = sessionDates(262, LAST_SESSION).map((date, i) => {
  const c = Number((120 + Math.sin(i / 9) * 8 + Math.sin(i / 2.3) * 1.7 + i * 0.04).toFixed(2));
  return [date, Number((c - 0.5).toFixed(2)), Number((c + 1.1).toFixed(2)), Number((c - 1.3).toFixed(2)), c, 1_000_000 + i * 1_000] as const;
});
const CLOSES = BARS.map((b) => b[4]);
const LAST_CLOSE = CLOSES[CLOSES.length - 1];

/** Textbook Wilder RSI: SMA seed over the first `n` changes, then (prev·(n−1) + x)/n smoothing. */
function wilderRsi(closes: number[], n: number): number {
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const ch = closes[i] - closes[i - 1];
    gain += Math.max(ch, 0);
    loss += Math.max(-ch, 0);
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(ch, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-ch, 0)) / n;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

const RSI = (n: number) => wilderRsi(CLOSES, n);

// ── fixtures: stored template records ─────────────────────────────────────────────────────────────

const ISO = "2026-09-01T10:00:00.000Z";
const deviceRecord = (id: string, name: string, indicators: string[], indParams: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ id, v: 2, name, revision: 1, createdAt: ISO, updatedAt: ISO, indicators, indParams, hidden: [], ...extra });

/** A record that ALSO names workspace state. Only its studies may ever reach the chart. */
const HOSTILE = deviceRecord("ct_hostile01", "Hostile", ["rsi", "pine:evil", "nosuchstudy"], { rsi: { length: 9 } }, {
  hidden: ["cmp:QQQ"],
  symbol: "TSLA",
  tf: "5m",
  chartType: "line",
  dtm: true,
  dtmSnapshot: { tf: "1m", inds: ["vwap"] },
  drawings: [{ type: "hline", price: 1 }],
  watchlists: [{ name: "Injected", symbols: ["TSLA"] }],
  alerts: [{ symbol: "TSLA", above: 1 }],
  livePolicy: "realtime",
  favTF: ["1m"],
});
const SWING = deviceRecord("ct_preview01", "Swing pair", ["rsi", "rsi__tplb2", "bb", "nosuchstudy", "pine:evil", "macd__zz99"], {
  rsi: { length: 9 },
  rsi__tplb2: { length: 5 },
  bb: { length: 25 },
});
const FAST = deviceRecord("ct_merge01", "Fast RSI", ["rsi", "vol"], { rsi: { length: 3 } });
const KEYS = deviceRecord("ct_kbd01", "Keyboard pair", ["rsi", "vol"], { rsi: { length: 9 } });
/** The pre-E07 on-device shape: no version, revision or hidden list; `createdAt` only. */
const LEGACY_RAW = JSON.stringify([
  { id: "ct_legacy1", name: "Old swing", indicators: ["ema", "rsi"], indParams: { rsi: { length: 10 } }, createdAt: "2026-01-02T03:04:05.000Z" },
]);
const DTM_SENTINEL = JSON.stringify({ tf: "W", inds: ["sma"], note: "e07-sentinel" });

// ── harness ───────────────────────────────────────────────────────────────────────────────────────

type SeriesTail = { time: unknown; value: number | null } | null;
type Witness = { barCount: number; lastBar: { time: string | number; c: number } | null; series: Record<string, SeriesTail[]> };
type Triple = { inds: string[]; indParams: Record<string, Record<string, unknown>>; hidden: string[] };
type Plan = {
  mode: "replace" | "merge";
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
  skipped: { id: string; reason: string }[];
  next: Triple;
  noop: boolean;
};
type Receipt = { source: "account" | "device"; id: string; mode: string; noop: boolean; next: Triple | null };
type AccountRow = { id: string; name: string; revision: number; indicators: string[]; indParams: Record<string, Record<string, unknown>> };
type Seed = Record<string, string | null>;

const RUN_NONCE = `${process.env.TEST_WORKER_INDEX ?? "0"}${randomUUID().slice(0, 8)}`;

/** A fixture-account key unique to this test, run, repeat and retry (rows never leak across runs). */
function storeKey(testInfo: TestInfo, tag: string): string {
  return `e07-${tag}-${RUN_NONCE}-${testInfo.testId}-${testInfo.repeatEachIndex}-${testInfo.retry}`
    .toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 110);
}

async function asAccount(context: BrowserContext, key: string, baseURL: string) {
  await context.addCookies([{ name: "mm_e2e_wl", value: key, url: baseURL }]);
}

/** Another browser profile at the same viewport: a second device. */
async function newDevice(browser: Browser, testInfo: TestInfo, baseURL: string, cookies: { name: string; value: string }[]) {
  const context = await browser.newContext({ baseURL, viewport: testInfo.project.use.viewport, hasTouch: testInfo.project.use.hasTouch });
  await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL })));
  return context;
}

const baseSeed = (inds: string[], params: Record<string, unknown> = {}): Seed => ({
  "mm.startTf": JSON.stringify("D"),
  "mm.inds": JSON.stringify(inds),
  "mm.indParams": JSON.stringify(params),
  "mm.indHidden": "[]",
  "mm.mastermindCandles.v1": "1",
  "mm.dtm": "false",
  "mm.chartTemplates": null,
  "mm.ws": null,
});

/** Route the daily fixture; seed device storage ONCE per tab (a reload reads what the app saved). */
async function serveWorkspace(page: Page, seed: Seed) {
  await page.route(`**/data/${SYMBOL}.json`, (route) =>
    route.fulfill({ json: { t: SYMBOL, o: SYMBOL, src: "study-templates-e2e", bars: BARS } }));
  await page.route(`**/data/${SYMBOL}.slice.json`, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/api/quote?**", async (route) => {
    const syms = (new URL(route.request().url()).searchParams.get("syms") || SYMBOL).split(",").filter(Boolean);
    const seconds = Date.parse(`${LAST_SESSION}T15:00:00Z`) / 1000;
    await route.fulfill({ json: { quotes: Object.fromEntries(syms.map((sym) => [sym, sym === SYMBOL ? {
      sym, last: LAST_CLOSE, prevClose: LAST_CLOSE, chg: 0, open: LAST_CLOSE, high: LAST_CLOSE, low: LAST_CLOSE,
      vol: 12_345_678, ts: seconds, asOfMs: seconds * 1000, lagMs: 40, live: false, basis: "EOD", market: "us",
      marketSession: "rth", regularSessionDate: LAST_SESSION, regularSession: "rth", regularPrice: LAST_CLOSE, regularChg: 0,
    } : null])) } });
  });
  await page.addInitScript(([entries, eventName]) => {
    const w = window as unknown as { __e07Receipts?: unknown[] };
    w.__e07Receipts = [];
    window.addEventListener(eventName, (event) => { w.__e07Receipts!.push((event as CustomEvent).detail); });
    try {
      if (sessionStorage.getItem("e07.seeded") === "1") return;
      sessionStorage.setItem("e07.seeded", "1");
      for (const [key, value] of entries) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    } catch { /* a frame without storage access */ }
  }, [Object.entries(seed), APPLIED_EVENT] as [[string, string | null][], string]);
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    // The shared `useLang` init script also runs in frames with no documentElement yet; that is the
    // harness, not the app (its only frame is the anonymous init script). Every app error still fails.
    const harness = /^\s+at <anonymous>:\d+:\d+$/m.test(e.stack ?? "") && !/https?:\/\//.test(e.stack ?? "");
    if (!harness) errors.push(e.message);
  });
  return errors;
}

const readWitness = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mmLiveBarGeneration?: () => Witness }).__mmLiveBarGeneration?.() ?? null);
const readStore = (page: Page) =>
  page.evaluate(() => {
    const parse = (k: string) => { try { return JSON.parse(localStorage.getItem(k) ?? "null"); } catch { return null; } };
    return {
      inds: parse("mm.inds") as string[] | null,
      indParams: parse("mm.indParams") as Record<string, Record<string, unknown>> | null,
      hidden: parse("mm.indHidden") as string[] | null,
    };
  });
const readAllStorage = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null) out[key] = localStorage.getItem(key) ?? "";
    }
    return out;
  });
const readReceipts = (page: Page) =>
  page.evaluate(() => ((window as unknown as { __e07Receipts?: Receipt[] }).__e07Receipts ?? []) as Receipt[]);

const rsiIds = (w: Witness | null) => Object.keys(w?.series ?? {}).filter((k) => k === "rsi" || k.startsWith("rsi__")).sort();
const tailOf = (w: Witness | null, id: string) => w?.series[id]?.[0]?.value ?? null;
const near = (a: number | null | undefined, b: number, digits = 6) => a != null && Math.abs(a - b) < 10 ** -digits;

async function chartReady(page: Page) {
  await expect.poll(async () => {
    const w = await readWitness(page);
    return w && w.barCount === BARS.length && w.lastBar?.c === LAST_CLOSE ? "ready" : "waiting";
  }, { message: "the NVDA fixture should reach the chart", timeout: 60_000 }).toBe("ready");
}

/** Wait until exactly `count` RSI instances hold data on the canvas; returns the settled witness. */
async function settledRsi(page: Page, count: number, message: string): Promise<Witness> {
  await expect.poll(async () => {
    const w = await readWitness(page);
    if (!w || w.barCount !== BARS.length || w.lastBar?.c !== LAST_CLOSE) return "waiting";
    const ids = rsiIds(w);
    return ids.length === count && ids.every((id) => tailOf(w, id) != null) ? "ready" : `rsi=${ids.join("|")}`;
  }, { message, timeout: 60_000 }).toBe("ready");
  return (await readWitness(page))!;
}

const library = (page: Page) => page.locator("[data-study-template-library]");
const saveDialog = (page: Page) => page.locator("[data-study-template-save]");
const toast = (page: Page) => page.locator("[data-study-template-toast]");
const accountSection = (page: Page) => library(page).locator("section[data-account-state]");
const row = (page: Page, source: "account" | "device", id: string) =>
  library(page).locator(`[data-template-row="${source}"][data-template-id="${id}"]`);

/** The Indicators dialog's Tools → "Study templates" entry (the only path a user has to the library). */
async function openTemplateLibrary(page: Page): Promise<Locator> {
  await openIndicatorLibrary(page);
  const entry = page.locator(".imodal-library [data-open-study-templates]");
  await expect(entry).toBeVisible({ timeout: 20_000 });
  await entry.click();
  await expect(library(page)).toBeVisible();
  await expect(page.locator(".imodal-library")).toHaveCount(0);
  return library(page);
}

/** Select a row. On a phone the list and the preview are separate views, so go back first. */
async function pickRow(page: Page, source: "account" | "device", id: string) {
  if (isPhoneViewport(page) && (await library(page).getAttribute("data-view")) === "preview") {
    await library(page).locator("#study-template-library-title + button").click();
    await expect(library(page)).toHaveAttribute("data-view", "list");
  }
  const target = row(page, source, id);
  await target.click();
  await expect(target).toHaveAttribute("aria-current", "true");
  await expect(library(page).locator("[data-plan]")).toHaveAttribute("data-template-source", source);
}

async function readPlan(page: Page): Promise<Plan> {
  const raw = await library(page).locator("[data-plan]").getAttribute("data-plan");
  expect(raw, "the preview should carry its plan").toBeTruthy();
  return JSON.parse(raw!) as Plan;
}

async function apiList(page: Page): Promise<{ templates: AccountRow[] }> {
  const response = await page.request.get("/api/study-templates");
  expect(response.status(), "GET /api/study-templates").toBe(200);
  return response.json();
}

async function focusIsInside(page: Page, selector: string) {
  return page.evaluate((sel) => !!document.activeElement?.closest(sel), selector);
}

/** Press Tab until `target` has focus, proving focus never leaves the open dialog on the way. */
async function tabTo(page: Page, target: Locator, dialogSelector: string, max = 40) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press("Tab");
    expect(await focusIsInside(page, dialogSelector), `Tab #${i + 1} should keep focus inside the dialog`).toBe(true);
  }
  throw new Error("Tab never reached the target control");
}

const CROP_DIR = "docs/pr-crops/e07-study-templates";
async function crop(page: Page, name: string, projectName: string) {
  if (!process.env.TERMINAL_CROPS) return;
  mkdirSync(CROP_DIR, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${CROP_DIR}/${projectName}-${name}.png`, animations: "disabled" });
}

// ── AC-E07-01 (falsifier) ─────────────────────────────────────────────────────────────────────────

test("applying a template changes only the chart's studies, whatever else the record names", async ({ page, context, baseURL }, testInfo) => {
  test.slow();
  const errors = trackErrors(page);
  await useLang(page, "en");
  await asAccount(context, storeKey(testInfo, "own"), baseURL!);
  await serveWorkspace(page, {
    ...baseSeed(["ema", "vol", "bb", "macd__zz99"], { bb: { length: 30 } }),
    "mm.indHidden": JSON.stringify(["cmp:AMD", "pine:xyz"]),
    // No candles marker: the shell's own migration appends the ambient Mastermind Candles suite,
    // which a template never owns.
    "mm.mastermindCandles.v1": null,
    "mm.dtmSnapshot": DTM_SENTINEL,
    "mm.chartTemplates": JSON.stringify([HOSTILE]),
  });
  await page.goto(`/terminal?symbol=${SYMBOL}`);
  await chartReady(page);
  await expect.poll(async () => (await readStore(page)).inds ?? [], { message: "the candles migration should run", timeout: 20_000 })
    .toContain("trend");

  // Keys the app itself rewrites while idle are not attributable to the apply; find them first.
  const idleA = await readAllStorage(page);
  await page.waitForTimeout(2_000);
  const idleB = await readAllStorage(page);
  const volatile = new Set(Object.keys({ ...idleA, ...idleB }).filter((k) => idleA[k] !== idleB[k]));
  expect([...volatile].filter((k) => STUDY_KEYS.has(k) || k === "mm.dtm" || k === "mm.dtmSnapshot" || k === "mm.chartTemplates")).toEqual([]);

  const writes: string[] = [];
  page.on("request", (request) => {
    const method = request.method();
    const path = new URL(request.url()).pathname;
    if (method !== "GET" && method !== "HEAD" && path.startsWith("/api/")) writes.push(`${method} ${path}`);
  });
  const before = await readStore(page);
  expect(before.indParams?.bb?.length, "premise: a non-default Bollinger length").toBe(30);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:apply-template", { detail: { id: "ct_hostile01", mode: "replace" } })));
  await expect.poll(async () => (await readStore(page)).inds ?? [], { message: "the template's RSI should be applied", timeout: 20_000 })
    .toContain("rsi");
  await page.waitForTimeout(1_000);
  const after = await readStore(page);
  const idleC = await readAllStorage(page);

  // Excluded state: nothing outside the three study keys moved.
  const drift = Object.keys({ ...idleB, ...idleC }).filter((k) => !STUDY_KEYS.has(k) && !volatile.has(k) && idleB[k] !== idleC[k]);
  expect(drift, "only the study keys may change").toEqual([]);
  expect(idleC["mm.dtm"]).toBe("false");
  expect(idleC["mm.dtmSnapshot"]).toBe(DTM_SENTINEL);
  expect(idleC["mm.chartTemplates"]).toBe(JSON.stringify([HOSTILE]));
  testInfo.annotations.push({ type: "api-writes-after-apply", description: writes.join(", ") || "none" });
  expect(writes.filter((entry) => FORBIDDEN_WRITE.test(entry.split(" ")[1]))).toEqual([]);
  expect(new URL(page.url()).searchParams.get("symbol")).toBe(SYMBOL);
  const witness = await readWitness(page);
  expect(witness?.barCount).toBe(BARS.length);
  expect(witness?.lastBar?.c).toBe(LAST_CLOSE);

  // Owned state: the template's studies replace only the studies a template owns.
  const owned = new Set(["ema", "vol", "bb"]);
  expect(after.inds).toEqual([...(before.inds ?? []).filter((k) => !owned.has(k)), "rsi"]);
  expect(after.inds).not.toContain("pine:evil");
  expect(after.inds).not.toContain("nosuchstudy");
  for (const [key, value] of Object.entries(before.indParams ?? {})) {
    if (key !== "rsi") expect(after.indParams?.[key], `settings of ${key} are kept`).toEqual(value);
  }
  expect(after.indParams?.rsi?.length).toBe(9);
  expect(after.hidden).toEqual(before.hidden);
  const receipts = await readReceipts(page);
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toMatchObject({ source: "device", id: "ct_hostile01", mode: "replace", noop: false });
  expect(receipts[0].next).toEqual({ inds: after.inds, indParams: after.indParams, hidden: after.hidden });
  await settledRsi(page, 1, "the template's RSI(9) should draw");
  expect(errors).toEqual([]);
});

// ── AC-E07-02 / AC-E07-05 ─────────────────────────────────────────────────────────────────────────

test("the preview is exactly what Apply changes, in replace and add modes", async ({ page, context, baseURL }, testInfo) => {
  test.slow();
  const errors = trackErrors(page);
  await useLang(page, "en");
  await asAccount(context, storeKey(testInfo, "preview"), baseURL!);
  await serveWorkspace(page, {
    ...baseSeed(["ema", "rsi", "macd"], { rsi: { length: 21 } }),
    "mm.chartTemplates": JSON.stringify([SWING, FAST]),
  });
  await page.goto(`/terminal?symbol=${SYMBOL}`);
  const start = await settledRsi(page, 1, "the seeded RSI(21) should draw");
  expect(near(tailOf(start, "rsi"), RSI(21))).toBe(true);

  // ── replace ──
  await openTemplateLibrary(page);
  await pickRow(page, "device", SWING.id);
  const plan = await readPlan(page);
  expect(plan.mode).toBe("replace");
  expect(plan.added).toEqual(expect.arrayContaining(["rsi__tplb2", "bb"]));
  expect([...plan.removed].sort()).toEqual(["ema", "macd"]);
  expect(plan.changed).toContain("rsi");
  expect(Object.fromEntries(plan.skipped.map((entry) => [entry.id, entry.reason]))).toEqual({
    nosuchstudy: "unknown_study",
    "pine:evil": "not_portable",
    macd__zz99: "unsupported_multiplicity",
  });
  const skipped = library(page).locator('[data-group="skipped"] li');
  await expect(skipped).toHaveCount(3);
  await expect(skipped.and(page.locator('[data-reason="unknown_study"]'))).toContainText("Not available in this version");
  await expect(skipped.and(page.locator('[data-reason="not_portable"]'))).toContainText("Stays with the chart");
  await expect(skipped.and(page.locator('[data-reason="unsupported_multiplicity"]'))).toContainText("This study can be on a chart only once");
  await expect(library(page).locator('[data-notice="untouched"]')).toHaveText(UNTOUCHED_EN);
  await library(page).locator("[data-apply-template]").click();
  await expect(library(page)).toHaveCount(0);
  await expect(toast(page)).toHaveText("Template applied");
  let receipts = await readReceipts(page);
  expect(receipts).toHaveLength(1);
  expect(receipts[0].next).toEqual(plan.next);
  await expect.poll(() => readStore(page), { message: "the stored studies should equal the preview", timeout: 10_000 })
    .toEqual({ inds: plan.next.inds, indParams: plan.next.indParams, hidden: plan.next.hidden });
  const replaced = await settledRsi(page, 2, "the two template RSI instances should draw");
  expect(near(tailOf(replaced, "rsi"), RSI(9))).toBe(true);
  expect(near(tailOf(replaced, "rsi__tplb2"), RSI(5))).toBe(true);

  // ── add (merge): the second RSI becomes a NEW instance with its own length ──
  await openTemplateLibrary(page);
  await pickRow(page, "device", FAST.id);
  await library(page).locator('input[name="study-template-mode"][value="merge"]').check();
  await expect.poll(async () => (await readPlan(page)).mode).toBe("merge");
  const merge = await readPlan(page);
  expect(merge.removed).toEqual([]);
  expect(merge.added).toContain("vol");
  const addedRsi = merge.added.filter((id) => id.startsWith("rsi__"));
  expect(addedRsi).toHaveLength(1);
  expect(merge.next.indParams[addedRsi[0]]?.length).toBe(3);
  await library(page).locator("[data-apply-template]").click();
  await expect(library(page)).toHaveCount(0);
  receipts = await readReceipts(page);
  expect(receipts).toHaveLength(2);
  expect(receipts[1]).toMatchObject({ mode: "merge", noop: false });
  expect(receipts[1].next).toEqual(merge.next);
  await expect.poll(() => readStore(page), { message: "the stored studies should equal the add preview", timeout: 10_000 })
    .toEqual({ inds: merge.next.inds, indParams: merge.next.indParams, hidden: merge.next.hidden });
  const merged = await settledRsi(page, 3, "three independent RSI instances should draw");
  expect(near(tailOf(merged, "rsi"), RSI(9))).toBe(true);
  expect(near(tailOf(merged, "rsi__tplb2"), RSI(5))).toBe(true);
  expect(near(tailOf(merged, addedRsi[0]), RSI(3))).toBe(true);
  expect(errors).toEqual([]);
});

// ── AC-E07-03 ─────────────────────────────────────────────────────────────────────────────────────

test("account templates reopen on a second device, stay per-account and refuse a stale rename", async ({ page, context, browser, baseURL }, testInfo) => {
  test.slow();
  const errors = trackErrors(page);
  const key = storeKey(testInfo, "acct");
  await useLang(page, "en");
  await asAccount(context, key, baseURL!);
  await serveWorkspace(page, baseSeed(["ema", "rsi"], { rsi: { length: 7 } }));
  await page.goto(`/terminal?symbol=${SYMBOL}`);
  await settledRsi(page, 1, "device A's RSI(7) should draw");

  // ── device A saves to the account ──
  await openTemplateLibrary(page);
  await expect(accountSection(page)).toHaveAttribute("data-account-state", "ok", { timeout: 20_000 });
  await expect(accountSection(page)).toContainText("No templates in your account yet.");
  await library(page).getByRole("button", { name: "Save current studies" }).click();
  await expect(saveDialog(page)).toBeVisible();
  await expect(saveDialog(page).getByRole("radio", { name: /^Your account/ })).toBeChecked();
  await saveDialog(page).locator("#study-template-name").fill("Desk A");
  await saveDialog(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(saveDialog(page)).toHaveCount(0);
  await expect(toast(page)).toHaveText("Template saved to your account");
  const saved = (await apiList(page)).templates;
  expect(saved.map((t) => t.name)).toEqual(["Desk A"]);
  const deskA = saved[0];
  expect(deskA.revision).toBe(1);
  expect(deskA.indicators).toEqual(["ema", "rsi"]);
  expect(deskA.indParams.rsi?.length).toBe(7);

  // ── reload A: the row comes back from the account store; the chart already matches it ──
  await page.reload();
  await settledRsi(page, 1, "device A should restore after reload");
  await openTemplateLibrary(page);
  await expect(row(page, "account", deskA.id)).toContainText("Desk A", { timeout: 20_000 });
  await pickRow(page, "account", deskA.id);
  await expect(library(page).locator("[data-noop]")).toBeVisible();
  await expect(library(page).locator("[data-apply-template]")).toBeDisabled();

  const devices: BrowserContext[] = [];
  try {
    // ── device B, same account: the template reopens and applies ──
    const deviceB = await newDevice(browser, testInfo, baseURL!, [{ name: "mm_e2e_wl", value: key }]);
    devices.push(deviceB);
    const pageB = await deviceB.newPage();
    const errorsB = trackErrors(pageB);
    await useLang(pageB, "en");
    await serveWorkspace(pageB, baseSeed(["macd"]));
    await pageB.goto(`/terminal?symbol=${SYMBOL}`);
    await chartReady(pageB);
    await openTemplateLibrary(pageB);
    await expect(row(pageB, "account", deskA.id)).toContainText("Desk A", { timeout: 20_000 });
    await pickRow(pageB, "account", deskA.id);
    const planB = await readPlan(pageB);
    expect(planB.next.inds).toEqual(["ema", "rsi"]);
    await library(pageB).locator("[data-apply-template]").click();
    await expect(library(pageB)).toHaveCount(0);
    await expect.poll(() => readStore(pageB), { timeout: 10_000 })
      .toEqual({ inds: planB.next.inds, indParams: planB.next.indParams, hidden: planB.next.hidden });
    const appliedB = await settledRsi(pageB, 1, "device B should draw the account template's RSI(7)");
    expect(near(tailOf(appliedB, "rsi"), RSI(7))).toBe(true);

    // ── B renames (revision 1 → 2) ──
    await openTemplateLibrary(pageB);
    await pickRow(pageB, "account", deskA.id);
    await library(pageB).getByRole("button", { name: "Rename", exact: true }).click();
    await library(pageB).locator("#study-template-rename").fill("Desk B");
    await library(pageB).getByRole("button", { name: "Save name" }).click();
    await expect(toast(pageB)).toHaveText("Template renamed");
    await expect(library(pageB).locator("#study-template-preview-title")).toHaveText("Desk B");
    expect(errorsB).toEqual([]);

    // ── A still holds revision 1: its rename is refused, nothing is overwritten, Reload recovers ──
    await library(page).getByRole("button", { name: "Rename", exact: true }).click();
    await library(page).locator("#study-template-rename").fill("Desk A2");
    await library(page).getByRole("button", { name: "Save name" }).click();
    const conflict = library(page).locator('[role="alert"][data-error="conflict"]');
    await expect(conflict).toContainText("This template was changed on another device. Reload to see the latest version. Nothing was changed.");
    await expect(toast(page)).not.toHaveText("Template renamed");
    await conflict.getByRole("button", { name: "Reload" }).click();
    await expect(row(page, "account", deskA.id)).toContainText("Desk B", { timeout: 20_000 });
    const afterConflict = (await apiList(page)).templates;
    expect(afterConflict).toHaveLength(1);
    expect(afterConflict[0]).toMatchObject({ id: deskA.id, name: "Desk B", revision: 2 });

    // ── another account sees none of it, and cannot apply it by id ──
    const deviceC = await newDevice(browser, testInfo, baseURL!, [{ name: "mm_e2e_wl", value: storeKey(testInfo, "other") }]);
    devices.push(deviceC);
    const pageC = await deviceC.newPage();
    await useLang(pageC, "en");
    await serveWorkspace(pageC, baseSeed(["ema"]));
    await pageC.goto(`/terminal?symbol=${SYMBOL}`);
    await chartReady(pageC);
    await openTemplateLibrary(pageC);
    await expect(accountSection(pageC)).toHaveAttribute("data-account-state", "ok", { timeout: 20_000 });
    await expect(accountSection(pageC)).toContainText("No templates in your account yet.");
    await expect(library(pageC).locator('[data-template-row="account"]')).toHaveCount(0);
    expect((await apiList(pageC)).templates).toEqual([]);
    await library(pageC).getByRole("button", { name: "Close", exact: true }).click();
    await expect(library(pageC)).toHaveCount(0);
    const storeC = await readStore(pageC);
    await pageC.evaluate((id) => window.dispatchEvent(new CustomEvent("mm:apply-template", { detail: { id: `acct:${id}`, mode: "replace" } })), deskA.id);
    await expect(toast(pageC)).toHaveText("That template is no longer available.");
    expect(await readStore(pageC)).toEqual(storeC);

    // ── a guest has no account library at all ──
    const guest = await newDevice(browser, testInfo, baseURL!, [{ name: "mm_e2e_guest", value: "1" }]);
    devices.push(guest);
    const pageG = await guest.newPage();
    await useLang(pageG, "en");
    await serveWorkspace(pageG, baseSeed(["ema"]));
    await pageG.goto(`/terminal?symbol=${SYMBOL}`);
    await chartReady(pageG);
    await openTemplateLibrary(pageG);
    await expect(accountSection(pageG)).toHaveAttribute("data-account-state", "guest");
    await expect(accountSection(pageG)).toContainText("Sign in to see the templates saved to your account.");
    expect((await pageG.request.get("/api/study-templates")).status()).toBe(401);
  } finally {
    for (const device of devices) await device.close();
  }
  expect(errors).toEqual([]);
});

// ── AC-E07-06: failed writes never say Saved ──────────────────────────────────────────────────────

test("a refused account write keeps the dialog open and says nothing was saved", async ({ page, context, baseURL }, testInfo) => {
  test.slow();
  await useLang(page, "en");
  await asAccount(context, storeKey(testInfo, "fault"), baseURL!);
  await context.addCookies([{ name: "mm_e2e_fault", value: "workspace_settings_write", url: baseURL! }]);
  await serveWorkspace(page, baseSeed(["ema", "rsi"]));
  await page.goto(`/terminal?symbol=${SYMBOL}`);
  await settledRsi(page, 1, "the seeded RSI should draw");
  await openTemplateLibrary(page);
  await expect(accountSection(page)).toHaveAttribute("data-account-state", "ok", { timeout: 20_000 });
  await library(page).getByRole("button", { name: "Save current studies" }).click();
  await saveDialog(page).locator("#study-template-name").fill("Will fail");
  await saveDialog(page).getByRole("button", { name: "Save", exact: true }).click();
  const error = saveDialog(page).locator('[role="alert"][data-error="unavailable"]');
  await expect(error).toHaveText("Couldn’t reach your account. Nothing was saved. Try again.");
  await expect(saveDialog(page)).toBeVisible();
  await expect(saveDialog(page).locator("#study-template-name")).toHaveValue("Will fail");
  await expect(toast(page)).toHaveCount(0);
  expect((await apiList(page)).templates).toEqual([]);
});

test("a failed device write keeps the dialog open and stores nothing", async ({ page, baseURL }) => {
  test.slow();
  await useLang(page, "en");
  await renderAsGuest(page, baseURL);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(this: Storage, key: string, value: string) {
      if (key === "mm.chartTemplates") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await serveWorkspace(page, baseSeed(["ema", "rsi"]));
  await page.goto(`/terminal?symbol=${SYMBOL}`);
  await settledRsi(page, 1, "the seeded RSI should draw");
  await openTemplateLibrary(page);
  await library(page).getByRole("button", { name: "Save current studies" }).click();
  await expect(saveDialog(page).getByRole("radio")).toHaveCount(1);
  await expect(saveDialog(page).getByRole("radio", { name: /^This device/ })).toBeChecked();
  await saveDialog(page).locator("#study-template-name").fill("Will fail");
  await saveDialog(page).getByRole("button", { name: "Save", exact: true }).click();
  const error = saveDialog(page).locator('[role="alert"][data-error="write_failed"]');
  await expect(error).toHaveText("Couldn’t save on this device. Nothing was saved.");
  await expect(saveDialog(page)).toBeVisible();
  await expect(toast(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("mm.chartTemplates"))).toBeNull();
});

// ── AC-E07-04: legacy device templates ────────────────────────────────────────────────────────────

test("a legacy device list stays usable and reaches an account only on an explicit copy", async ({ page, context, browser, baseURL }, testInfo) => {
  test.slow();
  const errors = trackErrors(page);
  await useLang(page, "en");
  await asAccount(context, storeKey(testInfo, "legacy"), baseURL!);
  const puts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname === "/api/study-templates") puts.push(request.postData() ?? "");
  });
  await serveWorkspace(page, { ...baseSeed(["macd"]), "mm.chartTemplates": LEGACY_RAW });
  await page.goto(`/terminal?symbol=${SYMBOL}`);
  await chartReady(page);

  // Signing in adopts nothing on its own.
  await openTemplateLibrary(page);
  await expect(accountSection(page)).toHaveAttribute("data-account-state", "ok", { timeout: 20_000 });
  await expect(accountSection(page)).toContainText("No templates in your account yet.");
  expect(puts).toEqual([]);
  expect((await apiList(page)).templates).toEqual([]);

  const legacyRow = row(page, "device", "ct_legacy1");
  await expect(legacyRow).toContainText("Old swing");
  await expect(legacyRow).toContainText("Older format");
  await pickRow(page, "device", "ct_legacy1");
  const plan = await readPlan(page);
  expect(plan.next.inds).toEqual(["ema", "rsi"]);
  expect(plan.next.indParams.rsi?.length).toBe(10);
  expect(puts).toEqual([]);

  // The explicit, per-template copy.
  await library(page).getByRole("button", { name: "Copy to account" }).click();
  await expect(toast(page)).toHaveText("Copied to your account");
  expect(puts).toHaveLength(1);
  const copied = (await apiList(page)).templates;
  expect(copied).toHaveLength(1);
  expect(copied[0]).toMatchObject({ name: "Old swing", indicators: ["ema", "rsi"] });
  expect(copied[0].indParams.rsi?.length).toBe(10);
  await expect(row(page, "account", copied[0].id)).toContainText("Old swing");
  expect(await page.evaluate(() => localStorage.getItem("mm.chartTemplates")), "the device copy is left as it was").toBe(LEGACY_RAW);

  await page.reload();
  await chartReady(page);
  await openTemplateLibrary(page);
  await expect(row(page, "account", copied[0].id)).toContainText("Old swing", { timeout: 20_000 });
  await expect(row(page, "device", "ct_legacy1")).toContainText("Older format");
  expect(puts).toHaveLength(1);
  expect(errors).toEqual([]);

  // A guest on a legacy device: the list still works, and saves stay on the device.
  const guest = await newDevice(browser, testInfo, baseURL!, [{ name: "mm_e2e_guest", value: "1" }]);
  try {
    const pageG = await guest.newPage();
    await useLang(pageG, "en");
    await serveWorkspace(pageG, { ...baseSeed(["macd"]), "mm.chartTemplates": LEGACY_RAW });
    await pageG.goto(`/terminal?symbol=${SYMBOL}`);
    await chartReady(pageG);
    await openTemplateLibrary(pageG);
    await expect(row(pageG, "device", "ct_legacy1")).toContainText("Older format");
    await pickRow(pageG, "device", "ct_legacy1");
    await expect(library(pageG).getByRole("button", { name: "Copy to account" })).toHaveCount(0);
    await library(pageG).locator("[data-apply-template]").click();
    await expect(library(pageG)).toHaveCount(0);
    const applied = await settledRsi(pageG, 1, "the legacy template's RSI(10) should draw");
    expect(near(tailOf(applied, "rsi"), RSI(10))).toBe(true);
    const store = await readStore(pageG);
    expect(store.inds).toEqual(["ema", "rsi"]);
    expect(store.indParams?.rsi?.length).toBe(10);

    await pageG.evaluate(() => window.dispatchEvent(new CustomEvent("mm:save-template")));
    await expect(saveDialog(pageG).getByRole("radio")).toHaveCount(1);
    await expect(saveDialog(pageG).getByRole("radio", { name: /^This device/ })).toBeChecked();
    await expect(saveDialog(pageG)).toContainText("Guest templates stay on this device. Sign in to keep them on every device.");
  } finally {
    await guest.close();
  }
});

// ── AC-E07-06: keyboard ───────────────────────────────────────────────────────────────────────────

test("the library and the save dialog work from the keyboard alone", async ({ page, context, baseURL }, testInfo) => {
  test.slow();
  const errors = trackErrors(page);
  await useLang(page, "en");
  await asAccount(context, storeKey(testInfo, "keys"), baseURL!);
  await serveWorkspace(page, { ...baseSeed(["ema"]), "mm.chartTemplates": JSON.stringify([KEYS]) });
  await page.goto(`/terminal?symbol=${SYMBOL}`);
  await chartReady(page);
  const LIB = "[data-study-template-library]";
  const SAVE = "[data-study-template-save]";

  // Open from the Indicators dialog with Enter.
  await openIndicatorLibrary(page);
  const entry = page.locator(".imodal-library [data-open-study-templates]");
  await entry.focus();
  await page.keyboard.press("Enter");
  await expect(library(page)).toBeVisible();
  await expect.poll(() => focusIsInside(page, LIB), { message: "focus should move into the library" }).toBe(true);
  await expect(accountSection(page)).toHaveAttribute("data-account-state", "ok", { timeout: 20_000 });

  // Tab and Shift+Tab wrap inside the dialog.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await focusIsInside(page, LIB), `Tab #${i + 1} stays inside`).toBe(true);
  }
  const wrap = await page.evaluate((sel) => {
    const root = document.querySelector<HTMLElement>(sel)!;
    const items = Array.from(root.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])"))
      .filter((el) => el.offsetParent !== null);
    items[0].focus();
    return { count: items.length };
  }, LIB);
  expect(wrap.count).toBeGreaterThan(1);
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate((sel) => {
    const root = document.querySelector<HTMLElement>(sel)!;
    const items = Array.from(root.querySelectorAll<HTMLElement>("a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])"))
      .filter((el) => el.offsetParent !== null);
    return document.activeElement === items[items.length - 1];
  }, LIB), "Shift+Tab on the first control wraps to the last").toBe(true);
  await page.keyboard.press("Tab");
  expect(await focusIsInside(page, LIB)).toBe(true);

  // Choose a template, switch to "Add to chart" with the arrow keys, apply with Enter.
  const target = row(page, "device", KEYS.id);
  await tabTo(page, target, LIB);
  await page.keyboard.press("Enter");
  await expect(target).toHaveAttribute("aria-current", "true");
  await expect(library(page).locator("[data-plan]")).toBeVisible();
  await expect.poll(() => focusIsInside(page, LIB), { message: "focus stays in the dialog after choosing a row" }).toBe(true);
  await tabTo(page, library(page).locator('input[name="study-template-mode"][value="replace"]'), LIB);
  await page.keyboard.press("ArrowDown");
  await expect(library(page).locator('input[name="study-template-mode"][value="merge"]')).toBeChecked();
  await expect.poll(async () => (await readPlan(page)).mode).toBe("merge");
  const plan = await readPlan(page);
  await tabTo(page, library(page).locator("[data-apply-template]"), LIB);
  await page.keyboard.press("Enter");
  await expect(library(page)).toHaveCount(0);
  await expect.poll(() => readStore(page), { timeout: 10_000 })
    .toEqual({ inds: plan.next.inds, indParams: plan.next.indParams, hidden: plan.next.hidden });
  expect(plan.next.inds).toEqual(["ema", "rsi", "vol"]);

  // Escape closes the library.
  await openIndicatorLibrary(page);
  await entry.focus();
  await page.keyboard.press("Enter");
  await expect(library(page)).toBeVisible();
  await expect.poll(() => focusIsInside(page, LIB)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(library(page)).toHaveCount(0);

  // Save by keyboard: the name field takes focus, Enter submits.
  await openIndicatorLibrary(page);
  await entry.focus();
  await page.keyboard.press("Enter");
  await expect(library(page)).toBeVisible();
  await tabTo(page, library(page).getByRole("button", { name: "Save current studies" }), LIB);
  await page.keyboard.press("Enter");
  await expect(saveDialog(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? "")).toBe("study-template-name");
  await page.keyboard.type("Keyboard desk");
  await page.keyboard.press("Enter");
  await expect(saveDialog(page)).toHaveCount(0);
  await expect(toast(page)).toHaveText("Template saved to your account");
  expect((await apiList(page)).templates.map((t) => t.name)).toEqual(["Keyboard desk"]);

  // Escape abandons a save: nothing is written.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:save-template")));
  await expect(saveDialog(page)).toBeVisible();
  await expect.poll(() => focusIsInside(page, SAVE)).toBe(true);
  await page.keyboard.type("Abandoned");
  await page.keyboard.press("Escape");
  await expect(saveDialog(page)).toHaveCount(0);
  expect((await apiList(page)).templates.map((t) => t.name)).toEqual(["Keyboard desk"]);
  expect(errors).toEqual([]);
});

// ── screenshots (EN / ZH, dark) ───────────────────────────────────────────────────────────────────

for (const lang of ["en", "zh"] as const) {
  test(`study template dialogs read correctly in ${lang}`, async ({ page, context, baseURL }, testInfo) => {
    test.slow();
    const errors = trackErrors(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await useLang(page, lang);
    await asAccount(context, storeKey(testInfo, `crop-${lang}`), baseURL!);
    await serveWorkspace(page, {
      ...baseSeed(["ema", "rsi", "macd"], { rsi: { length: 21 } }),
      "mm.chartTemplates": JSON.stringify([SWING, JSON.parse(LEGACY_RAW)[0]]),
    });
    await page.goto(`/terminal?symbol=${SYMBOL}`);
    await settledRsi(page, 1, "the seeded RSI should draw");
    const en = lang === "en";

    await openIndicatorLibrary(page);
    const entry = page.locator(".imodal-library [data-open-study-templates]");
    await expect(entry).toHaveText(en ? "Study templates" : "指标模板");
    await entry.scrollIntoViewIfNeeded();
    await crop(page, `tools-entry-${lang}`, testInfo.project.name);
    await entry.click();
    await expect(library(page).locator("#study-template-library-title")).toHaveText(en ? "Study templates" : "指标模板");
    await expect(accountSection(page)).toHaveAttribute("data-account-state", "ok", { timeout: 20_000 });
    await expect(row(page, "device", "ct_legacy1")).toContainText(en ? "Older format" : "旧格式");
    await pickRow(page, "device", SWING.id);
    await expect(library(page).locator('[data-group="skipped"] [data-reason="unknown_study"]')).toContainText(en ? "Not available in this version" : "此版本不可用");
    await expect(library(page).locator('[data-notice="untouched"]')).toHaveText(en ? UNTOUCHED_EN : "代码、画线、自选列表、提醒、数据设置和日内交易模式均不会改变。");
    await expect(library(page).locator("[data-apply-template]")).toHaveText(en ? "Apply" : "应用");
    await crop(page, `library-preview-${lang}`, testInfo.project.name);

    await library(page).getByRole("button", { name: en ? "Save current studies" : "保存当前指标" }).click();
    await expect(saveDialog(page).locator("#study-template-save-title")).toHaveText(en ? "Save study template" : "保存指标模板");
    await saveDialog(page).locator("#study-template-name").fill(en ? "Swing desk" : "波段模板");
    await crop(page, `save-${lang}`, testInfo.project.name);
    expect(errors).toEqual([]);
  });
}
