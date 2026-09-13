#!/usr/bin/env node
/**
 * B-F11-7 Recurring briefs — dark evidence crops.
 *
 * Playwright against /alerts (inbox) and /analysis?view=theses (subscribe).
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
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f11-7-recurring-briefs");
const LAYOUT_FILES = [
  "terminal/components/briefs/BriefsInbox.tsx",
  "terminal/components/briefs/BriefSubscribeControls.tsx",
  "terminal/components/briefs/briefs.module.css",
  "terminal/lib/briefs.ts",
  "terminal/components/alerts/AlertsCockpit.tsx",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3567);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
const THESIS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
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
    subscription: { targetKind: "thesis", targetId: THESIS, cadence: "daily_after_us_close", state: "active" },
  },
  {
    deliveryId: "d-ready",
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
const SHOTS = [
  { viewport: "desktop", lang: "en", kind: "list", file: "list-1440.png" },
  { viewport: "desktop", lang: "zh", kind: "list", file: "list-1440-zh.png" },
  { viewport: "mobile", lang: "en", kind: "list", file: "list-390.png" },
  { viewport: "mobile", lang: "zh", kind: "list", file: "list-390-zh.png" },
  { viewport: "desktop", lang: "en", kind: "empty", file: "empty-1440.png" },
  { viewport: "desktop", lang: "zh", kind: "empty", file: "empty-1440-zh.png" },
  { viewport: "mobile", lang: "en", kind: "empty", file: "empty-390.png" },
  { viewport: "mobile", lang: "zh", kind: "empty", file: "empty-390-zh.png" },
  { viewport: "desktop", lang: "en", kind: "subscribe", file: "subscribe-1440.png" },
  { viewport: "desktop", lang: "zh", kind: "subscribe", file: "subscribe-1440-zh.png" },
  { viewport: "mobile", lang: "en", kind: "subscribe", file: "subscribe-390.png" },
  { viewport: "mobile", lang: "zh", kind: "subscribe", file: "subscribe-390-zh.png" },
];

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

async function mockBriefs(page, deliveries) {
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
        body: JSON.stringify({ subscriptions: [] }),
      });
      return;
    }
    await route.continue();
  });
}

async function openAlerts(page, lang, viewport, deliveries) {
  await page.setViewportSize(viewport);
  await mockBriefs(page, deliveries);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await page.goto(`${BASE}/alerts?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByTestId("briefs-inbox").waitFor({ state: "visible", timeout: 45_000 });
  await stripDevOverlay(page);
}

async function openSubscribe(page, lang, viewport) {
  await page.setViewportSize(viewport);
  await mockBriefs(page, []);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await page.goto(`${BASE}/analysis?view=theses&symbol=NVDA&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.getByTestId("thesis-workspace").waitFor({ state: "visible", timeout: 45_000 });
  const created = await page.request.post(`${BASE}/api/theses`, {
    data: {
      action: "create",
      clientRequestId: `crop-${lang}-${viewport}-${Date.now()}`,
      subject: {
        schema: "mastermind.thesis-subject-ref/v1",
        kind: "issuer",
        owner: "terminal.analysis_symbol",
        key: "NVDA",
        identityState: "listing_scoped",
        listing: { symbol: "NVDA", mic: null, securityId: null },
        companyId: null,
        display: "NVDA · listing scoped",
      },
      content: {
        schema: "mastermind.thesis-content/v1",
        title: "NVDA cycle",
        statement: "Demand will outrun supply through the next platform cycle.",
        catalysts: [],
        falsifiers: [],
        risks: [],
        horizon: "unspecified",
        effectiveAt: null,
        revisionNote: null,
      },
    },
  });
  if (created.status() !== 201) {
    throw new Error(`thesis create ${created.status()}: ${await created.text()}`);
  }
  const thesisId = (await created.json()).thesisId;
  await page.goto(`${BASE}/analysis?view=theses&symbol=NVDA&thesis=${thesisId}&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.getByTestId("brief-subscribe").waitFor({ state: "visible", timeout: 45_000 });
  await stripDevOverlay(page);
}

async function shoot(page, file, kind) {
  await assertNoNextIndicator(page, file);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  const target = kind === "subscribe"
    ? page.getByTestId("brief-subscribe")
    : page.getByTestId("briefs-inbox");
  await target.screenshot({ path: join(OUT, file) });
}

async function main() {
  const capturedAtHead = currentGitHead();
  const child = startServer();
  const files = [];
  try {
    await waitForServer(180_000);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const shot of SHOTS) {
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
          if (shot.kind === "subscribe") {
            await openSubscribe(page, shot.lang, VIEWPORTS[shot.viewport]);
          } else {
            await openAlerts(page, shot.lang, VIEWPORTS[shot.viewport], shot.kind === "list" ? LIST_DELIVERIES : []);
          }
          await shoot(page, shot.file, shot.kind);
          files.push(shot.file);
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
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(child);
  }

  const evidence = [
    "# B-F11-7 Recurring briefs — capture evidence",
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
    "harness:",
    ...SHOTS.map((s) => `  ${s.file}: { kind: ${s.kind}, lang: ${s.lang}, viewport: ${s.viewport} }`),
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; playwright.config.ts already sets that flag on the e2e dev server. This script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_b_f11_7_recurring_briefs.cjs",
    "files:",
    ...files.map((f) => `  - ${f}`),
    "",
  ];
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence.join("\n"));
  console.log(`wrote ${files.length} crops + EVIDENCE.yml (capturedAtHead ${capturedAtHead})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
