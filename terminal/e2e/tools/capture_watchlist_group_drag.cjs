#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Watchlist grouped-drag visual evidence.
 *
 * Captures the real Terminal rail while a discontiguous AAPL + NVDA selection is
 * held over AMD, plus the intentional small-screen contract where the desktop
 * watchlist board is absent and the responsive shell remains contained.
 *
 * From terminal/:
 *   node e2e/tools/capture_watchlist_group_drag.cjs
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "watchlist-group-drag-20260918");
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3568);
const BASE = `http://127.0.0.1:${PORT}`;
const LAYOUT_FILES = [
  "terminal/components/TerminalShell.tsx",
  "terminal/app/globals.css",
  "terminal/lib/watchlistSections.ts",
  "terminal/lib/i18n.tsx",
];
const SEED = {
  lists: {
    Default: [],
    "Bundle Proof": [
      { symbol: "AAPL", section: "Core" },
      { symbol: "MSFT", section: "Core" },
      { symbol: "NVDA", section: "Growth" },
      { symbol: "AMD", section: "Growth" },
    ],
  },
  active: "Bundle Proof",
  meta: {
    Default: { sections: [], collapsed: [] },
    "Bundle Proof": { sections: ["Core", "Growth", "Archive"], collapsed: [] },
  },
};
const SHOTS = [
  { file: "desktop-dark-en-drag.png", width: 1440, height: 900, lang: "en", theme: "dark", mode: "drag" },
  { file: "desktop-light-en-drag.png", width: 1440, height: 900, lang: "en", theme: "light", mode: "drag" },
  { file: "desktop-dark-zh-drag.png", width: 1440, height: 900, lang: "zh", theme: "dark", mode: "drag" },
  { file: "tablet-dark-en-shell.png", width: 820, height: 1180, lang: "en", theme: "dark", mode: "responsive" },
  { file: "mobile-dark-zh-shell.png", width: 390, height: 844, lang: "zh", theme: "dark", mode: "responsive" },
];

mkdirSync(OUT, { recursive: true });

function gitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
}

function sha256(rel) {
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
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-key",
  };
  const child = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(PORT)], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout.on("data", (buffer) => {
    const line = String(buffer);
    if (/Ready|compiled|error|Error/i.test(line)) process.stdout.write(`[dev] ${line}`);
  });
  child.stderr.on("data", (buffer) => process.stderr.write(`[dev:err] ${buffer}`));
  return child;
}

function stopServer(child) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); }
  catch { try { child.kill("SIGTERM"); } catch { /* already stopped */ } }
}

