import { expect, test, type Page } from "./fixtures";

/**
 * B1 — a Screener manifest failure must be a STATE, not a permanent skeleton.
 *
 * `dataCache` turns every HTTP/network failure into a resolved `null` and never rejects, so the
 * view's `.then(m => { if (m) apply(m) })` did nothing at all on an outage and its `.catch` was
 * unreachable: `loaded` stayed false, the shimmer rows spun forever, and the Retry button — which
 * already existed — could never be rendered.
 *
 * Each case injects the ACTUAL failure mechanism at the transport (abort / 500 / unparseable body
 * / 404), then proves the same tab recovers through Retry with no reload. Restoring the old
 * `if (m) apply(m)` behaviour fails every case here on the skeleton assertion.
 */

// /discover is a cold dev-server route in the fully-parallel matrix; the first navigation of
// each project pays its compile. The assertions themselves resolve in milliseconds.
test.setTimeout(90_000);

const MANIFEST = {
  as_of: "2026-08-19",
  symbols: {
    NVDA: { name: "NVIDIA", last: 182.5, chg: 1.2, vol: 210_000_000, sec: "stock", mkt: "NASDAQ" },
    AAPL: { name: "Apple", last: 233.1, chg: -0.4, vol: 48_000_000, sec: "stock", mkt: "NASDAQ" },
  },
};

type Fault = "abort" | "500" | "malformed" | "404" | "ok";

const skeleton = (page: Page) => page.locator(".scr2-skel-row");
const fault = (page: Page) => page.locator("[data-scr-fault]");
const retryBtn = (page: Page) => page.locator(".fin-empty button.chip");
const dataRows = (page: Page) => page.locator("tbody tr .sym-cell");

/** One handler whose behaviour the test flips, so a Retry hits a different world in the same tab. */
async function installManifestRoute(page: Page, read: () => Fault) {
  await page.route("**/data/manifest.json**", async (route) => {
    switch (read()) {
      case "abort":     return route.abort("failed");
      case "500":       return route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"origin down"}' });
      case "malformed": return route.fulfill({ status: 200, contentType: "application/json", body: "<!doctype html><html>edge error page</html>" });
      case "404":       return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"not found"}' });
      default:          return route.fulfill({ json: MANIFEST });
    }
  });
}

test("a manifest outage shows the failure state with a working Retry, never an endless skeleton", async ({ page }, testInfo) => {
  // zh on one viewport project: the failure copy is user-facing and must not leak the other language.
  const zh = testInfo.project.name === "tablet";
  let mode: Fault = "abort";

  await page.addInitScript((lang) => {
    localStorage.setItem("mm.lang", lang);
    document.documentElement.setAttribute("data-lang", lang);
  }, zh ? "zh" : "en");
  await installManifestRoute(page, () => mode);

  // ── 1. transport failure (offline / aborted): the state the bug rendered as a spinner ──
  await page.goto("/discover?tab=screener");
  await expect(fault(page)).toHaveAttribute("data-scr-fault", "unavailable", { timeout: 45_000 });
  await expect(skeleton(page)).toHaveCount(0);                  // the skeleton is GONE, not spinning
  await expect(retryBtn(page)).toBeVisible();
  await expect(page.locator(".fin-empty-title")).toHaveText(zh ? "无法加载扫描" : "Could not load the scan");
  await expect(page.locator(".fin-empty-why")).toContainText(zh ? "行情清单加载失败" : "failed to load");

  // ── 2. Retry into a 500: still unavailable, still recoverable ──
  mode = "500";
  await retryBtn(page).click();
  await expect(fault(page)).toHaveAttribute("data-scr-fault", "unavailable");
  await expect(retryBtn(page)).toBeVisible();

  // ── 3. Retry into a 200 whose body is not JSON (an edge/origin error page) ──
  mode = "malformed";
  await retryBtn(page).click();
  await expect(fault(page)).toHaveAttribute("data-scr-fault", "unavailable");
  await expect(retryBtn(page)).toBeVisible();
  await expect(page.locator(".fin-empty-title")).not.toHaveText(zh ? "没有匹配结果" : "No matches");

  // ── 4. Retry into a real manifest: the same tab recovers with no reload ──
  mode = "ok";
  await retryBtn(page).click();
  await expect(fault(page)).toHaveCount(0);
  await expect(dataRows(page).first()).toBeVisible({ timeout: 20_000 });
  await expect(dataRows(page)).toHaveCount(2);
  await expect(skeleton(page)).toHaveCount(0);
});

test("a 404 manifest reads as not published, and the negative cache does not block Retry", async ({ page }) => {
  let mode: Fault = "404";
  await installManifestRoute(page, () => mode);

  await page.goto("/discover?tab=screener");
  // 404/410 is the ONE case where the artifact itself answered: it is absence, not an outage,
  // and the why-line must not blame the reader's connection.
  await expect(fault(page)).toHaveAttribute("data-scr-fault", "absent", { timeout: 45_000 });
  await expect(page.locator(".fin-empty-why")).toContainText("not published");
  await expect(skeleton(page)).toHaveCount(0);

  // A 404 is remembered for the session (that is what stops repeat 404 storms), so Retry has to
  // clear it — otherwise the button would be decorative.
  mode = "ok";
  await retryBtn(page).click();
  await expect(fault(page)).toHaveCount(0);
  await expect(dataRows(page)).toHaveCount(2);
});

test("an empty-but-real manifest is the EMPTY state, never the failure state", async ({ page }) => {
  await page.route("**/data/manifest.json**", (route) =>
    route.fulfill({ json: { as_of: "2026-08-19", symbols: {} } }));

  await page.goto("/discover?tab=screener");
  await expect(page.locator(".fin-empty-title")).toHaveText("No matches", { timeout: 45_000 });
  await expect(fault(page)).toHaveCount(0);                     // zero rows is an ANSWER, not a fault
  await expect(retryBtn(page)).toHaveCount(0);
  await expect(skeleton(page)).toHaveCount(0);
});
