import { expect, test, type Page } from "@playwright/test";
import { FUNDAMENTAL_FIELD_IDS } from "@/lib/fundamentalScan";
import { projectFundamental } from "@/lib/fundamentalScanProducer";
import { SCREENER_SCAN_SCHEMA } from "@/lib/screenerScan";
import { fundDoc, JUNCO_ANNUAL, SEPCO_ANNUAL, type Col } from "../lib/__tests__/fixtures/fundamentalScan/fundDoc";

/**
 * E02 — period-aware fundamental screening, end to end in the browser.
 *
 * The scan the Screener reads is built HERE by the producer's own projector
 * (`projectFundamental`, the function the nightly generator runs over every fund.json) from
 * independently constructed, hand-checkable companies — so the browser sees exactly what a
 * published generation would carry, and every expected number below can be checked by hand:
 *
 *   SEPCO   Sep FY, FY2025 ends 2025-09-27: net income 180 / revenue 1200 = exactly 15%; P/E 25.5
 *   JUNCO   Jun FY, FY2025 ends 2025-06-30: 45 / 450 = 10%;                               P/E 14
 *   BANKCO  bank statement family: industrial margins are not applicable;                 P/E 9
 *   LOSSCO  Dec FY: −250 / 500 = −50%; P/E −3 (earnings ≤ 0 → no meaningful P/E, never "cheap")
 *   GONE    no fund.json at all
 *
 * The fund.json routes serve the SAME documents, so the evidence drawer's "file" value is an
 * independent re-projection of the company artifact, not a copy of the screen's number.
 */

test.setTimeout(120_000);

// Fixed wall clock: snapshot (14d), fiscal-period (548d) and generation (4d) freshness are all
// judged against "now", so a real clock would turn these fixtures stale on a calendar date.
const NOW = new Date("2026-10-11T12:00:00Z");
const GEN = Date.parse("2026-10-11T00:00:00Z") / 1000 - 3600;

const BANK: Col[] = [
  { label: "2024", end: "2024-12-31", revenue: 160, ni: 50, equity: 300 },
  { label: "2025", end: "2025-12-31", revenue: 170, ni: 54, equity: 360 },
];
const LOSS: Col[] = [
  { label: "2024", end: "2024-12-31", revenue: 400, gp: 40, ni: -100, equity: 500 },
  { label: "2025", end: "2025-12-31", revenue: 500, gp: 25, ni: -250, equity: 250 },
];

const FUND: Record<string, Record<string, unknown>> = {
  SEPCO: fundDoc("SEPCO", { pe: 25.5, annual: SEPCO_ANNUAL }),
  JUNCO: fundDoc("JUNCO", { pe: 14, annual: JUNCO_ANNUAL }),
  BANKCO: fundDoc("BANKCO", { family: "bank", sector: "Financials", pe: 9, annual: BANK }),
  LOSSCO: fundDoc("LOSSCO", { pe: -3, annual: LOSS }),
};
// No symbol is a substring of another, so a row is found by a plain text match on its symbol cell.
const SYMS = ["SEPCO", "JUNCO", "BANKCO", "LOSSCO", "GONE"] as const;

const MANIFEST = {
  as_of: "2026-10-09",
  symbols: Object.fromEntries(
    SYMS.map((s, i) => [s, { name: `${s} Inc`, last: 50 + i, chg: 0.5, vol: 2_000_000, sec: "Equities", mkt: "NASDAQ" }]),
  ),
};

