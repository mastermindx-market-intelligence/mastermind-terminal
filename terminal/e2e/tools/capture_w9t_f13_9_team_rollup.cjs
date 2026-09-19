#!/usr/bin/env node
/**
 * W9T_F13_9 / MO-DELTA-007 — Team-accuracy rollup dark evidence crops.
 *
 * A team can see its own calls scored together — never a ranking against other
 * teams. This script crops the four rollup states (ok / no_rows / empty_members
 * / hidden-when-no-team) at 1440 and 390 in EN and ZH, with the dark-only shell
 * (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06) and the
 * TERMINAL_E2E_FIXTURE flag on (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_w9t_f13_9_team_rollup.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/w9t_f13_9-team-rollup-no-rank/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "w9t_f13_9-team-rollup-no-rank");
const LAYOUT_FILES = [
  "terminal/app/api/teams/[id]/accuracy/rollup/route.ts",
  "terminal/app/dev/settings/page.tsx",
  "terminal/app/dev/settings/teamRollupFixtures.ts",
  "terminal/components/settings/SectionAccuracy.tsx",
  "terminal/components/settings/SectionAccuracy.module.css",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/lib/i18n.tsx",
  "terminal/lib/personalAccuracyStore.ts",
  "terminal/lib/teamRollup.ts",
  "terminal/lib/__tests__/teamRollup.test.ts",
  "terminal/lib/__tests__/teamAccuracyRollupRoute.test.ts",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3548);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
const SHOTS = [
  // The team's row set scored together — the headline crop.
  { viewport: "desktop", lang: "en", rollup: "ok", file: "desktop-en-ok.png" },
  { viewport: "desktop", lang: "zh", rollup: "ok", file: "desktop-zh-ok.png" },
  // Team has members but no one has written a call down.
  { viewport: "desktop", lang: "en", rollup: "no_rows", file: "desktop-en-no-rows.png" },
  { viewport: "desktop", lang: "zh", rollup: "no_rows", file: "desktop-zh-no-rows.png" },
  // Team has no members at all (rare in practice but pinned for completeness).
  { viewport: "desktop", lang: "en", rollup: "empty_members", file: "desktop-en-empty-members.png" },
  { viewport: "desktop", lang: "zh", rollup: "empty_members", file: "desktop-zh-empty-members.png" },
  // Mobile, 390 — same states, narrow column.
  { viewport: "mobile", lang: "en", rollup: "ok", file: "mobile-en-ok.png" },
  { viewport: "mobile", lang: "zh", rollup: "ok", file: "mobile-zh-ok.png" },
  { viewport: "mobile", lang: "en", rollup: "no_rows", file: "mobile-en-no-rows.png" },
  { viewport: "mobile", lang: "zh", rollup: "no_rows", file: "mobile-zh-no-rows.png" },
  { viewport: "mobile", lang: "en", rollup: "empty_members", file: "mobile-en-empty-members.png" },
  { viewport: "mobile", lang: "zh", rollup: "empty_members", file: "mobile-zh-empty-members.png" },
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
      const res = await fetch(`${BASE}/dev/settings?s=accuracy`, { redirect: "manual" });
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

async function openRollup(page, lang, viewport, rollup) {
  await page.setViewportSize(viewport);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await page.goto(`${BASE}/dev/settings?s=accuracy&lang=${lang}&acc=populated&rollup=${rollup}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.locator(".acs-overlay.open .acs-card").waitFor({ state: "visible", timeout: 45_000 });
  const title = lang === "zh" ? "你的判断，逐条核对。" : "Your calls, checked.";
  await page.getByRole("heading", { name: title, exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await stripDevOverlay(page);
  // Laser sweep is 0.9s; wait it out so crops are not a mid-animation smear.
  await page.waitForTimeout(1100);
  await stripDevOverlay(page);
}

async function shoot(page, file) {
  await assertNoNextIndicator(page, file);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(200);
  const overlay = page.locator(".acs-overlay.open");
  await overlay.screenshot({ path: join(OUT, file) });
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
          await openRollup(page, shot.lang, VIEWPORTS[shot.viewport], shot.rollup);
          // Wait for the rollup block to settle on the expected state.
          await page.locator(`[data-acc-team-state="${shot.rollup}"]`).waitFor({ state: "visible", timeout: 10_000 });
          await page.locator("[data-acc-team-gate]").waitFor({ state: "visible", timeout: 10_000 });
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
    "# W9T_F13_9 / MO-DELTA-007 — your team sees its own calls scored together, never a ranking against other teams",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is the code commit the pixels depict. The lock is layoutFiles.",
    "# Seat ruling: \"Team sees its own scores; never a cross-team rank (hard gate, test pinned).\" Every crop depicts the rollup block the hard gate is rendered into. The ceiling sentence at the bottom of every block is the gate in plain words.",
    "layoutFiles:",
    ...layoutFilesBlock(),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - { name: desktop, width: 1440, height: 900 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "harness:",
    ...SHOTS.map((s) => `  ${s.file}: { url: "/dev/settings?s=accuracy&lang=${s.lang}&acc=populated&rollup=${s.rollup}", fixture: rollup-${s.rollup} }`),
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; playwright.config.ts already sets that flag on the e2e dev server. This script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_w9t_f13_9_team_rollup.cjs",
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
