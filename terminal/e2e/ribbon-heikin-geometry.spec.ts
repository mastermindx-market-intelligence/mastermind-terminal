import { expect, test, type Page } from "@playwright/test";

/**
 * Trend Ribbon × Heikin Ashi — decoration may recolor the chart's representation, never replace it.
 *
 * The defect this locks down: `applyRibbonCandleColors` used to build its own price points from the
 * RAW bars (`r.o/r.h/r.l/r.c`) for every non-value chart family. Heikin Ashi is not a value chart,
 * so enabling the Ribbon (whose `colorCandles` default is `true`) silently replaced a transformed
 * Heikin-Ashi price series with ordinary OHLC while the chart-type control still read "Heikin Ashi"
 * — and `restoreNormalCandleColors` transformed it back on removal, so one study's toggle decided
 * which price transform the user was looking at.
 *
 * Every assertion here is NUMERIC: the real lightweight-charts price series is read back through
 * the existing dev-only `__mmChartAxisOpts().contextProof` hook and compared against two
 * independently computed candidates (raw and Heikin-Ashi) built from the routed fixture. A
 * screenshot cannot tell those two apart; a max-deviation over open/high/low/close can.
 *
 * Desktop only. The contract under test is price-series DATA, not layout — it has no responsive
 * dimension, and each case is a full chart mount plus several rebuilds, which the 1-worker CI
 * runner should pay for once rather than three times. The responsive shell is covered by
 * responsive.spec.ts.
 *
 * Trend Ribbon has no entry in the current Indicator Library catalog (components/IndicatorsModal
 * `CATS`), so it reaches a chart exactly the way these tests put it there: persisted workspace
 * state (`mm.inds`) restored at mount. Runtime toggles go through the legend row, which is the
 * study's only live control surface.
 */

const SYMBOL = "NVDA";
const BAR_COUNT = 240;
/** Rendered rows the diagnostic hook returns (`data().slice(-120)`). */
const WINDOW = 120;

type FixtureBar = { time: string; o: number; h: number; l: number; c: number; v: number };
type RenderedPoint = {
  time: string;
  open?: number; high?: number; low?: number; close?: number;
  color?: string; borderColor?: string; wickColor?: string;
};
type SeriesRead = {
  rows: RenderedPoint[];
  priceVisibleRange: { from: number; to: number } | null;
  rowCount: number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Deterministic raw OHLC. Two properties matter: every bar has a real body AND a real wick (so the
 * Heikin-Ashi average is far from the raw close), and the series trends up, rolls over and trends
 * down (so the Ribbon produces up / down / flat states and therefore three different colors).
 */
function fixtureBars(): FixtureBar[] {
  const bars: FixtureBar[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const date = new Date(Date.UTC(2025, 0, 6));
    date.setUTCDate(date.getUTCDate() + i);
    const mid = 180 + 34 * Math.sin(i / 21) + i * 0.11;
    const drift = 2.6 * Math.cos(i / 4);
    const open = mid - drift;
    const close = mid + drift;
    const high = Math.max(open, close) + 1.8 + (i % 3) * 0.4;
    const low = Math.min(open, close) - 1.7 - (i % 4) * 0.35;
    bars.push({
      time: date.toISOString().slice(0, 10),
      o: round2(open), h: round2(high), l: round2(low), c: round2(close),
      v: 20_000_000 + i * 12_345,
    });
  }
  return bars;
}

/**
 * Heikin-Ashi ORACLE — deliberately an independent reimplementation rather than an import of the
 * chart's own transform. A test that reuses the implementation it is checking can only prove the
 * function was called, not that the right numbers reached the canvas.
 */
function heikinAshiOracle(rows: FixtureBar[]): FixtureBar[] {
  const out: FixtureBar[] = [];
  let prevOpen = 0, prevClose = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const haClose = (r.o + r.h + r.l + r.c) / 4;
    const haOpen = i === 0 ? (r.o + r.c) / 2 : (prevOpen + prevClose) / 2;
    out.push({
      time: r.time,
      o: haOpen, c: haClose,
      h: Math.max(r.h, haOpen, haClose),
      l: Math.min(r.l, haOpen, haClose),
      v: r.v,
    });
    prevOpen = haOpen; prevClose = haClose;
  }
  return out;
}

const RAW = fixtureBars();
const HEIKIN = heikinAshiOracle(RAW);

