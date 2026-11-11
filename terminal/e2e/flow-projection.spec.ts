import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import fixture from "./fixtures/options-r1-w3a-flow.json";
import { makeFlowT } from "@/lib/flowdeskStrings";

// Existing synthetic W3A feed over the real Desk/EventSource/poll consumers.
// This is a projection journey, not live-provider or production acceptance.
const feed = fixture.feed;
const cards = (page: Page) => page.locator('[data-tut="flow-card"]');
const expanded = (page: Page) => page.locator('[data-tut="flow-card"][data-fc-open="1"]');
const projection = (page: Page) => page.locator('[data-flow-projection="r8-v1"]');
const intervalRow = (page: Page, lang: "en" | "zh") =>
  projection(page).locator('[aria-label="' + (lang === "zh" ? "资金流时间投影" : "Flow time projection") + '"]');
const bucketRow = (page: Page, lang: "en" | "zh") =>
  projection(page).locator('[aria-label="' + (lang === "zh" ? "时间桶" : "Flow buckets") + '"]');

async function setup(page: Page, lang: "en" | "zh", mode: "data" | "absent") {
  await page.addInitScript(locale => {
    localStorage.setItem("mm.lang", locale);
    localStorage.setItem("flowdesk.tutorial.seen", "1");
  }, lang);
  const reads = { stream: 0, poll: 0 };
  await page.route(/\/api\/flow(?:\/stream)?\?/, route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("f") !== "feed") return route.continue();
    if (url.pathname.endsWith("/stream")) {
      reads.stream += 1;
      const body = "retry: 3600000\n\ndata: " + JSON.stringify(feed) + "\n\n"
        + (mode === "absent" ? 'event: status\ndata: {"status":"absent"}\n\n' : "");
      return route.fulfill({
        status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" }, body,
      });
    }
    reads.poll += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(feed) });
  });
  return reads;
}

async function reachable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  const hit = await control.evaluate(el => {
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const top = document.elementFromPoint(x, y);
    return { width: box.width, height: box.height, hit: !!top && (top === el || el.contains(top)) };
  });
  expect(hit.width).toBeGreaterThan(0);
  expect(hit.height).toBeGreaterThan(0);
  expect(hit.hit).toBe(true);
  return hit;
}
async function keyboard(control: Locator) {
  await reachable(control);
  await control.focus();
  await control.press("Enter");
}
async function pointer(control: Locator, page: Page) {
  await reachable(control);
  if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) await control.tap();
  else await control.click();
}
async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(name + ".png");
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

