#!/usr/bin/env node
/**
 * B-PL-6 batch 3 — dark evidence crops for the 0DTE flow board, flow desk
 * (filters + a card), alert detail, and heatmap treemap.
 *
 * Same method as B-PL-6 batch 1/2: Playwright against a fixture next-dev
 * server. Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_pl6_batch3.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-pl-6-batch-3/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-pl-6-batch-3");
const LAYOUT_FILES = [
  "terminal/components/options/OptionsFlowBoardView.tsx",
  "terminal/components/flowdesk/FiltersPanel.tsx",
  "terminal/components/flowdesk/FlowCard.tsx",
  "terminal/components/alerts/AlertDetail.tsx",
  "terminal/components/heatmap/HeatmapView.tsx",
  "terminal/components/heatmap/Treemap.tsx",
  "terminal/lib/heatmapStrings.ts",
  "terminal/lib/flowdeskStrings.ts",
  "terminal/lib/plainLabels.ts",
  "terminal/lib/i18n.tsx",
  "terminal/components/PineEditor.tsx",
];
const ONLY = (process.env.CAPTURE_ONLY || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3538);
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
    const hide = () => {
      document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
    };
    const start = () => {
      hide();
      new MutationObserver(hide).observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
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

async function hideNextIndicatorCss(page) {
  await page.evaluate(() => {
    const id = "mm-hide-next-indicator";
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = [
      "nextjs-portal,",
      "script[data-nextjs-dev-overlay],",
      "#next-logo,",
      "[data-next-mark],",
      "[data-nextjs-dev-tools-button],",
      "[data-nextjs-toast] {",
      "  display: none !important;",
      "  visibility: hidden !important;",
      "  opacity: 0 !important;",
      "  pointer-events: none !important;",
      "}",
    ].join("\n");
    document.documentElement.appendChild(s);
  });
}

async function stripDevOverlay(page) {
  await hideNextIndicatorCss(page);
  await page.evaluate(() => {
    const kill = (el) => {
      if (!el) return;
      if (el.shadowRoot) {
        const s = document.createElement("style");
        s.textContent = "*{display:none!important;visibility:hidden!important;opacity:0!important}";
        el.shadowRoot.appendChild(s);
      }
      el.remove();
    };
    document.querySelectorAll("script[data-nextjs-dev-overlay], nextjs-portal").forEach(kill);
    document.querySelectorAll("#next-logo, [data-next-mark]").forEach(kill);
  });
  for (const sel of ["nextjs-portal", "script[data-nextjs-dev-overlay]", "#next-logo", "[data-nextjs-dev-tools-button]", "[data-next-mark]"]) {
    const loc = page.locator(sel);
    const n = await loc.count();
    for (let i = 0; i < n; i++) {
      try { await loc.nth(i).evaluate((el) => el.remove()); } catch { /* detached */ }
    }
  }
}

async function assertNoNextIndicator(page, file) {
  await stripDevOverlay(page);
  const n = await page.locator("[data-nextjs-dev-tools-button]").count();
  async function visibleCount(locator) {
    const c = await locator.count();
    let v = 0;
    for (let i = 0; i < c; i++) {
      if (await locator.nth(i).isVisible()) v += 1;
    }
    return v;
  }
  const zhHint = await visibleCount(page.getByText("激活捷径"));
  const enHint = await visibleCount(page.getByText("Activate shortcut"));
  if (n > 0 || zhHint > 0 || enHint > 0) {
    throw new Error(`${file}: Next.js N overlay still mounted (button=${n} zhHint=${zhHint} enHint=${enHint})`);
  }
}

