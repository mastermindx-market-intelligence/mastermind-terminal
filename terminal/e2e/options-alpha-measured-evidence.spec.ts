import { expect, test } from "@playwright/test";

const measuredFeed = {
  schema: "live_flow.feed/v1",
  asof: "2026-09-19T14:00:05Z",
  source_asof: "2026-09-19T14:00:04Z",
  session_date: "2026-09-19",
  events: [
    {
      id: "lf_evt_nvda",
      root: "NVDA",
      right: "C",
      exp: "2026-09-25",
      strike: 200,
      observed_at: "2026-09-19T14:00:00Z",
      decision_at: "2026-09-19T14:00:01Z",
      available_at: "2026-09-19T14:00:02Z",
      vol_gt_oi_ratio: 1.25,
      microstructure: {
        schema: "options.trade_nbbo_microstructure/v1",
        source_print_count: 4,
        nbbo_valid_print_count: 3,
        source_premium_usd: 1000,
        nbbo_covered_premium_usd: 900,
        nbbo_print_coverage: 0.75,
        nbbo_premium_coverage: 0.9,
        at_ask_share: 0.444444,
        at_bid_share: 0.222222,
        inside_share: 0.333334,
        outside_share: 0,
        aggression_share: 0.666666,
        aggression_balance: 0.222222,
        spread_median_usd: 0.2,
        spread_median_pct: 0.05,
        quote_age_median_ms: 100,
        quote_age_max_ms: 250,
        bid_size_median: 12,
        ask_size_median: 14,
      },
    },
  ],
  unusual_names: [],
};

test("Options Alpha shows measured NBBO evidence as context, not direction", async ({ page }) => {
  await page.route("**/api/flow?f=feed", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(measuredFeed) });
  });

  await page.goto("/options?tab=prophet");
  await page.getByRole("tab", { name: /Options Alpha/ }).click();

  const desk = page.getByTestId("options-alpha-desk");
  const section = page.getByTestId("options-alpha-measured-evidence");
  await expect(desk).toBeVisible({ timeout: 15_000 });
  await expect(section).toBeVisible();
  await expect(page.getByTestId("options-alpha-measured-event")).toHaveCount(1);

  await expect(section).toContainText("Measured flow evidence");
  await expect(section).toContainText("not buyer identity");
  await expect(section).toContainText("not ranked or scored");
  await expect(section).toContainText("NVDA");
  await expect(section).toContainText("NBBO premium coverage");
  await expect(section).toContainText("90.0%");
  await expect(section).toContainText("At ask");
  await expect(section).toContainText("44.4%");
  await expect(section).toContainText("Inside spread");
  await expect(section).toContainText("33.3%");
  await expect(section).toContainText("Volume / prior OI");
  await expect(section).toContainText("1.25×");
  await expect(section).toContainText("2026-09-19T14:00:04Z");

  for (const forbidden of ["Bullish probability", "Bearish probability", "Buy signal", "Institutional buyer"]) {
    await expect(section).not.toContainText(forbidden);
  }

  await page.evaluate(() => {
    document.documentElement.setAttribute("data-lang", "zh");
    window.dispatchEvent(new CustomEvent("mm:lang"));
  });
  await expect(section).toContainText("实测资金流证据");
  await expect(section).toContainText("不代表买方身份");
  await expect(section).toContainText("NBBO 权利金覆盖");
  await expect(section).toContainText("成交于卖价");
});

test("measured-flow failure degrades independently from the Options Alpha shadow view", async ({ page }) => {
  await page.route("**/api/flow?f=feed", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });

  await page.goto("/options?tab=prophet");
  await page.getByRole("tab", { name: /Options Alpha/ }).click();

  const desk = page.getByTestId("options-alpha-desk");
  const section = page.getByTestId("options-alpha-measured-evidence");
  await expect(desk).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("options-alpha-fires-section")).toBeVisible();
  await expect(section).toContainText("Measured-flow source is unavailable");
  await expect(section).toContainText("research shadow view remains independent");
});


test("producer-stale measured evidence is visibly last-source evidence", async ({ page }) => {
  await page.route("**/api/flow?f=feed", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...measuredFeed, stale: true }),
    });
  });
  await page.goto("/options?tab=prophet");
  await page.getByRole("tab", { name: /Options Alpha/ }).click();
  const section = page.getByTestId("options-alpha-measured-evidence");
  await expect(section).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("options-alpha-measured-event")).toHaveCount(1);
  await expect(page.getByTestId("options-alpha-measured-stale"))
    .toContainText("Producer marked this measured snapshot stale");
  await expect(section).toContainText("last-source evidence only");
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-lang", "zh");
    window.dispatchEvent(new CustomEvent("mm:lang"));
  });
  await expect(page.getByTestId("options-alpha-measured-stale")).toContainText("来源已将此实测快照标记为陈旧");
  await expect(section).not.toContainText("Producer marked");
});

test("refresh failure is labelled and a successful refresh restores measured evidence", async ({ page }) => {
  await page.addInitScript(() => {
    const originalSetInterval = window.setInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: any[]) =>
      originalSetInterval(handler, timeout === 30_000 ? 100 : timeout, ...args)) as typeof window.setInterval;
    const realNow = Date.now.bind(Date);
    let offset = 0;
    (window as unknown as { __oaAdvanceMeasuredClock?: () => void }).__oaAdvanceMeasuredClock = () => { offset += 26_000; };
    Date.now = () => realNow() + offset;
  });
  let fail = false;
  let recovered = false;
  await page.route("**/api/flow?f=feed", async (route) => {
    if (fail) {
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(recovered ? { ...measuredFeed, asof: "2026-09-19T14:01:05Z", source_asof: "2026-09-19T14:01:04Z", stale: false } : measuredFeed) });
    }
  });

  await page.goto("/options?tab=prophet");
  await page.getByRole("tab", { name: /Options Alpha/ }).click();
  const section = page.getByTestId("options-alpha-measured-evidence");
  await expect(page.getByTestId("options-alpha-measured-event")).toHaveCount(1);
  fail = true;
  await page.evaluate(() => {
    (window as unknown as { __oaAdvanceMeasuredClock?: () => void }).__oaAdvanceMeasuredClock?.();
  });
  await expect(page.getByTestId("options-alpha-measured-refresh-failed"))
    .toContainText("Refresh unavailable");
  await expect(page.getByTestId("options-alpha-measured-event")).toHaveCount(1);
  await expect(section).toContainText("2026-09-19T14:00:04Z");
  await expect(page.getByTestId("options-alpha-fires-section")).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-lang", "zh");
    window.dispatchEvent(new CustomEvent("mm:lang"));
  });
  await expect(page.getByTestId("options-alpha-measured-refresh-failed")).toContainText("刷新暂不可用");
  await expect(section).not.toContainText("Refresh unavailable");
  fail = false;
  recovered = true;
  await page.evaluate(() => {
    (window as unknown as { __oaAdvanceMeasuredClock?: () => void }).__oaAdvanceMeasuredClock?.();
  });
  await expect(page.getByTestId("options-alpha-measured-refresh-failed")).toHaveCount(0);
  await expect(page.getByTestId("options-alpha-measured-stale")).toHaveCount(0);
  await expect(section).toContainText("2026-09-19T14:01:04Z");
  await expect(page.getByTestId("options-alpha-measured-event")).toHaveCount(1);
  await expect(page.getByTestId("options-alpha-fires-section")).toBeVisible();
});
