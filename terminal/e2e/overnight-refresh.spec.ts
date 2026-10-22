import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
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
    // Exercise the production five-second refresh cadence without replacing timers.
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

test("24H first paint adopts the completed daytime request without inventing overnight history", async ({ page }, testInfo) => {
  test.slow();
  const mirrors: Mirror[] = [];
  await observeBrain(page, mirrors);
  await page.addInitScript(() => {
    Date.now = () => Date.parse("2026-10-19T01:31:00Z");
    localStorage.setItem("mm.startTf", JSON.stringify("1m"));
    localStorage.setItem("mm.inds", "[]");
    localStorage.setItem("mm.lang", "en");
    localStorage.setItem("mm.mastermindCandles.v1", "1");
    localStorage.setItem("mm.chartSettings", JSON.stringify({ extHours: true, overnightHours: true }));
    localStorage.removeItem("mm.ws");
  });
  let completed = false;
  let reads = 0;
  await page.route("**/api/intraday?**", async route => {
    reads++;
    const tf = new URL(route.request().url()).searchParams.get("tf");
    const bars = completed ? Array.from({ length: 90 }, (_, i) =>
      [Date.parse("2026-10-16T09:30:00Z") / 1000 + i * 60, 200, 202, 199, 201, 100]) : [];
    await route.fulfill({ json: { t: "AMD", tf, bars,
      boats_history: { status: "missing", source: "tiingo-boats-rest", complete: false,
        returned_bars: 0, observed_at_utc: [] },
      daytime_cache: { assembled_at: "2026-10-19T01:30:59Z", refresh_pending: !completed,
        refresh_error: null, meaning: "daytime_assembly_not_market_data_freshness" },
    } });
  });
  await page.route("**/api/ext-quote?**", route => route.fulfill({ json: { quotes: {} } }));
  await page.goto("/terminal?symbol=AMD");
  await expect.poll(() => mirrors.at(-1)?.session?.data_readout?.status, { timeout: 45_000 }).toBe("unavailable");
  const target = await currentTarget(page, mirrors);
  const crops = "docs/pr-crops/tiingo-24h-fastpath-20261021";
  mkdirSync(crops, { recursive: true });
  const pendingPath = `${crops}/${testInfo.project.name}-daytime-pending.png`;
  await page.screenshot({ path: pendingPath });
  await testInfo.attach("daytime-pending-chart", { contentType: "image/png", path: pendingPath });
  const started = performance.now();
  const firstReads = reads;
  completed = true;
  await expect.poll(async () => (await witness(page)).bars?.lastBar?.c, { timeout: 15_000 }).toBe(201);
  expect(reads).toBe(firstReads + 1); // the accepted completion reaches first paint without another request
  await expect.poll(() => mirrors.at(-1)?.session?.data_readout?.latest_loaded?.ohlcv.close, { timeout: 15_000 }).toBe(201);
  expect(reads).toBeGreaterThan(firstReads);
  expect((await witness(page)).bars?.barCount).toBe(90);
  expect(await currentTarget(page, mirrors)).toEqual(target);
  const completedPath = `${crops}/${testInfo.project.name}-daytime-completed.png`;
  await page.screenshot({ path: completedPath });
  await testInfo.attach("daytime-completed-chart", { contentType: "image/png", path: completedPath });
  const readbackPath = `${crops}/${testInfo.project.name}-daytime-completion.json`;
  writeFileSync(readbackPath, JSON.stringify({ elapsedMs: performance.now() - started,
    firstReads, reads, target, completed: mirrors.at(-1) }, null, 2));
  await testInfo.attach("daytime-completion-readback", { contentType: "application/json", path: readbackPath });
});

