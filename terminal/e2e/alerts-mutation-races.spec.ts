import { expect, test, type Page, type Route } from "@playwright/test";
import { ALERTS_CHANGED_EVENT } from "../lib/alertsView";
import path from "node:path";

test.setTimeout(90_000);
const makeRow = (id: string, symbol: string) => ({ id, symbol, active: true,
  created_at: "2026-10-10T12:00:00Z", condition: { type: "signal", target: "BUY" } });

async function fixture(page: Page, lang: "en" | "zh") {
  await page.addInitScript((lang) => {
    localStorage.setItem("mm.lang", lang); document.documentElement.dataset.lang = lang;
  }, lang);
  await page.route("**/data/manifest.json**", (r) => r.fulfill({ json: { symbols: { NVDA: {}, MSFT: {}, TSLA: {} } } }));
  await page.route("**/api/alerts/receipts", (r) => r.fulfill({ json: {
    run: null, runs_state: "READ_OK_ZERO", last_success_at: null,
    outbox: [], outbox_state: "READ_OK_ZERO",
  } }));
}
async function capture(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: path.join("docs/pr-crops/b-f08-mutation-races", name), fullPage: true });
}

for (const lang of ["en", "zh"] as const) {
  test(`${lang}: delayed create keeps the next draft and publishes the acknowledged row`, async ({ page }, info) => {
    await fixture(page, lang);
    let stored: ReturnType<typeof makeRow>[] = [];
    let pending: Route | undefined;
    let body: { symbol: string; condition: { value: number } } | undefined;
    let posts = 0;
    await page.route(/\/api\/alerts(\?.*)?$/, async (r) => {
      if (r.request().method() === "POST") { posts++; pending = r; body = r.request().postDataJSON(); return; }
      await r.fulfill({ json: { alerts: stored } });
    });
    await page.goto("/alerts");
    const form = page.locator(".alert-form");
    // The SSR picker is interactive before hydration; this form's manifest effect adds TSLA.
    await expect(form.locator('option[value="TSLA"]')).toBeAttached();
    const type = form.locator("select").filter({ has: page.locator('option[value="price_above"]') });
    await type.selectOption("price_above");
    const value = form.locator('input[type="number"]');
    await value.fill("100");
    await form.locator("button.btn-primary").click();
    await expect.poll(() => pending !== undefined).toBe(true);
    expect(body?.condition.value).toBe(100);
    await value.fill("200");
    const created = { ...makeRow("new", body!.symbol), condition: body!.condition };
    stored = [created as unknown as ReturnType<typeof makeRow>];
    await pending!.fulfill({ json: { alert: created } });
    await expect(page.locator(".arow .tk")).toHaveText(body!.symbol);
    await expect(form.locator("button.btn-primary")).toBeEnabled();
    await expect(value).toHaveValue("200"); expect(posts).toBe(1);
    await capture(page, `${info.project.name}-${lang}-newer-draft.png`);
  });

  test(`${lang}: stale refresh cannot resurrect an acknowledged deletion`, async ({ page }, info) => {
    await fixture(page, lang);
    let stored = [makeRow("a", "NVDA"), makeRow("b", "MSFT")];
    let phase: "initial" | "old" | "post" | "failed" = "initial";
    const oldReads: { route: Route; rows: typeof stored }[] = [];
    const postReads: Route[] = [];
    let deletes = 0;
    await page.route(/\/api\/alerts(\?.*)?$/, async (r) => {
      if (r.request().method() === "DELETE") {
        deletes++; stored = stored.filter((a) => a.id !== "a"); phase = "post";
        return r.fulfill({ json: { deleted: true } });
      }
      if (phase === "old") { oldReads.push({ route: r, rows: structuredClone(stored) }); return; }
      if (phase === "post") { postReads.push(r); return; }
      if (phase === "failed") return r.fulfill({ status: 503, json: { error: "unavailable" } });
      return r.fulfill({ json: { alerts: stored } });
    });
    await page.goto("/alerts");
    const deleted = page.locator(".arow").filter({ has: page.locator(".tk", { hasText: "NVDA" }) });
    await expect(deleted).toBeVisible();
    stored[1] = makeRow("b", "TSLA"); phase = "old";
    await page.locator(".alerts-refresh").click();
    await expect.poll(() => oldReads.length).toBe(1);
    await deleted.locator("button.icbtn").click();
    await deleted.locator("button").nth(1).click();
    await expect.poll(() => postReads.length).toBeGreaterThan(0);
    await oldReads[0].route.fulfill({ json: { alerts: oldReads[0].rows } });
    await expect(page.locator(".arow .tk", { hasText: "TSLA" })).toBeVisible();
    phase = "failed";
    await Promise.all(postReads.map((r) => r.fulfill({ status: 503, json: { error: "unavailable" } })));
    await expect(page.locator('[data-alerts-state="stale"]')).toBeVisible();
    await expect(deleted).toHaveCount(0); expect(deletes).toBe(1);
    await capture(page, `${info.project.name}-${lang}-deleted-row.png`);
  });
}
