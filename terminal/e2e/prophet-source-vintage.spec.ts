/** The real private Prophet masthead must not present publish time as source freshness. */
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const FIXTURE_FILE = path.join(process.cwd(), "test-fixtures", "prophet_stale_frame_fixture.json");

async function openWithSource(
  page: Page,
  lang: "en" | "zh",
  source: Record<string, unknown>,
): Promise<void> {
  const fixture = JSON.parse(await readFile(FIXTURE_FILE, "utf8")) as Record<string, unknown>;
  await page.route(
    url => url.pathname === "/api/flow" && url.searchParams.get("f") === "prophet_idx",
    async route => { await route.fulfill({ json: { ...fixture, asof: "2026-10-23", ...source } }); },
  );
  await page.goto("/options?tab=prophet");
  await expect(page.locator(".obs-prophet-signal").first()).toBeVisible({ timeout: 20_000 });
  if (lang === "zh") {
    await page.evaluate(() => {
      localStorage.setItem("mm.lang", "zh");
      document.documentElement.setAttribute("data-lang", "zh");
      window.dispatchEvent(new CustomEvent("mm:lang"));
    });
  }
}

for (const lang of ["en", "zh"] as const) {
  test(`Prophet discloses source older than its published close (${lang})`, async ({ page }) => {
    await openWithSource(page, lang, {
      source_asof: "2026-10-20", source_delayed: true, source_unknown: false,
      source_mixed_vintage: true,
    });
    const tile = page.getByTestId("prophet-source-vintage");
    await expect(tile).toBeVisible();
    await expect(tile).toContainText(lang === "zh" ? "数据截至" : "Data through");
    await expect(tile).toContainText("20");
    await expect(tile).toContainText(lang === "zh" ? "数据延迟" : "Delayed");
    await expect(tile).toContainText(lang === "zh" ? "数据时点不一致" : "Mixed vintages");
    const published = page.locator(".obs-prophet-stat").filter({
      hasText: lang === "zh" ? "模型收盘" : "Model close",
    });
    await expect(published).toContainText("23");
    await expect(published).not.toContainText("22");
    await expect(tile).not.toContainText("23");
  });
  test(`Prophet reports missing source date as unknown, never current (${lang})`, async ({ page }) => {
    await openWithSource(page, lang, { source_asof: null, source_unknown: true });
    const tile = page.getByTestId("prophet-source-vintage");
    await expect(tile).toContainText(lang === "zh" ? "来源日期未知" : "Source date unknown");
    await expect(tile).not.toContainText("23");
  });
}
