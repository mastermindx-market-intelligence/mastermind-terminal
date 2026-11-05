#!/usr/bin/env node
/**
 * B-F11-7 Recurring briefs — dark evidence crops.
 *
 * Playwright against /alerts only: central schedule composer + inbox states.
 * Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * Capture flag TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator.
 *
 * From terminal/:
 *   node e2e/tools/capture_b_f11_7_recurring_briefs.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f11-7-recurring-briefs/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f11-7-recurring-briefs");
const LAYOUT_FILES = [
  "terminal/components/briefs/BriefsInbox.tsx",
  "terminal/components/briefs/briefs.module.css",
  "terminal/lib/briefs.ts",
  "terminal/components/alerts/AlertsCockpit.tsx",
  "terminal/components/alerts/alerts.module.css",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3567);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
const THESIS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WATCHLIST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const READY_BODY = {
  target: { kind: "thesis", id: THESIS, name: "NVDA cycle", version_or_asof: "v3" },
  market_read: [
    { section: "tape", sentence_en: "The close held above last week's range.", sentence_zh: "收盘守住了上周的区间。", asof: "2026-09-11" },
    { section: "flow", sentence_en: "Call buying stayed in the front week.", sentence_zh: "买权仍集中在近月。", asof: "2026-09-11" },
  ],
  monitors: [{ name: "range hold", state_en: "Holding", state_zh: "仍成立" }],
  artifact: { name: "US session digest", asof: "2026-09-11T20:05:00.000Z" },
};
const LIST_DELIVERIES = [
  {
    deliveryId: "d-deg",
    subscriptionId: "s1",
    slotAsof: "2026-09-11",
    state: "degraded",
    body: {},
    createdAt: "2026-09-11T20:10:00.000Z",
    subscription: { targetKind: "thesis", targetId: THESIS, cadence: "daily_after_us_close", state: "active", targetName: "NVDA cycle" },
  },
  {
    // Canonical inert delivery identity exercises the actual sharing entry.
    deliveryId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    subscriptionId: "s1",
    slotAsof: "2026-09-10",
    state: "ready",
    pinned: true,
    body: READY_BODY,
    createdAt: "2026-09-10T20:10:00.000Z",
    subscription: {
      targetKind: "thesis",
      targetId: THESIS,
      cadence: "daily_after_us_close",
      state: "active",
      targetName: "NVDA cycle",
    },
  },
];
const LIST_SUBSCRIPTIONS = [
  {
    subscriptionId: "11111111-1111-4111-8111-111111111111",
    userId: "fixture-user",
    targetKind: "thesis",
    targetId: THESIS,
    targetName: "NVDA cycle",
    cadence: "daily_after_us_close",
    delivery: "in_product_inbox",
    state: "active",
    createdAt: "2026-09-11T20:00:00.000Z",
  },
  {
    subscriptionId: "22222222-2222-4222-8222-222222222222",
    userId: "fixture-user",
    targetKind: "watchlist",
    targetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    targetName: "Semis",
    cadence: "weekly_saturday",
    delivery: "in_product_inbox",
    state: "paused",
    createdAt: "2026-09-10T20:00:00.000Z",
  },
];

const SHOTS = [
  { viewport: "desktop", lang: "en", kind: "list", file: "list-1440.png" },
  { viewport: "desktop", lang: "zh", kind: "list", file: "list-1440-zh.png" },
  { viewport: "mobile", lang: "en", kind: "list", file: "list-390.png" },
  { viewport: "mobile", lang: "zh", kind: "list", file: "list-390-zh.png" },
  { viewport: "desktop", lang: "en", kind: "empty", file: "empty-1440.png" },
  { viewport: "desktop", lang: "zh", kind: "empty", file: "empty-1440-zh.png" },
  { viewport: "mobile", lang: "en", kind: "empty", file: "empty-390.png" },
  { viewport: "mobile", lang: "zh", kind: "empty", file: "empty-390-zh.png" },
  { viewport: "desktop", lang: "en", kind: "schedule", file: "schedule-1440.png" },
  { viewport: "desktop", lang: "zh", kind: "schedule", file: "schedule-1440-zh.png" },
  { viewport: "mobile", lang: "en", kind: "schedule", file: "schedule-390.png" },
  { viewport: "mobile", lang: "zh", kind: "schedule", file: "schedule-390-zh.png" },
];

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function layoutSnapshot() {
  return Object.fromEntries(LAYOUT_FILES.map((rel) => [rel, sha256File(rel)]));
}

function preserveManifest() {
  const bytes = readFileSync(join(OUT, "EVIDENCE.yml"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const file = `EVIDENCE.history-${sha256}.yml`;
  try { writeFileSync(join(OUT, file), bytes, { flag: "wx" }); }
  catch (error) {
    if (error.code !== "EEXIST" || !readFileSync(join(OUT, file)).equals(bytes)) throw error;
  }
  return { file, sha256 };
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
  child.closed = new Promise((resolve) => child.once("close", resolve));
  child.ready = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => reject(new Error(`dev server exited before readiness: ${code}/${signal || "none"}`)));
    const onData = (buf) => {
      const line = String(buf);
      if (/Ready|compiled|error|Error/i.test(line)) process.stdout.write(`[dev] ${line}`);
      if (/✓ Ready/i.test(line)) resolve();
    };
    child.stdout.on("data", onData);
  });
  child.stderr.on("data", (buf) => process.stderr.write(`[dev:err] ${buf}`));
  return child;
}

async function bounded(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function reportServer(child, phase, code) {
  if (typeof process.send !== "function") return; // Standalone capture owns its cleanup.
  const captureId = process.env.TERMINAL_BRIEFS_CAPTURE_ID;
  if (!captureId || !Number.isInteger(child?.pid) || child.pid < 1) throw new Error("BRIEFS_SERVER_REPORT_IDENTITY");
  await bounded(new Promise((resolve, reject) => process.send({ briefsServer: {
    captureId, phase, pid: child.pid, pgid: child.pid, ...(code ? { code } : {}),
  } }, error => error ? reject(error) : resolve())), 2_000, "BRIEFS_SERVER_REPORT_UNSETTLED");
}

function stopServer(child, { kill = process.kill.bind(process), now = Date.now,
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
  if (!child || !child.pid) return Promise.resolve();
  if (!Number.isInteger(child.pid) || child.pid < 1 || !child.closed || typeof child.closed.then !== "function") {
    return Promise.reject(new Error("BRIEFS_SERVER_IDENTITY_OR_CLOSE_MISSING"));
  }
  if (child.shutdown) return child.shutdown;
  child.shutdown = (async () => {
    const alive = () => {
      try { kill(-child.pid, 0); return true; }
      catch (error) { if (error.code === "ESRCH") return false; throw error; }
    };
    const signal = name => {
      try { kill(-child.pid, name); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    };
    const drain = async milliseconds => {
      const deadline = now() + milliseconds;
      while (alive() && now() < deadline) await wait(50);
      return !alive();
    };
    if (alive()) {
      signal("SIGTERM");
      if (!await drain(8_000)) {
        signal("SIGKILL");
        if (!await drain(5_000)) throw new Error("BRIEFS_SERVER_GROUP_UNSETTLED");
      }
    }
    await bounded(child.closed, 2_000, "BRIEFS_SERVER_CLOSE_UNSETTLED");
  })();
  return child.shutdown;
}

async function settleBriefsServer(child, { stop = stopServer, report = reportServer } = {}) {
  try { await stop(child); }
  catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) {
      try { await report(child, "refused", error.code); }
      catch (reportError) { throw new AggregateError([error, reportError], "BRIEFS_SERVER_REFUSAL_REPORT_FAILED"); }
    }
    throw error;
  }
  await report(child, "stopped");
}


async function waitForServer(child, timeoutMs) {
  await bounded(child.ready, timeoutMs, "dev server never printed Ready");
  const deadline = Date.now() + 60_000;
  let last = "not tried";
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode) throw new Error("dev server exited during readiness");
    try {
      const res = await fetch(`${BASE}/alerts`, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
      last = String(res.status);
      if (res.status === 200) return;
    } catch (err) {
      last = err.cause?.code || err.name || err.message;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`dev server on ${PORT} printed Ready but never answered (${last})`);
}

async function assertNoNextIndicator(page, file) {
  await page.waitForTimeout(400);
  const n = await page.locator("[data-nextjs-dev-tools-button]").count();
  if (n > 0) {
    throw new Error(`${file}: Next.js N overlay still mounted (${n}); TERMINAL_E2E_FIXTURE gate failed`);
  }
}

async function mockBriefs(page, deliveries, subscriptions = []) {
  await page.route("**/api/briefs/deliveries**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ deliveries }),
    });
  });
  await page.route("**/api/briefs/subscriptions**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ subscriptions }),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/watchlist", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        lists: [{ id: WATCHLIST, name: "Semis", position: 0, symbols: [] }],
        sharedWithMe: [],
      }),
    });
  });
  await page.route("**/api/theses", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        theses: [{
          id: THESIS,
          currentVersion: 3,
          lifecycleState: "active",
          subject: {},
          title: "NVDA cycle",
          updatedAt: "2026-09-11T20:00:00.000Z",
        }],
        truncated: false,
      }),
    });
  });
}

