import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { toggleToolbarReplay } from "./terminalToolbar";
import { useLang } from "./layoutStore";
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

test("saved startup timeframe hydrates chart context without stale SSR attributes", async ({ page }) => {
  const hydration: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("data-context-timeframe") || (text.includes("hydrated") && text.includes("VisualIntelligencePanel"))) hydration.push(text);
  });
  await page.addInitScript(() => {
    localStorage.setItem("mm.startTf", JSON.stringify("1s"));
    localStorage.removeItem("mm.ws");
  });
  await page.goto("/terminal?symbol=NVDA");
  const context = page.locator("[data-visual-context]");
  await expect(context).toHaveAttribute("data-context-timeframe", "1s", { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => (window as any).__mmChartAxisOpts?.()?.timeframe), { timeout: 20_000 }).toBe("1s");
  expect(hydration, "chart context must not hydrate against a different startup timeframe").toEqual([]);
});

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


async function openChartMenu(page: Page, action: "settings" | "tableview") {
  const chart = page.locator(".chart-wrap").first();
  const bounds = await chart.boundingBox();
  expect(bounds).not.toBeNull();
  await chart.click({ button: "right", position: { x: Math.min(100, bounds!.width * .25), y: Math.min(180, bounds!.height * .4) } });
  await page.locator(`.ctx-menu [data-a="${action}"]`).click();
}

