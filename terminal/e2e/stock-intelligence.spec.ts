import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Deterministic UI regression inputs, NOT performance evidence. Live-source screenshots
// are recorded separately with source hashes in the PR proof packet.
const ohlc = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public/data/AAPL.json"), "utf8"));
const signals = ohlc.bars.slice(-60).map((bar: [string, ...number[]]) => ({
  ts: bar[0], known_ts: bar[0], type: "BUY", quality: "block", score: 20, price: bar[4],
}));
const intel = {
  asof: "2026-06-26", ticker: "AAPL",
  cards: {
    ai_judgment: { verdict: "Research fixture: verify accounting quality before acting", size_pct: 50 },
    conviction: { score: 46, band: "Setting up", drivers: ["Earnings revisions"], cautions: ["Long caution: the source evidence needs verification before this assessment can support a decision. Read the entire qualification rather than a clipped fragment."] },
  }, tape: { ai_lean: { dir: "NEUTRAL" } },
};
for (const lang of ["en", "zh"]) {
  test(`Stock Intelligence: real launcher, four views and chart return (${lang})`, async ({ page }, testInfo) => {
    await page.addInitScript(lang => localStorage.setItem("mm.lang", lang), lang);
    await page.route("**/data/AAPL.intel.json*", route => route.fulfill({ json: intel }));
    await page.route("**/data/AAPL.slice.json*", route => route.fulfill({ json: { indicator: { signals }, backtest: { metrics: { n_trades: 8, win_rate: 0.375, profit_factor: 2.1, cagr: 0.052 } } } }));
    const response = page.waitForResponse(r => r.url().includes("/data/AAPL.intel.json"));
    await page.goto("/terminal?symbol=AAPL"); await response;
    const launcher = page.locator(".sig-btn");
    await expect(launcher).toBeVisible(); await expect(launcher).toHaveAttribute("aria-haspopup", "dialog");
    if ((page.viewportSize()?.width ?? 1440) <= 640) { const box = (await launcher.boundingBox())!; expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1); }
    await launcher.click();
    const dialog = page.getByRole("dialog", { name: lang === "en" ? "Stock Intelligence" : "个股情报" });
    await expect(dialog).toBeVisible(); await expect(dialog).toContainText(intel.cards.ai_judgment.verdict);
    await expect(dialog.getByRole("tab")).toHaveCount(4);
    await expect(dialog.locator(".od-stats")).toHaveCount(0);
    for (let i = 0; i < 4; i++) {
      await dialog.getByRole("tab").nth(i).click();
      const body = dialog.getByRole("tabpanel");
      const targetsExist = await dialog.getByRole("tab").evaluateAll(tabs => tabs.every(tab => document.getElementById(tab.getAttribute("aria-controls") || "")));
      expect(targetsExist).toBe(true);
      if (i === 1) expect(await body.locator(".fin-tag").first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13);
      const layout = await body.evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth,
        nestedScrollers: [...el.querySelectorAll<HTMLElement>("*")].filter(x => x.clientHeight > 0 && x.scrollHeight > x.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(x).overflowY)).length }));
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1); expect(layout.nestedScrollers).toBe(0);
      await page.screenshot({ path: testInfo.outputPath(`stock-intelligence-${lang}-${i}.png`) });
    }
    await expect(dialog.locator(".od-stat-v").first()).toHaveText("37.5%");
    await expect(dialog.locator(".od-stat-v").last()).toHaveText("8");
    await dialog.getByRole("tab").first().focus(); await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("tab").nth(1)).toBeFocused();
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(launcher).toBeFocused();
    await launcher.click(); await dialog.getByRole("tab").nth(2).click();
    await expect(dialog.locator(".sd-sigrow")).toHaveCount(25);
    await expect(dialog).toContainText(lang === "en" ? "confirmation failed" : "确认未通过");
    await dialog.getByRole("button", { name: /Show more|显示更多/ }).click();
    await expect(dialog.locator(".sd-sigrow")).toHaveCount(50);
    await page.evaluate(() => { window.addEventListener("mm:chart-jump", event => {
      document.documentElement.dataset.intelligenceJump = (event as CustomEvent).detail.ts;
    }); });
    await dialog.locator(".sd-sigrow").first().click(); await expect(dialog).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-intelligence-jump", signals.at(-1).ts);
    await launcher.click(); await dialog.getByRole("tab").nth(1).click();
    await dialog.locator(".sd-full").click(); await expect(dialog).toHaveCount(0);
    await expect(page.locator(".fin-pane")).toBeVisible();
    await expect(page).toHaveURL(/symbol=AAPL/);
  });
}

test("Stock Intelligence: unavailable detail feeds are disclosed without erasing manifest facts", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
  await page.route(/\/data\/AAPL\.(?:intel|slice|backtest)\.json(?:\?.*)?$/, route => route.fulfill({ status: 404, json: {} }));
  const response = page.waitForResponse(r => r.url().includes("/data/AAPL.intel.json"));
  await page.goto("/terminal?symbol=AAPL"); await response;
  await page.locator(".sig-btn").click();
  const dialog = page.getByRole("dialog", { name: "Stock Intelligence" });
  await expect(dialog).toContainText("Research unavailable");
  await expect(dialog).toContainText("Research date unavailable");
  await dialog.getByRole("tab").nth(3).click();
  // The manifest remains available and legitimately supplies historical ratios.
  // Detail-feed failure must not invent a trade count, research date or equity curve.
  await expect(dialog.locator(".od-stat-v")).toHaveCount(4);
  await expect(dialog.locator(".od-stat-v").last()).toHaveText("—");
  await expect(dialog.getByRole("status")).toContainText("Equity curve unavailable");
  await page.screenshot({ path: testInfo.outputPath("stock-intelligence-unavailable.png") });
});
