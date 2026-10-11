import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expectTapTarget } from "./tapTarget";

/**
 * E03 — cross-market industry and currency-aware discovery, end to end in the Screener.
 *
 * The page reads two real artifacts, both served from committed fixtures rather than invented
 * here: the multi-market manifest the classification producer is tested against
 * (`tests/fixtures/classification/manifest.json`), and the classification scan that producer
 * emits for it (`lib/__tests__/fixtures/screenerScan/classification.producer.json` — the
 * producer's own drift test regenerates and compares it). So every count asserted below is a
 * count of what the shipped producer actually writes for those listings.
 *
 * The page clock is pinned to 2026-10-11T12:00Z: generation and label ages are evaluated against
 * it, and an unpinned clock would turn every label stale a few days after this was written.
 */

test.setTimeout(90_000);

const MANIFEST = JSON.parse(readFileSync(path.join(__dirname, "../../tests/fixtures/classification/manifest.json"), "utf8"));
const SCAN = JSON.parse(readFileSync(path.join(__dirname, "../lib/__tests__/fixtures/screenerScan/classification.producer.json"), "utf8"));
const NOW = new Date("2026-10-11T12:00:00Z");

type ScanMode = "ok" | "404" | "500";

async function open(page: Page, opts: { lang?: "en" | "zh"; scan?: () => ScanMode } = {}) {
  const scanMode = opts.scan ?? (() => "ok");
  await page.clock.setFixedTime(NOW);
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    document.documentElement.setAttribute("data-lang", l);
  }, opts.lang ?? "en");
  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/data/scan/classification.json**", (route) => {
    switch (scanMode()) {
      case "404": return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not found"}' });
      case "500": return route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"origin down"}' });
      default:    return route.fulfill({ json: SCAN });
    }
  });
  await page.goto("/discover?tab=screener");
  await expect(page.locator("tbody tr .sym-cell").first()).toBeVisible({ timeout: 45_000 });
}

/** A result row by its EXACT listing id — `0700.HK` must not also match `80700.HK`. */
const row = (page: Page, sym: string) =>
  page.locator("tbody tr").filter({
    has: page.locator(".tk").filter({ hasText: new RegExp(`^${sym.replace(/[.^$*+?()[\]{}|\\=]/g, "\\$&")}`) }),
  });
const resultRows = (page: Page) => page.locator("tbody tr .sym-cell");
const marketSelect = (page: Page) => page.locator('select.scr2-select:has(option[value="hk"])');
const mcapSelect = (page: Page) => page.locator('select.scr2-select:has(option[value="2000000000"])');
const control = (page: Page, id: "taxonomy" | "label" | "liq" | "ccy") => page.locator(`[data-cm-control="${id}"]`);
const search = (page: Page, q: string) => page.locator(".scr2-search").fill(q);

/** The Screener's selects are 30px, raised to 36px at the phone breakpoint (globals.css). */
const selectFloor = (ti: TestInfo) => (ti.project.name === "mobile" ? 36 : 30);
/** The strip's buttons are 28px, raised to 36px at ≤860px or under a coarse pointer. */
const stripButtonFloor = (ti: TestInfo) => (ti.project.name === "desktop" ? 28 : 36);

/** Switch language the way the account-prefs store does (lib/i18n applyLang) — no reload. */
async function switchLang(page: Page, l: "en" | "zh") {
  await page.evaluate((lang) => {
    localStorage.setItem("mm.lang", lang);
    document.documentElement.setAttribute("data-lang", lang);
    window.dispatchEvent(new CustomEvent("mm:lang"));
  }, l);
}