async function cropBox(page, box, outPath, pad) {
  await assertNoNextIndicator(page, outPath);
  await page.waitForTimeout(120);
  await stripDevOverlay(page);
  const vp = page.viewportSize();
  if (!box || !vp) throw new Error(`no box for ${outPath}`);
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  // 390 AlertDetail: the Next N pill sits in the 40px under the rounded card.
  // Viewport-bottom guards miss it because the card is not flush with the frame.
  const trimBottom = /AlertDetail-390/.test(String(outPath)) ? 40 : 0;
  const width = Math.max(8, Math.min(vp.width - x, Math.ceil(box.width + pad * 2)));
  const height = Math.max(8, Math.min(vp.height - y, Math.ceil(box.height + pad * 2)) - trimBottom);
  const nPortals = await page.locator("nextjs-portal").count();
  if (nPortals > 0) {
    throw new Error(`${outPath}: nextjs-portal still in DOM (${nPortals})`);
  }
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

async function captureFlowBoard(page, width, lang, outPath) {
  await gotoReady(page, "/options?tab=0dte", lang);
  const board = page.locator('[data-options-flow-board="0dte"]').first();
  await board.waitFor({ state: "visible", timeout: 60_000 });
  const needle = lang === "zh" ? "0DTE 事件看板" : "0DTE Event Dashboard";
  await board.getByText(needle).first().waitFor({ state: "visible", timeout: 20_000 });
  await cropLocator(page, board, outPath, width === 390 ? 6 : 10);
}

async function captureFlowDesk(page, width, lang, outPath) {
  await gotoReady(page, "/options?tab=desk", lang);
  const desk = page.locator('[data-options-ia="seven-category-stage-a"]').first();
  await desk.waitFor({ state: "visible", timeout: 60_000 });
  const card = page.locator("[data-tut='flow-card']").first();
  await card.waitFor({ state: "visible", timeout: 45_000 });
  const filtersBtn = page.getByRole("button", { name: lang === "zh" ? /^筛选$/ : /^Filters$/ }).first();
  await filtersBtn.waitFor({ state: "visible", timeout: 20_000 });
  if ((await page.locator("[data-tut='flow-filter-panel']").count()) === 0) {
    await filtersBtn.click();
  }
  const filters = page.locator("[data-tut='flow-filter-panel']").first();
  await filters.waitFor({ state: "visible", timeout: 20_000 });
  const needle = lang === "zh" ? "重置筛选" : "Reset filters";
  // Reset only appears when dirty; the caveat lines are always present.
  const caveat = lang === "zh" ? "方向由成交价变动规则推断" : "inferred from the last trade";
  await filters.getByText(caveat).first().waitFor({ state: "visible", timeout: 15_000 });
  await assertNoNextIndicator(page, outPath);
  await page.waitForTimeout(120);
  await stripDevOverlay(page);
  const filterBox = await filters.boundingBox();
  const cardBox = await card.boundingBox();
  const vp = page.viewportSize();
  if (!filterBox || !cardBox || !vp) throw new Error(`no desk boxes for ${outPath}`);
  const x = Math.max(0, Math.floor(Math.min(filterBox.x, cardBox.x) - 8));
  const y = Math.max(0, Math.floor(Math.min(filterBox.y, cardBox.y) - 8));
  const bottomGuard = vp.width <= 500 ? 52 : 0;
  const right = Math.min(vp.width, Math.max(filterBox.x + filterBox.width, cardBox.x + cardBox.width) + 8);
  const bottom = Math.min(vp.height - bottomGuard, Math.max(filterBox.y + filterBox.height, cardBox.y + cardBox.height) + 8);
  await page.screenshot({
    path: outPath,
    clip: { x, y, width: Math.max(8, right - x), height: Math.max(8, bottom - y) },
  });
  void needle;
}

async function installAlertFixtures(page) {
  const now = new Date().toISOString();
  await page.route("**/data/manifest.json**", (route) => route.fulfill({
    json: { symbols: { NVDA: { name: "NVIDIA", last: 182.5 } } },
  }));
  await page.route("**/api/alerts", (route) => route.fulfill({
    json: {
      alerts: [{
        id: "a1",
        symbol: "NVDA",
        active: false,
        created_at: "2026-08-01T00:00:00Z",
        condition: { type: "price", op: "below", value: 150, triggered: { at: "2026-09-05T09:41:00Z", value: 100, note: "crossed" } },
      }],
    },
  }));
  await page.route("**/api/alerts/receipts", (route) => route.fulfill({
    json: {
      run: { lane: "alerts_engine", run_id: "r1", started_at: now, concluded_at: now, outcome: "success", lane_cadence_budget_s: 300 },
      runs_state: "READ_OK",
      last_success_at: now,
      outbox: [{
        alert_id: "a1", fire_event_id: "f1", status: "sent", attempts: 1, last_error: null,
        deliver_after: null, delivered_at: "2026-09-05T09:41:00Z", created_at: "2026-08-01T00:00:00Z",
        payload: {
          subject: "NVDA crossed your price line",
          summary_plain: "NVDA crossed your price line.",
          ticker: "NVDA",
          condition_plain: "Crossed your price line",
          evidence_url: "https://example.com/evidence/f1",
          fired_at: "2026-09-05T09:41:00Z",
        },
      }],
      outbox_state: "READ_OK",
    },
  }));
}

async function captureAlertDetail(page, width, lang, outPath) {
  await installAlertFixtures(page);
  await gotoReady(page, "/alerts", lang);
  const row = page.locator('[data-delivery="sent"]').first();
  await row.waitFor({ state: "visible", timeout: 45_000 });
  await row.click();
  const detail = page.locator('[data-cockpit-state="drillback"]').first();
  await detail.waitFor({ state: "visible", timeout: 20_000 });
  const needle = lang === "zh" ? "发生了什么" : "What changed";
  await detail.getByText(needle).first().waitFor({ state: "visible", timeout: 10_000 });
  await cropLocator(page, detail, outPath, 10);
}

async function captureHeatmap(page, width, lang, outPath) {
  await gotoReady(page, "/discover?tab=heatmap", lang);
  const map = page.locator(".obs.obs-ambient").first();
  await map.waitFor({ state: "visible", timeout: 60_000 });
  const flowBtn = page.getByRole("button", { name: lang === "zh" ? "资金流" : "FLOW" }).first();
  await flowBtn.waitFor({ state: "visible", timeout: 20_000 });
  await flowBtn.click();
  const needle = lang === "zh" ? "净认沽" : "Net puts";
  await page.getByText(needle).first().waitFor({ state: "visible", timeout: 20_000 });
  await cropLocator(page, map, outPath, width === 390 ? 4 : 8);
}

async function capturePineLibrary(page, width, lang, outPath) {
  await gotoReady(page, "/scripts", lang);
  const side = page.locator(".pine-side").first();
  await side.waitFor({ state: "visible", timeout: 60_000 });
  const needle = lang === "zh" ? "我的脚本" : "My Scripts";
  await side.getByText(needle).first().waitFor({ state: "visible", timeout: 20_000 });
  await cropLocator(page, side, outPath, width === 390 ? 6 : 10);
}

const SURFACES = [
  { name: "OptionsFlowBoard", run: captureFlowBoard },
  { name: "FlowDesk", run: captureFlowDesk },
  { name: "AlertDetail", run: captureAlertDetail },
  { name: "HeatmapTreemap", run: captureHeatmap },
  { name: "PineLibrary", run: capturePineLibrary },
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
    "# B-PL-6 batch 3 — capture evidence",
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
    "surfaces: [OptionsFlowBoard, FlowDesk, AlertDetail, HeatmapTreemap, PineLibrary]",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_pl6_batch3.cjs",
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
