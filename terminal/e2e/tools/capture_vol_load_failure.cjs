#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This capture tool is intentionally CommonJS. */
/**
 * Volatility tab failure-state truth — dark evidence crops.
 *
 * A read that did not land is not an absence: a 5xx / refused /api/flow read renders the load
 * error with an in-place Retry, and only a 404 renders the coverage gap. The same holds one read
 * lower, for the aggregate-trend store behind the spread panel. Each state is produced by the
 * real failure injected at /api/flow (page.route), never by a component prop.
 *
 * Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator; FLOW_FIXTURE serves the healthy reads.
 *
 * From terminal/:
 *   node e2e/tools/capture_vol_load_failure.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/vol-load-failure/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "vol-load-failure");
const LAYOUT_FILES = [
  "terminal/components/vol/VolView.tsx",
  "terminal/components/vol/VolVrpPanel.tsx",
  "terminal/components/vol/volShared.tsx",
  "terminal/components/vol/volStrings.ts",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3563);
const BASE = `http://127.0.0.1:${PORT}`;
const URL_PATH = "/options?tab=volatility";
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  390: { width: 390, height: 844 },
};

/** Injected /api/flow answer per f-param; anything unlisted reaches the fixture server. */
const STATES = {
  "snapshot-unavailable": { replies: { "vol:SPY": "503" }, surface: "snapshot" },
  "snapshot-absent": { replies: { "vol:SPY": "404" }, surface: "snapshot" },
  "spread-unavailable": { replies: { "agg:SPY": "503" }, surface: "spread" },
  "spread-loading": { replies: { "agg:SPY": "pending" }, surface: "spread" },
  "spread-absent": { replies: { "agg:SPY": "404" }, surface: "spread" },
};

const COPY = {
  en: {
    errorLoad: "Could not load volatility data",
    emptyTitle: "No volatility snapshot for this name yet",
    retry: "Retry",
    statsTitle: "Volatility snapshot",
    spreadTitle: "IV − realized-vol spread · history",
    spreadError: "Could not load the spread history",
    spreadAbsent: "No IV − realized-vol spread history for this name",
    spreadLoading: "Loading spread history",
  },
  zh: {
    errorLoad: "无法加载波动率数据",
    emptyTitle: "该品种暂无波动率快照",
    retry: "重试",
    statsTitle: "波动率概览",
    spreadTitle: "IV − 已实现波动率差值 · 历史",
    spreadError: "无法加载差值历史",
    spreadAbsent: "该品种暂无IV − 已实现波动率差值历史",
    spreadLoading: "加载差值历史中",
  },
};

