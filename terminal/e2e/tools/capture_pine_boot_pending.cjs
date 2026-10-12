#!/usr/bin/env node
/**
 * Pine engine boot states: dark evidence crops of a user script's chart legend row and its editor
 * console while the script engine never boots, at the three contract viewports, in en and zh.
 *
 * The hang is the one e2e/pine-engine-boot-pending.spec.ts uses: a Worker subclass installed before
 * any page script swallows every message/error from a worker constructed while `__pineHang` is set,
 * so host.ts's own boot timer, its single boot retry and its start-failure settlement run unmodified.
 * Only the boot timer is shortened (30s → BOOT_MS), and BOOT_MS is long enough here that the
 * "waiting" states hold still for the crop.
 *
 * Per viewport × language:
 *   legend-wait-*      the row while the run waits on the engine ("Waiting for engine…")
 *   legend-failed-*    the settled start failure with its Retry, clear of the price scale
 *   legend-retried-*   after Retry with the engine healthy: no state, the script plotted, same symbol
 *   editor-checking-*  the diagnose console while the check waits on the engine
 *   editor-unavailable-* the console after the start failure: unchecked, with Retry check
 * Legend crops are a band across the whole chart, so the price scale is in frame.
 *
 * Same method as B-PL-6: Playwright against a fixture next-dev server. Dark only
 * (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06). TERMINAL_E2E_FIXTURE suppresses
 * the Next.js N indicator (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR) and
 * serves the fixture script store (lib/scriptsFixtureDb.ts, "My Momentum").
 *
 * From terminal/:
 *   node e2e/tools/capture_pine_boot_pending.cjs
 *
 * Writes the crops + EVIDENCE.yml under docs/pr-crops/pine-boot-pending-state/. Writes no
 * EVIDENCE.yml when any crop fails, including state text that is not today's PINE_RUN_LEX string,
 * a zh crop whose state text carries English, or an en crop that carries Chinese.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium, expect } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "pine-boot-pending-state");
// What the crops draw: the legend row markup and its phone cap, the row/console styles and tokens,
// the editor console, the state machine that picks the row's words, and the words. ChartPanel.tsx
// is deliberately absent: it decides WHICH state a row is in, which e2e/pine-engine-boot-pending
// .spec.ts gates; locking it here would turn every unrelated ChartPanel edit into a re-pin.
const LAYOUT_FILES = [
  "terminal/app/globals.css",
  "terminal/components/ChartOverlays.module.css",
  "terminal/components/ChartOverlays.tsx",
  "terminal/components/PineEditor.tsx",
  "terminal/lib/pineChartRun.ts",
  "terminal/lib/pineRunLex.ts",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3571);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 390, height: 844 },
];
const BOOT_MS = 8_000;               // stands in for WORKER_BOOT_TIMEOUT_MS: two windows ≈ 16s of "waiting"
const HOST_BOOT_TIMEOUT_MS = 30_000; // lib/pine-engine/host.ts WORKER_BOOT_TIMEOUT_MS
const SCRIPT_NAME = "My Momentum";   // lib/scriptsFixtureDb.ts `${key}-mine`
const SURFACES = ["legend-wait", "legend-failed", "legend-retried", "editor-checking", "editor-unavailable"];

// The page's words, read from the shipped tuple file so a copy change cannot pass unseen.
function lexFromSource() {
  const src = readFileSync(join(ROOT, "lib", "pineRunLex.ts"), "utf8");
  const lex = {};
  for (const m of src.matchAll(/^\s*(\w+): \["((?:[^"\\]|\\.)*)", "((?:[^"\\]|\\.)*)"\],?$/gm)) lex[m[1]] = [m[2], m[3]];
  for (const k of ["pineEngineWait", "pineEngineFail", "pineRetry", "peChecking", "peEngineUnavailable", "peRetryCheck"]) {
    if (!lex[k]) throw new Error(`lib/pineRunLex.ts has no ${k} tuple`);
  }
  return lex;
}
const LEX = lexFromSource();

// What each surface must say, in order, for one language.
function expectedText(surface, lang) {
  const c = lang === "zh" ? 1 : 0;
  switch (surface) {
    case "legend-wait": return [LEX.pineEngineWait[c]];
    case "legend-failed": return [LEX.pineEngineFail[c], LEX.pineRetry[c]];
    case "legend-retried": return [];
    case "editor-checking": return [LEX.peChecking[c].split("{name}").join(SCRIPT_NAME)];
    case "editor-unavailable": return [LEX.peEngineUnavailable[c], LEX.peRetryCheck[c]];
    default: throw new Error(surface);
  }
}

mkdirSync(OUT, { recursive: true });

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function cropName(surface, width, lang) {
  return `${surface}-${width}${lang === "zh" ? "-zh" : ""}.png`;
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
    HUB_REALTIME_QUOTES: "1",
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
    if (/Ready|error|Error/i.test(line)) process.stdout.write(`[dev] ${line}`);
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
      const res = await fetch(`${BASE}/terminal?symbol=NVDA`, { redirect: "manual" });
      last = String(res.status);
      if (res.status >= 200 && res.status < 500) return;
    } catch (err) {
      last = err.cause?.code || err.message;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`dev server on ${PORT} never answered (${last})`);
}

// The spec's hang, verbatim in behaviour (e2e/pine-engine-boot-pending.spec.ts installHang).
function hangInit({ bootMs, hostBootMs }) {
  if (window.__pineSpawns !== undefined) return;
  window.__pineHang = true;
  window.__pineSpawns = 0;
  let armBoot = false;
  const Native = window.Worker;
  class HungWorker extends Native {
    constructor(url, opts) {
      super(url, opts);
      window.__pineSpawns += 1;
      if (!window.__pineHang) return;
      armBoot = true;
      const swallow = (e) => e.stopImmediatePropagation();
      this.addEventListener("message", swallow);
      this.addEventListener("error", swallow);
    }
  }
  window.Worker = HungWorker;
  const nativeSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms, ...rest) => {
    if (armBoot && ms === hostBootMs) { armBoot = false; ms = bootMs; }
    return nativeSetTimeout(fn, ms, ...rest);
  };
}

async function newPage(browser, vp, lang, key) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.width < 1000, // playwright.config.ts: the tablet and mobile projects set hasTouch
    locale: lang === "zh" ? "zh-CN" : "en-US",
    colorScheme: "dark",
  });
  await context.addCookies([{ name: "mm_e2e_scripts", value: key, url: BASE }]);
  await context.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("mm.startTf", JSON.stringify("D"));
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
  }, lang);
  await context.addInitScript(hangInit, { bootMs: BOOT_MS, hostBootMs: HOST_BOOT_TIMEOUT_MS });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  return { context, page };
}

async function stripDevOverlay(page) {
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
  });
}

async function assertNoNextIndicator(page, file) {
  await stripDevOverlay(page);
  const n = await page.locator("[data-nextjs-dev-tools-button]").count();
  if (n > 0) throw new Error(`${file}: Next.js N overlay still mounted (${n}); TERMINAL_E2E_FIXTURE gate failed`);
}

async function crop(page, clip, outPath) {
  const vp = page.viewportSize();
  const x = Math.max(0, Math.floor(clip.x));
  const y = Math.max(0, Math.floor(clip.y));
  const width = Math.max(8, Math.min(vp.width - x, Math.ceil(clip.width)));
  const height = Math.max(8, Math.min(vp.height - y, Math.ceil(clip.height)));
  await stripDevOverlay(page);
  await page.screenshot({ path: outPath, clip: { x, y, width, height } });
}

// A band across the whole chart around the script's legend row: the row and the price scale.
async function cropLegendBand(page, row, outPath) {
  const wrap = await page.locator(".chart-wrap").first().boundingBox();
  const box = await row.boundingBox();
  if (!wrap || !box) throw new Error(`no chart/row box for ${outPath}`);
  await crop(page, { x: wrap.x, y: box.y - 40, width: wrap.width, height: box.height + 80 }, outPath);
}

function textProblems(file, lang, got, want) {
  if (JSON.stringify(got) !== JSON.stringify(want)) return `${file}: says ${JSON.stringify(got)}, LEX says ${JSON.stringify(want)}`;
  for (const s of got) {
    const own = s.split(SCRIPT_NAME).join(""); // the script's name is the user's, not ours
    if (lang === "zh" && /[A-Za-z]/.test(own)) return `${file}: zh leaks English: ${s}`;
    if (lang === "en" && /[㐀-鿿]/.test(own)) return `${file}: en leaks Chinese: ${s}`;
  }
  return null;
}

/** The phone collapses the legend list behind its chevron. */
async function showLegend(page, row) {
  await expect.poll(async () => {
    if (await row.isVisible()) return true;
    try { await page.locator(".lg-collapse").first().click({ timeout: 2_000 }); } catch { /* re-rendered mid-tap */ }
    return row.isVisible();
  }, { timeout: 20_000, intervals: [300, 600, 1000], message: "the legend never showed the script's row" }).toBe(true);
}

