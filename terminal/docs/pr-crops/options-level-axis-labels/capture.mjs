import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const terminalRoot = resolve(here, "../../..");
const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:35648";
const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: terminalRoot, encoding: "utf8" }).trim();
const expectedLinePrices = [192.42, 192.44, 192.46, 192.52, 192.58, 192.60];
const sourceFiles = [
  "components/ChartPanel.tsx",
  "lib/optionsLevels.ts",
  "lib/priceTagPlacement.ts",
];
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 390, height: 844 },
];

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const quotePayload = (syms) => Object.fromEntries(syms.map((sym) => [sym, sym === "NVDA" ? {
  sym,
  last: 192.53,
  close: 192.53,
  prevClose: 195.74,
  regularPrice: 192.53,
  regularChg: -1.64,
  regularSessionDate: "2026-06-26",
  basis: "DELAYED_15M",
  marketSession: "post",
  extPrice: 192.50,
  extChg: ((192.50 - 192.53) / 192.53) * 100,
  extTs: 1_786_550_400,
  extSession: "post",
} : null]));

const gex = {
  schema: "options_hub.gex/v1", root: "NVDA", asof: "2026-09-14",
  spot_ref: 192.50, call_wall: null, put_wall: null, gamma_flip: null,
  by_strike: [
    { strike: 192.46, gamma_net: 80, gamma_call: 100, gamma_put: -20 },
    { strike: 192.48, gamma_net: 10, gamma_call: 20, gamma_put: -10 },
  ],
};
const moves = {
  schema: "options_hub.moves/v1", root: "NVDA", asof: "2026-09-14",
  expected_move: { lo: 192.44, hi: 192.58 },
};
const state = {
  schema: "options_structure.gex_state/v1", root: "NVDA",
  asof: "2026-09-16T16:00:00-04:00", spot: 192.50,
  call_wall: 192.60, put_wall: 192.42, gamma_flip: 192.52, net_gex_bn: 0.11,
};

async function installRoutes(page) {
  // These optional terminal companions are absent in the reduced fixture checkout. Return honest
  // empty payloads so the screenshot receipt tests this feature, not unrelated 404 console noise.
  for (const path of [
    "**/data/coverage.json",
    "**/data/NVDA.intel.json",
    "**/data/NVDA.opts.json",
    "**/data/NVDA.fund.json",
    "**/api/brain/chart/state",
  ]) await page.route(path, async (route) => route.fulfill({ json: {} }));
  await page.route("**/api/quote?**", async (route) => {
    const url = new URL(route.request().url());
    const syms = (url.searchParams.get("syms") || "NVDA").split(",").filter(Boolean);
    await route.fulfill({ json: { quotes: quotePayload(syms) } });
  });
  await page.route("**/api/ext-quote?**", async (route) => {
    const url = new URL(route.request().url());
    const syms = (url.searchParams.get("syms") || "NVDA").split(",").filter(Boolean);
    const quotes = Object.fromEntries(syms.map((sym) => [sym, sym === "NVDA"
      ? { extPrice: 192.50, extChg: ((192.50 - 192.53) / 192.53) * 100, extTs: 1_786_550_400, extSession: "post" }
      : null]));
    await route.fulfill({ json: { quotes } });
  });
  await page.route("**/api/flow?**", async (route) => {
    const f = new URL(route.request().url()).searchParams.get("f");
    if (f === "gex:NVDA") return route.fulfill({ json: gex });
    if (f === "moves:NVDA") return route.fulfill({ json: moves });
    if (f === "gexstate:NVDA") return route.fulfill({ json: state });
    await route.continue();
  });
}

