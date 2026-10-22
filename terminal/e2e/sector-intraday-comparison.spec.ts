import { expect, test, type Page, type Route } from "@playwright/test";
import { sectorFixture } from "./fixtures/sector-company-v3";
import { intradayPulse } from "./fixtures/sector-intraday-pulse";

test.setTimeout(90000);
const url = "/discover?tab=sectors&sector=xlk&group=semiconductors&sectorTheme=light";

/** Serve every owner feed from the shared fixture, then replace only the intraday one, so a case
 * can exercise a specific owner state without disturbing the rest of the overview. */
async function prepare(page: Page, options: { language?: string; pulse?: unknown; denied?: boolean } = {}) {
  await page.addInitScript(lang => { localStorage.setItem("mm.lang", lang); document.documentElement?.setAttribute("data-lang", lang); }, options.language || "en");
  await page.route("**/api/sector-intelligence?**", async (route: Route) => {
    const source = new URL(route.request().url()).searchParams.get("source") || "";
    if (source !== "intraday") return sectorFixture(route);
    if (options.denied) return route.fulfill({ status: 401, json: { data: null,
      receipt: { source, path: "/live/basket_pulse.json", status: "access", asOf: null,
        observedAt: null, stale: false, contentHash: null } } });
    const data = options.pulse === undefined ? intradayPulse() : options.pulse;
    return route.fulfill({ status: 200, json: { data, receipt: { source, path: "/live/basket_pulse.json",
      status: "ready", asOf: data && typeof data === "object" ? (data as { as_of_utc?: string }).as_of_utc ?? null : null,
      observedAt: new Date().toISOString(), stale: false, contentHash: null } } });
  });
}
async function noOverflow(page: Page) {
  const root = page.getByTestId("sector-intelligence");
  expect(await root.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}
const panel = (page: Page) => page.getByTestId("sector-intelligence").getByTestId("sector-intraday");

test("the mounted overview renders an observed interval, a retained close and qualified baskets", async ({ page }) => {
  await prepare(page); await page.goto(url);
  const section = panel(page);
  await expect(section.getByRole("heading", { name: "Intraday relative moves", exact: true })).toBeVisible();

  const observed = section.locator('[data-basket="ai_infra"]');
  await expect(observed).toContainText("ai_infra");
  await expect(observed).toContainText("+2.00%");   // the owner's observed interval change
  await expect(observed).toContainText("+1.49%");   // the owner's SPY-relative interval change
  await expect(observed).toContainText("62.50%");   // the owner's positive relative breadth
  await expect(observed).toContainText("−1.25%");   // the day change, on its own clock

  // The disclosure carries the exact clocks and the matched method, not a rounded date.
  await observed.locator("summary").click();
  const detail = observed.locator("dl");
  await expect(detail).toContainText("Reference clock");
  await expect(detail).toContainText("Observed at");
  await expect(detail).toContainText("3600 s");
  await expect(detail).toContainText("matched_member_equal_weight");
  await expect(detail).toContainText("8 / 10 (80.0%)");
  await expect(detail).toContainText("missing_observation ×2");
  await expect(detail).not.toContainText("not a new one");

  // A redelivered settled close is labelled as such and is not restated as a new observation.
  const retained = section.locator('[data-basket="mag7"]');
  await retained.locator("summary").click();
  await expect(retained).toContainText("Retained — same observation, not a new one");
  await expect(retained).toContainText("Settled closing observation");

  // An owner-qualified basket shows why, and never a number standing in for one.
  const qualified = section.getByTestId("sector-intraday-unqualified");
  await expect(qualified).toHaveCount(2);
  await expect(qualified.first()).toContainText("Waiting for another observation.");
  await expect(qualified.last()).toContainText("Comparable observations are unavailable.");
  await expect(qualified.last()).not.toContainText("0.00%");
  await expect(qualified.last()).not.toContainText("%");
  await noOverflow(page);
});

test("the feed's own source clock is shown at full precision, never the transport receipt", async ({ page }) => {
  await prepare(page); await page.goto(url);
  const clock = panel(page).getByTestId("sector-intraday-clock");
  const shown = await clock.getAttribute("dateTime");
  expect(shown).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  // Not collapsed to a bare date: two observations on one day must stay distinguishable.
  expect(shown).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test("a denied owner leaves a bounded access message and no figures anywhere in the section", async ({ page }) => {
  await prepare(page, { denied: true }); await page.goto(url);
  const section = panel(page);
  await expect(section).toContainText("Sign in with access to view these observations.");
  await expect(section.locator('[data-testid="sector-intraday-basket"]')).toHaveCount(0);
  await expect(section).not.toContainText("+2.00%");
  await noOverflow(page);
});

test("an unreadable owner payload fails closed without taking the rest of the overview with it", async ({ page }) => {
  await prepare(page, { pulse: { schema: "basket_pulse.v2", market: "us", baskets: [] } }); await page.goto(url);
  const root = page.getByTestId("sector-intelligence");
  await expect(panel(page)).toContainText("Interval observations could not be verified.");
  await expect(root.getByRole("heading", { name: "Leading, with mixed timing", exact: true })).toBeVisible();
  await expect(root.locator('[data-company-choice]').first()).toBeVisible();
  await expect(root).not.toContainText("+2.00%");
  await noOverflow(page);
});

test("a build that has published no comparisons yet reads as an absent capability", async ({ page }) => {
  await prepare(page, { pulse: { schema: "basket_pulse.v1", market: "us", session: "rth", as_of_utc: new Date().toISOString(),
    baskets: [{ id: "ai_infra", n_members: 10, n_quoted: 10, live_ew_chg_pct: -1.25 }] } }); await page.goto(url);
  await expect(panel(page)).toContainText("This source has not published interval comparisons yet.");
  await noOverflow(page);
});

test("an owner correction stays qualified instead of becoming a fresh observation", async ({ page }) => {
  const pulse = intradayPulse() as { baskets: Record<string, unknown>[] };
  pulse.baskets[0].intraday_comparison = { schema: "basket_intraday_comparison.v1", benchmark: "SPY",
    method: "matched_member_equal_weight", observation_kind: "regular", settlement_tolerance_seconds: 0,
    status: "baseline_corrected" };
  await prepare(page, { pulse }); await page.goto(url);
  const section = panel(page);
  await expect(section.locator('[data-basket="ai_infra"]')).toHaveCount(0);
  const corrected = section.getByTestId("sector-intraday-unqualified").filter({ hasText: "ai_infra" });
  await expect(corrected).toContainText("Comparison reset after a source change.");
  // ai_infra's figures are gone; mag7 keeps its own, deliberately different, observation.
  await expect(section).not.toContainText("+2.00%");
  await expect(section).not.toContainText("+1.49%");
  await expect(section.locator('[data-basket="mag7"]')).toContainText("−2.24%");
  await noOverflow(page);
});

test("a clock that no longer advances is never presented as a new interval", async ({ page }) => {
  const pulse = intradayPulse() as { baskets: Record<string, unknown>[] };
  const comparison = pulse.baskets[0].intraday_comparison as Record<string, unknown>;
  comparison.source_asof = comparison.reference_asof;   // the benchmark did not advance
  await prepare(page, { pulse }); await page.goto(url);
  const section = panel(page);
  await expect(section.locator('[data-basket="ai_infra"]')).toHaveCount(0);
  await expect(section).not.toContainText("+2.00%");
  await noOverflow(page);
});

test("an observation the owner has not refreshed inside the currency bound loses its figures but keeps its clock", async ({ page }) => {
  const pulse = intradayPulse() as { baskets: Record<string, unknown>[] };
  const comparison = pulse.baskets[0].intraday_comparison as Record<string, unknown>;
  const stale = new Date(Date.now() - 50 * 60_000).toISOString();
  comparison.source_asof = stale;
  comparison.reference_asof = new Date(Date.parse(stale) - 60 * 60_000).toISOString();
  await prepare(page, { pulse }); await page.goto(url);
  const section = panel(page);
  await expect(section.locator('[data-basket="ai_infra"]')).toHaveCount(0);
  await expect(section).not.toContainText("+2.00%");
  await expect(section).not.toContainText("+1.49%");
  await noOverflow(page);
});

test("the section localizes fully, and neither language leaks into the other view", async ({ page }) => {
  await prepare(page, { language: "zh" }); await page.goto(url);
  const section = panel(page);
  await expect(section.getByRole("heading", { name: "盘中相对走势", exact: true })).toBeVisible();
  await expect(section).toContainText("观测区间");
  await expect(section).toContainText("区间相对SPY");
  await expect(section).toContainText("等待新的观测。");
  // Basket identity is the owner's own token in both languages; it is never translated here.
  await expect(section.locator('[data-basket="ai_infra"]')).toBeVisible();
  await expect(section).not.toContainText("Intraday relative moves");
  await expect(section).not.toContainText("Waiting for another observation.");
  await noOverflow(page);
});

test("the disclosure opens from the keyboard and keeps its content reachable", async ({ page }) => {
  await prepare(page); await page.goto(url);
  const observed = panel(page).locator('[data-basket="ai_infra"]');
  const summary = observed.locator("summary");
  await summary.focus();
  await expect(summary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(observed.locator("dl")).toBeVisible();
  await expect(observed).toContainText("matched_member_equal_weight");
  await noOverflow(page);
});
