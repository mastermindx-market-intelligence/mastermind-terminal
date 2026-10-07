import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isolateWatchlistStore } from "./watchlistStore";

test.setTimeout(120_000);

const OUT = join(process.cwd(), "docs", "pr-crops", "ticker-news");
const CROPS = process.env.TERMINAL_CROPS === "1";

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
    AAPL: {
      name: "Apple",
      zh: "苹果",
      col: "#555555",
      last: 220,
      chg: 0.8,
      open: 218,
      high: 222,
      low: 217,
      vol: 8000000,
      hi52: 240,
      lo52: 160,
      verdict: null,
      wr: null,
      pf: null,
      cagr: null,
      regimeBull: null,
      sec: "Equities",
      mkt: "NASDAQ",
    },
    MSFT: {
      name: "Microsoft",
      zh: "微软",
      col: "#0078d4",
      last: 410,
      chg: 1.1,
      open: 405,
      high: 412,
      low: 404,
      vol: 5000000,
      hi52: 450,
      lo52: 300,
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

type NewsRow = {
  sequence: number;
  source: string;
  source_item_id: string;
  story_id: string;
  source_count: number;
  item_count: number;
  title: string;
  url: string;
  teaser: string;
  published_at: string;
  updated_at: string;
  received_at: string;
  universe_revision: string;
};

function snapshotFor(ticker: string, rows: NewsRow[]) {
  return {
    schema: "ticker_news.snapshot.v1",
    ticker,
    security_id: `SEC:US-XNAS-${ticker}`,
    state: "live",
    rows,
    next_cursor: rows[rows.length - 1]?.sequence ?? null,
    has_more: false,
    source_health: {
      state: "live",
      last_successful_catchup: "2026-10-05T19:31:01+00:00",
    },
  };
}

const SNAPSHOT = snapshotFor("NVDA", [
  {
    sequence: 11,
    source: "benzinga",
    source_item_id: "101",
    story_id: "ev2_nvda_launch",
    source_count: 1,
    item_count: 2,
    title: "Nvidia launches next-generation AI accelerator",
    url: "https://www.benzinga.com/news/101",
    teaser: "The company introduced a new accelerator platform for AI workloads.",
    published_at: "2026-10-05T19:30:00+00:00",
    updated_at: "2026-10-05T19:31:00+00:00",
    received_at: "2026-10-05T19:31:01+00:00",
    universe_revision: "sp500-r1",
  },
  {
    sequence: 10,
    source: "benzinga",
    source_item_id: "100",
    story_id: "ev2_nvda_supply",
    source_count: 1,
    item_count: 1,
    title: "Nvidia supplier expands advanced packaging capacity",
    url: "https://www.benzinga.com/news/100",
    teaser: "",
    published_at: "2026-10-05T18:50:00+00:00",
    updated_at: "2026-10-05T18:50:00+00:00",
    received_at: "2026-10-05T18:50:01+00:00",
    universe_revision: "sp500-r1",
  },
]);

const AAPL_SNAPSHOT = snapshotFor("AAPL", [
  {
    sequence: 21,
    source: "benzinga",
    source_item_id: "201",
    story_id: "ev2_aapl_grp",
    source_count: 1,
    item_count: 2,
    title: "Apple unveils refreshed product lineup",
    url: "https://www.benzinga.com/news/201",
    teaser: "The company refreshed several hardware lines.",
    published_at: "2026-10-05T19:30:00+00:00",
    updated_at: "2026-10-05T19:31:00+00:00",
    received_at: "2026-10-05T19:31:01+00:00",
    universe_revision: "sp500-r1",
  },
]);

const MSFT_SNAPSHOT = snapshotFor("MSFT", [
  {
    sequence: 31,
    source: "benzinga",
    source_item_id: "301",
    story_id: "ev2_msft_grp",
    source_count: 1,
    item_count: 2,
    title: "Microsoft expands cloud AI services",
    url: "https://www.benzinga.com/news/301",
    teaser: "The company added new AI capacity to its cloud regions.",
    published_at: "2026-10-05T19:32:00+00:00",
    updated_at: "2026-10-05T19:33:00+00:00",
    received_at: "2026-10-05T19:33:01+00:00",
    universe_revision: "sp500-r1",
  },
]);

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
        (window as unknown as { __mmTickerNewsStream?: string }).__mmTickerNewsStream = value;
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

async function prepare(page: Page, testInfo: TestInfo, baseURL?: string, symbol = "NVDA") {
  await isolateWatchlistStore(page, testInfo, baseURL);
  await installEventSourceStub(page);

  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({
    json: {
      quotes: {
        NVDA: { last: 180.2, chg: 2.5 },
        AAPL: { last: 221.1, chg: 0.9 },
        MSFT: { last: 411.4, chg: 1.2 },
      },
    },
  }));
  await page.route(/\/api\/news\/NVDA(?:\?.*)?$/, (route) => route.fulfill({ json: SNAPSHOT }));
  await page.route(/\/api\/news\/AAPL(?:\?.*)?$/, (route) => route.fulfill({ json: AAPL_SNAPSHOT }));
  await page.route(/\/api\/news\/MSFT(?:\?.*)?$/, (route) => route.fulfill({ json: MSFT_SNAPSHOT }));
  await page.route("**/api/news/stories/ev2_nvda_launch", (route) => route.fulfill({
    json: {
      schema: "ticker_news.story.v1",
      story_id: "ev2_nvda_launch",
      source_count: 1,
      item_count: 2,
      members: [
        SNAPSHOT.rows[0],
        {
          ...SNAPSHOT.rows[0],
          sequence: 9,
          source_item_id: "101b",
          title: "Nvidia details next-generation AI accelerator platform",
        },
      ],
    },
  }));
  await page.route("**/api/news/stories/ev2_aapl_grp", (route) => route.fulfill({
    json: {
      schema: "ticker_news.story.v1",
      story_id: "ev2_aapl_grp",
      source_count: 1,
      item_count: 2,
      members: [AAPL_SNAPSHOT.rows[0], { ...AAPL_SNAPSHOT.rows[0], sequence: 20, title: "Apple product refresh details" }],
    },
  }));
  await page.route("**/api/news/stories/ev2_msft_grp", (route) => route.fulfill({
    json: {
      schema: "ticker_news.story.v1",
      story_id: "ev2_msft_grp",
      source_count: 1,
      item_count: 2,
      members: [MSFT_SNAPSHOT.rows[0], { ...MSFT_SNAPSHOT.rows[0], sequence: 30, title: "Microsoft cloud AI expansion details" }],
    },
  }));

  await page.goto(`/terminal?symbol=${symbol}`);
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
}

