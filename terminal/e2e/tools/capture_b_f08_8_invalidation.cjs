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

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f08-8-invalidation");
const LAYOUT_FILES = [
  "terminal/lib/eventImpact.ts",
  "terminal/components/EventImpactPanel.tsx",
  "terminal/components/EventImpactPanel.module.css",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3571);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  390: { width: 390, height: 844 },
};
const STATES = ["condition", "typed-null"];

mkdirSync(OUT, { recursive: true });

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
    condition_en: "The last close on the report date is at or above zero.",
    condition_zh: "报告日收盘价大于等于零。",
    metric_owner: "hub/lib/anchor.js",
    comparator: "at or above",
    threshold: 0,
    checked_against: "named date",
    named_date: "2026-10-30",
  },
  sourcePath: "/data/portfolio_ctx.json",
};

const TYPED_NULL_EVENT = {
  eventId: "macro_release|AAPL|2026-10-30",
  kind: "macro_release",
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

function impactBody(state) {
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
    events: [state === "typed-null" ? TYPED_NULL_EVENT : CONDITION_EVENT],
  };
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
  let lastH = 0;
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(150);
    const box = await fresh.boundingBox();
    const h = box ? Math.ceil(box.height) : 0;
    if (h >= 280 && Math.abs(h - lastH) < 4) break;
    lastH = h;
  }
  const box = await fresh.boundingBox();
  const vp = page.viewportSize();
  if (!box || !vp) throw new Error(`no box for ${outPath}`);
  if (box.height < 280) throw new Error(`${outPath}: panel height ${box.height} too short`);
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  const width = Math.max(8, Math.min(vp.width - x, Math.ceil(box.width + pad * 2)));
  const height = Math.max(8, Math.min(vp.height - y, Math.ceil(box.height + pad * 2)));
  await page.screenshot({ path: outPath, clip: { x, y, width, height } });
}

async function captureState(page, width, lang, state, outPath) {
  await page.route("**/api/event-impact", (route) =>
    route.fulfill({ status: 200, json: impactBody(state) }));
  await page.goto(`${BASE}/portfolio`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await ensureLang(page, lang);
  const panel = page.getByTestId("event-impact");
  await panel.waitFor({ state: "visible", timeout: 20_000 });
  const line = page.getByTestId("event-impact-invalidation");
  await line.waitFor({ state: "visible", timeout: 20_000 });
  const expected = lang === "zh"
    ? (state === "typed-null" ? "什么会让此判断失效：" : "报告日收盘价大于等于零")
    : (state === "typed-null" ? "We haven't defined what would void this read yet." : "What would void this:");
  await page.getByTestId("event-impact-invalidation").filter({ hasText: expected }).waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await panel.scrollIntoViewIfNeeded();
  await cropLocator(page, panel, outPath, width === 390 ? 10 : 16);
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
            const storeKey = `crop-f08-8-${state}-${width}-${lang}-${Date.now()}`;
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
    "# B-F08-8 event-impact invalidation — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    "# This packet restamps only the lock rows for files it touches (eventImpact.ts, EventImpactPanel.tsx, EventImpactPanel.module.css).",
    "layoutFiles:",
    ...LAYOUT_FILES.map((rel) => `  ${rel}: "${sha256File(rel)}"`),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - { name: desktop, width: 1440, height: 900 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "surfaces: [EventImpactPanel]",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_b_f08_8_invalidation.cjs",
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
