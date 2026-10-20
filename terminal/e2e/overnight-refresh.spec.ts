import { test, expect, type Page } from "@playwright/test";

const witness = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __mmLiveBarGeneration?: () => { barCount: number; lastBar: { c: number; v: number } | null }; __mmChartAxisOpts?: () => { visibleRange: unknown } };
  return { bars: w.__mmLiveBarGeneration?.(), range: w.__mmChartAxisOpts?.().visibleRange };
});

test("24H REST refresh corrects OHLCV without rebuilding or moving the chart", async ({ page }) => {
  test.slow();
  await page.addInitScript(() => {
    Date.now = () => Date.parse("2026-10-19T01:31:00Z");
    localStorage.setItem("mm.startTf", JSON.stringify("1m"));
    localStorage.setItem("mm.inds", "[]");
    localStorage.setItem("mm.mastermindCandles.v1", "1");
    localStorage.setItem("mm.chartSettings", JSON.stringify({ extHours: true, overnightHours: true }));
    localStorage.removeItem("mm.ws");
    // Exercise the real repeating callback without a one-minute test sleep.
    const interval = window.setInterval.bind(window);
    window.setInterval = ((fn: TimerHandler, delay?: number, ...args: unknown[]) =>
      interval(fn, delay === 60_000 ? 250 : delay, ...args)) as typeof window.setInterval;
  });
  let revision = 0;
  let reads = 0;
  await page.route("**/api/intraday?**", async route => {
    const query = new URL(route.request().url()).searchParams;
    reads++;
    const bars = Array.from({ length: 90 }, (_, i) =>
      [Date.parse("2026-10-18T20:00:00Z") / 1000 + i * 60, 200, 202, 199, 201, 100]);
    if (revision) bars[89] = [bars[89][0], 200, 210, 199, 209, 80];
    await route.fulfill({ json: { t: "AMD", tf: query.get("tf"), bars,
      boats_history: { status: "available", source: "tiingo-boats-rest", complete: false, returned_bars: 90,
        observed_at_utc: [revision ? "2026-10-19T01:30:30Z" : "2026-10-19T01:30:00Z"] } } });
  });
  await page.route("**/api/ext-quote?**", async route => route.fulfill({ json: { quotes: {} } }));
  await page.goto("/terminal?symbol=AMD");
  await expect.poll(async () => (await witness(page)).bars?.lastBar?.c, { timeout: 45_000 }).toBe(201);
  const before = await witness(page);
  const firstReads = reads;
  revision = 1;
  await expect.poll(async () => (await witness(page)).bars?.lastBar?.c, { timeout: 15_000 }).toBe(209);
  const after = await witness(page);
  expect(reads).toBeGreaterThan(firstReads);
  expect(after.bars?.barCount).toBe(90);
  expect(after.bars?.lastBar?.v).toBe(80); // authoritative revision, never summed volume
  expect(after.range).toEqual(before.range);
});
