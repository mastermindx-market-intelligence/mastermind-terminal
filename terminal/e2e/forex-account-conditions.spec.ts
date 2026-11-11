import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);
const A = "10000000-0000-4000-8000-000000000001";
const ID = "30000000-0000-4000-8000-000000000001";
const saved = () => ({ id: ID, user_id: A, symbol: "USDJPY", active: false,
  created_at: "2026-10-21T12:00:00Z", condition: {
    type: "forex_price_close", schema_version: 1, condition_id: ID, revision: 1,
    kind: "price_close", pair: "USDJPY", quote_basis: "literal", interval: "4H",
    calendar: "fx-utc-4h/v1", operator: "lt", threshold: 149.5, consecutive: 2,
    expires_at: "2100-01-02T03:04:05.000Z", feed: null, origin_snapshot_id: "fixture-only",
  } });
const forexRow = (page: Page) => page.locator(`[data-forex-watch="${ID}"]`);

async function setup(page: Page, lang: "en" | "zh") {
  const owner = { rows: [saved()], mode: "ack", deletes: [] as URL[], patches: 0 };
  await page.addInitScript((language) => { localStorage.setItem("mm.lang", language); }, lang);
  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: { symbols: {} } }));
  await page.route("**/api/alerts**", async (route) => {
    const request = route.request();
    if (request.method() === "DELETE") {
      owner.deletes.push(new URL(request.url()));
      if (owner.mode === "unknown") return route.fulfill({ status: 503, json: { state: "unconfirmed" } });
      owner.rows = [];
      return route.fulfill({ json: { ok: true, id: ID, deleted: true } });
    }
    if (request.method() === "PATCH") { owner.patches++; return route.fulfill({ status: 409, json: { state: "unavailable" } }); }
    return route.fulfill({ json: { alerts: owner.rows } });
  });
  await page.goto("/alerts");
  await expect(forexRow(page)).toBeVisible({ timeout: 45_000 });
  return owner;
}

for (const lang of ["en", "zh"] as const) {
  test(`Forex saved inactive presentation and bulk activation exclusion — ${lang}`, async ({ page }, testInfo) => {
    const owner = await setup(page, lang);
    const row = forexRow(page);
    await expect(row).toContainText(lang === "zh" ? "已保存 · 未启用" : "Saved · inactive");
    await expect(page.locator(".ph").filter({ hasText: lang === "zh" ? "已保存提醒与条件" : "Saved alerts and conditions" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(lang === "zh" ? "1 条被跟踪" : "1 tracked");
    await expect(row).toContainText(lang === "zh" ? "4小时收盘价 < 149.5 · 连续2次" : "4H close < 149.5 · 2 consecutive closes");
    await expect(row).toContainText("2100-01-02 03:04:05 UTC");
    await expect(row).toContainText(lang === "zh" ? "版本 1" : "Version 1");
    await expect(row.getByRole("button", { name: lang === "zh" ? "重新启用" : "Re-arm", exact: true })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText('"schema_version"');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("forex-saved-inactive.png"), fullPage: true });
    await page.locator("[data-bulk-open]").click();
    await page.locator("[data-bulk-select-shown]").click();
    await page.locator('[data-bulk-review-open="resume"]').click();
    await expect(page.locator('[data-bulk-review-group="skip-forex"]')).toBeVisible();
    await expect(page.locator("[data-bulk-confirm]")).toBeDisabled();
    expect(owner.patches).toBe(0);
  });
  test(`Forex deletion binds account and revision and survives reload — ${lang}`, async ({ page }) => {
    const owner = await setup(page, lang);
    await forexRow(page).locator(".icbtn").click();
    await forexRow(page).locator(".btn-danger").click();
    await expect(forexRow(page)).toHaveCount(0);
    expect(owner.deletes).toHaveLength(1);
    expect(owner.deletes[0].searchParams.get("expected_user_id")).toBe(A);
    expect(owner.deletes[0].searchParams.get("expected_revision")).toBe("1");
    expect(owner.deletes[0].searchParams.get("type")).toBe("forex_price_close");
    await page.reload();
    await expect(page.locator('[data-alerts-state="empty"]')).toBeVisible();
    expect(owner.deletes).toHaveLength(1);
  });
  test(`Forex uncertain delete is reconciled by reads without replay — ${lang}`, async ({ page }) => {
    const owner = await setup(page, lang);
    owner.mode = "unknown";
    await forexRow(page).locator(".icbtn").click();
    await forexRow(page).locator(".btn-danger").click();
    await expect(page.locator('[data-forex-delete="unconfirmed"]')).toBeVisible();
    await expect(forexRow(page).locator(".icbtn")).toBeDisabled();
    await page.locator('[data-forex-delete="unconfirmed"] button').click();
    await expect(page.locator('[data-forex-delete="unconfirmed"]')).toBeVisible();
    expect(owner.deletes).toHaveLength(1);
    owner.rows = []; // The original deletion becomes visible after the uncertain response.
    await page.locator('[data-forex-delete="unconfirmed"] button').click();
    await expect(forexRow(page)).toHaveCount(0);
    await expect(page.locator('[data-alerts-state="empty"]')).toBeVisible();
    expect(owner.deletes).toHaveLength(1);
  });
}
