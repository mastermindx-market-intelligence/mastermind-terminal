import { expect, test, type Page } from "@playwright/test";

/**
 * A cold chart must load the timeframe the USER opens on — not the server-rendered default.
 *
 * ── The defect this pins ─────────────────────────────────────────────────────────────────────
 *
 * `TerminalShell` resolves the persisted startup timeframe (`mm.startTf`) in a mount effect, and
 * React commits that update ~1.05s later (measured, dev build; no network in the gap). But
 * `ChartPanel`'s data effect runs at ~130ms. So a chart whose startup timeframe is not the SSR
 * default used to run a COMPLETE discarded load first — `/data/<sym>.json`, `setData`,
 * `buildAllIndicators`, paint — and only then start the real one. Nothing cancelled it: the
 * effect's `cancelled` flag only flips in its cleanup, which runs on the dep change, and that
 * commit lands behind the in-flight discarded work.
 *
 * Measured on a cold 1s chart, ten runs each:
 *
 *   discarded leg (effect2@3D -> effect2@1s)   p50 1142ms   p95 1225ms      (unthrottled)
 *   first live repaint                          p50 2782ms   p95 2816ms      (unthrottled)
 *   discarded leg at 4x CPU throttle            2729-3091ms, and the 1s chart then NEVER
 *                                               loaded inside 45s — 0 of 4 runs reached a
 *                                               first live candle at all.
 *
 * ── Why this asserts ORDER, not latency ──────────────────────────────────────────────────────
 *
 * The defect is an ordering defect, so this pins ordering: it needs no sleep, no CPU throttle and
 * no timing budget, and it cannot go flaky on a loaded runner. `live-candle.spec.ts` remains the
 * behavioural contract for the merge itself; this is the cold-start contract underneath it.
 *
 * The marks come from the product's own `?boottrace=1` tracer (`cpMark`), which is deliberately
 * kept in production builds — this asserts on the shipped instrumentation rather than a test-only
 * seam.
 */

async function seedStartTimeframe(page: Page, tf: string) {
  await page.addInitScript((value) => {
    localStorage.setItem("mm.startTf", JSON.stringify(value));
    // The contract under test is the data-load timeframe, not indicator construction.
    localStorage.setItem("mm.inds", JSON.stringify([]));
    localStorage.removeItem("mm.ws");
  }, tf);
}

test("a cold chart loads the user's startup timeframe first, with no discarded default-timeframe load", async ({ page }) => {
  test.slow();

  const dataLoads: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    const started = /\[boottrace\] chart-effect2-start\[[^\]]*@([^\]]+)\]/.exec(text);
    if (started) dataLoads.push(started[1]);
  });

  // NVDA + the second band is the narrowest case that differs from the SSR default (3D): the
  // seconds group is US-equity only and gated on the server's HUB_REALTIME_QUOTES lever, which
  // playwright.config.ts sets for this suite.
  await seedStartTimeframe(page, "1s");
  await page.goto("/terminal?symbol=NVDA&boottrace=1");

  await expect
    .poll(() => dataLoads.length, {
      message: "the chart should start a data load on a cold terminal",
      timeout: 45_000,
    })
    .toBeGreaterThan(0);

  // THE assertion. Before the fix this array began with the SSR default ("3D"); the user's own
  // timeframe only appeared as a second entry, after the first load had already been fetched,
  // painted and thrown away.
  expect(
    dataLoads[0],
    `the FIRST data load must be the user's startup timeframe, not the server-rendered default. Saw: ${JSON.stringify(dataLoads)}`,
  ).toBe("1s");

  // And the discarded load must not reappear later by another route.
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  expect(
    dataLoads.filter((tf) => tf !== "1s"),
    `no load on any other timeframe should occur. Saw: ${JSON.stringify(dataLoads)}`,
  ).toEqual([]);
});
