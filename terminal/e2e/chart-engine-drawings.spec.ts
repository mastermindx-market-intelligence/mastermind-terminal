import { expect, test, type Page } from "@playwright/test";

const IMPL_QUERY = [
  { label: "lwc", query: "" },
  { label: "engine-mm-query", query: "&engine=mm" },
] as const;

const SEED_TRENDLINE = {
  id: "e2e-engine-trend",
  kind: "trendline",
  points: [{ t: "2024-06-03", p: 180 }, { t: "2024-06-10", p: 195 }],
  schemaVersion: 1,
  source: "user",
  locked: false,
  hidden: false,
  z: 0,
  color: "var(--brand-2)",
  width: 2,
  dash: "solid",
  opacity: 1,
  extend: "none",
};

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

async function bootChart(page: Page, query: string, drawings: unknown[] = []) {
  const store = { drawings: [...drawings] };
  await page.route("**/api/drawings**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ drawings: store.drawings }),
      });
      return;
    }
    try {
      const body = route.request().postDataJSON() as { drawings?: unknown[] };
      if (Array.isArray(body?.drawings)) store.drawings = body.drawings;
    } catch {}
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.goto(`/terminal?symbol=AAPL${query}`);
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => mountedImpl(page), { timeout: 30_000 }).not.toBeNull();
  test.info().annotations.push({ type: "mountedEngineImpl", description: String(await mountedImpl(page)) });
  await expect(page.locator(".pane.on .drawing-layer")).toBeVisible();
  return store;
}

for (const impl of IMPL_QUERY) {
  test.describe(`chart-engine drawings [${impl.label}]`, () => {
    test("A01: stored document renders on default and engine=mm routes", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Heavy drawing case is desktop-only.");
      const layer = page.locator(".pane.on .drawing-layer");
      await bootChart(page, impl.query, [SEED_TRENDLINE]);
      await expect(layer.locator(`g[data-drawing-id="${SEED_TRENDLINE.id}"]`)).toHaveCount(1, { timeout: 20_000 });
      const altQuery = impl.query.includes("engine=mm") ? "" : "&engine=mm";
      await bootChart(page, altQuery, [SEED_TRENDLINE]);
      await expect(layer.locator(`g[data-drawing-id="${SEED_TRENDLINE.id}"]`)).toHaveCount(1, { timeout: 20_000 });
    });

    test("A04: NOSUCH.TEST empty pane does not overwrite stored drawings", async ({ page }) => {
      const store = await bootChart(page, impl.query, [SEED_TRENDLINE]);
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("mm:embedded-symbol", { detail: { symbol: "NOSUCH.TEST" } })));
      await expect.poll(async () => page.locator(".chart-empty").isVisible(), { timeout: 30_000 }).toBe(true);
      expect(store.drawings).toHaveLength(1);
      expect((store.drawings[0] as { id: string }).id).toBe(SEED_TRENDLINE.id);
    });
  });
}

test.describe("chart-engine drawings [mobile A03]", () => {
  test("A03: seeded drawing projects on 390×844 mobile viewport", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "A03 runs in the mobile project.");
    const layer = page.locator(".pane.on .drawing-layer");
    await bootChart(page, "", [SEED_TRENDLINE]);
    const line = layer.locator(`g[data-drawing-id="${SEED_TRENDLINE.id}"]`);
    await expect(line).toBeVisible({ timeout: 45_000 });
    const box = await line.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(4);
    expect(box!.height).toBeGreaterThan(4);
  });
});