test("two listings of one issuer keep their own id, currency and label (AC-E03-01/02)", async ({ page }, testInfo) => {
  // zh on one project: the taxonomy chip and the unclassified copy are user-facing.
  const zh = testInfo.project.name === "tablet";
  await open(page, { lang: zh ? "zh" : "en" });

  await search(page, "Tencent");
  await expect(resultRows(page)).toHaveCount(2, { timeout: 20_000 });
  const hkd = row(page, "0700.HK");
  const cny = row(page, "80700.HK");
  await expect(hkd.locator(".tk [data-ccy]")).toHaveText("HKD");
  await expect(cny.locator(".tk [data-ccy]")).toHaveText("CNY");
  // The money cell carries the listing's own unit — never a USD default.
  await expect(hkd.locator("td[data-ccy]")).toHaveAttribute("data-ccy", "HKD");
  await expect(cny.locator("td[data-ccy]")).toHaveAttribute("data-ccy", "CNY");
  // Every label names its taxonomy; a listing without one says so instead of borrowing its twin's.
  await expect(hkd.locator("td.scr2-sec [data-tax]")).toHaveAttribute("data-tax", "yahoo_sector");
  await expect(hkd.locator("td.scr2-sec [data-tax]")).toContainText("YF");
  await expect(hkd.locator("td.scr2-sec [data-tax]")).not.toHaveAttribute("data-stale", "1");
  await expect(cny.locator("td.scr2-sec [data-tax]")).toHaveCount(0);
  await expect(cny.locator("td.scr2-sec [data-unclassified]")).toHaveAttribute("data-unclassified", "not_classified");
  await expect(cny.locator("td.scr2-sec [data-unclassified]")).toHaveText(zh ? "未分类" : "Unclassified");

  // The ADR and the Hong Kong line of one issuer: USD vs HKD, two ids.
  await search(page, "Alibaba");
  await expect(resultRows(page)).toHaveCount(2);
  await expect(row(page, "BABA").locator(".tk [data-ccy]")).toHaveText("USD");
  await expect(row(page, "9988.HK").locator(".tk [data-ccy]")).toHaveText("HKD");
});

test("a GICS screen excludes stale labels by name until opted in (AC-E03-02/03)", async ({ page }, testInfo) => {
  await open(page);
  await marketSelect(page).selectOption("us");
  await control(page, "taxonomy").selectOption("gics_sector");
  await control(page, "label").selectOption("Information Technology");
  await expectTapTarget(control(page, "taxonomy"), { height: selectFloor(testInfo) });
  await expectTapTarget(control(page, "label"), { height: selectFloor(testInfo) });

  const strip = page.locator('[data-cm="taxonomy"]');
  await expect(strip).toHaveAttribute("data-cm-taxonomy", "gics_sector", { timeout: 20_000 });
  await expect(strip).toContainText("MSCI / S&P Dow Jones Indices");
  await expect(strip).toContainText("version not stated");
  await expect(strip).toContainText("no crosswalk");
  await expect(strip.locator('[data-cm-count="current"] b')).toHaveText("2");
  await expect(strip.locator('[data-cm-count="stale"] b')).toHaveText("5");
  await expect(strip.locator('[data-cm-count="unclassified"] b')).toHaveText("9");

  // Only NVDA carries a CURRENT GICS IT label. AAPL's is the undated US snapshot — it is counted
  // and named as left out, never silently promoted to a current label.
  await expect(resultRows(page)).toHaveCount(1);
  await expect(row(page, "NVDA").locator("td.scr2-sec [data-tax]")).toHaveAttribute("data-tax", "gics_sector");
  await expect(row(page, "NVDA").locator("td.scr2-sec [data-tax]")).not.toHaveAttribute("data-stale", "1");
  await expect(strip.locator('[data-cm-excluded="stale"]')).toContainText("1 match only by a stale label");
  await expect(strip.locator('[data-cm-excluded="unclassified"]')).toContainText("9 have no label here");

  const stale = strip.locator('[data-cm-action="stale"]');
  await expectTapTarget(stale, { height: stripButtonFloor(testInfo) });
  await stale.click();
  await expect(stale).toHaveAttribute("aria-pressed", "true");
  await expect(resultRows(page)).toHaveCount(2);
  await expect(row(page, "AAPL").locator("td.scr2-sec [data-tax]")).toHaveAttribute("data-stale", "1");
  await expect(strip.locator('[data-cm-excluded="stale"]')).toHaveCount(0);

  // The listings without a label stay reachable: they are a population, not a footnote.
  const showUnc = strip.locator('[data-cm-action="unclassified"]');
  await expectTapTarget(showUnc, { height: stripButtonFloor(testInfo) });
  await showUnc.click();
  await expect(resultRows(page).first()).toBeVisible();
  await expect(page.locator("tbody td.scr2-sec [data-tax]")).toHaveCount(0);
  // Attached, not visible: at ≤640px the Screener has always hidden every column after the
  // fourth (globals.css), and the sector column is the seventh.
  await expect.poll(() => page.locator("tbody td.scr2-sec [data-unclassified]").count()).toBeGreaterThan(0);
});

