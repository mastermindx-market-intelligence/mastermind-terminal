#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This capture tool is intentionally CommonJS. */
/**
 * EOD structure belt, Flow Desk chain heat and Heatmap flow layer failure-state truth — dark
 * evidence crops.
 *
 * A read that did not land is not an absence. On the GEX desk's EOD belt a failed off-exchange
 * read renders the panel's load error, and a failed structure store renders "could not load" in
 * its own cells with a partial-error Retry beside the cells that did land; only a 404 says "not
 * published". The Flow Desk's chain-heat rail renders a load error instead of loading for ever.
 * The Heatmap's flow layer tells a failed read, a published absence (404 from both sources) and
 * a refused route (403, no public copy) apart; the live-quote note stops saying "live" when the
 * quote read did not land; and a search that hides every tile says so instead of "No data".
 *
 * Every state is produced by the real failure injected with page.route, never by a component
 * prop. The *-retried states lift the injection, click Retry, and crop what the same document
 * recovers to. The *-refresh-failed states let a healthy read land, fail the store, and move
 * the page clock past two polls: the first poll serves the cached read and revalidates in the
 * background (the failure evicts it), the second asks the store and is refused.
 *
 * The heatmap-flow-persisted-* states are the flow layer's refresh failure as a browser meets it.
 * A first visit reads the flow index from its static copy (/data/flow_idx.json, which next dev
 * does not publish, so it answers with the fixture route's flow_idx payload) and dataCache writes
 * it through to IndexedDB. The record is then re-stamped as an earlier session's read, and the
 * page reloads with both flow sources failing (503, or the connection refused). The layer paints
 * the disk copy, its background refresh fails, and the tiles stay labelled as the last read.
 *
 * The GEX desk refuses /api/flow/stream: its fixture producer would push the very payload the
 * injected /api/flow answer withholds, and the belt's classified reads are what is captured.
 *
 * Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator; FLOW_FIXTURE serves the healthy reads.
 *
 * From terminal/:
 *   node e2e/tools/capture_eod_heatmap_flowdesk_load_failure.cjs
 *
 * For a Heatmap-only source change:
 *   CAPTURE_ONLY='^heatmap-' UPDATE_HEATMAP_EVIDENCE=1 node e2e/tools/capture_eod_heatmap_flowdesk_load_failure.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/eod-heatmap-flowdesk-load-failure/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "eod-heatmap-flowdesk-load-failure");
const LAYOUT_FILES = [
  "terminal/app/globals.css",
  "terminal/components/eodcontext/DarkPoolMini.tsx",
  "terminal/components/eodcontext/EodContextBelt.tsx",
  "terminal/components/eodcontext/StructureStrip.tsx",
  "terminal/components/eodcontext/eodStrings.ts",
  "terminal/components/flowdesk/FlowDeskView.tsx",
  "terminal/components/gexdesk/GexDeskView.tsx",
  "terminal/components/heatmap/HeatmapView.tsx",
  "terminal/lib/dataCache.ts",
  "terminal/lib/eodContext.ts",
  "terminal/lib/flowdeskStrings.ts",
  "terminal/lib/heatmapStrings.ts",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3566);
const BASE = `http://127.0.0.1:${PORT}`;
const URLS = {
  belt: "/options?tab=gex",
  desk: "/options?tab=desk",
  heatmap: "/discover?tab=heatmap",
};
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  820: { width: 820, height: 1180 },
  390: { width: 390, height: 844 },
};
const POLL_MS = { desk: 45_000, heatmap: 60_000 };
const SIX_HOURS = 6 * 60 * 60_000;
const STATIC_FLOW = "/data/flow_idx.json";
// Chromium re-rasters only the invalidated rect of a tile by default, so anti-aliased edges
// depend on the tile's raster history and drift between identical runs.
const BROWSER_ARGS = ["--disable-partial-raster"];

/**
 * Injected answer per read key ("<f-param>" for /api/flow, else the pathname); anything
 * unlisted reaches the fixture server.
 * `heal`: those injections are lifted and Retry clicked before the crop.
 * `failAfter`: a healthy read lands first, then these keys fail and the clock passes two polls.
 * `persisted`: the static flow index answers with the fixture's payload, is written to IndexedDB
 * and aged six hours, then both flow sources answer this way ("503" or "abort") and the page reloads.
 */
