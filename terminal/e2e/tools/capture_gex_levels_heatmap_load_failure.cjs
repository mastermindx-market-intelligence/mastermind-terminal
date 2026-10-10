#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This capture tool is intentionally CommonJS. */
/**
 * GEX desk, Levels and Heatmap failure-state truth — dark evidence crops.
 *
 * A read that did not land is not an absence. On each board a 5xx /api/flow read renders the
 * load error with an in-place Retry, and only a 404 renders the empty state. The GEX right rail
 * (market state, the matrix behind the pick) fails inside its own cards and never takes the
 * ladder down. A refresh that fails keeps what is on screen and says it is the last read.
 *
 * Every state is produced by the real failure injected with page.route, never by a component
 * prop. The *-retried states lift the injection, click Retry, and crop what the same document
 * recovers to. The *-refresh-failed states let a healthy read land, fail the store, and move
 * the page clock past two polls: the first poll serves the cached read and revalidates in the
 * background (the failure evicts it), the second asks the store and is refused. (GEX market
 * state and Levels only; see the note on the heatmap states.)
 *
 * The GEX states refuse /api/flow/stream: its fixture producer would push the very payload the
 * injected /api/flow answer withholds, and the desk's classified read is what is captured.
 *
 * Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator; FLOW_FIXTURE serves the healthy reads.
 *
 * From terminal/:
 *   node e2e/tools/capture_gex_levels_heatmap_load_failure.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/gex-levels-heatmap-load-failure/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "gex-levels-heatmap-load-failure");
const LAYOUT_FILES = [
  "terminal/app/globals.css",
  "terminal/components/gexdesk/GexDeskView.tsx",
  "terminal/components/gexdesk/HeatSeekerCard.tsx",
  "terminal/components/gexdesk/MarketStateCard.tsx",
  "terminal/components/gexdesk/StrikeLadder.tsx",
  "terminal/components/gexdesk/gexStrings.ts",
  "terminal/components/heatmap/HeatmapView.tsx",
  "terminal/components/levels/LevelsView.tsx",
  "terminal/components/levels/levelsLabels.ts",
  "terminal/lib/heatmapStrings.ts",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3564);
const BASE = `http://127.0.0.1:${PORT}`;
const URLS = {
  gex: "/options?tab=gex",
  levels: "/options?tab=levels",
  heatmap: "/discover?tab=heatmap",
};
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  820: { width: 820, height: 1180 },
  390: { width: 390, height: 844 },
};
const POLL_MS = 60_000;
// Chromium re-rasters only the invalidated rect of a tile by default, so the anti-aliased ring
// and chip edges depend on the tile's raster history and drift between identical runs.
const BROWSER_ARGS = ["--disable-partial-raster"];

/**
 * Injected answer per read key ("<f-param>" for /api/flow, else the pathname); anything
 * unlisted reaches the fixture server.
 * `heal`: those injections are lifted and Retry clicked before the crop.
 * `failAfter`: a healthy read lands first, then these keys fail and the clock passes two polls.
 */
const STATES = {
  "gex-ladder-unavailable": { board: "gex", replies: { "gex:SPY": "503" } },
  "gex-ladder-retried": { board: "gex", replies: { "gex:SPY": "503" }, heal: ["gex:SPY"] },
  "gex-ladder-absent": { board: "gex", replies: { "gex:SPY": "404" } },
  "gex-rail-unavailable": { board: "gex", replies: { "gexstate:SPY": "503", "matrix:SPY": "503" } },
  "gex-rail-retried": {
    board: "gex",
    replies: { "gexstate:SPY": "503", "matrix:SPY": "503" },
    heal: ["gexstate:SPY", "matrix:SPY"],
  },
  "gex-state-refresh-failed": { board: "gex", replies: {}, failAfter: ["gexstate:SPY"] },
  "levels-unavailable": { board: "levels", replies: { "levels:SPY": "503" } },
  "levels-retried": { board: "levels", replies: { "levels:SPY": "503" }, heal: ["levels:SPY"] },
  "levels-absent": { board: "levels", replies: { "levels:SPY": "404" } },
  "levels-refresh-failed": { board: "levels", replies: {}, failAfter: ["levels:SPY"] },
  "heatmap-unavailable": { board: "heatmap", replies: { manifest: "503", "/data/manifest.json": "503" } },
  "heatmap-retried": {
    board: "heatmap",
    replies: { manifest: "503", "/data/manifest.json": "503" },
    heal: ["manifest", "/data/manifest.json"],
  },
  "heatmap-absent": { board: "heatmap", replies: { manifest: "404", "/data/manifest.json": "404" } },
  // No heatmap-refresh-failed crop: the shell persists /data/manifest.json to IndexedDB, and
  // dataCache serves a persisted copy as data (stale-while-revalidate) when both sources fail,
  // so in a browser the tiles stay without the stale label. heatmapLoadFailureState.test.tsx
  // covers the label where no persisted copy exists.
};

