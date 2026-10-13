import { expect, test, type Page } from "@playwright/test";

/**
 * L03 — Pine output reaches the chart only through owned chart-engine handles.
 * Every case runs under the default renderer (lwc) and under `?engine=mm` (F-13 may still
 * mount lwc; behaviour is asserted via __mmChartEngineImpl witness, not impl identity).
 */

type Census = {
  engine: number;
  live: { alive: boolean; series: number; priceLines: number };
  owned: { price: number; futureAxis: number; indicators: number; compare: number; pine: number };
  orphanSeries: number;
  pricePaneLines: number;
  trackedPricePaneLines: number;
  orphanPricePaneLines: number;
  markerPlugins: number;
};

type OwnershipWindow = Window & {
  __mmChartOwnership?: () => Census;
  __mmChartOwnershipFinal?: Census;
  __mmChartEngineImpl?: () => string | null;
};

const SYMBOLS = ["AAPL", "MSFT"];
const HLINE_ID = "e2e-pine-hline";
const PANE_ID = "e2e-pine-pane";
const UNSUP_ID = "e2e-pine-unsup";

const HLINE_SRC = [
  "//@version=6",
  'indicator("E2E HLine", overlay=true)',
  "hline(100)",
  "",
].join("\n");

const PANE_SRC = [
  "//@version=6",
  'indicator("E2E Pane", overlay=false)',
  "plot(close)",
  "hline(50)",
  "",
].join("\n");

const UNSUP_SRC = [
  "//@version=6",
  'indicator("E2E Unsup", overlay=true)',
  "fill(plot(close), plot(open), color=color.new(color.green, 90))",
  "",
].join("\n");

const SCRIPT_ROWS = [
  { id: HLINE_ID, name: "E2E HLine", source: HLINE_SRC, lang: "pine", params: {}, updated_at: "2026-01-01T00:00:00Z" },
  { id: PANE_ID, name: "E2E Pane", source: PANE_SRC, lang: "pine", params: {}, updated_at: "2026-01-01T00:00:00Z" },
  { id: UNSUP_ID, name: "E2E Unsup", source: UNSUP_SRC, lang: "pine", params: {}, updated_at: "2026-01-01T00:00:00Z" },
];

const IMPL_QUERY = [
  { label: "lwc", query: "" },
  { label: "engine-mm-query", query: "&engine=mm" },
] as const;

async function stubScripts(page: Page) {
  await page.route("**/api/scripts/list", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ scripts: SCRIPT_ROWS }),
    });
  });
}

async function bootPine(page: Page, engineQuery: string, addScriptId: string) {
  await stubScripts(page);
  await page.addInitScript((scriptId: string) => {
    localStorage.setItem("mm.pineOn", JSON.stringify([scriptId]));
    localStorage.setItem("mm.inds", JSON.stringify([]));
    localStorage.setItem("mm.startTf", JSON.stringify("D"));
  }, addScriptId);
  await page.goto(`/terminal?symbol=${SYMBOLS[0]}&addScript=${addScriptId}${engineQuery}`);
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as OwnershipWindow).__mmChartEngineImpl?.() ?? "missing"), { timeout: 30_000 })
    .not.toBe("missing");
}

async function census(page: Page): Promise<Census> {
  const c = await page.evaluate(() => (window as unknown as OwnershipWindow).__mmChartOwnership?.() ?? null);
  expect(c, "ownership probe").not.toBeNull();
  return c as Census;
}

const setSymbol = (page: Page, symbol: string) =>
  page.evaluate((s) => window.dispatchEvent(new CustomEvent("mm:embedded-symbol", { detail: { symbol: s } })), symbol);