async function openAlerts(page, lang, viewport, deliveries, subscriptions = []) {
  await page.setViewportSize(viewport);
  await mockBriefs(page, deliveries, subscriptions);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await page.goto(`${BASE}/alerts?lang=${lang}#briefs`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByTestId("briefs-inbox").waitFor({ state: "visible", timeout: 45_000 });
  // The cockpit initially renders a lazy-mount placeholder with the same test id.
  // Scroll it into view, then require the actual list/empty state before capture.
  await page.getByTestId("briefs-inbox").scrollIntoViewIfNeeded();
  await page.locator(deliveries.length ? '[data-brief-row]' : '[data-briefs-state="empty"]').first()
    .waitFor({ state: "visible", timeout: 45_000 });
  await page.waitForFunction(({ delivered, scheduled }) =>
    document.querySelectorAll('[data-brief-row]').length === delivered
    && document.querySelectorAll('[data-brief-schedule]').length === scheduled
    && document.querySelectorAll('[data-testid="briefs-new-schedule"] select:first-child option').length === 2,
  { delivered: deliveries.length, scheduled: subscriptions.length }, { timeout: 45_000 });
  if (!subscriptions.length) await page.locator('[data-briefs-schedules-state="empty"]').waitFor({ state: "visible" });
  if (deliveries.length) await page.locator('a[href="/briefs/dddddddd-dddd-4ddd-8ddd-dddddddddddd/sharing"]').waitFor({ state: "visible" });
}

async function shoot(page, file, kind) {
  await assertNoNextIndicator(page, file);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  const target = kind === "schedule"
    ? page.getByTestId("briefs-new-schedule")
    : page.getByTestId("briefs-inbox");
  if (!await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) {
    throw new Error(`${file}: horizontal overflow`);
  }
  await target.screenshot({ path: join(OUT, file) });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const capturedAtHead = currentGitHead();
  if (!/^[0-9a-f]{40}$/.test(capturedAtHead)) throw new Error("BRIEFS_CHECKOUT");
  const sourcesBefore = layoutSnapshot();
  const history = preserveManifest();
  const child = startServer();
  const files = [];
  let browser;
  let terminated = false;
  let cleanupPromise;
  const cleanup = () => cleanupPromise ||= (async () => {
    const errors = [];
    try { if (browser) await bounded(browser.close(), 10_000, "BRIEFS_BROWSER_CLOSE_UNSETTLED"); }
    catch (error) { errors.push(error); }
    try { await settleBriefsServer(child); }
    catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "BRIEFS_CLEANUP_UNSETTLED");
  })();
  const terminate = async signal => {
    terminated = true;
    try { await cleanup(); } catch (error) { console.error(error); }
    console.error(`BRIEFS_TERMINATED: ${signal}`);
    process.exit(1);
  };
  const onTerm = () => void terminate("SIGTERM"), onInt = () => void terminate("SIGINT");
  process.once("SIGTERM", onTerm); process.once("SIGINT", onInt);
  let captureError;
  try {
    await reportServer(child, "started");
    await waitForServer(child, 180_000);
    const { chromium } = require("@playwright/test");
    browser = await chromium.launch({ headless: true });
    for (const shot of SHOTS) {
        const only = (process.env.CAPTURE_ONLY || "").split(",").filter(Boolean);
        if (only.length && !only.includes(shot.kind) && !only.includes(shot.file)) continue;
        process.stdout.write(`capture ${shot.file} … `);
        const context = await browser.newContext({
          viewport: VIEWPORTS[shot.viewport],
          hasTouch: shot.viewport === "mobile",
          locale: shot.lang === "zh" ? "zh-CN" : "en-US",
          colorScheme: "dark",
        });
        const page = await context.newPage();
        page.setDefaultTimeout(45_000);
        try {
          await openAlerts(
            page,
            shot.lang,
            VIEWPORTS[shot.viewport],
            shot.kind === "list" ? LIST_DELIVERIES : [],
            shot.kind === "list" ? LIST_SUBSCRIPTIONS : [],
          );
          if (shot.kind === "schedule") {
            await page.getByTestId("briefs-new-schedule").waitFor({ state: "visible" });
          }
          await shoot(page, shot.file, shot.kind);
          files.push({ file: shot.file, sha256: createHash("sha256").update(readFileSync(join(OUT, shot.file))).digest("hex") });
          console.log("ok");
        } catch (err) {
          console.log(`FAIL ${err && err.message ? err.message : err}`);
          try {
            await page.screenshot({ path: join(OUT, `FAIL-${shot.file}`), fullPage: false });
          } catch { /* ignore */ }
          throw err;
        } finally {
          await context.close();
        }
    }
  } catch (error) {
    captureError = error;
  } finally {
    try { await cleanup(); }
    catch (error) { throw new AggregateError([captureError, error].filter(Boolean), "BRIEFS_CAPTURE_OR_CLEANUP_FAILED"); }
    finally { process.removeListener("SIGTERM", onTerm); process.removeListener("SIGINT", onInt); }
  }
  if (captureError) throw captureError;
  if (terminated) throw new Error("BRIEFS_CAPTURE_TERMINATED");

  // A subset capture cannot qualify unrendered surfaces or their source hashes.
  if (files.length !== SHOTS.length) {
    console.log(`wrote ${files.length} crops; retained EVIDENCE.yml for scoped binding adjudication`);
    return;
  }

  if (currentGitHead() !== capturedAtHead || JSON.stringify(layoutSnapshot()) !== JSON.stringify(sourcesBefore)) {
    throw new Error("BRIEFS_SOURCE_CHANGED_DURING_CAPTURE");
  }

  const evidence = [
    "# B-F11-7 Recurring briefs — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    `# priorManifest: ${history.file}`,
    `# priorManifestSha256: ${history.sha256}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    "layoutFiles:",
    ...LAYOUT_FILES.map(rel => `  ${rel}: "${sourcesBefore[rel]}"`),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - { name: desktop, width: 1440, height: 900 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "harness:",
    ...SHOTS.map((s) => `  ${s.file}: { kind: ${s.kind}, lang: ${s.lang}, viewport: ${s.viewport} }`),
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators to false when TERMINAL_E2E_FIXTURE is set; playwright.config.ts already sets that flag on the e2e dev server. This script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_b_f11_7_recurring_briefs.cjs",
    "files:",
    ...files.map((f) => `  - ${f.file}`),
    "",
  ];
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence.join("\n"));
  console.log(`wrote ${files.length} crops + EVIDENCE.yml (capturedAtHead ${capturedAtHead})`);
  console.log(JSON.stringify({ briefsEvidence: { capturedAtHead, files, history,
    manifestSha256: createHash("sha256").update(readFileSync(join(OUT, "EVIDENCE.yml"))).digest("hex") } }));
}

if (require.main === module) main().catch((err) => {
  console.error(err); process.exitCode = 1;
});
module.exports = { LAYOUT_FILES, SHOTS, VIEWPORTS, bounded, stopServer, settleBriefsServer, assertNoNextIndicator };
