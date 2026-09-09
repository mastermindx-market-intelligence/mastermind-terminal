#!/usr/bin/env node
/**
 * B-F11-4 — dark evidence crops for research management views.
 *
 * Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_f11_4_research_views.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f11-4-research-views/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { basename, join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f11-4-research-views");
const LAYOUT_FILES = [
  "terminal/components/workspaces/ThesisWorkspace.tsx",
  // Round-3 review (Meta-CEO B ruling R4): this packet changes the workspace stylesheet,
  // and the lock is what tells a later reader whether the pixels still depict the code.
  // Without it, an edit to the layout of this very surface would leave the lock green
  // over stale crops.
  "terminal/components/workspaces/ThesisWorkspace.module.css",
  "terminal/lib/rmsViews.ts",
  "terminal/lib/savedViews.ts",
  "terminal/lib/plainLabels.ts",
  "terminal/lib/i18n.tsx",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3547);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  390: { width: 390, height: 844 },
};

mkdirSync(OUT, { recursive: true });

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
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

function subject(symbol) {
  return {
    schema: "mastermind.thesis-subject-ref/v1",
    kind: "issuer",
    owner: "terminal.analysis_symbol",
    key: symbol,
    identityState: "listing_scoped",
    listing: { symbol, mic: null, securityId: null },
    companyId: null,
    display: `${symbol} · listing scoped`,
  };
}

function content(title) {
  return {
    schema: "mastermind.thesis-content/v1",
    title,
    statement: `${title} statement`,
    catalysts: ["Data-center revenue compounds"],
    falsifiers: ["Gross margin falls below 65%"],
    risks: ["Customer concentration"],
    horizon: "quarters",
    effectiveAt: null,
    revisionNote: null,
  };
}

async function createThesis(context, title, symbol) {
  const response = await context.request.post(`${BASE}/api/theses`, {
    data: {
      action: "create",
      clientRequestId: randomUUID(),
      subject: subject(symbol),
      content: content(title),
    },
  });
  if (response.status() !== 201) {
    throw new Error(`create thesis failed: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()).thesisId;
}

async function createSavedView(context, name, filter) {
  const response = await context.request.put(`${BASE}/api/thesis-saved-views`, {
    data: { action: "create", name, filter },
  });
  if (response.status() !== 201) {
    throw new Error(`create view failed: ${response.status()} ${await response.text()}`);
  }
}

async function openList(page, width, lang) {
  await page.goto(`${BASE}/analysis?view=theses`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.evaluate((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
    window.dispatchEvent(new CustomEvent("mm:lang"));
  }, lang);
  await page.waitForSelector('[data-testid="thesis-workspace"]', { timeout: 30_000 });
  if (width < 700) {
    const back = page.getByRole("button", { name: lang === "zh" ? "返回列表" : "Back to list" });
    if (await back.count()) {
      await back.click().catch(() => {});
    }
  }
  await page.waitForSelector('[data-testid="rms-saved-views"]', { timeout: 20_000, state: "visible" });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
}

async function stripDevOverlay(page) {
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
  });
}

// Round-2 review of PR #546 (Opus MAJOR 4): this used to call stripDevOverlay() FIRST
// and then count, so the count was 0 by construction and the throw was unreachable —
// and it ran after the PNG had already been written. Count on the pre-strip DOM, and
// let shootPane() run it before the screenshot, so a present bubble fails the capture.
async function assertNoNextIndicator(page, file) {
  await page.waitForTimeout(250);
  const n = await page.locator("[data-nextjs-dev-tools-button]").count();
  if (n > 0) throw new Error(`${file}: Next.js N overlay still mounted (${n})`);
}

/** Assert first, then strip, then shoot. */
async function shootPane(page, outPath) {
  await assertNoNextIndicator(page, basename(outPath));
  await stripDevOverlay(page);
  await cropPane(page, outPath);
}

async function cropPane(page, outPath) {
  const pane = page.locator('[data-testid="thesis-list-pane"]');
  await pane.waitFor({ state: "visible", timeout: 20_000 });
  const box = await pane.boundingBox();
  if (!box) throw new Error(`no list pane box for ${outPath}`);
  const vp = page.viewportSize();
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const width = Math.max(8, Math.min(vp.width - x, Math.ceil(box.width)));
  const height = Math.max(8, Math.min(vp.height - y, Math.ceil(box.height)));
  await page.screenshot({ path: outPath, clip: { x, y, width, height } });
}

async function withStore(browser, width, lang, storeKey, run) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[width],
    hasTouch: width === 390,
    locale: lang === "zh" ? "zh-CN" : "en-US",
    colorScheme: "dark",
  });
  await context.addCookies([{ name: "mm_e2e_wl", value: storeKey, url: BASE }]);
  await context.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
  }, lang);
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  try {
    await run(page, context);
  } finally {
    await context.close();
  }
}

async function captureEmpty(page, width, lang, outPath) {
  await openList(page, width, lang);
  await page.waitForSelector('[data-testid="rms-saved-views-empty"]', { timeout: 15_000 });
  await shootPane(page, outPath);
}

async function captureNamed(page, context, width, lang, outPath) {
  await createThesis(context, lang === "zh" ? "英伟达运营杠杆" : "NVDA operating leverage", "NVDA");
  await createThesis(context, lang === "zh" ? "苹果服务" : "Apple services", "AAPL");
  await createSavedView(context, lang === "zh" ? "只看英伟达" : "NVDA only", {
    lifecycle: "active",
    subjectGroupKey: "terminal.analysis_symbol|issuer|NVDA",
  });
  await createSavedView(context, lang === "zh" ? "三十天未更新" : "Check on this", {
    lifecycle: "active",
    staleDays: 30,
  });
  await openList(page, width, lang);
  await page.waitForSelector('[data-saved-view]', { timeout: 15_000 });
  await shootPane(page, outPath);
}