for (const impl of IMPL_QUERY) {
  test.describe(`pine chart-engine [${impl.label}]`, () => {
    test("overlay hline script keeps pooled price-line ownership sound", async ({ page }) => {
      await bootPine(page, impl.query, HLINE_ID);
      await expect.poll(async () => (await census(page)).trackedPricePaneLines, { timeout: 60_000 }).toBeGreaterThan(0);
      const sample = await census(page);
      expect(sample.orphanSeries).toBe(0);
      const orphanBaseline = sample.orphanPricePaneLines;
      expect(sample.pricePaneLines).toBe(sample.trackedPricePaneLines + orphanBaseline);
    });

    test("50 symbol alternations keep pine ownership counts stable", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Heavy churn is desktop-only.");
      test.setTimeout(8 * 60_000);
      await bootPine(page, impl.query, HLINE_ID);
      await expect.poll(async () => (await census(page)).trackedPricePaneLines, { timeout: 60_000 }).toBeGreaterThan(0);
      const baseline = await census(page);
      const orphanBaseline = baseline.orphanPricePaneLines;
      for (let i = 0; i < 50; i++) {
        await setSymbol(page, SYMBOLS[i % 2]);
        await expect.poll(async () => (await census(page)).engine, { timeout: 45_000 }).toBe(1);
      }
      const after = await census(page);
      expect(after.pricePaneLines).toBe(baseline.pricePaneLines);
      expect(after.trackedPricePaneLines).toBe(baseline.trackedPricePaneLines);
      expect(after.owned.pine).toBe(baseline.owned.pine);
      expect(after.orphanSeries).toBe(0);
      expect(after.orphanPricePaneLines).toBe(orphanBaseline);
      expect(after.pricePaneLines).toBe(after.trackedPricePaneLines + orphanBaseline);
    });

    test("disabling the script clears pine pooled lines", async ({ page }) => {
      await bootPine(page, impl.query, HLINE_ID);
      await expect.poll(async () => (await census(page)).trackedPricePaneLines, { timeout: 60_000 }).toBeGreaterThan(0);
      const loaded = await census(page);
      const pooledBefore = loaded.trackedPricePaneLines;
      await page.evaluate(() => { localStorage.setItem("mm.pineOn", JSON.stringify([])); });
      await page.goto(`/terminal?symbol=${SYMBOLS[0]}${impl.query}`);
      await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 60_000 });
      await expect.poll(async () => (await census(page)).trackedPricePaneLines, { timeout: 60_000 }).toBeLessThan(pooledBefore);
      const end = await census(page);
      expect(end.owned.pine).toBe(0);
    });

    test("unsupported construct shows pinned diagnostic text", async ({ page }) => {
      await bootPine(page, impl.query, UNSUP_ID);
      await expect.poll(async () => page.evaluate(() => {
        const w = (window as unknown as { __mmPineWitness?: () => { warnings: string[] } }).__mmPineWitness?.().warnings ?? [];
        return w.some((line) => line === "fill() is not supported yet — its output is suppressed");
      }), { timeout: 60_000 }).toBe(true);
    });

    test("NOSUCH.TEST releases pine owners", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Desktop-only heavy case.");
      await bootPine(page, impl.query, PANE_ID);
      await expect.poll(async () => (await census(page)).owned.pine, { timeout: 60_000 }).toBeGreaterThan(0);
      await setSymbol(page, "NOSUCH.TEST");
      await expect.poll(async () => (await census(page)).owned.pine, { timeout: 60_000 }).toBe(0);
      const dead = await census(page);
      expect(dead.orphanSeries).toBe(0);
      expect(dead.trackedPricePaneLines).toBe(0);
    });
  });
}

test("unmount clears pine ownership (desktop)", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop-only.");
  await bootPine(page, "", HLINE_ID);
  await expect.poll(async () => (await census(page)).engine, { timeout: 60_000 }).toBe(1);
  await page.locator(".appnav").getByRole("link", { name: "Analysis" }).click();
  await expect(page).toHaveURL(/\/analysis\b/, { timeout: 45_000 });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as OwnershipWindow).__mmChartOwnershipFinal?.owned.pine ?? -1), { timeout: 30_000 })
    .toBe(0);
});
