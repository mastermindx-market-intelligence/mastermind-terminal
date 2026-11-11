#!/usr/bin/env node
/**
 * W9T F08-13 — dark evidence crops for the Portfolio-targets Settings section.
 *
 * Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator.
 *
 * From terminal/:
 *   node e2e/tools/capture_w9t_f08_13_targets.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/w9t-f08-13-targets-readout/.
 */
"use strict";

const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const { tmpdir } = require("node:os");
const { createHash, randomUUID } = require("node:crypto");
const { mkdirSync, mkdtempSync, copyFileSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = resolve(__dirname, "..", "..");
const REPO = resolve(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "w9t-f08-13-targets-readout");
const LAYOUT_FILES = [
  "terminal/components/PortfolioView.tsx",
  "terminal/components/PortfolioTargets.module.css",
  "terminal/lib/portfolioTargets.ts",
  "terminal/lib/portfolioMoney.ts",
  "terminal/lib/portfolioWorkspace.ts",
  "terminal/app/settings.css",
  "terminal/app/globals.css",
  "terminal/components/settings/SectionPortfolioTargets.tsx",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/components/settings/SettingsProvider.tsx",
  "terminal/components/settings/icons.tsx",
  "terminal/lib/i18n.tsx",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3546);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  390: { width: 390, height: 844 },
};

const STATES = [{ id: "empty" }, { id: "populated" }];
const HEAD_SHA = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
assert.match(HEAD_SHA, /^[0-9a-f]{40}$/);
const CAPTURE_OUT = mkdtempSync(join(tmpdir(), "mmx-w9t-targets-"));
console.log(`unpromoted capture directory ${CAPTURE_OUT}`);

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function layoutHashes() {
  const out = {};
  for (const rel of LAYOUT_FILES) {
    const abs = join(REPO, rel);
    out[rel] = sha256(abs);
  }
  return out;
}

