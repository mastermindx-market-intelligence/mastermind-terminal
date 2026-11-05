import { test, expect, type Page } from "@playwright/test";
import type { Bar6 } from "../lib/intradayShared";
import { renderAsGuest } from "./layoutStore";

const NOW = Date.parse("2026-10-27T15:00:02Z");
const START = Date.parse("2026-10-27T09:30:00Z") / 1000;
const SYMBOLS = ["SPY", "XLC", "XLY", "XLP", "XLE", "XLF", "XLV", "XLI", "XLB", "XLRE", "XLK", "XLU"];
type Mode = "normal" | "delayed" | "benchmark" | "access";
function bars(symbol: string) {
  const step = symbol === "SPY" ? .05 : symbol === "XLP" ? -.1 : .2;
  const values: Bar6[] = Array.from({ length: 18 }, (_, i) => {
    const p = 100 + i * step;
    return [START + i * 300, p, p + .1, p - .1, p, 1000];
  });
  return { bars: values, source_evidence: { schema: "terminal.intraday_source_evidence.v1", symbol,
    requested_timeframe: "5m", session: "regular", timestamp_basis: "market_local_display_epoch",
    source_counts: { stored_5m: 18 }, assembly_clock: { cache_state: "new_assembly" },
    point_in_time_availability: "not_verified", completeness: "not_assessed" } };
}
async function fixture(page: Page, mode: () => Mode) {
  let quoteRequests = 0, barRequests = 0;
  await page.clock.install({ time: new Date(NOW) });
  await page.route("**/api/quote?**", async route => {
    if (!new URL(route.request().url()).searchParams.get("syms")?.includes("XLC")) return route.continue();
    quoteRequests++;
    if (mode() === "access") return route.fulfill({ status: 403, json: { error: "access" } });
    const delayed = mode() === "delayed";
    const quotes = Object.fromEntries(SYMBOLS.map(symbol => {
      if (symbol === "XLU" || (mode() === "benchmark" && symbol === "SPY")) return [symbol, null];
      const pct = symbol === "SPY" ? 1 : symbol === "XLP" ? -.5 : 2;
      return [symbol, {
        market: "us", regularSessionDate: "2026-10-27", regularSession: "rth", marketSession: "rth",
        regularPrice: 100 + pct, prevClose: 100, regularChg: pct,
        source: delayed ? "polygon-snapshot" : "polygon-snapshot-rt", anchor_source: "snapshot",
        basis: delayed ? "DELAYED_15M" : "REALTIME", asOfMs: NOW - (delayed ? 900_000 : 2_000),
      }];
    }));
    return route.fulfill({ json: { quotes } });
  });
  await page.route("**/api/intraday?**", route => {
    barRequests++;
    const symbol = new URL(route.request().url()).searchParams.get("sym")!;
    if (mode() === "benchmark" && symbol === "SPY") return route.fulfill({ status: 503, json: { error: "missing" } });
    return route.fulfill({ json: bars(symbol) });
  });
  return { quotes: () => quoteRequests, bars: () => barRequests };
}
async function open(page: Page) {
  await page.goto("/discover?tab=rs-pivot");
  await page.getByRole("button", { name: "Open rotation monitor", exact: true }).click();
}
test.beforeEach(async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", url: baseURL! }]);
});

