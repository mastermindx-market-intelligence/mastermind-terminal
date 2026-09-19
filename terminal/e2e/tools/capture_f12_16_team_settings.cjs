#!/usr/bin/env node
/**
 * B-F12-16 Team settings block — dark evidence crops.
 *
 * Same method as B-F12-8 / B-F12-9: Playwright against the real /dev/settings harness
 * (mounts SettingsPanel / SectionTeam). Dark only
 * (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06). Capture flag
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_f12_16_team_settings.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f12-16-team-settings/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f12-16-team-settings");
// RAIL-CROP ROT LAW: every surface that paints the team-settings block is in the lock. This
// packet edited SectionTeam.tsx + SectionTeam.module.css (the block itself), types.ts and
// dev/settings/page.tsx (the fixtures), and lib/teams.ts (the catalogue + the lib the live path
// reads); SettingsPanel.tsx, SettingsProvider.tsx and settings.css are pinned even though this
// packet did not edit them — a layout drift there must turn the lock red.
const LAYOUT_FILES = [
  "terminal/components/settings/SectionTeam.tsx",
  "terminal/components/settings/SectionTeam.module.css",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/components/settings/SettingsProvider.tsx",
  "terminal/app/settings.css",
  "terminal/lib/teams.ts",
  "terminal/components/settings/types.ts",
  "terminal/app/dev/settings/page.tsx",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3546);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
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
      const res = await fetch(`${BASE}/dev/settings?s=team`, { redirect: "manual" });
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

async function openOwner(page, lang, viewport) {
  await page.setViewportSize(viewport);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await page.goto(`${BASE}/dev/settings?s=team&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.locator(".acs-overlay.open .acs-card").waitFor({ state: "visible", timeout: 45_000 });
  // The team-settings block is the last group on the team page — wait for it, then scroll it into
  // view so the crop depicts the controls, not the roster.
  const block = page.locator('[data-testid="team-settings"]');
  await block.waitFor({ state: "visible", timeout: 15_000 });
  await block.evaluate((el) => el.scrollIntoView({ block: "start", inline: "nearest" }));
  await page.waitForTimeout(200);
  await stripDevOverlay(page);
}

async function openMember(page, lang, viewport) {
  await page.setViewportSize(viewport);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await page.goto(`${BASE}/dev/settings?s=team&team=member&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.locator(".acs-overlay.open .acs-card").waitFor({ state: "visible", timeout: 45_000 });
  const block = page.locator('[data-testid="team-settings"]');
  await block.waitFor({ state: "visible", timeout: 15_000 });
  await block.evaluate((el) => el.scrollIntoView({ block: "start", inline: "nearest" }));
  await page.waitForTimeout(200);
  await stripDevOverlay(page);
}

async function measureLayout(page) {
  return page.evaluate(() => {
    const heading = document.querySelector('[data-testid="team-settings"]')?.closest(".acs-group")?.querySelector(".acs-group-t");
    const chartSelect = document.querySelector('[data-testid="team-settings-chart"]');
    const shareSwitch = document.querySelector('[data-testid="team-settings-share"]');
    const shareInput = shareSwitch?.querySelector('input[type="checkbox"]');
    const readOnly = document.querySelector('[data-testid="team-settings-readonly"]');
    const memberReadOnly = document.querySelector('[data-testid="team-settings-readonly-note"]');
    const chartCaption = document.querySelector('[data-testid="team-settings-chart-caption"]');
    const shareCaption = document.querySelector('[data-testid="team-settings-share-caption"]');
    return {
      headingTitle: (heading?.textContent || "").trim(),
      chartLabel: chartSelect
        ? ((chartSelect.options[chartSelect.selectedIndex]?.textContent || "").trim())
        : (readOnly?.textContent || "").trim(),
      shareLabel: shareCaption ? (shareCaption.textContent || "").trim() : "",
      shareControlPresent: !!shareSwitch,
      shareChecked: shareInput ? shareInput.checked : null,
      memberReadOnlyPresent: !!memberReadOnly,
      ownerWhatPresent: !!document.querySelector('.acs-row-desc'),
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
        { viewport: "desktop", lang: "en", kind: "owner", file: "desktop-en-owner.png" },
        { viewport: "desktop", lang: "zh", kind: "owner", file: "desktop-zh-owner.png" },
        { viewport: "desktop", lang: "en", kind: "member", file: "desktop-en-member.png" },
        { viewport: "desktop", lang: "zh", kind: "member", file: "desktop-zh-member.png" },
        { viewport: "mobile", lang: "en", kind: "owner", file: "mobile-en-owner.png" },
        { viewport: "mobile", lang: "zh", kind: "owner", file: "mobile-zh-owner.png" },
        { viewport: "mobile", lang: "en", kind: "member", file: "mobile-en-member.png" },
        { viewport: "mobile", lang: "zh", kind: "member", file: "mobile-zh-member.png" },
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
          if (shot.kind === "owner") {
            await openOwner(page, shot.lang, VIEWPORTS[shot.viewport]);
          } else {
            await openMember(page, shot.lang, VIEWPORTS[shot.viewport]);
          }
          const m = await measureLayout(page);
          measurements[shot.file] = m;
          if (!m.headingTitle) {
            throw new Error(`${shot.file}: heading is empty`);
          }
          if (!m.chartLabel) {
            throw new Error(`${shot.file}: chart-theme label is empty`);
          }
          if (shot.kind === "owner") {
            if (!m.shareControlPresent) {
              throw new Error(`${shot.file}: owner must show the share-layouts switch`);
            }
            if (!m.shareLabel) {
              throw new Error(`${shot.file}: share-layouts caption is empty`);
            }
            if (m.shareChecked !== true) {
              throw new Error(`${shot.file}: owner share checkbox must be checked (fixture sets it true), got ${m.shareChecked}`);
            }
            if (!m.ownerWhatPresent) {
              throw new Error(`${shot.file}: role-description rows missing`);
            }
          } else {
            if (m.shareControlPresent) {
              throw new Error(`${shot.file}: member must NOT show the share-layouts switch`);
            }
            if (!m.memberReadOnlyPresent) {
              throw new Error(`${shot.file}: member must show the read-only sentence`);
            }
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
    "# B-F12-16 Team settings block — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is informational. The lock is layoutFiles (hash-only).",
    "layoutFiles:",
    ...layoutFilesBlock(),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - { name: desktop, width: 1440, height: 900 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "harness: /dev/settings?s=team&lang=<en|zh> (owner crops with two controls painted); /dev/settings?s=team&team=member&lang=<en|zh> (member crops with read-only sentence + closed-default chart-theme label)",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; playwright.config.ts already sets that flag on the e2e dev server. This script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_f12_16_team_settings.cjs",
    "files:",
    ...files.map((f) => `  - ${f}`),
    "measurements:",
    ...Object.entries(measurements).map(([file, m]) =>
      `  ${file}: { headingTitle: ${JSON.stringify(m.headingTitle)},`
      + ` chartLabel: ${JSON.stringify(m.chartLabel)},`
      + ` shareLabel: ${JSON.stringify(m.shareLabel)},`
      + ` shareChecked: ${m.shareChecked === null ? "null" : m.shareChecked},`
      + ` memberReadOnlyPresent: ${Boolean(m.memberReadOnlyPresent)},`
      + ` ownerWhatPresent: ${Boolean(m.ownerWhatPresent)} }`),
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