/** Largest |Δ| over open/high/low/close between the rendered series and a candidate bar set. */
function maxDeviation(rendered: RenderedPoint[], candidate: FixtureBar[]): number {
  const byTime = new Map(candidate.map((bar) => [bar.time, bar]));
  let worst = 0;
  for (const point of rendered) {
    const bar = byTime.get(point.time);
    if (!bar) throw new Error(`rendered bar ${point.time} is not in the fixture`);
    if (point.open == null || point.high == null || point.low == null || point.close == null) {
      throw new Error(`rendered bar ${point.time} carries no OHLC — the series is not a candle family`);
    }
    worst = Math.max(
      worst,
      Math.abs(point.open - bar.o), Math.abs(point.high - bar.h),
      Math.abs(point.low - bar.l), Math.abs(point.close - bar.c),
    );
  }
  return worst;
}

/** How far apart the two candidate representations are over the read window — the proof's headroom. */
function representationGap(): number {
  const tail = RAW.slice(-WINDOW).map<RenderedPoint>((bar) => ({
    time: bar.time, open: bar.o, high: bar.h, low: bar.l, close: bar.c,
  }));
  return maxDeviation(tail, HEIKIN);
}

/** A rendered series is Heikin-Ashi when it matches the HA oracle and is far from the raw bars. */
function expectHeikin(read: SeriesRead, where: string) {
  expect(read.rows.length, `${where}: the chart should have rendered bars`).toBeGreaterThan(50);
  expect(maxDeviation(read.rows, HEIKIN), `${where}: rendered series should BE the Heikin-Ashi transform`).toBeLessThan(1e-6);
  expect(maxDeviation(read.rows, RAW), `${where}: rendered series must not be the raw OHLC`).toBeGreaterThan(0.5);
}

function expectRaw(read: SeriesRead, where: string) {
  expect(read.rows.length, `${where}: the chart should have rendered bars`).toBeGreaterThan(50);
  expect(maxDeviation(read.rows, RAW), `${where}: rendered series should BE the raw OHLC`).toBeLessThan(1e-6);
  expect(maxDeviation(read.rows, HEIKIN), `${where}: rendered series must not be Heikin-Ashi`).toBeGreaterThan(0.5);
}

/** Per-point color coverage. The Ribbon paints EVERY bar; `colorBarsPrevClose` also paints every bar. */
const paintedCount = (read: SeriesRead) => read.rows.filter((r) => typeof r.color === "string").length;

/** The distinct body colors on the price series. */
const paintPalette = (read: SeriesRead) =>
  [...new Set(read.rows.map((r) => r.color).filter((c): c is string => typeof c === "string"))].sort();

/** The per-bar body color sequence — what actually distinguishes one paint scheme from another. */
const paintSequence = (read: SeriesRead) => read.rows.map((r) => r.color ?? null);

type Seed = {
  chartType: string;
  inds: string[];
  indParams?: Record<string, Record<string, unknown>>;
  chartSettings?: Record<string, unknown>;
};

async function seedWorkspace(page: Page, seed: Seed) {
  await page.addInitScript((s: Seed) => {
    // The readiness latch is re-armed on EVERY document (a test reloads to restore a changed
    // workspace); the workspace seed is written ONCE, so a reload restores what the test wrote
    // rather than the pristine seed.
    (window as Window & { __mmRibbonReady?: boolean }).__mmRibbonReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => {
      (window as Window & { __mmRibbonReady?: boolean }).__mmRibbonReady = true;
    }, { once: true });
    if (sessionStorage.getItem("mm:ribbon-e2e-seeded") === "1") return;
    sessionStorage.setItem("mm:ribbon-e2e-seeded", "1");
    const put = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));
    // "D" is the only timeframe resampleTf() passes through untouched, so the rendered series can be
    // compared bar-for-bar against the routed fixture.
    put("mm.startTf", "D");
    put("mm.tf", "D");
    put("mm.ct", s.chartType);
    put("mm.inds", s.inds);
    put("mm.indParams", s.indParams ?? {});
    put("mm.indHidden", []);
    put("mm.chartSettings", s.chartSettings ?? {});
    // Suppress the one-time Mastermind Candles rollout so `mm.inds` is exactly the set under test —
    // its candle painter is a second writer on this series and would confuse the paint assertions.
    localStorage.setItem("mm.mastermindCandles.v1", "1");
  }, seed);
}

