import { expect, test, type Page } from "@playwright/test";

const T = Date.parse("2026-10-21T22:02:00Z"); // 18:02 EDT, post-market.
const D = Date.UTC(2026, 9, 21, 18, 2) / 1000;
const read = (page: Page) => page.evaluate(() => (window as any).__mmLiveBarGeneration?.());

test("qualified snapshots move an ETH candle, reject older observations and roll with its countdown", async ({ page }, testInfo) => {
  test.slow();
  await page.clock.setFixedTime(new Date(T + 10_000));
  let phase = 0, history = false;
  const delivered = [0, 0, 0, 0, 0];
  const observations = [
    { at: 0, price: 221.61 },
    { at: 10_000, price: 222.1 },
    { at: 20_000, price: 222.1 }, // A newer same-price response must still advance ordering.
    { at: 15_000, price: 220.9 }, // Older than phase 2, but newer than the last painted phase 1.
    { at: 62_000, price: 222.3 },
  ];
  const historyBars = Array.from({ length: 61 }, (_, i) =>
    [D - (60 - i) * 60, 221.96, 222, 221.6, 221.61, 1200]);
  await page.addInitScript(() => {
    localStorage.setItem("mm.startTf", JSON.stringify("1m"));
    localStorage.setItem("mm.inds", JSON.stringify([]));
    localStorage.setItem("mm.chartSettings", JSON.stringify({ extHours: true, overnightHours: false }));
    localStorage.setItem("mm.mastermindCandles.v1", "1");
    localStorage.removeItem("mm.ws");
  });
  await page.route("**/api/intraday?**", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("sym") !== "NVDA" || url.searchParams.get("tf") !== "1m") return route.continue();
    await route.fulfill({ json: { t: "NVDA", tf: "1m", source: "snapshot-candle-e2e",
      session_date: "2026-10-21", bars: historyBars } });
    history = true;
  });
  await page.route("**/api/quote?**", async route => {
    const url = new URL(route.request().url());
    const active = phase;
    const { at, price } = observations[active];
    const asOfMs = T + at;
    const q = { sym: "NVDA", source: "polygon-snapshot-rt", basis: "REALTIME",
      market: "us", marketSession: "post", regularSession: "rth", regularSessionDate: "2026-10-21",
      last: price, asOfMs, ts: Math.floor(asOfMs / 1000), lagMs: 20,
      open: 210, high: 230, low: 200, vol: 900000, prevClose: 219,
      chg: price - 219, regularPrice: 221.61, regularChg: 2.61,
      extPrice: 222.08, extTs: asOfMs / 1000 - 900, extSource: "polygon-delayed",
      extBasis: "DELAYED_15M", extSession: "post" };
    const syms = (url.searchParams.get("syms") || "NVDA").split(",");
    await route.fulfill({ json: { quotes: Object.fromEntries(syms.map(sym => [sym, sym === "NVDA" ? q : null])) } });
    if (url.searchParams.get("cadence") === "chart") delivered[active]++;
  });
  await page.goto("/terminal?symbol=NVDA");
  await expect.poll(() => history, { timeout: 45_000 }).toBe(true);
  await expect.poll(async () => (await read(page))?.barCount, { timeout: 45_000 }).toBe(61);
  const chart = page.locator(".chart-wrap").first();
  const countdown = chart.locator(".mm-ptag-cd");
  await expect(chart.locator("canvas").first()).toBeVisible();

  phase = 1;
  await expect(chart).toHaveAttribute("data-live-close", "222.1", { timeout: 45_000 });
  await expect(chart).toHaveAttribute("data-live-coverage", "partial");
  const first = await read(page);
  expect(first.lastBar).toMatchObject({ time: D, o: 221.96, h: 222.1, l: 221.6, c: 222.1, v: 1200 });
  expect(first.priceTail.value).toBe(222.1);
  expect(first.syncValueAt).toBe(222.1);
  await expect(countdown).toHaveText("00:50");

  await page.clock.setFixedTime(new Date(T + 20_000));
  phase = 2;
  // Two completed chart polls leave a full polling interval for React to consume
  // the no-op observation before the deliberately older response is released.
  await expect.poll(() => delivered[2], { timeout: 45_000 }).toBeGreaterThanOrEqual(2);
  await expect(countdown).toHaveText("00:40");
  phase = 3;
  await expect.poll(() => delivered[3], { timeout: 45_000 }).toBeGreaterThanOrEqual(2);
  const unchanged = await read(page);
  expect(unchanged.generation).toBe(first.generation);
  expect(unchanged.lastBar).toEqual(first.lastBar);
  await expect(chart).toHaveAttribute("data-live-close", "222.1");

  await page.clock.setFixedTime(new Date(T + 62_000));
  phase = 4;
  await expect.poll(async () => (await read(page))?.barCount, { timeout: 45_000 }).toBe(62);
  const next = await read(page);
  expect(next.generation).toBe(first.generation + 1);
  expect(next.recentBars.slice(-2)).toMatchObject([
    { time: D, o: 221.96, h: 222.1, l: 221.6, c: 222.1, v: 1200 },
    { time: D + 60, o: 222.3, h: 222.3, l: 222.3, c: 222.3, v: 0, liveCoverage: "partial" },
  ]);
  expect(next.priceTail.value).toBe(222.3);
  expect(next.syncValueAt).toBe(222.3);
  await expect(chart).toHaveAttribute("data-live-kind", "new-bar");
  await expect(chart).toHaveAttribute("data-live-coverage", "partial");
  await expect(countdown).toHaveText("00:58");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath(testInfo.project.name + "-snapshot-candle.png"), fullPage: false });
});