async function setPresentation(page: Page, lang: "en" | "zh") {
  await page.evaluate((l) => {
    localStorage.setItem("mm.lang", l);
  }, lang);
  await page.reload();
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
}

async function openNews(page: Page, expectedState = "live") {
  const tab = page.locator("#rail-tab-news");
  await tab.scrollIntoViewIfNeeded();
  await expect(tab).toBeVisible();
  await tab.click();
  const panel = page.getByTestId("ticker-news-panel");
  await panel.scrollIntoViewIfNeeded();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-news-state", expectedState);
  return panel;
}

async function pickSymbol(page: Page, testInfo: TestInfo, symbol: string, searchText: string) {
  const desktop = testInfo.project.name === "desktop";
  if (desktop) await page.locator(".pair").first().click();
  else await page.locator(".m-symbar").click();

  const input = page.locator(".sh input");
  await expect(input).toBeVisible({ timeout: 20_000 });
  await input.click();
  await page.keyboard.type(searchText);
  await expect(page.locator(".sres .r").first()).toBeVisible({ timeout: 20_000 });
  await page.locator(".sres .r").filter({ hasText: new RegExp(symbol, "i") }).locator(".r-opt").click();
  await expect(page.locator(".mm-ptag-sym")).toHaveText(symbol, { timeout: 30_000 });
}

