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

// P12.T2.S15.S11: additive coverage. The original 18 cases/24 selected views
// above stay intact. These use real public presentation/Settings controls,
// normal scrolling and the same signed/read-only fixture. No CSS or UA zoom.
async function publicPresentation(page: Page, lang: "en" | "zh", theme: "light" | "dark") {
  const controls = page.locator(".shared-shell-presentation");
  const current = await page.locator("html").getAttribute("data-lang");
  if (current !== lang) {
    const language = controls.getByRole("button", { name: current === "zh" ? "中文界面" : "Chinese language", exact: true });
    await language.focus(); await language.press("Space");
    await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
  }
  if (await page.locator("html").getAttribute("data-theme") !== theme) {
    const toggle = controls.getByRole("button", { name: lang === "zh" ? "浅色主题" : "Light theme", exact: true });
    await toggle.focus(); await toggle.press("Space");
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}
async function samePresentation(page: Page, lang: "en" | "zh", theme: "light" | "dark") {
  await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await noHorizontalOverflow(page);
}

test("new entrances retain UI-selected EN Light and ZH Dark through full tools/company/chart/Return", async ({ page, baseURL }, info) => {
  const fixture = await prepareNativeEntrance(page, baseURL!, "en");
  await page.goto("/intelligence");
  for (const state of [{ lang: "en", theme: "light" }, { lang: "zh", theme: "dark" }] as const) {
    const { lang, theme } = state, t = (en: string, zh: string) => lang === "zh" ? zh : en;
    await publicPresentation(page, lang, theme);
    const root = page.locator("[data-intelligence-overview]");
    await expect(root.locator('[data-intelligence-source="macro"]')).toContainText(SOURCE_CLOCKS.macro);
    await expect(root.locator('[data-intelligence-source="cycles"]')).toContainText(SOURCE_CLOCKS.cycles);
    await expect(root.locator('[data-intelligence-source="prophet"]')).toContainText(SOURCE_CLOCKS.prophet);
    await expect(root).not.toContainText("2099-01-01");
    await samePresentation(page, lang, theme);
    await observeNativeState(page, info, lang === "en" ? "presentation-en-light" : "presentation-zh-dark");
    await keyboardActivate(root.locator('[data-intelligence-source="prophet"] a[href="/prophet"]'));
    await expect(page).toHaveURL(/\/prophet$/);
    const prophet = page.locator('[data-intelligence-tool="prophet"]');
    await expect(prophet.locator(".obs-prophet-lane-shell")).toBeVisible();
    await expect(prophet.getByTestId("prophet-source-vintage")).toContainText("28");
    await expect(prophet.getByTestId("prophet-source-vintage")).not.toContainText(t("Nov 2", "11月2日"));
    await samePresentation(page, lang, theme);
    await observeNativeState(page, info, lang === "en" ? "presentation-prophet-en-light" : "presentation-prophet-zh-dark");
    await page.goBack(); await expect(page).toHaveURL(/\/intelligence$/);
    await keyboardActivate(page.locator('[data-intelligence-nav="context"] a[href="/sectors"]'));
    const sector = page.getByTestId("sector-intelligence");
    await expect(sector).toBeVisible();
    await sector.getByRole("navigation", { name: t("Sector workspace views", "板块工作区视图"), exact: true })
      .getByRole("button", { name: t("Discover", "发现"), exact: true }).click();
    await sector.locator('[data-sector-choice="xlk"]').first().click();
    await sector.locator('[data-sector-return-focus="discover-open-xlk"]').click();
    if (await sector.getAttribute("data-sector-theme") !== theme)
      await sector.getByRole("button", { name: t(theme === "light" ? "Use light view" : "Use dark view", theme === "light" ? "使用浅色视图" : "使用深色视图"), exact: true }).click();
    await sector.getByRole("button", { name: t("Browse company groups", "浏览公司分组"), exact: true }).click();
    await page.locator('[data-group-choice="semiconductors"]').click();
    await sector.getByRole("button", { name: t("Compare companies", "比较公司"), exact: true }).click();
    await sector.locator('[data-company-choice="NVDA"]').click();
    const inspector = page.getByTestId("sector-company-inspector");
    await expect(inspector).toContainText("NVDA");
    const evidenceReturnURL = page.url();
    await sector.getByRole("button", { name: t("Sources", "来源"), exact: true }).click();
    const evidence = page.getByRole("dialog", { name: t("Sources", "来源"), exact: true });
    await expect(evidence).toBeVisible();
    await expect(evidence).toContainText("2026-09-23");
    await expect(evidence).toContainText("2026-09-26T10:00:00Z");
    await evidence.getByText(t("Technical receipt", "技术凭据"), { exact: true }).first().click();
    await expect(evidence.getByText("/sectordata/sector_central.json", { exact: true })).toBeVisible();
    await evidence.getByRole("button", { name: t("Back to research", "返回研究"), exact: true }).click();
    await expect(evidence).toBeHidden(); await expect(page).toHaveURL(evidenceReturnURL);
    await expect(inspector).toContainText("NVDA");
    const sectorURL = page.url();
    await inspector.getByRole("link", { name: t("Open company research", "打开公司研究"), exact: true }).click();
    await expect(page).toHaveURL(/\/analysis\?symbol=NVDA&page=overview$/);
    const analysisURL = page.url();
    await page.getByRole("button", { name: t("Back to chart", "返回图表"), exact: true }).click();
    await expect(page).toHaveURL(/\/terminal\?/);
    expect(new URL(page.url()).searchParams.get("ret")).toBe(analysisURL);
    await expect(page.locator(".mm-ptag")).toContainText("NVDA"); await expect(page.locator(".chart-empty")).toBeHidden();
    await page.goBack(); await expect(page).toHaveURL(analysisURL);
    await page.goBack(); await expect(page).toHaveURL(sectorURL);
    await expect(page.getByTestId("sector-company-inspector")).toContainText("NVDA");
    await samePresentation(page, lang, theme);
    await observeNativeState(page, info, lang === "en" ? "presentation-sector-return-en-light" : "presentation-sector-return-zh-dark");
    await keyboardActivate(page.locator('[data-intelligence-nav="context"] a[href="/intelligence"]'));
    await expect(page).toHaveURL(/\/intelligence$/); await samePresentation(page, lang, theme);
  }
  fixture.setCycleUnavailable();
  const cycles = page.locator('[data-intelligence-source="cycles"]');
  await cycles.getByRole("button", { name: "重试: 行业周期", exact: true }).click();
  await expect(cycles).toHaveAttribute("data-read-state", "unavailable");
  await expect(cycles).toContainText("并不代表风险较低");
  await expect(page.locator('[data-intelligence-source="macro"]')).toHaveAttribute("data-read-state", "ready");
  await observeNativeState(page, info, "presentation-unavailable");
  if (info.project.name === "mobile") {
    await page.setViewportSize({ width: 320, height: 844 }); // actual narrow CSS viewport, never a zoom claim
    const link = page.locator('[data-intelligence-nav="context"] a[href="/prophet"]');
    await link.scrollIntoViewIfNeeded(); await link.focus(); await expect(link).toBeFocused();
    const ring = await link.evaluate(node => { const style = getComputedStyle(node); return { width: parseFloat(style.outlineWidth), style: style.outlineStyle }; });
    expect(ring.width).toBeGreaterThanOrEqual(2); expect(ring.style).not.toBe("none");
    const box = await link.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(321);
    await samePresentation(page, "zh", "dark");
    await observeNativeState(page, info, "presentation-320-focus");
  }
  const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(viewport).not.toMatch(/user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:[,.\s]|$)/);
  await info.attach("native-text-enlargement-scope", { contentType: "application/json", body: JSON.stringify({
    browserUA200: "NOT_EXECUTED: no genuine browser-chrome zoom capability is established by this headless fixture",
    appTextScale: "NO_INCUMBENT_SHELL_CONTROL; chart drawing text controls are not a substitute",
    narrow: info.project.name === "mobile" ? "320 CSS pixels observed" : "ordinary project viewport",
    noCSSZoomOrDeviceScaleSubstitution: true,
  }) });
  expect(fixture.writes).toEqual([]); expect(fixture.foreign).toEqual([]);
  await recordSourceScope(page, info, fixture.readPaths);
});

