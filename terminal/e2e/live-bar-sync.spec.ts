import { expect, test, type Page } from "@playwright/test";

// ── One accepted live bar, read by every consumer that follows it ────────────────────────────────
//
// The chart accepts a live quote in two places and then has to carry that ONE bar mutation to the
// candle, the indicator series, the Chart Table / visual-intelligence readout and the cross-pane
// sync lookup. Before ChartPanel's `commitLiveBarGeneration`, the daily/resampled path moved only
// the candle: EMA/RSI stayed on the previous bar, the table row stayed on the previous bar, cached
// overlay geometry stayed on the previous bar, and a newly appended session was a timestamp sync
// could not resolve at all. These specs read every witness in ONE settled generation and require
// them to describe the same candle.
//
// The witnesses come off the REAL canvas series / readout map / registered sync peer through the
// dev-only `__mmLiveBarGeneration` hook — a canvas screenshot cannot show an indicator's value.

const SYMBOL = "NVDA";
const BAR_COUNT = 261;                 // a multiple of 3, so the 3D tail bucket is complete
const LAST_SESSION = "2026-08-06";     // Thursday
const NEXT_SESSION = "2026-08-07";     // Friday — the appended session

type SeriesTail = { time: unknown; value: number | null } | null;
type Witness = {
  generation: number;
  tick: { basis: string; stamp: number | null } | null;
  barCount: number;
  lastBar: { time: string | number; o: number; h: number; l: number; c: number; v: number } | null;
  priceTail: SeriesTail;
  series: Record<string, SeriesTail[]>;
  overlayKeys: string[];
  overlayProfile: { poc: number | null; rowsLastClose: number | null } | null;
  indRow: Record<string, number | null> | null;
  syncValueAt: number | null;
  projection: Record<string, string>;
};

/** The trading days ending on `lastISO`, oldest first. */
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

/** A smooth, strictly positive daily history — every study below warms up on it. */
function dailyBars(): [string, number, number, number, number, number][] {
  return sessionDates(BAR_COUNT, LAST_SESSION).map((date, i) => {
    const c = Number((120 + Math.sin(i / 9) * 8 + i * 0.04).toFixed(2));
    return [date, Number((c - 0.5).toFixed(2)), Number((c + 1.1).toFixed(2)), Number((c - 1.3).toFixed(2)), c, 1_000_000 + i * 1_000];
  });
}

const BARS = dailyBars();
const LAST_CLOSE = BARS[BARS.length - 1][4];
/** Far enough above the last close that every derived value has to move. */
const LIVE_LAST = Number((LAST_CLOSE * 1.25).toFixed(2));

