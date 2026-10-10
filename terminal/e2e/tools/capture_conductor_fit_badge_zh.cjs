#!/usr/bin/env node
/**
 * Conductor fit chip in zh: dark evidence crops of ChartConductor's live-steps rail on
 * /dev/theater at the three contract viewports, in en and zh.
 *
 * The rail's fit chip ({touches, max_dev_atr} on a line/zone ack) read "8 touches · 0 ATR" in
 * zh until it moved onto LEX cmxFitOne/cmxFitMany. capture_pl6_batch2.cjs crops the same rail
 * but lands on demo step 1 or 2 at random. This tool waits for the drained queue (7 rows, done
 * plate up) and scrolls the step-2 row (the ai_tl_1 trendline, which carries the first chip)
 * into view, so every crop shows the step-2 chip.
 *
 * Same method as B-PL-6: Playwright against a fixture next-dev server. Dark only
 * (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06). TERMINAL_E2E_FIXTURE suppresses
 * the Next.js N indicator (DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR).
 *
 * From terminal/:
 *   node e2e/tools/capture_conductor_fit_badge_zh.cjs
 *
 * Writes rail-*.png + EVIDENCE.yml under docs/pr-crops/conductor-fit-badge-zh/ and never
 * touches before/. Writes no EVIDENCE.yml when any crop fails, including a zh chip that carries
 * English beyond "ATR" or an en chip that carries Chinese.
 */
"use strict";

const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "conductor-fit-badge-zh");
// Everything the rail crop draws: the demo script and its synthetic bars, the fit arithmetic,
// the rail markup, the chip text, the strings, and the .cmx-* styles plus their tokens.
const LAYOUT_FILES = [
  "terminal/app/dev/theater/page.tsx",
  "terminal/app/globals.css",
  "terminal/components/ChartConductor.tsx",
  "terminal/lib/chartBus.ts",
  "terminal/lib/conductorState.ts",
  "terminal/lib/i18n.tsx",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3563);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 390, height: 844 },
];
const DEMO_ROWS = 7; // the /dev/theater script: set_tf, 2 trendlines, zone, fib, 2 labels

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

function cropName(width, lang) {
  return `rail-${width}${lang === "zh" ? "-zh" : ""}.png`;
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
      const res = await fetch(`${BASE}/dev/theater`, { redirect: "manual" });
      last = String(res.status);
      if (res.status >= 200 && res.status < 500) return;
    } catch (err) {
      last = err.cause?.code || err.message;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(`dev server on ${PORT} never answered (${last})`);
}

async function newPage(browser, vp, lang) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.width < 1000, // playwright.config.ts: the tablet and mobile projects set hasTouch
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

async function stripDevOverlay(page) {
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
  });
}

async function assertNoNextIndicator(page, file) {
  await stripDevOverlay(page);
  const n = await page.locator("[data-nextjs-dev-tools-button]").count();
  if (n > 0) {
    throw new Error(`${file}: Next.js N overlay still mounted (${n}); TERMINAL_E2E_FIXTURE gate failed`);
  }
}

async function cropBox(page, box, outPath, pad) {
  const vp = page.viewportSize();
  if (!box || !vp) throw new Error(`no box for ${outPath}`);
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  const width = Math.max(8, Math.min(vp.width - x, Math.ceil(box.width + pad * 2)));
  const height = Math.max(8, Math.min(vp.height - y, Math.ceil(box.height + pad * 2)));
  await page.screenshot({ path: outPath, clip: { x, y, width, height } });
}

// A zh chip may carry Latin only in the ATR abbreviation; an en chip carries no CJK and the
// house singular/plural (drawingCountOne/Many).
function chipProblems(lang, chip) {
  if (lang === "zh") {
    if (/[A-Za-z]/.test(chip.replace(/ATR/g, ""))) return `zh chip leaks English: ${chip}`;
    if (!chip.includes("触及")) return `zh chip is not the LEX zh string: ${chip}`;
    return null;
  }
  if (/[㐀-鿿]/.test(chip)) return `en chip leaks Chinese: ${chip}`;
  if (!/^(1 touch|(?!1 )\d+ touches) · \d+(\.\d+)? ATR$/.test(chip)) return `en chip shape: ${chip}`;
  return null;
}

