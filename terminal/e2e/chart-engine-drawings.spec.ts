import { expect, test, type Page } from "@playwright/test";

const IMPL_QUERY = [
  { label: "lwc", query: "" },
  { label: "engine-mm-query", query: "&engine=mm" },
] as const;

type DrawWindow = Window & {
  __mmChartEngineImpl?: () => string | null;
};

async function mountedImpl(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const w = window as DrawWindow;
    const hook = w.__mmChartEngineImpl?.();
    if (hook != null) return hook;
    return document.querySelector("[data-chart-engine]")?.getAttribute("data-chart-engine") ?? null;
  });
}

async function bootChart(page: Page, query: string) {
  await page.route("**/api/drawings**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ drawings: [] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.goto(`/terminal?symbol=AAPL${query}`);
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => mountedImpl(page), { timeout: 30_000 }).not.toBeNull();
  test.info().annotations.push({ type: "mountedEngineImpl", description: String(await mountedImpl(page)) });
  await expect(page.locator(".pane.on .drawing-layer")).toBeVisible();
}

async function armTrendline(page: Page) {
  await page.getByTestId("drawing-tool-trendline").click();
  await expect(page.locator('[data-tool-id="trendline"]')).toHaveAttribute("aria-pressed", "true");
}

for (const impl of IMPL_QUERY) {
  test.describe(`chart-engine drawings [${impl.label}]`, () => {
    test("A01: trendline persists across engine query navigation", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Heavy drawing case is desktop-only.");
      await bootChart(page, impl.query);
      await armTrendline(page);
      const layer = page.locator(".pane.on .drawing-layer");
      const box = await layer.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.4);
      await page.mouse.down();
      await page.mouse.move(box!.x + box!.width * 0.7, box!.y + box!.height * 0.55);
      await page.mouse.up();
      const line = layer.locator('g[data-drawing-kind="trendline"]:not([data-id="_p"])');
      await expect(line).toHaveCount(1, { timeout: 15_000 });
      const id = await line.first().getAttribute("data-drawing-id");
      const altQuery = impl.query.includes("engine=mm") ? "" : "&engine=mm";
      await page.goto(`/terminal?symbol=AAPL${altQuery}`);
      await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });
      await expect(layer.locator(`g[data-drawing-id="${id}"]`)).toHaveCount(1, { timeout: 20_000 });
    });

    test("A04: NOSUCH.TEST keeps drawing tools disabled", async ({ page }) => {
      await bootChart(page, impl.query);
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:embedded-symbol", { detail: { symbol: "NOSUCH.TEST" } })));
      await expect.poll(async () => page.locator(".chart-empty").isVisible(), { timeout: 30_000 }).toBe(true);
      await expect(page.getByTestId("drawing-tool-trendline")).toBeDisabled();
    });
  });
}

test.describe("chart-engine drawings [mobile A03]", () => {
  test("A03: selection handle is hittable on coarse viewport", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "A03 runs in the mobile project.");
    await bootChart(page, "");
    await armTrendline(page);
    const layer = page.locator(".pane.on .drawing-layer");
    const box = await layer.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width * 0.35, box!.y + box!.height * 0.45);
    await page.mouse.click(box!.x + box!.width * 0.65, box!.y + box!.height * 0.5);
    const line = layer.locator('g[data-drawing-kind="trendline"]:not([data-id="_p"])').first();
    await expect(line).toBeVisible();
    await line.click({ position: { x: 8, y: 8 } });
    await expect(line.locator("[data-handle]").first()).toBeVisible();
  });
});
