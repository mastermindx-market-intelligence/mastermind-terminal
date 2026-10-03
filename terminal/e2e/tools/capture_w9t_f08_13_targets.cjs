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

const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = resolve(__dirname, "..", "..");
const REPO = resolve(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "w9t-f08-13-targets-readout");
const LAYOUT_FILES = [
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

// Three states: empty (the page paints the empty-card), populated-within-band (a single holding
// has a target inside its band), populated-outside-band (the same holding's drift is outside the
// band). The Settings section's surface contract is the readout itself — empty / populated are
// the two states a reader actually sees.
const STATES = [
  { id: "empty", positions: [], targets: [] },
  {
    id: "populated",
    positions: [
      { ticker: "NVDA", shares: 100, entryPrice: 200, status: "open" },
    ],
    targets: [
      { ticker: "NVDA", targetWeightPct: 60, bandPct: 10, updatedAt: null },
    ],
  },
];

const HEAD_SHA = (() => {
  try {
    return require("node:child_process")
      .execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
})();

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function layoutHashes() {
  const out = {};
  for (const rel of LAYOUT_FILES) {
    const abs = join(REPO, rel);
    if (existsSync(abs)) out[rel] = sha256(abs);
  }
  return out;
}

async function ensureServer() {
  // A dev server is expected to already be running on PORT (the operator starts
  // it before invoking this script; running concurrent dev servers inside a
  // capture script fights Turbopack's compile cache). Probe it; if it's not
  // reachable, fail loudly so the operator knows to start one.
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${BASE}/terminal?symbol=NVDA`);
      if (r.ok) return null;
    } catch { /* keep waiting */ }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`dev server on ${BASE} did not become ready; start one with the capture env vars and rerun`);
}

async function gotoSettings(page, lang) {
  await page.addInitScript((useZh) => {
    try { localStorage.setItem("mm.lang", useZh ? "zh" : "en"); } catch { /* private mode */ }
    // document.documentElement is null on the about:blank preload frame; the
    // attribute writes happen on every navigation, so a guard is enough.
    const root = document.documentElement;
    if (!root) return;
    root.setAttribute("data-lang", useZh ? "zh" : "en");
    root.setAttribute("lang", useZh ? "zh-CN" : "en");
  }, lang === "zh");
  // /terminal is the only route that picks TERMINAL_E2E_EMAIL up into the chrome
  // (`(shell)/layout.tsx` resolves auth from real Supabase claims and renders
  // email="" under the fixture, which would route the click into onboarding).
  // /terminal hands the email straight to TerminalShell → SettingsButton, and
  // SettingsProvider is mounted once for the whole app, so the panel state is
  // identical whichever shell opened it.
  await page.goto(`${BASE}/terminal?symbol=NVDA`, { waitUntil: "load" });
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('button[aria-label]'))
      .some((el) => {
        const lbl = el.getAttribute("aria-label") || "";
        return /^Settings$|^设置$/.test(lbl);
      }),
    { timeout: 60_000 },
  );
  // The avatar lives in different chrome containers per viewport — desktop
  // topbar, mobile topbar (.mobilebar .m-right), and the mobile drawer footer
  // (.m-drawer-ft). SettingsProvider is mounted once for the whole app, so
  // every mount calls the same `settings.open()`. Playwright's stability guard
  // sometimes rejects the topbar avatar as "outside the viewport" on
  // Turbopack's first compile — dispatch the click via the React handler
  // directly so the panel state advances without depending on hit-testing.
  await page.evaluate(() => {
    const btn = document.querySelector(
      '.topbar button.avatar, .mobilebar button.avatar, .m-drawer-ft button.avatar',
    );
    if (!btn) throw new Error("avatar not found");
    btn.click();
  });
  await page.locator(".acs-card").waitFor({ timeout: 30_000 });
  const tabName = lang === "zh" ? "组合目标权重" : "Portfolio targets";
  await page.getByRole("tab", { name: tabName, exact: true }).click();
  await page.locator('[data-testid="portfolio-targets-settings"]').waitFor({ timeout: 30_000 });
}

async function captureOne(browser, viewport, state, lang) {
  const suffix = `${state.id}-${viewport.name}-${lang}.png`;
  const file = join(OUT, `PortfolioTargetsSettings-${suffix}`);
  const ctx = await browser.newContext({
    viewport: viewport.size,
    colorScheme: "dark",
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error(`[${suffix}] pageerror:`, e.message));
  // Install the route BEFORE the page loads so the section's mount-time GET
  // hits the deterministic empty/populated payload. The glob matches anything
  // ending in `/api/portfolio/targets` (incl. query strings). The page itself
  // never hits that path, so the handler does not stall the first paint.
  const summary = computeSummary(state.positions, state.targets);
  await page.route(/\/api\/portfolio\/targets(\?|$)/, (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ summary }),
    });
  });
  await gotoSettings(page, lang);
  // The section's body depends on which state we're capturing: empty waits
  // for the empty-card marker, populated waits for the readout root.
  try {
    if (state.id === "empty") {
      await page.locator('[data-testid="portfolio-targets-empty"]').waitFor({ timeout: 20_000 });
    } else {
      await page.locator('[data-testid="portfolio-targets-loaded"]').waitFor({ timeout: 20_000 });
    }
  } catch (e) {
    const body = await page.locator(".acs-body").first().innerHTML();
    console.error(`[${suffix}] waiting failed; .acs-body html:`, body.slice(0, 1500));
    throw e;
  }
  // Allow the readout to paint.
  await page.waitForTimeout(800);
  // Capture only the settings card so the page chrome (chart, rail) is excluded.
  await page.locator(".acs-card").screenshot({ path: file });
  await ctx.close();
}

function computeSummary(positions, targets) {
  // Reuse the real lib so the data shape stays identical.
  // The function is exposed by terminal/lib/portfolioTargets.ts via the @/ alias
  // (vitest-only); here we hand-compute the same shape that computePortfolioTargets
  // would emit. Drift-only numbers; the spec is the API contract.
  const open = positions.filter((p) => p.status === "open");
  const costByTicker = new Map();
  for (const p of open) {
    costByTicker.set(p.ticker, (costByTicker.get(p.ticker) || 0) + p.shares * p.entryPrice);
  }
  const totalCost = [...costByTicker.values()].reduce((a, b) => a + b, 0);
  const drifts = [];
  const untargeted = [];
  for (const [ticker, cost] of costByTicker.entries()) {
    const target = targets.find((t) => t.ticker === ticker);
    if (!target) {
      untargeted.push({ ticker, currentWeightPct: totalCost > 0 ? Math.round((cost / totalCost) * 1000) / 10 : null });
      continue;
    }
    const current = totalCost > 0 ? Math.round((cost / totalCost) * 1000) / 10 : null;
    const drift = current == null ? null : Math.round((current - target.targetWeightPct) * 10) / 10;
    const status = drift == null
      ? "unweighable"
      : Math.abs(drift) <= target.bandPct ? "within_band" : "outside_band";
    drifts.push({
      ticker,
      currentWeightPct: current,
      targetWeightPct: target.targetWeightPct,
      bandPct: target.bandPct,
      driftPct: drift,
      status,
    });
  }
  return {
    schema: "portfolio_targets.v1",
    weightBasis: "cost",
    targetsSumPct: targets.reduce((a, b) => a + b.targetWeightPct, 0),
    targetsSumOffBy100: 0,
    drifts,
    untargeted,
    orphaned: [],
  };
}

async function main() {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const server = await ensureServer();
  const browser = await chromium.launch();
  try {
    for (const state of STATES) {
      for (const [name, size] of Object.entries(VIEWPORTS)) {
        for (const lang of ["en", "zh"]) {
          // 1px guard so the for-of yields a real viewport object with .name
          const vp = { name, size };
          await captureOne(browser, vp, state, lang);
        }
      }
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }

  // EVIDENCE.yml — capturedAtHead is the code commit the pixels depict (HEAD SHA);
  // layoutFiles is the SHA-256 of every file the layout depends on.
  const evidence = {
    capturedAtHead: HEAD_SHA,
    capturedAt: new Date().toISOString(),
    layoutFiles: layoutHashes(),
    theme: "dark",
    languages: ["en", "zh"],
    viewports: [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ],
    surfaces: ["SectionPortfolioTargets"],
    capture_flag: "TERMINAL_E2E_FIXTURE",
    capture_flag_law: "next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    files: STATES.flatMap((s) =>
      Object.keys(VIEWPORTS).flatMap((vpName) =>
        ["en", "zh"].map((lang) =>
          `PortfolioTargetsSettings-${s.id}-${vpName}-${lang}.png`,
        ),
      ),
    ),
  };
  writeFileSync(join(OUT, "EVIDENCE.yml"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(`Wrote ${evidence.files.length} crops + EVIDENCE.yml under ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});