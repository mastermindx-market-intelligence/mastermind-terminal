import { expect, test } from "@playwright/test";
import { dataRows, moveSelect, openPanel, openScreener, prepare } from "./smartScreensFixture";

// Real mounted Screener and existing isolated account route. Only the scan is routed.
// This comparison never saves B or changes A's definition/review/revision.
const row = (chg: number | null, last: number | null = 50) => ({
  name: "Threshold fixture", last, chg, vol: 2_000_000, sec: "Equities", mkt: "NASDAQ",
});
const scan = {
  as_of: "2026-10-13",
  symbols: { AAA: row(4), BBB: row(5), CCC: row(1), DDD: row(null), EEE: row(3.5), FFF: row(7, null) },
};

test.setTimeout(150_000);
for (const zh of [false, true]) {
  test(`saved A and unsaved B compare one fixed scan without writes (${zh ? "zh" : "en"})`, async ({ page, baseURL }, info) => {
    await prepare(page.context(), baseURL!, `j6-${info.project.name}-${zh}-${Date.now()}`, zh);
    await page.route("**/data/manifest.json**", route => route.fulfill({ json: scan }));
    await openScreener(page, 5);
    await moveSelect(page).selectOption("up3");
    await expect(dataRows(page)).toHaveCount(3);
    const panel = await openPanel(page);
    await expect(panel).toHaveAttribute("data-ss-status", "ready");
    await panel.locator("[data-ss-name-input]").fill("Momentum A");
    await panel.locator("[data-ss-save-button]").click();
    const saved = panel.locator("[data-ss-screen]");
    await expect(saved).toHaveCount(1);
    await expect(saved).toHaveAttribute("data-ss-rev", "1");
    const beforeResponse = await page.request.get("/api/smart-screens");
    expect(beforeResponse.ok()).toBe(true);
    const before = await beforeResponse.json();
    expect(before.screens).toHaveLength(1);
    let writes = 0;
    page.on("request", request => {
      if (new URL(request.url()).pathname === "/api/smart-screens" && request.method() !== "GET") writes++;
    });

    await saved.locator("[data-ss-compare]").click();
    const preview = saved.locator("[data-ss-assumption]");
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("data-ss-assumption-as-of", "2026-10-13");
    await expect(preview.locator("[data-ss-assumption-source]")).toContainText("6");
    await expect(preview).toContainText(zh ? "不是时间上的进出" : "not entries or exits in time");
    const threshold = preview.locator("[data-ss-assumption-threshold]");
    const apply = preview.locator("[data-ss-assumption-apply]");
    const syms = (bucket: string) => preview.locator(`[data-ss-assumption-group="${bucket}"] [data-ss-assumption-sym]`);
    await threshold.fill("4.5");
    await apply.click();
    await expect(syms("both")).toHaveText(["BBB"]);
    await expect(syms("aOnly")).toHaveText(["AAA", "EEE"]);
    await expect(syms("bOnly")).toHaveCount(0);
    await expect(preview.locator('[data-ss-assumption-coverage-bucket="unknown"]')).toContainText("DDD");
    await expect(preview.locator('[data-ss-assumption-coverage-bucket="unpriced"]')).toContainText("FFF");
    await expect(preview.locator('[data-ss-assumption-coverage-bucket="failed"]')).toContainText("CCC");
    await expect(preview.locator("[data-ss-assumption-def-a]")).toContainText("3");
    await expect(preview.locator("[data-ss-assumption-def-b]")).toContainText("4.5");
    await preview.screenshot({ path: info.outputPath("raised-threshold.png") });

    // Changing the surrounding table is not an edit to the captured saved definition.
    await moveSelect(page).selectOption("any");
    await expect(dataRows(page)).toHaveCount(5);
    await threshold.fill("0.5");
    await apply.click();
    await expect(syms("both")).toHaveText(["AAA", "BBB", "EEE"]);
    await expect(syms("aOnly")).toHaveCount(0);
    await expect(syms("bOnly")).toHaveText(["CCC"]);
    await expect(preview.locator('[data-ss-assumption-coverage-bucket="unknown"]')).toContainText("DDD");
    await expect(preview.locator("[data-ss-assumption-def-a]")).toContainText("3");
    await preview.screenshot({ path: info.outputPath("lowered-threshold.png") });
    await threshold.fill("");
    await apply.click();
    await expect(preview.locator('[data-ss-assumption-refusal="bad_threshold"]')).toBeVisible();
    await expect(preview.locator("[data-ss-assumption-summary]")).toHaveCount(0);
    await preview.locator("[data-ss-assumption-close]").click();
    await expect(preview).toHaveCount(0);
    expect(writes).toBe(0);
    const after = await page.request.get("/api/smart-screens");
    expect(after.ok()).toBe(true);
    expect(await after.json()).toEqual(before);

    await page.reload();
    const reopened = await openPanel(page);
    await expect(reopened.locator("[data-ss-assumption]")).toHaveCount(0);
    await expect(reopened.locator("[data-ss-screen]")).toHaveAttribute("data-ss-rev", "1");
    await expect(reopened.locator("[data-ss-definition]")).toContainText("3");
    expect(writes).toBe(0);
  });
}