async function captureRail(page, lang, outPath) {
  await page.goto(`${BASE}/dev/theater`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await ensureLang(page, lang);
  await page.waitForTimeout(400);
  const play = page.getByRole("button", { name: /Play demo|Playing/ });
  await play.waitFor({ state: "visible", timeout: 20_000 });
  await play.click();
  await page.waitForFunction(() => {
    const el = document.querySelector(".cmx-plate.show");
    return !!el && getComputedStyle(el).opacity === "1";
  }, null, { timeout: 15_000 });
  const toggle = page.locator(".cmx-plate-ctl .cmx-btn:not(.cmx-skip)").first();
  await toggle.waitFor({ state: "attached", timeout: 15_000 });
  const show = lang === "zh" ? "显示实时步骤" : "Show live steps";
  const hide = lang === "zh" ? "隐藏实时步骤" : "Hide live steps";
  const title = (await toggle.getAttribute("title")) || (await toggle.getAttribute("aria-label")) || "";
  if (!title.includes(show) && !title.includes(hide)) {
    throw new Error(`expected conductor toggle ${show}, got ${title}`);
  }
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await page.locator(".cmx-rail").waitFor({ state: "visible", timeout: 10_000 });

  // Drained: every demo step is in the rail and the done plate is up, so nothing still animates in.
  await page.waitForFunction((n) => document.querySelectorAll(".cmx-rail .cmx-row").length === n, DEMO_ROWS, { timeout: 30_000 });
  const done = lang === "zh" ? "完成" : "Done";
  await page.waitForFunction((needle) => {
    const cap = document.querySelector(".cmx-plate.show .cmx-cap");
    return !!cap && (cap.textContent ?? "").includes(needle);
  }, done, { timeout: 15_000 });
  const rows = await page.$$eval(".cmx-rail .cmx-row", (els) => els.map((r) => r.querySelector(".fit")?.textContent ?? null));
  const firstChip = rows.findIndex((chip) => chip !== null);
  if (firstChip !== 1) throw new Error(`the first fit chip is on row ${firstChip}, expected row 1 (demo step 2, ai_tl_1)`);
  const chips = rows.filter((chip) => chip !== null);
  for (const chip of chips) {
    const problem = chipProblems(lang, chip);
    if (problem) throw new Error(problem);
  }

  // Bring the step-2 chip fully inside the rail body and the viewport.
  await page.evaluate(() => {
    const body = document.querySelector(".cmx-rail .cmx-rail-body");
    if (body) body.scrollTop = 0;
    document.querySelectorAll(".cmx-rail .cmx-row")[1]?.scrollIntoView({ block: "nearest" });
  });
  await page.waitForTimeout(300);
  const step2Visible = await page.evaluate(() => {
    const body = document.querySelector(".cmx-rail .cmx-rail-body")?.getBoundingClientRect();
    const fit = document.querySelectorAll(".cmx-rail .cmx-row")[1]?.querySelector(".fit")?.getBoundingClientRect();
    if (!body || !fit) return false;
    return fit.top >= body.top - 0.5 && fit.bottom <= body.bottom + 0.5
      && fit.left >= body.left - 0.5 && fit.right <= body.right + 0.5
      && fit.bottom <= window.innerHeight && fit.right <= window.innerWidth;
  });
  if (!step2Visible) throw new Error("the step-2 chip is not fully inside the rail body");

  await stripDevOverlay(page);
  await cropBox(page, await page.locator(".cmx-rail").first().boundingBox(), outPath, 8);
  const plate = (await page.locator(".cmx-plate.show .cmx-cap").first().textContent().catch(() => "")) || "";
  if (!plate.includes(done)) throw new Error(`the done plate closed before the crop finished (${plate || "no plate"})`);
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflowX > 0) throw new Error(`horizontal document overflow ${overflowX}px`);
  return chips;
}

async function main() {
  const capturedAtHead = currentGitHead();
  const child = startServer();
  const chipText = {};
  let failed = 0;
  try {
    await waitForServer(240_000);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const vp of VIEWPORTS) {
        for (const lang of ["en", "zh"]) {
          const file = cropName(vp.width, lang);
          process.stdout.write(`capture ${file} … `);
          const { context, page } = await newPage(browser, vp, lang);
          try {
            chipText[file] = await captureRail(page, lang, join(OUT, file));
            await assertNoNextIndicator(page, file);
            console.log(`ok ${JSON.stringify(chipText[file])}`);
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
    } finally {
      await browser.close();
    }
  } finally {
    stopServer(child);
  }
  if (failed) {
    console.log(`${failed} crop(s) failed; EVIDENCE.yml not written`);
    process.exitCode = 1;
    return;
  }

  const files = Object.keys(chipText).sort();
  const evidence = [
    "# Conductor fit chip in zh — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    "# before/ holds the same crops at the commit before the fix (before/BEFORE.yml); this tool never rewrites it.",
    "layoutFiles:",
    ...layoutFilesBlock(),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    ...VIEWPORTS.map((vp) => `  - { name: ${vp.name}, width: ${vp.width}, height: ${vp.height} }`),
    "surface: ChartConductor live-steps rail on /dev/theater; queue drained (7 rows), done plate up, step-2 row scrolled into view",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators: false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_conductor_fit_badge_zh.cjs",
    "# chipText: every fit chip's text in the rail when the crop was taken, in row order. The first is",
    "# the step-2 (ai_tl_1) chip, which every crop shows. Row captions are the demo's English model",
    "# captions, shown verbatim in both languages by design (conductorState captionFor).",
    "chipText:",
    ...files.map((f) => `  ${f}: ${JSON.stringify(chipText[f]).replace(/","/g, "\", \"")}`),
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
