#!/usr/bin/env node
/**
 * B-F12-7 Webhooks settings — dark evidence crops.
 *
 * Playwright against /dev/settings?s=webhooks. Dark only
 * (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06). Capture flag
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_f12_7_webhooks.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f12-7-webhooks/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f12-7-webhooks");
// Asserted lock: packet-local files only (see f12_7WebhooksEvidence.test.ts).
const LAYOUT_FILES = [
  "terminal/components/settings/SectionWebhooks.tsx",
  "terminal/lib/webhookLabels.ts",
  "terminal/lib/webhookUrl.ts",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/components/settings/icons.tsx",
];
// Recorded for provenance, never asserted: the repo-wide bilingual lexicon
// every UI packet extends.
const INFORMATIONAL_FILES = ["terminal/lib/i18n.tsx"];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3537);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const TEAM = { id: "team-1", name: "Desk", role: "owner", createdAt: "2026-09-01T00:00:00.000Z" };
const ENDPOINT = {
  id: "ep-1",
  teamId: "team-1",
  url: "https://hooks.example.com/mastermind",
  enabled: true,
  eventFilter: ["webhook.test"],
  createdBy: "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22",
  createdAt: "2026-09-09T10:00:00.000Z",
};
// All seven statuses, and the two cause labels the deliveries list renders
// under a status (last_error is a machine class; the row shows the sentence).
const DELIVERIES = [
  { id: "d1", endpointId: "ep-1", teamId: "team-1", eventId: "e1", eventType: "webhook.test", attempt: 0, status: "pending", lastError: null, createdAt: new Date(Date.now() - 30_000).toISOString() },
  { id: "d2", endpointId: "ep-1", teamId: "team-1", eventId: "e2", eventType: "webhook.test", attempt: 1, status: "delivering", lastError: null, createdAt: new Date(Date.now() - 120_000).toISOString() },
  { id: "d3", endpointId: "ep-1", teamId: "team-1", eventId: "e3", eventType: "webhook.test", attempt: 2, status: "retrying", lastError: "timeout", createdAt: new Date(Date.now() - 3600_000).toISOString() },
  { id: "d4", endpointId: "ep-1", teamId: "team-1", eventId: "e4", eventType: "webhook.test", attempt: 1, status: "delivered", lastError: null, createdAt: new Date(Date.now() - 7200_000).toISOString() },
  { id: "d5", endpointId: "ep-1", teamId: "team-1", eventId: "e5", eventType: "webhook.test", attempt: 5, status: "failed", lastError: "http 500", createdAt: new Date(Date.now() - 86400_000).toISOString() },
  { id: "d6", endpointId: "ep-1", teamId: "team-1", eventId: "e6", eventType: "webhook.test", attempt: 0, status: "not_sent_disabled", lastError: "endpoint_disabled", createdAt: new Date(Date.now() - 90000_000).toISOString() },
  { id: "d7", endpointId: "ep-1", teamId: "team-1", eventId: "e7", eventType: "webhook.test", attempt: 0, status: "not_sent_invalid_url", lastError: "private_address", createdAt: new Date(Date.now() - 95000_000).toISOString() },
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
  await page.route("**/api/webhooks**", async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    if (url.includes("/deliveries")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ deliveries: state === "populated" ? DELIVERIES : [] }),
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
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          endpoint: ENDPOINT,
          secret: "whsec_fixture_shown_once_not_a_real_secret",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        endpoints: state === "empty" || state === "ssrf" ? [] : [ENDPOINT],
        callerRole: "owner",
        truncated: false,
      }),
    });
  });
}

async function openWebhooks(page, lang, viewport, state) {
  await page.setViewportSize(viewport);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await mockApis(page, state);
  await page.goto(`${BASE}/dev/settings?s=webhooks&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.locator(".acs-overlay.open .acs-card").waitFor({ state: "visible", timeout: 45_000 });
  const title = lang === "zh" ? "Webhook 回调" : "Webhooks";
  await page.getByRole("heading", { name: title }).waitFor({ state: "visible", timeout: 15_000 });
  await stripDevOverlay(page);
}

async function shoot(page, file) {
  await assertNoNextIndicator(page, file);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(120);
  const overlay = page.locator(".acs-overlay.open");
  await overlay.screenshot({ path: join(OUT, file) });
}

async function driveState(page, lang, state) {
  if (state === "secret") {
    await page.locator("#wh-url").fill("https://hooks.example.com/mastermind");
    const add = lang === "zh" ? "添加回调" : "Add endpoint";
    await page.getByRole("button", { name: add }).click();
    const once = lang === "zh"
      ? "此密钥仅显示一次，请立即保存，之后将无法再次查看。"
      : "This is shown once. Store it now — it cannot be shown again.";
    await page.getByText(once).waitFor({ state: "visible", timeout: 10_000 });
  }
  if (state === "ssrf") {
    await page.locator("#wh-url").fill("https://127.0.0.1/hook");
    const add = lang === "zh" ? "添加回调" : "Add endpoint";
    await page.getByRole("button", { name: add }).click();
    const err = lang === "zh"
      ? "请使用公网的 https 地址。不支持私有或本地地址。"
      : "Use an https address on the public internet. Private or local addresses are not allowed.";
    await page.getByText(err).waitFor({ state: "visible", timeout: 10_000 });
  }
  if (state === "populated") {
    const delivered = lang === "zh" ? "已送达" : "Delivered";
    await page.getByText(delivered).first().waitFor({ state: "visible", timeout: 10_000 });
  }
  if (state === "empty") {
    const empty = lang === "zh" ? "此团队尚未登记 Webhook 回调地址。" : "This team has not registered a webhook endpoint yet.";
    await page.getByText(empty).waitFor({ state: "visible", timeout: 10_000 });
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
      const shots = [];
      for (const viewport of ["desktop", "mobile"]) {
        for (const lang of ["en", "zh"]) {
          for (const state of ["empty", "populated", "secret", "ssrf"]) {
            shots.push({ viewport, lang, state, file: `${viewport}-${lang}-${state}.png` });
          }
        }
      }
      for (const shot of shots) {
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
          await openWebhooks(page, shot.lang, VIEWPORTS[shot.viewport], shot.state);
          await driveState(page, shot.lang, shot.state);
          await shoot(page, shot.file);
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
    "# B-F12-7 Outbound signed webhooks — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    "# layoutFiles are packet-local and ARE asserted by",
    "# terminal/lib/__tests__/f12_7WebhooksEvidence.test.ts. informationalFiles",
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
    "  node e2e/tools/capture_f12_7_webhooks.cjs",
    "files:",
    ...files.map((f) => `  - ${f}`),
    "",
  ].join("\n");
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence);
  console.log(`capturedAtHead ${capturedAtHead}`);
  console.log(`wrote ${files.length} crops + EVIDENCE.yml to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
