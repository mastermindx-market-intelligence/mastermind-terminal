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
 * Runs at all three contract viewports. The earlier note here said "desktop only" — that was never
 * true: the `tablet` and `mobile` projects do not ignore this file, and the assertions are exact
 * integer bookkeeping that does not depend on layout. Verified green at 1440x900, 820x1180 and
 * 390x844 rather than assumed.
 */

const SYMBOL = "NVDA";
const BAR_COUNT = 262;
const LAST_SESSION = "2026-08-06";
/** Enough accepted commits that a per-tick leak is unmistakable, bounded so the lane stays ~1/s. */
const TICKS = 14;

/**
 * 262 sessions, not 261, because of the canonical daily-multiple grid (`lib/sessionBars.ts`):
 * a bar opens at row 0 and thereafter wherever `(i - 1) % mult === 0`, so the grid is
 * [0], [1,2,3], [4,5,6]… — a forced partial FIRST bucket and then triples. Under that rule 261
 * sessions leave a 2-of-3 TAIL bucket, and the live session the tests serve would be folded into
 * it (measured: bucket count stays 88, key stays 2026-08-05) instead of opening a new one. 262
 * completes the tail, so the next session opens bucket 89 keyed by NEXT_SESSION — which is the
 * APPEND premise these tests exist to cover. `sessionDates` walks BACKWARD from LAST_SESSION, so
 * raising the count extends the fixture at the FRONT and leaves LAST_SESSION/NEXT_SESSION alone.
 *
 * D3_BUCKETS is hardcoded rather than derived from `groupSessionBars`: deriving the expected
 * count by calling the function under test would compare it to itself. The count was never the
 * thing under test — the premise was.
 */
const D3_BUCKETS = 88;

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
  tick: { basis: string; stamp: number | null } | null;
  studyFailures: Record<string, number>;
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

/** Counts the quote packets the route ACTUALLY served, so "nothing moved" can be told apart
 *  from "nothing arrived" — the difference between a refusal and a dead lane. */
type Served = { count: number; lastSeconds: number | null };

async function serve(page: Page, phase: () => QuotePhase, inds: string[], served?: Served, tf = "D") {
  await page.route(`**/data/${SYMBOL}.json`, (route) =>
    route.fulfill({ json: { t: SYMBOL, o: SYMBOL, src: "live-bar-burst-e2e", bars: BARS } }));
  await page.route(`**/data/${SYMBOL}.slice.json`, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/api/quote?**", async (route) => {
    const syms = (new URL(route.request().url()).searchParams.get("syms") || SYMBOL).split(",").filter(Boolean);
    const p = phase();
    if (served) { served.count += 1; served.lastSeconds = p.seconds; }
    await route.fulfill({ json: quoteBody(p, syms) });
  });
  await page.addInitScript(([indicators, startTf]) => {
    localStorage.setItem("mm.startTf", JSON.stringify(startTf));
    localStorage.setItem("mm.inds", JSON.stringify(indicators));
    localStorage.setItem("mm.indHidden", JSON.stringify([]));
    localStorage.setItem("mm.mastermindCandles.v1", "1");
    localStorage.removeItem("mm.ws");
  }, [inds, tf] as [string[], string]);
}

const census = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mmChartOwnership?: () => Census }).__mmChartOwnership?.() ?? null) as Promise<Census | null>;
const witness = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mmLiveBarGeneration?: () => Witness }).__mmLiveBarGeneration?.() ?? null) as Promise<Witness | null>;

test("a burst of accepted quotes advances the generation without accumulating any chart resource", async ({ page }) => {
  test.slow();
  let phase: QuotePhase = { basis: "EOD", last: LAST_CLOSE, sessionDate: LAST_SESSION, seconds: rthSeconds(LAST_SESSION) };
  // Coverage is chosen against `LIVE_BAR_PROJECTION`, not by feel:
  //   inplace-series  ema (price-pane overlay) + rsi (its own sub-pane — the pane that
  //                   lightweight-charts auto-deletes if a tick ever empties it)
  //   inplace-rebuild rvwap, vprofile, rsistack, accum — builders re-run through `seriesReuseChart`
  //   render-pass     gaps — owns no series, must still re-derive from the new bar generation
  //   not-bar-derived optlevels is deliberately ABSENT: the fixture serves no options artifact, so
  //                   including it would add a key that builds nothing and assert nothing. Its
  //                   class means a bar mutation cannot touch it, which is a unit-test property
  //                   (lib/__tests__/liveBarProjection.test.ts), not a burst property.
  //
  // rsistack and accum are not decoration: they are the only studies here that are BOTH
  // `inplace-rebuild` (so their builder re-runs through `seriesReuseChart` on every tick) and
  // creators of static `createPriceLine` guides (buildRsiStack's OB/OS pair, buildAccum's "ref"
  // band). They are what makes the priceLines assertion below discriminating — this was MEASURED:
  // with an ema/rsi/rvwap/vprofile set, a mutant that stops `reuseSeries` swallowing
  // `createPriceLine` SURVIVED; adding these two killed it (live.priceLines 7 → 77 over 14 ticks).
  const INDS = ["ema", "rsi", "rvwap", "vprofile", "rsistack", "accum", "gaps"];
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

  // 5. every in-place rebuild actually RAN. `seriesReuseChart` throws if a builder asks for more
  //    series than its key owns, and that throw cannot abort the tick (the siblings still have to
  //    be carried) — so the failing key would silently hold a bar older than the candle, on every
  //    tick, forever. `runStudyInPlace` records it instead of swallowing it; this is the assertion
  //    that makes "all seven studies are on the current generation" a checked claim and not a hope.
  expect(settled.studyFailures).toEqual({});
});

