import { expect, test, type Page } from "@playwright/test";
import { sectorFixture } from "./fixtures/sector-company-v3";

// Options R1 W2A/W2B — the explicit rotation method switch, the relative trend map and the holdings coverage line on
// fixture feeds. Synthetic presentation fixtures: local UI proof, not market, backtest or auth proof.
const NOW = Date.parse("2026-10-19T14:00:00Z");
const sector = { as_of: "2026-10-16", sectors: [
  { id: "xlk", ticker: "XLK", name: "Technology", name_zh: "科技", accent: "#38bdf8",
    momentum: { rs_21d: 3, rs_63d: 6, above_200d: true }, heat: { heat_1M: 4, breadth_pct: 51, adv: 30, dec: 29 }, rotation: {} },
  { id: "xlp", ticker: "XLP", name: "Consumer Staples", name_zh: "必需消费", accent: "#34d399",
    momentum: { rs_21d: 1, rs_63d: -3, above_200d: false }, heat: { heat_1M: 2, breadth_pct: 64, adv: 23, dec: 13 }, rotation: {} },
  { id: "xlu", ticker: "XLU", name: "Utilities", name_zh: "公用事业", accent: "#fbbf24",
    momentum: { rs_21d: -2, rs_63d: -4, above_200d: false }, heat: { heat_1M: -1, breadth_pct: 30, adv: 9, dec: 21 }, rotation: {} },
  { id: "xlre", ticker: "XLRE", name: "Real Estate", name_zh: "房地产", accent: "#f472b6",
    momentum: { rs_21d: -1, rs_63d: 2, above_200d: true }, heat: { heat_1M: 1, breadth_pct: 45, adv: 14, dec: 17 }, rotation: {} },
] };
type Lang = "en" | "zh";
const COPY = {
  en: { group: "Rotation method", incumbent: "Relative return · 63/21", trend: "Relative trend · weekly EMA", relative: "Relative to SPY", completed: "completed weeks",
    context: "Relative trend vs SPY · completed weeks · as of 2026-10-16", counts: "2 placed · 1 on a boundary · 1 not placed", shownMethod: "relative trend · weekly EMA",
    endpoint: "completed weeks only", thin: "Not enough history", unavailable: "The relative trend feed is unavailable", showIncumbent: "Show relative return",
    covers: "Covers 20 of 68 holdings", holdingsAsOf: "holdings as of" },
  zh: { group: "轮动方法", incumbent: "相对收益 · 63/21", trend: "相对趋势 · 周EMA", relative: "相对 SPY", completed: "已完成周",
    context: "相对 SPY 的趋势 · 已完成周 · 截至 2026-10-16", counts: "2 已定位 · 1 处于边界 · 1 未定位", shownMethod: "相对趋势 · 周EMA",
    endpoint: "仅完成周", thin: "XLRE", unavailable: "相对趋势", showIncumbent: "显示相对收益", covers: "覆盖 20/68 只持仓", holdingsAsOf: "持仓截至" },
} as const;
test.setTimeout(90_000);

