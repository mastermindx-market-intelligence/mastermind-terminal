#!/usr/bin/env node
/**
 * GMI gate #8 — dark evidence crops for the selection cohort card.
 *
 * Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator.
 *
 * From terminal/:
 *   node e2e/tools/capture_gmi_gate8_cohort_card.cjs
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "gmi-gate8-cohort-card");
const MASTER_HEAD = "c9d211fdcc7b370575af91868932a6764294df0d";
const LAYOUT_FILES = [
  "terminal/lib/selectionCohort.ts",
  "terminal/components/prophet/SelectionCohortCard.tsx",
  "terminal/components/prophet/SelectionCohortCard.module.css",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3572);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  390: { width: 390, height: 844 },
};
const STATES = ["ready", "unavailable", "empty"];
const COHORT_ROUTE = /\/api\/nw\?f=selection_cohort_us$/;

const READY = readFileSync(join(ROOT, "public", "data", "nw_selection_cohort_us_fixture.json"), "utf8");
const UNAVAILABLE = readFileSync(
  join(ROOT, "lib", "__tests__", "fixtures", "selection_cohort", "unavailable.json"),
  "utf8",
);
const EMPTY = readFileSync(
  join(ROOT, "lib", "__tests__", "fixtures", "selection_cohort", "empty.json"),
  "utf8",
);

mkdirSync(OUT, { recursive: true });

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function cropName(state, width, lang) {
  const vp = width === 1440 ? "desktop" : "mobile";
  return `${vp}-${lang}-${state}.png`;
}

function bodyForState(state) {
  if (state === "ready") return { status: 200, body: READY };
  if (state === "empty") return { status: 200, body: EMPTY };
  return { status: 200, body: UNAVAILABLE };
}

function startServer() {
  const env = {
    ...process.env,
    ANALYSIS_LOCAL_PREVIEW: "1",
    ADMIN_DEV: "1",
    TERMINAL_E2E_FIXTURE: "1",
    FLOW_FIXTURE: "1",
    TERMINAL_E2E_EMAIL: "responsive@example.com",
    TERMINAL_E2E_ENTITLEMENT: "unlimited",
    RATE_LIMIT_MAX: "100000",
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
      const res = await fetch(`${BASE}/options?tab=prophet`, { redirect: "manual" });
      last = String(res.status);
      if (res.status >= 200 && res.status < 500) return;
    } catch (err) {
      last = err.cause?.code || err.message;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`dev server on ${PORT} never answered (${last})`);
}

async function newPage(browser, width, lang, storeKey) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[width],
    hasTouch: width === 390,
    locale: lang === "zh" ? "zh-CN" : "en-US",
    colorScheme: "dark",
    reducedMotion: "reduce",
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

async function cropLocator(page, locator, outPath, pad = 18) {
  const fresh = locator.first();
  await fresh.waitFor({ state: "visible", timeout: 20_000 });
  await fresh.scrollIntoViewIfNeeded();
  let lastH = 0;
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(150);
    const box = await fresh.boundingBox();
    const h = box ? Math.ceil(box.height) : 0;
    if (h >= 120 && Math.abs(h - lastH) < 4) break;
    lastH = h;
  }
  const box = await fresh.boundingBox();
  const vp = page.viewportSize();
  if (!box || !vp) throw new Error(`no box for ${outPath}`);
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  const width = Math.max(8, Math.min(vp.width - x, Math.ceil(box.width + pad * 2)));
  const height = Math.max(8, Math.min(vp.height - y, Math.ceil(box.height + pad * 2)));
  await page.screenshot({ path: outPath, clip: { x, y, width, height } });
}

async function captureState(page, state, outPath, width) {
  const { status, body } = bodyForState(state);
  await page.route(COHORT_ROUTE, (route) =>
    route.fulfill({ status, contentType: "application/json", body }));
  await page.goto(`${BASE}/options?tab=prophet`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const card = page.getByTestId("selection-cohort-card");
  await card.waitFor({ state: "visible", timeout: 20_000 });
  await expectState(card, state);
  await cropLocator(page, card, outPath, width === 390 ? 10 : 16);
}

async function expectState(card, state) {
  const handle = await card.elementHandle();
  if (!handle) throw new Error("card missing");
  const attr = await handle.getAttribute("data-state");
  if (attr !== state) throw new Error(`expected data-state=${state}, got ${attr}`);
}

async function capturePageShot(page, outPath) {
  await page.route(COHORT_ROUTE, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: READY }));
  await page.goto(`${BASE}/options?tab=prophet`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const card = page.getByTestId("selection-cohort-card");
  await card.waitFor({ state: "visible", timeout: 20_000 });
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: outPath, fullPage: false });
}

async function main() {
  const child = startServer();
  const files = [];
  let failed = 0;
  try {
    await waitForServer(180_000);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const width of [1440, 390]) {
        for (const lang of ["en", "zh"]) {
          for (const state of STATES) {
            const file = cropName(state, width, lang);
            process.stdout.write(`capture ${file} … `);
            const storeKey = `crop-g8-${state}-${width}-${lang}-${Date.now()}`;
            const { context, page } = await newPage(browser, width, lang, storeKey);
            try {
              await captureState(page, state, join(OUT, file), width);
              await assertNoNextIndicator(page, file);
              files.push(file);
              console.log("ok");
            } catch (err) {
              failed += 1;
              console.log(`FAIL ${err && err.message ? err.message : err}`);
            } finally {
              await context.close();
            }
          }
        }
      }
      process.stdout.write("capture desktop-en-ready-page.png … ");
      const { context, page } = await newPage(browser, 1440, "en", `crop-g8-page-${Date.now()}`);
      try {
        await capturePageShot(page, join(OUT, "desktop-en-ready-page.png"));
        await assertNoNextIndicator(page, "desktop-en-ready-page.png");
        files.push("desktop-en-ready-page.png");
        console.log("ok");
      } catch (err) {
        failed += 1;
        console.log(`FAIL ${err && err.message ? err.message : err}`);
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(child);
  }

  files.sort();
  const evidence = [
    "# GMI gate #8 — Shared themes · latest U.S. picks card — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${MASTER_HEAD}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    "layoutFiles:",
    ...LAYOUT_FILES.map((rel) => `  ${rel}: "${sha256File(rel)}"`),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - { name: desktop, width: 1440, height: 900 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "surfaces: [SelectionCohortCard]",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_gmi_gate8_cohort_card.cjs",
    "files:",
    ...files.map((name) => `  - ${name}`),
    "",
  ];
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence.join("\n"), "utf8");
  if (failed) {
    console.error(`capture finished with ${failed} failure(s)`);
    process.exit(1);
  }
  console.log(`wrote ${files.length} crops + EVIDENCE.yml to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
