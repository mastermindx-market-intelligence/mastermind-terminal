#!/usr/bin/env node
/**
 * B-F11-9 thesis window-closed — dark evidence crops for the Alerts page.
 *
 * Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * Store key carries FIXTURE_MONITOR_FIRED_TOKEN ("monitorfired") so the first
 * thesis created through /api/theses seeds a real fixture alert_outbox row
 * (terminal/lib/watchlistsFixtureDb.ts). GET /api/thesis-fire-status runs
 * against that row. GET /api/alerts and GET /api/alerts/receipts do not read
 * the fixture transport (those routes use the Supabase client), so the
 * cockpit is fed the same fixture-shaped outbox row through the same
 * page.route seam the B-F08-B5-3 collisions capture already uses.
 *
 * From terminal/:
 *   node e2e/tools/capture_b_f11_9_thesis_window_closed.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f11-9-thesis-window-closed/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { basename, join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f11-9-thesis-window-closed");
const LAYOUT_FILES = [
  "terminal/lib/alertsView.ts",
  "terminal/components/alerts/AlertsCockpit.tsx",
  "terminal/components/alerts/AlertTimeline.tsx",
  "terminal/components/alerts/AlertDetail.tsx",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3561);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  390: { width: 390, height: 844 },
};
const COPY = {
  en: "The window you were watching has closed",
  zh: "你关注的观察窗口已结束",
};

mkdirSync(OUT, { recursive: true });

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function layoutFilesBlock() {
  return LAYOUT_FILES.map((rel) => `  ${rel}: "${sha256File(rel)}"`);
}

function cropName(surface, width, lang) {
  return `${surface}-${width}${lang === "zh" ? "-zh" : ""}.png`;
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
    HUB_REALTIME_QUOTES: "1",
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
      const res = await fetch(`${BASE}/alerts`, { redirect: "manual" });
      last = String(res.status);
      if (res.status >= 200 && res.status < 500) return;
    } catch (err) {
      last = err.cause?.code || err.message;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`dev server on ${PORT} never answered (${last})`);
}

function subject(symbol) {
  return {
    schema: "mastermind.thesis-subject-ref/v1",
    kind: "issuer",
    owner: "terminal.analysis_symbol",
    key: symbol,
    identityState: "listing_scoped",
    listing: { symbol, mic: null, securityId: null },
    companyId: null,
    display: `${symbol} · listing scoped`,
  };
}

function content(title) {
  return {
    schema: "mastermind.thesis-content/v1",
    title,
    statement: `${title} statement`,
    catalysts: ["Data-center revenue compounds"],
    falsifiers: ["Gross margin falls below 65%"],
    risks: ["Customer concentration"],
    horizon: "quarters",
    effectiveAt: null,
    revisionNote: null,
  };
}

async function createThesis(context, title, symbol) {
  const response = await context.request.post(`${BASE}/api/theses`, {
    data: {
      action: "create",
      clientRequestId: randomUUID(),
      subject: subject(symbol),
      content: content(title),
    },
  });
  if (response.status() !== 201) {
    throw new Error(`create thesis failed: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()).thesisId;
}

async function assertWindowClosed(context, thesisId) {
  const response = await context.request.get(`${BASE}/api/thesis-fire-status?id=${thesisId}`);
  if (response.status() !== 200) {
    throw new Error(`thesis-fire-status ${response.status()} ${await response.text()}`);
  }
  const body = await response.json();
  const state = body.states && body.states[thesisId];
  if (!state || state.state !== "window_closed") {
    throw new Error(`fixture outbox did not map to window_closed: ${JSON.stringify(body)}`);
  }
}

async function stripDevOverlay(page) {
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
  });
}

async function assertNoNextIndicator(page, file) {
  await page.waitForTimeout(250);
  const n = await page.locator("[data-nextjs-dev-tools-button]").count();
  if (n > 0) throw new Error(`${file}: Next.js N overlay still mounted (${n})`);
}

async function cropSel(page, selector, outPath) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: "visible", timeout: 20_000 });
  const box = await loc.boundingBox();
  if (!box) throw new Error(`no box for ${selector} (${outPath})`);
  const vp = page.viewportSize();
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const width = Math.max(8, Math.min(vp.width - x, Math.ceil(box.width)));
  const height = Math.max(8, Math.min(vp.height - y, Math.ceil(box.height)));
  await page.screenshot({ path: outPath, clip: { x, y, width, height } });
}

async function shootSel(page, selector, outPath) {
  await assertNoNextIndicator(page, basename(outPath));
  await stripDevOverlay(page);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  await cropSel(page, selector, outPath);
}

function assertCopy(text, lang, file) {
  const expected = COPY[lang];
  if (!text.includes(expected)) {
    throw new Error(`${file}: missing window-closed copy, read: ${text.slice(0, 400)}`);
  }
  if (/falsifier/i.test(text) || text.includes("证伪")) {
    throw new Error(`${file}: forbidden falsifier language, read: ${text.slice(0, 400)}`);
  }
}

async function installCockpitRoutes(page, thesisId, firedAt) {
  const now = firedAt;
  const receipts = {
    run: {
      lane: "alerts_engine",
      run_id: "r-f11-9",
      started_at: now,
      concluded_at: now,
      outcome: "success",
      evaluated_n: 1,
      fired_n: 0,
      unevaluable_n: 0,
      source_asof: null,
      lane_cadence_budget_s: 300,
      error_class: null,
    },
    runs_state: "READ_OK",
    last_success_at: now,
    last_success_state: "READ_OK",
    suite_run: null,
    suite_runs_state: "READ_OK_ZERO",
    suite_last_success_at: null,
    suite_last_success_state: "READ_OK_ZERO",
    outbox: [{
      alert_id: null,
      fire_event_id: `fe-${thesisId}`,
      status: "pending",
      attempts: 0,
      last_error: null,
      deliver_after: null,
      delivered_at: null,
      created_at: now,
      payload: { thesis_id: thesisId, kind: "thesis_condition", fired_at: now },
    }],
    outbox_state: "READ_OK",
  };
  await page.route("**/data/manifest.json**", (route) => route.fulfill({
    json: { symbols: { NVDA: { name: "NVIDIA", last: 182.5 } } },
  }));
  await page.route("**/api/alerts/receipts**", (route) => route.fulfill({ json: receipts }));
  await page.route("**/api/alerts**", async (route) => {
    if (route.request().url().includes("/api/alerts/receipts")) {
      return route.fulfill({ json: receipts });
    }
    return route.fulfill({ json: { alerts: [] } });
  });
}

