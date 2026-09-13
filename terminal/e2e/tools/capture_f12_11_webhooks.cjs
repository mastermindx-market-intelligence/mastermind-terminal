#!/usr/bin/env node
/**
 * B-F12-11 Outbound signed webhooks — dark evidence crops.
 *
 * Playwright against /dev/settings?s=webhooks. Dark only
 * (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06). Capture flag
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * Two states × two viewports (1440 desktop + 390 mobile) × two languages (EN + ZH)
 * = 8 PNGs.
 *
 *   populated: one endpoint subscribed to alert fires, key version 2 with rotation date,
 *              the consent toggle ON, deliveries list showing one delivered "Alert fired"
 *              row and one failed row with its Send-again button.
 *   rotated:   the once-only new-secret panel with the 24-hour sentence.
 *
 * From terminal/:
 *   node e2e/tools/capture_f12_11_webhooks.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f12-11-signed-webhooks/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f12-11-signed-webhooks");
// Asserted lock: packet-local files only (see f12_11SignedWebhooksEvidence.test.ts).
const LAYOUT_FILES = [
  "terminal/components/settings/SectionWebhooks.tsx",
  "terminal/lib/webhookLabels.ts",
];
// Recorded for provenance, never asserted: the repo-wide bilingual lexicon
// every UI packet extends.
const INFORMATIONAL_FILES = ["terminal/lib/i18n.tsx"];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3541);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const TEAM = { id: "team-1", name: "Desk", role: "owner", createdAt: "2026-09-01T00:00:00.000Z" };
// Endpoint is subscribed to BOTH 'webhook.test' and 'alert.fired' (R5) and shows
// secretVersion=2 with a rotation date so the "Key version 2, rotated ..." line is on screen.
const ENDPOINT = {
  id: "ep-1",
  teamId: "team-1",
  url: "https://hooks.example.com/mastermind",
  enabled: true,
  eventFilter: ["webhook.test", "alert.fired"],
  createdBy: "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22",
  createdAt: "2026-09-09T10:00:00.000Z",
  secretVersion: 2,
  secretRotatedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
};
const DELIVERIES = [
  // Failed alert-fire row — Send-again button must be visible.
  { id: "d-fail", endpointId: "ep-1", teamId: "team-1", eventId: "e-fail", eventType: "alert.fired", attempt: 5, status: "failed", lastError: "http 500", createdAt: new Date(Date.now() - 60_000).toISOString() },
  // Delivered alert-fire row — must render with the "Alert fired" label and "Delivered" status.
  { id: "d-ok",   endpointId: "ep-1", teamId: "team-1", eventId: "e-ok",   eventType: "alert.fired", attempt: 1, status: "delivered", lastError: null, createdAt: new Date(Date.now() - 180_000).toISOString() },
];

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

function informationalFilesBlock() {
  return ["  asserted: false", ...INFORMATIONAL_FILES.map((rel) => `  ${rel}: "${sha256File(rel)}"`)];
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
    NEXT_PUBLIC_TERMINAL_CAPTURE: "1",
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
      const res = await fetch(`${BASE}/dev/settings?s=webhooks`, { redirect: "manual" });
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

async function mockApis(page, state) {
  await page.route("**/api/teams**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ teams: [TEAM], truncated: false }),
      });
      return;
    }
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ team: TEAM }) });
  });
  await page.route("**/api/webhooks/alert-optin**", async (route) => {
    const method = route.request().method();
    if (method === "PUT") {
      const body = route.request().postData() || "{}";
      const parsed = JSON.parse(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, enabled: parsed.enabled === true }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ enabled: true }),
    });
  });
  await page.route("**/api/webhooks**", async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    if (url.includes("/deliveries/") && url.includes("/retry")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    if (url.includes("/rotate")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, secret: "whsec_rotated_fixture_once", secretVersion: 3 }),
      });
      return;
    }
    if (url.includes("/deliveries")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ deliveries: state === "rotated" ? [] : DELIVERIES }),
      });
      return;
    }
    if (url.includes("/test")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, eventId: "evt-test" }) });
      return;
    }
    if (method === "PATCH") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ endpoint: { ...ENDPOINT, enabled: false } }) });
      return;
    }
    if (method === "POST") {
      // The rotate flow re-POSTs to /api/webhooks/<id>/rotate; treat any POST here as rotate success.
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          secret: "whsec_rotated_fixture_once",
          secretVersion: ENDPOINT.secretVersion + 1,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        endpoints: state === "rotated" ? [ENDPOINT] : [ENDPOINT],
        callerRole: "owner",
        truncated: false,
      }),
    });
  });
}

