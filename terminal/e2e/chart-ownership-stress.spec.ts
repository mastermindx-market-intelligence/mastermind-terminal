import { writeFile } from "node:fs/promises";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * Chart lifecycle ownership under prolonged churn.
 *
 * docs/CHART_ENGINE_MASTERPLAN.md's quality gate promises "no leak across 50
 * symbol/timeframe switches", and until now nothing checked it. ChartPanel drives the
 * renderer imperatively at ~50 raw addSeries call sites, across five owner families
 * (price, future axis, compare, built-in indicators, Pine) plus price lines, marker
 * primitives, a sync registration, observers and timers — all canvas-side, none of it
 * visible in the DOM. A leak there has no assertable surface.
 *
 * So this spec asserts OWNERSHIP, not heap bytes. window.__mmChartOwnership() (dev-only,
 * ChartPanel) reports two independent views of the same resources:
 *
 *   live   — what the RENDERER says it holds, read back through the engine contract's
 *            inventory() from lightweight-charts' own panes()/getSeries()/priceLines().
 *   owned  — what ChartPanel still claims to own, summed from its tracking refs.
 *
 * Every series this component creates is returned into one of those owners, so the two
 * totals must agree. `orphanSeries` / `orphanPricePaneLines` are their signed difference:
 * positive means a resource outlived the owner that created it, negative means we are
 * holding a handle the renderer already dropped. Both are exact integers, so nothing here
 * depends on when a garbage collector happens to run — the "GC eventually fixes it"
 * escape hatch is closed by construction.
 *
 * Desktop only: this is renderer bookkeeping, identical at every viewport, and the churn
 * is far too heavy to pay for three times on a one-worker CI runner.
 */

type VisualReadyDetail = {
  symbol: string;
  timeframe: string;
  generation: number;
  state: "data" | "empty";
};

type Census = {
  engine: number;
  live: { alive: boolean; panes: number; series: number; seriesByPane: number[]; priceLines: number; watermarks: number };
  owned: { price: number; futureAxis: number; indicators: number; compare: number; pine: number };
  trackedSeries: number;
  orphanSeries: number;
  pricePaneLines: number;
  trackedPricePaneLines: number;
  orphanPricePaneLines: number;
  markerPlugins: number;
  syncRegistered: number;
  paneObserver: number;
  paneMeta: number;
  timers: { tag: number; countdown: number; pineLive: number; highlight: number };
  domOverlays: number;
  canvases: number;
};

// Declared as a local window shape rather than `declare global`: e2e/indicator-snapshot.spec.ts
// already augments Window with __mmTerminalReadyEvents, and two files cannot declare the same
// global property with different optionality.
type OwnershipWindow = Window & {
  __mmOwnershipReady?: VisualReadyDetail[];
  __mmChartOwnership?: () => Census;
  __mmChartOwnershipFinal?: Census;
};

const SYMBOLS = ["AAPL", "MSFT", "NVDA", "AMD"];
// Daily-family timeframes only. The intraday branch reaches /api/intraday, which has no
// deterministic fixture here and would settle as `empty` — a real state, but one that
// clears the chart and so measures teardown rather than steady-state ownership.
const TIMEFRAMES = ["D", "W", "3D"];

// Two indicator sets applied through the product's own template seam (mm:apply-template,
// fed from localStorage). BASE is the working set; WIDE adds a pane-0 overlay AND a sub-pane
// that lands BETWEEN two existing ones in canonical order (SUBPANE_ORDER puts stochrsi
// between rsi and macd), which is what forces ChartPanel down its bounded full-rebuild path
// rather than the cheap tail-append. Both directions of that transition are exercised.
const TEMPLATE_BASE = { id: "own-base", name: "ownership base", indicators: ["ema", "vol", "rsi", "macd"], indParams: {} };
const TEMPLATE_WIDE = { id: "own-wide", name: "ownership wide", indicators: ["ema", "vol", "bb", "rsi", "stochrsi", "macd"], indParams: {} };