async function prepare(page: Page, lang: Lang, options: { rows?: "inline" | "fixture"; trend?: "ready" | "unavailable" } = {}) {
  await page.addInitScript(({ lang, now }) => {
    localStorage.setItem("mm.lang", lang);
    document.documentElement?.setAttribute("data-lang", lang);
    Date.now = () => now;
  }, { lang, now: NOW });
  await page.route("**/api/sector-intelligence?**", route => {
    const source = new URL(route.request().url()).searchParams.get("source") || "";
    if (source === "sector" && options.rows !== "fixture") return route.fulfill({ json: { data: sector, receipt: {
      source, status: "ready", path: "/sectordata/sector_central.json", asOf: "2026-10-16", observedAt: "2026-10-17T02:00:00Z", stale: false, contentHash: null } } });
    if (source === "relative_trend" && options.trend === "unavailable") return route.fulfill({ status: 404, json: { data: null, receipt: {
      source, status: "unavailable", path: null, asOf: null, observedAt: null, stale: false, contentHash: null } } });
    return sectorFixture(route);
  });
}
const noOverflow = async (page: Page) => {
  const root = page.getByTestId("sector-intelligence");
  const dimensions = await root.evaluate(el => ({
    inner: el.scrollWidth - el.clientWidth, document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(dimensions.inner).toBeLessThanOrEqual(1); expect(dimensions.document).toBeLessThanOrEqual(1);
};

for (const [lang, theme] of [["en", "light"], ["zh", "dark"]] as const) {
  const c = COPY[lang];
  test(`relative trend is an explicit method with its own axes, trail and receipt / ${lang} / ${theme}`, async ({ page }, testInfo) => {
    await prepare(page, lang);
    await page.goto(`/discover?tab=sectors&sectorWorkspace=rotation&sector=xlk&sectorTheme=${theme}`);
    const rotation = page.getByTestId("sector-rotation"), context = rotation.getByTestId("rotation-context");
    const points = rotation.locator("[data-sector-rotation-point]"), xlk = rotation.locator('[data-sector-rotation-point="xlk"]');
    await expect(points).toHaveCount(4);
    await expect(context).toContainText(c.relative);
    await expect(context).not.toContainText(c.completed);
    const incumbentStyle = await xlk.getAttribute("style");
    const group = rotation.getByRole("group", { name: c.group });
    await expect(group.getByRole("button", { name: c.incumbent })).toHaveAttribute("aria-pressed", "true");
    await group.getByRole("button", { name: c.trend }).click();
    await expect(page).toHaveURL(/sectorRotationMethod=relative_trend_ema/);
    await expect(group.getByRole("button", { name: c.trend })).toHaveAttribute("aria-pressed", "true");
    await expect(context).toContainText(c.context);
    await expect(context).toContainText(c.counts);
    await expect(points).toHaveCount(3);
    await expect(rotation.getByTestId("rotation-scale")).toContainText("100");
    await expect(rotation.getByTestId("rotation-scale")).toContainText("95.4");
    const trail = rotation.getByTestId("rotation-trend-trail");
    await expect(trail).toHaveAttribute("data-runs", "1");
    await expect(trail).toHaveAttribute("data-weeks", "12");
    await expect(rotation.getByTestId("rotation-trend-trail-note")).toBeVisible();
    // The trail ends where the selected sector sits: the last completed week is the current observation, drawn on the same pixel scale.
    const trailEnd = await trail.locator("circle").boundingBox(), xlkBox = await xlk.boundingBox();
    expect(trailEnd && xlkBox ? Math.abs(trailEnd.x + trailEnd.width / 2 - (xlkBox.x + xlkBox.width / 2)) : Infinity, "trail end x vs selected point x").toBeLessThanOrEqual(2);
    expect(trailEnd && xlkBox ? Math.abs(trailEnd.y + trailEnd.height / 2 - (xlkBox.y + xlkBox.height / 2)) : Infinity, "trail end y vs selected point y").toBeLessThanOrEqual(24);
    const shown = rotation.getByTestId("rotation-shown");
    await expect(shown).toContainText(c.shownMethod);
    await expect(shown).toContainText("7c1f5b2e");
    await expect(shown).toContainText(c.endpoint);
    await expect(rotation.getByTestId("rotation-history")).toHaveCount(0);
    await expect(rotation.getByTestId("rotation-unplaced")).toContainText(c.thin);
    const inspector = rotation.getByTestId("rotation-inspector");
    await expect(inspector.locator("time")).toHaveAttribute("datetime", "2026-10-16");
    await expect(inspector).toContainText("104.00");
    await expect(inspector).toContainText("101.10");
    expect(await xlk.getAttribute("style")).not.toBe(incumbentStyle);
    await noOverflow(page);
    await rotation.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`rotation-trend-${testInfo.project.name}-${lang}-${theme}.png`), fullPage: true });
    // Switching back never relabels or re-plots the incumbent coordinates (gate 10).
    await group.getByRole("button", { name: c.incumbent }).click();
    await expect(page).not.toHaveURL(/sectorRotationMethod/);
    await expect(context).toContainText(c.relative);
    await expect(points).toHaveCount(4, { timeout: 30_000 });
    expect(await xlk.getAttribute("style")).toBe(incumbentStyle);
    // A deep link reopens on the same method.
    await page.goto(`/discover?tab=sectors&sectorWorkspace=rotation&sector=xlk&sectorTheme=${theme}&sectorRotationMethod=relative_trend_ema`);
    await expect(context).toContainText(c.completed);
    await expect(points).toHaveCount(3);
  });

  test(`an unavailable trend feed keeps the relative return method one step away / ${lang} / ${theme}`, async ({ page }) => {
    await prepare(page, lang, { trend: "unavailable" });
    await page.goto(`/discover?tab=sectors&sectorWorkspace=rotation&sector=xlk&sectorTheme=${theme}&sectorRotationMethod=relative_trend_ema`);
    const rotation = page.getByTestId("sector-rotation");
    const status = rotation.getByTestId("rotation-method-unavailable");
    await expect(status).toContainText(c.unavailable, { timeout: 30_000 });
    await expect(rotation.locator("[data-sector-rotation-point]")).toHaveCount(0);
    await status.getByRole("button", { name: c.showIncumbent }).click();
    await expect(page).not.toHaveURL(/sectorRotationMethod/);
    await expect(rotation.getByTestId("rotation-context")).toContainText(c.relative);
    await expect(rotation.locator("[data-sector-rotation-point]")).toHaveCount(4);
    await noOverflow(page);
  });

  test(`the company comparison names how much of the fund its holdings cover / ${lang} / ${theme}`, async ({ page }, testInfo) => {
    await prepare(page, lang, { rows: "fixture" });
    await page.goto(`/discover?tab=sectors&sector=xlk&group=semiconductors&sectorTheme=${theme}`);
    const coverage = page.getByTestId("sector-holdings-coverage");
    await expect(coverage).toContainText(c.covers, { timeout: 30_000 });
    await expect(coverage).toContainText(c.holdingsAsOf);
    await expect(coverage.locator("time")).toHaveAttribute("datetime", "2026-10-15");
    await noOverflow(page);
    await coverage.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`holdings-coverage-${testInfo.project.name}-${lang}-${theme}.png`), fullPage: true });
  });
}
