import { expect, test, type Page } from "@playwright/test";
import flowLeadersFixture from "../public/data/flow_leaders_fixture.json";

/**
 * Discover → Leaders is a signed-flow research surface, not an evergreen
 * ticker ranking. Every case is an isolated Playwright API fixture — never
 * treats historical August observations or a newer build clock as live data.
 */
const old = {
  ...flowLeadersFixture,
  as_of: "2026-10-07T21:00:00.000Z",
  session_date: "2026-08-12",
  stale: true,
  cold_start: false,
  board_a: flowLeadersFixture.board_a.slice(0, 1),
  board_b: [],
  coverage: { ...flowLeadersFixture.coverage, n_universe: 1 },
};
const current = {
  ...old,
  session_date: "2026-10-07",
  stale: false,
  source_family: "thetadata_t2a_tape",
  coverage: { ...old.coverage, n_expected_roots: 375, n_current_roots: 340 },
};

async function installIntercept(page: Page) {
  let fresh = false;
  let requests = 0;
  const urls: string[] = [];
  await page.route(/\/api\/flow\?f=leaders(?:&refresh=1)?$/, async (route) => {
    requests += 1;
    urls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fresh ? current : old),
      headers: { "cache-control": "no-store" },
    });
  });
  return {
    enableFresh: () => { fresh = true; },
    requests: () => requests,
    urls: () => urls,
  };
}

test("stale Discover Leaders is hidden, inspectable, reversible, and explicitly refreshable", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
  const source = await installIntercept(page);
  await page.goto("/discover?tab=leaders");

  await expect(page.getByText("Current Flow Leaders unavailable")).toBeVisible();
  await expect(page.getByText("Last verified source session: 2026-08-12", { exact: false })).toBeVisible();
  await expect(page.locator("table.scr").getByText("AAL", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Inspect historical snapshot" }).click();
  await expect(page.locator("table.scr").getByText("AAL", { exact: true })).toBeVisible();
  await expect(page.getByText("Historical snapshot · source session 2026-08-12")).toBeVisible();

  await page.getByRole("button", { name: "Hide historical snapshot" }).click();
  await expect(page.getByText("Current Flow Leaders unavailable")).toBeVisible();

  source.enableFresh();
  await page.getByRole("button", { name: "Check for new data" }).click();
  await expect(page.locator("table.scr").getByText("AAL", { exact: true })).toBeVisible();
  await expect(page.getByText("Current Flow Leaders unavailable")).toHaveCount(0);
  expect(source.requests()).toBeGreaterThanOrEqual(2);
  expect(source.urls().some((url) => url.endsWith("?f=leaders&refresh=1"))).toBe(true);
});

test("the stale and inspect experience is bilingual in Chinese", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "zh");
    document.documentElement.setAttribute("data-lang", "zh");
  });
  await installIntercept(page);
  await page.goto("/discover?tab=leaders");
  await expect(page.getByText("当前资金流领涨榜不可用")).toBeVisible();
  await page.getByRole("button", { name: "查看历史快照" }).click();
  await expect(page.getByText("历史快照 · 数据会话 2026-08-12")).toBeVisible();
  await page.getByRole("button", { name: "收起历史快照" }).click();
  await expect(page.getByText("当前资金流领涨榜不可用")).toBeVisible();
});
