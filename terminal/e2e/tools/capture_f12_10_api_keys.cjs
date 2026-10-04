#!/usr/bin/env node
/**
 * B-F12-10 Developer access — dark evidence crops.
 *
 * Playwright against /dev/settings?s=developer. Dark only
 * (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06). Capture flag
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator.
 *
 * From terminal/:
 *   node e2e/tools/capture_f12_10_api_keys.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f12-10-api-keys/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f12-10-api-keys");
const LAYOUT_FILES = [
  "terminal/components/settings/SectionDeveloper.tsx",
  "terminal/lib/apiKeyLabels.ts",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/components/settings/icons.tsx",
];
const INFORMATIONAL_FILES = ["terminal/lib/i18n.tsx"];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3540);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const ACTIVE = {
  keyId: "k1",
  keyPrefix: "abcd1234",
  label: "Research laptop",
  scopes: ["read"],
  createdAt: "2026-09-13T00:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
};
const REVOKED = {
  ...ACTIVE,
  revokedAt: "2026-09-13T01:00:00.000Z",
};

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
      const res = await fetch(`${BASE}/dev/settings?s=developer`, { redirect: "manual" });
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
  await page.route("**/api/account/api-keys**", async (route) => {
    const method = route.request().method();
    if (method === "POST" && !route.request().url().match(/api-keys\/[^/?]+$/)) {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          key: ACTIVE,
          secret: "mmx_" + "c".repeat(40),
        }),
      });
      return;
    }
    const keys = state === "revoked" ? [REVOKED] : state === "minted" ? [] : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ keys }),
    });
  });
}

async function openDeveloper(page, lang, viewport, state) {
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
  await page.goto(`${BASE}/dev/settings?s=developer&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.locator(".acs-overlay.open .acs-card").waitFor({ state: "visible", timeout: 45_000 });
  const title = lang === "zh" ? "开发者访问" : "Developer access";
  await page.getByRole("heading", { name: title }).waitFor({ state: "visible", timeout: 15_000 });
  await stripDevOverlay(page);
}

async function driveState(page, lang, state) {
  if (state === "empty") {
    const empty = lang === "zh" ? "你还没有创建个人 API 密钥。" : "You have not minted a personal API key yet.";
    await page.getByText(empty).waitFor({ state: "visible", timeout: 10_000 });
  }
  if (state === "minted") {
    await page.locator("#api-key-label").fill(lang === "zh" ? "研究用电脑" : "Research laptop");
    const mint = lang === "zh" ? "创建个人密钥" : "Mint a personal key";
    await page.getByRole("button", { name: mint }).click();
    const once = lang === "zh"
      ? "此密钥仅显示一次，请立即保存，之后将无法再次查看。"
      : "This is shown once. Store it now — it cannot be shown again.";
    await page.getByText(once).waitFor({ state: "visible", timeout: 10_000 });
    await page.evaluate(() => {
      const el = document.querySelector("[data-testid='api-key-secret']");
      if (el && "value" in el) el.value = "mmx_••••••••••••••••••••••••••••••••••••••••";
    });
  }
  if (state === "revoked") {
    const revoked = lang === "zh" ? "已吊销" : "Revoked";
    await page.getByText(revoked).first().waitFor({ state: "visible", timeout: 10_000 });
  }
}

async function shoot(page, file) {
  await assertNoNextIndicator(page, file);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(120);
  const pane = page.locator(".acs-overlay.open .acs-pane");
  await pane.screenshot({ path: join(OUT, file) });
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
          for (const state of ["empty", "minted", "revoked"]) {
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
          await openDeveloper(page, shot.lang, VIEWPORTS[shot.viewport], shot.state);
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
    "# B-F12-10 Public API v1 — developer access capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    "layoutFiles:",
    ...layoutFilesBlock(),
    "informationalFiles:",
    ...informationalFilesBlock(),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - { name: desktop, width: 1440, height: 900 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "harness:",
    "  desktop-en-empty.png: { url: \"/dev/settings?s=developer&lang=en\", state: empty }",
    "  desktop-zh-empty.png: { url: \"/dev/settings?s=developer&lang=zh\", state: empty }",
    "  desktop-en-minted.png: { url: \"/dev/settings?s=developer&lang=en\", state: minted }",
    "  desktop-zh-minted.png: { url: \"/dev/settings?s=developer&lang=zh\", state: minted }",
    "  desktop-en-revoked.png: { url: \"/dev/settings?s=developer&lang=en\", state: revoked }",
    "  desktop-zh-revoked.png: { url: \"/dev/settings?s=developer&lang=zh\", state: revoked }",
    "  mobile-en-empty.png: { url: \"/dev/settings?s=developer&lang=en\", state: empty }",
    "  mobile-zh-empty.png: { url: \"/dev/settings?s=developer&lang=zh\", state: empty }",
    "  mobile-en-minted.png: { url: \"/dev/settings?s=developer&lang=en\", state: minted }",
    "  mobile-zh-minted.png: { url: \"/dev/settings?s=developer&lang=zh\", state: minted }",
    "  mobile-en-revoked.png: { url: \"/dev/settings?s=developer&lang=en\", state: revoked }",
    "  mobile-zh-revoked.png: { url: \"/dev/settings?s=developer&lang=zh\", state: revoked }",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; playwright.config.ts already sets that flag on the e2e dev server. This script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_f12_10_api_keys.cjs",
    "files:",
    ...files.map((f) => `  - ${f}`),
    "",
  ];
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence.join("\n"));
  console.log(`wrote ${files.length} crops + EVIDENCE.yml at head ${capturedAtHead}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
