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
  },
};

const SNAPSHOT = {
  schema: "ticker_news.snapshot.v1",
  ticker: "NVDA",
  security_id: "SEC:US-XNAS-NVDA",
  state: "live",
  rows: [
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
  ],
  next_cursor: 10,
  has_more: false,
  source_health: {
    state: "live",
    last_successful_catchup: "2026-10-05T19:31:01+00:00",
  },
};

async function prepare(page: Page, testInfo: TestInfo, baseURL?: string) {
  await isolateWatchlistStore(page, testInfo, baseURL);
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

  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({
    json: { quotes: { NVDA: { last: 180.2, chg: 2.5 } } },
  }));
  await page.route(/\/api\/news\/NVDA(?:\?.*)?$/, (route) => route.fulfill({ json: SNAPSHOT }));
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

  await page.goto("/terminal?symbol=NVDA");
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

async function openNews(page: Page) {
  const tab = page.locator("#rail-tab-news");
  await tab.scrollIntoViewIfNeeded();
  await expect(tab).toBeVisible();
  await tab.click();
  const panel = page.getByTestId("ticker-news-panel");
  await panel.scrollIntoViewIfNeeded();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-news-state", "live");
  return panel;
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

test("grouped reports expand inside the real rail without leaving ticker context", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop owns grouped-source browser proof.");
  await prepare(page, testInfo, baseURL);
  await setPresentation(page, "en");
  const panel = await openNews(page);

  await panel.getByRole("button", { name: "2 reports" }).click();
  await expect(panel).toContainText("Nvidia details next-generation AI accelerator platform");
  await expect(page).toHaveURL(/\/terminal\?symbol=NVDA/);
});