/** Seed prefs + the visual-ready tap before the app boots. */
async function boot(page: Page, indicators: string[]) {
  await page.addInitScript(
    ({ inds, templates }: { inds: string[]; templates: unknown[] }) => {
      localStorage.setItem("mm.inds", JSON.stringify(inds));
      localStorage.setItem("mm.startTf", JSON.stringify("D"));
      localStorage.setItem("mm.chartTemplates", JSON.stringify(templates));
      const target = window as unknown as { __mmOwnershipReady?: VisualReadyDetail[] };
      target.__mmOwnershipReady = [];
      window.addEventListener("mm:terminal-visual-ready", (event) => {
        target.__mmOwnershipReady!.push((event as CustomEvent<VisualReadyDetail>).detail);
      });
    },
    { inds: indicators, templates: [TEMPLATE_BASE, TEMPLATE_WIDE] },
  );
  await page.goto(`/terminal?symbol=${SYMBOLS[0]}`);
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });
  await settle(page, SYMBOLS[0], "D", 0);
}

/** How many end-of-generation receipts have been seen so far. */
const readyCount = (page: Page) =>
  page.evaluate(() => ((window as unknown as { __mmOwnershipReady?: VisualReadyDetail[] }).__mmOwnershipReady ?? []).length);

/**
 * Wait for THIS (symbol, timeframe) generation to finish building.
 *
 * `mm:terminal-visual-ready` is the app's own end-of-generation receipt: ChartPanel fires
 * it once the requested indicator set is built and the first coordinate map is live. That
 * is exactly "settled" for ownership purposes — measuring earlier would sample a half-built
 * generation and read its missing series as a negative orphan.
 */
async function settle(page: Page, symbol: string, timeframe: string, since: number) {
  await expect
    .poll(
      () => page.evaluate(([s, tf, from]) => {
        const events = (window as unknown as { __mmOwnershipReady?: VisualReadyDetail[] }).__mmOwnershipReady ?? [];
        // Only receipts issued AFTER the action count. A chartType change keeps the symbol and
        // timeframe, so matching the newest receipt of any age would accept the PREVIOUS
        // generation and sample a chart that is still rebuilding.
        for (let i = events.length - 1; i >= Number(from); i--) {
          const e = events[i];
          if (e.symbol === s && e.timeframe === tf) return e.state;
        }
        return null;
      }, [symbol, timeframe, String(since)] as [string, string, string]),
      { timeout: 45_000, message: `the chart never settled on ${symbol} @ ${timeframe}` },
    )
    .toBe("data");
}

/** Same receipt, for a generation that legitimately ends with no data. */
async function settleEmpty(page: Page, symbol: string, timeframe: string, since: number) {
  await expect
    .poll(
      () => page.evaluate(([s, tf, from]) => {
        const events = (window as unknown as { __mmOwnershipReady?: VisualReadyDetail[] }).__mmOwnershipReady ?? [];
        for (let i = events.length - 1; i >= Number(from); i--) {
          const e = events[i];
          if (e.symbol === s && e.timeframe === tf) return e.state;
        }
        return null;
      }, [symbol, timeframe, String(since)] as [string, string, string]),
      { timeout: 45_000, message: `the chart never settled empty on ${symbol} @ ${timeframe}` },
    )
    .toBe("empty");
}

/**
 * Read the census once it repeats.
 *
 * Not every transition ends in a visual-ready receipt — an indicator template applies through
 * React state with no new data generation behind it. Two identical consecutive readings is the
 * honest settle for those: it waits for the renderer to stop moving without hard-coding what
 * the resulting counts ought to be.
 */
async function settledCensus(page: Page, message: string): Promise<Census> {
  let previous = "";
  let current: Census | null = null;
  await expect
    .poll(async () => {
      const sample = await census(page);
      const signature = JSON.stringify([sample.live.series, sample.live.panes, sample.trackedSeries, sample.pricePaneLines, sample.owned]);
      const repeated = signature === previous;
      previous = signature;
      current = sample;
      return repeated;
    }, { timeout: 30_000, intervals: [120, 200, 300], message })
    .toBe(true);
  return current as unknown as Census;
}

const census = async (page: Page): Promise<Census> => {
  const value = await page.evaluate(() => (window as unknown as OwnershipWindow).__mmChartOwnership?.() ?? null);
  expect(value, "the ownership probe should be installed while the chart is mounted").not.toBeNull();
  return value as Census;
};

const setSymbol = (page: Page, symbol: string) =>
  page.evaluate((s) => window.dispatchEvent(new CustomEvent("mm:embedded-symbol", { detail: { symbol: s } })), symbol);

