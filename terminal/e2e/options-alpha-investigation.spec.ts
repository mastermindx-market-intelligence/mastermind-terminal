import { expect, test, type Page } from "@playwright/test";

// Declared synthetic events. These exercise the user workflow, not predictive value.
const event = (id: string, root = "NVDA") => ({
  id, root, right: "C", exp: "2026-10-16", strike: 200,
  observed_at: "2026-09-30T14:00:00Z", decision_at: "2026-09-30T14:00:01Z",
  available_at: "2026-09-30T14:00:02Z", vol_gt_oi_ratio: 1.25,
  microstructure: {
    schema: "options.trade_nbbo_microstructure/v1", source_print_count: 4,
    nbbo_valid_print_count: 3, source_premium_usd: 1000,
    nbbo_covered_premium_usd: 900, nbbo_print_coverage: 0.75,
    nbbo_premium_coverage: 0.9, at_ask_share: 0.444444,
    at_bid_share: 0.222222, inside_share: 0.333334, outside_share: 0,
    aggression_share: 0.666666, aggression_balance: 0.222222,
    spread_median_usd: 0.2, spread_median_pct: 0.05,
    quote_age_median_ms: 100, quote_age_max_ms: 250,
    bid_size_median: 12, ask_size_median: 14,
  },
});
const feed = (events = [event("event-nvda")]) => ({
  schema: "live_flow.feed/v1", stale: false, session_date: "2026-09-30",
  source_asof: "2026-09-30T14:00:04Z", asof: "2026-09-30T14:00:05Z", events,
});

async function openAlpha(page: Page) {
  await page.goto("/options?tab=prophet");
  await page.getByRole("tab", { name: /Options Alpha/ }).click();
}
async function routeFeed(page: Page, payload = feed()) {
  await page.route("**/api/flow?f=feed", route => route.fulfill({ json: payload }));
}

