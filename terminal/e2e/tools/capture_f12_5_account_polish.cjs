#!/usr/bin/env node
/**
 * B-F12-5 Account page polish — dark evidence crops.
 *
 * Same method as B-F12-4 (commit 8a6aee4e / b0eae58d): Playwright against the
 * real /dev/settings harness (mounts SettingsPanel / SectionAccount). Dark only
 * (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06). Capture flag
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_f12_5_account_polish.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f12-5-account-polish/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f12-5-account-polish");
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3531);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

mkdirSync(OUT, { recursive: true });

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
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
      const res = await fetch(`${BASE}/dev/settings?s=account`, { redirect: "manual" });
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

async function openAccount(page, lang, viewport) {
  await page.setViewportSize(viewport);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await page.goto(`${BASE}/dev/settings?s=account&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.locator(".acs-overlay.open .acs-card").waitFor({ state: "visible", timeout: 45_000 });
  await page.locator(".acs-id-name").waitFor({ state: "visible", timeout: 15_000 });
  // LEX acsData is "Your data" / "你的数据"; CSS text-transform:uppercase paints YOUR DATA.
  const dataLabel = lang === "zh" ? "你的数据" : "Your data";
  await page.getByText(dataLabel, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await stripDevOverlay(page);
}

async function measureLayout(page) {
  return page.evaluate(() => {
    const span = document.querySelector(".acs-span2");
    const grid = document.querySelector(".acs-grid");
    const confirm = document.querySelector(".acs-form button.acs-btn.btn-danger");
    const signOut = document.querySelector("button.acs-signout-m");
    const profile = document.querySelector(".acs-grid > .acs-group");
    const spanBox = span ? span.getBoundingClientRect() : null;
    const gridBox = grid ? grid.getBoundingClientRect() : null;
    const profileBox = profile ? profile.getBoundingClientRect() : null;
    const confirmCs = confirm ? getComputedStyle(confirm) : null;
    const signCs = signOut && getComputedStyle(signOut).display !== "none" ? getComputedStyle(signOut) : null;
    return {
      spanWidth: spanBox ? Math.round(spanBox.width) : 0,
      gridWidth: gridBox ? Math.round(gridBox.width) : 0,
      profileWidth: profileBox ? Math.round(profileBox.width) : 0,
      confirmClass: confirm ? confirm.className : "",
      confirmBg: confirmCs ? confirmCs.backgroundColor : "",
      confirmText: confirm ? (confirm.textContent || "").trim() : "",
      signOutClass: signOut ? signOut.className : "",
      signOutColor: signCs ? signCs.color : "",
      signOutDisplay: signOut ? getComputedStyle(signOut).display : "",
    };
  });
}

async function shoot(page, file) {
  await assertNoNextIndicator(page, file);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(120);
  const overlay = page.locator(".acs-overlay.open");
  await overlay.screenshot({ path: join(OUT, file) });
}

async function openDeleteForm(page, lang) {
  const label = lang === "zh" ? "删除" : "Delete";
  const btn = page.locator("button.acs-edit", { hasText: label }).last();
  await btn.click();
  const confirmLabel = lang === "zh" ? "删除我的账户" : "Delete my account";
  await page.locator(".acs-form button.acs-btn.btn-danger", { hasText: confirmLabel }).waitFor({
    state: "visible",
    timeout: 10_000,
  });
}

async function main() {
  const capturedAtHead = currentGitHead();
  const child = startServer();
  const files = [];
  const measurements = {};
  try {
    await waitForServer(180_000);
    const browser = await chromium.launch({ headless: true });
    try {
      const shots = [
        { viewport: "desktop", lang: "en", form: false, file: "desktop-en-overview.png" },
        { viewport: "desktop", lang: "zh", form: false, file: "desktop-zh-overview.png" },
        { viewport: "desktop", lang: "en", form: true, file: "desktop-en-delete-form.png" },
        { viewport: "desktop", lang: "zh", form: true, file: "desktop-zh-delete-form.png" },
        { viewport: "mobile", lang: "en", form: false, file: "mobile-en-overview.png" },
        { viewport: "mobile", lang: "zh", form: false, file: "mobile-zh-overview.png" },
        { viewport: "mobile", lang: "en", form: true, file: "mobile-en-delete-form.png" },
        { viewport: "mobile", lang: "zh", form: true, file: "mobile-zh-delete-form.png" },
      ];
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
          await openAccount(page, shot.lang, VIEWPORTS[shot.viewport]);
          if (shot.form) {
            await openDeleteForm(page, shot.lang);
            await page.locator(".acs-row.editing > .acs-form").scrollIntoViewIfNeeded();
            if (shot.viewport === "mobile") {
              await page.locator("button.acs-signout-m").scrollIntoViewIfNeeded();
            }
            await page.waitForTimeout(200);
          }
          const m = await measureLayout(page);
          measurements[shot.file] = m;
          if (shot.viewport === "desktop") {
            if (!m.spanWidth || m.spanWidth < m.profileWidth * 1.5) {
              throw new Error(`${shot.file}: YOUR DATA did not span the grid (span=${m.spanWidth} profile=${m.profileWidth} grid=${m.gridWidth})`);
            }
          }
          if (shot.form) {
            if (!/\bbtn-danger\b/.test(m.confirmClass)) {
              throw new Error(`${shot.file}: delete confirm class is ${m.confirmClass}, expected btn-danger`);
            }
            if (m.confirmBg === "rgb(41, 98, 255)" || m.confirmBg === "rgb(77, 130, 255)") {
              throw new Error(`${shot.file}: delete confirm still brand blue (${m.confirmBg})`);
            }
          }
          if (shot.viewport === "mobile" && !/\bghost\b/.test(m.signOutClass)) {
            throw new Error(`${shot.file}: Sign out class is ${m.signOutClass}, expected acs-btn ghost`);
          }
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
    "# B-F12-5 Account page polish — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - { name: desktop, width: 1440, height: 900 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "harness: /dev/settings?s=account&lang=<en|zh>",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; playwright.config.ts already sets that flag on the e2e dev server. This script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_f12_5_account_polish.cjs",
    "files:",
    ...files.map((f) => `  - ${f}`),
    "measurements:",
    ...Object.entries(measurements).map(([file, m]) =>
      `  ${file}: { spanWidth: ${m.spanWidth}, gridWidth: ${m.gridWidth}, profileWidth: ${m.profileWidth}, confirmClass: ${JSON.stringify(m.confirmClass)}, confirmBg: ${JSON.stringify(m.confirmBg)}, signOutClass: ${JSON.stringify(m.signOutClass)}, signOutColor: ${JSON.stringify(m.signOutColor)} }`),
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
