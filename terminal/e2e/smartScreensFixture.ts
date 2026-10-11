import { expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

// Shared world for the E04 smart-screens journey and its opt-in crop generator. Not a spec file —
// Playwright's default testMatch only collects *.spec.ts, so this module is imported, never run.
//
// The account half is the real `/api/smart-screens` route on the fixture database (one store per
// `mm_e2e_wl` key); a "device" is a browser context with its own localStorage. The scan is a routed
// manifest whose generation the caller flips, so a review compares two declared source dates.

export type Gen = "g1" | "g2";

const row = (chg: number | null) => ({ name: "Fixture Co", last: 50, chg, vol: 2_000_000, sec: "Equities", mkt: "NASDAQ" });

export const MANIFESTS: Record<Gen, unknown> = {
  g1: { as_of: "2026-10-09", symbols: { AAA: row(4), BBB: row(5), CCC: row(1), DDD: row(6), EEE: row(3.5) } },
  // BBB falls to +1.25% (a genuine exit) · CCC rises (a genuine entry) · DDD loses its day move
  // (unknown — NOT an exit) · EEE leaves the scan (coverage) · FFF joins the scan (coverage).
  g2: { as_of: "2026-10-10", symbols: { AAA: row(4.5), BBB: row(1.25), CCC: row(3.2), DDD: row(null), FFF: row(7) } },
};

export const dataRows = (page: Page) => page.locator("tbody tr .sym-cell");
/** The day-move filter, found by an option value so it is language-independent. */
export const moveSelect = (page: Page) => page.locator("select.scr2-select:has(option[value='up3'])");
export const panel = (page: Page) => page.locator("[data-smart-screens]");

export async function prepare(context: BrowserContext, baseURL: string, storeKey: string, zh: boolean, guest = false) {
  await context.addCookies([
    { name: "mm_e2e_rs30", value: "1", url: baseURL },
    { name: "mm_e2e_wl", value: storeKey, url: baseURL },
    ...(guest ? [{ name: "mm_e2e_guest", value: "1", url: baseURL }] : []),
  ]);
  await context.addInitScript((lang) => {
    localStorage.setItem("mm.lang", lang);
    document.documentElement.setAttribute("data-lang", lang);
  }, zh ? "zh" : "en");
}

export async function routeManifest(page: Page, gen: () => Gen) {
  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: MANIFESTS[gen()] }));
}

export async function openScreener(page: Page, rows: number) {
  await page.goto("/discover?tab=screener");
  await expect(dataRows(page)).toHaveCount(rows, { timeout: 45_000 });
}

export async function openPanel(page: Page): Promise<Locator> {
  const root = panel(page);
  await expect(root).not.toHaveAttribute("data-ss-status", "loading", { timeout: 20_000 });
  await root.locator("[data-ss-toggle]").click();
  return root;
}

export async function secondDevice(browser: Browser, page: Page, hasTouch: boolean, baseURL: string, key: string, zh: boolean) {
  const context = await browser.newContext({ baseURL, viewport: page.viewportSize(), hasTouch });
  await prepare(context, baseURL, key, zh);
  return { context, page: await context.newPage() };
}
