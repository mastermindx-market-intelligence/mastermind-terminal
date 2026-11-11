#!/usr/bin/env node
/**
 * B-F08-B5-1 — dark evidence crops for the portfolio targets readout.
 *
 * Dark only (DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06).
 * TERMINAL_E2E_FIXTURE suppresses the Next.js N indicator.
 *
 * From terminal/:
 *   node e2e/tools/capture_b_f08_b5_1_targets.cjs
 *
 * Writes PNGs + EVIDENCE.yml under docs/pr-crops/b-f08-b5-1-targets/.
 */
"use strict";

const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const { tmpdir } = require("node:os");
const { startLegacyServer, settleLegacyServer, waitLegacyServer } = require("./capture_ci_evidence.cjs");
const { createHash } = require("node:crypto");
const { mkdirSync, mkdtempSync, copyFileSync, readFileSync, writeFileSync } = require("node:fs");
const { join, basename } = require("node:path");
const { chromium, expect } = require("@playwright/test");

const ROOT = join(__dirname, "..", "..");
const REPO = join(ROOT, "..");
const OUT = join(ROOT, "docs", "pr-crops", "b-f08-b5-1-targets");
const LAYOUT_FILES = [
  "terminal/lib/portfolioMoney.ts",
  "terminal/lib/portfolioWorkspace.ts",
  "terminal/lib/i18n.tsx",
  "terminal/components/PortfolioWorkspace.tsx",
  "terminal/components/PortfolioWorkspace.module.css",
  "terminal/components/PortfolioRoleEditor.tsx",
  "terminal/app/globals.css",
  "terminal/components/PortfolioView.tsx",
  "terminal/lib/portfolioTargets.ts",
  "terminal/components/PortfolioTargets.module.css",
];
const PORT = Number(process.env.TERMINAL_CROP_PORT || 3543);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORTS = {
  1440: { width: 1440, height: 900 },
  390: { width: 390, height: 844 },
};
// Round 2 adds three states for the seat's rulings: the BLOCKER case (R1) where the open book is
// empty and only an orphaned target remains, the unweighable case (R2 / R6 c), and the cleared
// flash (R6 d). The five original states are recaptured because their copy changed.
const NATIVE_READBACKS = [];
const STATES = [
  "empty",
  "populated-within-band",
  "populated-outside-band",
  "orphaned-target-disclosed",
  "orphaned-empty-book",
  "unweighable",
  "cleared",
  "unavailable",
];

mkdirSync(OUT, { recursive: true });
const CAPTURE_OUT = mkdtempSync(join(tmpdir(), "mmx-b-f08-b5-1-targets-"));
console.log(`unpromoted capture directory ${CAPTURE_OUT}`);

function currentGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256File(rel) {
  return createHash("sha256").update(readFileSync(join(REPO, rel))).digest("hex");
}

function cropName(state, width, lang) {
  return `PortfolioTargets-${state}-${width}${lang === "zh" ? "-zh" : ""}.png`;
}

function startServer() { return startLegacyServer(ROOT, PORT); }

async function waitForServer(timeoutMs, child) {
  await waitLegacyServer(child, `${BASE}/portfolio`, timeoutMs);
}

async function newPage(browser, width, lang, storeKey) {
  const context = await browser.newContext({
    viewport: VIEWPORTS[width],
    hasTouch: width === 390,
    locale: lang === "zh" ? "zh-CN" : "en-US",
    colorScheme: "dark",
  });
  await context.addCookies([{ name: "mm_e2e_wl", value: storeKey, url: BASE }]);
  await context.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    localStorage.setItem("theme", "dark");
    localStorage.setItem("theme_auto", "0");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.setAttribute("data-lang", l);
  }, lang);
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  await page.route("**/api/portfolio-brief", (route) =>
    route.fulfill({ status: 403, json: { tier: "free" } }));
  await page.route("**/data/manifest.json", (route) => route.fulfill({
    json: { symbols: { NVDA: { name: "NVIDIA", zh: "英伟达", last: 175 }, AAPL: { name: "Apple", zh: "苹果", last: 228 } } },
  }));
  await page.route("**/api/quote**", (route) => route.fulfill({
    json: { quotes: { NVDA: { last: 180, chg: 2.5 }, AAPL: { last: 228, chg: 0 } } },
  }));
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

async function assertNoNextIndicator(page, file) {
  await page.waitForTimeout(400);
  const n = await page.locator("[data-nextjs-dev-tools-button]").count();
  if (n > 0) {
    throw new Error(`${file}: Next.js N overlay still mounted (${n}); TERMINAL_E2E_FIXTURE gate failed`);
  }
}

