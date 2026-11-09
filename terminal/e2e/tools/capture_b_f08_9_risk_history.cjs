#!/usr/bin/env node
/**
 * B-F08-9 — dark evidence crops for Historical risk of today's book.
 *
 * Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator.
 *
 * From terminal/:
 *   node e2e/tools/capture_b_f08_9_risk_history.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f08-9-risk-history/.
 */
"use strict";

const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const { tmpdir } = require("node:os");
const { startLegacyServer, reportLegacyServer, waitLegacyServer, settleLegacyServer, captureRefusal } = require("./capture_ci_evidence.cjs");
const { capturePanel, publishPacket } = require("./portfolioEvidenceCapture.cjs");
const { createHash } = require("node:crypto");
const { mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f08-9-risk-history");
const LAYOUT_FILES = [
  "terminal/components/PortfolioView.tsx",
  "terminal/lib/portfolioRiskHistory.ts",
  "terminal/components/PortfolioRiskHistory.module.css",
  "terminal/components/PortfolioWorkspace.tsx",
  "terminal/components/PortfolioWorkspace.module.css",
  "terminal/app/globals.css",
  "terminal/e2e/tools/portfolioEvidenceCapture.cjs",
  "terminal/e2e/tools/capture_b_f08_9_risk_history.cjs",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3561);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  390: { width: 390, height: 844 },
};
const STATES = ["populated", "not-enough-history", "empty-book"];

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function cropName(state, width, lang) {
  return `${state}-${width}${lang === "zh" ? "-zh" : ""}.png`;
}

function startServer(stockdataBase) {
  const previous = process.env.STOCKDATA_BASE;
  try {
    process.env.STOCKDATA_BASE = stockdataBase;
    return startLegacyServer(ROOT, PORT);
  } finally {
    if (previous === undefined) delete process.env.STOCKDATA_BASE;
    else process.env.STOCKDATA_BASE = previous;
  }
}