const STATES = {
  "eod-darkpool-unavailable": { board: "belt", replies: { darkpool: "503" } },
  "eod-darkpool-retried": { board: "belt", replies: { darkpool: "503" }, heal: ["darkpool"] },
  "eod-darkpool-absent": { board: "belt", replies: { darkpool: "404" } },
  "eod-structure-partial": {
    board: "belt",
    replies: { oiconf: "503", "moves:SPY": "503", "vol:SPY": "abort" },
  },
  "eod-structure-retried": {
    board: "belt",
    replies: { oiconf: "503", "moves:SPY": "503", "vol:SPY": "abort" },
    heal: ["oiconf", "moves:SPY", "vol:SPY"],
  },
  "eod-structure-unavailable": {
    board: "belt",
    replies: { "gexstate:SPY": "503", "gex:SPY": "503", oiconf: "503", "moves:SPY": "503", "vol:SPY": "503" },
  },
  "eod-structure-absent": { board: "belt", replies: { oiconf: "404", "moves:SPY": "404", "vol:SPY": "404" } },
  "chainheat-unavailable": { board: "desk", replies: { chainheat: "503" } },
  "chainheat-retried": { board: "desk", replies: { chainheat: "503" }, heal: ["chainheat"] },
  "chainheat-absent": { board: "desk", replies: { chainheat: "404" } },
  "chainheat-refresh-failed": { board: "desk", replies: {}, failAfter: ["chainheat"] },
  "heatmap-flow-unavailable": { board: "heatmap", replies: { flow_idx: "503", "/data/flow_idx.json": "abort" } },
  "heatmap-flow-retried": {
    board: "heatmap",
    replies: { flow_idx: "503", "/data/flow_idx.json": "abort" },
    heal: ["flow_idx", "/data/flow_idx.json"],
  },
  "heatmap-flow-absent": { board: "heatmap", replies: { flow_idx: "404", "/data/flow_idx.json": "404" } },
  "heatmap-flow-auth": { board: "heatmap", replies: { flow_idx: "403", "/data/flow_idx.json": "404" } },
  "heatmap-flow-refresh-failed": {
    board: "heatmap",
    replies: {},
    failAfter: ["flow_idx", "/data/flow_idx.json"],
  },
  "heatmap-flow-persisted-refresh-failed": { board: "heatmap", replies: { flow_idx: "503" }, persisted: "503" },
  "heatmap-flow-persisted-refresh-refused": { board: "heatmap", replies: { flow_idx: "503" }, persisted: "abort" },
  "heatmap-flow-persisted-retried": {
    board: "heatmap",
    replies: { flow_idx: "503" },
    persisted: "503",
    heal: ["flow_idx", STATIC_FLOW],
  },
  "heatmap-live-failed": { board: "heatmap", replies: { "/api/quote": "503" } },
  "heatmap-no-match": { board: "heatmap", replies: {}, search: "zzzzq" },
};

const COPY = {
  en: {
    retry: "Retry",
    beltAria: "End-of-day options structure context",
    dpAria: "Dark pool positioning context",
    dpLoadError: "Could not load the off-exchange panel",
    dpUnavailable: "Off-exchange panel unavailable",
    cellLoadFailed: "could not load",
    cellAbsent: "not published",
    beltLoadError: "Could not load the settled structure",
    chainLoading: "Loading chain heat…",
    chainError: "Could not load chain heat",
    chainAbsent: "No chain heat published for this session yet",
    chainRefreshFailed: "Could not refresh chain heat",
    layerFlow: "FLOW",
    toneNote: "Positioning tone from the change in open interest",
    flowLoadError: "Could not load the flow layer",
    noFlowData: "Flow data unavailable — showing price layer",
    flowAuth: "Flow layer needs live options access — showing price layer",
    flowRefreshFailed: "Could not refresh the flow layer — showing the last read.",
    liveFailed: "Live quotes could not load — all values EOD",
    searchPlaceholder: "Search ticker…",
    noMatch: (q) => `No names match “${q}”`,
    clearSearch: "Clear search",
    noData: "No data available",
  },
  zh: {
    retry: "重试",
    beltAria: "收盘期权结构背景",
    dpAria: "暗池仓位背景",
    dpLoadError: "无法加载场外成交面板",
    dpUnavailable: "场外成交面板不可用",
    cellLoadFailed: "无法加载",
    cellAbsent: "未发布",
    beltLoadError: "无法加载已结算的结构",
    chainLoading: "加载链式热度中…",
    chainError: "无法加载链式热度",
    chainAbsent: "本交易时段尚未发布链式热度",
    chainRefreshFailed: "无法刷新链式热度",
    layerFlow: "资金流",
    toneNote: "持仓倾向来自未平仓合约的变化",
    flowLoadError: "无法加载资金流图层",
    noFlowData: "资金流数据不可用 — 显示价格层",
    flowAuth: "资金流图层需要实时期权权限 — 显示价格层",
    flowRefreshFailed: "无法刷新资金流图层 — 显示上次读取的数据。",
    liveFailed: "实时报价无法加载 — 全部为昨收",
    searchPlaceholder: "搜索代码…",
    noMatch: (q) => `没有与“${q}”匹配的名称`,
    clearSearch: "清除搜索",
    noData: "暂无数据",
  },
};