const CROP_GEOMETRY = [];
async function cropLocator(page, locator, outPath, pad = 18) {
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: 20_000 });
  const requestedViewport = page.viewportSize();
  const settle = async () => {
    await page.evaluate(() => document.fonts.ready);
    // Normal scrolling preserves the product's fixed/sticky chrome and all CSS.
    await target.evaluate(element => {
      element.closest(".pg")?.scrollTo(0, 0);
      window.scrollTo(0, 0);
    });
    await target.evaluate(element => new Promise((resolve, reject) => {
      const deadline = performance.now() + 5_000;
      let prior = "", stable = 0;
      const frame = () => {
        const r = element.getBoundingClientRect();
        const key = [r.x, r.y, r.width, r.height].map(value => Math.round(value * 10)).join(",");
        stable = key === prior ? stable + 1 : 0; prior = key;
        if (stable >= 3) return resolve();
        if (performance.now() > deadline) return reject(new Error("Targets geometry did not settle"));
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }));
  };
  await settle();
  const measure = () => target.evaluate(element => {
    const r = element.getBoundingClientRect();
    const rect = { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
    const clippedBy = [];
    const clips = value => /^(auto|scroll|hidden|clip)$/.test(value);
    for (let parent = element.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
      const style = getComputedStyle(parent), b = parent.getBoundingClientRect();
      const left = b.left + parent.clientLeft, top = b.top + parent.clientTop;
      const horizontal = clips(style.overflowX) && (r.left < left - 1 || r.right > left + parent.clientWidth + 1);
      const vertical = clips(style.overflowY) && (r.top < top - 1 || r.bottom > top + parent.clientHeight + 1);
      if (horizontal || vertical) {
        clippedBy.push({ tag: parent.tagName, className: parent.className, horizontal, vertical,
          shortfall: Math.max(0, top - r.top, r.bottom - top - parent.clientHeight),
          client: { x: left, y: top, width: parent.clientWidth, height: parent.clientHeight } });
      }
    }
    const self = getComputedStyle(element);
    if ((clips(self.overflowY) && element.scrollHeight > element.clientHeight + 1)
      || (clips(self.overflowX) && element.scrollWidth > element.clientWidth + 1)) clippedBy.push({ tag: "SELF", horizontal: element.scrollWidth > element.clientWidth + 1, vertical: element.scrollHeight > element.clientHeight + 1, shortfall: Math.max(0, element.scrollHeight - element.clientHeight) });
    const visible = [...element.querySelectorAll("button, input, select, p")].filter(node => {
      const box = node.getBoundingClientRect(), style = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden";
    });
    const last = visible.at(-1)?.getBoundingClientRect();
    return { rect, clippedBy, viewport: { width: innerWidth, height: innerHeight }, deviceScaleFactor: devicePixelRatio,
      documentSize: { width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) },
      lastVisible: last ? { x: last.left + scrollX, y: last.top + scrollY, width: last.width, height: last.height } : null,
      content: element.textContent };
  });
  let before = await measure();
  const heightAdjustments = [];
  for (let attempt = 0; before.clippedBy.length && attempt < 4; attempt += 1) {
    assert.equal(before.clippedBy.some(row => row.horizontal), false, `${outPath}: horizontal clipping`);
    const height = Math.ceil(before.viewport.height + Math.max(...before.clippedBy.map(row => row.shortfall)) + 32);
    assert.ok(height <= 8192, `${outPath}: section exceeds bounded native capture height`);
    heightAdjustments.push({ before: before.viewport, clippedBy: before.clippedBy, nextHeight: height });
    await page.setViewportSize({ width: requestedViewport.width, height });
    await settle(); before = await measure();
  }
  assert.deepEqual(before.clippedBy, [], `${outPath}: natural section is still clipped by an ancestor`);
  assert.deepEqual(before.viewport, page.viewportSize());
  const r = before.rect;
  const x = Math.max(0, Math.floor(r.x - pad)), y = Math.max(0, Math.floor(r.y - pad));
  const right = Math.min(before.documentSize.width, Math.ceil(r.x + r.width + pad));
  const bottom = Math.min(before.documentSize.height, Math.ceil(r.y + r.height + pad));
  assert.ok(right >= r.x + r.width - 1 && bottom >= r.y + r.height - 1, "Document crop would truncate the section");
  const clip = { x, y, width: right - x, height: bottom - y };
  if (before.lastVisible) {
    const last = before.lastVisible;
    assert.ok(last.x >= x - 1 && last.y >= y - 1 && last.x + last.width <= right + 1 && last.y + last.height <= bottom + 1, "Final visible control or status falls outside crop");
  }
  await assertNoNextIndicator(page, outPath);
  const bytes = await page.screenshot({ path: outPath, fullPage: true, clip, caret: "initial", animations: "allow", scale: "css" });
  assert.equal(bytes.readUInt32BE(16), clip.width, "PNG width was truncated");
  assert.equal(bytes.readUInt32BE(20), clip.height, "PNG height was truncated");
  const after = await measure();
  assert.deepEqual(after, before, "Layout or state changed during capture");
  CROP_GEOMETRY.push({ file: basename(outPath), requestedViewport, captureViewport: before.viewport, heightAdjustments,
    cropRectCss: clip, sectionRectCss: r, lastVisible: before.lastVisible, clippedBy: before.clippedBy,
    captureMethod: "native-full-page-document-clip", scale: "css" });
}

