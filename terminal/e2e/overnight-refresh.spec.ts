import { test, expect, type Page } from "@playwright/test";
import type { Ack, ChartCommandTarget } from "../lib/chartBus";

type Mirror = {
  origin_id: string; context_revision: number; acks?: Ack[];
  session?: {
    symbol: string; tf: string; pane_id: number;
    price_window?: { status: string; source_bar_count?: number; bars?: Array<{ close: number; volume: number | null }> };
    data_readout?: { status: string; source_bar_count?: number; latest_loaded?: { ohlcv: { close: number; volume: number | null } } | null };
    presentation?: { status: string; session?: { extended_hours: { effective: boolean }; overnight_hours?: { effective: boolean } } };
    native_observations?: { status: string };
  };
};
const witness = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __mmLiveBarGeneration?: () => { barCount: number; lastBar: { c: number; v: number } | null }; __mmChartAxisOpts?: () => { visibleRange: unknown } };
  return { bars: w.__mmLiveBarGeneration?.(), range: w.__mmChartAxisOpts?.().visibleRange };
});
async function observeBrain(page: Page, mirrors: Mirror[]) {
  await page.route("**/api/brain/chart/state", async route => {
    mirrors.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true } });
  });
  // Replace only the external model widget transport; the chart, mirror, targets and ACKs are real.
  await page.route("https://www.mastermind-x.com/mm_brain.js", route => route.fulfill({
    contentType: "application/javascript", body: "window.MMBrain={mounted:true,open(){},close(){},toggle(){}};",
  }));
}
async function currentTarget(page: Page, mirrors: Mirror[]): Promise<ChartCommandTarget> {
  const identity = await page.evaluate(() => {
    const cfg = (window as unknown as { MM_BRAIN_CFG?: { getAiContext?: () => { origin_id: string; context_revision: number } } }).MM_BRAIN_CFG;
    const value = cfg?.getAiContext?.();
    if (!value) throw new Error("The chart's real context provider is absent");
    return { origin_id: value.origin_id, context_revision: value.context_revision };
  });
  await expect.poll(() => mirrors.at(-1), { timeout: 10_000 }).toMatchObject(identity);
  const session = mirrors.at(-1)!.session!;
  return { schema: "chart.command_target.v1", ...identity, pane_id: session.pane_id, symbol: session.symbol, tf: session.tf };
}
async function setSession(page: Page, mode: "extended" | "24h") {
  if (page.viewportSize()!.width <= 640) {
    await page.getByTestId("roller-more").click();
    await page.getByTestId("hub-tile-chartSettings").click();
  } else {
    await page.locator(".cfb-gear").first().click();
    await page.locator(".qsg-menu .qsg-item").last().click();
  }
  const dialog = page.locator("dialog.sm-backdrop");
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-settings-tab="symbol"]').click();
  await dialog.getByLabel("Session", { exact: true }).selectOption(mode);
  await dialog.locator(".sm-ok").click();
}
async function commandEma(page: Page, target: ChartCommandTarget, seq: number) {
  await page.evaluate(({ target, seq }) => {
    const cfg = (window as unknown as { MM_BRAIN_CFG?: { onCommand?: (command: unknown) => void } }).MM_BRAIN_CFG;
    if (!cfg?.onCommand) throw new Error("The real command callback is absent");
    cfg.onCommand({ on: true, v: 2, batch_id: "overnight-session-integration", seq, target,
      op: "chart.set_indicators", args: { indicators: [{ name: "ema", params: { len: 37 } }] } });
  }, { target, seq });
}

test("24H REST refresh corrects OHLCV without rebuilding or moving the chart", async ({ page }, testInfo) => {
  test.slow();
  const mirrors: Mirror[] = [];
  await observeBrain(page, mirrors);
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
    const bars = revision === 2 ? [] : Array.from({ length: 90 }, (_, i) =>
      [Date.parse("2026-10-18T20:00:00Z") / 1000 + i * 60, 200, 202, 199, 201, 100]);
    if (revision === 1) bars[89] = [bars[89][0], 200, 210, 199, 209, 80];
    await route.fulfill({ json: { t: "AMD", tf: query.get("tf"), bars,
      boats_history: { status: "available", source: "tiingo-boats-rest", complete: false, returned_bars: bars.length,
        observed_at_utc: [["2026-10-19T01:30:00Z", "2026-10-19T01:30:30Z", "2026-10-19T01:31:00Z"][revision]] } } });
  });
  await page.route("**/api/ext-quote?**", async route => route.fulfill({ json: { quotes: {} } }));
  await page.goto("/terminal?symbol=AMD");
  await expect.poll(async () => (await witness(page)).bars?.lastBar?.c, { timeout: 45_000 }).toBe(201);
  await expect.poll(() => mirrors.at(-1)?.session?.data_readout?.latest_loaded?.ohlcv.close, { timeout: 15_000 }).toBe(201);
  const before = await witness(page);
  const beforeTarget = await currentTarget(page, mirrors);
  const firstReads = reads;
  revision = 1;
  await expect.poll(async () => (await witness(page)).bars?.lastBar?.c, { timeout: 15_000 }).toBe(209);
  await expect.poll(() => mirrors.at(-1)?.session?.data_readout?.latest_loaded?.ohlcv.close, { timeout: 15_000 }).toBe(209);
  const after = await witness(page);
  expect(reads).toBeGreaterThan(firstReads);
  expect(after.bars?.barCount).toBe(90);
  expect(after.bars?.lastBar?.v).toBe(80); // authoritative revision, never summed volume
  expect(after.range).toEqual(before.range);
  expect(await currentTarget(page, mirrors)).toEqual(beforeTarget); // a quote/refresh is not a user context transition
  const corrected = mirrors.at(-1);
  revision = 2;
  await expect.poll(async () => (await witness(page)).bars?.barCount, { timeout: 15_000 }).toBe(0);
  await expect.poll(() => mirrors.at(-1)?.session?.data_readout, { timeout: 15_000 })
    .toMatchObject({ status: "unavailable", source_bar_count: 0, latest_loaded: null });
  await expect.poll(() => mirrors.at(-1)?.session?.price_window?.status, { timeout: 10_000 }).toBe("unavailable");
  await testInfo.attach("overnight-refresh-chart-readback", { contentType: "application/json",
    body: Buffer.from(JSON.stringify({ beforeTarget, corrected, empty: mirrors.at(-1) }, null, 2)) });
});

