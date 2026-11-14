#!/usr/bin/env node
/**
 * B-F08-B5-3 collisions — dark evidence crops for the alerts cockpit.
 *
 * Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * Capture flag TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_b_f08_b5_3_collisions.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f08-b5-3-collisions/.
 */
"use strict";

const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");
const { startLegacyServer, reportLegacyServer, waitLegacyServer, settleLegacyServer } = require("./capture_ci_evidence.cjs");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f08-b5-3-collisions");
const LAYOUT_FILES = [
  "terminal/components/alerts/AlertsCockpit.tsx",
  "terminal/components/alerts/WatchingList.tsx",
  "terminal/components/alerts/AnswerLine.tsx",
  "terminal/components/alerts/CouldNotWatch.tsx",
  "terminal/lib/alertsView.ts",
  "terminal/app/api/alerts/receipts/route.ts",
  "terminal/app/api/alerts/route.ts",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3548);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  390: { width: 390, height: 844 },
};
const STATES = ["watching", "suite-degraded", "suite-never-ran", "unresolved"];
const ONLY = (process.env.CAPTURE_ONLY || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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

function cropName(state, width, lang) {
  return `${state}-${width}${lang === "zh" ? "-zh" : ""}.png`;
}

const PRICE_ALERT = {
  id: "a0", symbol: "NVDA", active: true, created_at: "2026-08-01T00:00:00Z",
  condition: { type: "price", op: "above", value: 200 },
};
const SUITE_ALERT = {
  id: "s1", symbol: "AAPL", active: true, created_at: "2026-08-01T00:00:00Z",
  condition: { type: "suite_event", suite: "structure", event: "bos" },
};
const UNRESOLVED_ALERT = {
  id: "u1", symbol: "SPY", active: true, created_at: "2026-09-05T12:00:00Z",
  identity_state: "unresolved",
  condition: { type: "opt_gamma_flip", root: "TOOLONGROOTNAME" },
};

function isoNow() {
  return new Date().toISOString();
}

function fixturesFor(state) {
  const now = isoNow();
  const engineFresh = {
    lane: "alerts_engine", run_id: "r1", started_at: now, concluded_at: now,
    outcome: "success", lane_cadence_budget_s: 300, unevaluable_n: 0,
  };
  const suitePartial = {
    lane: "suite_alerts", run_id: "r2", started_at: now, concluded_at: now,
    outcome: "partial", lane_cadence_budget_s: 300, unevaluable_n: 1,
  };
  if (state === "watching") {
    return {
      alerts: [PRICE_ALERT],
      receipts: {
        run: engineFresh, runs_state: "READ_OK", last_success_at: now, last_success_state: "READ_OK",
        suite_run: null, suite_runs_state: "READ_OK_ZERO",
        suite_last_success_at: null, suite_last_success_state: "READ_OK_ZERO",
        outbox: [], outbox_state: "READ_OK_ZERO",
      },
      wait: '[data-monitor-state="watching"]',
    };
  }
  if (state === "suite-degraded") {
    return {
      alerts: [SUITE_ALERT],
      receipts: {
        run: engineFresh, runs_state: "READ_OK", last_success_at: now, last_success_state: "READ_OK",
        suite_run: suitePartial, suite_runs_state: "READ_OK",
        suite_last_success_at: "2026-09-05T10:00:00Z", suite_last_success_state: "READ_OK",
        outbox: [], outbox_state: "READ_OK_ZERO",
      },
      wait: '[data-alerts-module="degraded"]',
    };
  }
  if (state === "suite-never-ran") {
    return {
      alerts: [SUITE_ALERT],
      receipts: {
        run: engineFresh, runs_state: "READ_OK", last_success_at: now, last_success_state: "READ_OK",
        suite_run: null, suite_runs_state: "READ_OK_ZERO",
        suite_last_success_at: null, suite_last_success_state: "READ_OK_ZERO",
        outbox: [], outbox_state: "READ_OK_ZERO",
      },
      wait: '[data-monitor-state="never_ran"]',
    };
  }
  return {
    alerts: [UNRESOLVED_ALERT],
    receipts: {
      run: engineFresh, runs_state: "READ_OK", last_success_at: now, last_success_state: "READ_OK",
      suite_run: null, suite_runs_state: "READ_OK_ZERO",
      suite_last_success_at: null, suite_last_success_state: "READ_OK_ZERO",
      outbox: [], outbox_state: "READ_OK_ZERO",
    },
    wait: '[data-identity-state="unresolved"]',
  };
}

async function assertNoNextIndicator(page, file) {
  await page.waitForTimeout(400);
  const n = await page.locator("[data-nextjs-dev-tools-button]").count();
  if (n > 0) {
    throw new Error(`${file}: Next.js N overlay still mounted (${n}); TERMINAL_E2E_FIXTURE gate failed`);
  }
}

async function installFixtures(page, state) {
  const fx = fixturesFor(state);
  await page.route("**/data/manifest.json**", (route) => route.fulfill({
    json: { symbols: { NVDA: { name: "NVIDIA", last: 182.5 }, AAPL: { name: "Apple", last: 228 }, SPY: { name: "SPDR S&P 500", last: 520 } } },
  }));
  await page.route("**/api/alerts/receipts**", (route) => route.fulfill({ json: fx.receipts }));
  await page.route("**/api/alerts**", async (route) => {
    if (route.request().url().includes("/api/alerts/receipts")) {
      return route.fulfill({ json: fx.receipts });
    }
    return route.fulfill({ json: { alerts: fx.alerts } });
  });
  return fx;
}

async function openState(page, lang, width, state) {
  await page.setViewportSize(VIEWPORTS[width]);
  const fx = await installFixtures(page, state);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await page.goto(`${BASE}/alerts`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator(fx.wait).first().waitFor({ state: "visible", timeout: 45_000 });
}

async function shoot(page, file) {
  await assertNoNextIndicator(page, file);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(120);
  await page.screenshot({ path: join(OUT, file), fullPage: false });
}

async function main() {
  const capturedAtHead = currentGitHead();
  const child = startLegacyServer(ROOT, PORT);
  const files = [];
  try {
    await reportLegacyServer(child, "started");
    await waitLegacyServer(child, `${BASE}/alerts`, 180_000);
    const browser = await chromium.launch({ headless: true });
    try {
      const widths = [1440, 390];
      const langs = ["en", "zh"];
      for (const state of STATES) {
        for (const width of widths) {
          for (const lang of langs) {
            const file = cropName(state, width, lang);
            if (ONLY.length && !ONLY.includes(file) && !ONLY.includes(state)) continue;
            process.stdout.write(`capture ${file} … `);
            const context = await browser.newContext({
              viewport: VIEWPORTS[width],
              hasTouch: width === 390,
              locale: lang === "zh" ? "zh-CN" : "en-US",
              colorScheme: "dark",
            });
            const page = await context.newPage();
            page.setDefaultTimeout(45_000);
            try {
              await openState(page, lang, width, state);
              await shoot(page, file);
              files.push(file);
              console.log("ok");
            } catch (err) {
              console.log(`FAIL ${err && err.message ? err.message : err}`);
              try {
                await page.screenshot({ path: join(OUT, `FAIL-${file}`), fullPage: false });
              } catch { /* ignore */ }
              throw err;
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
    await settleLegacyServer(child);
  }

  files.sort();
  const evidence = [
    "# B-F08-B5-3 collisions — capture evidence",
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
    "surfaces: [AlertsCockpit]",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators to false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "states: [watching, suite-degraded, suite-never-ran, unresolved]",
    "command: |",
    "  node e2e/tools/capture_b_f08_b5_3_collisions.cjs",
    "files:",
    ...files.map((f) => `  - ${f}`),
    "",
  ];
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence.join("\n"));
  console.log(`wrote ${files.length} crops + EVIDENCE.yml capturedAtHead=${capturedAtHead}`);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