test("measured investigation remains usable when the independent shadow feed fails", async ({ page }) => {
  await routeFeed(page);
  await page.route("**/api/flow?f=options_prophet_idx", route => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  await openAlpha(page);
  await expect(page.getByTestId("options-alpha-investigation")).toBeVisible();
  await expect(page.getByTestId("options-alpha-shadow-unavailable")).toBeVisible();
  await page.getByRole("button", { name: "Inspect NVDA event" }).click();
  const detail = page.getByRole("dialog", { name: /NVDA/ });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("event-nvda");
  await expect(detail.getByRole("link", { name: "Open underlying chart" })).toHaveAttribute("href", "/terminal?symbol=NVDA");
  await expect(detail).toContainText("Not a trade recommendation");
});

test("search reaches events beyond the old six-card truncation", async ({ page }) => {
  await routeFeed(page, feed([...Array.from({ length: 7 }, (_, i) => event(`nvda-${i}`)), event("event-aapl", "AAPL")]));
  await openAlpha(page);
  const search = page.getByRole("searchbox", { name: "Filter measured activity" });
  await search.fill("AAPL");
  await expect(page.getByTestId("options-alpha-activity-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Inspect AAPL event" }).click();
  await expect(page.getByRole("dialog", { name: /AAPL/ })).toContainText("event-aapl");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await search.fill("NO_MATCH");
  await expect(page.getByTestId("options-alpha-investigation")).toContainText("No measured events match");
});

test("watchlist save uses the selected owned list and verifies the existing server inventory", async ({ page }) => {
  await routeFeed(page);
  const requests: unknown[] = [];
  let saved = false;
  await page.route("**/api/watchlist", async route => {
    if (route.request().method() === "POST") {
      requests.push(route.request().postDataJSON());
      saved = true;
      await route.fulfill({ json: { ok: true, added: 1 } });
    } else {
      await route.fulfill({ json: { lists: [
        { id: "owned-one", name: "Default", symbols: [] },
        { id: "owned-two", name: "Research", symbols: saved ? [{ symbol: "NVDA" }] : [] },
      ], sharedWithMe: [{ id: "foreign-list", name: "Read-only shared", symbols: [] }] } });
    }
  });
  await openAlpha(page);
  await page.getByRole("button", { name: "Inspect NVDA event" }).click();
  const detail = page.getByRole("dialog");
  await detail.getByLabel("Save underlying to").selectOption("owned-two");
  await expect(detail.getByRole("option", { name: "Read-only shared" })).toHaveCount(0);
  await detail.getByRole("button", { name: "Add underlying to watchlist" }).click();
  await expect(detail.getByRole("status")).toContainText("Saved to Research");
  expect(requests).toEqual([{ action: "add", symbol: "NVDA", listId: "owned-two", section: "" }]);
  await expect(detail.getByRole("button", { name: "Already on this watchlist" })).toBeDisabled();
});

test("lost save response is reconciled by reading without a second write", async ({ page }) => {
  await routeFeed(page);
  let writes = 0;
  await page.route("**/api/watchlist", async route => {
    if (route.request().method() === "POST") {
      writes += 1;
      await route.abort("failed");
    } else {
      await route.fulfill({ json: { lists: [{ id: "owned-one", name: "Default", symbols: writes ? [{ symbol: "NVDA" }] : [] }] } });
    }
  });
  await openAlpha(page);
  await page.getByRole("button", { name: "Inspect NVDA event" }).click();
  const detail = page.getByRole("dialog");
  await detail.getByRole("button", { name: "Add underlying to watchlist" }).click();
  await expect(detail.getByRole("status")).toContainText("Saved to Default");
  expect(writes).toBe(1);
});

test("unconfirmed watchlist writes never display success or silently retry", async ({ page }) => {
  await routeFeed(page);
  let writes = 0;
  await page.route("**/api/watchlist", async route => {
    if (route.request().method() === "POST") {
      writes += 1;
      await route.fulfill({ status: 503, json: { error: "unavailable" } });
    } else {
      await route.fulfill({ json: { lists: [{ id: "owned-one", name: "Default", symbols: [] }] } });
    }
  });
  await openAlpha(page);
  await page.getByRole("button", { name: "Inspect NVDA event" }).click();
  const detail = page.getByRole("dialog");
  await detail.getByRole("button", { name: "Add underlying to watchlist" }).click();
  await expect(detail.getByRole("status")).toContainText("Save not confirmed");
  await expect(detail.getByRole("button", { name: "Check watchlist" })).toBeVisible();
  expect(writes).toBe(1);
});

test("signed-out inspection works and watchlist control asks for authentication", async ({ page }) => {
  await routeFeed(page);
  await page.route("**/api/watchlist", route => route.fulfill({ status: 401, json: { error: "unauthenticated" } }));
  await openAlpha(page);
  await page.getByRole("button", { name: "Inspect NVDA event" }).click();
  const detail = page.getByRole("dialog");
  await expect(detail.getByRole("link", { name: "Sign in to save" })).toBeVisible();
  await expect(detail).toContainText("90.0%");
  await expect(detail.getByRole("button", { name: "Add underlying to watchlist" })).toHaveCount(0);
});

test("detail is bilingual, keyboard-accessible, and fits the viewport", async ({ page }) => {
  await routeFeed(page);
  await openAlpha(page);
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-lang", "zh");
    window.dispatchEvent(new CustomEvent("mm:lang"));
  });
  const opener = page.getByRole("button", { name: "查看 NVDA 事件" });
  await opener.click();
  const detail = page.getByRole("dialog");
  await expect(detail).toContainText("并非交易建议");
  await expect(detail).not.toContainText("Not a trade recommendation");
  const bounds = await detail.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test("native watchlist route persists the selected underlying across reopening", async ({ page }, info) => {
  await routeFeed(page);
  await page.goto("/options?tab=prophet");
  await page.context().addCookies([{ name: "mm_e2e_wl", value: `alpha-${info.project.name}-native`, url: new URL(page.url()).origin }]);
  // The server uses its existing isolated E2E database. No page.route replaces the watchlist API.
  const response = await page.request.post("/api/watchlist", { data: { action: "createList", name: "Alpha review" } });
  expect(response.ok()).toBe(true);
  const { list } = await response.json();
  await page.getByRole("tab", { name: /Options Alpha/ }).click();
  await page.getByRole("button", { name: "Inspect NVDA event" }).click();
  const detail = page.getByRole("dialog");
  await detail.getByLabel("Save underlying to").selectOption(list.id);
  await detail.getByRole("button", { name: "Add underlying to watchlist" }).click();
  await expect(detail.getByRole("status")).toContainText("Saved to Alpha review");
  const inventory = await (await page.request.get("/api/watchlist")).json();
  const saved = inventory.lists.find((item: { id: string }) => item.id === list.id);
  expect(saved.symbols.filter((item: { symbol: string }) => item.symbol === "NVDA")).toHaveLength(1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Inspect NVDA event" }).click();
  await detail.getByLabel("Save underlying to").selectOption(list.id);
  await expect(detail.getByRole("button", { name: "Already on this watchlist" })).toBeDisabled();
  const popupPromise = page.waitForEvent("popup");
  await detail.getByRole("link", { name: "Open underlying chart" }).click();
  const chart = await popupPromise;
  await chart.waitForLoadState("domcontentloaded");
  expect(new URL(chart.url()).pathname).toBe("/terminal");
  expect(new URL(chart.url()).searchParams.get("symbol")).toBe("NVDA");
  await chart.close();
  await detail.screenshot({ path: info.outputPath("native-investigation.png") });
});


test("an open observation survives a refreshed source with no retained events", async ({ page }) => {
  await page.clock.install();
  let refreshed = false;
  await page.route("**/api/flow?f=feed", route => route.fulfill({ json: refreshed ? feed([]) : feed() }));
  await page.route("**/api/watchlist", route => route.fulfill({ status: 401, json: { error: "unauthenticated" } }));
  await openAlpha(page);
  await page.getByRole("button", { name: "Inspect NVDA event" }).click();
  const detail = page.getByRole("dialog");
  await expect(detail).toBeVisible();
  refreshed = true;
  await page.clock.fastForward(31_000);
  await expect(page.getByTestId("options-alpha-activity-row")).toHaveCount(0);
  await expect(detail).toContainText("event-nvda");
  await expect(detail).toContainText("Source snapshot retained when opened");
  await expect(detail).toContainText("$900 / $1,000");
});


test("investigation actions have visible text against the native dialog background", async ({ page }, info) => {
  await routeFeed(page);
  await openAlpha(page);
  await page.getByRole("button", { name: "Inspect NVDA event" }).click();
  const detail = page.getByRole("dialog");
  const action = detail.getByRole("link", { name: "Open underlying chart" });
  const colors = await action.evaluate(element => ({
    text: getComputedStyle(element).color,
    surface: getComputedStyle(element.closest("dialog")!).backgroundColor,
  }));
  expect(colors.text).not.toBe(colors.surface);
  await detail.screenshot({ path: info.outputPath("investigation-dark-en.png") });
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-lang", "zh");
    window.dispatchEvent(new CustomEvent("mm:lang"));
  });
  await expect(detail).toContainText("并非交易建议");
  await detail.screenshot({ path: info.outputPath("investigation-dark-zh.png") });
  // Observatory supplies this surface's dark palette. A root data-theme flip did
  // not change that palette; do not label an unchanged dark image as light proof.
});


