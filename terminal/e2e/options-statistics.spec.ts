import { expect, test, type Page } from "@playwright/test";

const moves = (root = "SPY") => ({
  schema: "options_hub.moves/v1",
  asof: "2026-10-01",
  root,
  spot_ref: root === "MU" ? 1100 : 100,
  atm_iv: root === "MU" ? 54 : 20,
  regime: "slippery",
  expected_move: { band_mult: 1.96, horizon_days: 1, pct: root === "MU" ? 6.7 : 2, lo: root === "MU" ? 1025 : 98, hi: root === "MU" ? 1175 : 102 },
  calibration: { contained_rate: root === "MU" ? 0.916 : 0.96, n_sessions: 100, hits: root === "MU" ? 92 : 96, misses: root === "MU" ? 8 : 4, band_mult: 1.96, since: "2025-01-01", through: "2026-09-30", ci: root === "MU" ? [0.85, 0.95] : [0.91, 0.98] },
  convention: "descriptive calibration",
});
const vol = (root = "SPY") => ({
  schema: "options_hub.vol/v1", asof: "2026-10-01", root,
  atm_iv: root === "MU" ? 54 : 20, iv_rank_252: root === "MU" ? 67 : 40, iv_rank_all: 55, coverage_days_all: 900,
  iv_52w_lo: 10, iv_52w_hi: root === "MU" ? 80 : 30, rv20: root === "MU" ? 70 : 18, vrp: root === "MU" ? -16 : 2,
  history: Array.from({ length: 10 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, atm_iv: 15 + i, iv_rank: null, close: null })),
});
const agg = (root = "SPY") => ({
  schema: "options_hub.aggtrend/v1", asof: "2026-07-30", root, n_days: 5,
  units: { gamma: "per +1% spot", delta: "level", vanna: "per +1 vol point", charm: "per +1 day", vega: "per +1 vol point" },
  series: [
    { d: "2026-07-24", s: 100 }, { d: "2026-07-27", s: 101 }, { d: "2026-07-28", s: 99 },
    { d: "2026-07-29", s: 102 }, { d: "2026-07-30", s: 101 },
  ],
  stats: Object.fromEntries(["gamma", "delta", "vanna", "charm", "vega"].map((key, i) => [key, {
    mean: i, sd: 1, min: -2, p05: -1, p50: 0, p95: 2, max: 3, last: 1, pctile: (root === "MU" ? 60 : 70) + i, n: 100,
  }])),
});

async function installStatisticsSources(page: Page) {
  const seen: string[] = [];
  await page.route("**/api/flow?**", async (route) => {
    const url = new URL(route.request().url());
    const f = url.searchParams.get("f") ?? "";
    if (!/^(moves|vol|agg):/.test(f)) return route.fallback();
    seen.push(f);
    const [kind, root] = f.split(":");
    const body = kind === "moves" ? moves(root) : kind === "vol" ? vol(root) : agg(root);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return seen;
}

test("Statistics uses existing source owners and keeps their clocks separate", async ({ page }, testInfo) => {
  const seen = await installStatisticsSources(page);
  await page.goto("/options?tab=statistics");
  const view = page.getByTestId("options-statistics-view");
  await expect(view).toBeVisible({ timeout: 15_000 });
  await expect(view).toContainText("±2.00%");
  await expect(view).toContainText("96.0%");
  await expect(view).toContainText("40.0th");
  await expect(view).toContainText("70.0th");
  await expect(view).toContainText("MOVES · as of 2026-10-01");
  await expect(view).toContainText("AGG · as of 2026-07-30");
  await expect(view).toContainText("not a win rate");
  await expect.poll(() => seen.filter((key) => key.endsWith(":SPY")).sort()).toEqual(["agg:SPY", "moves:SPY", "vol:SPY"]);

  const svg = view.getByRole("img", { name: /historical moves/i });
  await expect(svg).toBeVisible();
  expect(await svg.evaluate((node) => ![...node.querySelectorAll("rect,line,text")].some((el) => [...el.attributes].some((a) => /NaN|Infinity/.test(a.value))))).toBe(true);

  const input = view.getByRole("combobox", { name: "Statistics root" });
  await input.fill("MU");
  await input.press("Enter");
  await expect(input).toHaveValue("MU");
  await expect(view).toContainText("±6.70%");
  await expect(view).toContainText("91.6%");
  await expect(view).toContainText("67.0th");
  await expect.poll(() => seen.filter((key) => key.endsWith(":MU")).sort()).toEqual(["agg:MU", "moves:MU", "vol:MU"]);

  const containment = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
  expect(containment.width).toBeLessThanOrEqual(containment.viewport + 1);
  if (testInfo.project.name === "mobile") {
    const box = await input.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
