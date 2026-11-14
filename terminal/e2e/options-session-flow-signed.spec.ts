import { expect, test, type Page } from "@playwright/test";

const DATE = "2026-09-17";
const ARCHIVE = "2026-09-16";
const MINUTES = [
  { t: "09:30", ncp: 100_000_000, npp: -50_000_000 },
  { t: "09:31", ncp: 250_000_000, npp: -120_000_000 },
  { t: "09:32", ncp: 400_000_000, npp: -90_000_000 },
];
const TIDE = {
  asof: DATE + "T13:32:00Z", session_date: DATE, minutes: MINUTES,
  spy: [], sectors: [], top_net_impact: [],
};

async function fixture(page: Page, lang: "en" | "zh") {
  await page.addInitScript(language => {
    localStorage.setItem("mm.lang", language);
    // Exercise the existing polling fallback with deterministic HTTP observations.
    // Production transport, credentials and provider data are unchanged.
    Reflect.deleteProperty(window, "EventSource");
  }, lang);
  await page.route("**/api/intraday?**", route => route.fulfill({ json: { bars: [] } }));
  await page.route("**/api/flow?**", async route => {
    const key = new URL(route.request().url()).searchParams.get("f") ?? "";
    if (key === "tide") return route.fulfill({ json: TIDE });
    const stamps = ["0930", "0931", "0932"];
    if (key === "surface_dates:SPY") return route.fulfill({ json: {
      root: "SPY", dates: [DATE, ARCHIVE], latest: DATE, cadenceSec: 60,
    } });
    if (key === "surface_idx:SPY" || key === "surface_idx_at:SPY:" + ARCHIVE) return route.fulfill({ json: {
      root: "SPY", date: key.startsWith("surface_idx_at:") ? ARCHIVE : DATE,
      stamps, latest: stamps.at(-1), cadenceSec: 60,
    } });
    if (key.startsWith("surface:SPY:") || key.startsWith("surface_at:SPY:" + ARCHIVE + ":")) {
      const stamp = key.split(":").at(-1)!;
      const selected = stamps.slice(0, stamps.indexOf(stamp) + 1);
      const date = key.startsWith("surface_at:") ? ARCHIVE : DATE;
      return route.fulfill({ json: {
        root: "SPY", session_date: date, spot: 100.2, price_levels: [100, 105],
        time_steps: selected.map(value => value.slice(0, 2) + ":" + value.slice(2)),
        grids: { netprem: [selected.map(() => 1000), selected.map(() => -2000)] },
        asof: date + "T13:32:00Z", cadence: "1-min",
      } });
    }
    return route.continue();
  });
}
function pane(page: Page, lang: "en" | "zh") {
  // The actual accessible mode group belongs to the pane's controls row.
  return page.getByRole("group", { name: lang === "en" ? "Series mode" : "序列模式", exact: true }).locator("..").locator("..");
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

for (const lang of ["en", "zh"] as const) {
  test("Tide Session keeps signed totals through display toggles (" + lang + ")", async ({ page }, info) => {
    test.setTimeout(75_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await fixture(page, lang);
    await page.goto("/options?tab=tide");
    await page.getByRole("button", { name: lang === "en" ? "Session" : "盘中", exact: true }).click();
    const flow = pane(page, lang);
    const totals = flow.locator(".obs-tag b");
    await expect(totals).toHaveText(["$400.0M", "−$90.0M"]);
    await expect(flow.locator("canvas").first()).toBeVisible();
    const perMinute = flow.getByRole("button", { name: lang === "en" ? "per-min" : "每分钟", exact: true });
    await perMinute.click();
    await expect(perMinute).toHaveAttribute("aria-pressed", "true");
    const absolute = flow.getByRole("button", { name: lang === "en" ? "absolute" : "绝对值", exact: true });
    await absolute.click();
    await expect(absolute).toHaveAttribute("aria-pressed", "true");
    // These chips are raw cumulative observations, even when the plot is transformed.
    await expect(totals).toHaveText(["$400.0M", "−$90.0M"]);
    await absolute.click();
    await expect(absolute).toHaveAttribute("aria-pressed", "false");
    await expect(totals).toHaveText(["$400.0M", "−$90.0M"]);
    await flow.screenshot({ path: info.outputPath("tide-session-" + lang + ".png") });
    await noOverflow(page);
    expect(errors).toEqual([]);
  });
}

test("Surface Session keeps signed replay totals and withdraws archived premium data", async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await fixture(page, "en");
  await page.goto("/options?tab=surface");
  const rail = page.locator(".obs-surf-frame-rail");
  await expect(rail).toHaveAttribute("aria-valuemax", "3", { timeout: 30_000 });
  const session = page.getByRole("button", { name: "Session Flow", exact: true });
  await session.click();
  let flow = pane(page, "en");
  await expect(flow.locator(".obs-tag b")).toHaveText(["$400.0M", "−$90.0M"]);
  await rail.press("ArrowLeft");
  await expect(rail).toHaveAttribute("aria-valuetext", /09:31/);
  await expect(flow.locator(".obs-tag b")).toHaveText(["$250.0M", "−$120.0M"]);
  await expect(flow).toContainText("truncated to the replay time 09:31");
  await flow.screenshot({ path: info.outputPath("surface-session-replayed.png") });

  await page.locator(".obs-surf-replay-session").selectOption(ARCHIVE);
  if (await session.getAttribute("aria-expanded") !== "true") await session.click();
  // The withdrawal heading includes its exact archived date in a child span.
  await expect(session.locator("..")).toContainText("Session flow is live-session only");
  await expect(session.locator("..")).toContainText(ARCHIVE);
  await expect(page.getByRole("group", { name: "Series mode", exact: true })).toHaveCount(0);
  await session.locator("..").screenshot({ path: info.outputPath("surface-session-archived.png") });

  await page.locator(".obs-surf-replay-session").selectOption("");
  await expect(rail).toHaveAttribute("aria-valuemax", "3");
  if (await session.getAttribute("aria-expanded") !== "true") await session.click();
  flow = pane(page, "en");
  await expect(flow.locator(".obs-tag b")).toHaveText(["$400.0M", "−$90.0M"]);
  await expect(flow.locator("canvas").first()).toBeVisible();
  await flow.screenshot({ path: info.outputPath("surface-session-live-return.png") });
  await noOverflow(page);
  expect(errors).toEqual([]);
});
