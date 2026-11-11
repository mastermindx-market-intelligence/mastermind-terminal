#!/usr/bin/env node
/**
 * B-F08-8 — dark evidence crops for the event-impact invalidation line.
 *
 * Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator.
 *
 * From terminal/:
 *   node e2e/tools/capture_b_f08_8_invalidation.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f08-8-invalidation/.
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
const { chromium, expect } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f08-8-invalidation");
const LAYOUT_FILES = [
  "terminal/lib/eventImpact.ts",
  "terminal/components/EventImpactPanel.tsx",
  "terminal/components/EventImpactPanel.module.css",
  "terminal/components/PortfolioView.tsx",
  "terminal/components/PortfolioWorkspace.tsx",
  "terminal/components/PortfolioWorkspace.module.css",
  "terminal/app/globals.css",
  "terminal/e2e/tools/portfolioEvidenceCapture.cjs",
  "terminal/e2e/tools/capture_b_f08_8_invalidation.cjs",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3571);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  390: { width: 390, height: 844 },
};
const STATES = ["condition", "typed-null"];

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function cropName(state, width, lang) {
  const vp = width === 1440 ? "desktop" : "mobile";
  return `${vp}-${lang}-${state}.png`;
}

const CONDITION_EVENT = {
  eventId: "earnings|AAPL|2026-10-30",
  kind: "earnings",
  ticker: "AAPL",
  date: "2026-10-30",
  daysUntil: 5,
  positions: [{ id: "p1", ticker: "AAPL", shares: 10, status: "open" }],
  direction: { state: "not_stated" },
  mechanism: { state: "not_stated" },
  timeframe: { state: "not_stated" },
  invalidation: {
    condition_en: "A last close has printed on the report date.",
    condition_zh: "报告日已经公布收盘价。",
    metric_owner: "hub/lib/anchor.js",
    comparator: "at or above",
    threshold: null,
    checked_against: "named date",
    named_date: "2026-10-30",
  },
  sourcePath: "/data/portfolio_ctx.json",
};

const TYPED_NULL_EVENT = {
  // Join never emits macro_release/index_review. Using those kinds here made
  // the headline claim AAPL is named on a calendar the same panel's unjoinable
  // line says does not name individual holdings (MINOR 1, r2). Earnings is the
  // only kind join emits; the typed-null slot is injected on that shape.
  eventId: "earnings|AAPL|2026-10-30",
  kind: "earnings",
  ticker: "AAPL",
  date: "2026-10-30",
  daysUntil: 5,
  positions: [{ id: "p1", ticker: "AAPL", shares: 10, status: "open" }],
  direction: { state: "not_stated" },
  mechanism: { state: "not_stated" },
  timeframe: { state: "not_stated" },
  invalidation: {
    condition_en: "We haven't defined what would void this read yet.",
    condition_zh: "我们尚未定义何种情况会让此判断失效。",
    metric_owner: null,
    comparator: null,
    threshold: null,
    checked_against: null,
    named_date: null,
    null_reason: "no_ticker_keyed_metric",
  },
  sourcePath: "/data/portfolio_ctx.json",
};

function impactBody(state, positionId = "p1") {
  return {
    state: "ok",
    asof: "2026-09-05",
    heldTickers: 1,
    heldPositions: 1,
    unjoinable: [
      {
        path: "/event_windows/snapshot.json",
        reason: "no_ticker_field",
        labelEn: "the macro release calendar",
        labelZh: "宏观数据发布日历",
      },
      {
        path: "/factordata/hk_catalyst_calendar.json",
        reason: "no_ticker_field",
        labelEn: "the index-review calendar",
        labelZh: "指数检讨日历",
      },
    ],
    events: [{ ...(state === "typed-null" ? TYPED_NULL_EVENT : CONDITION_EVENT),
      positions: [{ id: positionId, ticker: "AAPL", shares: 10, status: "open" }] }],
  };
}

function startServer() { return startLegacyServer(ROOT, PORT); }

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
  await page.route("**/api/portfolio-brief", (route) =>
    route.fulfill({ status: 403, json: { tier: "free" } }));
  await page.route("**/data/manifest.json", (route) => route.fulfill({
    json: { symbols: { AAPL: { name: "Apple", zh: "苹果", last: 228 } } },
  }));
  await page.route("**/api/quote**", (route) => route.fulfill({
    json: { quotes: { AAPL: { last: 228, chg: 0 } } },
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

async function captureState(page, width, lang, state, outPath) {
  const seeded = await requireJson(await page.request.post(BASE + "/api/portfolio", {
    data: { action: "create", ticker: "AAPL", shares: "10", entryPrice: "100", entryCurrency: "USD" },
  }), "seed event holding");
  assert.equal(typeof seeded.position?.id, "string", "Native fixture position identity is required");
  await page.route("**/api/event-impact", (route) =>
    route.fulfill({ status: 200, json: impactBody(state, seeded.position.id) }));
  await page.goto(`${BASE}/portfolio`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await ensureLang(page, lang);
  const panel = page.getByTestId("event-impact");
  const line = page.getByTestId("event-impact-invalidation");
  const expected = lang === "zh"
    ? (state === "typed-null" ? "什么会让此判断失效：" : "报告日已经公布收盘价")
    : (state === "typed-null" ? "We haven't defined what would void this read yet." : "What would void this:");
  // The fetched, translated event content proves the client has hydrated before
  // the native disclosure is toggled; clicking SSR markup can be replayed.
  await line.filter({ hasText: expected }).waitFor({ state: "attached", timeout: 20_000 });
  const disclosure = page.locator("#portfolio-panel-overview details").filter({ has: panel });
  if (await disclosure.getAttribute("open") === null) await disclosure.locator("summary").click();
  await expect(disclosure).toHaveAttribute("open", "");
  await panel.waitFor({ state: "visible", timeout: 20_000 });
  await line.waitFor({ state: "visible", timeout: 20_000 });
  await page.getByTestId("event-impact-invalidation").filter({ hasText: expected }).waitFor({
    state: "visible",
    timeout: 10_000,
  });
  return capturePanel(page, panel, { name: outPath, pad: width === 390 ? 10 : 16, minimumHeight: 280 });
}

async function main() {
  const capturedAtHead = currentGitHead();
  const sourceHashes = Object.fromEntries(LAYOUT_FILES.map(rel => [rel, sha256File(rel)]));
  const stage = mkdtempSync(join(tmpdir(), "mmx-capture_b_f08_8_invalidation-"));
  console.log("unpromoted capture directory " + stage);
  const captures = [], failures = [];
  let child, browser, fixture, fixtureMod;
  try {
    child = startServer();
    await reportLegacyServer(child, "started");
    await waitLegacyServer(child, BASE + "/portfolio", 180_000);
    browser = await chromium.launch({ headless: true });
    captureLoop: for (const width of [1440, 390]) {
      for (const lang of ["en", "zh"]) {
        for (const state of STATES) {
          const file = cropName(state, width, lang);
          process.stdout.write("capture " + file + " ... ");
          const storeKey = "crop-invalidation-" + state + "-" + width + "-" + lang + "-" + Date.now();
          const { context, page } = await newPage(browser, width, lang, storeKey);
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
    "# B-F08-8 event-impact invalidation — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    "# All listed images were captured from the source bytes locked below.",
    "layoutFiles:",
    ...LAYOUT_FILES.map((rel) => `  ${rel}: "${sourceHashes[rel]}"`),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - { name: desktop, width: 1440, height: 900 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "surfaces: [EventImpactPanel]",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators to false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_b_f08_8_invalidation.cjs",
    "files:",
    ...files.map((name) => `  - ${name}`),
    "",
  ].join("\n");
  publishPacket(OUT, captures, expectedFiles, evidence);
  writeFileSync(join(stage, "geometry.json"), JSON.stringify(captures.map(({ file, geometry }) => ({ file, ...geometry })), null, 2) + "\n");
  console.log("wrote " + files.length + " qualified crops + EVIDENCE.yml (head " + capturedAtHead + ")");
}

module.exports = { captureState, cropName, LAYOUT_FILES, STATES, impactBody };
if (require.main === module) main().catch(error => {
  console.error(error);
  if (error instanceof AggregateError) for (const cause of error.errors) console.error(cause);
  process.exitCode = 1;
});