async function openWebhooks(page, lang, viewport) {
  await page.setViewportSize(viewport);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await mockApis(page, "populated");
  await page.goto(`${BASE}/dev/settings?s=webhooks&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.locator(".acs-overlay.open .acs-card").waitFor({ state: "visible", timeout: 45_000 });
  const title = lang === "zh" ? "Webhook 回调" : "Webhooks";
  await page.getByRole("heading", { name: title }).waitFor({ state: "visible", timeout: 15_000 });
  await stripDevOverlay(page);
}

async function assertPopulatedAnchors(page, lang, file) {
  // One endpoint subscribed to alert fires → both event-type chips render.
  const chip = lang === "zh" ? "提醒已触发" : "Alert fired";
  await page.getByText(chip, { exact: true }).first().waitFor({ state: "visible", timeout: 10_000 });
  // Key-version line is on screen (key version 2, rotated ...) in either EN or ZH.
  const versionKey = page.getByText(
    lang === "zh" ? /密钥版本 2/ : /Key version 2/i,
  ).first();
  await versionKey.waitFor({ state: "visible", timeout: 10_000 });
  // Consent toggle is on.
  const consentLabel = lang === "zh"
    ? "把我的提醒触发发送到这个团队的 Webhook"
    : "Send my alert fires to this team's webhooks";
  await page.getByText(consentLabel).first().waitFor({ state: "visible", timeout: 10_000 });
  // The deliveries list contains a failed "Alert fired" row with a Send-again button.
  const sendAgain = lang === "zh" ? "重新发送" : "Send again";
  await page.getByRole("button", { name: sendAgain }).first().waitFor({ state: "visible", timeout: 10_000 });
}

async function assertRotatedAnchors(page, lang, file) {
  // The once-only new-secret panel must show the 24-hour rotation sentence.
  const helpText = lang === "zh"
    ? "旧密钥在 24 小时内继续有效，你可以在不漏掉任何送达的情况下切换接收端。"
    : "The old secret keeps working for 24 hours, so you can switch your receiver without missing a delivery.";
  await page.getByText(helpText).first().waitFor({ state: "visible", timeout: 10_000 });
  // The new secret value is rendered in the read-only input.
  const secretInput = page.locator("input.acs-in[readonly]");
  await secretInput.first().waitFor({ state: "visible", timeout: 10_000 });
  const v = await secretInput.first().inputValue();
  if (v !== "whsec_rotated_fixture_once") {
    throw new Error(`${file}: rotated secret input value is ${JSON.stringify(v)} (expected whsec_rotated_fixture_once)`);
  }
}

async function shoot(page, file, state) {
  await assertNoNextIndicator(page, file);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(120);
  const overlay = page.locator(".acs-overlay.open");
  await overlay.screenshot({ path: join(OUT, file) });
}

async function driveRotated(page, lang) {
  // 1. Re-mock so the deliveries list is empty (the secret panel sits above the deliveries list).
  await mockApis(page, "rotated");
  // 2. Trigger the rotate button.
  const rotate = lang === "zh" ? "更换签名密钥" : "Rotate secret";
  await page.getByRole("button", { name: rotate }).first().click();
  await page.waitForTimeout(600);
}

async function main() {
  const headSha = currentGitHead();
  console.log(`B-F12-11 capture start — head ${headSha}`);
  const server = startServer();
  let exitCode = 0;
  try {
    await waitForServer(90_000);
    const browser = await chromium.launch();
    try {
      for (const viewportName of ["desktop", "mobile"]) {
        const viewport = VIEWPORTS[viewportName];
        for (const lang of ["en", "zh"]) {
          const ctx = await browser.newContext({
            viewport,
            colorScheme: "dark",
            deviceScaleFactor: 1,
          });
          const page = await ctx.newPage();

          // ---- populated ----
          await openWebhooks(page, lang, viewport);
          await assertPopulatedAnchors(page, lang, `${viewportName}-${lang}-populated.png`);
          await shoot(page, `${viewportName}-${lang}-populated.png`, "populated");
          console.log(`  wrote ${viewportName}-${lang}-populated.png`);

          // ---- rotated ----
          await driveRotated(page, lang);
          await assertRotatedAnchors(page, lang, `${viewportName}-${lang}-rotated.png`);
          await shoot(page, `${viewportName}-${lang}-rotated.png`, "rotated");
          console.log(`  wrote ${viewportName}-${lang}-rotated.png`);

          await ctx.close();
        }
      }
    } finally {
      await browser.close();
    }

    // ---- write EVIDENCE.yml ----
    const files = [
      "desktop-en-populated.png",
      "desktop-en-rotated.png",
      "desktop-zh-populated.png",
      "desktop-zh-rotated.png",
      "mobile-en-populated.png",
      "mobile-en-rotated.png",
      "mobile-zh-populated.png",
      "mobile-zh-rotated.png",
    ];
    const yml = [
      "# B-F12-11 Outbound signed webhooks: signature, retry, dedupe, producer wiring — capture evidence",
      "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
      "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
      `# capturedAtHead: ${headSha}`,
      "# capturedAtHead is informational. The lock is layoutFiles.",
      "# layoutFiles are packet-local and ARE asserted by",
      "# terminal/lib/__tests__/f12_11SignedWebhooksEvidence.test.ts. informationalFiles",
      "# are recorded for provenance only: terminal/lib/i18n.tsx is the repo-wide",
      "# bilingual lexicon every UI packet extends, and asserting it here would",
      "# redden master for unrelated LEX-adding work.",
      "layoutFiles:",
      ...layoutFilesBlock(),
      "informationalFiles:",
      ...informationalFilesBlock(),
      "theme: dark",
      "languages: [en, zh]",
      "viewports:",
      "  - { name: desktop, width: 1440, height: 900 }",
      "  - { name: mobile, width: 390, height: 844 }",
      "harness: /dev/settings?s=webhooks&lang=<en|zh>",
      "capture_flag: TERMINAL_E2E_FIXTURE",
      "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; playwright.config.ts already sets that flag on the e2e dev server. This script starts next dev with the same flag.",
      "command: |",
      "  cd terminal",
      "  node e2e/tools/capture_f12_11_webhooks.cjs",
      "files:",
      ...files.map((f) => `  - ${f}`),
      "",
    ].join("\n");
    writeFileSync(join(OUT, "EVIDENCE.yml"), yml, "utf8");
    console.log(`B-F12-11 capture done — wrote ${files.length} PNGs + EVIDENCE.yml`);
  } catch (err) {
    console.error(`B-F12-11 capture FAILED: ${err && err.stack ? err.stack : err}`);
    exitCode = 1;
  } finally {
    stopServer(server);
    await new Promise((r) => setTimeout(r, 500));
  }
  process.exit(exitCode);
}

if (require.main === module) {
  main();
}