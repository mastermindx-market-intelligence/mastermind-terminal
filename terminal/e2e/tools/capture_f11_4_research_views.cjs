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
const { mkdirSync, readdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f11-4-research-views");
const LAYOUT_FILES = [
  "terminal/components/workspaces/ThesisWorkspace.tsx",
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

async function assertNoNextIndicator(page, file) {
  await page.waitForTimeout(250);
  await stripDevOverlay(page);
  const n = await page.locator("[data-nextjs-dev-tools-button]").count();
  if (n > 0) throw new Error(`${file}: Next.js N overlay still mounted (${n})`);
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
  await cropPane(page, outPath);
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
  await cropPane(page, outPath);
}

async function captureSaveFlow(page, context, width, lang, outPath) {
  await createThesis(context, lang === "zh" ? "英伟达运营杠杆" : "NVDA operating leverage", "NVDA");
  await createThesis(context, lang === "zh" ? "苹果服务" : "Apple services", "AAPL");
  await openList(page, width, lang);
  await page.getByRole("tab", { name: lang === "zh" ? "覆盖范围" : "Coverage" }).click();
  await page.getByRole("button", { name: /NVDA/ }).first().click();
  await page.getByTestId("rms-save-view").click();
  await page.getByLabel(lang === "zh" ? "为这个视图命名" : "Name this view").waitFor({ state: "visible" });
  await cropPane(page, outPath);
}

async function captureWindowClosed(page, context, width, lang, outPath) {
  const thesisId = await createThesis(context, lang === "zh" ? "窗口已结束的论点" : "Closed-window thesis", "NVDA");
  await page.route("**/api/thesis-fire-status**", async (route) => {
    const url = new URL(route.request().url());
    const ids = url.searchParams.getAll("id");
    const states = {};
    for (const id of ids) {
      states[id] = id === thesisId
        ? { source: "monitor", state: "window_closed", at: "2026-09-01T00:00:00.000Z" }
        : { source: "unavailable" };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ states }) });
  });
  await openList(page, width, lang);
  await page.locator('[data-builtin="window_closed"]').click();
  await page.waitForTimeout(400);
  await cropPane(page, outPath);
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
            { name: "window-closed", run: (page, context) => captureWindowClosed(page, context, width, lang, join(OUT, cropName("window-closed", width, lang))) },
          ];
          for (const surface of surfaces) {
            const file = cropName(surface.name, width, lang);
            process.stdout.write(`capture ${file} … `);
            const storeKey = `f11-4-${surface.name}-${width}-${lang}-${randomUUID().slice(0, 8)}`;
            try {
              await withStore(browser, width, lang, storeKey, async (page, context) => {
                await surface.run(page, context);
                await assertNoNextIndicator(page, file);
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
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_f11_4_research_views.cjs",
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