test("24H retains initial overnight history when the first refresh has no BOATS receipt", async ({ page }, testInfo) => {
  const mirrors: Mirror[] = [];
  await observeBrain(page, mirrors);
  await page.addInitScript(() => {
    Date.now = () => Date.parse("2026-10-19T01:31:00Z");
    localStorage.setItem("mm.startTf", JSON.stringify("1m"));
    localStorage.setItem("mm.inds", "[]");
    localStorage.setItem("mm.lang", "en");
    localStorage.setItem("mm.mastermindCandles.v1", "1");
    localStorage.setItem("mm.chartSettings", JSON.stringify({ extHours: true, overnightHours: true }));
    localStorage.removeItem("mm.ws");
  });
  let missing = false;
  let refreshReads = 0;
  await page.route("**/api/intraday?**", async route => {
    const tf = new URL(route.request().url()).searchParams.get("tf");
    if (missing) refreshReads++;
    const close = missing ? 301 : 201;
    const start = Date.parse(missing ? "2026-10-16T09:30:00Z" : "2026-10-18T20:00:00Z") / 1000;
    const bars = Array.from({ length: 90 }, (_, i) => [start + i * 60, close - 1, close + 1, close - 2, close, 100]);
    await route.fulfill({ json: { t: "AMD", tf, bars,
      boats_history: { status: missing ? "missing" : "available", source: "tiingo-boats-rest",
        complete: false, returned_bars: missing ? 0 : 90,
        observed_at_utc: missing ? [] : ["2026-10-19T01:30:00Z"] },
      daytime_cache: { assembled_at: "2026-10-19T01:30:59Z", refresh_pending: false,
        refresh_error: null, meaning: "daytime_assembly_not_market_data_freshness" },
    } });
  });
  await page.route("**/api/ext-quote?**", route => route.fulfill({ json: { quotes: {} } }));
  await page.goto("/terminal?symbol=AMD");
  await expect.poll(() => mirrors.at(-1)?.session?.data_readout?.latest_loaded?.ohlcv.close, { timeout: 45_000 }).toBe(201);
  const before = await witness(page);
  const target = await currentTarget(page, mirrors);
  missing = true;
  // Two complete production refresh periods prove retention rather than a pre-fetch assertion.
  await expect.poll(() => refreshReads, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  expect((await witness(page)).bars).toEqual(before.bars);
  expect(mirrors.at(-1)?.session?.data_readout?.latest_loaded?.ohlcv.close).toBe(201);
  expect(await currentTarget(page, mirrors)).toEqual(target);
  await testInfo.attach("overnight-initial-retention", { contentType: "application/json",
    body: Buffer.from(JSON.stringify({ refreshReads, target, retained: mirrors.at(-1) }, null, 2)) });
});

for (const failure of [false, true]) {
  test(`24H empty first paint leaves Loading after a settled ${failure ? "failure" : "empty result"}`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("mm.startTf", JSON.stringify("1m"));
      localStorage.setItem("mm.inds", "[]");
      localStorage.setItem("mm.lang", "en");
      localStorage.setItem("mm.chartSettings", JSON.stringify({ extHours: true, overnightHours: true }));
      localStorage.removeItem("mm.ws");
    });
    let settled = false;
    await page.route("**/api/intraday?**", route => route.fulfill({ json: {
      t: "AMD", tf: new URL(route.request().url()).searchParams.get("tf"), bars: [],
      ...(settled && failure ? { error: "Daytime source deadline" } : {}),
      boats_history: { status: "missing", observed_at_utc: [] },
      daytime_cache: { assembled_at: new Date().toISOString(), refresh_pending: !settled,
        refresh_error: settled && failure ? "Daytime source deadline" : null,
        meaning: "daytime_assembly_not_market_data_freshness" },
    } }));
    await page.route("**/api/ext-quote?**", route => route.fulfill({ json: { quotes: {} } }));
    await page.goto("/terminal?symbol=AMD");
    await expect(page.locator(".statusline > span").first()).toContainText("Loading", { timeout: 45_000 });
    settled = true;
    await expect(page.getByText(failure
      ? "Intraday feed unavailable for AMD on 1m. Switch back to the daily timeframe to keep charting."
      : "No intraday data for AMD on 1m. Switch back to the daily timeframe to keep charting.", { exact: true }))
      .toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".statusline > span").first()).not.toContainText("Loading");
  });
}