/** 11:00 ET on `date` (EDT), as epoch seconds — what `sessionDateOf` reads. */
const rthSeconds = (date: string, hour = 15, minute = 0) => Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`) / 1000;

type QuotePhase = { basis: string; last: number; sessionDate: string; seconds: number };

const PHASE_BASELINE: QuotePhase = { basis: "EOD", last: LAST_CLOSE, sessionDate: LAST_SESSION, seconds: rthSeconds(LAST_SESSION) };

function quoteBody(phase: QuotePhase, syms: string[]) {
  const quotes = Object.fromEntries(syms.map((sym) => [sym, sym === SYMBOL ? {
    sym,
    last: phase.last,
    prevClose: LAST_CLOSE,
    chg: ((phase.last - LAST_CLOSE) / LAST_CLOSE) * 100,
    open: LAST_CLOSE,
    high: Math.max(phase.last, LAST_CLOSE),
    low: Math.min(phase.last, LAST_CLOSE),
    vol: 12_345_678,
    ts: phase.seconds,
    asOfMs: phase.seconds * 1000,
    lagMs: 40,
    live: phase.basis !== "EOD",
    basis: phase.basis,
    market: "us",
    marketSession: "rth",
    regularSessionDate: phase.sessionDate,
    regularSession: "rth",
    regularPrice: phase.last,
    regularChg: ((phase.last - LAST_CLOSE) / LAST_CLOSE) * 100,
  } : null]));
  return { quotes };
}

/** Route the daily fixture, the slice miss, and a phase-driven quote lane. */
async function serveDailyWorkspace(page: Page, phase: () => QuotePhase, startTf: string, inds: string[]) {
  await page.route(`**/data/${SYMBOL}.json`, (route) =>
    route.fulfill({ json: { t: SYMBOL, o: SYMBOL, src: "live-bar-sync-e2e", bars: BARS } }));
  await page.route(`**/data/${SYMBOL}.slice.json`, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/api/quote?**", async (route) => {
    const syms = (new URL(route.request().url()).searchParams.get("syms") || SYMBOL).split(",").filter(Boolean);
    await route.fulfill({ json: quoteBody(phase(), syms) });
  });
  await seedWorkspace(page, startTf, inds);
}

async function seedWorkspace(page: Page, startTf: string, inds: string[]) {
  await page.addInitScript(([tf, indicators]) => {
    localStorage.setItem("mm.startTf", JSON.stringify(tf));
    localStorage.setItem("mm.inds", JSON.stringify(indicators));
    localStorage.setItem("mm.indHidden", JSON.stringify([]));
    // Skip the one-time Mastermind Candles rollout so the indicator set under test is exactly
    // the one seeded above.
    localStorage.setItem("mm.mastermindCandles.v1", "1");
    localStorage.removeItem("mm.ws");
  }, [startTf, inds] as [string, string[]]);
}

const readWitness = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mmLiveBarGeneration?: () => Witness }).__mmLiveBarGeneration?.() ?? null) as Promise<Witness | null>;

const readAxis = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mmChartAxisOpts?: () => Record<string, unknown> }).__mmChartAxisOpts?.() ?? null);

/** Wait for the chart to hold its fixture history with every seeded study built. */
async function settledBaseline(page: Page, wantSeries: string[]): Promise<Witness> {
  await expect.poll(async () => {
    const w = await readWitness(page);
    return w && w.barCount > 50 && wantSeries.every((k) => (w.series[k]?.length ?? 0) > 0) ? "ready" : "waiting";
  }, { message: "the fixture history and its studies should reach the canvas", timeout: 60_000 }).toBe("ready");
  const w = await readWitness(page);
  expect(w).not.toBeNull();
  return w!;
}

const tail = (w: Witness, key: string, i = 0) => w.series[key]?.[i]?.value ?? null;

test("a daily live quote carries the candle, its studies, the table row and the sync lookup in one generation", async ({ page }) => {
  test.slow();
  let phase: QuotePhase = PHASE_BASELINE;
  // ema = classic overlay, rsi = classic sub-pane, rvwap = a day-trade study with no in-place
  // update path of its own, vprofile = cached SVG-overlay geometry with no series at all.
  const INDS = ["ema", "rsi", "rvwap", "vprofile"];
  await serveDailyWorkspace(page, () => phase, "D", INDS);
  await page.goto(`/terminal?symbol=${SYMBOL}`);

  const before = await settledBaseline(page, ["ema", "rsi", "rvwap"]);
  const axisBefore = await readAxis(page);
  expect(before.lastBar?.c).toBe(LAST_CLOSE);
  expect(before.lastBar?.time).toBe(LAST_SESSION);
  expect(before.overlayKeys).toContain("vprofile");

  // ── one quote that materially changes the current candle ──
  phase = { basis: "REALTIME", last: LIVE_LAST, sessionDate: LAST_SESSION, seconds: rthSeconds(LAST_SESSION, 15, 30) };
  await expect.poll(async () => (await readWitness(page))?.lastBar?.c ?? null, {
    message: "the accepted quote should reach the developing bar",
    timeout: 45_000,
  }).toBe(LIVE_LAST);

  const after = await settledBaseline(page, ["ema", "rsi", "rvwap"]);

  // the bar itself was REPLACED, not appended
  expect(after.barCount).toBe(before.barCount);
  expect(after.lastBar?.time).toBe(LAST_SESSION);

  // 1. the candle on the canvas
  expect(after.priceTail?.value).toBe(LIVE_LAST);
  expect(after.priceTail?.time).toBe(LAST_SESSION);

  // 2. a classic overlay and a classic sub-pane both moved with it
  expect(tail(after, "ema")).not.toBeCloseTo(tail(before, "ema") as number, 6);
  expect(tail(after, "ema")).toBeGreaterThan(tail(before, "ema") as number);
  expect(tail(after, "rsi")).toBeGreaterThan(tail(before, "rsi") as number);

  // 3. a day-trade study with no in-place path of its own moved too
  expect(tail(after, "rvwap")).toBeGreaterThan(tail(before, "rvwap") as number);

  // 4. cached SVG-overlay geometry was RECOMPUTED, not merely aliased. An in-place last-bucket
  //    rewrite mutates the array the builder captured, so `rowsLastClose` moves either way — the
  //    profile's own point of control is the value that only a real recompute can shift.
  expect(after.overlayProfile?.rowsLastClose).toBe(LIVE_LAST);
  expect(after.overlayProfile?.poc).not.toBeCloseTo(before.overlayProfile?.poc as number, 6);

  // 5. the Chart Table / visual-intelligence readout for the developing bar, and its agreement
  //    with what the series actually hold — the two consumers may never describe different
  //    generations of the same candle
  expect(after.indRow?.ema).toBeCloseTo(tail(after, "ema") as number, 6);
  expect(after.indRow?.rsi).toBeCloseTo(tail(after, "rsi") as number, 6);
  expect(after.indRow?.ema).not.toBeCloseTo(before.indRow?.ema as number, 6);

  // 6. cross-pane sync resolves the developing timestamp to this generation's close
  expect(after.syncValueAt).toBe(LIVE_LAST);

  // 7. nothing was recreated and the view did not jump
  const axisAfter = await readAxis(page);
  expect(axisAfter?.visibleRange).toEqual(axisBefore?.visibleRange);
  expect((axisAfter?.paneTickMarkDensity as unknown[])?.length)
    .toBe((axisBefore?.paneTickMarkDensity as unknown[])?.length);

  // ── a superseded packet must never repaint over the newer one ──
  const settled = await readWitness(page);
  phase = { basis: "REALTIME", last: Number((LIVE_LAST * 0.8).toFixed(2)), sessionDate: LAST_SESSION, seconds: rthSeconds(LAST_SESSION, 15, 10) };
  await page.waitForTimeout(9_000);   // more than one 6s poll of the slow lane
  const stale = await readWitness(page);
  expect(stale?.generation).toBe(settled?.generation);
  expect(stale?.lastBar?.c).toBe(LIVE_LAST);
  expect(stale?.priceTail?.value).toBe(LIVE_LAST);
});

test("a new session appends a resampled bucket every consumer can address", async ({ page }) => {
  test.slow();
  let phase: QuotePhase = PHASE_BASELINE;
  const INDS = ["ema", "rsi", "rvwap", "vprofile"];
  // 261 daily bars → 87 complete 3D buckets, so the next session starts a NEW bucket rather than
  // extending the tail one. That is the append case `foldFinalBucket` has to hand through.
  await serveDailyWorkspace(page, () => phase, "3D", INDS);
  await page.goto(`/terminal?symbol=${SYMBOL}`);

  const before = await settledBaseline(page, ["ema", "rsi", "rvwap"]);
  expect(before.barCount).toBe(BAR_COUNT / 3);
  const axisBefore = await readAxis(page);

  phase = { basis: "REALTIME", last: LIVE_LAST, sessionDate: NEXT_SESSION, seconds: rthSeconds(NEXT_SESSION, 15, 30) };
  await expect.poll(async () => (await readWitness(page))?.barCount ?? 0, {
    message: "a fresh session should open a new 3D bucket on the chart",
    timeout: 45_000,
  }).toBe(BAR_COUNT / 3 + 1);

  const after = await settledBaseline(page, ["ema", "rsi", "rvwap"]);
  expect(after.lastBar?.time).toBe(NEXT_SESSION);
  expect(after.priceTail?.time).toBe(NEXT_SESSION);
  expect(after.priceTail?.value).toBe(LIVE_LAST);

  // the studies extend ONTO the new bucket rather than ending at the previous one
  expect(after.series.ema?.[0]?.time).toBe(NEXT_SESSION);
  expect(after.series.rsi?.[0]?.time).toBe(NEXT_SESSION);
  expect(after.series.rvwap?.[0]?.time).toBe(NEXT_SESSION);
  expect(tail(after, "ema")).toBeGreaterThan(tail(before, "ema") as number);

  // the readout has a row for the new bucket, agreeing with the series
  expect(after.indRow?.ema).toBeCloseTo(tail(after, "ema") as number, 6);
  expect(after.indRow?.rsi).toBeCloseTo(tail(after, "rsi") as number, 6);

  // cached overlay geometry followed the new bucket instead of ending at the previous one
  expect(after.overlayProfile?.rowsLastClose).toBe(LIVE_LAST);
  expect(after.overlayProfile?.poc).not.toBeCloseTo(before.overlayProfile?.poc as number, 6);

  // sync can resolve the timestamp that did not exist a moment ago — a snapshot lookup map built
  // at registration time returns null here and the peer pane clears its crosshair instead
  expect(after.syncValueAt).toBe(LIVE_LAST);

  const axisAfter = await readAxis(page);
  expect((axisAfter?.paneTickMarkDensity as unknown[])?.length)
    .toBe((axisBefore?.paneTickMarkDensity as unknown[])?.length);
});

test("an intraday packet carries the same consumers", async ({ page }) => {
  test.slow();
  const DISPLAY_DAY = Date.UTC(2026, 7, 7) / 1000;
  const TRUE_DAY = Date.UTC(2026, 7, 7, 4) / 1000;             // midnight ET during EDT
  const display = (h: number, m: number) => DISPLAY_DAY + h * 3600 + m * 60;
  const trueMs = (h: number, m: number, s = 0) => (TRUE_DAY + h * 3600 + m * 60 + s) * 1000;
  // 09:30 → 11:29 ET, one bar a minute: enough history for EMA-20 / RSI-14 / RVWAP-20 to warm up.
  const MINUTES = 120;
  const intradayBars = Array.from({ length: MINUTES }, (_, i) => {
    const c = Number((180 + Math.sin(i / 5) * 2 + i * 0.03).toFixed(2));
    return [display(9, 30 + i), Number((c - 0.1).toFixed(2)), Number((c + 0.2).toFixed(2)), Number((c - 0.25).toFixed(2)), c, 5_000 + i * 10];
  });
  const lastClose = intradayBars[MINUTES - 1][4] as number;
  const tickClose = Number((lastClose * 1.2).toFixed(2));
  let live = false;

  await page.route("**/api/intraday?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("sym") !== SYMBOL || params.get("tf") !== "1m") { await route.continue(); return; }
    await route.fulfill({ json: { t: SYMBOL, tf: "1m", source: "live-bar-sync-e2e", session_date: NEXT_SESSION, bars: intradayBars } });
  });
  await page.route(`**/data/${SYMBOL}.json`, (route) =>
    route.fulfill({ json: { t: SYMBOL, o: SYMBOL, src: "live-bar-sync-e2e", bars: BARS } }));
  await page.route("**/api/quote?**", async (route) => {
    const syms = (new URL(route.request().url()).searchParams.get("syms") || SYMBOL).split(",").filter(Boolean);
    const at = trueMs(11, 29, 30);
    const quotes = Object.fromEntries(syms.map((sym) => [sym, sym === SYMBOL ? {
      sym, last: live ? tickClose : lastClose, prevClose: lastClose, chg: 0,
      open: lastClose, high: Math.max(lastClose, tickClose), low: lastClose, vol: 1_000_000,
      ts: Math.floor(at / 1000), asOfMs: at, lagMs: 35, live: true, basis: live ? "REALTIME" : "DELAYED_15M",
      market: "us", marketSession: "rth", regularSessionDate: NEXT_SESSION, regularSession: "rth",
      regularPrice: live ? tickClose : lastClose, regularChg: 0,
      ...(live ? {
        tickOpen: lastClose, tickHigh: tickClose, tickLow: lastClose, tickClose, tickVol: 900,
        tickStartMs: at, tickEndMs: at + 999,
      } : {}),
    } : null]));
    await route.fulfill({ json: { quotes } });
  });
  await seedWorkspace(page, "1m", ["ema", "rsi", "rvwap"]);
  await page.goto(`/terminal?symbol=${SYMBOL}`);

  const before = await settledBaseline(page, ["ema", "rsi", "rvwap"]);
  expect(before.barCount).toBe(MINUTES);
  expect(before.lastBar?.c).toBe(lastClose);

  live = true;
  await expect.poll(async () => (await readWitness(page))?.lastBar?.c ?? null, {
    message: "the one-second packet should reshape the developing minute",
    timeout: 45_000,
  }).toBe(tickClose);

  const after = await settledBaseline(page, ["ema", "rsi", "rvwap"]);
  expect(after.barCount).toBe(MINUTES);                 // reshaped, not appended
  expect(after.priceTail?.value).toBe(tickClose);
  expect(tail(after, "ema")).toBeGreaterThan(tail(before, "ema") as number);
  expect(tail(after, "rsi")).toBeGreaterThan(tail(before, "rsi") as number);
  // the study with no in-place path of its own used to freeze here while the candle moved
  expect(tail(after, "rvwap")).toBeGreaterThan(tail(before, "rvwap") as number);
  expect(after.indRow?.ema).toBeCloseTo(tail(after, "ema") as number, 6);
  expect(after.syncValueAt).toBe(tickClose);
});