async function waitForServer(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "not tried";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/terminal?symbol=AAPL`, { redirect: "manual" });
      last = String(response.status);
      if (response.status >= 200 && response.status < 500) return;
    } catch (error) {
      last = error?.cause?.code || error?.message || String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`dev server on ${PORT} never answered (${last})`);
}

async function stripDevOverlay(page) {
  await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((node) => node.remove()));
}

async function prepare(page, shot) {
  const storeKey = `capture-${shot.file.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const owner = `account:e2e-user-${storeKey}`;
  await page.context().addCookies([{ name: "mm_e2e_wl", value: storeKey, url: BASE }]);
  await page.addInitScript(({ ownerKey, state, lang, theme }) => {
    localStorage.setItem("mm.wls.v2", JSON.stringify({ [ownerKey]: state }));
    localStorage.setItem("mm.lang", lang);
    localStorage.setItem("theme", theme);
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-lang", lang);
    document.documentElement.setAttribute("lang", lang === "zh" ? "zh-CN" : "en");
  }, { ownerKey: owner, state: SEED, lang: shot.lang, theme: shot.theme });
  await page.goto(`${BASE}/terminal?symbol=AAPL`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator(".chart-body").waitFor({ state: "visible", timeout: 60_000 });
  await stripDevOverlay(page);
}

async function liftBundle(page) {
  const row = (symbol) => page.locator(`[data-watchlist-symbol="${symbol}"]`);
  await page.locator(".wl-select").waitFor({ state: "visible", timeout: 60_000 });
  await page.locator(".wl-select").filter({ hasText: "Bundle Proof" }).waitFor({ state: "visible", timeout: 60_000 });
  await page.locator(".wl-row").first().waitFor({ state: "visible", timeout: 60_000 });
  if (await page.locator(".wl-row").count() !== 4) throw new Error("Bundle Proof did not hydrate with four seeded rows");
  await row("AAPL").click({ modifiers: ["ControlOrMeta"] });
  await row("NVDA").click({ modifiers: ["ControlOrMeta"] });
  await page.locator("[data-testid='watchlist-selection-count']").waitFor({ state: "visible" });

  const source = row("AAPL");
  const target = row("AMD");
  const from = await source.boundingBox();
  if (!from) throw new Error("AAPL source row has no geometry");
  const visibleLeft = Math.max(0, from.x);
  const visibleRight = Math.min(await page.evaluate(() => innerWidth), from.x + from.width);
  const sourceX = visibleLeft + (visibleRight - visibleLeft) / 2;
  await page.mouse.move(sourceX, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceX, from.y + from.height / 2 + 9, { steps: 3 });
  await source.waitFor({ state: "visible" });
  await page.locator('[data-watchlist-drag-group="true"]').waitFor({ state: "visible", timeout: 10_000 });

  const to = await target.boundingBox();
  if (!to) throw new Error("AMD target row has no geometry");
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.8, { steps: 12 });
  await page.waitForTimeout(150);
  const settled = await target.boundingBox();
  if (!settled) throw new Error("AMD target row lost geometry");
  await page.mouse.move(settled.x + settled.width / 2, settled.y + settled.height * 0.8, { steps: 4 });
  await target.locator('.wl-drop-marker[data-watchlist-drop-edge="after"]').waitFor({ state: "visible", timeout: 10_000 });

  return page.evaluate(() => {
    const bundle = document.querySelector('[data-watchlist-drag-group="true"]');
    const marker = document.querySelector('.wl-drop-marker[data-watchlist-drop-edge="after"]');
    const rect = bundle?.getBoundingClientRect();
    return {
      bundleCount: bundle?.getAttribute("data-watchlist-drag-count") || "",
      symbols: [...document.querySelectorAll("[data-watchlist-drag-symbol]")]
        .map((node) => node.getAttribute("data-watchlist-drag-symbol") || "").join(" | "),
      markerEdge: marker?.getAttribute("data-watchlist-drop-edge") || "",
      markerText: marker?.textContent?.trim() || "",
      ghostRows: document.querySelectorAll(".wl-row.group-dragging").length,
      bundleWidth: rect ? Math.round(rect.width) : 0,
      bundleHeight: rect ? Math.round(rect.height) : 0,
      overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
}

async function responsiveMeasurement(page) {
  return page.evaluate(() => ({
    watchlistVisible: !!document.querySelector(".wl-board") && getComputedStyle(document.querySelector(".wl-board")).display !== "none",
    overflowX: document.documentElement.scrollWidth > innerWidth + 1,
    viewport: `${innerWidth}x${innerHeight}`,
  }));
}

function yamlInline(measurement) {
  return `{ ${Object.entries(measurement).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ")} }`;
}

async function main() {
  const capturedAtHead = gitHead();
  const child = startServer();
  const measurements = {};
  try {
    await waitForServer();
    const browser = await chromium.launch({ headless: true });
    try {
      for (const shot of SHOTS) {
        process.stdout.write(`capture ${shot.file} … `);
        const context = await browser.newContext({
          viewport: { width: shot.width, height: shot.height },
          hasTouch: shot.width <= 860,
          colorScheme: shot.theme,
          locale: shot.lang === "zh" ? "zh-CN" : "en-US",
        });
        const page = await context.newPage();
        page.setDefaultTimeout(45_000);
        try {
          await prepare(page, shot);
          if (shot.mode === "drag") measurements[shot.file] = await liftBundle(page);
          else measurements[shot.file] = await responsiveMeasurement(page);
          await stripDevOverlay(page);
          await page.screenshot({ path: join(OUT, shot.file), fullPage: false });
          if (shot.mode === "drag") await page.mouse.up();
          console.log("ok");
        } catch (error) {
          console.log(`FAIL ${error?.message || error}`);
          try { await page.screenshot({ path: join(OUT, `FAIL-${shot.file}`), fullPage: false }); } catch { /* ignore */ }
          throw error;
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

  const lines = [
    "# Terminal watchlist grouped drag — visual evidence",
    `capturedAtHead: ${capturedAtHead}`,
    `capturedAt: ${new Date().toISOString()}`,
    "layoutFiles:",
    ...LAYOUT_FILES.map((rel) => `  ${rel}: "${sha256(rel)}"`),
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "command: node terminal/e2e/tools/capture_watchlist_group_drag.cjs",
    "interaction: Ctrl/Cmd-select AAPL and NVDA; drag AAPL; hold bundle after AMD",
    "responsive_contract: The desktop watchlist board is intentionally hidden at widths <=860px; tablet/mobile captures prove containment without claiming drag availability.",
    "files:",
    ...SHOTS.map((shot) => `  - ${shot.file}`),
    "measurements:",
    ...SHOTS.map((shot) => `  ${shot.file}: ${yamlInline(measurements[shot.file])}`),
    "",
  ];
  writeFileSync(join(OUT, "EVIDENCE.yml"), lines.join("\n"));
  console.log(`wrote ${join(OUT, "EVIDENCE.yml")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
