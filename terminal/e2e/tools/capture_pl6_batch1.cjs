#!/usr/bin/env node
/**
 * B-PL-6 batch 1 — dark evidence crops for the four most-changed surfaces.
 *
 * Same method as B-F12-5 / B-PL-1: Playwright against a fixture next-dev
 * server. Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_pl6_batch1.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-pl-6-batch-1/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-pl-6-batch-1");
const LAYOUT_FILES = [
  "terminal/components/OptionsHubView.tsx",
  "terminal/components/SearchModal.tsx",
  "terminal/components/StockAnalysis.tsx",
  "terminal/components/workspaces/AnalysisWorkspace.tsx",
  "terminal/components/ChartPanel.tsx",
  "terminal/components/DayRange.tsx",
  "terminal/lib/plainLabels.ts",
  "terminal/lib/i18n.tsx",
];
const ONLY = (process.env.CAPTURE_ONLY || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3536);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  390: { width: 390, height: 844 },
};

mkdirSync(OUT, { recursive: true });

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function layoutFilesBlock() {
  return LAYOUT_FILES.map((rel) => `  ${rel}: "${sha256File(rel)}"`);
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
      const res = await fetch(`${BASE}/terminal?symbol=SPY`, { redirect: "manual" });
      last = String(res.status);
      if (res.status >= 200 && res.status < 500) return;
    } catch (err) {
      last = err.cause?.code || err.message;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`dev server on ${PORT} never answered (${last})`);
}

async function newPage(browser, width, lang) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[width],
    hasTouch: width === 390,
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
  return { context, page };
}

async function ensureLang(page, lang) {
  await page.evaluate((l) => {
    localStorage.setItem("mm.lang", l);
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
    window.dispatchEvent(new CustomEvent("mm:lang"));
  }, lang);
}

async function gotoReady(page, path, lang) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await ensureLang(page, lang);
  await page.waitForTimeout(400);
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

async function cropBox(page, box, outPath, pad) {
  const vp = page.viewportSize();
  if (!box || !vp) throw new Error(`no box for ${outPath}`);
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  const width = Math.max(8, Math.min(vp.width - x, Math.ceil(box.width + pad * 2)));
  const height = Math.max(8, Math.min(vp.height - y, Math.ceil(box.height + pad * 2)));
  await page.screenshot({ path: outPath, clip: { x, y, width, height } });
}

async function cropLocator(page, locator, outPath, pad = 18) {
  const fresh = locator.first();
  await fresh.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(250);
  const box = await fresh.boundingBox();
  if (!box) throw new Error(`no bounding box for ${outPath}`);
  await cropBox(page, box, outPath, pad);
}

async function captureOptionsHub(page, width, lang, outPath) {
  await gotoReady(page, "/options?tab=screener", lang);
  const workspace = page.locator(".options-workspace, .main2.options-workspace, main").first();
  await workspace.waitFor({ state: "visible", timeout: 60_000 });
  const heading = page.locator(".obs-lbl, .obs-card-hd, .options-ia-nav").first();
  await heading.waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});
  const needle = lang === "zh" ? "总权利金" : "Gross";
  const labeled = page.locator(".obs-card").filter({ hasText: needle }).first();
  if (await labeled.count()) {
    await labeled.waitFor({ state: "visible", timeout: 45_000 });
    await cropLocator(page, labeled, outPath, 14);
    return;
  }
  const target = (await page.locator(".obs-card").count())
    ? page.locator(".obs-card").first()
    : workspace;
  await cropLocator(page, target, outPath, 14);
}

async function waitForCutChip(hub, page, lang, outPath) {
  const cutWord = lang === "zh" ? "减持" : "Cut";
  const input = hub.locator("input").first();
  await input.click();
  await input.fill("META");
  const row = hub.locator(".r").filter({ hasText: "META" }).first();
  await row.waitFor({ state: "visible", timeout: 20_000 });
  const verd = row.locator(".verd").first();
  await verd.waitFor({ state: "visible", timeout: 20_000 });
  const deadline = Date.now() + 12_000;
  let text = "";
  while (Date.now() < deadline) {
    text = ((await verd.textContent()) || "").trim();
    if (new RegExp(cutWord, "i").test(text)) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`${outPath}: expected CUT chip ${cutWord} on META, got ${text}`);
}

async function captureSearchModal(page, width, lang, outPath) {
  await gotoReady(page, "/terminal?symbol=SPY", lang);
  await page.locator(".workspace").waitFor({ state: "visible", timeout: 45_000 });
  if (width === 390) {
    await page.locator(".m-symbar").click();
    const hub = page.locator(".msheet-search");
    await hub.waitFor({ state: "visible", timeout: 20_000 });
    await waitForCutChip(hub, page, lang, outPath);
    await cropLocator(page, hub, outPath, 8);
  } else {
    const pair = page.locator(".topbar .pair").first();
    await pair.waitFor({ state: "visible", timeout: 20_000 });
    await pair.click();
    const hub = page.locator(".smodal-hub").first();
    await hub.waitFor({ state: "visible", timeout: 20_000 });
    await waitForCutChip(hub, page, lang, outPath);
    await cropLocator(page, hub, outPath, 10);
  }
}

async function captureStockAnalysis(page, width, lang, outPath) {
  await gotoReady(page, "/terminal?symbol=AAPL", lang);
  await page.locator(".workspace, .app").first().waitFor({ state: "visible", timeout: 60_000 });
  const chip = page.locator(".sa-status").first();
  await chip.waitFor({ state: "attached", timeout: 60_000 });
  await chip.scrollIntoViewIfNeeded();
  await chip.waitFor({ state: "visible", timeout: 20_000 });
  const expected = lang === "zh" ? "回避" : "Stand aside";
  const text = ((await chip.textContent()) || "").trim();
  if (!new RegExp(expected, "i").test(text)) {
    throw new Error(`${outPath}: expected entry chip ${expected}, got ${text}`);
  }
  const head = page.locator(".sa-entry-head").first();
  await cropLocator(page, head, outPath, 12);
}

async function captureAnalysis(page, width, lang, outPath) {
  await gotoReady(page, "/analysis?symbol=SPY", lang);
  const shell = page.locator(".analysis-shell").first();
  await shell.waitFor({ state: "visible", timeout: 45_000 });
  const bar = page.locator(".analysis-context-bar").first();
  const target = (await bar.count()) && (await bar.isVisible().catch(() => false)) ? bar : shell;
  await cropLocator(page, target, outPath, 12);
}

async function captureChartChrome(page, width, lang, outPath) {
  await gotoReady(page, "/terminal?symbol=SPY", lang);
  await page.locator(".workspace").waitFor({ state: "visible", timeout: 45_000 });
  const day = page.locator(".dayrange").first();
  const oracle = page.locator(".statusline").first();
  const dayVisible = (await day.count()) > 0 && (await day.isVisible().catch(() => false));
  const loc = dayVisible ? day : oracle;
  await loc.waitFor({ state: "visible", timeout: 20_000 });
  await cropLocator(page, loc, outPath, 16);
}

const SURFACES = [
  { name: "OptionsHubView", run: captureOptionsHub },
  { name: "SearchModal", run: captureSearchModal },
  { name: "StockAnalysis", run: captureStockAnalysis },
  { name: "AnalysisWorkspace", run: captureAnalysis },
  { name: "ChartChrome", run: captureChartChrome },
];

function shouldCapture(surfaceName, width, lang) {
  if (!ONLY.length) return true;
  const stem = cropName(surfaceName, width, lang).replace(/\.png$/, "");
  return ONLY.includes(surfaceName) || ONLY.includes(stem);
}

async function main() {
  const capturedAtHead = currentGitHead();
  const child = startServer();
  const files = [];
  let failed = 0;
  try {
    await waitForServer(180_000);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const width of [1440, 390]) {
        for (const lang of ["en", "zh"]) {
          for (const surface of SURFACES) {
            if (!shouldCapture(surface.name, width, lang)) continue;
            const file = cropName(surface.name, width, lang);
            process.stdout.write(`capture ${file} … `);
            const { context, page } = await newPage(browser, width, lang);
            try {
              await surface.run(page, width, lang, join(OUT, file));
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

  const evidence = [
    "# B-PL-6 batch 1 — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    "layoutFiles:",
    ...layoutFilesBlock(),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - { name: desktop, width: 1440, height: 900 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "surfaces: [OptionsHubView, SearchModal, StockAnalysis, AnalysisWorkspace, ChartChrome]",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_pl6_batch1.cjs",
    "files:",
    ...[...new Set([
      ...readdirSync(OUT).filter((f) => f.endsWith(".png") && !f.startsWith("FAIL-")).sort(),
      ...files,
    ])].map((f) => `  - ${f}`),
    "",
  ].join("\n");
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence);
  console.log(`capturedAtHead ${capturedAtHead}`);
  console.log(`wrote ${files.length} crops + EVIDENCE.yml to ${OUT}`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