test("24H cold quote-only first paint keeps its trade watermark after the quote expires", async ({ page }, testInfo) => {
  test.slow();
  const mirrors: Mirror[] = [];
  await observeBrain(page, mirrors);
  const now = Date.parse("2026-10-19T01:15:20Z");
  await page.addInitScript(now => {
    Date.now = () => now;
    localStorage.setItem("mm.startTf", JSON.stringify("1m"));
    localStorage.setItem("mm.inds", "[]");
    localStorage.setItem("mm.lang", "en");
    localStorage.setItem("mm.mastermindCandles.v1", "1");
    localStorage.setItem("mm.chartSettings", JSON.stringify({ extHours: true, overnightHours: true }));
    localStorage.removeItem("mm.ws");
  }, now);
  let stage = 0;
  let oldReads = 0;
  await page.route("**/api/intraday?**", route => {
    const tf = new URL(route.request().url()).searchParams.get("tf");
    if (stage === 2) oldReads++;
    return route.fulfill({ json: { t: "AMD", tf,
      bars: stage < 2 ? [] : [[Date.parse("2026-10-18T21:15:00Z") / 1000, 100, 102, 99, 101, 12]],
      boats_history: { status: stage === 0 ? "missing" : "available", returned_bars: stage < 2 ? 0 : 1,
        observed_at_utc: stage === 0 ? [] : [new Date(stage === 3 ? now + 31_000 : now - 10_000).toISOString()] },
      daytime_cache: { assembled_at: new Date(now).toISOString(), refresh_pending: stage === 0,
        refresh_error: null, meaning: "daytime_assembly_not_market_data_freshness" },
    } });
  });
  await page.route("**/api/ext-quote?**", route => route.fulfill({ json: { quotes: { AMD: {
    extSource: "tiingo_boats", extBasis: "LIVE", extVenue: "BOATS", extPriceKind: "LAST_TRADE", extSession: "overnight",
    extPrice: 105, extChg: null, extTs: now / 1000, extReceivedTs: now / 1000, extPublishedTs: now / 1000,
    extExpiresTs: now / 1000 + 30, extCaptureId: "12345678-1234-1234-1234-123456789abc", extGeneration: 1,
  } } } }));
  await page.goto("/terminal?symbol=AMD");
  await expect(page.locator(".statusline > span").first()).toContainText("Loading", { timeout: 45_000 });
  stage = 1;
  await expect.poll(async () => (await witness(page)).bars?.lastBar?.c, { timeout: 15_000 }).toBe(105);
  const quoted = await witness(page);
  expect(quoted.bars?.barCount).toBe(1);
  await page.evaluate(now => { Date.now = () => now + 31_000; }, now);
  stage = 2;
  await expect.poll(() => oldReads, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  expect((await witness(page)).bars?.lastBar?.c).toBe(105);
  stage = 3;
  await expect.poll(async () => (await witness(page)).bars?.lastBar?.c, { timeout: 15_000 }).toBe(101);
  expect((await witness(page)).bars?.lastBar?.v).toBe(12);
  await testInfo.attach("cold-quote-trade-ordering", { contentType: "application/json",
    body: Buffer.from(JSON.stringify({ quoted, oldReads, reconciled: await witness(page) }, null, 2)) });
});

test("24H cold first paint does not publish nonempty partial history as a ready chart", async ({ page }) => {
  test.slow();
  await page.addInitScript(() => {
    localStorage.setItem("mm.startTf", JSON.stringify("1m"));
    localStorage.setItem("mm.inds", "[]");
    localStorage.setItem("mm.mastermindCandles.v1", "1");
    localStorage.setItem("mm.chartSettings", JSON.stringify({ extHours: true, overnightHours: true }));
    localStorage.removeItem("mm.ws");
  });
  let completed = false;
  let reads = 0;
  await page.route("**/api/intraday?**", async route => {
    reads++;
    const tf = new URL(route.request().url()).searchParams.get("tf");
    // This is the regression the empty-pending fixture never exercised: the
    // provisional response HAS data, but only the old overnight $217 window.
    const early = Array.from({ length: 25 }, (_, i) =>
      [1792526400 + i * 60, 217, 218, 216.5, 217.5, 100]);
    const daytime = Array.from({ length: 90 }, (_, i) =>
      [1792562400 + i * 60, 213, 214, 211, 212, 100]);
    await route.fulfill({ json: { t: "NVDA", tf, bars: completed ? [...early, ...daytime] : early,
      daytime_cache: { assembled_at: new Date().toISOString(), refresh_pending: !completed,
        refresh_error: null, meaning: "daytime_assembly_not_market_data_freshness" },
      boats_history: { status: "available", returned_bars: early.length,
        observed_at_utc: ["2026-10-20T20:00:00Z"] },
    } });
  });
  await page.route("**/api/ext-quote?**", route => route.fulfill({ json: { quotes: {} } }));
  await page.goto("/terminal?symbol=NVDA");
  await expect.poll(() => reads, { timeout: 45_000 }).toBeGreaterThan(0);
  // Observe after the provisional response, not the trivially empty pre-hydration DOM.
  await expect.poll(async () => (await witness(page)).bars?.barCount ?? 0, { timeout: 15_000 }).toBe(0);
  await page.waitForTimeout(350);
  expect((await witness(page)).bars?.barCount ?? 0).toBe(0);
  completed = true;
  await expect.poll(async () => (await witness(page)).bars?.barCount ?? 0, { timeout: 20_000 }).toBe(115);
  expect((await witness(page)).bars?.lastBar?.c).toBe(212);
});