test("ticker News rail is readable across EN/ZH desktop/tablet/mobile matrix", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One controlled project owns the 8-cell screenshot matrix.");
  await prepare(page, testInfo, baseURL);

  const cells = [
    { width: 1440, height: 900, size: "desktop" },
    { width: 820, height: 1180, size: "tablet" },
    { width: 390, height: 844, size: "mobile" },
  ] as const;
  const languages = ["en", "zh"] as const;
  if (CROPS) {
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
  }

  for (const viewport of cells) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const lang of languages) {
      await setPresentation(page, lang);
        const panel = await openNews(page);

        await expect(panel).toContainText(lang === "zh" ? "新闻" : "News");
        await expect(panel).toContainText("Nvidia launches next-generation AI accelerator");
        await expect(panel).toContainText("Benzinga");
        await expect(panel.locator("[data-news-headline]").first()).toHaveAttribute(
          "href",
          "https://www.benzinga.com/news/101",
        );
        await expect(panel.getByRole("button", {
          name: lang === "zh" ? "2 条报道" : "2 reports",
        })).toBeVisible();

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);

        const streamUrl = await page.evaluate(
          () => (window as unknown as { __mmTickerNewsStream?: string }).__mmTickerNewsStream ?? "",
        );
        expect(streamUrl).toContain("symbol=NVDA");

        if (CROPS) {
          await panel.screenshot({
            path: join(OUT, `${viewport.size}-${lang}-dark.png`),
          });
        }
    }
  }
});

test("unavailable snapshot renders without rail overflow", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop" && testInfo.project.name !== "mobile", "Desktop and mobile own unavailable crops.");
  await isolateWatchlistStore(page, testInfo, baseURL);
  await installEventSourceStub(page);
  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({
    json: { quotes: { NVDA: { last: 180.2, chg: 2.5 } } },
  }));
  await page.route(/\/api\/news\/NVDA(?:\?.*)?$/, (route) => route.fulfill({
    status: 503,
    json: { detail: "service unavailable" },
  }));
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });

  const languages = ["en", "zh"] as const;
  const size = testInfo.project.name === "mobile" ? "mobile" : "desktop";
  await page.setViewportSize(size === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 900 });

  if (CROPS) mkdirSync(OUT, { recursive: true });

  for (const lang of languages) {
    await setPresentation(page, lang);
    const panel = await openNews(page, "unavailable");
    await expect(panel.getByRole("status")).toContainText(
      lang === "zh" ? "新闻暂时不可用" : "News is temporarily unavailable",
    );
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    if (CROPS) {
      await panel.screenshot({ path: join(OUT, `unavailable-${size}-${lang}-dark.png`) });
    }
  }
});

test("grouped reports expand inside the real rail without leaving ticker context", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop owns grouped-source browser proof.");
  await prepare(page, testInfo, baseURL);
  await setPresentation(page, "en");
  const panel = await openNews(page);

  await panel.getByRole("button", { name: "2 reports" }).click();
  await expect(panel).toContainText("Nvidia details next-generation AI accelerator platform");
  await expect(page).toHaveURL(/\/terminal\?symbol=NVDA/);
});

test("MSFT grouped detail starts while an Apple story response is still held", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop owns real-shell symbol transition proof.");
  await prepare(page, testInfo, baseURL, "AAPL");
  await setPresentation(page, "en");

  let releaseAaplStory!: () => void;
  const aaplStoryGate = new Promise<void>((resolve) => {
    releaseAaplStory = resolve;
  });
  await page.route("**/api/news/stories/ev2_aapl_grp", async (route) => {
    await aaplStoryGate;
    await route.fulfill({
      json: {
        schema: "ticker_news.story.v1",
        story_id: "ev2_aapl_grp",
        source_count: 1,
        item_count: 2,
        members: [AAPL_SNAPSHOT.rows[0], { ...AAPL_SNAPSHOT.rows[0], sequence: 20, title: "Apple product refresh details" }],
      },
    });
  });

  const panel = await openNews(page);
  const msftStoryWaits: Promise<void>[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/news/stories/ev2_msft_grp")) {
      msftStoryWaits.push(req.response().then(() => undefined).catch(() => undefined));
    }
  });

  await panel.getByRole("button", { name: "2 reports" }).click();
  await expect.poll(() => page.locator('[data-story-id="ev2_aapl_grp"] button').isDisabled()).toBeTruthy();

  await pickSymbol(page, testInfo, "MSFT", "Microsoft");
  const msftPanel = await openNews(page);
  await expect(msftPanel).toContainText("Microsoft expands cloud AI services");

  const beforeMsft = Date.now();
  await msftPanel.getByRole("button", { name: "2 reports" }).click();
  await expect.poll(() => msftStoryWaits.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(Date.now() - beforeMsft).toBeLessThan(10_000);

  releaseAaplStory();
});