test("real Settings Auto follows both system schemes and locales locally without successful preference writes", async ({ page, baseURL }, info) => {
  await page.emulateMedia({ colorScheme: "light" });
  const fixture = await prepareNativeEntrance(page, baseURL!, "en");
  await page.goto("/intelligence");
  for (const lang of ["en", "zh"] as const) {
    const t = (en: string, zh: string) => lang === "zh" ? zh : en;
    // EN loop ends in dark. This switches only language, preserving Auto's owner.
    if (lang === "zh") await publicPresentation(page, "zh", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    const avatar = page.getByRole("button", { name: t("Settings", "设置"), exact: true });
    await avatar.focus(); await avatar.press("Space");
    const dialog = page.getByRole("dialog").filter({ has: page.getByRole("tab", { name: t("Preferences", "偏好"), exact: true }) });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("tab", { name: t("Preferences", "偏好"), exact: true }).click();
    const auto = dialog.getByRole("group", { name: t("Appearance", "外观"), exact: true })
      .getByRole("button", { name: t("Auto", "自动"), exact: true });
    await auto.focus(); await auto.press("Space");
    await expect(auto).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
    await observeNativeState(page, info, lang === "en" ? "presentation-auto-en-light" : "presentation-auto-zh-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await samePresentation(page, lang, "dark");
    await expect(page.locator('[data-intelligence-source="macro"]')).toContainText(SOURCE_CLOCKS.macro);
    await expect(page.locator('[data-intelligence-source="cycles"]')).toContainText(SOURCE_CLOCKS.cycles);
    await observeNativeState(page, info, lang === "en" ? "presentation-auto-en-dark" : "presentation-auto-zh-dark");
  }
  expect(fixture.writes).toEqual(fixture.blockedAppearanceWrites); // all writes still aborted, never saved
  expect(fixture.foreign).toEqual([]);
  await info.attach("auto-local-not-persisted", { contentType: "application/json", body: JSON.stringify({
    state: "LOCAL_PRESENTATION_ONLY_NOT_SAVED", blockedPreferenceIntents: fixture.blockedAppearanceWrites,
    mutations: "EVERY_MUTATION_ABORTED; no preference/account/data write success",
  }) });
  await recordSourceScope(page, info, fixture.readPaths);
});
