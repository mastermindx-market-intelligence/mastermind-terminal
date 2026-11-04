import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** EX-08: live page + deterministic *existing* dislocations feed fixture.
 * This does not mock feed logic or change freshness/stale/paid classification.
 * Screenshots are opt-in and scoped away from the older accepted crops.
 */
const viewports = new Set(["desktop", "tablet", "mobile"]);
const dir = join(process.cwd(), "docs/pr-crops/ex08-dislocations");

for (const lang of ["en", "zh"] as const) {
  for (const [scenario, cookie] of [["fresh", "fresh"], ["stale", "stale_pack"]] as const) {
    test(`EX08 ${scenario} ${lang}: separate group labels and dated ET event rows`, async ({ page, baseURL }, info) => {
      test.skip(!viewports.has(info.project.name), "Only the three responsive Terminal viewports qualify EX-08.");
      const origin = baseURL ?? "http://127.0.0.1:3108";
      await page.context().addCookies([{ name: "mm_e2e_dislo", value: cookie, url: origin }]);
      await page.addInitScript((locale: string) => {
        window.localStorage.setItem("mm.lang", locale);
        document.documentElement.setAttribute("data-lang", locale);
        document.documentElement.setAttribute("lang", locale === "zh" ? "zh-CN" : "en");
      }, lang);

      await page.goto("/dislocations");
      await expect(page.locator('[data-testid="dislo-status"]')).toBeVisible({ timeout: 60_000 });
      const headings = lang === "zh" ? ["已确认", "形成中", "已结束"] : ["Confirmed", "Forming", "Ended"];
      for (const [i, key] of (["confirmed", "forming", "ended"] as const).entries()) {
        await expect(page.locator(`#dislo-${key} span`).first()).toHaveText(headings[i]);
      }

      const rows = page.locator("li[data-ticker]");
      expect(await rows.count()).toBeGreaterThan(0);
      const times = rows.locator("time");
      await expect(times.first()).toBeVisible();
      const firstDate = await times.first().textContent();
      expect(firstDate).toMatch(lang === "zh" ? /\d{1,2}月\d{1,2}日/ : /[A-Z][a-z]{2} \d{1,2}/);
      expect(firstDate).toMatch(lang === "zh" ? /美东/ : /ET/);
      const age = rows.locator('[data-testid="dislo-age"]').first();
      await expect(age).toHaveText(lang === "zh" ? /\d+ 天/ : /\d+d/);

      if (scenario === "stale") {
        await expect(page.locator('[data-testid="dislo-stale-warn"]')).toBeVisible();
        await expect(page.locator('[data-testid="dislo-stale-warn"]')).toContainText(
          lang === "zh" ? "行情源滞后" : "feed is behind",
        );
      } else {
        await expect(page.locator('[data-testid="dislo-stale-warn"]')).toHaveCount(0);
      }
      await expect(page.locator('[data-testid="dislo-status"]')).toContainText(
        lang === "zh" ? "延迟数据" : "Delayed data",
      );

      if (process.env.TERMINAL_EX08_CROPS) {
        mkdirSync(dir, { recursive: true });
        await page.screenshot({
          path: join(dir, `${info.project.name}-${scenario}-${lang}.png`),
          fullPage: true,
        });
      }
    });
  }
}