test("a late initial inventory cannot erase a verified watchlist save", async ({ page }) => {
  await routeFeed(page);
  await openAlpha(page);
  let releaseInitial!: () => void;
  const pendingInitial = new Promise<void>(resolve => { releaseInitial = resolve; });
  let reads = 0;
  let saved = false;
  await page.route("**/api/watchlist", async route => {
    if (route.request().method() === "POST") {
      saved = true;
      await route.fulfill({ json: { ok: true, added: 1 } });
    } else {
      const initial = ++reads === 1;
      const observedSaved = saved;
      if (initial) await pendingInitial;
      await route.fulfill({ json: { lists: [{ id: "owned-one", name: "Default", symbols: observedSaved ? [{ symbol: "NVDA" }] : [] }] } });
    }
  });
  await page.getByRole("button", { name: "Inspect NVDA event" }).click();
  const detail = page.getByRole("dialog");
  // Native development StrictMode initializes the external read twice. Keep the
  // older response pending until the user's write has already been verified.
  await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
  await detail.getByRole("button", { name: "Add underlying to watchlist" }).click();
  await expect(detail.getByRole("status")).toContainText("Saved to Default");
  const lateResponse = page.waitForResponse(response => response.url().endsWith("/api/watchlist") && response.request().method() === "GET");
  releaseInitial();
  await lateResponse;
  await expect(detail.getByRole("button", { name: "Already on this watchlist" })).toBeDisabled();
});

