import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { openIndicatorLibrary } from "./phoneChrome";

async function openContext(page: Page) {
  await page.goto("/terminal?symbol=NVDA");
  const trigger = page.getByRole("button", { name: "Chart context", exact: true });
  await expect(trigger).toBeVisible({ timeout: 20000 });
  await trigger.click();
  const panel = page.getByRole("region", { name: "Chart context", exact: true });
  await expect(panel.locator("[data-context-rsi]")).toHaveText(/\d/, { timeout: 20000 });
  return panel;
}

test("default context explains plotted bars, toggles original overlays, and persists choices", async ({ page }, testInfo) => {
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // An identified current-artifact calendar fixture: no event text or timestamps are invented by the UI.
  await page.route("**/NVDA.fund.json**", async (route) => {
    await route.fulfill({ json: { schema: "fund.v1", ticker: "NVDA", asof: "2026-06-27",
      src: { statements: "fixture", estimates: "fixture", dividends: "fixture" },
      earnings: { next_date: null, q: [{ period: "2026Q1", report_date: "2026-06-18", eps_a: 1, eps_e: 1, rev_a: 1, rev_e: 1 }] },
      dividends: { events: [], splits: [] } } });
  });
  const panel = await openContext(page);
  const firstTime = await panel.locator("[data-context-bar-time]").innerText();
  await expect(panel.locator("[data-context-synthesis]")).not.toBeEmpty();
  await expect(panel.getByText("Latest plotted bar", { exact: true })).toBeVisible();
  await expect(panel.getByText("State coloring is off", { exact: true })).toHaveCount(0);
  const state = page.locator("[data-visual-context]");
  await expect(state).toHaveAttribute("data-context-timeframe", "3D");
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  await panel.getByRole("button", { name: "Previous bar", exact: true }).click();
  await expect(panel.getByText("Selected historical bar", { exact: true })).toBeVisible();
  await expect(panel.locator("[data-context-bar-time]")).not.toHaveText(firstTime);
  await expect(panel.locator("[data-context-calendar]")).toHaveAttribute("data-context-calendar", "withheld");
  await panel.getByRole("button", { name: "Latest", exact: true }).click();
  await expect(panel.locator("[data-context-bar-time]")).toHaveText(firstTime);

  for (const name of ["Recent trend tint", "Volume intensity", "Prior-range levels", "Event marks"]) {
    const control = panel.getByRole("switch", { name, exact: true });
    await expect(control).toHaveAttribute("aria-checked", "false");
    await control.click();
    await expect(control).toHaveAttribute("aria-checked", "true");
  }
  // Price reference levels are real draw-list consumers, not just switches or descriptions.
  const overlay = page.locator("[data-visual-intelligence-overlay]");
  await expect(overlay.locator('[data-ic-tip="visual:range:high"]')).toHaveCount(1);
  await expect(overlay.locator('[data-ic-tip="visual:range:low"]')).toHaveCount(1);
  expect(await overlay.locator("*").count()).toBeLessThan(500);
  await expect(overlay.locator('[data-ic-tip^="visual:event:"]').first()).toBeAttached();
  await expect(panel.locator("[data-context-calendar]")).toHaveAttribute("data-context-calendar", "available");
  // The expanded panel fits the chart instead of extending below the phone viewport.
  await panel.evaluate((el) => { el.scrollTop = 0; });
  mkdirSync("docs/pr-crops/terminal-visual-intelligence", { recursive: true });
  await page.screenshot({ path: `docs/pr-crops/terminal-visual-intelligence/${testInfo.project.name}-context.png` });
  await page.reload();
  await page.getByRole("button", { name: "Chart context", exact: true }).click();
  const restored = page.getByRole("region", { name: "Chart context", exact: true });
  await expect(restored.locator("[data-context-rsi]")).toHaveText(/\d/);
  await expect(restored.getByRole("switch", { name: "Prior-range levels", exact: true })).toHaveAttribute("aria-checked", "true");
  await restored.getByRole("button", { name: "Hide chart context", exact: true }).click();
  await expect(page.locator("[data-visual-context]")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  await expect(page.locator("[data-visual-context]")).toHaveCount(0);
  expect(errors.filter((error) => !error.includes("Stripe"))).toEqual([]);
});

test("classic candles retain descriptive context without pretending to paint them", async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("vi-classic-seeded")) return;
    localStorage.setItem("mm.mastermindCandles.v1", "1");
    localStorage.setItem("mm.inds", JSON.stringify(["ema", "vol"]));
    sessionStorage.setItem("vi-classic-seeded", "1");
  });
  const panel = await openContext(page);
  await expect(panel.getByText("State coloring is off", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Close chart context", exact: true }).click();
  await openIndicatorLibrary(page);
  const library = page.locator(".imodal-library");
  await library.getByRole("searchbox").fill("Mastermind Candles");
  const candles = library.getByRole("switch", { name: "Mastermind Candles", exact: true });
  await expect(candles).toHaveAttribute("aria-checked", "false");
  await candles.click();
  await expect(candles).toHaveAttribute("aria-checked", "true");
  await library.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Chart context", exact: true }).click();
  await expect(page.getByText("State coloring is off", { exact: true })).toHaveCount(0);
});

