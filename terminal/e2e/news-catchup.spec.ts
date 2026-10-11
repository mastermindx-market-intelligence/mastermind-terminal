import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { e2eWatchlistOwner, isolateWatchlistStore } from "./watchlistStore";
import { expectTapTarget } from "./tapTarget";

// E13 — News catch-up. A returning user sees which company stories are new, which were revised
// or regrouped since their review, and which are unchanged — over the real `/api/news/<SYM>`
// snapshot contract, in the real signed-in Terminal shell (fixture identity from `mm_e2e_wl`).

test.setTimeout(150_000);
// Story times render in the browser's zone; pin it so crops do not depend on the host.
test.use({ timezoneId: "America/New_York" });

const OUT = join(process.cwd(), "docs", "pr-crops", "news-catchup");
const CROPS = process.env.TERMINAL_CROPS === "1";
const REVIEW_KEY = "mm.newsReview.v1";

const sym = (name: string, zh: string, last: number) => ({
  name, zh, col: "#76b900", last, chg: 1.2, open: last - 2, high: last + 2, low: last - 3, vol: 12000000,
  hi52: last + 20, lo52: last - 80, verdict: null, wr: null, pf: null, cagr: null, regimeBull: null,
  sec: "Equities", mkt: "NASDAQ",
});
const MANIFEST = { symbols: { NVDA: sym("NVIDIA", "英伟达", 175), AAPL: sym("Apple", "苹果", 220) } };

type NewsRow = {
  sequence: number; source: string; source_item_id: string; story_id: string; source_count: number;
  item_count: number; title: string; url: string; teaser: string; published_at: string;
  updated_at: string; received_at: string; universe_revision: string;
};

const story = (
  sequence: number, storyId: string, title: string, receivedAt: string,
  extra: Partial<NewsRow> = {},
): NewsRow => ({
  sequence,
  source: "benzinga",
  source_item_id: String(100 + sequence),
  story_id: storyId,
  source_count: 1,
  item_count: 1,
  title,
  url: `https://www.benzinga.com/news/${100 + sequence}`,
  teaser: "",
  published_at: receivedAt,
  updated_at: receivedAt,
  received_at: receivedAt,
  universe_revision: "sp500-r1",
  ...extra,
});

const snapshotFor = (ticker: string, rows: NewsRow[]) => ({
  schema: "ticker_news.snapshot.v1",
  ticker,
  security_id: `SEC:US-XNAS-${ticker}`,
  state: "live",
  rows,
  next_cursor: rows[rows.length - 1]?.sequence ?? null,
  has_more: false,
  source_health: { state: "live", last_successful_catchup: rows[0]?.received_at ?? null },
});

// First visit: three stories from two sources.
const FIRST_VISIT = snapshotFor("NVDA", [
  story(11, "ev2_nvda_launch", "Nvidia launches next-generation AI accelerator", "2026-10-05T19:31:01+00:00",
    { item_count: 2, teaser: "The company introduced a new accelerator platform for AI workloads." }),
  story(10, "ev2_nvda_supply", "Nvidia supplier expands advanced packaging capacity", "2026-10-05T18:50:01+00:00"),
  story(9, "ev2_nvda_guidance", "Nvidia reaffirms data-center revenue outlook", "2026-10-05T18:20:01+00:00",
    { source: "reuters", url: "https://www.reuters.com/technology/nvda-outlook" }),
]);

// The return: one correction, one regrouped story, one brand-new event, one late arrival
// (older sequence and older time than the user's last full read), one unchanged story.
const RETURN_VISIT = snapshotFor("NVDA", [
  story(15, "ev2_nvda_export", "Nvidia receives export license for data-center chips", "2026-10-06T13:05:01+00:00"),
  story(14, "ev2_nvda_launch", "Nvidia launches next-generation AI accelerator, shipping in Q1", "2026-10-06T12:40:01+00:00",
    { item_count: 2, teaser: "Corrected: shipments begin in the first quarter." }),
  story(13, "ev2_nvda_guidance", "Nvidia reaffirms data-center revenue outlook", "2026-10-06T11:15:01+00:00",
    { source: "reuters", item_count: 2, url: "https://www.reuters.com/technology/nvda-outlook" }),
  story(12, "ev2_nvda_analyst", "Analyst note: data-center demand stays ahead of supply", "2026-10-05T17:10:01+00:00"),
  story(10, "ev2_nvda_supply", "Nvidia supplier expands advanced packaging capacity", "2026-10-05T18:50:01+00:00"),
]);

const AAPL_SNAPSHOT = snapshotFor("AAPL", [
  story(21, "ev2_aapl_lineup", "Apple unveils refreshed product lineup", "2026-10-05T19:31:01+00:00"),
]);

type Feed = { nvda: ReturnType<typeof snapshotFor>; nvdaStatus: number };