async function captureSaveFlow(page, context, width, lang, outPath) {
  await createThesis(context, lang === "zh" ? "英伟达运营杠杆" : "NVDA operating leverage", "NVDA");
  await createThesis(context, lang === "zh" ? "苹果服务" : "Apple services", "AAPL");
  await openList(page, width, lang);
  await page.getByRole("tab", { name: lang === "zh" ? "覆盖范围" : "Coverage" }).click();
  await page.getByRole("button", { name: /NVDA/ }).first().click();
  await page.getByTestId("rms-save-view").click();
  await page.getByLabel(lang === "zh" ? "为这个视图命名" : "Name this view").waitFor({ state: "visible" });
  await shootPane(page, outPath);
}

// Round-2 review of PR #546 (BLOCKER 1): this surface used to `page.route()` the app's
// own /api/thesis-fire-status and hand-fulfill a window_closed state, so the committed
// pixels depicted no shipped code — neither the route handler nor
// mapOutboxToConditionStates() ever ran. It now runs against a REAL alert_outbox row in
// the fixture database (store key carries FIXTURE_MONITOR_FIRED_TOKEN, see
// terminal/lib/watchlistsFixtureDb.ts), which the first thesis created in this store
// gets and the second does not — so the preset filters one matched row from two theses
// through the shipped read path. No network stub anywhere in this file.
async function captureWindowClosed(page, context, width, lang, outPath) {
  await createThesis(context, lang === "zh" ? "窗口已结束的论点" : "Closed-window thesis", "NVDA");
  await createThesis(context, lang === "zh" ? "窗口仍开着的论点" : "Open-window thesis", "AAPL");
  await openList(page, width, lang);
  await page.locator('[data-builtin="window_closed"]').click();
  await page.waitForTimeout(400);
  const rows = await page.locator('[data-testid="rms-lens-panel"] [data-testid="rms-empty"]').count();
  if (rows > 0) {
    throw new Error(`${basename(outPath)}: window_closed rendered its empty state — the fixture alert_outbox row did not reach the route`);
  }
  await shootPane(page, outPath);
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
          const surfaces = [
            { name: "empty", run: (page) => captureEmpty(page, width, lang, join(OUT, cropName("empty", width, lang))) },
            { name: "named-views", run: (page, context) => captureNamed(page, context, width, lang, join(OUT, cropName("named-views", width, lang))) },
            { name: "save-flow", run: (page, context) => captureSaveFlow(page, context, width, lang, join(OUT, cropName("save-flow", width, lang))) },
            // "monitorfired" in the store key is what seeds the alert_outbox row.
            { name: "window-closed", store: "monitorfired", run: (page, context) => captureWindowClosed(page, context, width, lang, join(OUT, cropName("window-closed", width, lang))) },
          ];
          for (const surface of surfaces) {
            const file = cropName(surface.name, width, lang);
            process.stdout.write(`capture ${file} … `);
            const storeKey = `f11-4-${surface.store || surface.name}-${width}-${lang}-${randomUUID().slice(0, 8)}`;
            try {
              await withStore(browser, width, lang, storeKey, async (page, context) => {
                await surface.run(page, context);
              });
              files.push(file);
              console.log("ok");
            } catch (err) {
              failed += 1;
              console.log(`FAIL ${err && err.message ? err.message : err}`);
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
    "# B-F11-4 research management views — capture evidence",
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
    "surfaces: [empty, named-views, save-flow, window-closed]",
    // Carried disclosure (named in the PR body since round 1, restated here so the
    // manifest itself cannot be read as claiming full-width frames): `viewports` above
    // describes the BROWSER viewport the page was rendered at, not the PNG's own width.
    "crop_surface: |",
    "  Every PNG is the thesis list pane only — cropPane() clips to",
    "  [data-testid=\"thesis-list-pane\"], the surface spec 2.10 asks for. At the 1440",
    "  viewport that pane is about 290px wide, so a \"1440\" crop is a ~290px image taken",
    "  from a 1440x900 render, not a 1440-wide frame.",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "window_closed_data: |",
    "  A real alert_outbox row in the e2e fixture database, seeded by the fixture",
    "  transport for the first thesis created in a store whose key carries",
    "  FIXTURE_MONITOR_FIRED_TOKEN (terminal/lib/watchlistsFixtureDb.ts). The shipped",
    "  GET /api/thesis-fire-status route and mapOutboxToConditionStates() run for real",
    "  against it; nothing in this capture stubs a network response.",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_f11_4_research_views.cjs",
    "files:",
    // Opus minor 6 (round-2 review): this used to union the directory listing, so a PNG
    // left behind by an earlier head was listed beside freshly computed hashes. Only
    // what THIS run wrote is listed, and a run with any failure writes no manifest at all.
    ...[...files].sort().map((f) => `  - ${f}`),
    "",
  ].join("\n");
  if (failed) {
    console.error(`${failed} surface(s) failed — EVIDENCE.yml not written`);
    process.exitCode = 1;
    return;
  }
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence);
  console.log(`capturedAtHead ${capturedAtHead}`);
  console.log(`wrote ${files.length} crops + EVIDENCE.yml to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
