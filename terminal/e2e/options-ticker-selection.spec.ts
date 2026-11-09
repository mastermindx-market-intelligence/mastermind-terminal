import { expect, test, type Page } from "@playwright/test";
import tickerFixture from "../public/data/ticker_fixture.json";
import volFixture from "../public/data/vol_fixture.json";

const keyOf = (url: URL) => url.pathname === "/api/flow" ? url.searchParams.get("f") : null;

async function selectRoot(page: Page, root: string) {
  const picker = page.getByRole("combobox", { name: /^(Inspect ticker|查看代码)$/ });
  if (await picker.isVisible()) await picker.selectOption(root);
  else await page.getByRole("button", { name: new RegExp(`^${root}(?:$|\\s)`) }).first().click();
}

for (const locale of ["en", "zh"] as const) {
  test(`slow reads cannot change the active options ticker (${locale})`, async ({ page }, info) => {
    await page.addInitScript(lang => localStorage.setItem("mm.lang", lang), locale);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const pending = new Set<string>();
    const responses = new Set<string>();
    const slowKeys = ["ticker:NVDA", "vol:NVDA", "tctx:NVDA"];
    await page.route(url => slowKeys.includes(keyOf(url) ?? ""), async route => {
      const key = keyOf(new URL(route.request().url()))!;
      pending.add(key);
      await gate;
      const payload = key === "ticker:NVDA" ? tickerFixture.NVDA : key === "vol:NVDA" ? volFixture.NVDA
        : { history_n: 25, z: { net_signed_premium_z252: 6, vol_gt_oi_share_z252: 6 } };
      await route.fulfill({ json: payload });
      responses.add(key);
    });
    await page.route(url => keyOf(url) === "tctx:QQQ", route => route.fulfill({ json: {
      history_n: 25, z: { net_signed_premium_z252: -4, vol_gt_oi_share_z252: -4 },
    } }));
    await page.goto("/options?tab=screener");
    const launch = page.locator("table.scr button").filter({ hasText: /^NVDA$/ }).first();
    await launch.click();
    try {
      await expect.poll(() => pending.size).toBe(3);
      await selectRoot(page, "QQQ");
      const panel = page.locator('[data-ticker-detail="QQQ"]');
      await expect(panel).toBeVisible();
      await expect.poll(() => panel.evaluate(el => ({
        fits: el.scrollWidth <= el.clientWidth + 1,
        chartsFit: Array.from(el.querySelectorAll("svg")).every(svg => svg.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1),
      }))).toEqual({ fits: true, chartsFit: true });
      await expect(panel).toContainText(volFixture.QQQ.atm_iv.toFixed(1) + "%");
      const header = panel.locator(":scope > div").first();
      const expectedContext = locale === "zh" ? "低于均值" : "Below avg";
      await expect(header.getByText(expectedContext, { exact: true }).first()).toBeVisible();
      const observed = await header.innerText();
      release();
      await expect.poll(() => responses.size).toBe(3);
      // All late promises resolve before comparing the visible research header.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.locator("[data-ticker-detail]")).toHaveAttribute("data-ticker-detail", "QQQ");
      expect(await header.innerText()).toBe(observed);
      if (info.project.name === "mobile") {
        await page.setViewportSize({ width: 320, height: 740 });
        await expect.poll(() => panel.evaluate(el => el.clientWidth >= 320 && el.scrollWidth === el.clientWidth
          && Array.from(el.querySelectorAll<HTMLElement>(".obs-card")).every(card => card.scrollWidth <= card.clientWidth + 1)
        )).toBe(true);
      }
      await expect(panel).toContainText(volFixture.QQQ.atm_iv.toFixed(1) + "%");
    } finally { release(); }
  });
}

test("wrong ticker identity, unavailable reads and published absence stay distinct", async ({ page }) => {
  let mode: "wrong" | "failed" | "ok" = "wrong";
  await page.route(url => keyOf(url) === "ticker:QQQ", route => mode === "failed" ? route.fulfill({ status: 503 })
    : route.fulfill({ json: mode === "wrong" ? tickerFixture.NVDA : tickerFixture.QQQ }));
  await page.route(url => keyOf(url) === "vol:QQQ", route => route.fulfill({ json: volFixture.NVDA }));
  await page.route(url => keyOf(url) === "ticker:GLD", route => route.fulfill({ status: 404 }));
  await page.goto("/options?tab=tickers");
  await selectRoot(page, "QQQ");
  const failed = page.locator('[data-ticker-state="unavailable"]');
  await expect(failed).toContainText("QQQ");
  await expect(page.locator("[data-ticker-detail]")).toHaveCount(0);
  mode = "failed";
  await Promise.all([page.waitForResponse(r => keyOf(new URL(r.url())) === "ticker:QQQ" && r.status() === 503), failed.getByRole("button").click()]);
  await expect(failed).toBeVisible();
  mode = "ok";
  await failed.getByRole("button").click();
  const panel = page.locator('[data-ticker-detail="QQQ"]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-volatility-source="unavailable"]')).toBeVisible();
  await expect(panel).not.toContainText(volFixture.NVDA.atm_iv.toFixed(1) + "%");
  await selectRoot(page, "GLD");
  await expect(page.locator('[data-ticker-state="absent"]')).toContainText("GLD");
  await expect(page.locator("[data-ticker-detail]")).toHaveCount(0);
});
