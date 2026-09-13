#!/usr/bin/env node
/**
 * B-PL-1 dark evidence matrix — standalone Playwright capture.
 *
 * Starts its own `next dev` with the existing TERMINAL_E2E_FIXTURE env block.
 * Does NOT invoke `playwright test`, the full e2e suite, or `test:e2e:responsive`.
 *
 *   node e2e/tools/capture_plat1_crops.cjs
 *
 * Writes 24 PNGs under docs/pr-crops/b-plat-1-plain-labels/.
 */
"use strict";

const { spawn } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { chromium } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-plat-1-plain-labels");
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3519);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  390: { width: 390, height: 844 },
};

mkdirSync(OUT, { recursive: true });

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
  });
  await context.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
    window.__mmPlat1Ready = false;
    window.addEventListener("mm:terminal-visual-ready", () => {
      window.__mmPlat1Ready = true;
    }, { once: true });
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
}

async function waitVisible(page, selector, timeout = 45_000) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: "visible", timeout });
  return loc;
}

/** Fail the crop if #532's TERMINAL_E2E_FIXTURE gate did not hide the Next.js N overlay. */
async function assertNoNextIndicator(page, file) {
  await page.waitForTimeout(400);
  const n = await page.locator("[data-nextjs-dev-tools-button]").count();
  if (n > 0) {
    throw new Error(`${file}: Next.js N overlay still mounted (${n}); TERMINAL_E2E_FIXTURE gate failed`);
  }
}

/** Scroll a horizontal shelf so `locator` is fully inside the scroller, not clipped at the edge. */
async function scrollFullyIntoScroller(locator) {
  const el = locator.first();
  if (!(await el.count())) return;
  await el.evaluate((node) => {
    const scroller = node.closest(".inav") || node.parentElement;
    if (!scroller) {
      node.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    const nr = node.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    if (nr.right > sr.right - 2) scroller.scrollLeft += (nr.right - sr.right) + 10;
    if (nr.left < sr.left + 2) scroller.scrollLeft -= (sr.left - nr.left) + 10;
  });
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

async function cropLocator(page, locator, outPath, pad = 18) {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);
  const box = await locator.boundingBox();
  await cropBox(page, box, outPath, pad);
}

async function cropUnion(page, locators, outPath, pad = 18) {
  const boxes = [];
  for (const loc of locators) {
    try {
      await loc.scrollIntoViewIfNeeded();
      const box = await loc.boundingBox();
      if (box && box.width > 0 && box.height > 0) boxes.push(box);
    } catch { /* skip missing */ }
  }
  if (!boxes.length) throw new Error(`no union boxes for ${outPath}`);
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  await cropBox(page, { x, y, width: right - x, height: bottom - y }, outPath, pad);
}

async function judgeEl(locator, name) {
  if (!(await locator.count())) {
    return { name, missing: true };
  }
  return locator.first().evaluate((el, name) => {
    const cs = getComputedStyle(el);
    const clipX = el.scrollWidth > el.clientWidth + 1
      && (cs.overflowX === "hidden" || cs.textOverflow === "ellipsis");
    const clipY = el.scrollHeight > el.clientHeight + 1 && cs.overflowY === "hidden";
    const line = Number.parseFloat(cs.lineHeight) || Number.parseFloat(cs.fontSize) * 1.2;
    const wrapped = el.clientHeight > line * 1.55;
    return {
      name,
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 96),
      clientW: Math.round(el.clientWidth),
      scrollW: Math.round(el.scrollWidth),
      clientH: Math.round(el.clientHeight),
      scrollH: Math.round(el.scrollHeight),
      overflowX: cs.overflowX,
      whiteSpace: cs.whiteSpace,
      textOverflow: cs.textOverflow,
      clip: clipX || clipY,
      wrap: wrapped,
    };
  }, name);
}

async function waitTerminalReady(page) {
  await waitVisible(page, ".workspace");
  const canvas = page.locator(".chart-wrap canvas").first();
  await canvas.waitFor({ state: "visible", timeout: 45_000 }).catch(() => {});
  await page.waitForFunction(() => window.__mmPlat1Ready === true, null, { timeout: 20_000 }).catch(() => {});
}