const setTimeframe = (page: Page, tf: string) =>
  page.evaluate((t) => window.dispatchEvent(new CustomEvent("mm:set-tf", { detail: { tf: t } })), tf);

/** Assertions every settled generation must satisfy, whatever else changed. */
function expectSoundOwnership(sample: Census, label: string) {
  expect(sample.engine, `${label}: exactly one chart engine should be alive`).toBe(1);
  expect(sample.live.alive, `${label}: the engine should not be disposed mid-session`).toBe(true);
  // The headline invariant. Renderer truth and component bookkeeping must agree exactly:
  // a series the renderer still holds that no owner claims is, by definition, an orphan.
  expect(sample.orphanSeries, `${label}: renderer series must match the owners that created them`).toBe(0);
  // Price lines on the shared price series outlive every generation, so each one must be
  // pooled for explicit removal. Anything unpooled accumulates for the session's lifetime.
  expect(sample.orphanPricePaneLines, `${label}: price lines on the price series must all be pooled`).toBe(0);
  // reRegisterSync() runs once per symbol/timeframe generation and must retire the previous
  // registration before making a new one.
  expect(sample.syncRegistered, `${label}: at most one live paneSync registration`).toBeLessThanOrEqual(1);
  expect(sample.owned.price, `${label}: exactly one price series`).toBe(1);
  expect(sample.owned.futureAxis, `${label}: the future-axis helper is created once and reused`).toBeLessThanOrEqual(1);
  expect(sample.paneObserver, `${label}: one pane ResizeObserver`).toBeLessThanOrEqual(1);
  expect(sample.timers.tag, `${label}: one price-tag ticker`).toBeLessThanOrEqual(1);
  expect(sample.timers.countdown, `${label}: at most one countdown ticker`).toBeLessThanOrEqual(1);
}

/**
 * Persist the per-generation trace as a run artifact. Written to a file rather than
 * attached inline so the numbers survive the `list` reporter — the trace IS the evidence
 * for the ownership claim, and a claim whose evidence is discarded on success is not
 * checkable after the fact.
 */
async function attachTrace(testInfo: TestInfo, name: string, samples: { label: string; sample: Census }[]) {
  const path = testInfo.outputPath(name);
  await writeFile(
    path,
    JSON.stringify(
      samples.map(({ label, sample }) => ({
        label,
        series: sample.live.series,
        tracked: sample.trackedSeries,
        orphanSeries: sample.orphanSeries,
        panes: sample.live.panes,
        seriesByPane: sample.live.seriesByPane,
        pricePaneLines: sample.pricePaneLines,
        orphanPricePaneLines: sample.orphanPricePaneLines,
        markerPlugins: sample.markerPlugins,
        sync: sample.syncRegistered,
        paneMeta: sample.paneMeta,
        domOverlays: sample.domOverlays,
        canvases: sample.canvases,
      })),
      null,
      2,
    ),
    "utf8",
  );
  await testInfo.attach(name, { path, contentType: "application/json" });
}