test("a traded-value floor applies in one currency and counts what it could not compare (AC-E03-04)", async ({ page }, testInfo) => {
  await open(page);
  await control(page, "liq").selectOption("5000000");
  await expectTapTarget(control(page, "liq"), { height: selectFloor(testInfo) });

  const money = page.locator('[data-cm="money"]');
  await expect(money).toHaveAttribute("data-cm-scope", "USD", { timeout: 20_000 });
  await expect(money.locator('[data-cm-excluded="otherCurrency"]')).toContainText("14 in other currencies");
  await expect(money.locator('[data-cm-excluded="notMoney"]')).toContainText("4 indices");
  await expect(money.locator('[data-cm-excluded="currencyUnknown"]')).toHaveCount(0);
  // Every admitted row's traded value is in the scope currency — nothing local passed as USD.
  const units = await page.locator("tbody tr td[data-ccy]").evaluateAll((els) => els.map((e) => e.getAttribute("data-ccy")));
  expect(units.length).toBeGreaterThan(0);
  expect(new Set(units)).toEqual(new Set(["USD"]));

  // Hong Kong: the floor is KEPT and re-read in HKD; the CNY counter is counted, not compared.
  await marketSelect(page).selectOption("hk");
  await expect(money).toHaveAttribute("data-cm-scope", "HKD");
  await expect(money.locator('[data-cm-excluded="otherCurrency"]')).toContainText("1 in other currencies");
  await expect(page.locator('[data-cm="cleared"]')).toHaveCount(0);
  await expect(resultRows(page)).toHaveCount(2);
  await expect(row(page, "0700.HK")).toHaveCount(1);
  await expect(row(page, "9988.HK")).toHaveCount(1);
  await expect(page.locator(".scr2-ftag", { hasText: "HKD 5M" })).toHaveCount(1);

  // Scope switched to the counter's currency: below the floor there, so an EMPTY table — and the
  // empty state says how many listings were left out by currency rather than reading as nothing.
  await expectTapTarget(control(page, "ccy"), { height: selectFloor(testInfo) });
  await control(page, "ccy").selectOption("CNY");
  await expect(money).toHaveAttribute("data-cm-scope", "CNY");
  await expect(resultRows(page)).toHaveCount(0);
  await expect(page.locator("[data-cm-empty-excluded]")).toHaveAttribute("data-cm-empty-excluded", "2");
});

test("a market change keeps valid filters and clears incompatible ones by name (AC-E03-05)", async ({ page }, testInfo) => {
  await open(page);
  await mcapSelect(page).selectOption("2000000000");
  await control(page, "liq").selectOption("5000000");
  await marketSelect(page).selectOption("hk");

  const cleared = page.locator('[data-cm="cleared"]');
  await expect(cleared).toBeVisible({ timeout: 20_000 });
  await expect(cleared.locator('[data-cm-cleared="mcap"]')).toHaveCount(1);
  await expect(cleared.locator('[data-cm-cleared="liq"]')).toHaveCount(0);
  await expect(mcapSelect(page)).toHaveValue("0");
  await expect(control(page, "liq")).toHaveValue("5000000");
  // Not a false empty population: the Hong Kong listings above the HKD floor are listed.
  await expect(resultRows(page)).toHaveCount(2);

  const dismiss = cleared.getByRole("button");
  await expectTapTarget(dismiss, { height: stripButtonFloor(testInfo) });
  await dismiss.click();
  await expect(cleared).toHaveCount(0);

  // A taxonomy with no labels in the new market is cleared by name, not left to empty the table.
  await marketSelect(page).selectOption("all");
  await control(page, "taxonomy").selectOption("yahoo_sector");
  await marketSelect(page).selectOption("cn");
  await expect(cleared.locator('[data-cm-cleared="taxonomy"]')).toHaveCount(1);
  await expect(control(page, "taxonomy")).toHaveValue("");
  await expect(resultRows(page)).toHaveCount(3);
});

