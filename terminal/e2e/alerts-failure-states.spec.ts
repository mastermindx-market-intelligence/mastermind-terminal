import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * B2 + B3 — the /api/alerts truth boundary, from the user's side.
 *
 * B2: a failed read used to answer `200 {alerts: []}`, and the view rendered "No alerts yet" —
 *     telling a signed-in user their alert inventory is empty on the strength of a query that
 *     never ran. The four facts (signed out · empty · rows · store unavailable) must each have
 *     their own rendering, and a failed REFRESH must not replace rows that are already loaded.
 * B3: a failed delete used to answer `{ok:true}`, so the optimistic row-removal looked
 *     successful until the row silently came back on the next load.
 */

test.setTimeout(90_000);

const MANIFEST = { symbols: { NVDA: { name: "NVIDIA", last: 182.5 }, SPY: { name: "SPDR S&P 500", last: 701.2 } } };

const alertRow = (symbol: string, id: string) => ({
  id,
  symbol,
  active: true,
  created_at: "2026-08-19T12:00:00Z",
  condition: { type: "signal", target: "BUY" },
});

const state = (page: Page, name: string) => page.locator(`[data-alerts-state="${name}"]`);
const rows = (page: Page) => page.locator(".arow");

/** GET behaviour is switchable so a Retry inside the same tab hits a different world. */
type GetMode = "ok" | "503" | "abort" | "empty";

async function installAlertsApi(
  page: Page,
  cfg: { get: () => GetMode; list: () => unknown[]; onDelete?: (route: Route, id: string) => Promise<void> },
) {
  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/alerts**", async (route) => {
    const req = route.request();
    if (req.method() === "DELETE") {
      const id = new URL(req.url()).searchParams.get("id") || "";
      if (cfg.onDelete) return cfg.onDelete(route, id);
      return route.fulfill({ json: { ok: true, deleted: true } });
    }
    if (req.method() !== "GET") return route.fulfill({ json: {} });
    switch (cfg.get()) {
      case "503":   return route.fulfill({ status: 503, json: { error: "alerts unavailable" } });
      case "abort": return route.abort("failed");
      case "empty": return route.fulfill({ json: { alerts: [] } });
      default:      return route.fulfill({ json: { alerts: cfg.list() } });
    }
  });
}

test("an unreadable alert store is its own state — never 'No alerts yet'", async ({ page }, testInfo) => {
  const zh = testInfo.project.name === "tablet";
  let mode: GetMode = "503";
  const list: unknown[] = [alertRow("NVDA", "a1"), alertRow("SPY", "a2")];

  await page.addInitScript((lang) => {
    localStorage.setItem("mm.lang", lang);
    document.documentElement.setAttribute("data-lang", lang);
  }, zh ? "zh" : "en");
  await installAlertsApi(page, { get: () => mode, list: () => list });

  await page.goto("/alerts");
  await expect(state(page, "unavailable")).toBeVisible({ timeout: 45_000 });
  await expect(state(page, "empty")).toHaveCount(0);          // the lie the bug told
  await expect(page.locator(".panel .ph .sub")).toHaveCount(0); // no "0 total" over an unread list
  await expect(page.locator(".alerts-unavailable .alerts-signedout-h"))
    .toHaveText(zh ? "无法加载您的提醒" : "Could not load your alerts");

  // A transport failure is the same fact by a different route.
  mode = "abort";
  await page.locator(".alerts-unavailable button").click();
  await expect(state(page, "unavailable")).toBeVisible();

  // Retry into a healthy store: the same tab recovers, no reload.
  mode = "ok";
  await page.locator(".alerts-unavailable button").click();
  await expect(rows(page)).toHaveCount(2);
  await expect(state(page, "unavailable")).toHaveCount(0);
  await expect(page.locator(".panel .ph .sub")).toContainText("2");
});

test("a signed-in user with zero alerts still gets the empty state, not a failure", async ({ page }) => {
  await installAlertsApi(page, { get: () => "empty", list: () => [] });
  await page.goto("/alerts");
  await expect(state(page, "empty")).toBeVisible({ timeout: 45_000 });
  await expect(state(page, "unavailable")).toHaveCount(0);
  await expect(page.locator(".panel .ph .sub")).toContainText("0");
});

test("a failed REFRESH keeps the rows already on screen, labelled", async ({ page }) => {
  let mode: GetMode = "ok";
  await installAlertsApi(page, { get: () => mode, list: () => [alertRow("NVDA", "a1"), alertRow("SPY", "a2")] });

  await page.goto("/alerts");
  await expect(rows(page)).toHaveCount(2, { timeout: 45_000 });

  // Break the store and re-read through the panel's own refresh control. The rows we already
  // hold are still the last thing the authority actually said — replacing them with [] would
  // be the same lie one beat later.
  mode = "503";
  await page.locator(".alerts-refresh").click();
  await expect(state(page, "stale")).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  await expect(state(page, "empty")).toHaveCount(0);
  await expect(state(page, "unavailable")).toHaveCount(0);   // rows exist: this is stale, not blank

  // The label clears the moment a read lands again.
  mode = "ok";
  await page.locator(".alerts-stale button").click();
  await expect(state(page, "stale")).toHaveCount(0);
  await expect(rows(page)).toHaveCount(2);
});

test("a delete that fails server-side restores the row and says so; the retry sticks", async ({ page }) => {
  let deleteMode: "503" | "ok" = "503";
  let list = [alertRow("NVDA", "a1"), alertRow("SPY", "a2")];

  await installAlertsApi(page, {
    get: () => "ok",
    list: () => list,
    onDelete: async (route, id) => {
      if (deleteMode === "503") return route.fulfill({ status: 503, json: { error: "Could not delete alert" } });
      list = list.filter((r) => (r as { id: string }).id !== id);
      return route.fulfill({ json: { ok: true, deleted: true } });
    },
  });

  await page.goto("/alerts");
  await expect(rows(page)).toHaveCount(2, { timeout: 45_000 });

  // 1. optimistic removal → 2. API reports failure → 3. row restored → 4. visible error
  await rows(page).first().locator(".icbtn").click();
  await page.locator(".arow-confirm .btn-danger").click();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator(".alert-err, .err")).toContainText(/delete|删除/i);

  // 5. a successful retry removes it durably — still gone after a full reload
  deleteMode = "ok";
  await rows(page).first().locator(".icbtn").click();
  await page.locator(".arow-confirm .btn-danger").click();
  await expect(rows(page)).toHaveCount(1);
  await page.reload();
  await expect(rows(page)).toHaveCount(1);
});
