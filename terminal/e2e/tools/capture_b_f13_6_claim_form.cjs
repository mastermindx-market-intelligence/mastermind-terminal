#!/usr/bin/env node
/**
 * B-F13-6 Claim authoring form — dark evidence crops.
 *
 * Playwright against the real /analysis?view=theses harness. Dark only
 * (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06). Capture flag
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_b_f13_6_claim_form.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f13-6-claim-form/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f13-6-claim-form");
const LAYOUT_FILES = [
  "terminal/components/workspaces/ClaimAuthoringForm.tsx",
  "terminal/components/workspaces/ClaimAuthoringForm.module.css",
  "terminal/lib/claimAuthoring.ts",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3556);
const BASE = `http://127.0.0.1:${PORT}`;
const SYM = "NVDA";
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
const SHOTS = [
  { viewport: "desktop", lang: "en", filled: false, file: "desktop-en-empty.png" },
  { viewport: "desktop", lang: "zh", filled: false, file: "desktop-zh-empty.png" },
  { viewport: "desktop", lang: "en", filled: true, file: "desktop-en-filled.png" },
  { viewport: "desktop", lang: "zh", filled: true, file: "desktop-zh-filled.png" },
  { viewport: "mobile", lang: "en", filled: false, file: "mobile-en-empty.png" },
  { viewport: "mobile", lang: "zh", filled: false, file: "mobile-zh-empty.png" },
  { viewport: "mobile", lang: "en", filled: true, file: "mobile-en-filled.png" },
  { viewport: "mobile", lang: "zh", filled: true, file: "mobile-zh-filled.png" },
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

function utcTomorrow() {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1))
    .toISOString()
    .slice(0, 10);
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
      const res = await fetch(`${BASE}/analysis?view=theses&symbol=${SYM}`, { redirect: "manual" });
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

async function openWorkspace(page, lang, viewport) {
  await page.setViewportSize(viewport);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await page.goto(`${BASE}/analysis?view=theses&symbol=${SYM}&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.getByTestId("thesis-workspace").waitFor({ state: "visible", timeout: 45_000 });
  const btn = page.getByTestId("claim-entry-button");
  await btn.waitFor({ state: "visible", timeout: 45_000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="claim-entry-button"]');
    return !!(el && !el.disabled);
  }, null, { timeout: 45_000 });
  await btn.click();
  await page.getByTestId("claim-authoring-form").waitFor({ state: "visible", timeout: 15_000 });
  await stripDevOverlay(page);
}

async function fillForm(page, lang) {
  const form = page.getByTestId("claim-authoring-form");
  const cmpLabel = lang === "zh" ? "方向" : "Direction";
  await form.getByLabel(cmpLabel).selectOption({ index: 1 });
  const levelLabel = lang === "zh" ? "数值" : "Level";
  await form.getByLabel(levelLabel).fill("150");
  const dateLabel = lang === "zh" ? "结算日期" : "Settles on";
  await form.getByLabel(dateLabel).fill(utcTomorrow());
  const toggle = lang === "zh" ? "我也想说明我的把握程度" : "I also want to state how sure I am";
  await form.getByText(toggle, { exact: true }).click();
  await form.locator('input[type="range"]').waitFor({ state: "visible", timeout: 5_000 });
  const noteLabel = lang === "zh" ? "添加备注（可选）" : "Add a note (optional)";
  await form.getByLabel(noteLabel).fill(lang === "zh" ? "若需求维持。" : "If demand holds.");
}

async function shoot(page, file) {
  await assertNoNextIndicator(page, file);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  const dialog = page.getByTestId("claim-authoring-form");
  await dialog.screenshot({ path: join(OUT, file) });
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
          await openWorkspace(page, shot.lang, VIEWPORTS[shot.viewport]);
          if (shot.filled) await fillForm(page, shot.lang);
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
    "# B-F13-6 Claim authoring form — capture evidence",
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
    ...SHOTS.map((s) => `  ${s.file}: { url: "/analysis?view=theses&symbol=${SYM}&lang=${s.lang}", state: ${s.filled ? "filled" : "empty"} }`),
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; playwright.config.ts already sets that flag on the e2e dev server. This script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_b_f13_6_claim_form.cjs",
    "files:",
    ...SHOTS.map((s) => `  - ${s.file}`),
  ];
  writeFileSync(join(OUT, "EVIDENCE.yml"), `${evidence.join("\n")}\n`);
  console.log(`wrote ${files.length} crops + EVIDENCE.yml at ${capturedAtHead}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