for (const lang of ["en", "zh"] as const) {
  test("[" + lang + "] time buckets preserve canonical cards, filters, coverage and inspector", async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const viewport = page.viewportSize();
    const reads = await setup(page, lang, "data");
    await page.goto("/options?tab=desk");
    const coverage = page.getByTestId("flow-coverage");
    await expect(coverage).toBeVisible({ timeout: 45_000 });
    await expect(cards(page)).toHaveCount(9);
    await expect(coverage).toContainText(lang === "zh" ? "88 % 合格权利金已分类 · 12 % 未知" : "88 % of eligible premium classified · 12 % unknown");
    const allLoadedCoverage = await coverage.textContent();
    const intervals = intervalRow(page, lang);
    const buckets = bucketRow(page, lang);
    await expect(intervals.getByRole("button", { name: "15m", exact: true })).toHaveAttribute("aria-pressed", "true");
    await keyboard(intervals.getByRole("button", { name: "5m", exact: true }));
    await expect(intervals.getByRole("button", { name: "5m", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(buckets.getByRole("button")).toHaveText(["10:30 · 1", "10:35 · 6", "10:40 · 2"]);

    // The newest row is e2 (.119Z), ahead of e1 (.117Z). Keyboard activation
    // must reset expansion itself; outside-pointer cleanup cannot hide the bug.
    const newest = cards(page).filter({ hasText: "$216.0K" });
    await keyboard(newest.locator(".obs-fc-expand-btn"));
    await expect(expanded(page)).toHaveCount(1);
    await keyboard(buckets.getByRole("button", { name: "10:35 · 6", exact: true }));
    await expect(cards(page)).toHaveCount(6);
    await expect(expanded(page)).toHaveCount(0);
    const expectedPremiums = ["$355.0K", "$259.2K", "$395.0K", "$266.8K", "$80.0K", "$315.0K"];
    for (const [index, premium] of expectedPremiums.entries()) {
      await expect(cards(page).nth(index)).toContainText(premium);
    }
    await expect(coverage).toHaveText(allLoadedCoverage ?? "");
    await projection(page).scrollIntoViewIfNeeded();
    await capture(page, testInfo, "selected-bucket");

    const clearLabel = lang === "zh" ? "清除时间桶" : "Clear bucket";
    await keyboard(buckets.getByRole("button", { name: clearLabel, exact: true }));
    await expect(cards(page)).toHaveCount(9);
    await expect(expanded(page)).toHaveCount(0);
    const search = page.locator(".obs-fd-center").getByPlaceholder(lang === "zh" ? "搜索标的…" : "Search ticker…");
    await search.fill("AAPL");
    await expect(cards(page)).toHaveCount(8);
    await expect(buckets.getByRole("button")).toHaveText(["10:35 · 6", "10:40 · 2"]);
    await expect(coverage).toHaveText(allLoadedCoverage ?? "");
    await pointer(buckets.getByRole("button", { name: "10:40 · 2", exact: true }), page);
    await expect(cards(page)).toHaveCount(2);
    await expect(cards(page).nth(0)).toContainText("$216.0K");
    await expect(cards(page).nth(1)).toContainText("$504.0K");
    const e1 = cards(page).filter({ hasText: "$504.0K" });
    await pointer(e1, page);
    await expect(e1).toHaveAttribute("aria-selected", "true");

    // Current mobile owner is the horizontally scrollable right rail below the
    // feed. Reach it by ordinary scrolling, keeping the actual viewport fixed.
    const inspector = page.locator('[data-tut="flow-inspector"].has-event');
    await inspector.scrollIntoViewIfNeeded();
    await expect(inspector).toBeVisible();
    const identity = inspector.locator(".obs-print-identity");
    await identity.scrollIntoViewIfNeeded();
    await expect(identity).toBeInViewport();
    await expect(identity).toContainText("AAPL 230 C");
    const premium = inspector.locator(".obs-print-premium");
    await premium.scrollIntoViewIfNeeded();
    await expect(premium).toBeInViewport();
    await expect(premium).toContainText("$504,000 = 6,000 × $0.84 × 100");
    await expect(inspector.getByTestId("flow-print-inspector")).toContainText(lang === "zh" ? "选定成交明细" : "SELECTED PRINT");
    await capture(page, testInfo, "selected-print-inspector");

    await keyboard(intervals.getByRole("button", { name: "15m", exact: true }));
    await expect(cards(page)).toHaveCount(8);
    await expect(search).toHaveValue("AAPL");
    await expect(buckets.getByRole("button")).toHaveText(["10:30 · 8"]);
    await expect(coverage).toHaveText(allLoadedCoverage ?? "");
    await search.fill("");
    await expect(cards(page)).toHaveCount(9);
    await expect(buckets.getByRole("button")).toHaveText(["10:30 · 9"]);
    await expect(coverage).toHaveText(allLoadedCoverage ?? "");
    await expect(expanded(page)).toHaveCount(0);
    await projection(page).scrollIntoViewIfNeeded();
    await capture(page, testInfo, "restored-tape");
    expect(page.viewportSize()).toEqual(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    expect(reads.stream).toBeGreaterThan(0);
    await testInfo.attach("journey", {
      body: Buffer.from(JSON.stringify({ lang, viewport, fixture: "options-r1-w3a-flow.json", reads, allLoadedCoverage, expectedPremiums, pageErrors: errors }, null, 2)),
      contentType: "application/json",
    });
  });

  test("[" + lang + "] a held feed keeps its reason and projection over the last read", async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const viewport = page.viewportSize();
    const reads = await setup(page, lang, "absent");
    await page.goto("/options?tab=desk");
    const note = page.getByTestId("flowfeed-refresh-absent");
    await expect(note).toBeVisible({ timeout: 45_000 });
    await expect(note).toHaveAttribute("role", "status");
    await expect(note).toHaveText(makeFlowT(lang)("feedRefreshAbsent"));
    await expect(note.getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("flowfeed-refresh-failed")).toHaveCount(0);
    await expect(page.getByTestId("flowfeed-absent")).toHaveCount(0);
    await expect(cards(page)).toHaveCount(9);
    const coverage = page.getByTestId("flow-coverage");
    const before = await coverage.textContent();
    await keyboard(intervalRow(page, lang).getByRole("button", { name: "5m", exact: true }));
    await pointer(bucketRow(page, lang).getByRole("button", { name: "10:35 · 6", exact: true }), page);
    await expect(cards(page)).toHaveCount(6);
    await expect(coverage).toHaveText(before ?? "");
    await expect(note).toHaveText(makeFlowT(lang)("feedRefreshAbsent"));
    await projection(page).scrollIntoViewIfNeeded();
    await capture(page, testInfo, "held-projection");
    expect(page.viewportSize()).toEqual(viewport);
    expect(errors).toEqual([]);
    expect(reads.stream).toBeGreaterThan(0);
    await testInfo.attach("held-journey", {
      body: Buffer.from(JSON.stringify({ lang, viewport, reads, retainedFeedCount: 9, selectedCount: 6, coverage: before, pageErrors: errors }, null, 2)),
      contentType: "application/json",
    });
  });
}