for (const tf of ["1m", "12h"] as const) {
  test(`${tf}: ETH and 24H retire old AI data and reject a stale command target`, async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    const mirrors: Mirror[] = [];
    await observeBrain(page, mirrors);
    await page.addInitScript(tf => {
      localStorage.setItem("mm.startTf", JSON.stringify(tf));
      localStorage.setItem("mm.inds", "[]");
      localStorage.setItem("mm.indParams", "{}");
      localStorage.setItem("mm.lang", "en");
      localStorage.setItem("mm.mastermindCandles.v1", "1");
      localStorage.setItem("mm.chartSettings", JSON.stringify({ extHours: true, overnightHours: true }));
      localStorage.removeItem("mm.ws");
    }, tf);
    let releaseEth: (() => void) | undefined;
    const ethReady = new Promise<void>(resolve => { releaseEth = resolve; });
    await page.route("**/api/intraday?**", async route => {
      const query = new URL(route.request().url()).searchParams;
      const overnight = query.get("session") === "24h";
      if (!overnight) await ethReady;
      const close = overnight ? 201 : 301;
      const step = tf === "12h" ? 12 * 3600 : 60;
      const bars = Array.from({ length: 90 }, (_, i) =>
        [Date.parse("2026-10-18T20:00:00Z") / 1000 - (89 - i) * step, close - 1, close + 1, close - 2, close, 100]);
      await route.fulfill({ json: { t: "AMD", tf: query.get("tf"), bars } });
    });
    await page.route("**/api/ext-quote?**", async route => route.fulfill({ json: { quotes: {} } }));
    try {
      await page.goto("/terminal?symbol=AMD");
      await expect.poll(() => mirrors.at(-1)?.session?.data_readout?.latest_loaded?.ohlcv.close, { timeout: 45_000 }).toBe(201);
      const overnightTarget = await currentTarget(page, mirrors);
      expect(overnightTarget.tf).toBe(tf);
      expect(mirrors.at(-1)?.session?.presentation?.session).toMatchObject({
        extended_hours: { effective: true }, overnight_hours: { effective: true },
      });
      await setSession(page, "extended");
      await expect.poll(() => mirrors.at(-1)?.session?.presentation?.session, { timeout: 15_000 }).toMatchObject({
        extended_hours: { effective: true }, overnight_hours: { effective: false },
      });
      const ethTarget = await currentTarget(page, mirrors);
      expect(ethTarget.origin_id).toBe(overnightTarget.origin_id);
      expect(ethTarget.context_revision).toBe(overnightTarget.context_revision + 1);
      await expect.poll(() => mirrors.at(-1)?.session?.data_readout?.status).toBe("unavailable");
      await expect.poll(() => mirrors.at(-1)?.session?.price_window).toBeNull();
      const duringLoad = mirrors.at(-1);
      await commandEma(page, overnightTarget, 1);
      await expect.poll(() => mirrors.flatMap(row => row.acks || []).find(ack => ack.seq === 1), { timeout: 10_000 })
        .toMatchObject({ ok: false, error: "command_target_revision_mismatch" });
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mm.inds") || "[]"))).toEqual([]);
      releaseEth!();
      await expect.poll(() => mirrors.at(-1)?.session?.data_readout?.latest_loaded?.ohlcv.close, { timeout: 20_000 }).toBe(301);
      const freshTarget = await currentTarget(page, mirrors);
      await commandEma(page, freshTarget, 2);
      await expect.poll(() => mirrors.flatMap(row => row.acks || []).find(ack => ack.seq === 2), { timeout: 10_000 })
        .toMatchObject({ ok: true, application: { schema: "chart.command_application.v1",
          predecessor: freshTarget, successor: { ...freshTarget, context_revision: freshTarget.context_revision + 1 } } });
      const applied = mirrors.at(-1);
      const appliedTarget = await currentTarget(page, mirrors);
      await setSession(page, "24h");
      await expect.poll(() => mirrors.at(-1)?.session?.data_readout?.latest_loaded?.ohlcv.close, { timeout: 20_000 }).toBe(201);
      const returnedTarget = await currentTarget(page, mirrors);
      expect(returnedTarget.origin_id).toBe(overnightTarget.origin_id);
      expect(returnedTarget.context_revision).toBe(appliedTarget.context_revision + 1);
      await testInfo.attach("overnight-session-target-readback", { contentType: "application/json",
        body: Buffer.from(JSON.stringify({ tf, overnightTarget, ethTarget, duringLoad, applied, returnedTarget }, null, 2)) });
    } finally { releaseEth!(); }
  });
}
