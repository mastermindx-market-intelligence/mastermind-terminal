import { expect, test, type Page } from "@playwright/test";

/** Guest indicator hydration is an ownership boundary: a pre-hydration SSR default must NEVER
 * overwrite a saved one-slot Trend/Nine-Bar workspace. The anonymous three-slot limit still
 * applies after the actual saved set is restored. The existing mm_e2e_guest cookie selects the
 * real signed-out TerminalShell under the standard fixture server; no separate auth bypass.
 */
const bars = (() => {
  const days: string[] = [];
  for (let d = new Date(Date.UTC(2026, 0, 2)); days.length < 150; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(d.toISOString().slice(0, 10));
  }
  const closes = [...Array.from({ length: 133 }, (_, i) => 100 + Math.sin(i / 9) * 3),
    ...Array(8).fill(120), ...Array.from({ length: 9 }, (_, i) => 121 + i)];
  return days.map((day, i) => {
    const c = closes[i];
    return [day, c - 0.2, c + 0.6, c - 0.6, c, 1_000_000 + i] as [string, number, number, number, number, number];
  });
})();

async function visitGuest(page: Page, baseURL: string | undefined) {
  await page.context().addCookies([{ name: "mm_e2e_guest", value: "1", url: baseURL ?? "http://127.0.0.1:3108" }]);
  await page.route(/\/data\/NVDA\.json(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: {
      t: "NVDA", o: 1, src: "guest-persistence-fixture", bar_quality: "real_ohlc",
      session_anchor: { basis: "feed", timezone: "America/New_York" }, bars,
    } });
  });
  await page.route(/\/data\/NVDA\.slice\.json(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: { indicator: { state: { position_hint: "flat" }, signals: [], early_dots: [], warnings: [] }, backtest: { metrics: {} } } });
  });
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
}

const savedIndicators = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("mm.inds") || "[]") as string[]);
const savedNine = (page: Page) => page.evaluate(() => Boolean((JSON.parse(localStorage.getItem("mm.indParams") || "{}") as Record<string, Record<string, unknown>>).trend?.["nine.on"]));

for (const scenario of ["nine", "cap"] as const) {
  test(`guest preferences survive hydration and reload: ${scenario}`, async ({ page, baseURL }) => {
    const seed = scenario === "nine" ? ["trend"] : ["ema", "vol", "macd", "stochrsi"];
    await page.addInitScript(({ inds, key }) => {
      if (localStorage.getItem(key)) return;
      localStorage.setItem("mm.inds", JSON.stringify(inds));
      localStorage.setItem("mm.mastermindCandles.v1", "1");
      localStorage.setItem("mm.indHidden", "[]");
      localStorage.setItem("mm.tf", JSON.stringify("D"));
      localStorage.setItem("mm.startTf", JSON.stringify("D"));
      if (inds.includes("trend")) {
        localStorage.setItem("mm.indParams", JSON.stringify({ trend: {
          "te.on": false, "fb.on": false, "vb.on": false, "cp.on": true, "dash.on": false,
          "nine.on": true, "nine.displayPolicy": "progressive", "nine.density": "all",
          "nine.cycleMode": "single", "nine.requireFlip": false, "nine.showMarkers": true,
          "nine.historyBars": 500, "nine.labelSize": 10,
        } }));
      }
      localStorage.setItem(key, "1");
    }, { inds: seed, key: `mm.e2e.guest.indicator.${scenario}` });
    await visitGuest(page, baseURL);

    const expected = scenario === "nine" ? ["trend"] : ["ema", "vol", "macd"];
    for (const phase of ["initial", "reload"] as const) {
      if (phase === "reload") {
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
      }
      await expect.poll(() => savedIndicators(page), { timeout: 30_000,
        message: `${scenario} / ${phase}: saved indicators must be committed after hydration` }).toEqual(expected);
      if (scenario === "nine") {
        await expect.poll(() => savedNine(page), { timeout: 30_000 }).toBe(true);
        await expect.poll(() => page.locator('svg [data-ic-tip^="nine-tip-"]').count(),
          { timeout: 30_000, message: `Nine-Bar must render after ${phase}` }).toBeGreaterThan(0);
      }
    }
  });
}
