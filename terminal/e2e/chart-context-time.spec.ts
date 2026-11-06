import { expect, test, type Page } from "@playwright/test";
import { openChartContext } from "./phoneChrome";
import { useLang } from "./layoutStore";

async function useNumericChart(page: Page, timeframe: "1s" | "1m") {
  await page.addInitScript((tf) => {
    localStorage.setItem("mm.startTf", JSON.stringify(tf));
    localStorage.removeItem("mm.ws");
  }, timeframe);
  const start = Date.UTC(2026, 7, 7, 9, 30) / 1000;
  const step = timeframe === "1s" ? 1 : 60;
  await page.route("**/api/intraday?**", (route) => route.fulfill({ json: {
    t: "NVDA", tf: timeframe, source: "d06-chart-time-fixture", session_date: "2026-08-07",
    bars: Array.from({ length: 120 }, (_, index) => {
      const close = 100 + index * .05 + Math.sin(index / 8);
      return [start + index * step, close - .1, close + .3, close - .3, close, 1000 + index];
    }),
  } }));
  // A later live quote must not append a different bar to this frozen coordinate fixture.
  await page.route("**/api/quote?**", (route) => route.fulfill({ json: { quotes: {} } }));
}

for (const lang of ["en", "zh"] as const) {
  for (const timeframe of ["1s", "1m"] as const) {
    test(`numeric ${timeframe} chart time stays truthful and navigable in ${lang}`, async ({ page }, info) => {
      await useLang(page, lang);
      await useNumericChart(page, timeframe);
      await page.goto("/terminal?symbol=NVDA");
      const reader = await openChartContext(page, lang);
      await expect(reader).toHaveAttribute("data-context-timeframe", timeframe);
      const time = reader.locator("[data-context-bar-time]");
      const latest = timeframe === "1s" ? "2026-08-07 09:31:59" : "2026-08-07 11:29";
      const previous = timeframe === "1s" ? "2026-08-07 09:31:58" : "2026-08-07 11:28";
      await expect(time).toHaveText(latest, { timeout: 20_000 });
      const basis = reader.locator("[data-context-clock-basis]");
      await expect(basis).toHaveText(lang === "zh" ? "图表时间" : "Chart time");
      expect(await time.getAttribute("datetime")).toBeNull();
      expect(await time.getAttribute("aria-describedby")).toBe(await basis.getAttribute("id"));
      await reader.locator('[data-context-focus="previous"]').click();
      await expect(time).toHaveText(previous);
      await expect(reader.locator("[data-context-calendar]")).toHaveAttribute("data-context-calendar", "withheld");
      await reader.locator('[data-context-focus="latest"]').click();
      await expect(time).toHaveText(latest);
      await reader.locator('[data-context-focus="help"]').click();
      await expect(reader.locator("[data-context-time-note]")).toHaveText(lang === "zh"
        ? "此视图未标明时区。K线时间不能说明数据是否及时更新。"
        : "Time zone is not specified in this view. Bar time does not establish data freshness.");
      await reader.evaluate((node) => { node.scrollTop = 0; });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      if (timeframe === "1s") {
        const path = info.outputPath(`chart-time-${info.project.name}-${lang}.png`);
        await reader.screenshot({ path, animations: "disabled" });
        await info.attach("chart-time", { path, contentType: "image/png" });
      }
    });
  }

  test(`daily chart dates remain date-only in ${lang}`, async ({ page }) => {
    await useLang(page, lang);
    await page.goto("/terminal?symbol=NVDA");
    const reader = await openChartContext(page, lang);
    await expect(reader.locator("[data-context-bar-time]")).toHaveText(/^\d{4}-\d{2}-\d{2}$/, { timeout: 20_000 });
    await expect(reader.locator("[data-context-clock-basis]")).toHaveCount(0);
    await reader.locator('[data-context-focus="help"]').click();
    await expect(reader.locator("[data-context-time-note]")).toHaveCount(0);
  });

  test(`second precision and controls fit a 320px fine-pointer reader in ${lang}`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "One fine-pointer context; native viewport projects cover 390/820 widths.");
    await page.setViewportSize({ width: 320, height: 844 });
    await useLang(page, lang);
    await useNumericChart(page, "1s");
    await page.goto("/terminal?symbol=NVDA");
    const reader = await openChartContext(page, lang);
    await expect(reader.locator("[data-context-bar-time]")).toHaveText("2026-08-07 09:31:59", { timeout: 20_000 });
    await expect(reader.locator("[data-context-clock-basis]")).toHaveText(lang === "zh" ? "图表时间" : "Chart time");
    const geometry = await reader.evaluate((node) => ({
      scrollWidth: document.documentElement.scrollWidth, viewportWidth: document.documentElement.clientWidth,
      buttons: Array.from(node.querySelectorAll<HTMLButtonElement>("button")).filter((button) => button.getClientRects().length).map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
    }));
    expect(geometry.scrollWidth).toBe(geometry.viewportWidth);
    for (const button of geometry.buttons) {
      expect(button.width).toBeGreaterThanOrEqual(44);
      expect(button.height).toBeGreaterThanOrEqual(44);
    }
    const path = info.outputPath(`chart-time-320-${lang}.png`);
    await reader.screenshot({ path, animations: "disabled" });
    await info.attach("chart-time-320", { path, contentType: "image/png" });
  });
}