test("historical crosshair inspection stays on the selected bar without relabeling current calendar knowledge", async ({ page }) => {
  const panel = await openContext(page);
  const initial = await panel.locator("[data-context-bar-time]").innerText();
  const canvas = await page.locator(".chart-wrap canvas").first().boundingBox();
  expect(canvas).not.toBeNull();
  if (page.viewportSize()!.width <= 640) {
    // A phone's open disclosure covers the price pane. The explicit bar controls are its
    // touch-accessible historical inspection path, not a fake mouse hover through an overlay.
    await panel.getByRole("button", { name: "Previous bar", exact: true }).click();
  } else {
    await page.mouse.move(canvas!.x + canvas!.width * .25, canvas!.y + canvas!.height * .6);
    // Pointer-leave does not destroy the selected read while the user moves into the panel.
    await panel.getByRole("heading", { name: "Chart context", exact: true }).hover();
  }
  await expect(panel.locator("[data-context-bar-time]")).not.toHaveText(initial);
  await expect(panel.locator("[data-context-calendar]")).toHaveAttribute("data-context-calendar", "withheld");
});


test("real candle colors stay attached to price after chart-layer settings overwrite base series data", async ({ page }) => {
  const panel = await openContext(page);
  const readPaint = () => page.evaluate(() => {
    const proof = (window as any).__mmChartAxisOpts?.()?.contextProof;
    if (!proof?.facts?.length || !proof?.priceRows?.length) return { valid: false, mismatches: -1, changedHues: 0 };
    const facts = new Map(proof.facts.map((fact: any) => [String(fact.time), fact]));
    let mismatches = 0, changedHues = 0;
    for (const row of proof.priceRows) {
      const fact = facts.get(String(row.time)) as any;
      if (!fact) continue;
      const state = fact.state;
      const expected = proof.colors[state === "up" ? "up" : state === "down" ? "down" : state === "weakening" ? "warn" : "muted"];
      if (row.color !== expected || row.wickColor !== expected || row.borderColor !== expected) mismatches++;
      if (row.color === proof.colors.warn || row.color === proof.colors.muted) changedHues++;
    }
    return { valid: true, mismatches, changedHues };
  });
  await expect.poll(readPaint, { timeout: 15000 }).toMatchObject({ valid: true, mismatches: 0 });
  expect((await readPaint()).changedHues).toBeGreaterThan(0);
  await panel.getByRole("switch", { name: "Recent trend tint", exact: true }).click();
  await expect.poll(readPaint).toMatchObject({ valid: true, mismatches: 0 });
  await panel.getByRole("switch", { name: "Volume intensity", exact: true }).click();
  await expect.poll(readPaint).toMatchObject({ valid: true, mismatches: 0 });
});