mkdirSync(OUT, { recursive: true });

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function cropName(state, width, lang) {
  return `${state}-${width}${lang === "zh" ? "-zh" : ""}.png`;
}

function startServer() {
  const env = {
    ...process.env,
    ANALYSIS_LOCAL_PREVIEW: "1",
    ADMIN_DEV: "1",
    TERMINAL_E2E_FIXTURE: "1",
    TERMINAL_E2E_EMAIL: "responsive@example.com",
    TERMINAL_E2E_ENTITLEMENT: "unlimited",
    RATE_LIMIT_MAX: "100000",
    FLOW_FIXTURE: "1",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
  };
  const child = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(PORT)], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout.on("data", (buf) => {
    const line = String(buf);
    if (/Ready|compiled|error|Error/i.test(line)) process.stdout.write(`[dev] ${line}`);
  });
  child.stderr.on("data", (buf) => process.stderr.write(`[dev:err] ${buf}`));
  return child;
}

function stopServer(child) {
  if (!child || !child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
  }
}

/** Ready only when the page AND the fixture flow route answer 200: a broken `next dev` 404s every route. */
async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "not tried";
  while (Date.now() < deadline) {
    try {
      const page = await fetch(`${BASE}${URLS.belt}`, { redirect: "manual" });
      const flow = await fetch(`${BASE}/api/flow?f=chainheat`);
      last = `page ${page.status}, flow ${flow.status}`;
      if (page.status === 200 && flow.status === 200) return;
    } catch (err) {
      last = err.cause?.code || err.message;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`dev server on ${PORT} never answered (${last})`);
}

const keyOf = (url) => (url.pathname === "/api/flow" ? url.searchParams.get("f") ?? "" : url.pathname);

async function newPage(browser, width, lang, board, replies, withClock) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[width],
    hasTouch: width !== 1440,
    locale: lang === "zh" ? "zh-CN" : "en-US",
    colorScheme: "dark",
  });
  await context.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    localStorage.setItem("flowdesk.tutorial.seen", "1");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
  }, lang);
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  // Installed before the first script runs, so every poll interval is on the page clock.
  if (withClock) await page.clock.install();
  if (board === "belt") await page.route((url) => url.pathname === "/api/flow/stream", (route) => route.abort("failed"));
  await page.route(
    (url) => replies[keyOf(url)] != null,
    async (route) => {
      const reply = replies[keyOf(new URL(route.request().url()))];
      // A JSON reply serves that body with a 200, so a source with no file in dev can still answer.
      if (typeof reply === "object") return route.fulfill({ status: 200, json: reply.json });
      switch (reply) {
        case "503": return route.fulfill({ status: 503, json: { error: "feed unavailable" } });
        case "404": return route.fulfill({ status: 404, json: { error: "not published" } });
        case "403": return route.fulfill({ status: 403, json: { error: "forbidden" } });
        case "abort": return route.abort("failed");
        default: return route.fallback();
      }
    },
  );
  return { context, page };
}

async function stripDevOverlay(page) {
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
  });
}

async function assertNoNextIndicator(page, file) {
  await page.waitForTimeout(400);
  await stripDevOverlay(page);
  const n = await page.locator("[data-nextjs-dev-tools-button]").count();
  if (n > 0) {
    throw new Error(`${file}: Next.js N overlay still mounted (${n}); TERMINAL_E2E_FIXTURE gate failed`);
  }
}

/** Crop the union of the given boxes, clamped to the viewport. */
async function cropBoxes(page, boxes, outPath, pad) {
  const vp = page.viewportSize();
  if (!vp || boxes.some((b) => !b)) throw new Error(`no box for ${outPath}`);
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  const x = Math.max(0, Math.floor(left - pad));
  const y = Math.max(0, Math.floor(top - pad));
  const width = Math.max(8, Math.min(vp.width - x, Math.ceil(right - left + pad * 2)));
  const height = Math.max(8, Math.min(vp.height - y, Math.ceil(bottom - top + pad * 2)));
  await page.screenshot({ path: outPath, clip: { x, y, width, height }, animations: "disabled" });
}

