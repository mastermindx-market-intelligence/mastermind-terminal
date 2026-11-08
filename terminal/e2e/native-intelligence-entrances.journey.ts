import { expect, test, type Locator, type Page } from "@playwright/test";
import { prepareNativeEntrance, noHorizontalOverflow, recordSourceScope, observeNativeState, SOURCE_CLOCKS } from "./fixtures/native-intelligence-entrances";

// Additive P12.T2.S15.S4. Ordinary responsive projects, real AppShell + route pages
// + incumbent tools. No mocks of Next navigation, React, workspaces or membership.
// Runs only in the explicit ordinary-CI config after the canonical I3 import.
// No skip or preview bypass converts those missing prerequisites into green.
test.setTimeout(120_000);
async function keyboardActivate(link: Locator) {
  await link.scrollIntoViewIfNeeded(); await link.focus(); await expect(link).toBeFocused();
  const style = await link.evaluate(node => { const s = getComputedStyle(node); return { width: parseFloat(s.outlineWidth), style: s.outlineStyle }; });
  expect(style.width).toBeGreaterThanOrEqual(2); expect(style.style).not.toBe("none");
  await link.press("Enter");
}
async function primaryIntelligenceNav(page: Page, lang: "en" | "zh", narrow: boolean) {
  if (!narrow) return page.locator('[data-intelligence-nav="rail"]');
  const opener = page.getByRole("button", { name: lang === "zh" ? "打开导航" : "Open navigation", exact: true });
  await opener.focus(); await opener.press("Enter");
  await expect(page.locator(".m-drawer.open")).toBeVisible();
  return page.locator('.m-drawer.open [data-intelligence-nav="drawer"]');
}
for (const lang of ["en", "zh"] as const) {
  const t = (en: string, zh: string) => lang === "zh" ? zh : en;
  test(`new overview: rendered shell nav, independent clocks and one unavailable lane (${lang})`, async ({ page, baseURL }, info) => {
    const fixture = await prepareNativeEntrance(page, baseURL!, lang);
    await page.goto("/today");
    const nav = await primaryIntelligenceNav(page, lang, info.project.name !== "desktop");
    const overview = nav.locator('a[href="/intelligence"]');
    const hit = await overview.boundingBox(); expect(hit!.height).toBeGreaterThanOrEqual(44);
    await keyboardActivate(overview);
    await expect(page).toHaveURL(/\/intelligence$/);
    const root = page.locator("[data-intelligence-overview]");
    await expect(root.getByRole("heading", { level: 1 })).toHaveText(t("Market Intelligence", "市场情报"));
    const macro = root.locator('[data-intelligence-source="macro"]'), cycles = root.locator('[data-intelligence-source="cycles"]'), prophet = root.locator('[data-intelligence-source="prophet"]');
    for (const card of [macro, cycles, prophet]) await expect(card).toHaveAttribute("data-read-state", "ready");
    await expect(macro).toContainText(SOURCE_CLOCKS.macro); await expect(macro).not.toContainText("2099-01-01");
    await expect(cycles).toContainText(SOURCE_CLOCKS.cycles); await expect(cycles).not.toContainText(SOURCE_CLOCKS.macro);
    for (const stamp of [SOURCE_CLOCKS.prophet, SOURCE_CLOCKS.published, SOURCE_CLOCKS.price, SOURCE_CLOCKS.plan]) await expect(prophet).toContainText(stamp);
    await expect(prophet).toContainText(t("different source dates", "混合数据日期"));
    await expect(prophet.locator('a[href="/us_stocks.html"]')).toHaveText(t("Open opportunity workspace →", "打开机会工作台 →"));
    await expect(prophet.locator('a[href="/prophet"]')).toHaveText(t("Model plans & options", "模型计划与期权"));
    await expect(root.locator('a[href="/macro.html"]')).toBeVisible();
    await expect(root.locator('a[href="/sector_cycles.html"]')).toBeVisible();
    await observeNativeState(page, info, "overview-ready");
    fixture.setCycleUnavailable();
    await cycles.getByRole("button", { name: t("Try again: Sector Cycles", "重试: 行业周期"), exact: true }).click();
    await expect(cycles).toHaveAttribute("data-read-state", "unavailable");
    await expect(cycles.getByRole("status")).toContainText(t("does not mean risk is low", "并不代表风险较低"));
    await expect(cycles).not.toContainText(t("zero covered sectors", "零个已覆盖行业"));
    await expect(macro).toHaveAttribute("data-read-state", "ready"); await expect(prophet).toHaveAttribute("data-read-state", "ready");
    await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
    await expect(page.locator("html")).toHaveAttribute("data-theme", lang === "zh" ? "light" : "dark");
    await noHorizontalOverflow(page);
    await observeNativeState(page, info, "overview-unavailable");
    expect(fixture.writes).toEqual([]); expect(fixture.foreign).toEqual([]);
    await recordSourceScope(page, info, fixture.readPaths);
  });
  test(`new Prophet entrance mounts full incumbent lanes and preserves source-date unknown (${lang})`, async ({ page, baseURL }, info) => {
    const fixture = await prepareNativeEntrance(page, baseURL!, lang);
    await page.goto("/intelligence");
    const card = page.locator('[data-intelligence-source="prophet"]');
    await expect(card).toHaveAttribute("data-read-state", "ready");
    await keyboardActivate(card.locator('a[href="/prophet"]'));
    await expect(page).toHaveURL(/\/prophet$/);
    const tool = page.locator('[data-intelligence-tool="prophet"]');
    await expect(tool.getByRole("heading", { level: 1 })).toHaveText(t("Model plans & options", "模型计划与期权"));
    await expect(tool.locator(".obs-prophet-lane-shell")).toBeVisible();
    const tabs = tool.getByRole("tablist", { name: t("Prophet signal lanes", "预言台信号分区"), exact: true });
    await expect(tabs.getByRole("tab")).toHaveCount(3);
    await expect(tool.locator(".obs-prophet-signal").first()).toBeVisible();
    const vintage = tool.getByTestId("prophet-source-vintage");
    await expect(vintage).toContainText(t("Data through", "数据截至"));
    await expect(vintage).toContainText("28"); await expect(vintage).not.toContainText(t("Nov 2", "11月2日"));
    await expect(tool.locator(".obs-prophet-stat").filter({ hasText: t("Model close", "模型收盘") })).toContainText(t("Nov 2", "11月2日"));
    await observeNativeState(page, info, "prophet-ready");
    fixture.setSourceUnknown(); await page.reload();
    await expect(tool.getByTestId("prophet-source-vintage")).toContainText(t("Source date unknown", "来源日期未知"));
    await expect(tool.getByTestId("prophet-source-vintage")).not.toContainText("28");
    await expect(tool.locator('a[href="/us_stocks.html"]').first()).toBeVisible();
    await page.goBack(); await expect(page).toHaveURL(/\/intelligence$/);
    await expect(page.locator('[data-intelligence-source="macro"]')).toHaveAttribute("data-read-state", "ready");
    await noHorizontalOverflow(page); expect(fixture.writes).toEqual([]); expect(fixture.foreign).toEqual([]);
    await recordSourceScope(page, info, fixture.readPaths);
  });
  test(`new Sectors: company -> actual chart -> browser Back retains sector context (${lang})`, async ({ page, baseURL }, info) => {
    const fixture = await prepareNativeEntrance(page, baseURL!, lang);
    await page.goto("/intelligence");
    await keyboardActivate(page.locator('[data-intelligence-nav="context"] a[href="/sectors"]'));
    await expect(page).toHaveURL(/\/sectors$/);
    const tool = page.locator('[data-intelligence-tool="sectors"]');
    await expect(tool.getByTestId("sector-intelligence")).toBeVisible();
    await expect(tool.getByRole("heading", { level: 1 })).toHaveCount(1); // incumbent title owns ready state
    // Let the incumbent URL owner select a real published group, not a fabricated
    // Next page or a rewritten /discover route. The direct entrance is already proven.
    await page.goto(`/sectors?sector=xlk&group=semiconductors&sectorTheme=${lang === "zh" ? "light" : "dark"}&keep=native-i4`);
    const sector = page.getByTestId("sector-intelligence");
    await expect(sector.getByRole("heading", { name: t("Leading, with mixed timing", "领先，但时机信号不一致"), exact: true })).toBeVisible();
    await sector.getByRole("button", { name: t("Compare companies", "比较公司"), exact: true }).click();
    await sector.locator('[data-company-choice="NVDA"]').click();
    const inspector = page.getByTestId("sector-company-inspector");
    await expect(inspector).toContainText("NVDA");
    const sourceOpener = sector.getByRole("button", { name: t("Sources", "来源"), exact: true });
    const beforeEvidence = page.url();
    await sourceOpener.click();
    const evidence = page.getByRole("dialog", { name: t("Sources", "来源"), exact: true });
    await expect(evidence).toBeVisible();
    await expect(evidence).toContainText("2026-09-23"); // source observation, not read clock
    await expect(evidence).toContainText("2026-09-26T10:00:00Z");
    await evidence.getByText(t("Technical receipt", "技术凭据"), { exact: true }).first().click();
    await expect(evidence.getByText("/sectordata/sector_central.json", { exact: true })).toBeVisible();
    await observeNativeState(page, info, "sector-evidence");
    await evidence.getByRole("button", { name: t("Back to research", "返回研究"), exact: true }).click();
    await expect(evidence).toBeHidden(); await expect(page).toHaveURL(beforeEvidence);
    await expect(page.getByTestId("sector-company-inspector")).toContainText("NVDA");
    const sectorURL = page.url();
    const company = inspector.getByRole("link", { name: t("Open company research", "打开公司研究"), exact: true });
    await expect(company).toHaveAttribute("href", "/analysis?symbol=NVDA&page=overview");
    await company.click(); await expect(page).toHaveURL(/\/analysis\?symbol=NVDA&page=overview$/);
    const analysisURL = page.url();
    await expect(page.locator(".analysis-context-bar")).toContainText("NVDA");
    const chart = page.getByRole("button", { name: t("Back to chart", "返回图表"), exact: true });
    await chart.click(); await expect(page).toHaveURL(/\/terminal\?/);
    const chartURL = new URL(page.url());
    expect(chartURL.searchParams.get("symbol")).toBe("NVDA"); expect(chartURL.searchParams.get("ret")).toBe(analysisURL);
    // Real incumbent chart paint from the checkout's retained local NVDA files.
    await expect(page.locator(".mm-ptag")).toContainText("NVDA");
    await expect(page.locator(".chart-empty")).toBeHidden();
    await observeNativeState(page, info, "company-chart");
    await page.goBack(); await expect(page).toHaveURL(analysisURL);
    await expect(page.locator(".analysis-context-bar")).toContainText("NVDA");
    await page.goBack(); await expect(page).toHaveURL(sectorURL);
    await expect(page.getByTestId("sector-company-inspector")).toContainText("NVDA");
    expect(new URL(page.url()).searchParams.get("keep")).toBe("native-i4");
    await observeNativeState(page, info, "sector-return");
    await noHorizontalOverflow(page); expect(fixture.writes).toEqual([]); expect(fixture.foreign).toEqual([]);
    await recordSourceScope(page, info, fixture.readPaths);
  });
}
