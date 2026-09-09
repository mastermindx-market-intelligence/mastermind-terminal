#!/usr/bin/env node
/**
 * B-F08-B5-1 — dark evidence crops for the portfolio targets readout.
 *
 * Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator.
 *
 * From terminal/:
 *   node e2e/tools/capture_b_f08_b5_1_targets.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f08-b5-1-targets/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f08-b5-1-targets");
const LAYOUT_FILES = [
  "terminal/components/PortfolioView.tsx",
  "terminal/lib/portfolioTargets.ts",
  "terminal/components/PortfolioTargets.module.css",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3543);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  390: { width: 390, height: 844 },
};
const STATES = [
  "empty",
  "populated-within-band",
  "populated-outside-band",
  "orphaned-target-disclosed",
  "unavailable",
];

mkdirSync(OUT, { recursive: true });

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function cropName(state, width, lang) {
  return `PortfolioTargets-${state}-${width}${lang === "zh" ? "-zh" : ""}.png`;
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
      const res = await fetch(`${BASE}/portfolio`, { redirect: "manual" });
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
  await page.route("**/api/portfolio-brief", (route) =>
    route.fulfill({ status: 403, json: { tier: "free" } }));
  await page.route("**/data/manifest.json", (route) => route.fulfill({
    json: { symbols: { NVDA: { name: "NVIDIA", zh: "英伟达", last: 175 }, AAPL: { name: "Apple", zh: "苹果", last: 228 } } },
  }));
  await page.route("**/api/quote**", (route) => route.fulfill({
    json: { quotes: { NVDA: { last: 180, chg: 2.5 }, AAPL: { last: 228, chg: 0 } } },
  }));
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
  await page.waitForTimeout(250);
  const box = await fresh.boundingBox();
  const vp = page.viewportSize();
  if (!box || !vp) throw new Error(`no box for ${outPath}`);
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  const width = Math.max(8, Math.min(vp.width - x, Math.ceil(box.width + pad * 2)));
  const height = Math.max(8, Math.min(vp.height - y, Math.ceil(box.height + pad * 2)));
  await page.screenshot({ path: outPath, clip: { x, y, width, height } });
}

async function seed(page, drafts) {
  for (const draft of drafts) {
    const res = await page.request.post(`${BASE}/api/portfolio`, { data: { action: "create", ...draft } });
    if (!res.ok()) throw new Error(`seed ${draft.ticker} failed: ${res.status()}`);
    const body = await res.json();
    draft.id = body.position && body.position.id;
  }
}

async function setTarget(page, ticker, targetWeightPct, bandPct) {
  const res = await page.request.post(`${BASE}/api/portfolio/targets`, {
    data: { action: "set", ticker, targetWeightPct, bandPct },
  });
  if (!res.ok()) throw new Error(`set ${ticker} failed: ${res.status()} ${await res.text()}`);
}

async function prepareState(page, state) {
  if (state === "empty") {
    await seed(page, [{ ticker: "NVDA" }]);
    return;
  }
  if (state === "populated-within-band") {
    await seed(page, [{ ticker: "NVDA", shares: "100", entryPrice: "200" }]);
    await setTarget(page, "NVDA", 95, 5);
    return;
  }
  if (state === "populated-outside-band") {
    await seed(page, [{ ticker: "NVDA", shares: "100", entryPrice: "200" }]);
    await setTarget(page, "NVDA", 80, 5);
    return;
  }
  if (state === "orphaned-target-disclosed") {
    const rows = [
      { ticker: "NVDA", shares: "100", entryPrice: "200" },
      { ticker: "AAPL", shares: "10", entryPrice: "200" },
    ];
    await seed(page, rows);
    await setTarget(page, "NVDA", 80, 5);
    const close = await page.request.post(`${BASE}/api/portfolio`, {
      data: { action: "close", id: rows[0].id },
    });
    if (!close.ok()) throw new Error(`close NVDA failed: ${close.status()}`);
    return;
  }
  if (state === "unavailable") {
    await seed(page, [{ ticker: "NVDA", shares: "100", entryPrice: "200" }]);
    await page.route("**/api/portfolio/targets", (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ status: 503, json: { error: "targets unavailable" } });
      }
      return route.continue();
    });
  }
}

async function captureState(page, width, lang, state, outPath) {
  await prepareState(page, state);
  await page.goto(`${BASE}/portfolio`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await ensureLang(page, lang);
  await page.waitForTimeout(600);
  const testId = state === "unavailable" ? "portfolio-targets-unavailable" : "portfolio-targets";
  const loc = page.getByTestId(testId);
  await loc.waitFor({ state: "visible", timeout: 20_000 });
  await loc.scrollIntoViewIfNeeded();
  await cropLocator(page, loc, outPath, width === 390 ? 10 : 16);
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
          for (const state of STATES) {
            const file = cropName(state, width, lang);
            process.stdout.write(`capture ${file} … `);
            const storeKey = `crop-${state}-${width}-${lang}-${Date.now()}`;
            const { context, page } = await newPage(browser, width, lang, storeKey);
            try {
              await captureState(page, width, lang, state, join(OUT, file));
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

  files.sort();
  const evidence = [
    "# B-F08-B5-1 portfolio construction targets — capture evidence",
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
    "  - { name: mobile, width: 390, height: 844 }",
    "surfaces: [PortfolioTargetsReadout]",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_b_f08_b5_1_targets.cjs",
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