async function routeFixture(page: Page) {
  await page.route(`**/data/${SYMBOL}.json**`, (route) => route.fulfill({
    json: {
      t: SYMBOL, o: 1, src: "ribbon-heikin-e2e", bar_quality: "real_ohlc",
      bars: RAW.map((bar) => [bar.time, bar.o, bar.h, bar.l, bar.c, bar.v]),
    },
  }));
  await page.route(`**/data/${SYMBOL}.slice.json**`, (route) => route.fulfill({ status: 404, body: "{}" }));
  // basis "EOD" is outside SPLICE_BASES, so the live-quote splice never runs and the only writers on
  // the price series are the ones under test. (The live splice has its own raw-OHLC issue on Heikin
  // Ashi — see the module note in ChartPanel's applyLiveSplice; it is out of scope here.)
  await page.route("**/api/quote?**", async (route) => {
    const url = new URL(route.request().url());
    const syms = (url.searchParams.get("syms") || SYMBOL).split(",").filter(Boolean);
    const last = RAW[RAW.length - 1].c;
    await route.fulfill({
      json: {
        quotes: Object.fromEntries(syms.map((sym) => [sym, sym === SYMBOL ? {
          sym, last, close: last, prevClose: RAW[RAW.length - 2].c,
          basis: "EOD", market: "us", marketSession: "closed", live: false,
        } : null])),
      },
    });
  });
}

async function openTerminal(page: Page) {
  await page.goto(`/terminal?symbol=${SYMBOL}`);
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 45_000 });
  await expect.poll(
    () => page.evaluate(() => Boolean((window as Window & { __mmRibbonReady?: boolean }).__mmRibbonReady)),
    { message: "the interactive Terminal should finish hydrating", timeout: 45_000 },
  ).toBe(true);
}

const readSeries = (page: Page): Promise<SeriesRead> => page.evaluate(() => {
  const opts = (window as unknown as { __mmChartAxisOpts?: () => any }).__mmChartAxisOpts?.();
  const rows = opts?.contextProof?.priceRows ?? [];
  return {
    rows: rows.map((r: any) => ({
      time: String(r.time),
      open: r.open, high: r.high, low: r.low, close: r.close,
      color: r.color, borderColor: r.borderColor, wickColor: r.wickColor,
    })),
    priceVisibleRange: opts?.priceVisibleRange ?? null,
    rowCount: opts?.rowCount ?? 0,
  };
});

/** Poll the real series until the painted-bar count reaches `want`, then return that reading. */
async function seriesWithPaint(page: Page, want: "all" | "none", message: string): Promise<SeriesRead> {
  let last: SeriesRead | null = null;
  await expect.poll(async () => {
    last = await readSeries(page);
    if (!last.rows.length) return null;
    const painted = paintedCount(last);
    return want === "all" ? painted === last.rows.length : painted === 0;
  }, { message, timeout: 30_000 }).toBe(true);
  return last!;
}

/** The legend row for a study, with its hover-revealed icon rail. */
function legendRow(page: Page, label: string) {
  return page.locator(".lg-block .lg-row").filter({ hasText: label }).first();
}

/**
 * Click one of a legend row's `.lg-ic` controls. They are `display:none` until `.lg-row:hover`, and
 * a React commit between the hover and the click detaches the node — so re-hover on every attempt
 * and stop as soon as `done()` reports the state actually changed.
 */
async function legendAction(page: Page, label: string, action: string, done: () => Promise<boolean>, what: string) {
  await expect.poll(async () => {
    if (await done()) return true;
    try {
      const row = legendRow(page, label);
      await row.hover({ timeout: 3_000 });
      await row.getByRole("button", { name: action, exact: true }).click({ timeout: 3_000 });
    } catch { /* lost hover / remount — the next attempt re-hovers a fresh node */ }
    return done();
  }, { timeout: 30_000, intervals: [200, 300, 500, 800, 1000], message: what }).toBe(true);
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Price-series geometry has no responsive dimension; covered once on desktop.");
});

test("the fixture's two representations are far enough apart to tell apart", async () => {
  // Guards the proof itself: if a future fixture edit made HA ≈ raw, every assertion below would
  // pass on a broken build. The window the hook returns must be unambiguous.
  expect(representationGap()).toBeGreaterThan(1.5);
});

