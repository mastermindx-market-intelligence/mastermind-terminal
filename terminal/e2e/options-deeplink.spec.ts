import { test, expect } from "./fixtures";

/**
 * Regression: /options?tab=X deep-links must land on the requested tab on a
 * COLD load. The tab used to seed via a post-mount window.location.search →
 * setState hop (react-hooks/set-state-in-effect) that intermittently left the
 * workspace on the default Tape tab. The fix derives the tab synchronously
 * from useSearchParams — /options is always dynamically rendered, so the
 * SERVER response itself marks the requested pill selected and hydration
 * starts on it.
 *
 * Two layers, so a regression back to any client-side hop cannot hide behind
 * retries/timeouts:
 *  1. the raw SSR HTML (no JS at all) must carry the selection;
 *  2. the hydrated page must keep it, with the URL preserved.
 */

// `prism` exercises the §5.3 retired-tab alias: ROUTE_VIEW maps it onto the
// Exposure desk (page key `gex`), and the URL keeps the original ?tab=prism
// (GexDeskView reads it to open on the matrix view). Each case also pins the
// R5 category that must own the existing view.
const CASES = [
  { query: "vol", pill: "vol", category: "flow" },
  { query: "0dte", pill: "0dte", category: "flow" },
  { query: "largest", pill: "largest", category: "flow" },
  { query: "volatility", pill: "volatility", category: "volatility" },
  { query: "levels", pill: "levels", category: "exposure" },
  { query: "prism", pill: "gex", category: "exposure" },
] as const;

for (const { query, pill, category } of CASES) {
  test(`/options?tab=${query} activates the ${pill} tab on cold load`, async ({ page }, testInfo) => {
    test.setTimeout(60_000); // first hit may pay the dev-server route compile

    // 1) Server-rendered selection. WorkspaceTabs renders one role=tab button
    //    per pill as id="wtab-<key>" with aria-selected — assert on the raw
    //    payload before any hydration can run.
    const res = await page.request.get(`/options?tab=${query}`);
    expect(res.ok()).toBe(true);
    const html = await res.text();
    const pillTag = (key: string) => {
      const m = html.match(new RegExp(`<button[^>]*id="wtab-${key}"[^>]*>`));
      expect(m, `pill wtab-${key} present in SSR HTML`).not.toBeNull();
      return m![0];
    };
    expect(pillTag(pill)).toContain('aria-selected="true"');
    expect(pillTag(`cat-${category}`)).toContain('aria-selected="true"');
    expect(pillTag("cat-flow")).toContain(
      category === "flow" ? 'aria-selected="true"' : 'aria-selected="false"',
    );

    // 2) Hydrated cold load: both category and requested child view stay active.
    await page.goto(`/options?tab=${query}`);
    await expect(page.locator(`#wtab-${pill}`)).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
    await expect(page.locator(`#wtab-cat-${category}`)).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(new RegExp(`/options\\?tab=${query}$`));
    await page.screenshot({
      path: testInfo.outputPath(`${testInfo.project.name}-options-deeplink-${query}.png`),
      fullPage: false,
    });
  });
}

test("/options?tab=statistics cold-loads the gated Statistics category", async ({ page }, testInfo) => {
  test.setTimeout(60_000);

  const res = await page.request.get("/options?tab=statistics");
  expect(res.ok()).toBe(true);
  const html = await res.text();
  const category = html.match(/<button[^>]*id="wtab-cat-statistics"[^>]*>/)?.[0];
  expect(category).toContain('aria-selected="true"');
  expect(html).toContain('data-options-ia-state="statistics-pending"');

  await page.goto("/options?tab=statistics");
  await expect(page.locator("#wtab-cat-statistics")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-options-ia-state="statistics-pending"]')).toBeVisible();
  await expect(page).toHaveURL(/\/options\?tab=statistics$/);
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-options-deeplink-statistics.png`),
    fullPage: false,
  });
});
