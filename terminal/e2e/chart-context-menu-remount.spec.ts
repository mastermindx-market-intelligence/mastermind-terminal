import { expect, test, type Page } from "@playwright/test";
import { isPhoneViewport } from "./phoneChrome";

// ── The chart context menu survives a ChartPanel remount ─────────────────────────────────────
// "Table view" swaps the whole chart body for the Data Inspector, and "Back to chart" mounts a
// brand-new ChartPanel in a later commit. React's StrictMode (the dev server this suite runs on)
// simulates an unmount for exactly that kind of mount, and it detaches host refs BEFORE it runs
// the passive cleanup. A cleanup that finds its listener target through `ref.current` therefore
// finds nothing, leaves the first engine's contextmenu handler on the reused `.chart-wrap`, and
// every later right-click calls into the destroyed engine: an uncaught "chart-engine: disposed"
// that CI logged ~10 times a run while the live handler still opened the menu (green tests).
// The falsifier: put the cleanup back on `ref.current?.parentElement` and both assertions fail
// (two contextmenu listeners; one pageerror per right-click).

async function waitForChart(page: Page) {
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __mmChartReady?: boolean }).__mmChartReady)), { timeout: 20_000 }).toBe(true);
}

/** The listener types on the chart wrapper, counted by the browser itself (not by app code). */
async function wrapListenerTypes(page: Page): Promise<Record<string, number>> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { result } = await cdp.send("Runtime.evaluate", { expression: "document.querySelector('.chart-wrap')" });
    expect(result.objectId, ".chart-wrap must exist").toBeTruthy();
    const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId! });
    const counts: Record<string, number> = {};
    for (const l of listeners) counts[l.type] = (counts[l.type] ?? 0) + 1;
    return counts;
  } finally {
    await cdp.detach();
  }
}

async function rightClickChart(page: Page) {
  const chart = page.locator(".chart-wrap").first();
  const bounds = await chart.boundingBox();
  expect(bounds).not.toBeNull();
  await chart.click({ button: "right", position: { x: Math.min(100, bounds!.width * 0.25), y: Math.min(160, bounds!.height * 0.3) } });
  await expect(page.locator(".ctx-menu")).toBeVisible();
}

/** The phone opens the inspector from the Analysis hub; wider layouts from the chart's menu. */
async function openTableView(page: Page) {
  if (isPhoneViewport(page)) {
    await page.getByTestId("roller-more").click();
    const hub = page.getByRole("dialog", { name: /Analysis hub|分析中心/ });
    await expect(hub).toBeVisible();
    await hub.getByTestId("hub-tile-dataTable").click();
  } else {
    await rightClickChart(page);
    await page.locator('.ctx-menu [data-a="tableview"]').click();
  }
  const inspector = page.locator("[data-data-inspector]");
  await expect(inspector).toBeVisible({ timeout: 20_000 });
  return inspector;
}

test("a chart remounted from the table view leaves no handler bound to the disposed engine", async ({ page }) => {
  const disposed: string[] = [];
  page.on("pageerror", (e) => { if (e.message.includes("chart-engine: disposed")) disposed.push(e.stack ?? e.message); });
  await page.addInitScript(() => {
    (window as Window & { __mmChartReady?: boolean }).__mmChartReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => {
      (window as Window & { __mmChartReady?: boolean }).__mmChartReady = true;
    });
  });
  await page.goto("/terminal?symbol=NVDA");
  await waitForChart(page);
  const mounted = await wrapListenerTypes(page);
  expect(mounted.contextmenu, "one context-menu handler on a freshly loaded chart").toBe(1);

  const inspector = await openTableView(page);
  await page.evaluate(() => { (window as Window & { __mmChartReady?: boolean }).__mmChartReady = false; });
  await inspector.getByRole("button", { name: "Back to chart" }).click();
  await expect(inspector).toHaveCount(0);
  await waitForChart(page);

  // The remounted wrapper carries exactly the handlers a fresh page load does — nothing the first
  // (now destroyed) engine registered is still attached. Soft, so a leak also reports what the
  // stale handler does on the right-clicks below.
  expect.soft(await wrapListenerTypes(page)).toEqual(mounted);
  await rightClickChart(page);
  await page.keyboard.press("Escape");
  await rightClickChart(page);
  expect(disposed).toEqual([]);
});