test("enabling Trend Ribbon recolors Heikin-Ashi candles without replacing their geometry", async ({ page }) => {
  // Two full chart mounts (bare, then reloaded with the Ribbon restored) plus a legend removal.
  // Measured ~78s locally unthrottled; the same budget as the repo's other multi-stage walks.
  test.setTimeout(180_000);
  await routeFixture(page);
  await seedWorkspace(page, { chartType: "heikin", inds: [] });
  await openTerminal(page);

  // 1 — Heikin Ashi, no Ribbon: the baseline the user selected.
  const baseline = await seriesWithPaint(page, "none", "a bare Heikin-Ashi chart carries no per-bar paint");
  expectHeikin(baseline, "heikin, no ribbon");
  const baselineRange = baseline.priceVisibleRange;
  expect(baselineRange, "the price scale should have an autoscaled range").not.toBeNull();

  // 2 — enable the Ribbon (colorCandles defaults to true). RED WITNESS: before the fix this step
  // replaced the transformed series with raw OHLC carrying ribbon colors.
  await page.evaluate(() => {
    const inds = JSON.parse(localStorage.getItem("mm.inds") ?? "[]") as string[];
    localStorage.setItem("mm.inds", JSON.stringify([...inds, "ribbon"]));
  });
  await page.reload();
  await expect.poll(
    () => page.evaluate(() => Boolean((window as Window & { __mmRibbonReady?: boolean }).__mmRibbonReady)),
    { message: "the Terminal should re-hydrate with the Ribbon restored", timeout: 45_000 },
  ).toBe(true);
  await expect(legendRow(page, "Trend Ribbon")).toBeVisible({ timeout: 30_000 });

  const withRibbon = await seriesWithPaint(page, "all", "the Ribbon should paint every bar");
  expectHeikin(withRibbon, "heikin + ribbon");

  // Colors changed; geometry did not — bar for bar, to the last digit.
  expect(withRibbon.rows.map((r) => [r.time, r.open, r.high, r.low, r.close]))
    .toEqual(baseline.rows.map((r) => [r.time, r.open, r.high, r.low, r.close]));
  expect(paintPalette(withRibbon).length, "the Ribbon's three states should produce more than one hue").toBeGreaterThan(1);
  for (const row of withRibbon.rows) {
    expect(row.borderColor, `${row.time}: border should follow the ribbon color`).toBe(row.color);
    expect(row.wickColor, `${row.time}: wick should follow the ribbon color`).toBe(row.color);
  }
  // Secondary invariant, read back from the renderer rather than from our own array: the price
  // scale's autoscaled range is derived from the data the series actually holds, and decoration
  // must not move it. (It is NOT a raw/Heikin discriminator on its own — this fixture's extremes
  // are wick-dominated, so both representations happen to autoscale identically. The
  // bar-for-bar comparison above is what tells the two apart.)
  expect(withRibbon.priceVisibleRange).toEqual(baselineRange);

  // 3 — remove the Ribbon: Heikin-Ashi geometry survives, paint goes away.
  await legendAction(page, "Trend Ribbon", "Remove", async () => {
    const read = await readSeries(page);
    return read.rows.length > 0 && paintedCount(read) === 0;
  }, "removing the Ribbon should clear the per-bar paint");

  const removed = await readSeries(page);
  expectHeikin(removed, "heikin, ribbon removed");
  expect(removed.rows.map((r) => [r.time, r.open, r.high, r.low, r.close]))
    .toEqual(baseline.rows.map((r) => [r.time, r.open, r.high, r.low, r.close]));
});

test("toggling the Ribbon's Color candles never switches the price transform", async ({ page }) => {
  test.setTimeout(120_000);
  await routeFixture(page);
  await seedWorkspace(page, { chartType: "heikin", inds: ["ribbon"] });
  await openTerminal(page);

  const painted = await seriesWithPaint(page, "all", "the Ribbon should paint every bar at mount");
  expectHeikin(painted, "colorCandles on");
  const geometry = painted.rows.map((r) => [r.time, r.open, r.high, r.low, r.close]);

  const setColorCandles = async (on: boolean) => {
    await legendAction(page, "Trend Ribbon", "Settings", async () =>
      page.locator(".is-row").filter({ hasText: "Color candles" }).locator("[role=switch]").isVisible().catch(() => false),
      `the Ribbon settings dialog should open (colorCandles → ${on})`);
    const toggle = page.locator(".is-row").filter({ hasText: "Color candles" }).locator("[role=switch]");
    await expect(toggle).toHaveAttribute("aria-checked", String(!on));
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", String(on));
    await page.keyboard.press("Escape");
  };

  // OFF → the paint is dropped and the chart falls back to priceData(). Still Heikin Ashi.
  await setColorCandles(false);
  const off = await seriesWithPaint(page, "none", "colorCandles off should clear the per-bar paint");
  expectHeikin(off, "colorCandles off");
  expect(off.rows.map((r) => [r.time, r.open, r.high, r.low, r.close])).toEqual(geometry);

  // ON again → paint returns, geometry is byte-identical to the first painted pass (idempotent).
  await setColorCandles(true);
  const on = await seriesWithPaint(page, "all", "colorCandles on should repaint every bar");
  expectHeikin(on, "colorCandles re-enabled");
  expect(on.rows).toEqual(painted.rows);
});

