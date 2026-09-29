import { expect, test, type Page } from "@playwright/test";

/**
 * Sustained accepted quotes must not accumulate anything.
 *
 * `commitLiveBarGeneration` runs on EVERY accepted quote — several times a minute per pane,
 * for as long as a chart is open. e2e/live-bar-sync.spec.ts proves ONE such commit is coherent;
 * this spec proves the commit is idempotent in its resource footprint, which is the property a
 * single-tick test structurally cannot see.
 *
 * The risk is specific and was measured during the repair: carrying a non-classic study by
 * remove+re-add would recreate its pane on every quote, and re-running a builder through the
 * series-reuse facade would re-issue that builder's `createPriceLine` guides once per quote.
 * Both are invisible in a single tick and unbounded over a session. `seriesReuseChart` swallows
 * exactly those two calls, so the assertion below is the one that would catch the swallow
 * regressing — a count that grows with the tick count rather than staying flat.
 *
 * Ownership is read through `__mmChartOwnership` (ChartPanel, dev-only) — the renderer's own
 * inventory next to what the component claims — so this is exact integer bookkeeping, not a
 * heap measurement that depends on when a GC runs. Generation comes from
 * `__mmLiveBarGeneration`, which is how we know the ticks were genuinely ACCEPTED and we are
 * not measuring a chart that quietly rejected every packet and therefore never grew anything.
 *
 * Desktop only, for the same reason as e2e/chart-ownership-stress.spec.ts: this is renderer
 * bookkeeping, identical at every viewport.
 */

const SYMBOL = "NVDA";
const BAR_COUNT = 261;
const LAST_SESSION = "2026-08-06";
/** Enough accepted commits that a per-tick leak is unmistakable, bounded so the lane stays ~1/s. */
const TICKS = 14;

type Census = {
  live: { panes: number; series: number; priceLines: number };
  owned: { price: number; futureAxis: number; indicators: number; compare: number; pine: number };
  trackedSeries: number;
  orphanSeries: number;
  pricePaneLines: number;
  orphanPricePaneLines: number;
  markerPlugins: number;
  syncRegistered: number;
  paneObserver: number;
  paneMeta: number;
  domOverlays: number;
};
type Witness = {
  generation: number;
  barCount: number;
  lastBar: { time: string | number; c: number } | null;
  priceTail: { time: unknown; value: number | null } | null;
  series: Record<string, ({ time: unknown; value: number | null } | null)[]>;
};