async function requireJson(response, operation) {
  if (!response.ok()) {
    const error = new Error(`${operation}: HTTP ${response.status()}`);
    if ([401, 403].includes(response.status())) error.code = "CAPTURE_AUTH_REFUSED";
    throw error;
  }
  return response.json();
}

async function readNativeState(page, state, phase, file) {
  const positions = await requireJson(await page.request.get(`${BASE}/api/portfolio?view=positions`), "positions readback");
  const targetRead = await requireJson(await page.request.get(`${BASE}/api/portfolio/targets`), "targets readback");
  assert.equal(typeof positions.bookKey, "string");
  assert.equal(targetRead.bookKey, positions.bookKey, "Targets must describe the native position book");
  const summary = targetRead.summary;
  assert.equal(summary.schema, "portfolio_targets.v1");
  const drift = ticker => summary.drifts.find(row => row.ticker === ticker);
  const open = positions.positions.filter(row => row.status === "open");
  if (phase === "cleared" || state === "empty" || state === "unavailable") {
    assert.equal(summary.targetsSumPct, null); assert.equal(summary.targetsSumOffBy100, null);
    assert.equal(summary.drifts.length, 0); assert.equal(summary.orphaned.length, 0);
  } else if (state.startsWith("orphaned")) {
    assert.equal(summary.orphaned.length, 1); assert.equal(summary.orphaned[0].ticker, "NVDA");
    assert.equal(open.some(row => row.ticker === "NVDA"), false);
    assert.equal(open.length, state === "orphaned-empty-book" ? 0 : 1);
    if (open.length) assert.equal(summary.untargeted[0].ticker, "AAPL");
  } else {
    assert.equal(summary.costCurrency, "USD");
    const expected = state === "populated-within-band" ? [95, 5, "within_band"] : [80, 20, "outside_band"];
    assert.equal(drift("NVDA").currentWeightPct, 100);
    assert.equal(drift("NVDA").targetWeightPct, expected[0]);
    assert.equal(drift("NVDA").driftPct, expected[1]); assert.equal(drift("NVDA").status, expected[2]);
    if (state === "unweighable") {
      assert.equal(drift("AAPL").currentWeightPct, null); assert.equal(drift("AAPL").status, "unweighable");
      assert.equal(summary.untargeted.find(row => row.ticker === "MSFT").currentWeightPct, null);
    }
  }
  const receipt = { file, state, phase, positions, targetRead };
  NATIVE_READBACKS.push(receipt); return receipt;
}

async function seed(page, drafts) {
  for (const draft of drafts) {
    const res = await page.request.post(`${BASE}/api/portfolio`, { data: { action: "create", ...draft } });
    const body = await requireJson(res, `seed ${draft.ticker}`);
    draft.id = body.position && body.position.id;
  }
}

async function setTarget(page, ticker, targetWeightPct, bandPct) {
  const res = await page.request.post(`${BASE}/api/portfolio/targets`, {
    data: { action: "set", ticker, targetWeightPct, bandPct },
  });
  await requireJson(res, `set ${ticker}`);
}