test("rotation observations open beside the study, refresh and transfer a sector into RS × 30m", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const reads = await fixture(page, () => "normal");
  await page.goto("/discover?tab=rs-pivot");
  expect(reads.quotes()).toBe(0); expect(reads.bars()).toBe(0);
  await page.getByRole("button", { name: "Open rotation monitor", exact: true }).click();
  const tech = page.getByTestId("rotation-row-XLK");
  await expect(tech.locator('[data-metric="relative"]')).toHaveText("+0.99%");
  await expect(tech.locator('[data-metric="30"]')).toContainText("%");
  await expect(page.getByTestId("rotation-coverage")).toContainText("10 / 11");
  await expect(page.getByTestId("rotation-row-XLU").locator('[data-metric="relative"]')).toHaveText("Unavailable");
  await expect(page.getByTestId("rotation-row-XLP").locator('[data-metric="5"]')).toContainText("−");
  await page.clock.runFor(5_100);
  await expect.poll(reads.quotes).toBe(2);
  expect(reads.bars()).toBe(12);
  await page.getByRole("button", { name: "Study XLK in RS × 30m", exact: true }).click();
  await expect(page.getByLabel("Equity ticker", { exact: true })).toHaveValue("XLK");
  await expect(page.getByLabel("Equity ticker", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Benchmark", { exact: true })).toHaveValue("SPY");
  const panel = page.getByTestId("rotation-monitor");
  const width = await panel.evaluate(element => ({
    right: element.getBoundingClientRect().right, viewport: window.innerWidth,
    rootFits: document.documentElement.scrollWidth <= window.innerWidth,
  }));
  expect(width.rootFits).toBe(true); expect(width.right).toBeLessThanOrEqual(width.viewport + 1);
  await panel.getByRole("heading", { name: "Rotation monitor", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "docs/rotation-regime/r1/" + info.project.name + "-en.png" });
  await page.getByRole("button", { name: "Close monitor", exact: true }).click();
  const before = reads.quotes(); await page.clock.runFor(70_000); expect(reads.quotes()).toBe(before);
  expect(errors).toEqual([]);
});

test("delayed, missing benchmark and denied access never masquerade as current leadership", async ({ page }) => {
  let mode: Mode = "delayed";
  const reads = await fixture(page, () => mode);
  await open(page);
  const tech = page.getByTestId("rotation-row-XLK");
  await expect(tech).toContainText("Delayed print");
  await expect(tech.locator('[data-metric="relative"]')).toHaveText("+0.99%");
  await page.getByRole("button", { name: "Close monitor", exact: true }).click();
  mode = "benchmark";
  await page.getByRole("button", { name: "Open rotation monitor", exact: true }).click();
  await expect(tech.locator('[data-metric="absolute"]')).toHaveText("+2.00%");
  await expect(tech.locator('[data-metric="relative"]')).toHaveText("SPY unavailable");
  await expect(tech.locator('[data-metric="30"]')).toHaveText("SPY unavailable");
  await expect(page.getByTestId("rotation-coverage")).toContainText("0 / 11");
  mode = "access";
  await page.clock.runFor(5_100);
  await expect(page.getByTestId("rotation-monitor")).toContainText("Source access is unavailable");
  await expect(tech).toHaveCount(0);
  const before = reads.quotes(); await page.clock.runFor(70_000); expect(reads.quotes()).toBe(before);
});

test("Chinese monitor remains readable and exposes actual clock details", async ({ page }, info) => {
  await fixture(page, () => "normal");
  await page.addInitScript(() => localStorage.setItem("mm.lang", "zh"));
  await page.goto("/discover?tab=rs-pivot");
  await page.getByRole("button", { name: "打开轮动监测", exact: true }).click();
  await expect(page.getByTestId("rotation-row-XLK").locator('[data-metric="30"]')).toContainText("%");
  await page.getByText("来源详情", { exact: true }).click();
  await expect(page.getByTestId("rotation-monitor")).toContainText("接收时间不代表价格时效");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByTestId("rotation-monitor").screenshot({ path: "docs/rotation-regime/r1/" + info.project.name + "-zh.png" });
});

test("guest cannot start rotation source reads", async ({ page, baseURL }) => {
  await renderAsGuest(page, baseURL);
  const reads = await fixture(page, () => "normal");
  await page.goto("/discover?tab=rs-pivot");
  await expect(page.getByRole("button", { name: "Open rotation monitor", exact: true })).toBeDisabled();
  expect(reads.quotes()).toBe(0); expect(reads.bars()).toBe(0);
});


test("R2 opening-range preview uses the existing visible source reader and responsive chart", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const reads = await fixture(page, () => "normal");
  await open(page);
  const preview = page.getByTestId("rotation-pivot-preview");
  await expect(preview.getByRole("heading", { name: "Opening-range pivot preview" })).toBeVisible();
  await expect(page.getByTestId("rotation-pivot-chart")).toBeVisible();
  await expect(page.getByTestId("rotation-pivot-bottom")).toHaveAttribute("data-state", /^(watching|approaching|forming|confirmed|failed|expired)$/);
  await expect(page.getByTestId("rotation-pivot-top")).toBeVisible();
  await expect(preview).toContainText("not an issued watch or a forecast");
  const chart = await page.getByTestId("rotation-pivot-chart").locator("svg").evaluate(node => ({
    userWidth: (node as SVGSVGElement).viewBox.baseVal.width,
    cssWidth: node.getBoundingClientRect().width,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    // A known level must never paint a line across bars that preceded its origin.
    levelKnownX: Number(node.querySelector('[data-testid="rotation-pivot-known-at-line"]')?.getAttribute("x1")),
    supportStartsX: Number(node.querySelector('[data-testid="rotation-pivot-level-bottom"]')?.getAttribute("x1")),
    resistanceStartsX: Number(node.querySelector('[data-testid="rotation-pivot-level-top"]')?.getAttribute("x1")),
  }));
  expect(Math.abs(chart.userWidth - chart.cssWidth)).toBeLessThan(2);
  expect(chart.documentWidth).toBeLessThanOrEqual(chart.viewportWidth);
  expect(chart.levelKnownX).toBeGreaterThan(54);
  expect(chart.supportStartsX).toBeCloseTo(chart.levelKnownX, 5);
  expect(chart.resistanceStartsX).toBeCloseTo(chart.levelKnownX, 5);
  expect(reads.bars()).toBe(12);
  await page.getByTestId("rotation-pivot-sector").selectOption("XLP");
  await expect(preview).toContainText("Opening-range low");
  await preview.screenshot({ path: "docs/rotation-regime/r2/" + info.project.name + "-en.png" });
  expect(errors).toEqual([]);
});

