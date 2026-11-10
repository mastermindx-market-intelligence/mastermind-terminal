import { test, expect } from "@playwright/test";
import { sectorFixture } from "./fixtures/sector-company-v3";
const asOf = "2026-10-30";
const days = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", asOf];
const history = {
  meta: {
    asOf,
    rs_history: {
      schema: "sector_cycles.rs_history.v1",
      as_of: asOf,
      mode: "reconstructed_price_history",
      naturally_observed: false,
      basis: "tr",
      benchmark: "SPY",
      horizons_sessions: [21, 63],
      max_points_per_sector: 252,
    },
  },
  sectors: [
    ["xle", "XLE", "Energy", "能源", "Expansion"],
    ["xlk", "XLK", "Technology", "科技", "Downturn"],
  ].map(([id, ticker, name, name_zh, phase]) => ({
    id,
    ticker,
    name,
    name_zh,
    kind: "sector",
    basis: "price",
    now: {
      basis: "price",
      phase,
      pos: id === "xle" ? 71.5 : 20,
      above200d: id === "xle",
    },
    rs_history: days.map((date, i) => ({ date, rs_21d: i - 2, rs_63d: 4 - i })),
    turns: [
      { date: asOf, k: "peak", major: true, provisional: true, mag_pct: 12 },
    ],
  })),
};
const cases = [
  ["en", "dark"],
  ["zh", "light"],
] as const;
for (const [lang, theme] of cases)
  test(`native cycle research ${lang} ${theme}`, async ({ page }, info) => {
    const zh = lang === "zh";
    let deny = false;
    await page.addInitScript((l) => localStorage.setItem("mm.lang", l), lang);
    await page.route("**/api/sector-intelligence?**", async (route) => {
      const key = new URL(route.request().url()).searchParams.get("source");
      if (key !== "history" && key !== "sector") return sectorFixture(route);
      const data =
        key === "history"
          ? history
          : {
              as_of: asOf,
              sectors: history.sectors.map(({ id, ticker, name, name_zh }) => ({
                id,
                ticker,
                name,
                name_zh,
              })),
            };
      await route.fulfill({
        status: deny ? 403 : 200,
        json: {
          data: deny ? null : data,
          receipt: {
            source: key,
            status: deny ? "access" : "ready",
            asOf: deny ? null : asOf,
            stale: false,
          },
        },
      });
    });
    await page.goto(
      `/discover?tab=sectors&sectorWorkspace=detail&sectorView=history&sector=xle&sectorTheme=${theme}`,
    );
    const lens = page.getByTestId("sector-cycle-lens");
    await expect(lens).toBeVisible();
    await expect(lens).toContainText("71.5");
    await expect(lens).toContainText("XLE");
    await lens
      .getByRole("button", { name: zh ? "数据表" : "Data table", exact: true })
      .click();
    await expect(lens.locator("tbody tr")).toHaveCount(5);
    await expect(lens).toContainText(zh ? "暂定" : "Provisional");
    await lens
      .getByRole("button", { name: zh ? "图表" : "Chart", exact: true })
      .click();
    await lens.locator("input[type=range]").focus();
    await page.keyboard.press("Home");
    await expect(lens.getByTestId("cycle-observation")).toContainText(days[0]);
    await lens.getByRole("button", { name: /XLK/ }).click();
    await expect(page).toHaveURL(/sector=xlk/);
    await expect(lens.getByTestId("cycle-observation")).toContainText(asOf);
    await expect(lens).toContainText(zh ? "回落" : "Downturn");
    await page.goBack();
    await expect(lens).toContainText("71.5");
    expect(
      await lens.evaluate((e) => e.scrollWidth - e.clientWidth),
    ).toBeLessThanOrEqual(1);
    await lens.screenshot({
      path: info.outputPath(`cycle-${lang}-${info.project.name}.png`),
    });
    deny = true;
    await page
      .getByRole("button", { name: zh ? "刷新" : "Refresh", exact: true })
      .click();
    await expect(lens).toHaveCount(0);
    await expect(page.getByRole("tabpanel")).not.toContainText("71.5");
  });
