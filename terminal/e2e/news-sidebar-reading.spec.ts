import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isolateWatchlistStore } from "./watchlistStore";
import { expectTapTarget } from "./tapTarget";

// News reading sidebar — reading, selection and return evidence for the redesigned
// TickerNewsPanel (sol/web-terminal-news-sidebar-20261018-c4). The local reviewed
// workflow is gone: nothing here marks stories, filters by review state, or writes
// review storage. Screenshot crops are local fixture evidence, not production
// live-data proof.

test.setTimeout(150_000);
// Story times and date separators render in the browser's zone; pin it so crops do
// not depend on the host.
test.use({ timezoneId: "America/New_York" });

const OUT = join(process.cwd(), "docs", "pr-crops", "news-sidebar-reading");
const CROPS = process.env.TERMINAL_CROPS === "1";

const sym = (name: string, zh: string, last: number) => ({
  name, zh, col: "#76b900", last, chg: 1.2, open: last - 2, high: last + 2, low: last - 3, vol: 12000000,
  hi52: last + 20, lo52: last - 80, verdict: null, wr: null, pf: null, cagr: null, regimeBull: null,
  sec: "Equities", mkt: "NASDAQ",
});
const MANIFEST = { symbols: { NVDA: sym("NVIDIA", "英伟达", 175), AAPL: sym("Apple", "苹果", 220), MSFT: sym("Microsoft", "微软", 410) } };

type NewsRow = {
  sequence: number; source: string; source_item_id: string; story_id: string; source_count: number;
  item_count: number; title: string; url: string; teaser: string; published_at: string;
  updated_at: string; received_at: string; universe_revision: string;
};

let seq = 100;
const story = (
  title: string, receivedAt: string,
  extra: Partial<NewsRow> = {},
): NewsRow => {
  seq += 1;
  return {
    sequence: seq,
    source: "benzinga",
    source_item_id: String(seq),
    story_id: `ev2_read_${seq}`,
    source_count: 1,
    item_count: 1,
    title,
    url: `https://www.benzinga.com/news/${seq}`,
    teaser: "",
    published_at: receivedAt,
    updated_at: receivedAt,
    received_at: receivedAt,
    universe_revision: "sp500-r1",
    ...extra,
  };
};

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

// Two sources, two local days (ET), one grouped story.
const GROUPED_STORY = story("Nvidia launches next-generation AI accelerator", "2026-10-05T19:31:01+00:00",
  { item_count: 2, teaser: "The company introduced a new accelerator platform for AI workloads." });
const NVDA_FEED = [
  GROUPED_STORY,
  story("Nvidia supplier expands advanced packaging capacity", "2026-10-05T18:50:01+00:00"),
  story("Analyst note: data-center demand stays ahead of supply", "2026-10-05T15:10:01+00:00", { source: "dowjones" }),
  story("Nvidia reaffirms data-center revenue outlook", "2026-10-04T21:20:01+00:00", { source: "reuters", url: "https://www.reuters.com/technology/nvda-outlook" }),
];
const NVDA_SNAPSHOT = snapshotFor("NVDA", NVDA_FEED);

// Ten stories so the desktop list must scroll inside the panel.
const LONG_FEED = [
  ...NVDA_FEED,
  ...Array.from({ length: 6 }, (_, i) =>
    story(`Nvidia headline number ${i + 1}`, `2026-10-04T1${i}:50:00+00:00`)),
];
const LONG_SNAPSHOT = snapshotFor("NVDA", LONG_FEED);

const AAPL_SNAPSHOT = snapshotFor("AAPL", [
  story("Apple unveils refreshed product lineup", "2026-10-05T19:31:01+00:00"),
]);
const MSFT_SNAPSHOT = snapshotFor("MSFT", [
  story("Microsoft expands cloud AI services", "2026-10-05T19:32:01+00:00"),
]);

type Feed = { nvda: NewsRow[]; nvdaStatus: number };

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

