import { expect, test, type Page } from "@playwright/test";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function seedFastChart(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("mm.startTf", JSON.stringify("1s"));
    localStorage.setItem("mm.inds", JSON.stringify([]));
    localStorage.removeItem("mm.ws");
  });
}

function realtimeQuote(sym: string) {
  return {
    sym,
    last: 100,
    prevClose: 99,
    chg: 1.01,
    open: 99.5,
    high: 100.2,
    low: 99.2,
    vol: 100_000,
    ts: 1_786_000_000,
    asOfMs: 1_786_000_000_000,
    lagMs: 35,
    live: true,
    basis: "REALTIME",
    market: "us",
    marketSession: "rth",
    regularSessionDate: "2026-08-07",
    regularSession: "rth",
    regularPrice: 100,
    regularChg: 1.01,
  };
}

test("visible-chart quote polling stays single-flight when the fast endpoint is slower than its cadence", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "scheduler behavior is viewport-independent");
  test.slow();

  let chartInFlight = 0;
  let chartMaxInFlight = 0;
  let chartCompleted = 0;

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
        source: "single-flight-e2e",
        session_date: "2026-08-07",
        bars: [[1_786_000_000, 99.5, 100.2, 99.2, 100, 100_000]],
      },
    });
  });

  await page.route("**/api/quote?**", async (route) => {
    const url = new URL(route.request().url());
    const syms = (url.searchParams.get("syms") || "NVDA").split(",").filter(Boolean);
    const fast = url.searchParams.get("cadence") === "chart";
    if (fast) {
      chartInFlight += 1;
      chartMaxInFlight = Math.max(chartMaxInFlight, chartInFlight);
      await sleep(1_400);
      chartInFlight -= 1;
      chartCompleted += 1;
    }
    await route.fulfill({
      json: { quotes: Object.fromEntries(syms.map((sym) => [sym, realtimeQuote(sym)])) },
    });
  });

  await seedFastChart(page);
  await page.goto("/terminal?symbol=NVDA");

  await expect.poll(() => chartCompleted, {
    message: "the visible-chart lane should complete multiple slow polls",
    timeout: 15_000,
  }).toBeGreaterThanOrEqual(3);

  expect(
    chartMaxInFlight,
    "a one-second cadence must never stack a second chart-quote request over a still-running one",
  ).toBe(1);
});