async function prepareState(page, state) {
  if (state === "empty") {
    await seed(page, [{ ticker: "NVDA" }]);
    return;
  }
  if (state === "populated-within-band") {
    await seed(page, [{ ticker: "NVDA", shares: "100", entryPrice: "200", entryCurrency: "USD" }]);
    await setTarget(page, "NVDA", 95, 5);
    return;
  }
  if (state === "populated-outside-band") {
    await seed(page, [{ ticker: "NVDA", shares: "100", entryPrice: "200", entryCurrency: "USD" }]);
    await setTarget(page, "NVDA", 80, 5);
    return;
  }
  if (state === "orphaned-target-disclosed") {
    const rows = [
      { ticker: "NVDA", shares: "100", entryPrice: "200", entryCurrency: "USD" },
      { ticker: "AAPL", shares: "10", entryPrice: "200", entryCurrency: "USD" },
    ];
    await seed(page, rows);
    await setTarget(page, "NVDA", 80, 5);
    const close = await page.request.post(`${BASE}/api/portfolio`, {
      data: { action: "close", id: rows[0].id },
    });
    await requireJson(close, "close NVDA");
    return;
  }
  if (state === "orphaned-empty-book") {
    // R1 (BLOCKER): the LAST holding closed. Zero open positions, one target still saved.
    const rows = [{ ticker: "NVDA", shares: "100", entryPrice: "200", entryCurrency: "USD" }];
    await seed(page, rows);
    await setTarget(page, "NVDA", 80, 5);
    const close = await page.request.post(`${BASE}/api/portfolio`, {
      data: { action: "close", id: rows[0].id },
    });
    await requireJson(close, "close NVDA");
    return;
  }
  if (state === "unweighable") {
    // R2 / R6 (c): a zero-cost holding WITH a target (the unweighable status sentence) and a
    // zero-cost holding WITHOUT one (the unweighable hint), beside a normal weighable row.
    await seed(page, [
      { ticker: "NVDA", shares: "100", entryPrice: "200", entryCurrency: "USD" },
      { ticker: "AAPL", shares: "0", entryPrice: "200", entryCurrency: "USD" },
      { ticker: "MSFT", shares: "0", entryPrice: "100", entryCurrency: "USD" },
    ]);
    await setTarget(page, "NVDA", 80, 5);
    await setTarget(page, "AAPL", 10, 5);
    return;
  }
  if (state === "cleared") {
    await seed(page, [{ ticker: "NVDA", shares: "100", entryPrice: "200", entryCurrency: "USD" }]);
    await setTarget(page, "NVDA", 80, 5);
    return;
  }
  if (state === "unavailable") {
    await seed(page, [{ ticker: "NVDA", shares: "100", entryPrice: "200", entryCurrency: "USD" }]);
    await page.route("**/api/portfolio/targets", (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ status: 503, json: { error: "targets unavailable" } });
      }
      return route.continue();
    });
  }
}