async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, feed: Feed) {
  await isolateWatchlistStore(page, testInfo, baseURL);
  await installEventSourceStub(page);
  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({
    json: { quotes: { NVDA: { last: 180.2, chg: 2.5 }, AAPL: { last: 221.1, chg: 0.9 }, MSFT: { last: 411.4, chg: 1.2 } } },
  }));
  await page.route(/\/api\/news\/NVDA(?:\?.*)?$/, (route) => (feed.nvdaStatus === 200
    ? route.fulfill({ json: snapshotFor("NVDA", feed.nvda) })
    : route.fulfill({ status: feed.nvdaStatus, json: { detail: "service unavailable" } })));
  await page.route(/\/api\/news\/AAPL(?:\?.*)?$/, (route) => route.fulfill({ json: AAPL_SNAPSHOT }));
  await page.route(/\/api\/news\/MSFT(?:\?.*)?$/, (route) => route.fulfill({ json: MSFT_SNAPSHOT }));
  await page.route("**/api/news/stories/**", (route) => route.fulfill({
    json: {
      schema: "ticker_news.story.v1",
      story_id: GROUPED_STORY.story_id,
      source_count: 1,
      item_count: 2,
      members: [
        GROUPED_STORY,
        { ...GROUPED_STORY, source_item_id: "member-b", title: "Nvidia details next-generation AI accelerator platform", source: "reuters", url: "https://www.reuters.com/technology/nvda-accelerator" },
      ],
    },
  }));
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
}

async function setPresentation(page: Page, lang: "en" | "zh", theme: "dark" | "light" = "dark") {
  await page.evaluate((l) => localStorage.setItem("mm.lang", l), lang);
  await page.reload();
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
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

const rows = (panel: Locator) => panel.locator("article[data-story-id]");
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("the reading sidebar is readable across the EN/ZH dark/light viewport matrix", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One controlled project owns the 12-cell screenshot matrix.");
  const feed: Feed = { nvda: NVDA_FEED, nvdaStatus: 200 };
  await prepare(page, testInfo, baseURL, feed);

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
      for (const theme of ["dark", "light"] as const) {
        await setPresentation(page, lang, theme);
        const panel = await openNews(page);
        await expect(panel).toContainText(lang === "zh" ? "新闻" : "News");
        await expect(panel).toContainText("Nvidia launches next-generation AI accelerator");
        // Source labels are house strings, identical across languages.
        await expect(panel).toContainText("Reuters");
        // Both local days carry a separator header.
        await expect(panel.locator("[data-news-date]")).toHaveCount(2);
        expect(await overflow(page)).toBeLessThanOrEqual(1);
        if (CROPS) {
          await page.mouse.move(0, 0);
          await panel.screenshot({ path: join(OUT, `${viewport.size}-${lang}-${theme}.png`), animations: "disabled" });
        }
      }
    }
  }
});

test("reading: source select, grouped disclosure and depth-error retry work in the real rail", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop owns the interaction browser proof.");
  const feed: Feed = { nvda: NVDA_FEED, nvdaStatus: 200 };
  await prepare(page, testInfo, baseURL, feed);
  await setPresentation(page, "en");
  const panel = await openNews(page);

  // ── The source select changes the visible stories and back.
  await expect(rows(panel)).toHaveCount(4);
  await panel.locator("[data-news-source-filter]").selectOption("reuters");
  await expect(rows(panel)).toHaveCount(1);
  await expect(rows(panel).first()).toContainText("Nvidia reaffirms data-center revenue outlook");
  await panel.locator("[data-news-source-filter]").selectOption("");
  await expect(rows(panel)).toHaveCount(4);
  if (CROPS) {
    await panel.screenshot({ path: join(OUT, "source-filtered-desktop-en-dark.png"), animations: "disabled" });
  }

  // ── Grouped coverage expands inside the rail, with safe member links, and collapses.
  await panel.getByRole("button", { name: "2 reports" }).click();
  await expect(panel).toContainText("Nvidia details next-generation AI accelerator platform");
  const memberLink = panel.locator('[role="group"] a', { hasText: "Nvidia details next-generation" });
  await expect(memberLink).toHaveAttribute("href", "https://www.reuters.com/technology/nvda-accelerator");
  await expect(memberLink).toHaveAttribute("target", "_blank");
  await expect(page).toHaveURL(/\/terminal\?symbol=NVDA/);
  if (CROPS) {
    await panel.screenshot({ path: join(OUT, "grouped-open-desktop-en-dark.png"), animations: "disabled" });
  }
  await panel.getByRole("button", { name: "Hide reports" }).click();
  await expect(panel).not.toContainText("Nvidia details next-generation AI accelerator platform");

  // ── A failed depth load shows a visible error; a retry recovers.
  let failStory = true;
  await page.route("**/api/news/stories/**", (route) => (
    failStory ? route.fulfill({ status: 500, json: { detail: "boom" } }) : route.fulfill({
      json: {
        schema: "ticker_news.story.v1",
        story_id: GROUPED_STORY.story_id,
        source_count: 1,
        item_count: 2,
        members: [GROUPED_STORY, { ...GROUPED_STORY, source_item_id: "member-b", title: "Nvidia details next-generation AI accelerator platform", source: "reuters", url: "https://www.reuters.com/technology/nvda-accelerator" }],
      },
    })
  ));
  await panel.getByRole("button", { name: "2 reports" }).click();
  const depthError = panel.locator("[class*='reportError']");
  await expect(depthError).toHaveText("Reports could not be loaded. Try again.");
  failStory = false;
  await panel.getByRole("button", { name: "2 reports" }).click();
  await expect(panel).toContainText("Nvidia details next-generation AI accelerator platform");
  await expect(depthError).toHaveCount(0);
});