test("switching chart type with the Ribbon on yields the newly selected representation", async ({ page }) => {
  test.setTimeout(120_000);
  await routeFixture(page);
  await seedWorkspace(page, { chartType: "heikin", inds: ["ribbon"] });
  await openTerminal(page);

  const heikin = await seriesWithPaint(page, "all", "the Ribbon should paint the Heikin-Ashi chart");
  expectHeikin(heikin, "ribbon on, heikin selected");

  const chooseChartType = async (label: string) => {
    await page.locator(".pophost").filter({ has: page.locator(".chart-type-pop") }).locator("button.tbtn").first().click();
    await expect(page.locator(".chart-type-pop.show")).toBeVisible();
    await page.locator(".chart-type-pop.show .chart-type-row").filter({ hasText: label }).first().click();
  };

  // Candles: the ribbon must now decorate RAW bars, because that is what "Candles" means.
  await chooseChartType("Candles");
  await expect.poll(async () => {
    const read = await readSeries(page);
    return read.rows.length > 0 && maxDeviation(read.rows, RAW) < 1e-6;
  }, { message: "selecting Candles should render the raw OHLC", timeout: 30_000 }).toBe(true);
  const candles = await seriesWithPaint(page, "all", "the Ribbon should still paint the candle chart");
  expectRaw(candles, "ribbon on, candles selected");

  // Bars: one color channel only — the OHLC-bar family has no border/wick to paint.
  await chooseChartType("Bars");
  const bars = await seriesWithPaint(page, "all", "the Ribbon should still paint the bar chart");
  expectRaw(bars, "ribbon on, bars selected");
  for (const row of bars.rows) {
    expect(row.borderColor, `${row.time}: OHLC bars take no border color`).toBeUndefined();
    expect(row.wickColor, `${row.time}: OHLC bars take no wick color`).toBeUndefined();
  }

  // Back to Heikin Ashi: the newly selected representation, not the stale raw data.
  await chooseChartType("Heikin Ashi");
  await expect.poll(async () => {
    const read = await readSeries(page);
    return read.rows.length > 0 && maxDeviation(read.rows, HEIKIN) < 1e-6;
  }, { message: "selecting Heikin Ashi should render the transform again", timeout: 30_000 }).toBe(true);
  const back = await seriesWithPaint(page, "all", "the Ribbon should repaint the Heikin-Ashi chart");
  expectHeikin(back, "ribbon on, heikin reselected");
  expect(back.rows).toEqual(heikin.rows);
});

test("the Ribbon overrides Color bars on previous close without disturbing Heikin-Ashi geometry", async ({ page }) => {
  test.setTimeout(180_000);   // two full chart mounts (see the note on the first walk)
  await routeFixture(page);
  // `colorBarsPrevClose` is the other per-point writer in priceData(). With the Ribbon off it owns
  // the paint; with the Ribbon on the Ribbon owns it — and the geometry is the same either way.
  await seedWorkspace(page, { chartType: "heikin", inds: [], chartSettings: { colorBarsPrevClose: true } });
  await openTerminal(page);

  const prevClose = await seriesWithPaint(page, "all", "colorBarsPrevClose should paint every bar");
  expectHeikin(prevClose, "prev-close paint, no ribbon");
  expect(paintPalette(prevClose).length, "prev-close paint is a two-color up/down scheme").toBe(2);

  await page.evaluate(() => localStorage.setItem("mm.inds", JSON.stringify(["ribbon"])));
  await page.reload();
  await expect.poll(
    () => page.evaluate(() => Boolean((window as Window & { __mmRibbonReady?: boolean }).__mmRibbonReady)),
    { message: "the Terminal should re-hydrate with the Ribbon restored", timeout: 45_000 },
  ).toBe(true);

  const ribbon = await seriesWithPaint(page, "all", "the Ribbon should paint over the prev-close scheme");
  expectHeikin(ribbon, "prev-close paint + ribbon");
  expect(ribbon.rows.map((r) => [r.time, r.open, r.high, r.low, r.close]))
    .toEqual(prevClose.rows.map((r) => [r.time, r.open, r.high, r.low, r.close]));
  // Both schemes draw from the same up/down hues, so the discriminator is the per-bar ASSIGNMENT:
  // prev-close colors by `close >= previous close`, the Ribbon by its own trend state.
  expect(paintSequence(ribbon), "the Ribbon should own the paint, not colorBarsPrevClose")
    .not.toEqual(paintSequence(prevClose));
});