async function installEventSourceStub(page: Page) {
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource;
    class QuietEventSource {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string = "";
      readonly withCredentials = false;
      readyState = 1;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor(url: string | URL, options?: EventSourceInit) {
        const value = String(url);
        if (!value.includes("/api/news/stream")) {
          return new NativeEventSource(url, options) as unknown as QuietEventSource;
        }
        this.url = value;
      }
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() { return true; }
      close() { this.readyState = QuietEventSource.CLOSED; }
    }
    Object.defineProperty(window, "EventSource", { configurable: true, writable: true, value: QuietEventSource });
  });
}

/** Serves the feed from `feed`, so a test can change what the source returns between visits. */
async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, feed: Feed) {
  const storeKey = await isolateWatchlistStore(page, testInfo, baseURL);
  await installEventSourceStub(page);
  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({
    json: { quotes: { NVDA: { last: 180.2, chg: 2.5 }, AAPL: { last: 221.1, chg: 0.9 } } },
  }));
  await page.route(/\/api\/news\/NVDA(?:\?.*)?$/, (route) => (feed.nvdaStatus === 200
    ? route.fulfill({ json: feed.nvda })
    : route.fulfill({ status: feed.nvdaStatus, json: { detail: "service unavailable" } })));
  await page.route(/\/api\/news\/AAPL(?:\?.*)?$/, (route) => route.fulfill({ json: AAPL_SNAPSHOT }));
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  return storeKey;
}

async function setPresentation(page: Page, lang: "en" | "zh") {
  await page.evaluate((l) => localStorage.setItem("mm.lang", l), lang);
  await page.reload();
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
}

async function visit(page: Page, symbol: string) {
  await page.goto(`/terminal?symbol=${symbol}`);
  await expect(page.locator(".mm-ptag-sym")).toHaveText(symbol, { timeout: 60_000 });
}

async function openNews(page: Page, expectedState = "live") {
  const tab = page.locator("#rail-tab-news");
  await tab.scrollIntoViewIfNeeded();
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
  const panel = page.getByTestId("ticker-news-panel");
  await panel.scrollIntoViewIfNeeded();
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel).toHaveAttribute("data-news-state", expectedState, { timeout: 20_000 });
  return panel;
}

const reviewOf = (panel: Locator, id: string) => panel.locator(`article[data-story-id="${id}"]`);
const storyIds = (panel: Locator) =>
  panel.locator("article[data-story-id]").evaluateAll((els) => els.map((el) => el.getAttribute("data-story-id")));
const storedReview = (page: Page) => page.evaluate((key) => localStorage.getItem(key), REVIEW_KEY);