function sessionDates(count: number, lastISO: string): string[] {
  const out: string[] = [];
  const d = new Date(`${lastISO}T00:00:00Z`);
  while (out.length < count) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.unshift(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}

const BARS: [string, number, number, number, number, number][] = sessionDates(BAR_COUNT, LAST_SESSION).map((date, i) => {
  const c = Number((120 + Math.sin(i / 9) * 8 + i * 0.04).toFixed(2));
  return [date, Number((c - 0.5).toFixed(2)), Number((c + 1.1).toFixed(2)), Number((c - 1.3).toFixed(2)), c, 1_000_000 + i * 1_000];
});
const LAST_CLOSE = BARS[BARS.length - 1][4];
const rthSeconds = (date: string, hour = 15, minute = 0) =>
  Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`) / 1000;

type QuotePhase = { basis: string; last: number; sessionDate: string; seconds: number };

function quoteBody(phase: QuotePhase, syms: string[]) {
  const entry = {
    sym: SYMBOL, last: phase.last, prevClose: LAST_CLOSE,
    chg: ((phase.last - LAST_CLOSE) / LAST_CLOSE) * 100,
    open: LAST_CLOSE, high: Math.max(phase.last, LAST_CLOSE), low: Math.min(phase.last, LAST_CLOSE),
    vol: 12_345_678, ts: phase.seconds, asOfMs: phase.seconds * 1000, lagMs: 40,
    live: phase.basis !== "EOD", basis: phase.basis, market: "us", marketSession: "rth",
    regularSessionDate: phase.sessionDate, regularSession: "rth", regularPrice: phase.last,
    regularChg: ((phase.last - LAST_CLOSE) / LAST_CLOSE) * 100,
  };
  return { quotes: Object.fromEntries(syms.map((sym) => [sym, sym === SYMBOL ? entry : null])) };
}

async function serve(page: Page, phase: () => QuotePhase, inds: string[]) {
  await page.route(`**/data/${SYMBOL}.json`, (route) =>
    route.fulfill({ json: { t: SYMBOL, o: SYMBOL, src: "live-bar-burst-e2e", bars: BARS } }));
  await page.route(`**/data/${SYMBOL}.slice.json`, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/api/quote?**", async (route) => {
    const syms = (new URL(route.request().url()).searchParams.get("syms") || SYMBOL).split(",").filter(Boolean);
    await route.fulfill({ json: quoteBody(phase(), syms) });
  });
  await page.addInitScript((indicators) => {
    localStorage.setItem("mm.startTf", JSON.stringify("D"));
    localStorage.setItem("mm.inds", JSON.stringify(indicators));
    localStorage.setItem("mm.indHidden", JSON.stringify([]));
    localStorage.setItem("mm.mastermindCandles.v1", "1");
    localStorage.removeItem("mm.ws");
  }, inds);
}

const census = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mmChartOwnership?: () => Census }).__mmChartOwnership?.() ?? null) as Promise<Census | null>;
const witness = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mmLiveBarGeneration?: () => Witness }).__mmLiveBarGeneration?.() ?? null) as Promise<Witness | null>;

test("a burst of accepted quotes advances the generation without accumulating any chart resource", async ({ page }) => {
  test.slow();
  let phase: QuotePhase = { basis: "EOD", last: LAST_CLOSE, sessionDate: LAST_SESSION, seconds: rthSeconds(LAST_SESSION) };
  // One study per projection class, so each carrier path runs on every tick: ema = in-place
  // classic, rsi = classic sub-pane (its own pane is the remove/re-add casualty), rvwap =
  // a day-trade study rebuilt through the series-reuse facade, vprofile = render-pass only.
  //
  // rsistack and accum are not decoration: they are the only studies here that are BOTH
  // `inplace-rebuild` (so their builder re-runs through `seriesReuseChart` on every tick) and
  // creators of static `createPriceLine` guides (buildRsiStack's OB/OS pair, buildAccum's "ref"
  // band). They are what makes the priceLines assertion below discriminating — a mutation that
  // stops `reuseSeries` swallowing `createPriceLine` survives an ema/rsi/rvwap/vprofile set
  // because none of those re-issue a guide through the facade.
  const INDS = ["ema", "rsi", "rvwap", "vprofile", "rsistack", "accum"];
  await serve(page, () => phase, INDS);
  await page.goto(`/terminal?symbol=${SYMBOL}`);

  await expect.poll(async () => {
    const w = await witness(page);
    return w && w.barCount > 50 && ["ema", "rsi", "rvwap"].every((k) => (w.series[k]?.length ?? 0) > 0) ? "ready" : "waiting";
  }, { message: "the fixture history and its studies should reach the canvas", timeout: 60_000 }).toBe("ready");

  const before = await census(page);
  const genBefore = (await witness(page))!.generation;
  expect(before).not.toBeNull();
  // A baseline that already leaked would make every equality below vacuously true.
  expect(before!.orphanSeries).toBe(0);
  expect(before!.orphanPricePaneLines).toBe(0);
  expect(before!.syncRegistered).toBe(1);

  // ── the burst: every packet is a NEW price on a STRICTLY LATER stamp, so the lane's
  //    out-of-order guard accepts each one and the generation must advance per tick ──
  for (let i = 1; i <= TICKS; i++) {
    phase = {
      basis: "REALTIME",
      last: Number((LAST_CLOSE * (1 + i * 0.012)).toFixed(2)),
      sessionDate: LAST_SESSION,
      seconds: rthSeconds(LAST_SESSION, 15, i),
    };
    await expect.poll(async () => (await witness(page))?.lastBar?.c ?? null, {
      message: `tick ${i} should be accepted onto the developing bar`,
      timeout: 30_000,
    }).toBe(phase.last);
  }

  const after = await census(page);
  const settled = (await witness(page))!;

  // 1. the ticks were genuinely accepted — otherwise "nothing grew" proves nothing
  expect(settled.generation).toBeGreaterThanOrEqual(genBefore + TICKS);
  expect(settled.lastBar?.c).toBe(phase.last);
  expect(settled.priceTail?.value).toBe(phase.last);
  // the bar was REPLACED every time; a burst must not append bars
  expect(settled.barCount).toBe(BAR_COUNT);

  // 2. nothing accumulated. Each of these is a resource `commitLiveBarGeneration` touches on
  //    every tick, and each would grow ~TICKS-proportionally under the regression it guards.
  expect(after!.live.series).toBe(before!.live.series);
  expect(after!.live.panes).toBe(before!.live.panes);          // the emptied-pane deletion trap
  expect(after!.live.priceLines).toBe(before!.live.priceLines); // re-issued builder guides
  expect(after!.pricePaneLines).toBe(before!.pricePaneLines);
  expect(after!.owned).toEqual(before!.owned);
  expect(after!.trackedSeries).toBe(before!.trackedSeries);
  expect(after!.markerPlugins).toBe(before!.markerPlugins);
  expect(after!.domOverlays).toBe(before!.domOverlays);
  expect(after!.paneMeta).toBe(before!.paneMeta);              // pane sizing/order preserved

  // 3. the per-tick listener churn that the repair deliberately removed must not return
  expect(after!.syncRegistered).toBe(1);
  expect(after!.paneObserver).toBe(before!.paneObserver);

  // 4. ownership still reconciles on both sides
  expect(after!.orphanSeries).toBe(0);
  expect(after!.orphanPricePaneLines).toBe(0);
});

test("a superseded packet arriving after a burst never rolls the candle backward", async ({ page }) => {
  test.slow();
  let phase: QuotePhase = { basis: "EOD", last: LAST_CLOSE, sessionDate: LAST_SESSION, seconds: rthSeconds(LAST_SESSION) };
  await serve(page, () => phase, ["ema", "rsi"]);
  await page.goto(`/terminal?symbol=${SYMBOL}`);
  await expect.poll(async () => ((await witness(page))?.barCount ?? 0) > 50 ? "ready" : "waiting",
    { timeout: 60_000 }).toBe("ready");

  const high = Number((LAST_CLOSE * 1.3).toFixed(2));
  phase = { basis: "REALTIME", last: high, sessionDate: LAST_SESSION, seconds: rthSeconds(LAST_SESSION, 15, 40) };
  await expect.poll(async () => (await witness(page))?.lastBar?.c ?? null, { timeout: 30_000 }).toBe(high);
  const settled = (await witness(page))!;

  // An OLDER stamp on the same lane: refused, so neither the candle nor the generation moves.
  // (A generation that advanced here would mean the boundary ran on a rejected packet.)
  phase = { basis: "REALTIME", last: Number((LAST_CLOSE * 0.7).toFixed(2)), sessionDate: LAST_SESSION, seconds: rthSeconds(LAST_SESSION, 15, 5) };
  await page.waitForTimeout(6_000);
  const stale = (await witness(page))!;
  expect(stale.lastBar?.c).toBe(high);
  expect(stale.priceTail?.value).toBe(high);
  expect(stale.generation).toBe(settled.generation);

  // The studies must sit on the SAME generation as the candle — a refused packet must not
  // leave the candle held and a study advanced.
  expect(stale.series.ema?.[0]?.value).toBe(settled.series.ema?.[0]?.value);
  expect(stale.series.rsi?.[0]?.value).toBe(settled.series.rsi?.[0]?.value);
});