test.describe("chart lifecycle ownership", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Renderer bookkeeping is viewport-independent.");
  });

  test("50 symbol/timeframe transitions leave no orphaned chart resources", async ({ page }, testInfo) => {
    test.setTimeout(20 * 60_000);

    // A representative default-ish set: two pane-0 overlays and two sub-panes, so every
    // transition rebuilds overlays, sub-panes AND the pane topology underneath them.
    await boot(page, ["ema", "vol", "rsi", "macd"]);

    const samples: { label: string; sample: Census }[] = [];
    const first = await census(page);
    samples.push({ label: "baseline AAPL@D", sample: first });
    expectSoundOwnership(first, "baseline");

    // Alternate the two axes rather than sweeping one: a symbol change and a timeframe
    // change take different paths through Effect 2 (full rebuild vs the in-place
    // update path), and alternating them also forces the resample cache to turn over.
    const TRANSITIONS = 52;
    let symbol = SYMBOLS[0];
    let timeframe = "D";
    for (let i = 0; i < TRANSITIONS; i++) {
      const since = await readyCount(page);
      if (i % 2 === 0) {
        symbol = SYMBOLS[(i / 2 + 1) % SYMBOLS.length];
        await setSymbol(page, symbol);
      } else {
        timeframe = TIMEFRAMES[(((i - 1) / 2) + 1) % TIMEFRAMES.length];
        await setTimeframe(page, timeframe);
      }
      await settle(page, symbol, timeframe, since);
      const sample = await census(page);
      const label = `#${i + 1} ${symbol}@${timeframe}`;
      samples.push({ label, sample });
      expectSoundOwnership(sample, label);
    }

    await attachTrace(testInfo, "ownership-trace-symbol-timeframe.json", samples);

    // Bounded, not merely "not obviously exploding": the indicator set is fixed and
    // compare is cleared on every symbol change, so a sound chart holds the SAME number
    // of series in every settled generation. Warm-up is excluded — the future-axis helper
    // and the volume pane are created lazily on the first build.
    const warm = samples.slice(4).map((s) => s.sample.live.series);
    expect(Math.max(...warm) - Math.min(...warm), "live series count should not drift across generations").toBe(0);

    const panes = samples.slice(4).map((s) => s.sample.live.panes);
    expect(Math.max(...panes) - Math.min(...panes), "pane count should not drift across generations").toBe(0);

    const lines = samples.map((s) => s.sample.pricePaneLines);
    expect(Math.max(...lines), "no price line should accumulate on the price series").toBeLessThanOrEqual(
      Math.min(...lines) + 1,
    );

    const markers = samples.map((s) => s.sample.markerPlugins);
    expect(Math.max(...markers), "marker primitives should not accumulate").toBeLessThanOrEqual(4);

    const overlays = samples.map((s) => s.sample.domOverlays);
    expect(Math.max(...overlays) - Math.min(...overlays), "DOM overlays are mount-owned and must not churn").toBe(0);

    // The chart is still a working chart after all of that — a leak-free chart that
    // stopped rendering would pass every count above.
    const canvas = page.locator(".chart-wrap canvas").first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height * 0.5);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __mmCrosshairDodge?: () => { crossY: number | null } })
        .__mmCrosshairDodge?.().crossY ?? null), { timeout: 15_000, message: "the crosshair should still track the pointer after the stress run" })
      .not.toBeNull();
  });

  test("compare, indicator, family and replay churn returns to the same ownership", async ({ page }, testInfo) => {
    test.setTimeout(15 * 60_000);

    await boot(page, TEMPLATE_BASE.indicators);
    const samples: { label: string; sample: Census }[] = [];
    const baseline = await census(page);
    samples.push({ label: "baseline", sample: baseline });
    expectSoundOwnership(baseline, "baseline");

    // ── compare overlays ──────────────────────────────────────────────────────────────
    // Driven through the product's real search-in-compare flow, so the add and the remove
    // both go through the paths a user actually takes (rebuildCompare's generation token is
    // the thing under test — two rapid edits share one symbol epoch).
    for (let round = 0; round < 3; round++) {
      await addCompare(page, "MSFT");
      const added = await settledCensus(page, "the compare overlay should reach a steady state");
      expectSoundOwnership(added, `compare added #${round + 1}`);
      expect(added.owned.compare, "the compare overlay should be tracked").toBe(1);
      samples.push({ label: `compare+ #${round + 1}`, sample: added });

      await removeCompare(page, "MSFT");
      const removed = await settledCensus(page, "the compare overlay should be released");
      expectSoundOwnership(removed, `compare removed #${round + 1}`);
      expect(removed.owned.compare, "the compare overlay should be released").toBe(0);
      expect(removed.live.series, "compare add/remove should round-trip to the baseline series count")
        .toBe(baseline.live.series);
      samples.push({ label: `compare- #${round + 1}`, sample: removed });
    }

    // ── indicator add / remove / reorder ──────────────────────────────────────────────
    // WIDE adds an overlay and inserts a sub-pane between two existing ones, so each swap
    // runs both the incremental overlay path and the bounded full sub-pane rebuild.
    for (let round = 0; round < 4; round++) {
      await applyTemplate(page, TEMPLATE_WIDE.id);
      const wide = await settledCensus(page, "the wider indicator set should reach a steady state");
      expectSoundOwnership(wide, `indicators wide #${round + 1}`);
      expect(wide.live.series, "the wider set should actually add series").toBeGreaterThan(baseline.live.series);
      samples.push({ label: `inds wide #${round + 1}`, sample: wide });

      await applyTemplate(page, TEMPLATE_BASE.id);
      const back = await settledCensus(page, "the base indicator set should reach a steady state");
      expectSoundOwnership(back, `indicators base #${round + 1}`);
      expect(back.live.series, "an indicator round-trip should return to the baseline series count")
        .toBe(baseline.live.series);
      expect(back.live.panes, "an indicator round-trip should return to the baseline pane count")
        .toBe(baseline.live.panes);
      samples.push({ label: `inds base #${round + 1}`, sample: back });
    }

    // ── chart family ──────────────────────────────────────────────────────────────────
    // candles → line replaces the PRIMARY price series, the long-lived owner that every
    // pooled price line, the session-shading primitive and the sync registration anchor to.
    for (let round = 0; round < 3; round++) {
      for (const kind of ["Line", "Candles"]) {
        const since = await readyCount(page);
        await setChartType(page, kind);
        await settle(page, SYMBOLS[0], "D", since);
        const sample = await settledCensus(page, `the ${kind} chart family should reach a steady state`);
        expectSoundOwnership(sample, `family ${kind} #${round + 1}`);
        samples.push({ label: `${kind} #${round + 1}`, sample });
      }
      expect(
        samples[samples.length - 1].sample.live.series,
        "a family round-trip should return to the baseline series count",
      ).toBe(baseline.live.series);
    }

    // ── replay ────────────────────────────────────────────────────────────────────────
    // Replay re-slices the bar set and re-registers the pane with paneSync, so entering and
    // leaving it twice is a direct check that the sync registration does not stack.
    for (let round = 0; round < 2; round++) {
      await toggleReplay(page);
      const inReplay = await settledCensus(page, "replay should reach a steady state");
      expectSoundOwnership(inReplay, `replay on #${round + 1}`);
      samples.push({ label: `replay+ #${round + 1}`, sample: inReplay });

      await toggleReplay(page);
      const outOfReplay = await settledCensus(page, "leaving replay should reach a steady state");
      expectSoundOwnership(outOfReplay, `replay off #${round + 1}`);
      samples.push({ label: `replay- #${round + 1}`, sample: outOfReplay });
    }

    await attachTrace(testInfo, "ownership-trace-churn.json", samples);

    const final = samples[samples.length - 1].sample;
    expect(final.live.series, "every churn cycle should round-trip to the baseline series count").toBe(baseline.live.series);
    expect(final.live.panes, "every churn cycle should round-trip to the baseline pane count").toBe(baseline.live.panes);
    expect(final.pricePaneLines, "no churn cycle should strand a price line on the price series")
      .toBeLessThanOrEqual(baseline.pricePaneLines);
    expect(final.markerPlugins, "no churn cycle should strand a marker primitive")
      .toBeLessThanOrEqual(baseline.markerPlugins);
    expect(final.domOverlays, "DOM overlays are mount-owned and must not churn").toBe(baseline.domOverlays);
  });

  test("a dead-ended fetch releases every study owner", async ({ page }) => {
    test.setTimeout(10 * 60_000);

    // The operator report behind e2e/no-data-symbol.spec.ts (000001.SS, 2026-08-05) was that a
    // symbol with no history kept the PREVIOUS symbol's chart. That spec proves the bars and the
    // badge are gone; this one proves the OWNERSHIP behind them is released too — a study whose
    // series is still on the chart is the same defect one layer down, and clearChartData() reaches
    // each owner through a different call.
    await boot(page, TEMPLATE_BASE.indicators);
    const loaded = await census(page);
    expect(loaded.owned.indicators, "the fixture symbol should actually have studies to release").toBeGreaterThan(0);

    const since = await readyCount(page);
    // Synthetic on purpose, matching no-data-symbol.spec.ts: a real ticker could gain a fixture
    // later and quietly turn this guard vacuous.
    await setSymbol(page, "NOSUCH.TEST");
    await settleEmpty(page, "NOSUCH.TEST", "D", since);

    const dead = await settledCensus(page, "the emptied chart should reach a steady state");
    expect(dead.orphanSeries, "an emptied chart must not strand series").toBe(0);
    expect(dead.owned.indicators, "every built-in study should be released").toBe(0);
    expect(dead.owned.compare, "every compare overlay should be released").toBe(0);
    expect(dead.owned.pine, "every custom-script series should be released").toBe(0);
    expect(dead.pricePaneLines, "no study should leave a price line on the price series").toBe(0);
    expect(dead.markerPlugins, "no study should leave a marker primitive").toBe(0);
    // The price series itself is emptied, not removed — it is the chart's own long-lived owner.
    expect(dead.owned.price, "the price series stays, holding no data").toBe(1);
    expect(dead.live.series, "only the chart's own long-lived series should remain")
      .toBeLessThanOrEqual(dead.owned.price + dead.owned.futureAxis);

    // And it recovers: a real symbol after the dead end rebuilds to a sound chart.
    const back = await readyCount(page);
    await setSymbol(page, SYMBOLS[0]);
    await settle(page, SYMBOLS[0], "D", back);
    const recovered = await settledCensus(page, "the chart should rebuild after the dead end");
    expectSoundOwnership(recovered, "recovered");
    expect(recovered.live.series, "the rebuilt chart should match the pre-dead-end ownership").toBe(loaded.live.series);
  });

  test("unmounting the chart leaves nothing behind", async ({ page }) => {
    test.setTimeout(10 * 60_000);

    await boot(page, ["ema", "vol", "rsi", "macd"]);
    // Churn first: an unmount is only interesting once there is something to fail to release.
    for (let i = 0; i < 6; i++) {
      const symbol = SYMBOLS[(i + 1) % SYMBOLS.length];
      const since = await readyCount(page);
      await setSymbol(page, symbol);
      await settle(page, symbol, "D", since);
    }
    const before = await census(page);
    expect(before.engine).toBe(1);
    expect(before.canvases).toBeGreaterThan(0);

    // Leaving the route unmounts ChartPanel through React, the same path a workspace
    // switch takes — not a page teardown, which would prove nothing about our cleanup.
    await page.locator(".appnav").getByRole("link", { name: "Analysis" }).click(ACT);
    await expect(page).toHaveURL(/\/analysis\b/, { timeout: 45_000 });

    await expect
      .poll(() => page.evaluate(() => (window as unknown as OwnershipWindow).__mmChartOwnershipFinal ?? null), {
        timeout: 30_000,
        message: "ChartPanel's teardown should publish its closing ownership receipt",
      })
      .not.toBeNull();

    const final = (await page.evaluate(() => (window as unknown as OwnershipWindow).__mmChartOwnershipFinal!)) as Census;
    expect(final.engine, "the chart engine should be destroyed and released").toBe(0);
    expect(final.live.alive, "the renderer should report itself disposed").toBe(false);
    expect(final.live.series, "no series should survive the engine").toBe(0);
    expect(final.live.priceLines, "no price line should survive the engine").toBe(0);
    expect(final.trackedSeries, "no series handle should survive in a tracking ref").toBe(0);
    expect(final.owned, "every series owner should be empty").toEqual({ price: 0, futureAxis: 0, indicators: 0, compare: 0, pine: 0 });
    expect(final.trackedPricePaneLines, "the price-line pool should be empty").toBe(0);
    expect(final.markerPlugins, "no marker primitive should survive").toBe(0);
    expect(final.syncRegistered, "the paneSync registration should be retired").toBe(0);
    expect(final.paneObserver, "the pane ResizeObserver should be disconnected").toBe(0);
    expect(final.timers, "every chart timer should be cleared").toEqual({ tag: 0, countdown: 0, pineLive: 0, highlight: 0 });
    expect(final.domOverlays, "every DOM overlay should be detached").toBe(0);
    // lightweight-charts removes its canvases from the container on chart.remove(); any
    // left behind means the renderer was never told to dispose.
    expect(final.canvases, "the renderer should have removed its canvases").toBe(0);
    // And the live probe goes with the mount.
    expect(await page.evaluate(() => typeof (window as unknown as OwnershipWindow).__mmChartOwnership), "the live probe should be uninstalled").toBe("undefined");

    // Remount. A teardown that released nothing would show up here as a second chart's worth of
    // resources on top of the first — the classic symptom of an unmount that only *looked* clean.
    await page.locator(".appnav").getByRole("link", { name: "Chart" }).click(ACT);
    await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });
    const remounted = await settledCensus(page, "the remounted chart should reach a steady state");
    expectSoundOwnership(remounted, "remounted");
    expect(remounted.live.series, "a remount should rebuild exactly one chart's worth of series")
      .toBe(before.live.series);
    expect(remounted.live.panes, "a remount should rebuild exactly one chart's worth of panes")
      .toBe(before.live.panes);
    expect(remounted.domOverlays, "a remount should rebuild exactly one chart's worth of overlays")
      .toBe(before.domOverlays);
    expect(remounted.canvases, "a remount should leave exactly one renderer's canvases in the container")
      .toBe(before.canvases);
  });
});