test("a returning user sees new and updated company stories, private to their account", async ({ page, baseURL }, testInfo) => {
  const feed: Feed = { nvda: FIRST_VISIT, nvdaStatus: 200 };
  const storeKey = await prepare(page, testInfo, baseURL, feed);
  const owner = e2eWatchlistOwner(storeKey);
  await setPresentation(page, "en");

  // ── First visit: everything is new; review it all.
  let panel = await openNews(page);
  const summary = panel.locator("[data-news-catchup-summary]");
  await expect(summary).toHaveText("3 new · 0 updated", { timeout: 20_000 });
  await expect(panel.locator('article[data-news-review="new"]')).toHaveCount(3);
  if (testInfo.project.name !== "desktop") {
    // Tablet (820px) and phone both sit under the 860px touch breakpoint.
    await expectTapTarget(panel.locator("[data-news-mark-shown]"), { height: 44 });
    await expectTapTarget(panel.locator('[data-news-filter="new"]'), { height: 44 });
    await expectTapTarget(panel.locator("[data-news-source-filter]"), { height: 44 });
    await expectTapTarget(reviewOf(panel, "ev2_nvda_launch").locator("[data-news-mark-one]"), { height: 44 });
  }
  await panel.locator("[data-news-mark-shown]").click();
  await expect(summary).toHaveText("All shown stories reviewed");
  await expect(panel.locator("[data-news-review-receipt]")).toContainText("Last full read");
  await expect(panel.locator("[data-news-mark-one]")).toHaveCount(0);

  // ── Leave for another company; its stories are untouched by the NVDA review.
  await visit(page, "AAPL");
  panel = await openNews(page);
  await expect(reviewOf(panel, "ev2_aapl_lineup")).toHaveAttribute("data-news-review", "new", { timeout: 20_000 });

  // ── Return after the source corrected, regrouped and added stories.
  feed.nvda = RETURN_VISIT;
  await visit(page, "NVDA");
  panel = await openNews(page);
  await expect(panel.locator("[data-news-catchup-summary]")).toHaveText("2 new · 2 updated", { timeout: 20_000 });
  await expect(reviewOf(panel, "ev2_nvda_export")).toHaveAttribute("data-news-review", "new");
  await expect(reviewOf(panel, "ev2_nvda_analyst")).toHaveAttribute("data-news-review", "new");
  await expect(reviewOf(panel, "ev2_nvda_launch")).toHaveAttribute("data-news-review", "updated");
  await expect(reviewOf(panel, "ev2_nvda_launch").locator("[data-news-change]")).toHaveText("Revised since your review");
  await expect(reviewOf(panel, "ev2_nvda_guidance")).toHaveAttribute("data-news-review", "updated");
  await expect(reviewOf(panel, "ev2_nvda_guidance").locator("[data-news-change]")).toHaveText("1 more report since your review");
  await expect(reviewOf(panel, "ev2_nvda_supply")).toHaveAttribute("data-news-review", "reviewed");

  // ── Filters: review state, and the source field the feed supplies.
  await panel.locator('[data-news-filter="updated"]').click();
  expect(await storyIds(panel)).toEqual(["ev2_nvda_launch", "ev2_nvda_guidance"]);
  await panel.locator('[data-news-filter="new"]').click();
  expect(await storyIds(panel)).toEqual(["ev2_nvda_export", "ev2_nvda_analyst"]);
  await panel.locator('[data-news-filter="all"]').click();
  await panel.locator("[data-news-source-filter]").selectOption("reuters");
  expect(await storyIds(panel)).toEqual(["ev2_nvda_guidance"]);
  await panel.locator("[data-news-source-filter]").selectOption("");
  expect(await storyIds(panel)).toHaveLength(5);

  // ── Review one correction; the other updates stay unread.
  await reviewOf(panel, "ev2_nvda_launch").locator("[data-news-mark-one]").click();
  await expect(reviewOf(panel, "ev2_nvda_launch")).toHaveAttribute("data-news-review", "reviewed");
  await expect(panel.locator("[data-news-catchup-summary]")).toHaveText("2 new · 1 updated");
  // The story itself is exactly as the source sent it.
  await expect(reviewOf(panel, "ev2_nvda_launch").locator("[data-news-headline]"))
    .toHaveText("Nvidia launches next-generation AI accelerator, shipping in Q1");

  // ── A failed load shows the failure and moves nothing.
  const beforeFailure = await storedReview(page);
  feed.nvdaStatus = 503;
  await page.reload();
  panel = await openNews(page, "unavailable");
  await expect(panel.locator("[data-news-catchup]")).toHaveCount(0);
  await expect(panel.locator("[data-news-mark-one]")).toHaveCount(0);
  expect(await storedReview(page)).toBe(beforeFailure);

  // ── Another account on the same browser sees none of this account's review.
  feed.nvdaStatus = 200;
  const otherKey = `${storeKey.slice(0, 100)}-other`;
  await page.context().addCookies([{ name: "mm_e2e_wl", value: otherKey, url: baseURL ?? "http://127.0.0.1:3108" }]);
  await page.reload();
  panel = await openNews(page);
  await expect(panel.locator("[data-news-catchup-summary]")).toHaveText("5 new · 0 updated", { timeout: 20_000 });
  const envelope = JSON.parse((await storedReview(page)) ?? "{}");
  expect(Object.keys(envelope)).toEqual([owner]);
  expect(JSON.stringify(envelope)).not.toContain("Nvidia");

  // ── And the first account's review is still there when it comes back.
  await page.context().addCookies([{ name: "mm_e2e_wl", value: storeKey, url: baseURL ?? "http://127.0.0.1:3108" }]);
  await page.reload();
  panel = await openNews(page);
  await expect(panel.locator("[data-news-catchup-summary]")).toHaveText("2 new · 1 updated", { timeout: 20_000 });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("news catch-up is readable across the EN/ZH desktop/tablet/mobile matrix", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One controlled project owns the 6-cell screenshot matrix.");
  const feed: Feed = { nvda: FIRST_VISIT, nvdaStatus: 200 };
  await prepare(page, testInfo, baseURL, feed);
  await setPresentation(page, "en");
  const first = await openNews(page);
  await expect(first.locator("[data-news-catchup-summary]")).toHaveText("3 new · 0 updated", { timeout: 20_000 });
  await first.locator("[data-news-mark-shown]").click();
  await expect(first.locator("[data-news-catchup-summary]")).toHaveText("All shown stories reviewed");
  feed.nvda = RETURN_VISIT;

  const cells = [
    { width: 1440, height: 900, size: "desktop" },
    { width: 820, height: 1180, size: "tablet" },
    { width: 390, height: 844, size: "mobile" },
  ] as const;
  if (CROPS) {
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
  }
  for (const viewport of cells) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const lang of ["en", "zh"] as const) {
      await setPresentation(page, lang);
      const panel = await openNews(page);
      await expect(panel.locator("[data-news-catchup-summary]")).toHaveText(
        lang === "zh" ? "2 条新 · 2 条更新" : "2 new · 2 updated",
        { timeout: 20_000 },
      );
      await expect(reviewOf(panel, "ev2_nvda_launch").locator("[data-news-change]")).toHaveText(
        lang === "zh" ? "阅读后已修订" : "Revised since your review",
      );
      await expect(panel.locator('[data-news-filter="updated"]')).toContainText(lang === "zh" ? "更新" : "Updated");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      if (CROPS) {
        await page.mouse.move(0, 0);
        await panel.screenshot({ path: join(OUT, `${viewport.size}-${lang}-dark.png`), animations: "disabled" });
      }
    }
  }
});
