import { expect, test, type Page } from "@playwright/test";
import {
  DEFAULT_CHART_RIGHT_OFFSET,
  DEFAULT_CHART_VIEW_BARS,
} from "@/lib/chart-engine/viewReset";

type ChartViewState = {
  rowCount: number;
  timeframe: string;
  visibleRange: { from: number; to: number } | null;
  priceVisibleRange: { from: number; to: number } | null;
  priceAutoScale: boolean | null;
  lastBarX: number | null;
  priceTagLeft: number | null;
};

async function chartViewState(page: Page): Promise<ChartViewState | null> {
  return page.evaluate(() => (window as Window & {
    __mmChartAxisOpts?: () => ChartViewState | null;
  }).__mmChartAxisOpts?.() ?? null);
}

async function priceRangeSpan(page: Page): Promise<number | null> {
  const range = (await chartViewState(page))?.priceVisibleRange;
  return range && Number.isFinite(range.from) && Number.isFinite(range.to) && range.to > range.from
    ? range.to - range.from
    : null;
}

async function expectNormalizedView(page: Page) {
  await expect.poll(async () => {
    const state = await chartViewState(page);
    if (!state?.visibleRange || state.rowCount <= DEFAULT_CHART_VIEW_BARS) return null;
    return {
      autoScale: state.priceAutoScale,
      from: Math.round(state.visibleRange.from),
      to: Math.round(state.visibleRange.to),
    };
  }, { timeout: 15_000 }).toEqual({
    autoScale: true,
    from: (await chartViewState(page))!.rowCount - DEFAULT_CHART_VIEW_BARS,
    to: (await chartViewState(page))!.rowCount - 1 + DEFAULT_CHART_RIGHT_OFFSET,
  });
}

test("New chart tickers reserve space between the latest candle and symbol tag", async ({ page }) => {
  await page.goto("/terminal?symbol=AAPL");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 45_000 });

  await expect.poll(async () => {
    const state = await chartViewState(page);
    if (state?.lastBarX == null || state.priceTagLeft == null) return null;
    return Math.round(state.priceTagLeft - state.lastBarX);
  }, { timeout: 45_000 }).toBeGreaterThanOrEqual(12);
});

test("Reset chart view restores the recent weekly window", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The context-menu reset gesture is desktop-only.");

  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 45_000 });
  await expect.poll(async () => (await chartViewState(page))?.rowCount ?? 0, { timeout: 45_000 })
    .toBeGreaterThan(DEFAULT_CHART_VIEW_BARS);

  // Match the reported long-history weekly failure, where fitContent used to
  // crush every available candle into the width of the chart.
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("mm:set-tf", { detail: { tf: "W" } }));
  });
  await expect.poll(async () => {
    const state = await chartViewState(page);
    return state?.timeframe === "W" ? state.rowCount : 0;
  }, { timeout: 45_000 }).toBeGreaterThan(DEFAULT_CHART_VIEW_BARS);

  const chart = page.locator(".chart-wrap").first();
  const box = await chart.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width * 0.6, box!.y + box!.height * 0.45, { button: "right" });
  const reset = page.locator('.ctx-menu [data-a="reset"]');
  await expect(reset).toBeVisible();
  await reset.click();
  await expectNormalizedView(page);

  // The advertised keyboard equivalent must share the same normalization path.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expectNormalizedView(page);
});

test("Vertical cursor lock has a clear X and never follows a ticker change", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The chart context menu is a desktop pointer workflow.");

  await page.goto("/terminal?symbol=AAPL");
  const chart = page.locator(".chart-wrap").first();
  await expect(chart.locator("canvas").first()).toBeVisible({ timeout: 45_000 });

  const openContext = async (xFraction: number) => {
    const box = await chart.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(
      box!.x + box!.width * xFraction,
      box!.y + box!.height * 0.45,
      { button: "right" },
    );
    await expect(page.locator(".ctx-menu")).toBeVisible();
  };

  const lock = page.locator('.ctx-menu [data-a="lockv"]');
  const unlock = page.locator('.ctx-menu [data-a="unlockv"]');

  await openContext(0.45);
  await expect(unlock).toHaveCount(0);
  await lock.click();

  // Once locked, the same menu exposes an explicit X rather than forcing another lock placement.
  await openContext(0.70);
  await expect(lock).toHaveClass(/ctx-checked/);
  await expect(unlock).toBeVisible();
  await unlock.click();

  await openContext(0.60);
  await expect(unlock).toHaveCount(0);
  await expect(lock).not.toHaveClass(/ctx-checked/);

  // The checked row itself is also a toggle-off. Re-lock, then change the ticker in place.
  await lock.click();
  await page.locator(".pair").first().click();
  const search = page.locator(".sh input");
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill("MSFT");
  await expect(page.locator('.sres [role="option"]').first()).toBeVisible({ timeout: 20_000 });
  await search.press("Enter");
  await expect(page.locator(".pair b").first()).toHaveText("MSFT", { timeout: 20_000 });

  // A vertical cursor lock belongs to the chart/ticker that created it. It must not ride to MSFT.
  await openContext(0.55);
  await expect(unlock).toHaveCount(0);
  await expect(lock).not.toHaveClass(/ctx-checked/);
});

