import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { editorialView } from "../lib/__tests__/fixtures/newsEditorial";
import type { TickerNewsViewMode } from "../lib/newsTypes";
import { isolateWatchlistStore } from "./watchlistStore";

test.setTimeout(120_000);

const OUT = join(process.cwd(), "docs", "pr-crops", "ticker-news-editorial-views");
const CROPS = process.env.TERMINAL_CROPS === "1";
const LIGHT_SPECIMEN_CSS = readFileSync(join(process.cwd(), "docs/specimens/news-flow.light.css"), "utf8");

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
  content_kind?: "reporting" | "press_release";
};

function snapshotFor(ticker: string, rows: NewsRow[], view = editorialView()) {
  return {
    schema: "ticker_news.snapshot.v1",
    editorial_policy: "ticker_news.curated.v1",
    editorial_view: view,
    change_sequence: Math.max(0, ...rows.map((row) => row.sequence)),
    ticker,
    security_id: `SEC:US-XNAS-${ticker}`,
    state: "live",
    rows: rows.map((row) => ({ ...row, editorial_view: view })),
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
    source: "massive:globenewswire.com",
    content_kind: "press_release",
    source_item_id: "100",
    story_id: "ev2_nvda_supply",
    source_count: 1,
    item_count: 1,
    title: "Nvidia supplier expands advanced packaging capacity",
    url: "https://www.globenewswire.com/news-release/100",
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

function viewSnapshot(base: ReturnType<typeof snapshotFor>, mode: TickerNewsViewMode) {
  const view = editorialView(mode);
  const rows = base.rows.map((row) => ({ ...row, editorial_view: view }));
  if (mode === "all") {
    rows.push({
      ...rows[0], sequence: 40, source_item_id: "roundup", story_id: "ev2_roundup",
      source_count: 1, item_count: 1, title: "Benzinga Bulls And Bears: Nvidia, Apple",
      teaser: "", url: "https://www.benzinga.com/news/roundup",
    });
  }
  return {
    ...snapshotFor(base.ticker, rows, view),
    rows: rows.map((row) => ({
      ...row, editorial: {
        schema: "ticker_news.editorial_view.v1",
        format: row.source_item_id === "roundup" ? "roundup" : "unclassified",
        format_reason: row.source_item_id === "roundup" ? "named_roundup" : null,
        company_reference: "headline", eligible: true,
      },
    })),
  };
}

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
  await page.route(/\/api\/news\/NVDA(?:\?.*)?$/, (route) => route.fulfill({ json: viewSnapshot(SNAPSHOT, new URL(route.request().url()).searchParams.get("view") as TickerNewsViewMode) }));
  await page.route(/\/api\/news\/AAPL(?:\?.*)?$/, (route) => route.fulfill({ json: viewSnapshot(AAPL_SNAPSHOT, new URL(route.request().url()).searchParams.get("view") as TickerNewsViewMode) }));
  await page.route(/\/api\/news\/MSFT(?:\?.*)?$/, (route) => route.fulfill({ json: viewSnapshot(MSFT_SNAPSHOT, new URL(route.request().url()).searchParams.get("view") as TickerNewsViewMode) }));
  await page.route("**/api/news/stories/ev2_nvda_launch**", (route) => route.fulfill({
    json: {
      schema: "ticker_news.story.v1", editorial_view: editorialView(),
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
  await page.route("**/api/news/stories/ev2_aapl_grp**", (route) => route.fulfill({
    json: {
      schema: "ticker_news.story.v1", editorial_view: editorialView(),
      story_id: "ev2_aapl_grp",
      source_count: 1,
      item_count: 2,
      members: [AAPL_SNAPSHOT.rows[0], { ...AAPL_SNAPSHOT.rows[0], sequence: 20, source_item_id: "200", url: "https://www.benzinga.com/news/200", title: "Apple product refresh details" }],
    },
  }));
  await page.route("**/api/news/stories/ev2_msft_grp**", (route) => route.fulfill({
    json: {
      schema: "ticker_news.story.v1", editorial_view: editorialView(),
      story_id: "ev2_msft_grp",
      source_count: 1,
      item_count: 2,
      members: [MSFT_SNAPSHOT.rows[0], { ...MSFT_SNAPSHOT.rows[0], sequence: 30, source_item_id: "300", url: "https://www.benzinga.com/news/300", title: "Microsoft cloud AI expansion details" }],
    },
  }));

  await page.goto(`/terminal?symbol=${symbol}`);
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
}

async function setPresentation(page: Page, lang: "en" | "zh", theme: "light" | "dark" = "dark") {
  await page.evaluate((l) => {
    localStorage.setItem("mm.lang", l);
  }, lang);
  await page.reload();
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("html")).toHaveAttribute("data-lang", lang);
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
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
  test.skip(testInfo.project.name !== "desktop", "One controlled project owns the 12-cell screenshot matrix.");
  test.setTimeout(180_000);
  await prepare(page, testInfo, baseURL);

  const cells = [
    { width: 1440, height: 900, size: "desktop" },
    { width: 820, height: 1180, size: "tablet" },
    { width: 390, height: 844, size: "mobile" },
  ] as const;
  const languages = ["en", "zh"] as const;
  if (CROPS) {
    mkdirSync(OUT, { recursive: true });
    for (const name of readdirSync(OUT)) {
      if (name.endsWith(".png")) rmSync(join(OUT, name));
    }
  }

  for (const viewport of cells) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const lang of languages) {
      for (const theme of ["light", "dark"] as const) {
        await setPresentation(page, lang, theme);
        const panel = await openNews(page);
        // The shipped Terminal is dark; the existing approved light palette is
        // a specimen only (D-W1), not a claim that a live light theme exists.
        if (theme === "light") {
          await page.addStyleTag({ content: LIGHT_SPECIMEN_CSS });
          await panel.evaluate((node) => node.setAttribute("data-specimen-theme", "light"));
          await expect.poll(() => panel.evaluate((node) => getComputedStyle(node).getPropertyValue("--panel").trim()))
            .toBe("#ffffff");
        }

        await expect(panel).toContainText(lang === "zh" ? "新闻" : "News");
        await expect(panel).toContainText("Nvidia launches next-generation AI accelerator");
        await expect(panel).toContainText("Benzinga");
        await expect(panel).toHaveAttribute("data-news-editorial-policy", "ticker_news.curated.v1");
        // R2: the content kind moved from the source label into the evidence ladder's first step (spec §3.2).
        await expect(panel).toContainText("GlobeNewswire");
        await expect(panel).toContainText(lang === "zh" ? "公司公告" : "Company announcement");
        await expect(panel.locator('option[value=""]')).toHaveText(lang === "zh" ? "全部精选来源" : "All curated sources");
        await panel.locator("select[data-news-source-filter]").selectOption("benzinga");
        await expect(panel.locator("[data-news-headline]")).toHaveCount(1);
        await panel.locator("select[data-news-source-filter]").selectOption("");
        await expect(panel.locator("[data-news-headline]")).toHaveCount(2);
        await expect(panel.locator("[data-news-headline]").first()).toHaveAttribute(
          "href",
          "https://www.benzinga.com/news/101",
        );
        await expect(panel.getByRole("button", {
          name: lang === "zh" ? "查看这条新闻背后的报道" : "Show the reports behind this story",
        })).toBeVisible();

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);

        const streamUrl = await page.evaluate(
          () => (window as unknown as { __mmTickerNewsStream?: string }).__mmTickerNewsStream ?? "",
        );
        expect(streamUrl).toContain("symbol=NVDA");

        await expect(panel).toHaveAttribute("data-news-view", "news");
        const viewControl = panel.locator("select[data-news-view-select]");
        await expect(viewControl).toHaveAccessibleName(lang === "zh" ? "新闻视图" : "News view");
        for (const mode of ["news", "company", "all"] as const) {
          await viewControl.selectOption(mode);
          await expect(panel).toHaveAttribute("data-news-view", mode);
          await expect(panel.locator("[data-news-headline]")).toHaveCount(mode === "all" ? 3 : 2);
          if (mode === "company") {
            await expect(panel).toContainText(lang === "zh" ? "提及可能并非报道重点" : "Mentions may be incidental");
          }
          if (mode === "all") await expect(panel).toContainText(lang === "zh" ? "综述" : "Roundup");
          if (viewport.width <= 820) {
            expect((await viewControl.boundingBox())?.height).toBeGreaterThanOrEqual(44);
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
          if (CROPS) {
            await panel.screenshot({
              path: join(OUT, `${viewport.size}-${lang}-${theme === "light" ? "light-specimen" : "dark"}-${mode}.png`),
            });
          }
        }
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

test("unavailable snapshot retries inside the rail across EN/ZH and theme specimens", async ({ page, baseURL }, testInfo) => {
  test.skip(!["desktop", "tablet", "mobile"].includes(testInfo.project.name), "Contract viewports only.");
  await prepare(page, testInfo, baseURL);
  const retryOut = join(process.cwd(), "docs", "pr-crops", "ticker-news-recovery");
  if (CROPS) mkdirSync(retryOut, { recursive: true });
  let allowRecovery = false;
  let releaseRecovery!: () => void;
  let recoveryGate = Promise.resolve();
  let snapshotReads = 0;
  let documentReads = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentReads += 1;
  });
  await page.route(/\/api\/news\/NVDA(?:\?.*)?$/, async (route) => {
    snapshotReads += 1;
    if (!allowRecovery) {
      await route.fulfill({ status: 503, json: { detail: "temporary failure" } });
      return;
    }
    await recoveryGate;
    await route.fulfill({ json: viewSnapshot(SNAPSHOT, "news") });
  });

  for (const lang of ["en", "zh"] as const) {
    for (const theme of ["light", "dark"] as const) {
      allowRecovery = false;
      recoveryGate = new Promise<void>((resolve) => { releaseRecovery = resolve; });
      await setPresentation(page, lang, theme);
      const panel = await openNews(page, "unavailable");
      if (theme === "light") {
        await page.addStyleTag({ content: LIGHT_SPECIMEN_CSS });
        await panel.evaluate((node) => node.setAttribute("data-specimen-theme", "light"));
      }
      const label = lang === "zh" ? "重试" : "Retry";
      const retry = panel.getByRole("button", { name: label, exact: true });
      await expect(retry).toBeVisible();
      await expect(panel.getByRole("button", { name: lang === "zh" ? "Retry" : "重试", exact: true })).toHaveCount(0);
      expect((await retry.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await panel.locator("select[data-news-view-select]").focus();
      await page.keyboard.press("Tab");
      await expect(retry).toBeFocused();
      expect(await retry.evaluate((node) => parseFloat(getComputedStyle(node).outlineWidth))).toBeGreaterThanOrEqual(2);
      const cell = [testInfo.project.name, lang, theme === "light" ? "light-specimen" : "dark"].join("-");
      if (CROPS) await panel.screenshot({ path: join(retryOut, cell + "-unavailable.png") });

      const beforeRetry = snapshotReads;
      const beforeDocuments = documentReads;
      allowRecovery = true;
      await page.keyboard.press("Enter");
      try {
        await expect(panel).toHaveAttribute("data-news-state", "loading");
        await expect(retry).toHaveCount(0);
        await expect(panel.locator("[data-news-headline], [data-news-mark-one]")).toHaveCount(0);
        await expect.poll(() => snapshotReads).toBe(beforeRetry + 1);
        if (CROPS) await panel.screenshot({ path: join(retryOut, cell + "-loading.png") });
      } finally {
        releaseRecovery();
      }
      await expect(panel).toHaveAttribute("data-news-state", "live");
      await expect(panel).toHaveAttribute("data-news-view", "news");
      await expect(panel.locator("[data-news-headline]")).toHaveCount(2);
      await expect(panel.locator('article[data-news-review="reviewed"]')).toHaveCount(0);
      expect(snapshotReads).toBe(beforeRetry + 1);
      expect(documentReads).toBe(beforeDocuments);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      if (CROPS) await panel.screenshot({ path: join(retryOut, cell + "-recovered.png") });
    }
  }
});

test("grouped reports expand inside the real rail without leaving ticker context", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop owns grouped-source browser proof.");
  await prepare(page, testInfo, baseURL);
  await setPresentation(page, "en");
  const panel = await openNews(page);

  await panel.getByRole("button", { name: "Show the reports behind this story" }).click();
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
  await page.route("**/api/news/stories/ev2_aapl_grp**", async (route) => {
    await aaplStoryGate;
    await route.fulfill({
      json: {
        schema: "ticker_news.story.v1", editorial_view: editorialView(),
        story_id: "ev2_aapl_grp",
        source_count: 1,
        item_count: 2,
        members: [AAPL_SNAPSHOT.rows[0], { ...AAPL_SNAPSHOT.rows[0], sequence: 20, source_item_id: "200", url: "https://www.benzinga.com/news/200", title: "Apple product refresh details" }],
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

  await panel.getByRole("button", { name: "Show the reports behind this story" }).click();
  await expect.poll(() => page.locator('[data-story-id="ev2_aapl_grp"] button[aria-expanded]').isDisabled()).toBeTruthy();

  await pickSymbol(page, testInfo, "MSFT", "Microsoft");
  const msftPanel = await openNews(page);
  await expect(msftPanel).toContainText("Microsoft expands cloud AI services");

  const beforeMsft = Date.now();
  await msftPanel.getByRole("button", { name: "Show the reports behind this story" }).click();
  await expect.poll(() => msftStoryWaits.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(Date.now() - beforeMsft).toBeLessThan(10_000);

  releaseAaplStory();
});


test("editorial views filter before display and keep grouped details in the selected context", async ({ page, baseURL }, testInfo) => {
  test.skip(!["desktop", "tablet", "mobile"].includes(testInfo.project.name), "Contract viewports only.");
  await prepare(page, testInfo, baseURL);
  await page.route(/\/api\/news\/NVDA(?:\?.*)?$/, (route) => {
    const mode = new URL(route.request().url()).searchParams.get("view") as TickerNewsViewMode;
    const candidate = viewSnapshot(SNAPSHOT, mode);
    if (mode === "company") candidate.rows = candidate.rows.filter((row) => row.source_item_id === "101");
    else candidate.rows[1] = { ...candidate.rows[1], title: "Astera opens a manufacturing facility" };
    return route.fulfill({ json: candidate });
  });
  await page.route("**/api/news/stories/ev2_nvda_launch**", (route) => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get("ticker")).toBe("NVDA");
    const view = editorialView(query.get("view") as TickerNewsViewMode);
    expect(query.get("view_revision")).toBe(view.revision);
    return route.fulfill({ json: {
      schema: "ticker_news.story.v1", editorial_view: view, story_id: "ev2_nvda_launch",
      source_count: 1, item_count: 2,
      members: [
        { ...SNAPSHOT.rows[0], editorial_view: view },
        { ...SNAPSHOT.rows[0], editorial_view: view, source_item_id: "101b", sequence: 9, title: "Current company report member" },
      ],
    } });
  });
  const panel = await openNews(page);
  const control = panel.locator("select[data-news-view-select]");
  await control.selectOption("company");
  await expect(panel).toHaveAttribute("data-news-view", "company");
  await expect(panel.locator("[data-news-headline]")).toHaveCount(1);
  await panel.getByRole("button", { name: "Show the reports behind this story", exact: true }).click();
  await expect(panel).toContainText("Current company report member");
  await control.selectOption("all");
  await expect(panel).toHaveAttribute("data-news-view", "all");
  await expect(panel.locator("[data-news-headline]")).toHaveCount(3);
  await expect(panel).not.toContainText("Current company report member");
  await expect(panel).toContainText("Roundup");
  await control.selectOption("news");
  await expect(panel).toHaveAttribute("data-news-view", "news");
  await expect(panel.locator("[data-news-headline]")).toHaveCount(2);
  await expect(panel).not.toContainText("Benzinga Bulls And Bears");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
