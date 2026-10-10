#!/usr/bin/env node
/**
 * B-PL-6 batch 2 — dark evidence crops for GuidePanel, LevelsView,
 * LevelsLearn, and ChartConductor's live-steps toggle.
 *
 * Same method as B-PL-6 batch 1: Playwright against a fixture next-dev
 * server. Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator
 * (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * ChartConductor: /dev/theater plays its 7-step demo one op per PACE_MS on
 * page timers, so a fixed wait crops whichever step is current. The capture
 * pauses Playwright's page clock before Play and advances it one PACE_MS per
 * step, then crops CONDUCTOR_STEP (2, the first trendline, whose rail row
 * carries the fit chip). Every crop is taken with animations disabled so CSS
 * animations render at a fixed frame.
 *
 * GuidePanel: the page prefers reduced motion, so the Trend Engine proof shows
 * its static complete frame and the module rail scrolls into place instantly.
 * The live terminal behind the panel is hidden for the screenshot.
 *
 * Chromium runs with partial raster disabled. By default it re-rasters only the
 * invalidated part of a tile, so anti-aliased edges depend on how the tile was
 * painted before, and the LevelsView-1440 chip corners varied by load.
 *
 * From terminal/:
 *   node e2e/tools/capture_pl6_batch2.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-pl-6-batch-2/. A failed
 * capture writes FAIL-<crop>.png and leaves EVIDENCE.yml unchanged.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-pl-6-batch-2");
const LAYOUT_FILES = [
  "terminal/components/GuidePanel.tsx",
  "terminal/components/levels/LevelsView.tsx",
  "terminal/components/levels/LevelsLearn.tsx",
  "terminal/components/ChartConductor.tsx",
  "terminal/lib/plainLabels.ts",
  "terminal/lib/i18n.tsx",
];
const ONLY = (process.env.CAPTURE_ONLY || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3537);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  390: { width: 390, height: 844 },
};
// The demo's pace, read from the source so a retune moves the capture with it.
const PACE_MS = (() => {
  const src = readFileSync(join(ROOT, "lib", "conductorState.ts"), "utf8");
  const match = src.match(/export const PACE_MS\s*=\s*(\d+)/);
  if (!match) throw new Error("lib/conductorState.ts no longer exports PACE_MS = <ms>");
  return Number(match[1]);
})();
// Step 2 of 7 is the first draw.trendline: its rail row carries the fit chip
// (ChartConductor.tsx .fit), the zh evidence for that chip's localization.
const CONDUCTOR_STEP = 2;
// The guide panel is not fully opaque and its scrim blurs the live terminal
// (ticker, quotes), so everything outside the scrim is hidden for its crops.
const GUIDE_SCREENSHOT_STYLE =
  "body *:not(.gp-scrim, .gp-scrim *) { visibility: hidden !important; } .gp-scrim { visibility: visible !important; }";
// A partially re-rastered tile keeps the old pixels outside the invalidated rect,
// so the same page can screenshot two ways. Whole-tile raster gives one.
const BROWSER_ARGS = ["--disable-partial-raster"];

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

function cropName(surface, width, lang) {
  return `${surface}-${width}${lang === "zh" ? "-zh" : ""}.png`;
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
      const res = await fetch(`${BASE}/terminal?symbol=SPY`, { redirect: "manual" });
      last = String(res.status);
      if (res.status >= 200 && res.status < 500) return;
    } catch (err) {
      last = err.cause?.code || err.message;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`dev server on ${PORT} never answered (${last})`);
}

async function newPage(browser, width, lang) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[width],
    hasTouch: width === 390,
    locale: lang === "zh" ? "zh-CN" : "en-US",
    colorScheme: "dark",
  });
  await context.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
  }, lang);
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  return { context, page };
}

async function ensureLang(page, lang) {
  await page.evaluate((l) => {
    localStorage.setItem("mm.lang", l);
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
    document.documentElement.setAttribute("lang", l === "zh" ? "zh-CN" : "en");
    window.dispatchEvent(new CustomEvent("mm:lang"));
  }, lang);
}

async function gotoReady(page, path, lang) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await ensureLang(page, lang);
  await page.waitForTimeout(400);
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

async function cropBox(page, box, outPath, pad, style) {
  const vp = page.viewportSize();
  if (!box || !vp) throw new Error(`no box for ${outPath}`);
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  const width = Math.max(8, Math.min(vp.width - x, Math.ceil(box.width + pad * 2)));
  const height = Math.max(8, Math.min(vp.height - y, Math.ceil(box.height + pad * 2)));
  // Finite CSS animations render at their end state, infinite ones at their start.
  // A style sheet applies to this screenshot only.
  await page.screenshot({
    path: outPath,
    clip: { x, y, width, height },
    animations: "disabled",
    ...(style ? { style } : {}),
  });
}

async function cropLocator(page, locator, outPath, pad = 18, style) {
  const fresh = locator.first();
  await fresh.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(250);
  const box = await fresh.boundingBox();
  if (!box) throw new Error(`no bounding box for ${outPath}`);
  await cropBox(page, box, outPath, pad, style);
}

// A click on server-rendered markup before React hydrates it is silently lost.
async function waitForHydration(page, selector, text) {
  await page.waitForFunction(([sel, txt]) => {
    const el = [...document.querySelectorAll(sel)].find((node) => txt === null || node.textContent === txt);
    return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$"));
  }, [selector, text === undefined ? null : text], { timeout: 60_000 });
}

async function openIndicatorLibrary(page, width) {
  if (width === 390) {
    await waitForHydration(page, '[data-testid="roller-more"]');
    await page.getByTestId("roller-more").click();
    await page.getByTestId("hub-tile-indicators").click();
    return;
  }
  const trigger = page.locator(".indicator-library-trigger");
  await trigger.waitFor({ state: "visible", timeout: 20_000 });
  await waitForHydration(page, ".indicator-library-trigger");
  await trigger.click();
}

async function captureGuidePanel(page, width, lang, outPath) {
  // With full motion the panel scrolls its module rail smoothly and the proof
  // animates for 7.6 s, both on the frame clock, so 390 crops vary by load.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoReady(page, "/terminal?symbol=NVDA", lang);
  await page.locator(".workspace").waitFor({ state: "visible", timeout: 60_000 });
  await openIndicatorLibrary(page, width);
  const library = page.locator(".imodal-library");
  // The library is next/dynamic, so a cold dev server compiles it on first open.
  await library.waitFor({ state: "visible", timeout: 60_000 });
  const guideBtn = library.getByRole("button", { name: /Guide: Trend Engine|指南: Trend Engine/ });
  await guideBtn.waitFor({ state: "visible", timeout: 20_000 });
  await guideBtn.click();
  const guide = page.locator(".gp-center");
  await guide.waitFor({ state: "visible", timeout: 20_000 });
  const needle = lang === "zh" ? "指标学院" : "Indicator Academy";
  await guide.getByText(needle).first().waitFor({ state: "visible", timeout: 15_000 });
  // The header also renders over the loading skeleton; the article title does not.
  await guide.locator("article.gp-article h1#guide-center-title").waitFor({ state: "visible", timeout: 30_000 });
  await guide.locator('.gp-scroll[aria-busy="false"]').waitFor({ state: "attached", timeout: 15_000 });
  await guide.locator('figure[data-motion="reduced"][data-play-state="complete"]').first()
    .waitFor({ state: "visible", timeout: 15_000 });
  await cropLocator(page, guide, outPath, 10, GUIDE_SCREENSHOT_STYLE);
}

async function captureLevelsView(page, width, lang, outPath) {
  await gotoReady(page, "/options?tab=levels", lang);
  const board = page.locator(".levels-board").first();
  await board.waitFor({ state: "visible", timeout: 60_000 });
  // The legend title proves the language; it renders before the map, so also wait
  // for a strike rung, which appears with the same commit that ends the loading state.
  const needle = lang === "zh" ? "如何读图" : "Reading the map";
  await board.getByText(needle, { exact: true }).first().waitFor({ state: "visible", timeout: 60_000 });
  await board.locator('[data-testid="levels-rung"]').first().waitFor({ state: "attached", timeout: 60_000 });
  if (width === 390) {
    await cropLocator(page, board, outPath, 8);
    return;
  }
  await cropLocator(page, board, outPath, 10);
}

async function captureLevelsLearn(page, width, lang, outPath) {
  await gotoReady(page, "/learn", lang);
  const hero = page.locator("h1").first();
  await hero.waitFor({ state: "visible", timeout: 20_000 });
  const needle = lang === "zh" ? "伽马天气图" : "The gamma weather map";
  // The server renders English and LangProvider switches to zh after hydration.
  try {
    await page.locator("h1").filter({ hasText: needle }).first().waitFor({ state: "visible", timeout: 60_000 });
  } catch {
    const text = ((await hero.textContent()) || "").trim();
    throw new Error(`${outPath}: expected learn hero ${needle}, got ${text}`);
  }
  const main = page.locator("main").first();
  await cropLocator(page, main, outPath, 12);
}

async function expectRailBadge(page, n, outPath) {
  const badge = page.locator(".cmx-rail .cmx-rail-hd .n");
  try {
    await badge.filter({ hasText: new RegExp(`^${n}$`) }).waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    const got = await badge.textContent({ timeout: 1_000 }).catch(() => "no badge");
    throw new Error(`${outPath}: expected live-steps badge ${n}, got ${got}`);
  }
}

async function captureChartConductor(page, width, lang, outPath) {
  // Time flows normally after install; it stops at pauseAt and then moves only on runFor.
  await page.clock.install();
  await gotoReady(page, "/dev/theater", lang);
  const play = page.getByRole("button", { name: /Play demo|Playing/ });
  await play.waitFor({ state: "visible", timeout: 20_000 });
  await waitForHydration(page, "button", "Play demo");
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1_000);
  // The queue arms its first op PACE_MS after Play, then each op arms the next.
  await play.click();
  await page.clock.runFor(PACE_MS);
  const plate = page.locator(".cmx-plate.show").first();
  await plate.waitFor({ state: "attached", timeout: 20_000 });
  await page.waitForFunction(() => {
    const el = document.querySelector(".cmx-plate.show");
    return !!el && getComputedStyle(el).opacity === "1";
  }, null, { timeout: 15_000 });
  const toggle = page.locator(".cmx-plate-ctl .cmx-btn:not(.cmx-skip)").first();
  await toggle.waitFor({ state: "attached", timeout: 15_000 });
  const expected = lang === "zh" ? "显示实时步骤" : "Show live steps";
  const hide = lang === "zh" ? "隐藏实时步骤" : "Hide live steps";
  const title = (await toggle.getAttribute("title")) || (await toggle.getAttribute("aria-label")) || "";
  if (!title.includes(expected) && !title.includes(hide)) {
    throw new Error(`${outPath}: expected conductor toggle ${expected}, got ${title}`);
  }
  const skip = lang === "zh" ? "跳过" : "Skip";
  await page.locator(".cmx-skip").getByText(skip).waitFor({ state: "visible", timeout: 10_000 });
  if (!(await toggle.getAttribute("aria-expanded") === "true")) {
    await toggle.click();
  }
  await page.locator(".cmx-rail").waitFor({ state: "visible", timeout: 10_000 });
  await expectRailBadge(page, 1, outPath);
  for (let step = 2; step <= CONDUCTOR_STEP; step++) {
    await page.clock.runFor(PACE_MS);
    await expectRailBadge(page, step, outPath);
  }
  const rows = page.locator(".cmx-rail .cmx-row");
  if ((await rows.count()) !== CONDUCTOR_STEP) {
    throw new Error(`${outPath}: expected ${CONDUCTOR_STEP} rail rows, got ${await rows.count()}`);
  }
  await rows.nth(CONDUCTOR_STEP - 1).locator(".fit").waitFor({ state: "visible", timeout: 5_000 });
  // Let the step's 180ms orb pulse and 260ms cursor fade run out, stopping short of the next step.
  await page.locator(".cmx-orb.is-acting").waitFor({ state: "visible", timeout: 5_000 });
  await page.waitForTimeout(250);
  await page.clock.runFor(PACE_MS - 50);
  await page.locator(".cmx-orb.is-thinking").waitFor({ state: "visible", timeout: 5_000 });
  await page.locator(".cmx-cursor:not(.on)").waitFor({ state: "attached", timeout: 5_000 });
  await expectRailBadge(page, CONDUCTOR_STEP, outPath);
  const pane = page.locator(".cmx").locator("xpath=..");
  await cropLocator(page, pane, outPath, 8);
}

const SURFACES = [
  { name: "GuidePanel", run: captureGuidePanel },
  { name: "LevelsView", run: captureLevelsView },
  { name: "LevelsLearn", run: captureLevelsLearn },
  { name: "ChartConductor", run: captureChartConductor },
];

function shouldCapture(surfaceName, width, lang) {
  if (!ONLY.length) return true;
  const stem = cropName(surfaceName, width, lang).replace(/\.png$/, "");
  return ONLY.includes(surfaceName) || ONLY.includes(stem);
}

async function main() {
  const capturedAtHead = currentGitHead();
  // A FAIL- screenshot belongs to the run that wrote it.
  for (const f of readdirSync(OUT)) {
    if (f.startsWith("FAIL-")) unlinkSync(join(OUT, f));
  }
  const child = startServer();
  const files = [];
  let failed = 0;
  try {
    await waitForServer(180_000);
    const browser = await chromium.launch({ headless: true, args: BROWSER_ARGS });
    try {
      for (const width of [1440, 390]) {
        for (const lang of ["en", "zh"]) {
          for (const surface of SURFACES) {
            if (!shouldCapture(surface.name, width, lang)) continue;
            const file = cropName(surface.name, width, lang);
            process.stdout.write(`capture ${file} … `);
            const { context, page } = await newPage(browser, width, lang);
            try {
              await surface.run(page, width, lang, join(OUT, file));
              await assertNoNextIndicator(page, file);
              files.push(file);
              console.log("ok");
            } catch (err) {
              failed += 1;
              console.log(`FAIL ${err && err.message ? err.message : err}`);
              try {
                await page.screenshot({ path: join(OUT, `FAIL-${file}`), fullPage: false });
              } catch { /* ignore */ }
            } finally {
              await context.close();
            }
          }
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(child);
  }

  if (failed) {
    // The crops that failed keep their old bytes, so the lock must not be restamped.
    console.log(`${failed} capture(s) failed; EVIDENCE.yml left unchanged`);
    process.exitCode = 1;
    return;
  }

  const evidence = [
    "# B-PL-6 batch 2 — capture evidence",
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
    "surfaces: [GuidePanel, LevelsView, LevelsLearn, ChartConductor]",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators to false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    `conductor_step: ${CONDUCTOR_STEP}`,
    `conductor_step_law: ChartConductor crops show step ${CONDUCTOR_STEP} of the 7-step /dev/theater demo, the first draw.trendline, whose rail row carries the fit chip (ChartConductor.tsx .fit). The page clock is paused before Play and advanced ${PACE_MS} ms (PACE_MS) per step, so the rail badge reads ${CONDUCTOR_STEP} in every crop.`,
    "screenshot_animations: disabled",
    "screenshot_animations_law: every crop is taken with Playwright animations disabled, so finite CSS animations render at their end state and infinite ones at their start.",
    "screenshot_raster: full",
    `screenshot_raster_law: Chromium is launched with ${BROWSER_ARGS.join(" ")}. By default it re-rasters only the invalidated part of a tile, so anti-aliased edges depend on the tile's raster history and the LevelsView-1440 chip corners varied by load. With whole-tile raster the same page gives the same pixels.`,
    "guide_motion: reduced",
    "guide_motion_law: GuidePanel crops are taken with prefers-reduced-motion set to reduce, so the module rail scrolls its current chip into view instantly and the Trend Engine proof shows its static complete frame (data-play-state complete, no playback button).",
    "guide_backdrop: hidden",
    "guide_backdrop_law: the guide panel is not fully opaque and its scrim blurs the live terminal (ticker, quotes), so every element outside .gp-scrim is hidden for the GuidePanel screenshots only.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_pl6_batch2.cjs",
    "files:",
    ...[...new Set([
      ...readdirSync(OUT).filter((f) => f.endsWith(".png") && !f.startsWith("FAIL-")).sort(),
      ...files,
    ])].map((f) => `  - ${f}`),
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