async function legendText(page) {
  return page.evaluate(() => {
    const st = document.querySelector("[data-pine-state]");
    if (!st) return [];
    const row = st.closest(".lg-row");
    const retry = row && row.querySelector("[data-pine-retry]");
    return [st.textContent.trim(), ...(retry ? [retry.textContent.trim()] : [])];
  });
}

async function captureLegend(page, vp, lang, id, texts) {
  await page.goto(`${BASE}/terminal?symbol=NVDA&addScript=${encodeURIComponent(id)}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator(".chart-wrap canvas").first().waitFor({ state: "visible", timeout: 60_000 });
  const state = page.locator("[data-pine-state]").first();
  const row = page.locator(".lg-row", { has: page.locator("[data-pine-state]") }).first();

  await expect(state).toHaveAttribute("data-pine-state", "engineWait", { timeout: 30_000 });
  await showLegend(page, row);
  if ((await state.getAttribute("data-pine-state")) !== "engineWait") throw new Error("the wait settled before the crop");
  let file = cropName("legend-wait", vp.width, lang);
  await cropLegendBand(page, row, join(OUT, file));
  texts[file] = await legendText(page);

  await expect(state).toHaveAttribute("data-pine-state", "engineFail", { timeout: 45_000 });
  await showLegend(page, row);
  const geom = await page.evaluate(() => {
    const st = document.querySelector("[data-pine-state]");
    const axis = document.querySelector(".chart-wrap table tr")?.lastElementChild;
    if (!st || !axis) return null;
    return {
      rowRight: st.closest(".lg-row").getBoundingClientRect().right,
      axisLeft: axis.getBoundingClientRect().left,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  if (!geom) throw new Error("no failed row or price scale to measure");
  if (geom.rowRight > geom.axisLeft - 4) throw new Error(`failed row runs under the price scale (${geom.rowRight} > ${geom.axisLeft - 4})`);
  if (geom.overflowX > 0) throw new Error(`horizontal document overflow ${geom.overflowX}px`);
  file = cropName("legend-failed", vp.width, lang);
  await cropLegendBand(page, row, join(OUT, file));
  texts[file] = await legendText(page);

  // Retry on the same symbol/timeframe/bars with the engine healthy again.
  const spawnsAtFail = await page.evaluate(() => window.__pineSpawns);
  const named = page.locator(".lg-row", { has: page.locator(".lg-name", { hasText: SCRIPT_NAME }) }).first();
  await page.evaluate(() => { window.__pineHang = false; });
  await page.locator("[data-pine-retry]").first().click({ timeout: 10_000 });
  await expect(page.locator("[data-pine-state]")).toHaveCount(0, { timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => window.__mmChartOwnership?.().owned.pine ?? 0), { timeout: 20_000, message: "Retry should paint the script" }).toBeGreaterThan(0);
  if ((await page.evaluate(() => window.__pineSpawns)) !== spawnsAtFail + 1) throw new Error("Retry did not start exactly one fresh worker");
  if (!page.url().includes("symbol=NVDA")) throw new Error(`Retry changed the symbol: ${page.url()}`);
  await showLegend(page, named);
  await page.waitForTimeout(400); // let the plot's first frame paint
  file = cropName("legend-retried", vp.width, lang);
  await cropLegendBand(page, named, join(OUT, file));
  texts[file] = await legendText(page);
}

async function editorText(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".console [data-pe-state]");
    if (!el) return [];
    if (el.getAttribute("data-pe-state") === "checking") return [el.textContent.trim()];
    const msg = (el.querySelector("span")?.textContent ?? "").replace(/^⚠\s*/, "").trim();
    const btn = (el.querySelector("button")?.textContent ?? "").trim();
    return [msg, btn];
  });
}

async function captureEditor(page, vp, lang, id, texts) {
  await page.goto(`${BASE}/scripts?id=${encodeURIComponent(id)}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await expect(page.locator(".editor textarea")).toHaveValue(/plot\(close\)/, { timeout: 60_000 });
  const pe = page.locator(".console [data-pe-state]");
  const consoleBox = page.locator(".console").first();

  await expect(pe).toHaveAttribute("data-pe-state", "checking", { timeout: 30_000 });
  await consoleBox.scrollIntoViewIfNeeded();
  if ((await pe.getAttribute("data-pe-state")) !== "checking") throw new Error("the check settled before the crop");
  let box = await consoleBox.boundingBox();
  let file = cropName("editor-checking", vp.width, lang);
  await crop(page, { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 }, join(OUT, file));
  texts[file] = await editorText(page);

  await expect(pe).toHaveAttribute("data-pe-state", "engine-unavailable", { timeout: 45_000 });
  await consoleBox.scrollIntoViewIfNeeded();
  // The engine being down does not block the user's workflow (lib/i18n.tsx peAddToChart).
  const addToChart = page.getByRole("button", { name: lang === "zh" ? "添加到图表" : "Add to chart", exact: true });
  if (!(await addToChart.isEnabled())) throw new Error("the engine being down blocked Add to chart");
  box = await consoleBox.boundingBox();
  file = cropName("editor-unavailable", vp.width, lang);
  await crop(page, { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 }, join(OUT, file));
  texts[file] = await editorText(page);
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflowX > 0) throw new Error(`horizontal document overflow ${overflowX}px on the editor`);
}