async function withStore(browser, width, lang, storeKey, run) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[width],
    hasTouch: width === 390,
    locale: lang === "zh" ? "zh-CN" : "en-US",
    colorScheme: "dark",
  });
  await context.addCookies([{ name: "mm_e2e_wl", value: storeKey, url: BASE }]);
  await context.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  try {
    await run(page, context);
  } finally {
    await context.close();
  }
}

async function capturePair(page, context, width, lang, files) {
  const title = lang === "zh" ? "窗口已结束的论点" : "Closed-window thesis";
  const thesisId = await createThesis(context, title, "NVDA");
  await assertWindowClosed(context, thesisId);
  const firedAt = new Date().toISOString();
  await installCockpitRoutes(page, thesisId, firedAt);
  await page.goto(`${BASE}/alerts`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const expected = COPY[lang];
  const row = page.locator('[data-alerts-module="recent-activity"] [data-delivery="pending"]').first();
  try {
    await row.waitFor({ state: "visible", timeout: 45_000 });
  } catch (err) {
    const dump = await page.evaluate(() => ({
      state: document.querySelector("[data-cockpit-state]")?.getAttribute("data-cockpit-state"),
      modules: [...document.querySelectorAll("[data-alerts-module]")].map((el) => ({
        name: el.getAttribute("data-alerts-module"),
        text: el.textContent?.slice(0, 240),
      })),
      body: document.body?.innerText?.slice(0, 800),
    }));
    throw new Error(`thesis row never rendered: ${JSON.stringify(dump)} (${err && err.message ? err.message : err})`);
  }
  const activity = page.locator('[data-alerts-module="recent-activity"]').first();
  const recentFile = cropName("recent-activity", width, lang);
  assertCopy(await activity.innerText(), lang, recentFile);
  await shootSel(page, '[data-alerts-module="recent-activity"]', join(OUT, recentFile));
  files.push(recentFile);

  await row.click();
  const detail = page.locator('[data-cockpit-state="drillback"]');
  await detail.waitFor({ state: "visible", timeout: 15_000 });
  const detailFile = cropName("thesis-detail", width, lang);
  assertCopy(await detail.innerText(), lang, detailFile);
  await shootSel(page, '[data-cockpit-state="drillback"]', join(OUT, detailFile));
  files.push(detailFile);
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
          const storeKey = `monitorfired-f11-9-${width}-${lang}-${randomUUID().slice(0, 8)}`;
          process.stdout.write(`capture ${width} ${lang} … `);
          try {
            await withStore(browser, width, lang, storeKey, async (page, context) => {
              await capturePair(page, context, width, lang, files);
            });
            console.log("ok");
          } catch (err) {
            failed += 1;
            console.log(`FAIL ${err && err.message ? err.message : err}`);
          }
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(child);
  }

  if (failed) {
    console.error(`${failed} surface(s) failed — EVIDENCE.yml not written`);
    process.exitCode = 1;
    return;
  }
  files.sort();
  const evidence = [
    "# B-F11-9 thesis window-closed — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    "layoutFiles:",
    ...layoutFilesBlock(),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - { name: desktop, width: 1440, height: 900 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "surfaces: [recent-activity, thesis-detail]",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_b_f11_9_thesis_window_closed.cjs",
    "files:",
    ...files.map((f) => `  - ${f}`),
    "",
  ];
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence.join("\n"));
  console.log(`capturedAtHead ${capturedAtHead}`);
  console.log(`wrote ${files.length} crops + EVIDENCE.yml to ${OUT}`);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
