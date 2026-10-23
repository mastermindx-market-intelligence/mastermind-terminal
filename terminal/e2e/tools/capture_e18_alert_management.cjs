#!/usr/bin/env node
/**
 * E18 — dark evidence crops for "Manage several alerts" on /alerts (issue #916).
 *
 * Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * Capture flag TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * Two states, each at desktop 1440x900, tablet 820x1180 and mobile 390x844, in EN and ZH:
 *   review   — five alerts ticked, the pause preview open (four will be paused, one is skipped).
 *   results  — the same batch confirmed against a scripted owner: one paused, one refused (gone),
 *              two not confirmed (one landed behind a 502, one did not), one skipped.
 *
 * The page talks to a stateful in-browser fake of /api/alerts, the same one the
 * e2e/alerts-bulk-manage.spec.ts tests use. Nothing here reaches a real store.
 *
 * From terminal/:
 *   TERMINAL_CROP_PORT=47283 node e2e/tools/capture_e18_alert_management.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/e18-alert-management/.
 */
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- a plain Node CommonJS tool, like the other capture scripts */

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "e18-alert-management");
const LAYOUT_FILES = [
  "terminal/components/alerts/AlertBulkManager.tsx",
  "terminal/components/alerts/alertBulk.module.css",
  "terminal/lib/alertBulk.ts",
  "terminal/lib/alertBulkLex.ts",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3549);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, touch: false },
  tablet: { width: 820, height: 1180, touch: true },
  mobile: { width: 390, height: 844, touch: true },
};
const STATES = ["review", "results"];
const LANGS = ["en", "zh"];

mkdirSync(OUT, { recursive: true });

const currentGitHead = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const sha256File = (rel) => createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
const cropName = (state, vp, lang) => `${state}-${vp}-${lang}.png`;

function startServer() {
  const env = {
    ...process.env,
    ANALYSIS_LOCAL_PREVIEW: "1",
    TERMINAL_E2E_FIXTURE: "1",
    TERMINAL_E2E_EMAIL: "responsive@example.com",
    TERMINAL_E2E_ENTITLEMENT: "unlimited",
    RATE_LIMIT_MAX: "100000",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
  };
  return spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(PORT)], {
    cwd: ROOT, env, stdio: ["ignore", "ignore", "pipe"], detached: true,
  });
}