async function newPage(browser, width, lang, storeKey, session) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[width],
    hasTouch: width === 390,
    locale: lang === "zh" ? "zh-CN" : "en-US",
    colorScheme: "dark",
  });
  await context.addCookies([
    { name: "mm_e2e_wl", value: storeKey, url: BASE },
    { name: session.SESSION_COOKIE_NAME, value: session.SESSION_COOKIE_VALUE, url: BASE },
  ]);
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
    json: { symbols: { ZZTA: { name: "Zeta Tech Alpha", zh: "泽塔科技阿尔法", last: 175 } } },
  }));
  await page.route("**/api/quote**", (route) => route.fulfill({
    json: { quotes: { ZZTA: { last: 180, chg: 2.5 } } },
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

async function requireJson(response, operation) {
  if (!response.ok()) {
    const error = new Error(operation + ": HTTP " + response.status());
    if ([401, 403].includes(response.status())) error.code = "CAPTURE_AUTH_REFUSED";
    throw error;
  }
  return response.json();
}

async function seed(page, drafts) {
  for (const draft of drafts) {
    const res = await page.request.post(`${BASE}/api/portfolio`, { data: { action: "create", ...draft } });
    await requireJson(res, "seed " + draft.ticker);
  }
}

async function prepareState(page, state) {
  if (state === "empty-book") return;
  if (state === "populated") {
    await seed(page, [
      { ticker: "ZZTA", shares: "100", entryPrice: "200" },
      { ticker: "ZZTB", shares: "40", entryPrice: "50" },
    ]);
    return;
  }
  if (state === "not-enough-history") {
    await seed(page, [{ ticker: "THIN", shares: "10", entryPrice: "20" }]);
  }
}

async function captureState(page, width, lang, state, outPath) {
  await prepareState(page, state);
  await page.goto(`${BASE}/portfolio`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await ensureLang(page, lang);
  const tab = page.locator("#portfolio-tab-risk");
  await tab.click();
  assert.equal(await tab.getAttribute("aria-selected"), "true", "Risk must be the selected native tab");
  await page.locator("#portfolio-panel-risk").waitFor({ state: "visible" });
  const loc = page.getByTestId("portfolio-risk-history");
  await loc.waitFor({ state: "visible", timeout: 30_000 });
  if (state === "empty-book") {
    await page.getByTestId("risk-history-empty").waitFor({ state: "visible", timeout: 20_000 });
  }
  if (state === "not-enough-history") {
    await loc.getByText(lang === "zh" ? "至少需要 126 个对齐的交易日" : "At least 126 aligned sessions").first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
  }
  if (state === "populated") {
    await loc.getByText(lang === "zh" ? "夏普比率" : "Sharpe ratio").waitFor({ state: "visible", timeout: 20_000 });
    // Production-partial card: RF unpublished, Sharpe/Sortino unread, beta still printed.
    await loc.getByText(
      lang === "zh" ? "三个月期国债收益率序列尚未发布" : "has not been published yet",
    ).first().waitFor({ state: "visible", timeout: 20_000 });
  }
  return capturePanel(page, loc, { name: outPath, pad: width === 390 ? 10 : 16 });
}

async function main() {
  const capturedAtHead = currentGitHead();
  const sourceHashes = Object.fromEntries(LAYOUT_FILES.map(rel => [rel, sha256File(rel)]));
  const stage = mkdtempSync(join(tmpdir(), "mmx-capture_b_f08_9_risk_history-"));
  console.log("unpromoted capture directory " + stage);
  const captures = [], failures = [];
  let child, browser, fixture, fixtureMod;
  try {
    fixtureMod = await import(pathToFileURL(join(ROOT, "e2e", "fixtureStockdataServer.mjs")).href);
    fixture = await fixtureMod.startFixtureStockdataServer();
    child = startServer(fixture.url);
    await reportLegacyServer(child, "started");
    await waitLegacyServer(child, BASE + "/portfolio", 180_000);
    browser = await chromium.launch({ headless: true });
    captureLoop: for (const width of [1440, 390]) {
      for (const lang of ["en", "zh"]) {
        for (const state of STATES) {
          const file = cropName(state, width, lang);
          process.stdout.write("capture " + file + " ... ");
          const storeKey = "crop-risk-" + state + "-" + width + "-" + lang + "-" + Date.now();
          const { context, page } = await newPage(browser, width, lang, storeKey, fixtureMod);
          try {
            const capture = await captureState(page, width, lang, state, join(stage, file));
            writeFileSync(join(stage, file), capture.bytes);
            captures.push({ file, ...capture });
            console.log("ok " + JSON.stringify(capture.geometry));
          } catch (error) {
            failures.push(error);
            if (!captureRefusal(error)) {
              try { await page.screenshot({ path: join(stage, "FAIL-" + file), fullPage: false }); }
              catch (diagnosticError) { failures.push(diagnosticError); }
            }
          } finally {
            try { await context.close(); } catch (error) { failures.push(error); }
          }
          if (failures.length) break captureLoop;
        }
      }
    }
  } catch (error) {
    failures.push(error);
  } finally {
    if (browser) try { await browser.close(); } catch (error) { failures.push(error); }
    if (child) try { await settleLegacyServer(child); } catch (error) { failures.push(error); }
    if (fixture) try { await fixture.close(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "Capture did not qualify; staged diagnostics: " + stage);
  assert.equal(currentGitHead(), capturedAtHead, "Source head changed during capture");
  assert.deepEqual(Object.fromEntries(LAYOUT_FILES.map(rel => [rel, sha256File(rel)])), sourceHashes,
    "Source bytes changed during capture");
  const expectedFiles = [1440, 390].flatMap(width => ["en", "zh"].flatMap(lang =>
    STATES.map(state => cropName(state, width, lang))));
  const files = captures.map(capture => capture.file).sort();
  const evidence = [
    "# B-F08-9 Historical risk of today's book — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    "layoutFiles:",
    ...LAYOUT_FILES.map((rel) => `  ${rel}: "${sourceHashes[rel]}"`),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - { name: desktop, width: 1440, height: 900 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "harness:",
    ...files.map((name) => {
      const state = name.startsWith("populated")
        ? "populated"
        : name.startsWith("not-enough-history")
          ? "not-enough-history"
          : "empty-book";
      return `  ${name}: { url: "/portfolio", state: ${state} }`;
    }),
    "surfaces: [PortfolioRiskHistoryReadout]",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators to false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_b_f08_9_risk_history.cjs",
    "files:",
    ...files.map((name) => `  - ${name}`),
    "",
  ].join("\n");
  publishPacket(OUT, captures, expectedFiles, evidence);
  writeFileSync(join(stage, "geometry.json"), JSON.stringify(captures.map(({ file, geometry }) => ({ file, ...geometry })), null, 2) + "\n");
  console.log("wrote " + files.length + " qualified crops + EVIDENCE.yml (head " + capturedAtHead + ")");
}

module.exports = { captureState, cropName, LAYOUT_FILES, STATES, prepareState };
if (require.main === module) main().catch(error => {
  console.error(error);
  if (error instanceof AggregateError) for (const cause of error.errors) console.error(cause);
  process.exitCode = 1;
});
