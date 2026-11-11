import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Real responsive UI with deterministic fixture feeds; this is not live BOATS proof.
for (const lang of ["en", "zh"] as const) for (const timeframe of ["12h", "D"] as const) {
  test(`${lang} ${timeframe}: phone session settings are reachable by touch`, async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "Phone chrome owns this entry point.");
    test.setTimeout(90_000);
    await page.addInitScript(({ lang, timeframe }) => {
      localStorage.setItem("mm.lang", lang);
      localStorage.setItem("mm.startTf", JSON.stringify(timeframe));
      localStorage.setItem("mm.inds", "[]");
      localStorage.removeItem("mm.ws");
      if (!localStorage.getItem("mm.chartSettings")) {
        localStorage.setItem("mm.chartSettings", JSON.stringify({ extHours: true, overnightHours: true }));
      }
    }, { lang, timeframe });
    await page.route("**/api/intraday?**", route => route.fulfill({ json: { t: "NVDA", tf: timeframe, bars: [] } }));
    await page.route("**/api/ext-quote?**", route => route.fulfill({ json: { quotes: {} } }));
    await page.goto("/terminal?symbol=NVDA");
    const more = page.getByTestId("roller-more");
    const title = lang === "zh" ? "图表设置" : "Chart Settings";
    const dialog = page.locator("dialog.sm-backdrop");
    const open = async () => {
      await more.click();
      await page.getByRole("button", { name: title, exact: true }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('[data-settings-tab="symbol"]')).toHaveAttribute("aria-selected", "true");
      await expect(dialog.locator('[data-settings-tab="symbol"]')).toBeFocused();
      return dialog.getByLabel(lang === "zh" ? "交易时段" : "Session", { exact: true });
    };
    const session = await open();
    await expect(session.locator('option[value="24h"]')).toHaveCount(timeframe === "12h" ? 1 : 0);
    await expect(session).toHaveValue(timeframe === "12h" ? "24h" : "extended");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const crops = "docs/pr-crops/mobile-session-settings-20261019";
    mkdirSync(crops, { recursive: true });
    await page.screenshot({ path: `${crops}/${lang}-${timeframe}-settings.png` });
    if (timeframe === "D") {
      await dialog.locator(".sm-ok").click();
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mm.chartSettings")!).overnightHours)).toBe(true);
      return;
    }
    await session.selectOption("regular");
    await dialog.locator(".sm-cancel").click();
    await expect(more).toBeFocused();
    await expect(await open()).toHaveValue("24h");
    await dialog.getByLabel(lang === "zh" ? "交易时段" : "Session", { exact: true }).selectOption("regular");
    await dialog.locator(".sm-ok").click();
    await page.reload();
    await expect(await open()).toHaveValue("regular");
    await dialog.getByLabel(lang === "zh" ? "交易时段" : "Session", { exact: true }).selectOption("24h");
    await dialog.locator(".sm-ok").click();
    await page.getByRole("button", { name: lang === "zh" ? "全屏图表" : "Fullscreen chart", exact: true }).click();
    await expect(await open()).toHaveValue("24h");
    await expect(dialog.locator(".sm-header")).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: `${crops}/${lang}-12h-fullscreen-settings.png` });
    await dialog.locator(".sm-ok").click();
    await expect(more).toBeFocused();
  });
}
