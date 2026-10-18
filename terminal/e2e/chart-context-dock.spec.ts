import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

async function openContext(page: Page) {
  await page.goto("/terminal?symbol=NVDA");
  await page.getByRole("button", { name: "Chart context", exact: true }).click();
  const panel = page.getByRole("region", { name: "Chart context", exact: true });
  await expect(panel.locator("[data-context-rsi]")).toHaveText(/\d/, { timeout: 20000 });
  return panel;
}
async function assertClearChart(page: Page) {
  const geometry = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("[data-context-reader]")!.getBoundingClientRect();
    const charts = Array.from(document.querySelectorAll<HTMLElement>(".chart-wrap")).filter((el) => el.getClientRects().length).map((el) => el.getBoundingClientRect());
    return { count: charts.length, panelWidth: panel.width, withinPage: panel.left >= -1 && panel.right <= innerWidth + 1,
      overlaps: charts.map((chart) => Math.max(0, Math.min(panel.right, chart.right) - Math.max(panel.left, chart.left)) * Math.max(0, Math.min(panel.bottom, chart.bottom) - Math.max(panel.top, chart.top))) };
  });
  expect(geometry.count).toBeGreaterThan(0);
  expect(geometry.panelWidth).toBeGreaterThan(250);
  expect(geometry.withinPage).toBe(true);
  expect(geometry.overlaps.every((area) => area < 1)).toBe(true);
}

test("context stays outside every chart pane and presents the actual selected facts", async ({ page }, info) => {
  const panel = await openContext(page);
  await assertClearChart(page);
  await expect(panel.locator("details[open]")).toHaveCount(0);
  await expect(panel.getByRole("meter", { name: "RSI 14" })).toBeVisible();
  await panel.getByRole("button", { name: "Previous bar", exact: true }).click();
  const selectedTime = await panel.locator("[data-context-bar-time]").innerText();
  const fact = await page.evaluate(() => (window as any).__mmChartAxisOpts?.()?.contextProof?.facts?.at(-2));
  expect(selectedTime).toBe(String(fact.time));
  expect(Number((await panel.locator("[data-context-rsi]").innerText()).replaceAll(",", ""))).toBeCloseTo(fact.rsi14, 1);
  expect(Number((await panel.locator("[data-context-price-change]").innerText()).replace(/[%+,]/g, ""))).toBeCloseTo(fact.barChangePct, 1);
  const chart = page.locator(".chart-wrap").first();
  await chart.click({ position: { x: 90, y: 100 } });
  await expect(panel).toBeVisible();
  await assertClearChart(page);
  await panel.getByRole("button", { name: "Latest", exact: true }).click();
  await panel.evaluate((el) => { el.scrollTop = 0; });
  await page.evaluate(() => window.scrollTo(0, 0));
  mkdirSync("docs/pr-crops/chart-context-redesign", { recursive: true });
  await page.screenshot({ path: `docs/pr-crops/chart-context-redesign/${info.project.name}-placement.png`, fullPage: true });
});

test("context keeps keyboard shortcuts local and restores focus after closing", async ({ page }) => {
  const panel = await openContext(page);
  await page.evaluate(() => {
    (window as any).__contextKeyLeaks = [];
    window.addEventListener("keydown", (event) => { (window as any).__contextKeyLeaks.push(event.key); });
  });
  const before = await panel.locator("[data-context-bar-time]").innerText();
  await panel.getByRole("button", { name: "Previous bar", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Control+c");
  await expect(panel.locator("[data-context-bar-time]")).toHaveText(before);
  expect(await page.evaluate(() => (window as any).__contextKeyLeaks)).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(panel.locator("[data-context-bar-time]")).not.toHaveText(before);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Chart context", exact: true })).toBeFocused();
});

test("disabled context can be enabled from its new home without resetting chart preferences", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mm.chartSettings", JSON.stringify({ visualContext: false, visualLevels: true })));
  await page.goto("/terminal?symbol=NVDA");
  await page.getByRole("button", { name: "Chart context", exact: true }).click();
  const panel = page.getByRole("region", { name: "Chart context", exact: true });
  await expect(panel.getByText("Chart context is turned off")).toBeVisible();
  await panel.getByRole("button", { name: "Enable chart context", exact: true }).click();
  await expect(panel.locator("[data-context-rsi]")).toHaveText(/\d/, { timeout: 20000 });
  await panel.getByText("Chart layers", { exact: true }).click();
  await expect(panel.getByRole("switch", { name: "Prior-range levels", exact: true })).toHaveAttribute("aria-checked", "true");
});

test("context follows the active pane through resize and fullscreen without covering the chart", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "One desktop-to-mobile transition sequence; each native viewport has separate placement coverage.");
  test.slow();
  await page.addInitScript(() => localStorage.setItem("mm.ws", JSON.stringify({ panes: ["NVDA", "AAPL"], paneTfs: ["D", "W"], split: 2, activePane: 0, sync: false })));
  await page.goto("/terminal");
  await expect(page.locator(".pane-grid>.pane")).toHaveCount(2);
  await page.getByRole("button", { name: "Chart context", exact: true }).click();
  const panel = page.getByRole("region", { name: "Chart context", exact: true });
  await expect(panel).toHaveAttribute("data-context-symbol", "NVDA");
  await page.locator(".pane-grid>.pane").nth(1).locator(".pane-hd").click();
  await expect(panel).toHaveAttribute("data-context-symbol", "AAPL");
  await expect(panel).toHaveAttribute("data-context-timeframe", "W");
  await expect(panel.locator("[data-context-rsi]")).toHaveText(/\d/, { timeout: 20000 });
  await panel.getByRole("button", { name: "Previous bar", exact: true }).click();
  const selected = await panel.locator("[data-context-bar-time]").innerText();
  await assertClearChart(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-context-dock="inline"] [data-context-reader]')).toHaveCount(1);
  const visiblePane = page.locator(".pane-grid>.pane:visible");
  await expect(visiblePane).toHaveCount(1);
  await expect(visiblePane).toHaveClass(/on/);
  await expect(visiblePane.locator("[data-visual-context]")).toHaveAttribute("data-context-symbol", "AAPL");
  await expect(visiblePane.locator("[data-visual-context]")).toHaveAttribute("data-context-timeframe", "W");
  await expect(panel.locator("[data-context-bar-time]")).toHaveText(selected);
  await assertClearChart(page);
  await page.locator(".chart-fs-float").click();
  await expect(page.locator(".app")).toHaveClass(/fs/);
  await assertClearChart(page);
  await expect(panel.locator("[data-context-bar-time]")).toHaveText(selected);
  await page.locator(".chart-fs-float").click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('[data-context-dock="rail"] [data-context-reader]')).toHaveCount(1);
  await panel.getByRole("button", { name: "Close chart context", exact: true }).click();
  await expect(page.locator(".rail-body")).toBeVisible();
});