async function expectNone(locator, why) {
  if (await locator.count()) throw new Error(why);
}

async function waitUntil(check, why, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(why);
}

/** The fixture route's flow index, served as the static copy next dev does not publish. */
let flowIdxPayload = null;
async function staticFlowReply() {
  if (!flowIdxPayload) {
    const res = await fetch(`${BASE}/api/flow?f=flow_idx`);
    if (!res.ok) throw new Error(`the fixture flow_idx read answered ${res.status}`);
    flowIdxPayload = await res.json();
  }
  return { json: flowIdxPayload };
}

/** The persisted flow index record's timestamp in dataCache's IndexedDB, or null when there is none. */
function persistedTs(page) {
  return page.evaluate((url) => new Promise((resolve) => {
    const open = indexedDB.open("mm-data-cache");
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("json")) { db.close(); resolve(null); return; }
      const get = db.transaction("json", "readonly").objectStore("json").get(url);
      get.onsuccess = () => { db.close(); resolve(get.result ? get.result.ts : null); };
      get.onerror = () => { db.close(); resolve(null); };
    };
  }), STATIC_FLOW);
}

/** Re-stamp the persisted flow index record as an earlier session's read, `ageMs` old. */
function agePersisted(page, ageMs) {
  return page.evaluate(({ url, ageMs }) => new Promise((resolve) => {
    const open = indexedDB.open("mm-data-cache");
    open.onerror = () => resolve(false);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("json", "readwrite");
      const store = tx.objectStore("json");
      const get = store.get(url);
      get.onsuccess = () => { if (get.result) store.put({ ...get.result, ts: Date.now() - ageMs }); };
      tx.oncomplete = () => { db.close(); resolve(Boolean(get.result)); };
      tx.onerror = () => { db.close(); resolve(false); };
    };
  }), { url: STATIC_FLOW, ageMs });
}

/** Pass two polls: the first serves the cached read and revalidates (the failure evicts it); the second is refused. */
async function failThenPoll(page, replies, keys, pollMs) {
  for (const key of keys) replies[key] = "503";
  for (let i = 0; i < 2; i++) {
    await page.clock.fastForward(pollMs);
    await page.waitForTimeout(600);
  }
}

/** Park the pointer off the surface after a Retry, so a hover tooltip from the clicked spot never lands in a crop. */
async function parkPointer(page) {
  await page.mouse.move(0, 0);
}

async function heal(page, replies, keys, retries) {
  for (const key of keys) delete replies[key];
  for (const retry of retries) await retry.click();
  await parkPointer(page);
}

async function captureBelt(page, lang, state, replies, outPath) {
  const copy = COPY[lang];
  const { heal: healKeys } = STATES[state];
  const structure = page.getByRole("region", { name: copy.beltAria, exact: true });
  const darkpool = page.getByRole("region", { name: copy.dpAria, exact: true });
  const belt = structure.locator("xpath=..");
  const dpError = page.getByTestId("eod-darkpool-load-error");
  const partial = page.getByTestId("eod-structure-partial-error");
  const whole = page.getByTestId("eod-structure-load-error");
  const failedCells = ["expMove", "ivPct", "oiConf"];

  if (state.startsWith("eod-darkpool-")) {
    if (state === "eod-darkpool-absent") {
      await darkpool.getByText(copy.dpUnavailable).waitFor({ state: "visible" });
      await expectNone(darkpool.getByRole("button", { name: copy.retry, exact: true }), `${state}: a published absence must offer nothing to retry`);
    } else {
      await dpError.getByText(copy.dpLoadError).waitFor({ state: "visible" });
      const retry = dpError.getByRole("button", { name: copy.retry, exact: true });
      await retry.waitFor({ state: "visible" });
      await expectNone(page.getByText(copy.dpUnavailable), `${state}: a failed read shown as an unpublished panel`);
      if (healKeys) {
        await heal(page, replies, healKeys, [retry]);
        await dpError.waitFor({ state: "detached" });
        await expectNone(page.getByText(copy.dpUnavailable), `${state}: the re-read landed as an absence`);
      }
    }
  } else if (state === "eod-structure-unavailable") {
    await whole.getByText(copy.beltLoadError).waitFor({ state: "visible" });
    await whole.getByRole("button", { name: copy.retry, exact: true }).waitFor({ state: "visible" });
  } else if (state === "eod-structure-absent") {
    for (const key of failedCells) await page.getByTestId(`eod-cell-${key}`).getByText(copy.cellAbsent).waitFor({ state: "visible" });
    await expectNone(partial, `${state}: a published absence offered a retry`);
    await expectNone(whole, `${state}: a published absence shown as a failed read`);
  } else {
    await partial.waitFor({ state: "visible" });
    for (const key of failedCells) {
      await page.getByTestId(`eod-cell-${key}`).getByText(copy.cellLoadFailed).waitFor({ state: "visible" });
      await expectNone(page.getByTestId(`eod-cell-${key}`).getByText(copy.cellAbsent), `${state}: a failed read shown as "not published"`);
    }
    const retry = partial.getByRole("button", { name: copy.retry, exact: true });
    await retry.waitFor({ state: "visible" });
    if (healKeys) {
      await heal(page, replies, healKeys, [retry]);
      await partial.waitFor({ state: "detached" });
      for (const key of failedCells) await expectNone(page.getByTestId(`eod-cell-${key}`).getByText(copy.cellLoadFailed), `${state}: ${key} outlived the re-read`);
    }
  }
  await belt.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const target = state.startsWith("eod-darkpool-") ? darkpool : belt;
  await target.scrollIntoViewIfNeeded();
  await cropBoxes(page, [await target.boundingBox()], outPath, 0);
}

