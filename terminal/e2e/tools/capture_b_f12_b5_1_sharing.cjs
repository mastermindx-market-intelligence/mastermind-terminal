#!/usr/bin/env node
/**
 * B-F12-B5-1 Sharing panel — dark evidence crops.
 *
 * Playwright against the real /dev/settings harness (mounts SettingsPanel /
 * SectionSharing). Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * Capture flag TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator.
 *
 * From terminal/:
 *   node e2e/tools/capture_b_f12_b5_1_sharing.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f12-b5-1-grants/.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f12-b5-1-grants");
const LAYOUT_FILES = [
  "terminal/components/settings/SectionSharing.tsx",
  "terminal/components/settings/SettingsPanel.tsx",
  "terminal/app/settings.css",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3532);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const OWNER_LIST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECEIVED_LIST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GRANTEE = "22222222-2222-4222-8222-222222222222";

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
      const res = await fetch(`${BASE}/dev/settings?s=sharing`, { redirect: "manual" });
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

async function mockApis(page, populated) {
  await page.route("**/api/grants", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    const body = populated
      ? {
          shared: [{
            id: "grant-made-0000-4000-8000-000000000001",
            resourceKind: "watchlist",
            resourceId: OWNER_LIST,
            resourceName: "Gold Miners",
            granteeUserId: GRANTEE,
            createdAt: "2026-09-09T00:00:00.000Z",
            revokedAt: null,
          }],
          sharedWithMe: [{
            id: "grant-got-0000-4000-8000-000000000002",
            resourceKind: "watchlist",
            resourceId: RECEIVED_LIST,
            resourceName: "Copper Names",
            grantedBy: "11111111-1111-4111-8111-111111111111",
            symbolCount: 2,
            createdAt: "2026-09-09T00:00:00.000Z",
          }],
        }
      : { shared: [], sharedWithMe: [] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/api/watchlist", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    const body = populated
      ? {
          lists: [{ id: OWNER_LIST, name: "Gold Miners", position: 0, symbols: [{ symbol: "NEM", section: "Miners", position: 0 }] }],
          sharedWithMe: [{
            id: RECEIVED_LIST,
            name: "Copper Names",
            sharedBy: "11111111-1111-4111-8111-111111111111",
            symbols: [
              { symbol: "FCX", section: "Miners", position: 0 },
              { symbol: "SCCO", section: "Miners", position: 1 },
            ],
          }],
        }
      : { lists: [{ id: OWNER_LIST, name: "Gold Miners", position: 0, symbols: [] }], sharedWithMe: [] };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function openSharing(page, lang, viewport, populated) {
  await page.setViewportSize(viewport);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
  }, lang);
  await mockApis(page, populated);
  await page.goto(`${BASE}/dev/settings?s=sharing&lang=${lang}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.locator(".acs-overlay.open .acs-card").waitFor({ state: "visible", timeout: 45_000 });
  const heading = lang === "zh" ? "共享" : "Sharing";
  await page.getByRole("heading", { name: heading }).waitFor({ state: "visible", timeout: 15_000 });
  if (populated) {
    const view = lang === "zh" ? "查看清单" : "View list";
    await page.getByRole("button", { name: view }).click();
    await page.getByText("FCX").waitFor({ state: "visible", timeout: 10_000 });
  } else {
    const emptyMine = lang === "zh" ? "您还没有向任何人共享清单。" : "You have not shared a list with anyone yet.";
    await page.getByText(emptyMine, { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
  }
  await stripDevOverlay(page);
}

async function measureLayout(page) {
  return page.evaluate(() => {
    const card = document.querySelector(".acs-card");
    const groups = Array.from(document.querySelectorAll(".acs-group"));
    const revoke = document.querySelector("button.acs-btn.ghost");
    const badge = document.querySelector(".acs-chip");
    const cardBox = card ? card.getBoundingClientRect() : null;
    return {
      cardWidth: cardBox ? Math.round(cardBox.width) : 0,
      groupCount: groups.length,
      revokeVisible: !!(revoke && getComputedStyle(revoke).display !== "none"),
      badgeText: badge ? (badge.textContent || "").trim() : "",
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
        { viewport: "desktop", lang: "en", populated: true, file: "desktop-en-shared.png" },
        { viewport: "desktop", lang: "zh", populated: true, file: "desktop-zh-shared.png" },
        { viewport: "desktop", lang: "en", populated: false, file: "desktop-en-empty.png" },
        { viewport: "desktop", lang: "zh", populated: false, file: "desktop-zh-empty.png" },
        { viewport: "mobile", lang: "en", populated: true, file: "mobile-en-shared.png" },
        { viewport: "mobile", lang: "zh", populated: true, file: "mobile-zh-shared.png" },
        { viewport: "mobile", lang: "en", populated: false, file: "mobile-en-empty.png" },
        { viewport: "mobile", lang: "zh", populated: false, file: "mobile-zh-empty.png" },
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
          await openSharing(page, shot.lang, VIEWPORTS[shot.viewport], shot.populated);
          const m = await measureLayout(page);
          measurements[shot.file] = m;
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
    "# B-F12-B5-1 Explicit grants — capture evidence",
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
    "harness: /dev/settings?s=sharing&lang=<en|zh>",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; playwright.config.ts already sets that flag on the e2e dev server. This script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_b_f12_b5_1_sharing.cjs",
    "files:",
    ...files.map((f) => `  - ${f}`),
    "measurements:",
    ...Object.entries(measurements).map(([file, m]) =>
      `  ${file}: { cardWidth: ${m.cardWidth}, groupCount: ${m.groupCount}, revokeVisible: ${m.revokeVisible}, badgeText: ${JSON.stringify(m.badgeText)} }`),
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