test("a superseded packet arriving after a burst never rolls the candle backward", async ({ page }) => {
  test.slow();
  let phase: QuotePhase = { basis: "EOD", last: LAST_CLOSE, sessionDate: LAST_SESSION, seconds: rthSeconds(LAST_SESSION) };
  const served: Served = { count: 0, lastSeconds: null };
  await serve(page, () => phase, ["ema", "rsi"], served);
  await page.goto(`/terminal?symbol=${SYMBOL}`);
  await expect.poll(async () => ((await witness(page))?.barCount ?? 0) > 50 ? "ready" : "waiting",
    { timeout: 60_000 }).toBe("ready");

  const high = Number((LAST_CLOSE * 1.3).toFixed(2));
  phase = { basis: "REALTIME", last: high, sessionDate: LAST_SESSION, seconds: rthSeconds(LAST_SESSION, 15, 40) };
  await expect.poll(async () => (await witness(page))?.lastBar?.c ?? null, { timeout: 30_000 }).toBe(high);
  const settled = (await witness(page))!;

  // An OLDER stamp on the same lane: refused, so neither the candle nor the generation moves.
  // (A generation that advanced here would mean the boundary ran on a rejected packet.)
  const staleSeconds = rthSeconds(LAST_SESSION, 15, 5);
  const servedBefore = served.count;
  phase = { basis: "REALTIME", last: Number((LAST_CLOSE * 0.7).toFixed(2)), sessionDate: LAST_SESSION, seconds: staleSeconds };

  // "Nothing moved" is only evidence of a REFUSAL if something actually arrived to be refused.
  // A chart that had quietly stopped polling — or a route that stopped matching — would satisfy
  // every assertion below while proving nothing. So wait for DELIVERY first, positively.
  await expect.poll(() => (served.count > servedBefore && served.lastSeconds === staleSeconds ? "delivered" : "waiting"), {
    message: "the superseded packet must actually reach the page before we can call it refused",
    timeout: 30_000,
  }).toBe("delivered");
  const servedStale = served.count;
  // and let a few more land, so this is a sustained refusal rather than one lucky poll
  await expect.poll(() => served.count - servedStale, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  const stale = (await witness(page))!;
  expect(stale.lastBar?.c).toBe(high);
  expect(stale.priceTail?.value).toBe(high);
  expect(stale.generation).toBe(settled.generation);
  // the lane's own cursor still reports the ACCEPTED (high) stamp — the refusal is recorded at the
  // guard, not merely absent downstream
  expect(stale.tick?.stamp).toBe(rthSeconds(LAST_SESSION, 15, 40) * 1000);

  // The studies must sit on the SAME generation as the candle — a refused packet must not
  // leave the candle held and a study advanced.
  expect(stale.series.ema?.[0]?.value).toBe(settled.series.ema?.[0]?.value);
  expect(stale.series.rsi?.[0]?.value).toBe(settled.series.rsi?.[0]?.value);
});

/**
 * The 3D lane's developing bar is a PARTIAL bucket — fewer sessions than the grid's width — and it
 * stays partial for as long as the remaining sessions take to arrive. Every live quote in that
 * window rewrites the SAME bucket, so the burst property here is stronger than on the daily lane:
 * not just "no bar was appended" but "the bucket the quotes are landing in never changed identity".
 *
 * That is the case the pre-repair code got wrong by rewriting the tail bucket per tick, and the one
 * a resample-grid change can silently reintroduce. The bucket's KEY is deliberately not asserted to
 * be any particular date — TERMINAL-01's canonical-3D-identity work re-keys a bucket from its
 * closing session to its opening one, and this assertion must hold under either grouping. What is
 * asserted is that the key does not MOVE while the quotes land, which is the invariant both
 * groupings owe the live path.
 */
test("a burst on a partial 3D bucket rewrites it in place without re-keying or appending", async ({ page }) => {
  test.slow();
  let phase: QuotePhase = { basis: "EOD", last: LAST_CLOSE, sessionDate: LAST_SESSION, seconds: rthSeconds(LAST_SESSION) };
  const INDS = ["ema", "rsi", "rvwap", "rsistack", "accum"];
  /** The studies this test reads back after the burst — the readiness gate below waits for all of them. */
  const ASSERTED_STUDIES = ["ema", "rsi"] as const;
  await serve(page, () => phase, INDS, undefined, "3D");
  await page.goto(`/terminal?symbol=${SYMBOL}`);

  // Every study asserted after the burst must be ON THE CANVAS before it starts. Gating on `ema`
  // alone opened the test while `rsi` was still unbuilt: sampling the witness every 25ms through a
  // cold mobile load, `barCount > 10 && ema.length > 0` first held at 1110ms (bars 88, ema 3, rsi
  // 0) and `rsi.length > 0` only at 1174ms. That 64ms gap on an idle machine is the whole defect —
  // on a contended CI shard it outlasts the burst, so the post-burst read returns
  // `series.rsi === undefined` and the failure reads as a MISSING study rather than a late one
  // (CI mobile, 2026-09-29; it reproduced on neither a warm nor a cold local run, which is exactly
  // how a gate/assertion mismatch hides). Deriving the gate from the same list the assertions
  // iterate keeps the two from drifting apart again.
  await expect.poll(async () => {
    const w = await witness(page);
    if (!w || w.barCount <= 10) return "waiting";
    return ASSERTED_STUDIES.every((k) => (w.series[k]?.length ?? 0) > 0) ? "ready" : "waiting";
  }, { message: "the 3D grid and every asserted study should reach the canvas", timeout: 60_000 }).toBe("ready");

  // open the partial bucket: a session the fixture does not contain, so the grid must start a new
  // one and then hold it while the rest of the bucket's sessions are still in the future.
  const NEXT_SESSION = "2026-08-07";
  const opened = Number((LAST_CLOSE * 1.05).toFixed(2));
  const barsBefore = (await witness(page))!.barCount;
  // The fixture's own tail bucket is complete (see D3_BUCKETS), so this fresh session opens a new
  // bucket holding 1 of 3. Asserting the count makes "the bar under the burst is partial" a checked
  // property of the fixture rather than an assumption — if a grid change or a fixture edit ever
  // filled that bucket, this test would be burst-testing an ordinary full bar and quietly stop
  // covering the case it exists for.
  expect(barsBefore).toBe(D3_BUCKETS);
  phase = { basis: "REALTIME", last: opened, sessionDate: NEXT_SESSION, seconds: rthSeconds(NEXT_SESSION, 15, 0) };
  await expect.poll(async () => (await witness(page))?.barCount ?? 0, {
    message: "a fresh session should open a new 3D bucket",
    timeout: 45_000,
  }).toBe(barsBefore + 1);

  const partial = (await witness(page))!;
  const bucketKey = partial.lastBar?.time ?? null;
  expect(bucketKey).not.toBeNull();
  const censusBefore = await census(page);
  const genBefore = partial.generation;

  // ── the burst lands entirely INSIDE that partial bucket ──
  for (let i = 1; i <= TICKS; i++) {
    phase = {
      basis: "REALTIME",
      last: Number((opened * (1 + i * 0.01)).toFixed(2)),
      sessionDate: NEXT_SESSION,
      seconds: rthSeconds(NEXT_SESSION, 15, i),
    };
    await expect.poll(async () => (await witness(page))?.lastBar?.c ?? null, {
      message: `tick ${i} should land on the partial 3D bucket`,
      timeout: 30_000,
    }).toBe(phase.last);
  }

  const after = (await witness(page))!;
  const censusAfter = await census(page);

  // identity held: same bucket, rewritten — not a new one per quote
  expect(after.lastBar?.time).toBe(bucketKey);
  expect(after.priceTail?.time).toBe(bucketKey);
  expect(after.barCount).toBe(barsBefore + 1);
  expect(after.generation).toBeGreaterThanOrEqual(genBefore + TICKS);

  // the studies are ON that bucket, not one behind it, and agree with the readout
  for (const k of ASSERTED_STUDIES) expect(after.series[k]?.[0]?.time, k).toBe(bucketKey);
  expect(after.studyFailures).toEqual({});

  // and the resampled lane accumulates no more than the daily one does
  expect(censusAfter!.live.series).toBe(censusBefore!.live.series);
  expect(censusAfter!.live.panes).toBe(censusBefore!.live.panes);
  expect(censusAfter!.live.priceLines).toBe(censusBefore!.live.priceLines);
  expect(censusAfter!.orphanSeries).toBe(0);
  expect(censusAfter!.syncRegistered).toBe(1);
});
