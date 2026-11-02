import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { NEWS_VIEW } from "../lib/__tests__/fixtures/newsEditorial";
import { isolateWatchlistStore } from "./watchlistStore";

/**
 * The current News reading slice (PR1207 lane).
 *
 * Three claims, all about the SHELL's behaviour on routed fixture rows:
 *   1. the panel owns the rail column while News is the active source;
 *   2. the company card yields that column without being unmounted, and comes
 *      back when News is left;
 *   3. the phone's "Symbol details" action leaves News first, so the dossier is
 *      the visible target of its scroll.
 *
 * The rows are fixtures: they prove the shell, never the feed, and they never
 * touch a real reader's review or saved-basis state.
 */
test.setTimeout(120_000);

const ACTION = { timeout: 30_000 };

const MANIFEST = {
  symbols: {
    NVDA: {
      name: "NVIDIA",
      zh: "英伟达",
      col: "#76b900",
      last: 175,
      chg: 1.2,
      open: 173,
      high: 177,
      low: 172,
      vol: 12000000,
      hi52: 195,
      lo52: 90,
      verdict: null,
      wr: null,
      pf: null,
      cagr: null,
      regimeBull: null,
      sec: "Equities",
      mkt: "NASDAQ",
    },
  },
};

const ROWS = [
  {
    sequence: 11,
    source: "benzinga",
    source_item_id: "101",
    story_id: "ev2_read_launch",
    source_count: 1,
    item_count: 2,
    title: "Nvidia launches next-generation AI accelerator",
    url: "https://www.benzinga.com/news/101",
    teaser: "The company introduced a new accelerator platform for AI workloads.",
    published_at: "2026-10-05T19:30:00+00:00",
    updated_at: "2026-10-05T19:31:00+00:00",
    received_at: "2026-10-05T19:31:01+00:00",
    universe_revision: "sp500-r1",
    content_kind: "reporting" as const,
  },
  {
    sequence: 10,
    source: "benzinga",
    source_item_id: "100",
    story_id: "ev2_read_supply",
    source_count: 1,
    item_count: 1,
    title: "Nvidia supplier expands advanced packaging capacity",
    url: "https://www.benzinga.com/news/100",
    teaser: "",
    published_at: "2026-10-05T18:50:00+00:00",
    updated_at: "2026-10-05T18:50:00+00:00",
    received_at: "2026-10-05T18:50:01+00:00",
    universe_revision: "sp500-r1",
    content_kind: "reporting" as const,
  },
];

const SNAPSHOT = {
  schema: "ticker_news.snapshot.v1",
  editorial_policy: "ticker_news.curated.v1",
  editorial_view: NEWS_VIEW,
  change_sequence: 11,
  ticker: "NVDA",
  security_id: "SEC:US-XNAS-NVDA",
  state: "live",
  rows: ROWS.map((row) => ({ ...row, editorial_view: NEWS_VIEW })),
  next_cursor: 10,
  has_more: false,
  source_health: {
    state: "live",
    last_successful_catchup: "2026-10-05T19:31:01+00:00",
  },
};

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
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      writable: true,
      value: QuietEventSource,
    });
  });
}

async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined) {
  await isolateWatchlistStore(page, testInfo, baseURL);
  await installEventSourceStub(page);

  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({
    json: { quotes: { NVDA: { last: 180.2, chg: 2.5 } } },
  }));
  await page.route(/\/api\/news\/NVDA(?:\?.*)?$/, (route) => route.fulfill({ json: SNAPSHOT }));

  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible(ACTION);
}

async function openNews(page: Page) {
  const tab = page.locator("#rail-tab-news");
  await tab.scrollIntoViewIfNeeded();
  await expect(tab).toBeVisible(ACTION);
  await tab.click();
  const panel = page.getByTestId("ticker-news-panel");
  await panel.scrollIntoViewIfNeeded();
  await expect(panel).toBeVisible(ACTION);
  await expect(panel).toHaveAttribute("data-news-state", "live");
  return panel;
}

async function press(target: Locator, testInfo: TestInfo) {
  if (testInfo.project.use.hasTouch) await target.tap(ACTION);
  else await target.click(ACTION);
}