test("a language change keeps every filter and changes only how labels read (AC-E03-05)", async ({ page }) => {
  await open(page);
  await marketSelect(page).selectOption("hk");
  await control(page, "taxonomy").selectOption("yahoo_sector");
  await control(page, "label").selectOption("Communication Services");
  await control(page, "liq").selectOption("5000000");
  await expect(resultRows(page)).toHaveCount(1, { timeout: 20_000 });
  const tencent = row(page, "0700.HK");
  await expect(tencent.locator("td.scr2-sec [data-tax]")).toContainText("Communication Services");

  await switchLang(page, "zh");
  await expect(page.locator('[data-cm="taxonomy"]')).toContainText("雅虎财经板块");
  await expect(marketSelect(page)).toHaveValue("hk");
  await expect(control(page, "taxonomy")).toHaveValue("yahoo_sector");
  await expect(control(page, "label")).toHaveValue("Communication Services");
  await expect(control(page, "liq")).toHaveValue("5000000");
  await expect(resultRows(page)).toHaveCount(1);
  await expect(tencent.locator("td.scr2-sec [data-tax]")).not.toContainText("Communication Services");
  await expect(page.locator('[data-cm="cleared"]')).toHaveCount(0);

  await switchLang(page, "en");
  await expect(tencent.locator("td.scr2-sec [data-tax]")).toContainText("Communication Services");
  await expect(resultRows(page)).toHaveCount(1);
});

test("an absent or unreadable scan is a stated state with a working Retry (AC-E03-03)", async ({ page }, testInfo) => {
  let mode: ScanMode = "404";
  await open(page, { scan: () => mode });

  const state = page.locator('[data-cm="scan"]');
  await expect(state).toHaveAttribute("data-cm-state", "absent", { timeout: 20_000 });
  // The manifest still renders; the US snapshot label is shown, but marked stale and undated —
  // never as a current label.
  await search(page, "Apple");
  const apple = row(page, "AAPL");
  await expect(apple.locator("td.scr2-sec [data-tax]")).toHaveAttribute("data-stale", "1");
  await expect(apple.locator(".tk [data-ccy]")).toHaveCount(0);
  await expect(apple.locator("td[data-ccy]")).toHaveAttribute("data-ccy", "unknown");

  const retry = state.getByRole("button");
  await expectTapTarget(retry, { height: stripButtonFloor(testInfo) });
  mode = "500";
  await retry.click();
  await expect(state).toHaveAttribute("data-cm-state", "error");

  mode = "ok";
  await state.getByRole("button").click();
  await expect(state).toHaveCount(0);
  await expect(apple.locator(".tk [data-ccy]")).toHaveText("USD");
});

test("a row opens its own listing by its exact, encoded id (AC-E03-01)", async ({ page }) => {
  await open(page);
  await search(page, "GSPC");
  await expect(resultRows(page)).toHaveCount(1, { timeout: 20_000 });
  await expect(row(page, "^GSPC").locator("td[data-ccy]")).toHaveAttribute("data-ccy", "not_money");
  await row(page, "^GSPC").locator(".sym-cell").click();
  await page.waitForURL(/\/terminal\?sym=%5EGSPC$/, { waitUntil: "commit", timeout: 30_000 });
});