async function captureDesk(page, lang, state, replies, outPath) {
  const copy = COPY[lang];
  const { heal: healKeys, failAfter } = STATES[state];
  const rail = page.locator('[data-tut="chain-heat"]');
  const loadError = rail.getByTestId("chainheat-load-error");
  const row = rail.locator(".obs-fd-chain-row").first();

  if (state === "chainheat-absent") {
    await rail.getByTestId("chainheat-absent").getByText(copy.chainAbsent).waitFor({ state: "visible" });
    await expectNone(rail.getByRole("button", { name: copy.retry, exact: true }), `${state}: a published absence must offer nothing to retry`);
  } else if (failAfter) {
    await row.waitFor({ state: "visible" });
    await failThenPoll(page, replies, failAfter, POLL_MS.desk);
    await rail.getByTestId("chainheat-refresh-failed").getByText(copy.chainRefreshFailed).waitFor({ state: "visible" });
    await row.waitFor({ state: "visible" });
    await expectNone(loadError, `${state}: a failed refresh withdrew the campaigns`);
  } else {
    await loadError.getByText(copy.chainError).waitFor({ state: "visible" });
    const retry = loadError.getByRole("button", { name: copy.retry, exact: true });
    await retry.waitFor({ state: "visible" });
    await expectNone(rail.getByText(copy.chainLoading), `${state}: a failed read shown as loading`);
    if (healKeys) {
      await heal(page, replies, healKeys, [retry]);
      await row.waitFor({ state: "visible" });
      await expectNone(loadError, `${state}: the load error outlived the re-read`);
    }
  }
  await rail.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await cropBoxes(page, [await rail.boundingBox()], outPath, 0);
}