async function openIndicatorLibrary(page, width) {
  await waitTerminalReady(page);
  if (width === 390) {
    await waitVisible(page, "[data-testid='roller-more']");
    await page.getByTestId("roller-more").click();
    await page.getByTestId("hub-tile-indicators").click();
  } else {
    const trigger = page.locator(".chart-tabs .indicator-library-trigger, .indicator-library-trigger").first();
    await trigger.waitFor({ state: "visible", timeout: 45_000 });
    await trigger.scrollIntoViewIfNeeded();
    for (let i = 0; i < 3; i += 1) {
      await trigger.click({ timeout: 8_000 }).catch(() => {});
      const modal = page.locator(".imodal-library");
      try {
        await modal.waitFor({ state: "visible", timeout: 8_000 });
        return;
      } catch {
        /* toolbar may still be hydrating — retry */
      }
    }
  }
  await waitVisible(page, ".imodal-library");
}

async function captureIndicatorsModal(page, width, lang, outPath) {
  await gotoReady(page, "/terminal?symbol=SPY", lang);
  await openIndicatorLibrary(page, width);
  const classicNav = page.locator(".im-nav-item").filter({ hasText: lang === "zh" ? "趋势" : "Trend" }).first();
  const priceAction = page.locator(".im-nav-item").filter({ hasText: lang === "zh" ? "价格行为" : "Price Action" }).first();
  const proNav = page.locator(".im-nav-item").filter({ hasText: /Structure Core|结构核心/ }).first();
  if (await proNav.count()) await proNav.click();
  await page.locator(".im-tier").first().waitFor({ state: "visible", timeout: 20_000 });
  if (await classicNav.count()) await classicNav.scrollIntoViewIfNeeded();
  // 390 shelf: Price Action sat at the crop edge as "Pri". Scroll it fully into the
  // visible inav before the union crop so the classic-category label can be judged.
  if (await priceAction.count()) await scrollFullyIntoScroller(priceAction);
  const nav = page.locator(".imodal .inav");
  const list = page.locator(".imodal .ilist");
  const firstChip = page.locator(".im-tier").first();
  const firstRow = page.locator(".imod-row").first();
  await cropUnion(page, [nav, firstRow, firstChip, list], outPath, 10);
  return [
    await judgeEl(page.locator(".im-tier").first(), "planChip"),
    await judgeEl(classicNav, "classicNav"),
    await judgeEl(priceAction, "priceActionNav"),
    await judgeEl(page.locator(".im-list-title strong").first(), "classicLabel"),
  ];
}

async function captureStockAnalysis(page, width, lang, outPath) {
  await gotoReady(page, "/terminal?symbol=SPY", lang);
  await waitTerminalReady(page);
  const title = lang === "zh" ? "期权 · 做市商持仓" : "Options · dealer positioning";
  const section = page.locator(".sa-sec").filter({ hasText: title }).first();
  await section.waitFor({ state: "visible", timeout: 45_000 });
  const chips = section.locator(".sa-chips");
  await chips.waitFor({ state: "visible", timeout: 15_000 });
  await section.scrollIntoViewIfNeeded();
  await cropLocator(page, section, outPath, 16);
  return [await judgeEl(chips.locator(".sa-chip").first(), "gexChip")];
}

async function captureMarketStateCard(page, width, lang, outPath) {
  await gotoReady(page, "/options?tab=gex", lang);
  const card = await waitVisible(page, "[data-tut='gex-state-card']", 60_000);
  await cropLocator(page, card, outPath, 14);
  return [await judgeEl(card.locator("span").filter({ hasText: /PIN|锁定|DRIFT|漂移|RANGE|区间|TREND|趋势|CASCADE|瀑布|TRANSITION|转变|UNKNOWN|未知|Not classified|未分类/ }).first(), "regimeHero")];
}

async function captureSurfacePane(page, width, lang, outPath) {
  await gotoReady(page, "/options?tab=surface", lang);
  const chip = page.locator(".obs-surf-data-item[aria-label]").first();
  await chip.waitFor({ state: "visible", timeout: 60_000 });
  const strip = page.locator(".obs-surf-data-strip").first();
  await cropUnion(page, [await strip.count() ? strip : chip, chip], outPath, 16);
  return [await judgeEl(chip.locator("strong").first(), "regimeChip")];
}

