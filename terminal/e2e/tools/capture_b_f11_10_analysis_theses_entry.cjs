#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This capture tool is intentionally CommonJS. */
/**
 * B-F11-10a Analysis context-bar theses entry — dark evidence crops.
 *
 * Playwright against the /analysis?symbol=NVDA company view, capturing the new
 * theses control in the Analysis context bar. Dark only
 * (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06). Capture flag
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f11-10-analysis-theses-entry/.
 */
"use strict";

const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { startLegacyServer, waitLegacyServer, reportLegacyServer, settleLegacyServer,
  captureRefusal, emitLegacyReceipt } = require("./capture_ci_evidence.cjs");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f11-10-analysis-theses-entry");
const LAYOUT_FILES = [
  "terminal/components/workspaces/AnalysisWorkspace.tsx",
  "terminal/components/fin/ResearchWorkspaceNav.tsx",
  "terminal/components/fin/MegaPane.tsx",
  "terminal/app/analysis-nav-vnext.css",
  "terminal/app/fin.css",
  "terminal/app/company-intelligence.css",
  "terminal/lib/i18n.tsx",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3565);
const BASE = `http://127.0.0.1:${PORT}`;
const SYM = "NVDA";
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
};
const SHOTS = [
  { viewport: "desktop", lang: "en", file: "desktop-en.png" },
  { viewport: "desktop", lang: "zh", file: "desktop-zh.png" },
  { viewport: "tablet", lang: "en", file: "tablet-en.png" },
  { viewport: "tablet", lang: "zh", file: "tablet-zh.png" },
  { viewport: "mobile", lang: "en", file: "mobile-en.png" },
  { viewport: "mobile", lang: "zh", file: "mobile-zh.png" },
];


function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function layoutFilesBlock() {
  return LAYOUT_FILES.map((rel) => `  ${rel}: "${sha256File(rel)}"`);
}

async function assertNoNextIndicator(page, file) {
  await page.waitForTimeout(400);
  const n = await page.locator("[data-nextjs-dev-tools-button]").count();
  if (n > 0) {
    throw new Error(`${file}: Next.js N overlay still mounted (${n}); TERMINAL_E2E_FIXTURE gate failed`);
  }
}

async function openAnalysis(page, lang, viewport) {
  await page.setViewportSize(viewport);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    const applyAttributes = () => {
      document.documentElement.setAttribute("data-theme", "dark");
      document.documentElement.setAttribute("data-lang", l);
      document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
    };
    if (document.documentElement) applyAttributes();
    else document.addEventListener("DOMContentLoaded", applyAttributes, { once: true });
  }, lang);
  await page.goto(`${BASE}/analysis?symbol=${SYM}&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  // Wait for the context bar and the theses control to be visible.
  await page.getByLabel(lang === "zh" ? "你的研究论点：NVDA" : "Your theses on NVDA")
    .waitFor({ state: "visible", timeout: 45_000 });
}

async function shoot(page, file) {
  await assertNoNextIndicator(page, file);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(OUT, file) });
}

async function main() {
  if (process.env.TERMINAL_LEGACY_CAPTURE_ID && process.env.CAPTURE_ONLY) throw new Error("CI_EVIDENCE_CAPTURE_FILTER");
  const { chromium } = require("@playwright/test");
  mkdirSync(OUT, { recursive: true });
  const capturedSources = layoutFilesBlock();
  const capturedAtHead = currentGitHead();
  const child = startLegacyServer(ROOT, PORT);
  const files = [];
  try {
    await reportLegacyServer(child, "started");
    await waitLegacyServer(child, `${BASE}/analysis?symbol=${SYM}`, 180_000);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const shot of SHOTS) {
        process.stdout.write(`capture ${shot.file} … `);
        const context = await browser.newContext({
          viewport: VIEWPORTS[shot.viewport],
          hasTouch: shot.viewport !== "desktop", // tablet + mobile: pointer:coarse, so the 44px floor is what the crops show
          locale: shot.lang === "zh" ? "zh-CN" : "en-US",
          colorScheme: "dark",
        });
        const page = await context.newPage();
        page.setDefaultTimeout(45_000);
        try {
          await openAnalysis(page, shot.lang, VIEWPORTS[shot.viewport]);
          await shoot(page, shot.file);
          files.push(shot.file);
          console.log("ok");
        } catch (err) {
          if (captureRefusal(err)) throw err;
          console.log(`FAIL ${err && err.message ? err.message : err}`);
          try {
            await page.screenshot({ path: join(OUT, `FAIL-${shot.file}`), fullPage: false });
          } catch (captureError) { if (captureRefusal(captureError)) throw captureError; }
          throw err;
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    await settleLegacyServer(child);
  }

  if (files.length !== SHOTS.length || new Set(files).size !== SHOTS.length
      || JSON.stringify(layoutFilesBlock()) !== JSON.stringify(capturedSources)
      || currentGitHead() !== capturedAtHead) throw new Error("ANALYSIS_CAPTURE_SOURCE_OR_MATRIX_CHANGED");
  const evidence = [
    "# B-F11-10a Analysis context-bar theses entry — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    "layoutFiles:",
    ...capturedSources,
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - { name: desktop, width: 1440, height: 900 }",
    "  - { name: tablet, width: 820, height: 1180 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "harness:",
    ...SHOTS.map((s) => `  ${s.file}: { url: "/analysis?symbol=${SYM}&lang=${s.lang}", state: context-bar-with-theses-control }`),
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators to false when TERMINAL_E2E_FIXTURE is set; playwright.config.ts already sets that flag on the e2e dev server. This script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_b_f11_10_analysis_theses_entry.cjs",
    "files:",
    ...SHOTS.map((s) => `  - ${s.file}`),
  ];
  writeFileSync(join(OUT, "EVIDENCE.yml"), `${evidence.join("\n")}\n`);
  emitLegacyReceipt({ packet: "analysis", outputDir: OUT, files, capturedAtHead });
  console.log(`wrote ${files.length} crops + EVIDENCE.yml at ${capturedAtHead}`);
}

if (require.main === module) main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

module.exports = { assertNoNextIndicator, LAYOUT_FILES, FILES: SHOTS.map(shot => shot.file) };