// M2/M3/M4: exercise the repaired admission boundary through the real mounted app.
test("duplicate and contradictory source identities cannot inflate investigation activity", async ({ page }) => {
  const good = event("retained-aapl", "AAPL");
  const conflict = event("conflicted-nvda");
  await routeFeed(page, feed([good, { ...good }, conflict, { ...conflict, strike: 201 }, conflict]));
  await openAlpha(page);
  await expect(page.getByTestId("options-alpha-activity-row")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Inspect NVDA event" })).toHaveCount(0);
  await page.getByRole("button", { name: "Inspect AAPL event" }).click();
  await expect(page.getByRole("dialog")).toContainText("retained-aapl");
});

test("fractional availability determines displayed order and retained exact source clocks", async ({ page }) => {
  const older = { ...event("z-older", "AAPL"), available_at: "2026-09-30T14:00:02.000000001Z" };
  const newer = { ...event("a-newer", "NVDA"), available_at: "2026-09-30T14:00:02.000000002Z" };
  const inverted = { ...event("inverted", "SPY"), decision_at: "2026-09-30T14:00:02.000000003Z" };
  await routeFeed(page, feed([older, newer, inverted]));
  await openAlpha(page);
  await expect(page.getByTestId("options-alpha-activity-row")).toHaveCount(2);
  await expect(page.getByTestId("options-alpha-activity-row").first()).toContainText("NVDA");
  await expect(page.getByRole("button", { name: "Inspect SPY event" })).toHaveCount(0);
  await page.getByRole("button", { name: "Inspect NVDA event" }).click();
  const detail = page.getByRole("dialog");
  await detail.locator("summary").click();
  await expect(detail).toContainText("2026-09-30T14:00:02.000000002Z");
});

test("impossible clocks and empty-set quote contradictions never become inspectable measurements", async ({ page }) => {
  const badClock = { ...event("bad-date", "SPY"), observed_at: "2026-02-30T14:00:00Z" };
  const badSet = event("bad-set", "QQQ");
  badSet.microstructure.nbbo_valid_print_count = 0;
  badSet.microstructure.nbbo_print_coverage = 0;
  await routeFeed(page, feed([badClock, badSet, event("healthy", "AAPL")]));
  await openAlpha(page);
  await expect(page.getByTestId("options-alpha-activity-row")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Filter measured activity" }).fill("bad-");
  await expect(page.getByTestId("options-alpha-activity-row")).toHaveCount(0);
  await expect(page.getByTestId("options-alpha-investigation")).toContainText("No measured events match");
  await expect(page.getByTestId("options-alpha-fires-section")).toBeVisible();
});