const COPY = {
  en: {
    retry: "Retry",
    refreshFailed: "Could not refresh — showing the last read.",
    gexError: "Could not load GEX data",
    gexNoSnapshot: "No strike snapshot for this name yet",
    stateError: "Could not load the market state",
    loading: "Loading…",
    stateComputing: "State computing — nightly",
    pickError: "Could not read the published pick just now — a failed read, not an empty one.",
    pickNull: "No standout pick — load is shared across levels.",
    levelsError: (ticker) => `Could not load levels for ${ticker}`,
    noLevels: "No levels for this root yet",
    heatmapError: "Could not load the heatmap",
    noData: "No data available",
  },
  zh: {
    retry: "重试",
    refreshFailed: "无法刷新 — 显示上次读取的数据。",
    gexError: "无法加载GEX数据",
    gexNoSnapshot: "该品种暂无逐行权价快照",
    stateError: "无法加载市场状态",
    loading: "加载中…",
    stateComputing: "状态计算中 — 每日更新",
    pickError: "暂时无法读取已发布的精选 — 这是读取失败，并非无精选。",
    pickNull: "无突出精选 — 仓位分布于多个价位。",
    levelsError: (ticker) => `无法加载 ${ticker} 的档位`,
    noLevels: "这个标的还没有档位",
    heatmapError: "无法加载热力图",
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

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "not tried";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}${URLS.gex}`, { redirect: "manual" });
      last = String(res.status);
      if (res.status >= 200 && res.status < 500) return;
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
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
  }, lang);
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  // Installed before the first script runs, so every poll interval is on the page clock.
  if (withClock) await page.clock.install();
  if (board === "gex") await page.route((url) => url.pathname === "/api/flow/stream", (route) => route.abort("failed"));
  await page.route(
    (url) => replies[keyOf(url)] != null,
    async (route) => {
      switch (replies[keyOf(new URL(route.request().url()))]) {
        case "503": return route.fulfill({ status: 503, json: { error: "feed unavailable" } });
        case "404": return route.fulfill({ status: 404, json: { error: "not published" } });
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
  // The rail's gauge rings transition in when a healed read lands; finish them before the shot.
  await page.screenshot({ path: outPath, clip: { x, y, width, height }, animations: "disabled" });
}

async function waitUntil(check, why, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(why);
}

async function expectNone(locator, why) {
  if (await locator.count()) throw new Error(why);
}

/** Pass two polls: the first serves the cached read and revalidates (the failure evicts it); the second is refused. */
async function failThenPoll(page, replies, keys) {
  for (const key of keys) replies[key] = "503";
  for (let i = 0; i < 2; i++) {
    await page.clock.fastForward(POLL_MS);
    await page.waitForTimeout(600);
  }
}

async function heal(page, replies, keys, retries) {
  for (const key of keys) delete replies[key];
  for (const retry of retries) await retry.click();
  // The healed ladder renders under the pointer the Retry click left behind; park it off the
  // content so no row's hover tooltip lands in the crop.
  await page.mouse.move(0, 0);
}

async function captureGex(page, lang, state, replies, outPath) {
  const copy = COPY[lang];
  const { heal: healKeys, failAfter } = STATES[state];
  const region = page.locator(".obs-gexdesk-ladder-region");
  const ladder = region.locator('[data-tut="gex-ladder"]');
  const loadError = region.getByTestId("gex-load-error");

  if (state.startsWith("gex-ladder-")) {
    if (state === "gex-ladder-absent") {
      await region.getByText(copy.gexNoSnapshot).waitFor({ state: "visible" });
      await expectNone(region.getByRole("button", { name: copy.retry, exact: true }), `${state}: a published absence must offer nothing to retry`);
    } else {
      await loadError.getByText(copy.gexError).waitFor({ state: "visible" });
      const retry = loadError.getByRole("button", { name: copy.retry, exact: true });
      await retry.waitFor({ state: "visible" });
      await expectNone(page.getByText(copy.gexNoSnapshot), `${state}: a failed read shown as a coverage gap`);
      if (healKeys) {
        await heal(page, replies, healKeys, [retry]);
        await ladder.waitFor({ state: "visible" });
        await expectNone(loadError, `${state}: the load error outlived the re-read`);
      }
    }
    await region.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await cropBoxes(page, [await region.boundingBox()], outPath, 0);
    return;
  }

  // The right rail: the pick card and the market-state card, below or beside the ladder.
  await ladder.waitFor({ state: "visible" });
  const stateCard = page.locator('[data-tut="gex-state-card"]');
  if (failAfter) {
    // The card has a state once its placeholder (loading / computing) is gone.
    await waitUntil(async () => !(await stateCard.textContent())?.includes(copy.loading) && !(await stateCard.textContent())?.includes(copy.stateComputing), `${state}: the market state never landed`);
    await failThenPoll(page, replies, failAfter);
    await stateCard.getByTestId("gex-state-refresh-failed").getByText(copy.refreshFailed).waitFor({ state: "visible" });
    await expectNone(stateCard.getByTestId("gex-state-error"), `${state}: a failed refresh withdrew the last read`);
  } else {
    const stateError = stateCard.getByTestId("gex-state-error");
    const pickError = page.getByTestId("gex-heatseeker-error");
    await stateError.getByText(copy.stateError).waitFor({ state: "visible" });
    await pickError.getByText(copy.pickError).waitFor({ state: "visible" });
    await expectNone(page.getByText(copy.pickNull), `${state}: a failed matrix read shown as "no pick"`);
    await expectNone(loadError, `${state}: a rail failure took the ladder down`);
    if (healKeys) {
      await heal(page, replies, healKeys, [
        stateError.getByRole("button", { name: copy.retry, exact: true }),
        pickError.getByRole("button", { name: copy.retry, exact: true }),
      ]);
      await stateError.waitFor({ state: "detached" });
      await pickError.waitFor({ state: "detached" });
      await ladder.waitFor({ state: "visible" });
    }
  }
  // The pick card above, and the state card down to the row this state is about.
  const pickSlot = stateCard.locator("xpath=preceding-sibling::div[1]");
  await pickSlot.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(250);
  const row = failAfter
    ? stateCard.getByTestId("gex-state-refresh-failed")
    : healKeys ? stateCard.locator(".obs-card-hd").first() : stateCard.getByTestId("gex-state-error");
  if (!failAfter && !healKeys) {
    // The state card is its own scroll region; on a short desktop rail the error's Retry sits
    // below the card's fold. Scroll the card (not the page) until the Retry is in view.
    await row.getByRole("button", { name: copy.retry, exact: true }).evaluate((el) => el.scrollIntoView({ block: "nearest" }));
    await page.waitForTimeout(150);
  }
  const slotBox = await pickSlot.boundingBox();
  const cardBox = await stateCard.boundingBox();
  const rowBox = await row.boundingBox();
  if (!slotBox || !cardBox || !rowBox) throw new Error(`${state}: rail not laid out`);
  const cardBottom = cardBox.y + cardBox.height;
  const through = Math.min(cardBottom, healKeys ? rowBox.y + 220 : rowBox.y + rowBox.height + 8);
  await cropBoxes(page, [slotBox, { ...cardBox, height: through - cardBox.y }], outPath, 0);
}

async function captureLevels(page, lang, state, replies, outPath) {
  const copy = COPY[lang];
  const { heal: healKeys, failAfter } = STATES[state];
  const controls = page.locator(".levels-controls");
  const body = page.locator(".levels-body");
  const loadError = page.getByTestId("levels-load-error");
  const rung = page.getByTestId("levels-rung").first();

  if (state === "levels-absent") {
    await controls.getByText(copy.noLevels).waitFor({ state: "visible" });
    await expectNone(page.getByRole("button", { name: copy.retry, exact: true }), `${state}: a published absence must offer nothing to retry`);
  } else if (failAfter) {
    await rung.waitFor({ state: "visible" });
    await failThenPoll(page, replies, failAfter);
    await page.getByTestId("levels-refresh-failed").getByText(copy.refreshFailed).waitFor({ state: "visible" });
    await rung.waitFor({ state: "visible" });
    await expectNone(loadError, `${state}: a failed refresh withdrew the map`);
  } else {
    await loadError.getByText(copy.levelsError("SPY")).waitFor({ state: "visible" });
    const retry = loadError.getByRole("button", { name: copy.retry, exact: true });
    await retry.waitFor({ state: "visible" });
    await expectNone(page.getByText(copy.noLevels), `${state}: a failed read shown as an empty root`);
    if (healKeys) {
      await heal(page, replies, healKeys, [retry]);
      await rung.waitFor({ state: "visible" });
      await expectNone(loadError, `${state}: the load error outlived the re-read`);
    }
  }
  await controls.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await cropBoxes(page, [await controls.boundingBox(), await body.boundingBox()], outPath, 0);
}

async function captureHeatmap(page, lang, state, replies, outPath) {
  const copy = COPY[lang];
  const { heal: healKeys } = STATES[state];
  const breadth = page.getByTestId("heatmap-breadth");
  const canvas = page.locator('[data-tut="heatmap-canvas"]');
  const loadError = page.getByTestId("heatmap-load-error");
  const percent = breadth.getByText(/\(\d+%\)/);

  if (state === "heatmap-absent") {
    await canvas.getByText(copy.noData, { exact: true }).waitFor({ state: "visible" });
    await expectNone(page.getByRole("button", { name: copy.retry, exact: true }), `${state}: a published absence must offer nothing to retry`);
  } else {
    await loadError.getByText(copy.heatmapError).waitFor({ state: "visible" });
    const retry = loadError.getByRole("button", { name: copy.retry, exact: true });
    await retry.waitFor({ state: "visible" });
    await expectNone(canvas.getByText(copy.noData, { exact: true }), `${state}: a failed read shown as an empty market`);
    if ((await breadth.textContent())?.includes("(0%)")) throw new Error(`${state}: an unread universe given a breadth reading`);
    if (healKeys) {
      await heal(page, replies, healKeys, [retry]);
      await percent.waitFor({ state: "visible" });
      await expectNone(loadError, `${state}: the load error outlived the re-read`);
    }
  }
  await breadth.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await cropBoxes(page, [await breadth.boundingBox(), await canvas.boundingBox()], outPath, 0);
}

const CAPTURE = { gex: captureGex, levels: captureLevels, heatmap: captureHeatmap };

async function main() {
  const only = process.env.CAPTURE_ONLY ? new RegExp(process.env.CAPTURE_ONLY) : null;
  const capturedAtHead = currentGitHead();
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
            const { board, failAfter } = STATES[state];
            const replies = { ...STATES[state].replies };
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
    console.log(`CAPTURE_ONLY run: ${files.length} crops, ${failed} failed; EVIDENCE.yml not written`);
    return;
  }
  files.sort();
  const evidence = [
    "# GEX desk, Levels and Heatmap failure-state truth — capture evidence",
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
      const { board, replies, heal: healKeys, failAfter } = STATES[state];
      const injected = Object.entries(replies).map(([k, r]) => `"${k}": ${r}`).join(", ");
      const healed = healKeys ? `, then: "${healKeys.join(" + ")} healed, Retry clicked"` : "";
      const refresh = failAfter ? `, then: "healthy read landed; ${failAfter.join(" + ")} answer 503; page clock moved past two polls"` : "";
      const stream = board === "gex" ? ", stream: aborted" : "";
      return `  ${name}: { url: "${URLS[board]}", state: ${state}, injected: { ${injected} }${stream}${healed}${refresh} }`;
    }),
    "surfaces: [GexDeskView, HeatSeekerCard, MarketStateCard, LevelsView, HeatmapView]",
    "injection: page.route answers /api/flow (by f-param) and /data/manifest.json with 503 / 404; /api/flow/stream is refused on the GEX desk; every other read is the FLOW_FIXTURE server",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_gex_levels_heatmap_load_failure.cjs",
    "files:",
    ...files.map((name) => `  - ${name}`),
    "",
  ].join("\n");
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence);
  console.log(`wrote ${files.length} crops + EVIDENCE.yml (head ${capturedAtHead})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