// Every click/fill below carries an explicit budget. Playwright's default actionTimeout is 0,
// so an element that never appears would consume the whole test clock and report "test timed
// out" instead of naming the control it was waiting for.
const ACT = { timeout: 20_000 };

/** The compare-mode search modal (SearchModal's `.smodal-cmp`), and its explicit ESC control. */
const compareModal = (page: Page) => page.locator(".smodal-cmp");

/**
 * Add a compare overlay through the product's own search-in-compare flow.
 * In compare mode a row click opens the price/% chooser — the segment button is the commit —
 * and the modal stays open afterwards, so it is dismissed through its own ESC control (the
 * keyboard Escape handler lives on the input and only fires while that input holds focus).
 */
async function addCompare(page: Page, symbol: string) {
  await page.locator("button.cmp-btn").first().click(ACT);
  const modal = compareModal(page);
  await expect(modal).toBeVisible({ timeout: 20_000 });
  await modal.getByRole("combobox").first().fill(symbol, ACT);
  await modal.locator(`.r-opt:has(.tk:text-is("${symbol}"))`).first().click(ACT);
  await modal.locator(".cmp-add-wrap.is-choosing .cmp-seg-half").last().click(ACT);
  await modal.locator(".esc").first().click(ACT);
  await expect(modal).toBeHidden({ timeout: 20_000 });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as OwnershipWindow).__mmChartOwnership?.().owned.compare ?? 0), {
      timeout: 30_000,
      message: `the ${symbol} compare overlay should reach the chart`,
    })
    .toBe(1);
}

