#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This capture tool is intentionally CommonJS. */
/**
 * Levels exact-price ticks under a crowded payload — dark evidence crops of the gamma column.
 *
 * The FLOW_FIXTURE levels:SPY payload is crowded exactly as e2e/responsive.spec.ts crowds it
 * (call wall → 775.50 and the 770 cluster → 775.25, beside the 775 keystone), so deconfliction
 * has to move labels off their exact prices. Each crop is the .levels-column. A moved label
 * keeps an exact-price tick on the axis, joined to it by a leader; an unmoved rung is centred
 * on its own price and needs no second mark. No mark may cross label text.
 *
 * The tool crops whatever components/levels/LevelsView.tsx is on disk into
 * docs/pr-crops/levels-rung-anchor/<CROP_LABEL>/ (default "after") and pins that file's sha256
 * in the folder's EVIDENCE.yml with the counts it measured on each crop (rungs, moved rungs,
 * exact-price marks, marks crossing label text). A "before" folder is the same command run
 * with an older LevelsView.tsx on disk; its EVIDENCE.yml names the file it was captured from.
 *
 * Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator; FLOW_FIXTURE serves the reads.
 *
 * From terminal/:
 *   node e2e/tools/capture_levels_rung_anchor.cjs
 *   CROP_LABEL=before node e2e/tools/capture_levels_rung_anchor.cjs
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const LABEL = process.env.CROP_LABEL || "after";
if (!/^[a-z0-9-]+$/.test(LABEL)) throw new Error(`CROP_LABEL must be kebab-case, got ${LABEL}`);
const OUT = join(ROOT, "docs", "pr-crops", "levels-rung-anchor", LABEL);
const LAYOUT_FILE = "terminal/components/levels/LevelsView.tsx";
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3573);
const BASE = `http://127.0.0.1:${PORT}`;
const URL_PATH = "/options?tab=levels";
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  820: { width: 820, height: 1180 },
  390: { width: 390, height: 844 },
};

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function cropName(width, lang) {
  return `levels-column-${width}${lang === "zh" ? "-zh" : ""}.png`;
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

async function answers() {
  try {
    const res = await fetch(`${BASE}${URL_PATH}`, { redirect: "manual" });
    return res.status >= 200 && res.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await answers()) return;
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`dev server on ${PORT} never answered`);
}

async function newPage(browser, width, lang) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[width],
    hasTouch: width !== 1440,
    locale: lang === "zh" ? "zh-CN" : "en-US",
    colorScheme: "dark",
  });
  await context.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
  }, lang);
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  // The crowding e2e/responsive.spec.ts applies: three prices within 50 cents of each other.
  await page.route("**/api/flow?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("f") !== "levels:SPY") return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    const nodes = (body.nodes ?? []).map((node) => {
      if (node.role === "call_wall") return { ...node, strike: 775.5 };
      if (node.role === "cluster" && node.strike === 770) return { ...node, strike: 775.25 };
      return node;
    });
    return route.fulfill({ response, json: { ...body, nodes } });
  });
  return { context, page };
}

async function assertNoNextIndicator(page, file) {
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
  });
  const n = await page.locator("[data-nextjs-dev-tools-button]").count();
  if (n > 0) throw new Error(`${file}: Next.js N overlay still mounted (${n}); TERMINAL_E2E_FIXTURE gate failed`);
}

/** What the crop shows, measured from the DOM it was taken from. */
async function measure(page) {
  return page.locator(".levels-column").evaluate((columnEl) => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const rungEls = [...columnEl.querySelectorAll('[data-testid="levels-rung"]')];
    const stage = rungEls[0]?.parentElement;
    if (!stage) throw new Error("Levels stage is unavailable");
    const labels = [...stage.querySelectorAll("span")]
      .filter((el) => el.textContent?.trim())
      .map(box);
    const anchors = [...columnEl.querySelectorAll('[data-testid="levels-rung-anchor"]')].map(box);
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return {
      rungs: rungEls.length,
      moved: rungEls.filter((el) =>
        Math.abs(Number(el.getAttribute("data-raw-y")) - Number(el.getAttribute("data-display-y"))) > 0.002).length,
      anchors: anchors.length,
      crossings: anchors.reduce((n, a) => n + labels.filter((label) => hit(a, label)).length, 0),
    };
  });
}

async function main() {
  if (await answers()) throw new Error(`something already answers on ${PORT}; set TERMINAL_CROP_PORT`);
  mkdirSync(OUT, { recursive: true });
  const capturedAtHead = currentGitHead();
  const layoutSha = sha256File(LAYOUT_FILE);
  const child = startServer();
  const crops = [];
  let failed = 0;
  try {
    await waitForServer(180_000);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const width of [1440, 820, 390]) {
        for (const lang of ["en", "zh"]) {
          const file = cropName(width, lang);
          process.stdout.write(`capture ${LABEL}/${file} … `);
          const { context, page } = await newPage(browser, width, lang);
          try {
            await page.goto(`${BASE}${URL_PATH}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
            const column = page.locator(".levels-column");
            await page.getByTestId("levels-rung").nth(7).waitFor({ state: "visible" });
            await page.locator(".levels-board")
              .getByText(lang === "zh" ? "这是仓位结构，不是预言" : "Positioning, not prophecy. These are locations")
              .waitFor({ state: "visible" });
            await column.scrollIntoViewIfNeeded();
            await assertNoNextIndicator(page, file);
            const counts = await measure(page);
            if (counts.moved === 0) throw new Error("the crowded payload moved no label");
            await column.screenshot({ path: join(OUT, file) });
            crops.push({ file, width, lang, ...counts });
            console.log(`ok ${JSON.stringify(counts)}`);
          } catch (err) {
            failed += 1;
            console.log(`FAIL ${err && err.message ? err.message : err}`);
          } finally {
            await context.close();
          }
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(child);
  }

  if (sha256File(LAYOUT_FILE) !== layoutSha) throw new Error(`${LAYOUT_FILE} changed during the capture`);
  if (failed) {
    process.exitCode = 1;
    console.log(`${failed} crops failed; EVIDENCE.yml not written`);
    return;
  }
  const evidence = [
    "# Levels exact-price ticks under a crowded payload — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is informational: the crops show the LevelsView.tsx pinned below, which",
    "# is whatever was on disk at capture time.",
    `label: ${LABEL}`,
    "layoutFiles:",
    `  ${LAYOUT_FILE}: "${layoutSha}"`,
    "theme: dark",
    `url: "${URL_PATH}"`,
    "payload: FLOW_FIXTURE levels:SPY, call wall moved to 775.50 and the 770 cluster to 775.25 (as e2e/responsive.spec.ts)",
    "counts: rungs drawn, rungs moved off their exact price, exact-price marks (levels-rung-anchor), marks crossing label text",
    "crops:",
    ...crops.map(({ file, width, lang, rungs, moved, anchors, crossings }) =>
      `  ${file}: { viewport: ${VIEWPORTS[width].width}x${VIEWPORTS[width].height}, lang: ${lang}, rungs: ${rungs}, moved: ${moved}, anchors: ${anchors}, crossings: ${crossings} }`),
    "command: |",
    "  cd terminal",
    `  CROP_LABEL=${LABEL} node e2e/tools/capture_levels_rung_anchor.cjs`,
    "",
  ].join("\n");
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence);
  console.log(`wrote ${crops.length} crops + EVIDENCE.yml (${LABEL}, LevelsView ${layoutSha.slice(0, 12)})`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