test("a ticker change clears stale details and source state and restores them on return", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop owns the symbol-transition browser proof.");
  const feed: Feed = { nvda: NVDA_FEED, nvdaStatus: 200 };
  await prepare(page, testInfo, baseURL, feed);
  await setPresentation(page, "en");
  const panel = await openNews(page);

  // Leave NVDA reading state behind: an expanded group and a source filter.
  await panel.getByRole("button", { name: "2 reports" }).click();
  await expect(panel).toContainText("Nvidia details next-generation AI accelerator platform");
  await panel.locator("[data-news-source-filter]").selectOption("dowjones");
  await expect(rows(panel)).toHaveCount(1);

  // Switch to MSFT through the real symbol search.
  await page.locator(".pair").first().click();
  const input = page.locator(".sh input");
  await expect(input).toBeVisible({ timeout: 20_000 });
  await input.click();
  await page.keyboard.type("Microsoft");
  await expect(page.locator(".sres .r").first()).toBeVisible({ timeout: 20_000 });
  await page.locator(".sres .r").filter({ hasText: /MSFT/i }).locator(".r-opt").click();
  await expect(page.locator(".mm-ptag-sym")).toHaveText("MSFT", { timeout: 30_000 });

  const msftPanel = await openNews(page);
  await expect(msftPanel).toContainText("Microsoft expands cloud AI services");
  // Nothing stale from NVDA survives the change.
  await expect(msftPanel).not.toContainText("Nvidia launches next-generation AI accelerator");
  await expect(msftPanel).not.toContainText("Nvidia details next-generation AI accelerator platform");
  // MSFT serves a single source, so the NVDA source selection cannot survive either.
  await expect(msftPanel.locator("[data-news-source-filter]")).toHaveCount(0);
  expect(await overflow(page)).toBeLessThanOrEqual(1);

  // And returning to NVDA reads fresh: all four stories, unfiltered, collapsed.
  await page.locator(".pair").first().click();
  await input.click();
  await page.keyboard.type("NVIDIA");
  await expect(page.locator(".sres .r").first()).toBeVisible({ timeout: 20_000 });
  await page.locator(".sres .r").filter({ hasText: /NVDA/i }).locator(".r-opt").click();
  await expect(page.locator(".mm-ptag-sym")).toHaveText("NVDA", { timeout: 30_000 });

  const backPanel = await openNews(page);
  await expect(rows(backPanel)).toHaveCount(4);
  await expect(backPanel.locator("[data-news-source-filter]")).toHaveCount(1);
  await expect(backPanel).not.toContainText("Nvidia details next-generation AI accelerator platform");
});