test("context can be restored through the existing chart settings without a new preference owner", async ({ page }) => {
  const panel = await openContext(page);
  await panel.getByRole("button", { name: "Hide chart context", exact: true }).click();
  await expect(page.locator("[data-visual-context]")).toHaveCount(0);
  await openChartMenu(page, "settings");
  const settings = page.getByRole("dialog", { name: "Chart Settings", exact: true });
  await settings.getByRole("button", { name: "Canvas", exact: true }).click();
  await settings.getByRole("checkbox", { name: "Show chart context", exact: true }).check();
  await settings.locator(".sm-ok").click();
  await expect(page.getByRole("button", { name: "Chart context", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Chart context", exact: true })).toBeVisible();
});

test("table and CSV expose the same actual 3D bars and numeric context as the plotted chart", async ({ page }) => {
  const panel = await openContext(page);
  const proof = await page.evaluate(() => (window as any).__mmChartAxisOpts?.());
  const last = proof.contextProof.facts.at(-1);
  await panel.getByRole("button", { name: "Close chart context", exact: true }).click();
  await openChartMenu(page, "tableview");
  const table = page.locator(".ctv-root");
  await expect(table).toBeVisible();
  await expect(table.locator(".ctv-th").filter({ hasText: "Mastermind RSI (14)" })).toBeVisible();
  const pending = page.waitForEvent("download");
  await table.getByRole("button", { name: "Download data", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("NVDA_3D.csv");
  const path = await download.path();
  expect(path).not.toBeNull();
  const [header, ...rows] = readFileSync(path!, "utf8").trim().split("\n").map((line) => line.split(","));
  expect(rows.length).toBe(proof.rowCount);
  expect(rows[0][0]).toBe(String(last.time));
  expect(Number(rows[0][header.indexOf("Mastermind RSI (14)")])).toBeCloseTo(last.rsi14, 3);
  expect(Number(rows[0][header.indexOf("Prior 20-bar high")])).toBeCloseTo(last.priorHigh20, 3);
  expect(rows.at(-1)![header.indexOf("Mastermind RSI (14)")]).toBe("");
});

test("replay consumer excludes current-calendar events and future numeric rows across viewport sizes", async ({ page }) => {
  test.slow();
  const originalSize = page.viewportSize()!;
  // Replay has an existing desktop toolbar entry. Exercise that real entry, then its responsive
  // consumer; this is not a claim that the phone's older hub exposes a new replay launcher.
  if (originalSize.width <= 640) await page.setViewportSize({ width: 1440, height: 900 });
  const panel = await openContext(page);
  const before = await page.evaluate(() => (window as any).__mmChartAxisOpts?.());
  await panel.getByRole("button", { name: "Close chart context", exact: true }).click();
  await toggleToolbarReplay(page);
  if (originalSize.width <= 640) await page.setViewportSize(originalSize);
  await page.getByRole("button", { name: "Chart context", exact: true }).click();
  const replayPanel = page.getByRole("region", { name: "Chart context", exact: true });
  await expect(replayPanel.getByText("Replay boundary", { exact: true })).toBeVisible();
  await expect(replayPanel.locator("[data-context-calendar]")).toHaveAttribute("data-context-calendar", "withheld");
  await expect.poll(() => page.evaluate(() => (window as any).__mmChartAxisOpts?.()?.rowCount)).toBeLessThan(before.rowCount);
  const after = await page.evaluate(() => (window as any).__mmChartAxisOpts?.());
  expect(after.contextProof.facts.at(-1).time).not.toBe(before.contextProof.facts.at(-1).time);
  expect(after.contextProof.priceRows.at(-1).time).toBe(after.contextProof.facts.at(-1).time);
  await replayPanel.getByRole("switch", { name: "Event marks", exact: true }).click();
  await expect(page.locator('[data-visual-intelligence-overlay] [data-ic-tip^="visual:event:"]')).toHaveCount(0);
});

test("an unavailable calendar and a delayed outgoing symbol never become fabricated event context", async ({ page }) => {
  test.slow();
  let releaseOld: () => void = () => {};
  const oldResponse = new Promise<void>((resolve) => { releaseOld = resolve; });
  await page.route("**/NVDA.fund.json**", async (route) => {
    await oldResponse;
    try { await route.fulfill({ json: { ticker: "NVDA", asof: "2026-06-27", earnings: { next_date: "2099-12-31", q: [] } } }); } catch { /* outgoing request may be aborted */ }
  });
  await page.route("**/AAPL.fund.json**", (route) => route.fulfill({ status: 503, body: "unavailable" }));
  try {
    const panel = await openContext(page);
    await expect(panel.locator("[data-context-calendar]")).toHaveAttribute("data-context-calendar", "loading");
    await panel.getByRole("button", { name: "Close chart context", exact: true }).click();
    // Use Terminal's canonical symbol picker instead of the desktop-only visible watchlist rail.
    // This is the same user journey on desktop, tablet, and phone and preserves the transition we
    // are proving: the old symbol's calendar must disappear while the new symbol is still loading.
    await page.keyboard.press("Control+K");
    const symbolSearch = page.getByRole("combobox");
    await expect(symbolSearch).toBeVisible();
    await symbolSearch.fill("AAPL");
    await expect(page.getByRole("option").filter({ hasText: "AAPL" }).first()).toBeVisible();
    await symbolSearch.press("Enter");
    await expect(page.locator("[data-visual-context]")).toHaveAttribute("data-context-symbol", "AAPL");
    await page.getByRole("button", { name: "Chart context", exact: true }).click();
    const nextPanel = page.getByRole("region", { name: "Chart context", exact: true });
    await expect(nextPanel.locator("[data-context-rsi]")).toHaveText(/\d/, { timeout: 15000 });
    releaseOld();
    await expect(nextPanel.locator("[data-context-calendar]")).toHaveAttribute("data-context-calendar", "unavailable", { timeout: 15000 });
    await expect(nextPanel).not.toContainText("2099-12-31");
    await expect(nextPanel).not.toContainText("NVDA");
  } finally { releaseOld(); }
});

test("Chinese context uses text alongside regional colors and remains keyboard dismissible", async ({ page }, testInfo) => {
  await useLang(page, "zh");
  await page.goto("/terminal?symbol=NVDA");
  const trigger = page.getByRole("button", { name: "图表解读", exact: true });
  await trigger.click();
  const panel = page.getByRole("region", { name: "图表解读", exact: true });
  await expect(panel.locator("[data-context-rsi]")).toHaveText(/\d/, { timeout: 20000 });
  await expect(panel.locator("[data-context-synthesis]")).toContainText(/[\u4e00-\u9fff]/);
  await expect(panel).not.toContainText("Optional chart layers");
  await panel.getByRole("button", { name: "上一根K线", exact: true }).click();
  await expect(panel.locator("[data-context-calendar]")).toHaveAttribute("data-context-calendar", "withheld");
  await panel.evaluate((element) => { element.scrollTop = 0; });
  mkdirSync("docs/pr-crops/terminal-visual-intelligence", { recursive: true });
  await page.screenshot({ path: `docs/pr-crops/terminal-visual-intelligence/${testInfo.project.name}-context-zh.png` });
  await panel.getByRole("button", { name: "关闭图表解读", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