mkdirSync(OUT, { recursive: true });

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function cropName(state, width, lang) {
  return `${state}-${width}${lang === "zh" ? "-zh" : ""}.png`;
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

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "not tried";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}${URL_PATH}`, { redirect: "manual" });
      last = String(res.status);
      if (res.status >= 200 && res.status < 500) return;
    } catch (err) {
      last = err.cause?.code || err.message;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`dev server on ${PORT} never answered (${last})`);
}

async function newPage(browser, width, lang, replies) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[width],
    hasTouch: width === 390,
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
  const held = [];
  await page.route(
    (url) => url.pathname === "/api/flow" && replies[url.searchParams.get("f") ?? ""] != null,
    async (route) => {
      switch (replies[new URL(route.request().url()).searchParams.get("f") ?? ""]) {
        case "503": return route.fulfill({ status: 503, json: { error: "feed unavailable" } });
        case "404": return route.fulfill({ status: 404, json: { error: "not published" } });
        // Never answered while the crop is taken; released when the context closes.
        case "pending": held.push(route); return undefined;
        default: return route.fallback();
      }
    },
  );
  return { context, page, held };
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

/** Crop the union of the given boxes, clamped to the viewport. */
async function cropBoxes(page, boxes, outPath, pad) {
  const vp = page.viewportSize();
  if (!vp || boxes.some((b) => !b)) throw new Error(`no box for ${outPath}`);
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  const x = Math.max(0, Math.floor(left - pad));
  const y = Math.max(0, Math.floor(top - pad));
  const width = Math.max(8, Math.min(vp.width - x, Math.ceil(right - left + pad * 2)));
  const height = Math.max(8, Math.min(vp.height - y, Math.ceil(bottom - top + pad * 2)));
  await page.screenshot({ path: outPath, clip: { x, y, width, height } });
}

async function captureState(page, width, lang, state, outPath) {
  const copy = COPY[lang];
  const { surface } = STATES[state];
  await page.goto(`${BASE}${URL_PATH}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const pad = width === 390 ? 10 : 16;

  if (surface === "snapshot") {
    // The tab's whole shell: controls bar (with its status badge) above the centered body state.
    const view = page.locator('input[list="vol-roots"]').locator("xpath=../../..");
    if (state === "snapshot-unavailable") {
      await view.getByText(copy.errorLoad).nth(1).waitFor({ state: "visible" });
      await view.getByRole("button", { name: copy.retry, exact: true }).waitFor({ state: "visible" });
    } else {
      await view.getByText(copy.emptyTitle).waitFor({ state: "visible" });
      if (await view.getByRole("button", { name: copy.retry, exact: true }).count()) {
        throw new Error(`${state}: a published absence must offer nothing to retry`);
      }
    }
    await page.waitForTimeout(250);
    // No margin: the tab's shell is edge-to-edge, so any pad pulls in slivers of the page chrome.
    await cropBoxes(page, [await view.boundingBox()], outPath, 0);
    return;
  }

  const spread = page.locator(".fin-card").filter({ hasText: copy.spreadTitle }).first();
  const expected = { "spread-unavailable": copy.spreadError, "spread-loading": copy.spreadLoading, "spread-absent": copy.spreadAbsent }[state];
  await spread.getByText(expected).waitFor({ state: "visible" });
  if (state === "spread-unavailable") {
    await spread.getByRole("button", { name: copy.retry, exact: true }).waitFor({ state: "visible" });
  }
  // The snapshot read landed: its card stays up while the spread store failed or is still read.
  const stats = page.locator("section.fin-card").filter({ hasText: copy.statsTitle }).first();
  await stats.waitFor({ state: "visible" });
  await stats.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const vp = page.viewportSize();
  const both = [await stats.boundingBox(), await spread.boundingBox()];
  const fits = both.every(Boolean) && Math.max(...both.map((b) => b.y + b.height)) <= vp.height;
  if (fits) {
    await cropBoxes(page, both, outPath, pad);
    return;
  }
  // Phone width stacks the cards past one screen: crop the spread card alone.
  await spread.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await cropBoxes(page, [await spread.boundingBox()], outPath, pad);
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
          for (const state of Object.keys(STATES)) {
            const file = cropName(state, width, lang);
            process.stdout.write(`capture ${file} … `);
            const { context, page, held } = await newPage(browser, width, lang, STATES[state].replies);
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
              await Promise.all(held.map((route) => route.abort().catch(() => undefined)));
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

  if (failed) process.exitCode = 1;
  files.sort();
  const evidence = [
    "# Volatility tab failure-state truth — capture evidence",
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
    "harness:",
    ...files.map((name) => {
      const state = Object.keys(STATES).find((s) => name.startsWith(`${s}-`));
      const replies = Object.entries(STATES[state].replies).map(([f, r]) => `"${f}": ${r}`).join(", ");
      return `  ${name}: { url: "${URL_PATH}", state: ${state}, injected: { ${replies} } }`;
    }),
    "surfaces: [VolView, VolVrpPanel]",
    "injection: page.route on /api/flow answers 503 / 404 / never; every other read is the FLOW_FIXTURE server",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_vol_load_failure.cjs",
    "files:",
    ...files.map((name) => `  - ${name}`),
    "",
  ].join("\n");
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence);
  console.log(`wrote ${files.length} crops + EVIDENCE.yml (head ${capturedAtHead})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