function scanDoc(): Record<string, unknown> {
  const rows = SYMS.map((sym) =>
    FUND[sym] ? { sym, ...projectFundamental(sym, FUND[sym]).observation } : { sym, status: "unavailable", reason: "fund_absent" },
  );
  return {
    schema: SCREENER_SCAN_SCHEMA,
    family: "fundamental",
    family_version: 1,
    generation: GEN,
    generated_at: new Date(GEN * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
    complete: true,
    universe: { source: "manifest", as_of: MANIFEST.as_of, count: rows.length },
    fields: [...FUNDAMENTAL_FIELD_IDS],
    rows,
  };
}

type ScanMode = "ok" | "404" | "500";

async function setup(page: Page, lang: "en" | "zh", scanMode: () => ScanMode = () => "ok") {
  await page.clock.setFixedTime(NOW);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    document.documentElement.setAttribute("data-lang", l);
  }, lang);
  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: MANIFEST }));
  // A dev checkout's coverage.json would pre-seed fund.json absences for these synthetic names.
  await page.route("**/data/coverage.json**", (route) => route.fulfill({ status: 404, json: { error: "not found" } }));
  await page.route("**/data/scan/fundamental.json**", (route) => {
    const m = scanMode();
    if (m === "404") return route.fulfill({ status: 404, json: { error: "not found" } });
    if (m === "500") return route.fulfill({ status: 500, json: { error: "origin down" } });
    return route.fulfill({ json: scanDoc() });
  });
  await page.route(/\/data\/[^/?]+\.fund\.json/, (route) => {
    const sym = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!.replace(/\.fund\.json$/, ""));
    const doc = FUND[sym];
    return doc ? route.fulfill({ json: doc }) : route.fulfill({ status: 404, json: { error: "not found" } });
  });
}

const bar = (page: Page) => page.locator("[data-fund-bar]");
const tableSyms = (page: Page) => page.locator("tbody tr .sym-cell");
const count = (page: Page, k: string) => page.locator(`[data-fund-tally] [data-fund-count="${k}"]`);
const cellOf = (page: Page, sym: string, field: string) =>
  page.locator("tbody tr", { has: page.locator(".sym-cell", { hasText: sym }) }).locator(`[data-fund-cell="${field}"]`);

async function openScreen(page: Page) {
  await page.goto("/discover?tab=screener");
  await expect(tableSyms(page)).toHaveCount(SYMS.length, { timeout: 60_000 });
  await page.locator("[data-fund-toggle]").click();
  await expect(bar(page)).toBeVisible();
  await expect(page.locator("[data-fund-scan]")).toHaveAttribute("data-fund-scan", "ready", { timeout: 20_000 });
}

async function addRange(page: Page, field: string, min: string, max: string, includeUnknown = false) {
  await page.locator("[data-fund-field-select]").selectOption(field);
  await bar(page).locator(".fin-toggle button").first().click(); // Range
  await page.locator("[data-fund-min]").fill(min);
  await page.locator("[data-fund-max]").fill(max);
  const incl = page.locator("[data-fund-incl]");
  if ((await incl.isChecked()) !== includeUnknown) await incl.click();
  await page.locator("[data-fund-commit]").click();
}

const expectTally = async (page: Page, t: { matched: number; failed: number; excludedUnknown: number; population: number }) => {
  for (const [k, n] of Object.entries(t)) await expect(count(page, k)).toHaveAttribute("data-n", String(n));
};