async function captureHeatmap(page, lang, state, replies, outPath) {
  const copy = COPY[lang];
  const { heal: healKeys, failAfter, search, persisted } = STATES[state];
  const breadth = page.getByTestId("heatmap-breadth");
  const controls = page.locator('[data-tut="heatmap-controls"]');
  const canvas = page.locator('[data-tut="heatmap-canvas"]');
  await breadth.getByText(/\(\d+%\)/).waitFor({ state: "visible" });

  if (state === "heatmap-live-failed") {
    const note = page.getByTestId("heatmap-live-note");
    await note.getByText(copy.liveFailed).waitFor({ state: "visible" });
    if ((await note.getAttribute("data-state")) !== "failed") throw new Error(`${state}: the note is not in its failed state`);
    await breadth.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await cropBoxes(page, [await breadth.boundingBox()], outPath, 0);
    return;
  }

  if (search) {
    await page.getByRole("textbox", { name: copy.searchPlaceholder }).fill(search);
    const noMatch = page.getByTestId("heatmap-no-match");
    await noMatch.getByText(copy.noMatch(search)).waitFor({ state: "visible" });
    await noMatch.getByRole("button", { name: copy.clearSearch, exact: true }).waitFor({ state: "visible" });
    await expectNone(canvas.getByText(copy.noData, { exact: true }), `${state}: a filtered board shown as no data`);
    await controls.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await cropBoxes(page, [await controls.boundingBox(), await noMatch.boundingBox()], outPath, 0);
    return;
  }

  const flowButton = controls.getByRole("button", { name: copy.layerFlow, exact: true });
  await flowButton.click();
  const note = page.getByText(copy.toneNote);
  let bar;
  if (persisted) {
    await note.waitFor({ state: "visible" });
    await waitUntil(async () => (await persistedTs(page)) != null, `${state}: the flow index was never written through to IndexedDB`);
    if (!(await agePersisted(page, SIX_HOURS))) throw new Error(`${state}: could not age the persisted flow index`);
    replies.flow_idx = persisted;
    replies[STATIC_FLOW] = persisted;
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
    await breadth.getByText(/\(\d+%\)/).waitFor({ state: "visible" });
    // The layer is plain view state, so the reload is back on the price layer.
    await flowButton.click();
    bar = page.getByTestId("heatmap-flow-refresh-failed");
    await bar.getByText(copy.flowRefreshFailed).waitFor({ state: "visible" });
    await note.waitFor({ state: "visible" });
    await expectNone(page.getByTestId("heatmap-flow-load-error"), `${state}: a failed refresh withdrew the persisted flow tiles`);
    await expectNone(page.getByText(copy.noFlowData), `${state}: a failed refresh shown as missing flow data`);
    await expectNone(page.getByTestId("heatmap-refresh-failed"), `${state}: the manifest was labelled for the flow layer's failure`);
    if ((await persistedTs(page)) == null) throw new Error(`${state}: the failed refresh dropped the disk copy`);
    if (healKeys) {
      await heal(page, replies, healKeys, [bar.getByRole("button", { name: copy.retry, exact: true })]);
      await bar.waitFor({ state: "detached" });
      await note.waitFor({ state: "visible" });
      await expectNone(page.getByTestId("heatmap-flow-load-error"), `${state}: the re-read failed`);
      bar = note;
    }
  } else if (state === "heatmap-flow-absent") {
    bar = page.getByTestId("heatmap-flow-absent");
    await bar.getByText(copy.noFlowData).waitFor({ state: "visible" });
    await expectNone(page.getByRole("button", { name: copy.retry, exact: true }), `${state}: a published absence must offer nothing to retry`);
  } else if (state === "heatmap-flow-auth") {
    bar = page.getByTestId("heatmap-flow-auth");
    await bar.getByText(copy.flowAuth).waitFor({ state: "visible" });
    await expectNone(page.getByTestId("heatmap-flow-load-error"), `${state}: an access answer shown as a failed read`);
  } else if (failAfter) {
    await note.waitFor({ state: "visible" });
    await failThenPoll(page, replies, failAfter, POLL_MS.heatmap);
    bar = page.getByTestId("heatmap-flow-refresh-failed");
    await bar.getByText(copy.flowRefreshFailed).waitFor({ state: "visible" });
    await note.waitFor({ state: "visible" });
    await expectNone(page.getByTestId("heatmap-flow-load-error"), `${state}: a failed refresh withdrew the flow tiles`);
  } else {
    const loadError = page.getByTestId("heatmap-flow-load-error");
    await loadError.getByText(copy.flowLoadError).waitFor({ state: "visible" });
    const retry = loadError.getByRole("button", { name: copy.retry, exact: true });
    await retry.waitFor({ state: "visible" });
    await expectNone(page.getByText(copy.noFlowData), `${state}: a failed read shown as missing flow data`);
    bar = loadError;
    if (healKeys) {
      await heal(page, replies, healKeys, [retry]);
      await note.waitFor({ state: "visible" });
      await expectNone(loadError, `${state}: the load error outlived the re-read`);
      bar = note;
    }
  }
  await controls.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const barBox = await bar.boundingBox();
  const canvasBox = await canvas.boundingBox();
  if (!barBox || !canvasBox) throw new Error(`${state}: flow bar or canvas not laid out`);
  // The controls, the bar this state is about, and the first rows of tiles below it.
  await cropBoxes(page, [await controls.boundingBox(), barBox, { ...canvasBox, height: Math.min(canvasBox.height, 180) }], outPath, 0);
}

const CAPTURE = { belt: captureBelt, desk: captureDesk, heatmap: captureHeatmap };

const HEATMAP_SOURCE = "terminal/components/heatmap/HeatmapView.tsx";
const HEATMAP_CROPS = Object.keys(STATES).filter((state) => STATES[state].board === "heatmap")
  .flatMap((state) => [1440, 820, 390].flatMap((width) => ["en", "zh"].map((lang) => cropName(state, width, lang))))
  .sort();

