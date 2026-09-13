#!/usr/bin/env node
/**
 * B-F12-B5-2 team-shared workspaces — dark evidence crops.
 *
 * Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * Capture flag TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_f12_b5_2_team_workspaces.cjs
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f12-b5-2-team-workspaces");
const LAYOUT_FILES = [
  "terminal/components/LayoutMenu.tsx",
  "terminal/lib/teamSharedWorkflow.ts",
  "terminal/lib/i18n.tsx",
  "terminal/app/dev/workspaces/page.tsx",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3544);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
const STATES = ["team-grouped", "share-confirm", "member-read-only"];
const LANGS = ["en", "zh"];

mkdirSync(OUT, { recursive: true });

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
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
  try { process.kill(-child.pid, "SIGTERM"); } catch {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
  }
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "not tried";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/dev/workspaces?lang=en&state=team-grouped`, { redirect: "manual" });
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
  if (n > 0) throw new Error(`${file}: Next.js N overlay still mounted (${n}); TERMINAL_E2E_FIXTURE gate failed`);
}

async function measure(page) {
  return page.evaluate(() => {
    const teamHd = document.querySelector('[data-ws-group-hd="team"]');
    const mineHd = document.querySelector('[data-ws-group-hd="mine"]');
    const share = document.querySelector('[data-ws-act="share"]');
    const rename = document.querySelector('[data-ws-act="rename"]');
    const del = document.querySelector('[data-ws-act="delete"]');
    const confirm = document.querySelector("[data-ws-share-confirm]");
    const readonly = document.querySelector("[data-ws-readonly-note]");
    return {
      teamHeading: teamHd ? teamHd.textContent : "",
      mineHeading: mineHd ? mineHd.textContent : "",
      sharePresent: !!share,
      renamePresent: !!rename,
      deletePresent: !!del,
      confirmPresent: !!confirm,
      readonlyPresent: !!readonly,
    };
  });
}

async function main() {
  const child = startServer();
  const browser = await chromium.launch({ headless: true });
  const measurements = {};
  const files = [];
  try {
    await waitForServer(90_000);
    const page = await browser.newPage();
    for (const viewportName of Object.keys(VIEWPORTS)) {
      const viewport = VIEWPORTS[viewportName];
      await page.setViewportSize(viewport);
      for (const lang of LANGS) {
        for (const state of STATES) {
          const file = `${viewportName}-${lang}-${state}.png`;
          await page.goto(`${BASE}/dev/workspaces?lang=${lang}&state=${state}`, { waitUntil: "networkidle" });
          await page.waitForSelector("[data-ws-harness]");
          if (state === "member-read-only") {
            const more = page.locator('[data-ws-sharing="team"] [data-ws-more]').first();
            if (await more.count()) await more.click();
          }
          if (state === "team-grouped") {
            const more = page.locator('[data-ws-sharing="private"] [data-ws-more]').first();
            if (await more.count()) await more.click();
          }
          await assertNoNextIndicator(page, file);
          await page.screenshot({ path: join(OUT, file) });
          measurements[file] = await measure(page);
          files.push(file);
          console.log("wrote", file);
        }
      }
    }
    await browser.close();
  } finally {
    stopServer(child);
  }

  const head = currentGitHead();
  const layoutFiles = LAYOUT_FILES.map((rel) => `  ${rel}: "${sha256File(rel)}"`).join("\n");
  const measYaml = Object.entries(measurements).map(([file, m]) => {
    return `  ${file}: { teamHeading: ${JSON.stringify(m.teamHeading)}, mineHeading: ${JSON.stringify(m.mineHeading)}, sharePresent: ${m.sharePresent}, renamePresent: ${m.renamePresent}, deletePresent: ${m.deletePresent}, confirmPresent: ${m.confirmPresent}, readonlyPresent: ${m.readonlyPresent} }`;
  }).join("\n");
  const yml = `# B-F12-B5-2 team-shared workspaces — capture evidence
# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06
# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR
# capturedAtHead: ${head}
# capturedAt: ${new Date().toISOString()}
# capturedAtHead is informational until the code commit that the pixels depict is known.
# Rebuild crops after that commit and set capturedAtHead to it. The lock is layoutFiles.
layoutFiles:
${layoutFiles}
theme: dark
languages: [en, zh]
viewports:
  - { name: desktop, width: 1440, height: 900 }
  - { name: mobile, width: 390, height: 844 }
harness: /dev/workspaces?lang=<en|zh>&state=<team-grouped|share-confirm|member-read-only>
capture_flag: TERMINAL_E2E_FIXTURE
capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set.
command: |
  cd terminal
  node e2e/tools/capture_f12_b5_2_team_workspaces.cjs
files:
${files.map((f) => `  - ${f}`).join("\n")}
measurements:
${measYaml}
`;
  writeFileSync(join(OUT, "EVIDENCE.yml"), yml);
  console.log("wrote EVIDENCE.yml at", head);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
