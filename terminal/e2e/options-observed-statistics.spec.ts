import { expect, test } from "@playwright/test";
import fixture from "./fixtures/options-observed-statistics.json";

for (const lang of ["en", "zh"]) {
  test(`Statistics preserves partial coverage, stale source and symbol absence (${lang})`, async ({ page }, testInfo) => {
    await page.addInitScript(lang => { localStorage.setItem("mm.lang", lang); Reflect.deleteProperty(window, "EventSource"); }, lang);
    const data = { ...fixture, stale: true, root_catalog: [{ root: "SPY", scheduled_this_cycle: true, source_ok_this_cycle: false, last_source_success: "2026-10-24T14:00:01Z" }] };
    await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "meta", route => route.fulfill({ json: data }));
    await page.goto("/options?tab=statistics");
    const workspace = page.locator("#wpanel-statistics");
    await expect(workspace.locator('[data-statistics-state="available"]')).toBeVisible();
    await expect(workspace.locator('[data-statistics-stale="true"]')).toBeVisible();
    await expect(workspace).toContainText(lang === "zh" ? "最近计划的数据源请求失败" : "Latest scheduled source request failed");
    await expect(workspace).toContainText(lang === "zh" ? "这不是市场份额" : "This is not market share");
    await expect(workspace).toContainText("$600.00");
    await expect(workspace).toContainText("int:0");
    await expect(workspace.getByRole("heading", { name: lang === "zh" ? "成交位置" : "Execution location", exact: true })).toBeVisible();
    const bounds = await page.evaluate(() => ({ width: innerWidth, doc: document.documentElement.scrollWidth }));
    expect(bounds.doc).toBeLessThanOrEqual(bounds.width + 1);
    await page.screenshot({ path: testInfo.outputPath(`statistics-${lang}.png`), fullPage: false });
    await workspace.getByRole("heading", { name: lang === "zh" ? "统计范围" : "What these counts cover", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`statistics-${lang}-coverage.png`), fullPage: false });
    if (lang === "zh") {
      // Read-only compatibility specimen; production theme selection is unchanged.
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
      await page.screenshot({ path: testInfo.outputPath("statistics-light-compatibility.png"), fullPage: false });
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    }

    await workspace.getByLabel(lang === "zh" ? "代码" : "Symbol", { exact: true }).fill("QQQ");
    await workspace.getByRole("button", { name: lang === "zh" ? "查看" : "View", exact: true }).click();
    await expect(workspace.locator('[data-statistics-state="unavailable"]')).toBeVisible();
    await expect(workspace).toContainText(lang === "zh" ? "未知，并非为零" : "unknown, not zero");
    await expect(workspace).not.toContainText("$600.00");
    await page.locator("#wtab-cat-flow").click();
    await expect(page).toHaveURL(/tab=tape/);
    await expect(workspace).toHaveCount(0);
  });
}

test("Statistics withholds absent and corrupt snapshots without invented zeros", async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem("mm.lang", "en"); Reflect.deleteProperty(window, "EventSource"); });
  await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "meta", route => route.fulfill({ json: {} }));
  await page.goto("/options?tab=statistics");
  await expect(page.locator('[data-statistics-state="unavailable"]')).toContainText("No qualified observations yet");
  await expect(page.locator("#wpanel-statistics table")).toHaveCount(0);
  await page.unrouteAll({ behavior: "wait" });
  const bad = structuredClone(fixture); bad.observed_statistics.roots.SPY.totals.print_count = 500;
  await page.route(url => url.pathname === "/api/flow" && url.searchParams.get("f") === "meta", route => route.fulfill({ json: bad }));
  await page.reload();
  await expect(page.locator('[data-statistics-state="invalid"]')).toContainText("could not be verified");
  await expect(page.locator("#wpanel-statistics table")).toHaveCount(0);
});