test("R2 missing common benchmark interval withholds reconstructed chart and outcome", async ({ page }) => {
  await fixture(page, () => "benchmark");
  await open(page);
  await expect(page.getByTestId("rotation-pivot-preview")).toBeVisible();
  await expect(page.getByTestId("rotation-pivot-unavailable")).toContainText("Comparable completed 5m sector/SPY interval unavailable");
  await expect(page.getByTestId("rotation-pivot-chart")).toHaveCount(0);
  await expect(page.getByTestId("rotation-pivot-bottom")).toHaveCount(0);
});

test("R2 Chinese source evidence and mobile layout remain distinct from trading authority", async ({ page }, info) => {
  await fixture(page, () => "normal");
  await page.addInitScript(() => localStorage.setItem("mm.lang", "zh"));
  await page.goto("/discover?tab=rs-pivot");
  await page.getByRole("button", { name: "打开轮动监测", exact: true }).click();
  const preview = page.getByTestId("rotation-pivot-preview");
  await expect(preview).toContainText("开盘区间枢轴预览");
  await expect(preview).toContainText("不是已发布的观察或预测");
  await expect(page.getByTestId("rotation-pivot-chart")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await preview.screenshot({ path: "docs/rotation-regime/r2/" + info.project.name + "-zh.png" });
});

// ── R2 light-theme product proof ──────────────────────────────────────────────
// Fixture/local product proof of the R2 opening-range preview under the app's
// light theme root: the incumbent synthetic 5m fixture and fixed clock above,
// never current market data, a real account or a production path. One fresh
// context per language, expanded across the three source-owned responsive
// projects; each context shows the normal qualified preview and the existing
// missing-SPY benchmark state.
const LIGHT_PROOF_DIR = "docs/rotation-regime/r2/light/";
const LIGHT_TEXT = {
  en: { title: "Opening-range pivot preview", low: "Opening-range low", high: "Opening-range high",
        unavailable: "Comparable completed 5m sector/SPY interval unavailable" },
  zh: { title: "开盘区间枢轴预览", low: "开盘区间低点", high: "开盘区间高点",
        unavailable: "板块与SPY的可比已完成5分钟区间不可用" },
};
for (const lang of ["en", "zh"] as const) {
  test(`R2 light-theme product proof (${lang})`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let mode: Mode = "normal";
    // The existing appearance/language storage, set before any navigation.
    await page.addInitScript(l => {
      localStorage.setItem("theme", "light");
      localStorage.setItem("theme_auto", "0");
      localStorage.setItem("mm.lang", l);
    }, lang);
    await fixture(page, () => mode);
    await page.goto("/discover?tab=rs-pivot");
    // Storage alone leaves layout.tsx's server dark attribute unchanged, so the
    // app's existing CSS theme root is set explicitly — the same applied-theme
    // switch the accepted terminal light/dark evidence uses.
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
    const preview = page.getByTestId("rotation-pivot-preview");
    const open = page.getByRole("button", { name: lang === "zh" ? "打开轮动监测" : "Open rotation monitor", exact: true });
    await open.click();
    await expect(preview).toBeVisible();
    await expect(preview.getByRole("heading", { name: LIGHT_TEXT[lang].title, exact: true })).toBeVisible();
    await expect(preview).toContainText(LIGHT_TEXT[lang].low);
    await expect(preview).toContainText(LIGHT_TEXT[lang].high);
    // The other language's strings must not leak into this view.
    await expect(preview).not.toContainText(LIGHT_TEXT[lang === "en" ? "zh" : "en"].title);
    await expect(page.getByTestId("rotation-pivot-chart")).toBeVisible();
    await expect(page.getByTestId("rotation-pivot-bottom")).toHaveAttribute("data-state", /^(watching|approaching|forming|confirmed|failed|expired)$/);
    await expect(page.getByTestId("rotation-pivot-top")).toHaveAttribute("data-state", /^(watching|approaching|forming|confirmed|failed|expired)$/);
    const chart = await page.getByTestId("rotation-pivot-chart").locator("svg").evaluate(node => ({
      userWidth: (node as SVGSVGElement).viewBox.baseVal.width,
      cssWidth: node.getBoundingClientRect().width,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      levelKnownX: Number(node.querySelector('[data-testid="rotation-pivot-known-at-line"]')?.getAttribute("x1")),
      supportStartsX: Number(node.querySelector('[data-testid="rotation-pivot-level-bottom"]')?.getAttribute("x1")),
      resistanceStartsX: Number(node.querySelector('[data-testid="rotation-pivot-level-top"]')?.getAttribute("x1")),
      firstBarX: Number(/M([0-9.]+)/.exec(node.querySelector("path")?.getAttribute("d") ?? "")?.[1]),
    }));
    expect(Math.abs(chart.userWidth - chart.cssWidth)).toBeLessThan(2);
    expect(chart.documentWidth).toBeLessThanOrEqual(chart.viewportWidth);
    expect(chart.levelKnownX).toBeGreaterThan(chart.firstBarX);
    expect(chart.supportStartsX).toBeCloseTo(chart.levelKnownX, 5);
    expect(chart.resistanceStartsX).toBeCloseTo(chart.levelKnownX, 5);
    // The sector control stays usable and the real reader updates on selection.
    const sector = page.getByTestId("rotation-pivot-sector");
    const context = page.getByTestId("rotation-pivot-context");
    await expect(sector).toBeEnabled();
    await expect(sector).toHaveValue("XLK");
    const xlkContext = await context.innerText();
    await sector.selectOption("XLP");
    await expect(sector).toHaveValue("XLP");
    await expect.poll(() => context.innerText()).not.toBe(xlkContext);
    await expect(preview).toContainText(LIGHT_TEXT[lang].low);
    await sector.selectOption("XLK");
    await expect(sector).toHaveValue("XLK");
    await expect.poll(() => context.innerText()).toBe(xlkContext);
    expect(await preview.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    // The applied theme is read back, not inferred from the requested file name.
    const themeEvidence = await preview.evaluate(el => ({
      actualTheme: document.documentElement.getAttribute("data-theme"),
      actualLang: document.documentElement.getAttribute("data-lang"),
      foreground: getComputedStyle(el).color,
      background: getComputedStyle(el).backgroundColor,
    }));
    await info.attach("actual-theme", { body: JSON.stringify(themeEvidence), contentType: "application/json" });
    expect(themeEvidence.actualTheme).toBe("light");
    expect(themeEvidence.actualLang).toBe(lang);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await preview.screenshot({ path: LIGHT_PROOF_DIR + info.project.name + "-" + lang + "-preview.png" });
    // The normal close path returns to the closed monitor.
    await page.getByRole("button", { name: lang === "zh" ? "关闭监测" : "Close monitor", exact: true }).click();
    await expect(preview).toHaveCount(0);
    // The existing missing-SPY benchmark state withholds the inadmissible output.
    mode = "benchmark";
    await open.click();
    await expect(preview).toBeVisible();
    await expect(page.getByTestId("rotation-pivot-unavailable")).toContainText(LIGHT_TEXT[lang].unavailable);
    await expect(page.getByTestId("rotation-pivot-chart")).toHaveCount(0);
    await expect(page.getByTestId("rotation-pivot-bottom")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
    await preview.screenshot({ path: LIGHT_PROOF_DIR + info.project.name + "-" + lang + "-missing-spy.png" });
    expect(errors).toEqual([]);
  });
}
