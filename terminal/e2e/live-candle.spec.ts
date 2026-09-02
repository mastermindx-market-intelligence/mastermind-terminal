import { expect, test, type Page } from "@playwright/test";

const DISPLAY_DAY = Date.UTC(2026, 7, 7) / 1000;
const TRUE_DAY = Date.UTC(2026, 7, 7, 4) / 1000; // midnight ET during EDT
const display = (hour: number, minute: number, second: number) =>
  DISPLAY_DAY + hour * 3600 + minute * 60 + second;
const trueMs = (hour: number, minute: number, second: number) =>
  (TRUE_DAY + hour * 3600 + minute * 60 + second) * 1000;

async function seedLiveCandleWorkspace(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("mm.startTf", JSON.stringify("1s"));
    // This contract measures the quote-to-candle handoff, not indicator construction. Keeping
    // the default two subpanes enabled can monopolize a saturated CI page after visual-ready and
    // starve the liveQuote effect even though the mocked packet has already reached the header.
    localStorage.setItem("mm.inds", JSON.stringify([]));
    localStorage.removeItem("mm.ws");
  });
}

test("measured one-second packets reshape and roll the live candle at every supported width", async ({ page }, testInfo) => {
  test.slow();
  let liveTickIndex = -1;
  let intradayFixtureServed = false;
  const ticks = [
    { second: 1, open: 100, high: 100.6, low: 99.9, close: 100.4, vol: 18 },
    { second: 2, open: 100.4, high: 100.5, low: 99.5, close: 99.7, vol: 24 },
    { second: 3, open: 99.7, high: 100.3, low: 99.6, close: 100.25, vol: 31 },
  ];

  await page.route("**/api/intraday?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("sym") !== "NVDA" || url.searchParams.get("tf") !== "1s") {
      await route.continue();
      return;
    }
    await route.fulfill({
      json: {
        t: "NVDA",
        tf: "1s",
        source: "live-candle-e2e",
        session_date: "2026-08-07",
        bars: [
          [display(9, 29, 58), 99.8, 100, 99.7, 99.95, 16],
          [display(9, 29, 59), 99.95, 100.1, 99.9, 100, 14],
          [display(9, 30, 0), 100, 100.2, 99.9, 100, 20],
        ],
      },
    });
    intradayFixtureServed = true;
  });

  await page.route("**/api/quote?**", async (route) => {
    const url = new URL(route.request().url());
    const fast = url.searchParams.get("cadence") === "chart";
    // The test advances this index only after the prior packet is visible on
    // the canvas. On a busy two-worker CI runner React may legitimately coalesce
    // several immediately resolved fetches into one render; handshaking the
    // packets verifies three actual series mutations instead of scheduler speed.
    const tick = fast && liveTickIndex >= 0 ? ticks[liveTickIndex] : null;
    const syms = (url.searchParams.get("syms") || "NVDA").split(",").filter(Boolean);
    const quotes = Object.fromEntries(syms.map((sym) => [sym, sym === "NVDA" ? {
      sym,
      last: tick?.close ?? 100,
      prevClose: 98,
      chg: (((tick?.close ?? 100) - 98) / 98) * 100,
      open: 100,
      high: Math.max(100.6, tick?.high ?? 100.2),
      low: Math.min(99.5, tick?.low ?? 99.9),
      vol: 100_000,
      ts: Math.floor((tick ? trueMs(9, 30, tick.second) + 999 : trueMs(9, 30, 0) + 999) / 1000),
      asOfMs: tick ? trueMs(9, 30, tick.second) + 999 : trueMs(9, 30, 0) + 999,
      lagMs: 35,
      live: true,
      basis: "REALTIME",
      market: "us",
      marketSession: "rth",
      regularSessionDate: "2026-08-07",
      regularSession: "rth",
      regularPrice: tick?.close ?? 100,
      regularChg: (((tick?.close ?? 100) - 98) / 98) * 100,
      ...(tick ? {
        tickOpen: tick.open,
        tickHigh: tick.high,
        tickLow: tick.low,
        tickClose: tick.close,
        tickVol: tick.vol,
        tickStartMs: trueMs(9, 30, tick.second),
        tickEndMs: trueMs(9, 30, tick.second) + 999,
      } : {}),
    } : null]));
    await route.fulfill({ json: { quotes } });
  });

  await seedLiveCandleWorkspace(page);
  await page.goto("/terminal?symbol=NVDA");
  // The shell first paints its SSR-safe 3D default, then hydrates the saved 1s preference. The
  // global visual-ready event can therefore describe that INITIAL daily paint while a saturated
  // CI page is still waiting to start the real 1s request. Do not release the synthetic quote
  // packets until the intercepted intraday payload itself has crossed the route boundary.
  await expect.poll(() => intradayFixtureServed, {
    message: "the 1s REST fixture should reach the chart before quote packets start",
    timeout: 45_000,
  }).toBe(true);

  const chart = page.locator(".chart-wrap").first();
  await expect(chart.locator("canvas").first()).toBeVisible();
  for (let index = 0; index < ticks.length; index++) {
    liveTickIndex = index;
    // Each packet is picked up by the NEXT /api/quote poll, so this waits on a polling interval,
    // not on render work. 15s left barely two polls of headroom and this went red on three
    // unrelated PRs in one afternoon — including one whose entire diff was a CI YAML comment.
    // Give it enough slack that a single skipped poll on a loaded runner is not a failure.
    await expect.poll(async () => Number(await chart.getAttribute("data-live-revision") || 0), {
      message: `A.* packet ${index + 1} should repaint the developing candle`,
      timeout: 45_000,
    }).toBeGreaterThanOrEqual(index + 1);
    await expect(chart).toHaveAttribute("data-live-close", String(ticks[index].close));
  }

  await expect(chart).toHaveAttribute("data-live-kind", "new-bar");
  await expect(chart).toHaveAttribute("data-live-direction", "up");
  await expect(chart).toHaveAttribute("data-live-open", "99.7");
  await expect(chart).toHaveAttribute("data-live-high", "100.3");
  await expect(chart).toHaveAttribute("data-live-low", "99.6");
  await expect(chart).toHaveAttribute("data-live-close", "100.25");
  await expect(chart).toHaveAttribute("data-live-time", String(display(9, 30, 3)));

  const motion = await chart.evaluate((el) => ({
    pulse: el.getAttribute("data-live-pulse"),
    animation: getComputedStyle(el, "::after").animationName,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(["a", "b"]).toContain(motion.pulse);
  expect(motion.animation).toMatch(/^mmLiveCandle[AB]$/);
  expect(motion.overflow).toBeLessThanOrEqual(1);

  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-live-candle.png`),
    fullPage: false,
  });
});