async function main() {
  const capturedAtHead = currentGitHead();
  const nonce = Math.random().toString(36).slice(2, 8);
  const child = startServer();
  const texts = {};
  let failed = 0;
  try {
    await waitForServer(240_000);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const vp of VIEWPORTS) {
        for (const lang of ["en", "zh"]) {
          for (const [what, run] of [["legend", captureLegend], ["editor", captureEditor]]) {
            const key = `pinecap-${what}-${vp.name}-${lang}-${nonce}`;
            const label = `${what} ${vp.width} ${lang}`;
            process.stdout.write(`capture ${label} … `);
            const { context, page } = await newPage(browser, vp, lang, key);
            try {
              await run(page, vp, lang, `${key}-mine`, texts);
              await assertNoNextIndicator(page, label);
              console.log("ok");
            } catch (err) {
              failed += 1;
              console.log(`FAIL ${err && err.message ? err.message : err}`);
              try { await page.screenshot({ path: join(OUT, `FAIL-${what}-${vp.width}-${lang}.png`) }); } catch { /* ignore */ }
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

  for (const vp of VIEWPORTS) for (const lang of ["en", "zh"]) for (const s of SURFACES) {
    const file = cropName(s, vp.width, lang);
    if (!texts[file]) { if (!failed) { failed += 1; console.log(`${file}: never captured`); } continue; }
    const problem = textProblems(file, lang, texts[file], expectedText(s, lang));
    if (problem) { failed += 1; console.log(problem); }
  }
  if (failed) {
    console.log(`${failed} capture(s) failed; EVIDENCE.yml not written`);
    process.exitCode = 1;
    return;
  }

  const files = Object.keys(texts).sort();
  const evidence = [
    "# Pine engine boot states — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    "# ChartPanel.tsx is not locked: it picks the row's state, which e2e/pine-engine-boot-pending.spec.ts",
    "# gates; the files below draw the crops and choose their words.",
    "layoutFiles:",
    ...LAYOUT_FILES.map((rel) => `  ${rel}: "${sha256File(rel)}"`),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    ...VIEWPORTS.map((vp) => `  - { name: ${vp.name}, width: ${vp.width}, height: ${vp.height} }`),
    `surface: NVDA daily chart with the fixture script "${SCRIPT_NAME}" added; the Pine Worker never boots (host.ts boot timer ${HOST_BOOT_TIMEOUT_MS}ms shortened to ${BOOT_MS}ms, its one boot retry intact), then Retry with the engine healthy`,
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators to false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_pine_boot_pending.cjs",
    "# stateText: what each crop's Pine state said when it was taken, in reading order — the legend",
    "# row's state then its Retry; the console's message then its button. legend-retried says nothing:",
    "# the row is back to the plain name with its plot.",
    "stateText:",
    ...files.map((f) => `  ${f}: ${JSON.stringify(texts[f]).replace(/","/g, "\", \"")}`),
    "files:",
    ...files.map((f) => `  - ${f}`),
    "",
  ].join("\n");
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence);
  console.log(`capturedAtHead ${capturedAtHead}`);
  console.log(`wrote ${files.length} crops + EVIDENCE.yml to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
