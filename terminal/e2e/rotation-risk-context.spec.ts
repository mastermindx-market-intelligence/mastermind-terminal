import { expect, test } from "@playwright/test";
import { MARKET_RISK_NOW, marketRiskSourceFixture, riskEnvelopeFixture } from "../lib/__tests__/marketRiskFixture";

// Synthetic presentation fixtures. This is local UI proof, not market/backtest/auth proof.
const sector = { as_of: "2026-10-07", sectors: [
  { id: "xlk", ticker: "XLK", name: "Technology", name_zh: "科技", accent: "#38bdf8",
    momentum: { rs_21d: 3, rs_63d: 6, above_200d: true }, heat: { heat_1M: 4, breadth_pct: 51, adv: 30, dec: 29 }, rotation: {} },
  { id: "xlp", ticker: "XLP", name: "Consumer Staples", name_zh: "必需消费", accent: "#34d399",
    momentum: { rs_21d: 1, rs_63d: -3, above_200d: false }, heat: { heat_1M: 2, breadth_pct: 64, adv: 23, dec: 13 }, rotation: {} },
  { id: "xlu", ticker: "XLU", name: "Utilities", name_zh: "公用事业", accent: "#fbbf24",
    momentum: { rs_21d: -2, rs_63d: -4, above_200d: false }, heat: { heat_1M: -1, breadth_pct: 30, adv: 9, dec: 21 }, rotation: {} },
] };
test.setTimeout(90_000);
for (const [lang, theme] of [["en", "light"], ["zh", "dark"]] as const) {
  test(`native rotation and market backdrop / ${lang} / ${theme}`, async ({ page }, testInfo) => {
    await page.addInitScript(({ lang, now }) => {
      localStorage.setItem("mm.lang", lang);
      document.documentElement?.setAttribute("data-lang", lang);
      Date.now = () => now;
    }, { lang, now: MARKET_RISK_NOW });
    let riskStale = false;
    const envelope = riskEnvelopeFixture();
    await page.route("**/api/sector-intelligence?**", async route => {
      const source = new URL(route.request().url()).searchParams.get("source")!;
      const data = source === "sector" ? sector : source === "risk" && !riskStale ? envelope : null;
      const status = source === "sector" || source === "risk" ? "ready" : "unavailable";
      await route.fulfill({ status: status === "ready" ? 200 : 404, json: { data, receipt: {
        source, status, path: source === "risk" ? "/riskdata/risk_envelope.json" : "/sectordata/sector_central.json",
        asOf: "2026-10-07", observedAt: "2026-10-08T12:00:00Z", stale: source === "risk" && riskStale, contentHash: "synthetic-fixture",
      } } });
    });
    const source = marketRiskSourceFixture();
    await page.route("**/data/market_risk.json", route => route.fulfill({ json: { ...source, schema: "market_risk/v1", risk_envelope: envelope } }));
    await page.goto(`/discover?tab=sectors&sectorWorkspace=rotation&sector=xlk&sectorTheme=${theme}`);
    const root = page.getByTestId("sector-intelligence"), rotation = page.getByTestId("sector-rotation");
    const context = rotation.getByTestId("rotation-risk-context");
    await expect(rotation.locator("[data-sector-rotation-point]")).toHaveCount(3);
    await expect(context).toContainText(lang === "zh" ? "防御板块相对走强" : "Defensive relative strength");
    const point = rotation.locator('[data-sector-rotation-point="xlk"]');
    const coordinates = await point.getAttribute("style");
    await context.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`rotation-caption-${testInfo.project.name}-${lang}-${theme}.png`), fullPage: true });
    const method = rotation.locator("[data-rotation-method]");
    await method.locator("summary").click();
    await expect(method).toContainText(lang === "zh" ? "未确立统计独立性" : "Statistical independence is unproven");
    await expect(method).toContainText("2026-09-29 → 2026-09-30");
    await expect(method).toContainText(lang === "zh" ? "不证明资金流入" : "does not establish inflows");
    const dimensions = await root.evaluate(el => ({
      inner: el.scrollWidth - el.clientWidth,
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(dimensions.inner).toBeLessThanOrEqual(1); expect(dimensions.document).toBeLessThanOrEqual(1);
    await method.screenshot({ path: testInfo.outputPath(`rotation-detail-${testInfo.project.name}-${lang}-${theme}.png`) });
    await method.locator("summary").click();
    await rotation.getByRole("button", { name: new RegExp(lang === "zh" ? "查看来源" : "Review sources") }).click();
    const dialog = page.getByRole("dialog", { name: lang === "zh" ? "来源" : "Sources", exact: true });
    await expect(dialog).toContainText(lang === "zh" ? "市场背景与轮动" : "Market backdrop and rotation");
    await page.keyboard.press("Escape");
    riskStale = true;
    await root.getByRole("button", { name: lang === "zh" ? "刷新" : "Refresh", exact: true }).click();
    await expect(context).toContainText(lang === "zh" ? "不可用" : "unavailable");
    await expect(rotation.locator("[data-sector-rotation-point]")).toHaveCount(3);
    expect(await point.getAttribute("style")).toBe(coordinates);
    await page.goto("/terminal?symbol=NVDA");
    const signalButton = page.locator(".sig-btn");
    await expect(signalButton).toBeVisible(); await signalButton.click();
    const chip = page.getByTestId("market-risk-chip");
    await expect(chip).toBeVisible();
    await expect(chip.locator("summary")).toContainText("51/100");
    await chip.locator("summary").click();
    await expect(chip).toContainText(lang === "zh" ? "防御板块相对走强" : "Defensive relative strength");
    await expect(chip).toContainText(lang === "zh" ? "未确立统计独立性" : "Statistical independence is unproven");
    expect(await chip.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await chip.screenshot({ path: testInfo.outputPath(`oracle-context-${testInfo.project.name}-${lang}.png`) });
  });
}