/** Only actual complete Heatmap captures may replace its lock; other boards keep their provenance. */
function updateHeatmapEvidence(previous, { files, layoutFiles, cropHashes, capturedAtHead, capturedAt }) {
  if (JSON.stringify([...files].sort()) !== JSON.stringify(HEATMAP_CROPS)) {
    throw new Error(`scoped evidence requires all ${HEATMAP_CROPS.length} Heatmap crops, with no duplicate or unrelated capture`);
  }
  const recorded = {};
  const layoutAt = previous.indexOf("\nlayoutFiles:\n");
  const filesAt = previous.indexOf("\nfiles:\n");
  if (layoutAt < 0 || filesAt < 0) throw new Error("inherited evidence is missing layoutFiles or files");
  const layoutRows = previous.slice(layoutAt + "\nlayoutFiles:\n".length).split("\n");
  for (const row of layoutRows) {
    if (!row.startsWith("  ")) break;
    const match = row.match(/^  (terminal\/[^:]+): "([a-f0-9]{64})"$/);
    if (!match) throw new Error(`invalid inherited layout source row: ${row}`);
    if (recorded[match[1]]) throw new Error(`duplicate layout source: ${match[1]}`);
    recorded[match[1]] = match[2];
  }
  if (!recorded[HEATMAP_SOURCE] || JSON.stringify(Object.keys(recorded).sort()) !== JSON.stringify(Object.keys(layoutFiles).sort())) {
    throw new Error("scoped evidence must preserve the complete layout source set");
  }
  for (const [rel, hash] of Object.entries(layoutFiles)) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`invalid layout source hash: ${rel}`);
    if (rel !== HEATMAP_SOURCE && hash !== recorded[rel]) {
      throw new Error(`source changed outside HeatmapView: ${rel}; recapture its owning surface`);
    }
  }
  const fileList = previous.slice(filesAt + "\nfiles:\n".length).split("\n");
  for (const file of HEATMAP_CROPS) {
    if (!fileList.includes(`  - ${file}`) || !previous.includes(`\n  ${file}: {`)) {
      throw new Error(`inherited evidence is missing the file list or harness for ${file}`);
    }
    if (!/^[a-f0-9]{64}$/.test(cropHashes[file] || "")) throw new Error(`missing or invalid crop hash: ${file}`);
  }
  if (!/^[a-f0-9]{40}$/.test(capturedAtHead) || !Number.isFinite(Date.parse(capturedAt))) {
    throw new Error("scoped evidence requires a Git head and capture timestamp");
  }
  const updated = previous.replace(`  ${HEATMAP_SOURCE}: "${recorded[HEATMAP_SOURCE]}"`, `  ${HEATMAP_SOURCE}: "${layoutFiles[HEATMAP_SOURCE]}"`);
  const entry = [
    ...(previous.includes("\nscopedRecaptures:\n") ? [] : ["scopedRecaptures:"]),
    "  - surface: HeatmapView",
    `    capturedAtHead: ${capturedAtHead}`,
    `    capturedAt: ${capturedAt}`,
    "    command: CAPTURE_ONLY='^heatmap-' UPDATE_HEATMAP_EVIDENCE=1 node e2e/tools/capture_eod_heatmap_flowdesk_load_failure.cjs",
    `    sourceSha256: "${layoutFiles[HEATMAP_SOURCE]}"`,
    "    cropSha256:",
    ...HEATMAP_CROPS.map((file) => `      ${file}: "${cropHashes[file]}"`),
    "",
  ].join("\n");
  return updated + entry;
}