function stopServer(child) {
  if (!child || !child.pid) return;
  try { process.kill(-child.pid, "SIGINT"); } catch { try { child.kill("SIGINT"); } catch { /* gone */ } }
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "not tried";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/alerts`, { redirect: "manual" });
      last = String(res.status);
      if (res.status >= 200 && res.status < 500) return;
    } catch (err) {
      last = (err.cause && err.cause.code) || err.message;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`dev server on ${PORT} never answered (${last})`);
}

const STORE = () => new Map([
  ["a1", { id: "a1", symbol: "NVDA", active: true, created_at: "2026-10-01T12:00:00Z", condition: { type: "signal", target: "BUY" } }],
  ["a2", { id: "a2", symbol: "AAPL", active: true, created_at: "2026-10-01T12:00:00Z", condition: { type: "signal", target: "SELL" } }],
  ["a3", { id: "a3", symbol: "TSLA", active: true, created_at: "2026-10-01T12:00:00Z", condition: { type: "rsi", value: 30 } }],
  ["a4", { id: "a4", symbol: "MSFT", active: true, created_at: "2026-10-01T12:00:00Z", condition: { type: "regime" } }],
  ["a5", { id: "a5", symbol: "AMD", active: false, created_at: "2026-10-01T12:00:00Z", condition: { type: "signal", target: "BUY" } }],
  ["a6", { id: "a6", symbol: "SPY", active: true, created_at: "2026-10-01T12:00:00Z", condition: { type: "signal", target: "BUY" } }],
]);
const SCRIPT = { a1: "ack", a2: "landed-then-502", a3: "500", a4: "gone-404" };

async function installOwner(page) {
  const store = STORE();
  await page.route("**/data/manifest.json**", (route) => route.fulfill({
    json: { symbols: { NVDA: { name: "NVIDIA", last: 182.5 }, SPY: { name: "SPDR S&P 500", last: 701.2 } } },
  }));
  await page.route("**/api/alerts/receipts**", (route) => route.fulfill({
    json: { run: null, runs_state: "READ_OK_ZERO", last_success_at: null, outbox: [], outbox_state: "READ_OK_ZERO" },
  }));
  await page.route("**/api/alerts**", async (route) => {
    const req = route.request();
    if (new URL(req.url()).pathname !== "/api/alerts") return route.fallback();
    if (req.method() === "GET") return route.fulfill({ json: { alerts: [...store.values()].map((r) => structuredClone(r)) } });
    if (req.method() !== "PATCH") return route.fulfill({ status: 405, json: { error: "unexpected" } });
    const body = req.postDataJSON();
    const apply = () => {
      const r = store.get(body.id);
      if (!r) return null;
      if (body.action === "pause") r.active = false;
      else { delete r.condition.triggered; r.active = true; }
      return structuredClone(r);
    };
    switch (SCRIPT[body.id] || "ack") {
      case "gone-404": store.delete(body.id); return route.fulfill({ status: 404, json: { error: "not found" } });
      case "500": return route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" });
      case "landed-then-502":
        apply();
        return route.fulfill({ status: 502, contentType: "text/html", body: "<html><body>Bad gateway</body></html>" });
      default: {
        const after = apply();
        return after ? route.fulfill({ json: { alert: after } }) : route.fulfill({ status: 404, json: { error: "not found" } });
      }
    }
  });
}

// Bring `sel` to the top of whichever box scrolls it (.pg on desktop/tablet, the document on a phone),
// clear of the scroll box's top edge or the pinned top bar, so the crop starts at the box's own heading.
async function bringToTop(page, sel) {
  const at = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`missing ${s}`);
    el.scrollIntoView({ block: "start" });
    let p = el.parentElement;
    while (p && !(p.scrollHeight > p.clientHeight && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
    // <html>/<body> scrolling is the document scrolling: its own rect moves with the scroll.
    if (p === document.body || p === document.documentElement) p = null;
    const box = p || document.scrollingElement;
    // The top edge the anchor must clear: the scroll box's own top, or a short pinned bar over it.
    // A fixed drawer or overlay taller than a third of the screen is not a top bar.
    let top = p ? Math.max(0, p.getBoundingClientRect().top) : 0;
    const bars = [];
    for (const bar of document.querySelectorAll("header, .topbar, [class*='topbar']")) {
      const r = bar.getBoundingClientRect();
      const pos = getComputedStyle(bar).position;
      if ((pos === "fixed" || pos === "sticky") && r.top <= 1 && r.height > 0 && r.height < innerHeight / 3 && r.bottom > top) {
        top = r.bottom;
        bars.push(`${bar.tagName.toLowerCase()}.${bar.className}`.slice(0, 60));
      }
    }
    box.scrollBy(0, el.getBoundingClientRect().top - top - 12);
    return { top, landed: el.getBoundingClientRect().top, box: p ? p.className.slice(0, 40) : "document", bars };
  }, sel);
  const vh = page.viewportSize().height;
  // A crop whose anchor is off-screen is a wrong crop: fail instead of writing it.
  if (!(at.landed >= at.top && at.landed <= at.top + vh / 3)) {
    throw new Error(`anchor ${sel} landed at ${Math.round(at.landed)}px (clear edge ${Math.round(at.top)}px, box ${at.box}, bars ${at.bars.join(",")})`);
  }
}

async function capture(browser, state, vp, lang) {
  const v = VIEWPORTS[vp];
  const context = await browser.newContext({
    viewport: { width: v.width, height: v.height },
    hasTouch: v.touch,
    locale: lang === "zh" ? "zh-CN" : "en-US",
    colorScheme: "dark",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  try {
    await installOwner(page);
    await page.addInitScript((l) => {
      localStorage.setItem("mm.lang", l);
      document.documentElement.setAttribute("data-lang", l);
      document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
    }, lang);
    await page.goto(`${BASE}/alerts`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    // The panel is server-rendered: a click that lands before hydration is lost, so retry until open.
    for (let i = 0; ; i++) {
      await page.locator("[data-bulk-open]").click();
      try {
        await page.locator('[data-bulk-manager="open"]').waitFor({ state: "visible", timeout: 1_500 });
        break;
      } catch (err) {
        if (i >= 20) throw err;
      }
    }
    await page.locator("[data-bulk-row]").nth(5).waitFor({ state: "visible" });
    for (const id of ["a1", "a2", "a3", "a4", "a5"]) {
      await page.locator(`[data-bulk-row="${id}"] input[type="checkbox"]`).check();
    }
    await page.locator('[data-bulk-review-open="pause"]').click();
    await page.locator('[data-bulk-review="pause"] [data-bulk-review-row]').nth(4).waitFor({ state: "visible" });
    let anchor = '[data-bulk-review="pause"]';
    if (state === "results") {
      await page.locator('[data-bulk-review="pause"] [data-bulk-confirm]').click();
      await page.locator('[data-bulk-results="pause"][data-bulk-done="1"]').waitFor({ state: "visible", timeout: 20_000 });
      await page.locator('[data-bulk-result-row="a2"] [data-bulk-observed], [data-bulk-result-row="a2"]').first().waitFor();
      await page.waitForTimeout(600);   // let the post-batch re-read settle the observed states
      anchor = '[data-bulk-results="pause"]';
    }
    await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((el) => el.remove()));
    if (await page.locator("[data-nextjs-dev-tools-button]").count()) throw new Error("Next.js N overlay mounted");
    await bringToTop(page, anchor);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);
    const file = cropName(state, vp, lang);
    await page.screenshot({ path: join(OUT, file), fullPage: false, animations: "disabled" });
    return file;
  } catch (err) {
    try {
      await page.screenshot({ path: join(OUT, `FAIL-${cropName(state, vp, lang)}`), fullPage: false });
      console.log(await page.locator("[data-bulk-manager]").innerText().catch(() => "(no panel)"));
    } catch { /* ignore */ }
    throw err;
  } finally {
    await context.close();
  }
}

async function main() {
  const capturedAtHead = currentGitHead();
  const child = startServer();
  const files = [];
  try {
    await waitForServer(180_000);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const state of STATES) {
        for (const vp of Object.keys(VIEWPORTS)) {
          for (const lang of LANGS) {
            process.stdout.write(`capture ${cropName(state, vp, lang)} … `);
            files.push(await capture(browser, state, vp, lang));
            console.log("ok");
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
    "# E18 alert management — capture evidence",
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
    ...Object.entries(VIEWPORTS).map(([name, v]) => `  - { name: ${name}, width: ${v.width}, height: ${v.height} }`),
    "surfaces: [AlertBulkManager]",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators to false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "states:",
    "  review: five alerts ticked, pause preview open (four to pause, AMD already paused and skipped)",
    "  results: the batch confirmed against a scripted owner (NVDA paused, MSFT refused, AAPL and TSLA not confirmed, AMD skipped)",
    "crops:",
    ...files.map((f) => `  ${f}: { url: "/alerts", state: ${f.split("-")[0]} }`),
    "command: |",
    "  TERMINAL_CROP_PORT=47283 node e2e/tools/capture_e18_alert_management.cjs",
    "",
  ];
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence.join("\n"));
  console.log(`wrote ${files.length} crops + EVIDENCE.yml capturedAtHead=${capturedAtHead}`);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