async function captureHeatmapTable(page, width, lang, outPath) {
  await gotoReady(page, "/discover?tab=heatmap", lang);
  const tableBtn = page.locator(".obs-chip").filter({ hasText: lang === "zh" ? /^列表$/ : /^TABLE$/ }).first();
  await tableBtn.waitFor({ state: "visible", timeout: 45_000 });
  for (let i = 0; i < 3; i += 1) {
    await tableBtn.click();
    const on = await tableBtn.evaluate((el) => el.classList.contains("on")).catch(() => false);
    if (on) break;
    await page.waitForTimeout(400);
  }
  const table = page.locator("table").first();
  await table.waitFor({ state: "visible", timeout: 45_000 });
  await page.locator("table tbody tr").first().waitFor({ state: "visible", timeout: 45_000 });
  const header = table.locator("thead");
  const rows = table.locator("tbody tr");
  await cropUnion(page, [header, rows.nth(0), rows.nth(1), rows.nth(2)], outPath, 14);
  return [await judgeEl(table.locator("tbody tr").first().locator("td").nth(2), "sectorCell")];
}

async function captureScreenerView(page, width, lang, outPath) {
  await gotoReady(page, "/discover?tab=screener", lang);
  const table = page.locator("table.scr2");
  await table.waitFor({ state: "visible", timeout: 60_000 });
  await page.locator("table.scr2 tbody tr").first().waitFor({ state: "visible", timeout: 45_000 });
  await page.locator("table.scr2 tbody td").filter({ hasText: /PIN|RANGE|TREND|DRIFT|CASCADE|TRANSITION|锁定|区间|趋势|漂移|瀑布|转变/ }).first()
    .waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
  const wrap = page.locator(".scr2-table");
  await cropLocator(page, wrap, outPath, 10);
  const regimeHead = table.locator("thead th").filter({ hasText: /γ/ });
  const filled = table.locator("tbody td").filter({ hasText: /PIN|RANGE|TREND|DRIFT|CASCADE|TRANSITION|锁定|区间|趋势|漂移|瀑布|转变|Not classified|未分类/ }).first();
  return [
    await judgeEl(regimeHead.first(), "regimeHead"),
    await judgeEl(filled, "regimeCell"),
    {
      name: "regimeColumnVisible",
      visible: await regimeHead.count() > 0 && await regimeHead.first().isVisible(),
    },
  ];
}

const ALL_SURFACES = [
  { name: "IndicatorsModal", run: captureIndicatorsModal },
  { name: "StockAnalysis", run: captureStockAnalysis },
  { name: "MarketStateCard", run: captureMarketStateCard },
  { name: "SurfacePane", run: captureSurfacePane },
  { name: "HeatmapTable", run: captureHeatmapTable },
  { name: "ScreenerView", run: captureScreenerView },
];
const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith("-")));
const SURFACES = only.size ? ALL_SURFACES.filter((s) => only.has(s.name)) : ALL_SURFACES;

async function main() {
  const child = startServer();
  const report = [];
  let failed = 0;
  try {
    await waitForServer(180_000);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const width of [1440, 390]) {
        for (const lang of ["en", "zh"]) {
          for (const surface of SURFACES) {
            const file = cropName(surface.name, width, lang);
            const outPath = join(OUT, file);
            process.stdout.write(`capture ${file} … `);
            const { context, page } = await newPage(browser, width, lang);
            try {
              const judges = await surface.run(page, width, lang, outPath);
              await assertNoNextIndicator(page, file);
              report.push({ file, width, lang, judges });
              const clip = (judges || []).some((j) => j && j.clip);
              console.log(clip ? "CLIP" : "ok");
            } catch (err) {
              failed += 1;
              report.push({ file, width, lang, error: String(err && err.message ? err.message : err) });
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

  const expected = SURFACES.length * 4;
  writeFileSync(join(OUT, "judge-report.json"), JSON.stringify(report, null, 2));
  console.log(`\nWrote ${expected - failed}/${expected} crops to ${OUT}`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