async function main() {
  const only = process.env.CAPTURE_ONLY ? new RegExp(process.env.CAPTURE_ONLY) : null;
  const updateHeatmap = process.env.UPDATE_HEATMAP_EVIDENCE === "1";
  if (updateHeatmap && process.env.CAPTURE_ONLY !== "^heatmap-") {
    throw new Error("UPDATE_HEATMAP_EVIDENCE requires CAPTURE_ONLY='^heatmap-'");
  }
  const capturedAtHead = currentGitHead();
  const capturedLayoutFiles = updateHeatmap
    ? Object.fromEntries(LAYOUT_FILES.map((rel) => [rel, sha256File(rel)])) : null;
  const child = startServer();
  const files = [];
  let failed = 0;
  try {
    await waitForServer(180_000);
    const browser = await chromium.launch({ headless: true, args: BROWSER_ARGS });
    try {
      for (const width of [1440, 820, 390]) {
        for (const lang of ["en", "zh"]) {
          for (const state of Object.keys(STATES)) {
            const file = cropName(state, width, lang);
            if (only && !only.test(file)) continue;
            process.stdout.write(`capture ${file} … `);
            const { board, failAfter, persisted } = STATES[state];
            const replies = { ...STATES[state].replies };
            if (persisted) replies[STATIC_FLOW] = await staticFlowReply();
            const { context, page } = await newPage(browser, width, lang, board, replies, !!failAfter);
            try {
              await page.goto(`${BASE}${URLS[board]}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
              await CAPTURE[board](page, lang, state, replies, join(OUT, file));
              await assertNoNextIndicator(page, file);
              files.push(file);
              console.log("ok");
            } catch (err) {
              failed += 1;
              console.log(`FAIL ${err && err.message ? err.message : err}`);
              try {
                await page.screenshot({ path: join(OUT, `FAIL-${file}`), fullPage: false });
              } catch { /* ignore */ }
            } finally {
              await context.close();
            }
          }
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(child);
  }

  if (failed) process.exitCode = 1;
  if (only) {
    if (updateHeatmap && failed === 0) {
      const evidencePath = join(OUT, "EVIDENCE.yml");
      const layoutFiles = Object.fromEntries(LAYOUT_FILES.map((rel) => [rel, sha256File(rel)]));
      if (JSON.stringify(layoutFiles) !== JSON.stringify(capturedLayoutFiles) || currentGitHead() !== capturedAtHead) {
        throw new Error("source changed during Heatmap capture; EVIDENCE.yml not written");
      }
      const evidence = updateHeatmapEvidence(readFileSync(evidencePath, "utf8"), {
        files,
        layoutFiles,
        cropHashes: Object.fromEntries(files.map((file) => [file, createHash("sha256").update(readFileSync(join(OUT, file))).digest("hex")])),
        capturedAtHead,
        capturedAt: new Date().toISOString(),
      });
      writeFileSync(evidencePath, evidence);
      console.log(`CAPTURE_ONLY run: ${files.length} crops, 0 failed; Heatmap evidence updated; other boards preserved`);
    } else {
      console.log(`CAPTURE_ONLY run: ${files.length} crops, ${failed} failed; EVIDENCE.yml not written`);
    }
    return;
  }
  if (failed) {
    console.log(`run with failures: ${files.length} crops, ${failed} failed; EVIDENCE.yml not written`);
    return;
  }
  files.sort();
  const evidence = [
    "# EOD belt, Flow Desk chain heat and Heatmap flow layer failure-state truth — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    "layoutFiles:",
    ...LAYOUT_FILES.map((rel) => `  ${rel}: "${sha256File(rel)}"`),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - { name: desktop, width: 1440, height: 900 }",
    "  - { name: tablet, width: 820, height: 1180 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "harness:",
    ...files.map((name) => {
      const state = Object.keys(STATES).find((s) => name.startsWith(`${s}-`));
      const { board, replies, heal: healKeys, failAfter, search, persisted } = STATES[state];
      const injected = Object.entries(replies).map(([k, r]) => `"${k}": ${r}`).join(", ");
      // One `then:` per row (a flow mapping cannot repeat a key); the steps run in this order.
      const failure = persisted === "abort" ? "refuse the connection" : `answer ${persisted}`;
      const steps = [
        persisted && `${STATIC_FLOW} answered the fixture's flow_idx payload, written to IndexedDB and aged 6h; flow_idx + ${STATIC_FLOW} ${failure}; page reloaded`,
        healKeys && `${healKeys.join(" + ")} healed, Retry clicked`,
        failAfter && `healthy read landed; ${failAfter.join(" + ")} answer 503; page clock moved past two polls`,
        search && `searched ${search}`,
      ].filter(Boolean);
      const then = steps.length ? `, then: "${steps.join("; then ")}"` : "";
      const stream = board === "belt" ? ", stream: aborted" : "";
      return `  ${name}: { url: "${URLS[board]}", state: ${state}, injected: { ${injected} }${stream}${then} }`;
    }),
    "surfaces: [EodContextBelt, StructureStrip, DarkPoolMini, FlowDeskView, HeatmapView]",
    "injection: page.route answers /api/flow (by f-param), /data/flow_idx.json and /api/quote with 503 / 403 / 404 or a refused request; /api/flow/stream is refused on the GEX desk; every other read is the FLOW_FIXTURE server",
    "persisted: the heatmap-flow-persisted-* states age the browser's own IndexedDB record of /data/flow_idx.json (dataCache write-through), never a mocked cache",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_eod_heatmap_flowdesk_load_failure.cjs",
    "files:",
    ...files.map((name) => `  - ${name}`),
    "",
  ].join("\n");
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence);
  console.log(`wrote ${files.length} crops + EVIDENCE.yml (head ${capturedAtHead})`);
}

module.exports = { updateHeatmapEvidence };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