/** Remove it the same way: in compare mode a row that is already added toggles itself off. */
async function removeCompare(page: Page, symbol: string) {
  await page.locator("button.cmp-btn").first().click(ACT);
  const modal = compareModal(page);
  await expect(modal).toBeVisible({ timeout: 20_000 });
  await modal.getByRole("combobox").first().fill(symbol, ACT);
  await modal.locator(`.r-opt:has(.tk:text-is("${symbol}"))`).first().click(ACT);
  await modal.locator(".esc").first().click(ACT);
  await expect(modal).toBeHidden({ timeout: 20_000 });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as OwnershipWindow).__mmChartOwnership?.().owned.compare ?? 1), {
      timeout: 30_000,
      message: `the ${symbol} compare overlay should leave the chart`,
    })
    .toBe(0);
}

/** Apply a seeded indicator template through the shell's own event seam. */
const applyTemplate = (page: Page, id: string) =>
  page.evaluate((templateId) => window.dispatchEvent(new CustomEvent("mm:apply-template", { detail: { id: templateId } })), id);

async function setChartType(page: Page, label: string) {
  await page.locator(".pophost:has(.chart-type-pop) > button.tbtn").first().click(ACT);
  await page.locator(`.chart-type-row:has(span:text-is("${label}"))`).first().click(ACT);
}

/**
 * Toggle replay.
 *
 * The replay control carries `toolbar-overflow-item`: the toolbar measures itself and moves it
 * into the More menu whenever the visible row cannot hold it, which at 1440x900 with this
 * workspace it cannot. So take whichever surface actually rendered it, the way a user would,
 * rather than assuming the inline button is on screen.
 */
async function toggleReplay(page: Page) {
  const inline = page.locator('button[data-toolbar-action="replay"]').first();
  if (await inline.isVisible().catch(() => false)) {
    await inline.click(ACT);
    return;
  }
  await page.locator('[data-testid="toolbar-more"]').first().click(ACT);
  await page.locator('[data-toolbar-menu-action="replay"]').first().click(ACT);
}