test("Price-axis wheel zoom keeps compounding instead of hitting a fixed clamp", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Wheel-on-axis is a desktop/trackpad gesture.");

  await page.goto("/terminal?symbol=NVDA");
  const chart = page.locator(".chart-wrap").first();
  await expect(chart.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => priceRangeSpan(page), { timeout: 45_000 }).toBeGreaterThan(0);

  const before = await chartViewState(page);
  const box = await chart.boundingBox();
  expect(box).not.toBeNull();
  // Stay inside the price pane vertically and inside the visible right-axis gutter horizontally.
  await page.mouse.move(box!.x + box!.width - 6, box!.y + box!.height * 0.35);

  let prior = (await priceRangeSpan(page))!;
  for (let i = 0; i < 4; i += 1) {
    await page.mouse.wheel(0, -600);
    await expect.poll(() => priceRangeSpan(page)).toBeLessThan(prior * 0.85);
    const current = (await priceRangeSpan(page))!;
    expect(current).toBeLessThan(prior);
    prior = current;
  }

  const zoomedIn = await chartViewState(page);
  expect(zoomedIn?.priceAutoScale).toBe(false);
  // Claiming the axis gesture in capture phase must leave horizontal/time zoom untouched. The
  // live-follow path may translate the window while the assertion runs, so compare its width.
  const timeSpanBefore = before!.visibleRange!.to - before!.visibleRange!.from;
  const timeSpanAfter = zoomedIn!.visibleRange!.to - zoomedIn!.visibleRange!.from;
  // Price-label digit widths can resize the gutter by a few pixels, which is under one logical bar.
  expect(Math.abs(timeSpanAfter - timeSpanBefore)).toBeLessThan(1);

  // Equal-size outward frames must continue expanding after the old margin accumulator would
  // already have saturated. Every frame is checked, not just the final one.
  for (let i = 0; i < 8; i += 1) {
    await page.mouse.wheel(0, 600);
    await expect.poll(() => priceRangeSpan(page)).toBeGreaterThan(prior * 1.15);
    const current = (await priceRangeSpan(page))!;
    expect(current).toBeGreaterThan(prior);
    prior = current;
  }

  // The standard axis reset remains the escape hatch back to live autoscale.
  await page.mouse.dblclick(box!.x + box!.width - 6, box!.y + box!.height * 0.35);
  await expect.poll(async () => (await chartViewState(page))?.priceAutoScale).toBe(true);
});

test("Logarithmic price-axis wheel zoom compounds without corrupting the scale", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Wheel-on-axis is a desktop/trackpad gesture.");

  await page.goto("/terminal?symbol=NVDA");
  const chart = page.locator(".chart-wrap").first();
  await expect(chart.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => priceRangeSpan(page), { timeout: 45_000 }).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Quick settings" }).click();
  await page.getByText("Logarithmic", { exact: true }).click();
  await page.keyboard.press("Escape");

  const box = await chart.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width - 6, box!.y + box!.height * 0.35);

  let prior = (await priceRangeSpan(page))!;
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.wheel(0, -600);
    await expect.poll(() => priceRangeSpan(page)).toBeLessThan(prior * 0.9);
    const current = (await priceRangeSpan(page))!;
    expect(Number.isFinite(current)).toBe(true);
    prior = current;
  }

  await page.mouse.dblclick(box!.x + box!.width - 6, box!.y + box!.height * 0.35);
  await expect.poll(async () => (await chartViewState(page))?.priceAutoScale).toBe(true);
  await expect.poll(() => priceRangeSpan(page)).toBeGreaterThan(prior * 2);
});