for (const lang of ["en", "zh"] as const) {
  test(`[${lang}] net margin ≥ 15%: one scaling, counted unknowns, period evidence and the statement drilldown`, async ({ page }) => {
    await setup(page, lang);
    await openScreen(page);

    // ── AC-E02-02/05: the field's basis, inputs and coverage BEFORE filtering ──
    await expect(page.locator("[data-fund-detail]")).toHaveAttribute("data-fund-detail", "fund.net_margin_fy");
    const cov = page.locator('[data-fund-coverage="fund.net_margin_fy"]');
    await expect(cov).toHaveAttribute("data-fund-total", "5");
    await expect(cov.locator('[data-fund-status="evaluated"]')).toHaveAttribute("data-fund-n", "3");
    await expect(cov.locator('[data-fund-status="unsupported"]')).toHaveAttribute("data-fund-n", "1");
    await expect(cov.locator('[data-fund-status="unavailable"]')).toHaveAttribute("data-fund-n", "1");
    await expect(cov.locator('[data-fund-reason="family_not_applicable"]')).toHaveAttribute("data-fund-n", "1");
    await expect(cov.locator('[data-fund-reason="fund_absent"]')).toHaveAttribute("data-fund-n", "1");
    // AC-E02-04: the fiscal-year span of the known values, not the build clock
    await expect(cov.locator('[data-fund-period="fund.net_margin_fy"]')).toContainText("2025-06-30");
    await expect(cov.locator('[data-fund-period="fund.net_margin_fy"]')).toContainText("2025-12-31");

    // ── AC-E02-01: typed "15" is a 15% threshold, compared once (SEPCO sits EXACTLY on it) ──
    await addRange(page, "fund.net_margin_fy", "15", "");
    await expect(page.locator('[data-fund-chip="fund.net_margin_fy"]')).toContainText("15%");
    await expect(tableSyms(page)).toHaveCount(1);
    await expect(tableSyms(page).first()).toContainText("SEPCO");
    const sepco = cellOf(page, "SEPCO", "fund.net_margin_fy");
    await expect(sepco).toHaveText("15%");
    await expect(sepco).toHaveAttribute("data-fund-status", "evaluated");
    await expect(page.locator('th[data-fund-col="fund.net_margin_fy"]')).toHaveText(lang === "zh" ? /净利率财年/ : /Net mgn FY/);

    // ── AC-E02-05: the two known failures and the two withheld companies are each counted ──
    await expectTally(page, { matched: 1, failed: 2, excludedUnknown: 2, population: 5 });
    await expect(page.locator("[data-fund-toggle]")).toContainText(lang === "zh" ? "基本面 · 1" : "Fundamentals · 1");

    // ── AC-E02-04/06: the company evidence shows the exact period, and screen == file ──
    await sepco.click();
    const drawer = page.locator('[data-fund-evidence="SEPCO"]');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator("[data-fund-ev-fy]")).toHaveAttribute("data-fund-ev-fy", "2025");
    await expect(drawer.locator("[data-fund-ev-end]")).toHaveAttribute("data-fund-ev-end", "2025-09-27");
    await expect(drawer.locator("[data-fund-ev-asof]")).toHaveAttribute("data-fund-ev-asof", "2026-10-01");
    // SEPCO declares no statement family; the projector reports the legacy fallback it applied
    await expect(drawer.locator("[data-fund-ev-family]")).toHaveAttribute("data-fund-ev-family", "other");
    const nm = drawer.locator('[data-fund-ev-field="fund.net_margin_fy"]');
    await expect(nm).toHaveAttribute("data-fund-ev-same", "same");
    await expect(nm.locator('[data-fund-ev-screen="fund.net_margin_fy"] b')).toHaveText("15%");
    await expect(nm.locator('[data-fund-ev-file-value="fund.net_margin_fy"] b')).toHaveText("15%");
    // every field the projector produces agrees between the scan and the company file
    await expect(drawer.locator('[data-fund-ev-same="differs"]')).toHaveCount(0);
    await expect(drawer.locator('[data-fund-ev-same="same"]')).toHaveCount(FUNDAMENTAL_FIELD_IDS.length);
    await expect(drawer.locator('[data-fund-ev-field="fund.pe_ttm"] [data-fund-ev-screen="fund.pe_ttm"] b')).toHaveText("25.5×");
    await expect(drawer).toContainText(lang === "zh" ? "基本面证据" : "Fundamental evidence");

    // ── input → screen → statement: the drilldown opens the company's own statements ──
    const link = drawer.locator("[data-fund-ev-statements]");
    await expect(link).toHaveAttribute("href", "/terminal?pane=statements&sym=SEPCO");
    await link.click();
    await expect(page).toHaveURL(/\/terminal\?pane=statements&sym=SEPCO/, { timeout: 30_000 });
    await expect(page.locator(".fin-doc-per").filter({ hasText: "2025" }).first()).toBeVisible({ timeout: 60_000 });
  });
}