/** The panel's box against the column it lives in. */
async function columnBoxes(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-testid="ticker-news-panel"]');
    const parent = panel?.parentElement ?? null;
    if (!panel || !parent) return null;
    const p = panel.getBoundingClientRect();
    const b = parent.getBoundingClientRect();
    return {
      parentClass: String(parent.className),
      panel: { top: p.top, bottom: p.bottom, height: p.height },
      column: { top: b.top, bottom: b.bottom, height: b.height },
    };
  });
}

async function documentOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** The panel's own box model: how it takes (or refuses) the column. */
async function panelStyle(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="ticker-news-panel"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { flex: cs.flex, height: cs.height, maxHeight: cs.maxHeight };
  });
}

test.describe("News reading slice", () => {
  test("the panel owns the rail column while News is the active source", async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop",
      "the column is a desktop layout; at 860px and below the panel is in the document's own flow.");
    await prepare(page, testInfo, baseURL);
    await openNews(page);

    // The company card yields the column. It stays mounted — only its box is gone.
    const card = page.locator(".detail-board");
    await expect(card).toHaveCount(1);
    await expect(card).toBeHidden();

    const boxes = await columnBoxes(page);
    expect(boxes, "the panel and its column must be measurable").not.toBeNull();
    expect(boxes!.parentClass).toContain("rail-body");
    // The panel fills the column it is in: the rail's own padding is the only slack.
    expect(boxes!.panel.height).toBeGreaterThan(boxes!.column.height * 0.9);
    expect(boxes!.column.bottom - boxes!.panel.bottom).toBeLessThanOrEqual(16);

    // The reading controls are the column's content.
    await expect(page.locator("select[data-news-view-select]")).toBeVisible();
    await expect(page.locator("[data-news-headline]").first()).toBeVisible();
    await expect(page.locator("[data-news-ladder]").first()).toBeVisible();

    expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("the company card comes back when News is left", async ({ page, baseURL }, testInfo) => {
    await prepare(page, testInfo, baseURL);

    const card = page.locator(".detail-board");
    await expect(card).toBeVisible(ACTION);

    await openNews(page);
    await expect(card).toHaveCount(1);
    await expect(card).toBeHidden();
    await expect(page.getByTestId("ticker-news-panel")).toBeVisible();

    // At 860px and below the panel keeps the page's own scrolling: intrinsic height,
    // no inner scroll cap. Above it, the panel takes the column.
    const style = await panelStyle(page);
    expect(style, "the panel's computed style must be readable").not.toBeNull();
    if (testInfo.project.name === "desktop") {
      expect(style!.flex).toMatch(/^1\b/);
    } else {
      expect(style!.flex).toBe("0 0 auto");
      expect(style!.maxHeight).toBe("none");
    }

    // Leaving News for the watchlists restores the company card and unmounts the panel.
    const watchlists = page.locator("#rail-tab-watchlists");
    await watchlists.scrollIntoViewIfNeeded();
    await watchlists.click();
    await expect(card).toBeVisible(ACTION);
    await expect(page.getByTestId("ticker-news-panel")).toHaveCount(0);

    expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("the phone's Symbol details leaves News and reveals the dossier", async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "the Analysis hub is a phone surface.");
    await prepare(page, testInfo, baseURL);
    await openNews(page);

    const card = page.locator(".detail-board");
    await expect(card).toHaveCount(1);
    await expect(card).toBeHidden();

    await press(page.getByTestId("roller-more"), testInfo);
    const hub = page.getByTestId("analysis-hub");
    await expect(hub).toBeVisible(ACTION);
    await press(hub.getByTestId("hub-tile-symbolDetails"), testInfo);
    await expect(hub).toHaveCount(0, ACTION);

    // News is left: the watchlists source is active again and the dossier is back.
    await expect(page.locator("#rail-tab-watchlists")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("ticker-news-panel")).toHaveCount(0);
    await expect(card).toBeVisible(ACTION);

    // The dossier is the target of the scroll, not a hidden box.
    await expect.poll(async () => {
      const box = await card.boundingBox();
      const viewport = page.viewportSize();
      if (!box || !viewport) return null;
      return box.y < viewport.height && box.y + box.height > 0;
    }, { message: "the dossier should be scrolled into view", timeout: 20_000 }).toBe(true);

    expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
  });
});