test("the News panel owns the rail: the detail board hides and returns, the list scrolls inside", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop owns the rail geometry proof.");
  const feed: Feed = { nvda: LONG_FEED, nvdaStatus: 200 };
  await prepare(page, testInfo, baseURL, feed);
  await setPresentation(page, "en");

  // While Watchlists shows, the detail board is visible.
  const detailBoard = page.locator(".detail-board");
  await expect(detailBoard).toBeVisible();
  await expect(detailBoard).not.toHaveClass(/rail-hidden/);

  const panel = await openNews(page);
  // News hides the watchlist board AND the detail board, but nothing is unmounted.
  await expect(page.locator(".wl-board")).toHaveClass(/rail-hidden/);
  await expect(detailBoard).toHaveClass(/rail-hidden/);
  await expect(detailBoard).toHaveCount(1);

  // The panel fills the remaining rail-body height: its bottom sits on the rail's
  // content-box edge, it starts right under the rail tabs (one flex gap), and the
  // story list scrolls inside it.
  const geometry = await page.evaluate(() => {
    const bodyEl = document.querySelector(".rail-body")!;
    const body = bodyEl.getBoundingClientRect();
    const bodyStyle = getComputedStyle(bodyEl);
    const board = document.querySelector("#rail-panel-news")!.getBoundingClientRect();
    const tabs = document.querySelector(".rail-tabs")!.getBoundingClientRect();
    const flexGap = parseFloat(bodyStyle.rowGap || bodyStyle.gap) || 0;
    const scroll = document.querySelector('[data-testid="ticker-news-panel"]')!.lastElementChild as HTMLElement;
    return {
      gapBottom: body.bottom - parseFloat(bodyStyle.paddingBottom) - board.bottom,
      gapUnderTabs: board.top - tabs.bottom,
      flexGap,
      innerScroll: scroll.scrollHeight > scroll.clientHeight + 1,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(Math.abs(geometry.gapBottom)).toBeLessThanOrEqual(2);
  expect(Math.abs(geometry.gapUnderTabs - geometry.flexGap)).toBeLessThanOrEqual(2);
  expect(geometry.innerScroll).toBe(true);
  expect(geometry.docOverflow).toBeLessThanOrEqual(1);
  if (CROPS) {
    await panel.screenshot({ path: join(OUT, "full-height-scrolling-desktop-en-dark.png"), animations: "disabled" });
  }

  // Back to Watchlists: the detail board returns with the tab change.
  await page.locator("#rail-tab-watchlists").click();
  await expect(detailBoard).toBeVisible();
  await expect(detailBoard).not.toHaveClass(/rail-hidden/);
});

test("mobile keeps the reading sidebar in natural document flow", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One controlled project owns the viewport sweep.");
  const feed: Feed = { nvda: NVDA_FEED, nvdaStatus: 200 };
  await prepare(page, testInfo, baseURL, feed);
  await setPresentation(page, "en");
  await page.setViewportSize({ width: 390, height: 844 });

  const panel = await openNews(page);
  const flow = await page.evaluate(() => {
    const board = document.querySelector("#rail-panel-news")!.getBoundingClientRect();
    const scroll = document.querySelector('[data-testid="ticker-news-panel"]')!.lastElementChild as HTMLElement;
    return {
      boardScrollsInside: scroll.scrollHeight > scroll.clientHeight + 1,
      boardHeight: board.height,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(flow.boardScrollsInside).toBe(false);
  expect(flow.boardHeight).toBeGreaterThan(200);
  expect(flow.docOverflow).toBeLessThanOrEqual(1);
});

test("reading controls meet the touch floors on tablet and mobile", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "Only the touch projects own the 44px floors.");
  const feed: Feed = { nvda: NVDA_FEED, nvdaStatus: 200 };
  await prepare(page, testInfo, baseURL, feed);
  await page.evaluate(() => localStorage.setItem("mm.lang", "en"));
  await page.reload();
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });

  const panel = await openNews(page);
  await expectTapTarget(panel.locator("[data-news-source-filter]"), { height: 44 });
  await expectTapTarget(panel.getByRole("button", { name: /2 reports/ }), { height: 44 });
  expect(await overflow(page)).toBeLessThanOrEqual(1);
});

test("a failed snapshot shows the failure and never stale or unrelated rows", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop" && testInfo.project.name !== "mobile", "Desktop and mobile own unavailable crops.");
  const feed: Feed = { nvda: NVDA_FEED, nvdaStatus: 503 };
  await prepare(page, testInfo, baseURL, feed);

  const size = testInfo.project.name === "mobile" ? "mobile" : "desktop";
  if (size === "mobile") await page.setViewportSize({ width: 390, height: 844 });
  if (CROPS) mkdirSync(OUT, { recursive: true });

  for (const lang of ["en", "zh"] as const) {
    await setPresentation(page, lang);
    const panel = await openNews(page, "unavailable");
    await expect(panel.getByRole("status")).toContainText(
      lang === "zh" ? "新闻暂时不可用" : "News is temporarily unavailable",
    );
    await expect(rows(panel)).toHaveCount(0);
    // No stale reading chrome from the previous presentation either.
    await expect(panel.locator("[data-news-source-filter]")).toHaveCount(0);
    await expect(panel.locator("[data-news-catchup]")).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    if (CROPS) {
      await panel.screenshot({ path: join(OUT, `unavailable-${size}-${lang}-dark.png`), animations: "disabled" });
    }
  }
});