async function captureState(page, width, lang, state, outPath) {
  await prepareState(page, state);
  await readNativeState(page, state, "prepared", basename(outPath));
  await page.goto(`${BASE}/portfolio`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await ensureLang(page, lang);
  // SSR paints the tabs before their handlers are hydrated. The native Checked
  // timestamp is published only after the client position read; the hidden
  // target marker then confirms that this book's target read has settled.
  await page.locator('main[data-portfolio="w5-positions"] header time[datetime]')
    .waitFor({ state: "visible", timeout: 20_000 });
  const testId = state === "unavailable" ? "portfolio-targets-unavailable" : "portfolio-targets";
  await page.locator("#portfolio-panel-targets").getByTestId(testId)
    .waitFor({ state: "attached", timeout: 20_000 });
  const targetsTab = page.locator("#portfolio-tab-targets");
  await targetsTab.click();
  await expect(targetsTab).toHaveAttribute("aria-selected", "true");
  if (state === "cleared") {
    // R6 (d): the flash the user actually sees after clearing a target — it must read "Target
    // cleared." / "已清除目标。", never the save confirmation.
    const button = page.getByTestId("portfolio-targets")
      .getByRole("button", { name: lang === "zh" ? "清除目标" : "Clear target" });
    await button.first().waitFor({ state: "visible", timeout: 20_000 });
    await button.first().click();
    await page.getByTestId("targets-untargeted").waitFor({ state: "visible", timeout: 20_000 });
    await page.getByText(lang === "zh" ? "已清除目标。" : "Target cleared.", { exact: true }).waitFor({ state: "visible" });
    await readNativeState(page, state, "cleared", basename(outPath));
  }
  const loc = page.getByTestId(testId);
  await loc.waitFor({ state: "visible", timeout: 20_000 });
  if (state.startsWith("orphaned")) await loc.getByTestId("targets-orphaned").waitFor({ state: "visible" });
  if (state === "empty" || state === "cleared" || state === "unweighable") await loc.getByTestId("targets-untargeted").waitFor({ state: "visible" });
  if (state === "populated-within-band" || state === "populated-outside-band") await expect(loc).toContainText(/100(?:\.0)?%/);
  await loc.scrollIntoViewIfNeeded();
  await cropLocator(page, loc, outPath, width === 390 ? 10 : 16);
}

async function main() {
  const capturedAtHead = currentGitHead();
  assert.match(capturedAtHead, /^[0-9a-f]{40}$/);
  const sourceHashes = Object.fromEntries(LAYOUT_FILES.map(rel => [rel, sha256File(rel)]));
  const child = startServer();
  const files = [];
  let failed = 0;
  try {
    await waitForServer(180_000, child);
    const browser = await chromium.launch({ headless: true });
    try {
      for (const width of [1440, 390]) {
        for (const lang of ["en", "zh"]) {
          for (const state of STATES) {
            const file = cropName(state, width, lang);
            process.stdout.write(`capture ${file} … `);
            const storeKey = `crop-${state}-${width}-${lang}-${Date.now()}`;
            const { context, page } = await newPage(browser, width, lang, storeKey);
            try {
              await captureState(page, width, lang, state, join(CAPTURE_OUT, file));
              files.push(file);
              console.log("ok");
            } catch (err) {
              failed += 1;
              console.log(`FAIL ${err && err.message ? err.message : err}`);
              try {
                await page.screenshot({ path: join(CAPTURE_OUT, `FAIL-${file}`), fullPage: false });
              } catch { /* ignore */ }
              throw err; // An incomplete matrix is never promotable.
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
    await settleLegacyServer(child);
  }

  if (failed) throw new Error(`capture finished with ${failed} failure(s)`);
  files.sort();
  const expectedFiles = STATES.flatMap(state => [1440, 390].flatMap(width => ["en", "zh"].map(lang => cropName(state, width, lang)))).sort();
  assert.deepEqual(files, expectedFiles, "Capture requires the complete unique matrix");
  assert.equal(new Set(files).size, expectedFiles.length);
  assert.equal(currentGitHead(), capturedAtHead, "Source HEAD changed during capture");
  for (const rel of LAYOUT_FILES) assert.equal(sha256File(rel), sourceHashes[rel], `Source changed: ${rel}`);
  const captureFiles = Object.fromEntries(files.map(file => {
    const bytes = readFileSync(join(CAPTURE_OUT, file));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", file);
    return [file, createHash("sha256").update(bytes).digest("hex")];
  }));
  const evidence = [
    "# B-F08-B5-1 portfolio construction targets — capture evidence",
    "# Terminal is dark-only: DEC:TERMINAL-SHELL-IS-DARK-ONLY-EVIDENCE-MATRIX-2026-09-06",
    "# Dev-indicator law: DSC:TERMINAL-N-BUBBLE-IN-390-CROPS-IS-THE-NEXTJS-DEV-INDICATOR",
    `# capturedAtHead: ${capturedAtHead}`,
    `# capturedAt: ${new Date().toISOString()}`,
    "# capturedAtHead is informational. The lock is layoutFiles.",
    "layoutFiles:",
    ...LAYOUT_FILES.map((rel) => `  ${rel}: "${sourceHashes[rel]}"`),
    "theme: dark",
    "languages: [en, zh]",
    "viewports:",
    "  - { name: desktop, width: 1440, height: 900 }",
    "  - { name: mobile, width: 390, height: 844 }",
    "surfaces: [PortfolioTargetsReadout]",
    "viewport_semantics: initial interaction sizes; actual per-image native capture sizes are recorded in CROP_GEOMETRY.json",
    "capture_flag: TERMINAL_E2E_FIXTURE",
    "capture_flag_law: next.config.ts sets devIndicators to false when TERMINAL_E2E_FIXTURE is set; this script starts next dev with the same flag.",
    "command: |",
    "  cd terminal",
    "  node e2e/tools/capture_b_f08_b5_1_targets.cjs",
    "captureFiles:",
    ...files.map(file => `  ${file}: "${captureFiles[file]}"`),
    "files:",
    ...files.map((name) => `  - ${name}`),
    "",
  ];
  writeFileSync(join(OUT, "CROP_GEOMETRY.json"), JSON.stringify({ capturedAtHead, crops: CROP_GEOMETRY }, null, 2) + "\n");
  writeFileSync(join(OUT, "NATIVE_READBACKS.json"), JSON.stringify({ capturedAtHead, readbacks: NATIVE_READBACKS }, null, 2) + "\n");
  for (const file of files) copyFileSync(join(CAPTURE_OUT, file), join(OUT, file));
  writeFileSync(join(OUT, "EVIDENCE.yml"), evidence.join("\n"), "utf8");
  console.log(`wrote ${files.length} crops + EVIDENCE.yml to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