async function ensureServer() {
  // The caller owns a fresh fixture server from this same checkout and records
  // its startup and settled cleanup separately; this producer never stops it.
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch(`${BASE}/terminal?symbol=NVDA`, { signal: AbortSignal.timeout(5_000) });
      if ([401, 403].includes(response.status)) throw Object.assign(new Error(`CAPTURE_AUTH_REFUSED: ${response.status}`), { code: "CAPTURE_AUTH_REFUSED" });
      if (response.ok) return;
    } catch (error) { if (error.code === "CAPTURE_AUTH_REFUSED") throw error; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Caller-owned fixture server on ${BASE} did not become ready`);
}

async function gotoSettings(page, lang) {
  await page.addInitScript((useZh) => {
    localStorage.setItem("mm.lang", useZh ? "zh" : "en");
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    // document.documentElement is null on the about:blank preload frame; the
    // attribute writes happen on every navigation, so a guard is enough.
    const root = document.documentElement;
    if (!root) return;
    root.setAttribute("data-theme", "dark");
    root.setAttribute("data-lang", useZh ? "zh" : "en");
    root.setAttribute("lang", useZh ? "zh-CN" : "en");
  }, lang === "zh");
  // /terminal is the only route that picks TERMINAL_E2E_EMAIL up into the chrome
  // (`(shell)/layout.tsx` resolves auth from real Supabase claims and renders
  // email="" under the fixture, which would route the click into onboarding).
  // /terminal hands the email straight to TerminalShell → SettingsButton, and
  // SettingsProvider is mounted once for the whole app, so the panel state is
  // identical whichever shell opened it.
  await page.goto(`${BASE}/terminal?symbol=NVDA`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('button[aria-label]'))
      .some((el) => {
        const lbl = el.getAttribute("aria-label") || "";
        return /^Settings$|^设置$/.test(lbl);
      }),
    undefined, { timeout: 60_000 },
  );
  await page.locator('button[aria-label="Settings"]:visible, button[aria-label="设置"]:visible').first().click();
  await page.locator(".acs-overlay.open .acs-card").waitFor({ state: "visible", timeout: 30_000 });
  const tabName = lang === "zh" ? "组合目标权重" : "Portfolio targets";
  await page.getByRole("tab", { name: tabName, exact: true }).click();
  await page.locator('[data-testid="portfolio-targets-settings"]').waitFor({ timeout: 30_000 });
}

async function requireJson(response, operation) {
  if (!response.ok()) {
    const error = new Error(`${operation}: HTTP ${response.status()}`);
    if ([401, 403].includes(response.status())) error.code = "CAPTURE_AUTH_REFUSED";
    throw error;
  }
  return response.json();
}

async function captureOne(browser, viewport, state, lang) {
  const file = `PortfolioTargetsSettings-${state.id}-${viewport.name}-${lang}.png`;
  const context = await browser.newContext({
    viewport: viewport.size, hasTouch: viewport.size.width === 390,
    locale: lang === "zh" ? "zh-CN" : "en-US", colorScheme: "dark", deviceScaleFactor: 2,
  });
  try {
    await context.addCookies([{ name: "mm_e2e_wl", value: `settings-targets-${randomUUID()}`, url: BASE }]);
    if (state.id === "populated") {
      await requireJson(await context.request.post(`${BASE}/api/portfolio`, {
        data: { action: "create", ticker: "NVDA", shares: 100, entryPrice: 200, entryCurrency: "USD" },
      }), "create native fixture position");
      await requireJson(await context.request.post(`${BASE}/api/portfolio/targets`, {
        data: { action: "set", ticker: "NVDA", targetWeightPct: 60, bandPct: 10 },
      }), "set native fixture target");
    }
    const positions = await requireJson(await context.request.get(`${BASE}/api/portfolio?view=positions`), "positions readback");
    const targetRead = await requireJson(await context.request.get(`${BASE}/api/portfolio/targets`), "targets readback");
    assert.equal(typeof positions.bookKey, "string");
    assert.equal(targetRead.bookKey, positions.bookKey, "Native readout must name the same position book");
    const summary = targetRead.summary;
    assert.equal(summary.schema, "portfolio_targets.v1");
    if (state.id === "empty") {
      assert.deepEqual(positions.positions, []);
      assert.equal(summary.targetsSumPct, null); assert.equal(summary.targetsSumOffBy100, null);
      for (const key of ["drifts", "untargeted", "orphaned"]) assert.deepEqual(summary[key], []);
    } else {
      assert.equal(positions.positions.length, 1);
      const position = positions.positions[0];
      for (const [key, value] of Object.entries({ ticker: "NVDA", shares: 100, entryPrice: 200, entryCurrency: "USD", status: "open" })) assert.equal(position[key], value, key);
      assert.equal(summary.costCurrency, "USD");
      assert.equal(summary.targetsSumPct, 60); assert.equal(summary.targetsSumOffBy100, -40);
      assert.equal(summary.drifts.length, 1);
      for (const [key, value] of Object.entries({ ticker: "NVDA", currentWeightPct: 100, targetWeightPct: 60, driftPct: 40, bandPct: 10, status: "outside_band" })) assert.equal(summary.drifts[0][key], value, key);
      assert.deepEqual(summary.untargeted, []); assert.deepEqual(summary.orphaned, []);
    }
    const page = await context.newPage();
    page.on("pageerror", error => console.error(`[${file}] pageerror:`, error.message));
    await gotoSettings(page, lang);
    await page.getByTestId(state.id === "empty" ? "portfolio-targets-empty" : "portfolio-targets-loaded").waitFor({ state: "visible", timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    assert.equal(await page.locator("[data-nextjs-dev-tools-button]").count(), 0, `${file}: Next indicator must be absent before capture`);
    await page.locator(".acs-overlay.open .acs-card").screenshot({ path: join(CAPTURE_OUT, file) });
    return { file, positions, targetRead };
  } finally { await context.close(); }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const sourceHashes = layoutHashes();
  await ensureServer();
  const browser = await chromium.launch({ headless: true });
  const readbacks = [];
  try {
    for (const state of STATES) for (const [name, size] of Object.entries(VIEWPORTS)) for (const lang of ["en", "zh"]) {
      const receipt = await captureOne(browser, { name, size }, state, lang);
      readbacks.push(receipt); console.log(`captured ${receipt.file}`);
    }
  } finally { await browser.close(); }
  const files = readbacks.map(row => row.file).sort();
  const expected = STATES.flatMap(state => Object.keys(VIEWPORTS).flatMap(width => ["en", "zh"].map(lang => `PortfolioTargetsSettings-${state.id}-${width}-${lang}.png`))).sort();
  assert.deepEqual(files, expected, "Capture requires the complete unique eight-cell matrix");
  assert.equal(new Set(files).size, 8);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(), HEAD_SHA);
  assert.deepEqual(layoutHashes(), sourceHashes, "Source changed during capture");
  const captureFiles = Object.fromEntries(files.map(file => {
    const bytes = readFileSync(join(CAPTURE_OUT, file));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", file);
    return [file, createHash("sha256").update(bytes).digest("hex")];
  }));
  const evidence = {
    capturedAtHead: HEAD_SHA, capturedAt: new Date().toISOString(), layoutFiles: sourceHashes,
    theme: "dark", languages: ["en", "zh"],
    viewports: [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }],
    deviceScaleFactor: 2, surfaces: ["SectionPortfolioTargets"], capture_flag: "TERMINAL_E2E_FIXTURE",
    capture_flag_law: "next.config.ts sets devIndicators to false for TERMINAL_E2E_FIXTURE; this producer uses the caller-owned fixture server from the same checkout.",
    serverOwnership: "Caller records fresh startup and settled cleanup separately; this producer owns its browser contexts only.",
    command: "From terminal/, with the caller-owned fixture server ready: node e2e/tools/capture_w9t_f08_13_targets.cjs",
    files, captureFiles,
  };
  for (const file of files) copyFileSync(join(CAPTURE_OUT, file), join(OUT, file));
  writeFileSync(join(OUT, "NATIVE_READBACKS.json"), JSON.stringify({ capturedAtHead: HEAD_SHA, readbacks }, null, 2) + "\n");
  writeFileSync(join(OUT, "EVIDENCE.yml"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(`Wrote ${files.length} crops + EVIDENCE.yml under ${OUT}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