async function readProof(page) {
  return page.evaluate((expected) => {
    const labels = window.__mmPriceLabels?.() ?? null;
    const lines = window.__mmIndicatorPriceLines?.().optlevels ?? [];
    const wrap = document.querySelector(".chart-wrap")?.getBoundingClientRect();
    const visible = [
      ".mm-ptag", ".mm-exttag", ".mm-optlevel-tag",
      ".chart-fs-float", "[data-visual-context] > button[aria-controls]", ".lg-block",
    ]
      .flatMap((selector) => [...document.querySelectorAll(selector)])
      .filter((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
      })
      .map((element) => ({
        id: element.dataset.levelKey ?? element.className,
        lane: Number(element.dataset.lane ?? 0),
        box: (() => { const b = element.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; })(),
      }));
    const overlaps = [];
    for (let a = 0; a < visible.length; a++) for (let b = a + 1; b < visible.length; b++) {
      const A = visible[a].box, B = visible[b].box;
      if (A.left < B.right && A.right > B.left && A.top < B.bottom && A.bottom > B.top) overlaps.push(`${visible[a].id}/${visible[b].id}`);
    }
    const linePrices = lines.map((line) => line.price).sort((a, b) => a - b);
    return {
      labels,
      linePrices,
      exactLines: JSON.stringify(linePrices) === JSON.stringify(expected),
      nativeAxisLabelsSuppressed: lines.every((line) => line.axisLabelVisible === false),
      optionTagCount: document.querySelectorAll(".mm-optlevel-tag").length,
      visibleOptionTagCount: [...document.querySelectorAll(".mm-optlevel-tag")].filter((element) => getComputedStyle(element).display !== "none").length,
      overlaps,
      wrap: wrap ? { left: wrap.left, right: wrap.right, top: wrap.top, bottom: wrap.bottom, width: wrap.width, height: wrap.height } : null,
    };
  }, expectedLinePrices);
}

async function capture(browser, config) {
  const context = await browser.newContext({ viewport: { width: config.width, height: config.height } });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const httpErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 400) httpErrors.push({ status: response.status(), url: response.url() }); });
  await page.addInitScript(({ left, percentage }) => {
    localStorage.setItem("mm.inds", JSON.stringify(["optlevels"]));
    if (left || percentage) localStorage.setItem("mm.chartSettings", JSON.stringify({ scaleLeft: left, mode: percentage ? 2 : 0, scaleFontSize: 12 }));
  }, { left: !!config.left, percentage: !!config.percentage });
  await installRoutes(page);
  await page.goto(`${baseURL}/terminal?symbol=NVDA`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForSelector(".chart-wrap canvas", { state: "visible", timeout: 45_000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:set-eth", { detail: { on: true } })));
  await page.locator(".mm-optlevel-tag").first().waitFor({ state: "visible", timeout: 45_000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".mm-optlevel-tag")].filter((element) => getComputedStyle(element).display !== "none").length === 6, null, { timeout: 45_000 });
  const proof = await readProof(page);
  if (!proof.exactLines || !proof.nativeAxisLabelsSuppressed || proof.visibleOptionTagCount !== 6 || proof.overlaps.length) {
    throw new Error(`${config.name} proof failed: ${JSON.stringify(proof)}`);
  }
  const filename = `${config.name}.png`;
  const path = resolve(here, filename);
  await page.screenshot({ path, fullPage: false });
  await context.close();
  return {
    ...config,
    screenshot: filename,
    sha256: sha256(path),
    proof,
    consoleErrors,
    pageErrors,
    httpErrors,
  };
}

mkdirSync(here, { recursive: true });
const browser = await chromium.launch({ headless: true });
const captures = [];
try {
  for (const viewport of viewports) captures.push(await capture(browser, viewport));
  captures.push(await capture(browser, { name: "desktop-left-percentage", width: 1440, height: 900, left: true, percentage: true }));
  captures.push(await capture(browser, { name: "desktop-compact", width: 1440, height: 430 }));
} finally {
  await browser.close();
}
const manifest = {
  schema: "mastermind.options_level_axis_evidence/v1",
  capturedAt: new Date().toISOString(),
  sourceHead,
  baseURL,
  classification: "LOCAL_BROWSER_WITH_INTERCEPTED_OPTIONS_CONTRACT_PAYLOADS_NOT_PRODUCTION_DATA",
  expectedLinePrices,
  sourceFiles: Object.fromEntries(sourceFiles.map((relative) => [relative, sha256(resolve(terminalRoot, relative))])),
  captures,
};
writeFileSync(resolve(here, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ sourceHead, captures: captures.length, allPass: captures.every((capture) => capture.proof.exactLines && !capture.proof.overlaps.length) }, null, 2));