test("P/E ≤ 10×, only-unknown and include-unknown: a negative P/E is never a cheap valuation", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  await setup(page, lang);
  await openScreen(page);

  // ── AC-E02-03: LOSSCO's −3× P/E is unknown (earnings ≤ 0), so it can never pass "≤ 10×" ──
  await addRange(page, "fund.pe_ttm", "", "10");
  await expect(tableSyms(page)).toHaveCount(1);
  await expect(tableSyms(page).first()).toContainText("BANKCO");
  await expect(cellOf(page, "BANKCO", "fund.pe_ttm")).toHaveText("9.0×");
  await expectTally(page, { matched: 1, failed: 2, excludedUnknown: 2, population: 5 });
  const cov = page.locator('[data-fund-coverage="fund.pe_ttm"]');
  await expect(cov.locator('[data-fund-reason="earnings_nonpositive"]')).toHaveAttribute("data-fund-n", "1");
  await expect(cov.locator('[data-fund-reason="fund_absent"]')).toHaveAttribute("data-fund-n", "1");
  // TTM snapshot field → the coverage line names the snapshot date, not a fiscal year
  await expect(cov.locator('[data-fund-period="fund.pe_ttm"]')).toContainText("2026-10-01");

  // ── unknown is selectable only on purpose: "Only unknown" lists exactly the withheld rows ──
  await bar(page).locator(".fin-toggle button").nth(1).click();
  await page.locator("[data-fund-commit]").click();
  await expect(page.locator('[data-fund-chip="fund.pe_ttm"]')).toBeVisible();
  await expect(tableSyms(page)).toHaveCount(2);
  const loss = cellOf(page, "LOSSCO", "fund.pe_ttm");
  await expect(loss).toHaveText("—");
  await expect(loss).toHaveAttribute("data-fund-reason", "earnings_nonpositive");
  await expect(cellOf(page, "GONE", "fund.pe_ttm")).toHaveAttribute("data-fund-reason", "fund_absent");

  // ── include-unknown is a per-predicate opt-in, and the tally says how many it let in ──
  await page.locator('[data-fund-chip="fund.pe_ttm"]').click();
  await expect(tableSyms(page)).toHaveCount(5);
  await addRange(page, "fund.net_margin_fy", "15", "", true);
  await expect(tableSyms(page)).toHaveCount(3); // SEPCO + BANKCO (n/a) + GONE (absent)
  await expect(count(page, "includedUnknown")).toHaveAttribute("data-n", "2");
  await expect(cellOf(page, "BANKCO", "fund.net_margin_fy")).toHaveAttribute("data-fund-reason", "family_not_applicable");

  // a malformed bound is refused, not silently read as some other number
  await page.locator("[data-fund-min]").fill("abc");
  await page.locator("[data-fund-commit]").click();
  await expect(page.locator("[data-fund-error]")).toHaveAttribute("data-fund-error", "number");
  await expect(tableSyms(page)).toHaveCount(3);
});

test("an unpublished or failing scan is a stated state with Retry — never an empty or passing screen", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "mobile" ? "zh" : "en";
  let mode: ScanMode = "404";
  await setup(page, lang, () => mode);
  await page.goto("/discover?tab=screener");
  await expect(tableSyms(page)).toHaveCount(SYMS.length, { timeout: 60_000 });
  await page.locator("[data-fund-toggle]").click();

  const state = page.locator("[data-fund-scan]");
  await expect(state).toHaveAttribute("data-fund-scan", "absent", { timeout: 20_000 });
  await expect(state).toContainText(lang === "zh" ? "基本面扫描尚未发布" : "has not been published");
  await expect(page.locator("[data-fund-commit]")).toBeDisabled();
  await expect(tableSyms(page)).toHaveCount(SYMS.length); // the base screen is untouched

  mode = "500";
  await state.locator("button").click();
  await expect(state).toHaveAttribute("data-fund-scan", "error");
  await expect(page.locator("[data-fund-commit]")).toBeDisabled();

  mode = "ok";
  await state.locator("button").click();
  await expect(state).toHaveAttribute("data-fund-scan", "ready");
  await expect(page.locator("[data-fund-commit]")).toBeEnabled();
});
