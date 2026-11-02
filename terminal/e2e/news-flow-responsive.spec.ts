import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isolateWatchlistStore } from "./watchlistStore";
import { NEWS_VIEW } from "../lib/__tests__/fixtures/newsEditorial";
import type { TickerNewsContentKind, TickerNewsReportingState } from "../lib/newsTypes";

/**
 * Wave B3 — news-flow strip responsive evidence matrix (design pin P13).
 *
 * Live dark cells: D1/D2 (desktop EN/ZH), D3/D4 (tablet), D5/D6 (mobile), each in
 * seven states (busier, typical, quieter, thin, partial, unavailable, open). E1
 * proves the east convention leaves the live dot a neutral status token. The light
 * treatment ships only as the static specimen (seat ruling D-W1), so it is captured
 * as SPECIMEN renders of docs/specimens/news-flow.html (L1-L6) — never live cells.
 *
 * The spec runs once per project; viewports come from playwright.config.ts and are
 * never changed here. Crops land in NEWS_FLOW_CROPS_DIR, or test-results/news-flow-crops.
 */
test.setTimeout(120_000);

const CROPS_DIR = process.env.NEWS_FLOW_CROPS_DIR || join("test-results", "news-flow-crops");
mkdirSync(CROPS_DIR, { recursive: true });

// R2 evidence-ladder cells (spec NEWS_INTELLIGENCE_RAIL_R2_SPEC.md §7 matrix) keep
// their own crop directory so the two matrices never clobber each other's images.
const R2_CROPS_DIR = process.env.NEWS_R2_CROPS_DIR || join("test-results", "news-r2-crops");
mkdirSync(R2_CROPS_DIR, { recursive: true });

// ---- shared harness, copied from e2e/ticker-news.spec.ts ------------------------

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
  updated_at: string | null;
  received_at: string;
  universe_revision: string;
  reporting_state?: TickerNewsReportingState;
  content_kind?: TickerNewsContentKind;
  publisher?: string;
  annotation?: { event_type: string | null } | null;
};

const ROWS: NewsRow[] = [
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
];

// ---- R2 fixtures (spec packet item 2; ROWS above is untouched) --------------------
//
// Five stories covering the evidence-ladder cells: an agreeing 3-report cluster
// (ev2_r2_agree), a differing 2-report cluster (ev2_r2_differ), a company announcement
// (ev2_r2_press), a 1-report static chain (ev2_r2_single) and a not-compared reporting row
// (ev2_r2_notcompared) that only earns NEXT CHECK while the snapshot is catching up.

type R2SnapshotState = "live" | "catching_up" | "restricted" | "unavailable";

const R2_ROWS: NewsRow[] = [
  {
    sequence: 21,
    source: "benzinga",
    source_item_id: "201",
    story_id: "ev2_r2_agree",
    source_count: 3,
    item_count: 3,
    title: "Nvidia trims full-year outlook on export limits",
    url: "https://www.benzinga.com/news/201",
    teaser: "The company filed a revised outlook that reflects the new export licence limits. Two other outlets published their own readings of the same filing minutes later.",
    published_at: "2026-10-05T19:30:00+00:00",
    updated_at: "2026-10-05T19:31:00+00:00",
    received_at: "2026-10-05T19:31:01+00:00",
    universe_revision: "sp500-r1",
    reporting_state: "no_material_difference",
    content_kind: "reporting",
    publisher: "benzinga.com",
    annotation: { event_type: "guidance_cut" },
  },
  {
    sequence: 20,
    source: "benzinga",
    source_item_id: "202",
    story_id: "ev2_r2_differ",
    source_count: 2,
    item_count: 2,
    title: "Nvidia partners give differing timelines for export licence reviews",
    url: "https://www.benzinga.com/news/202",
    teaser: "",
    published_at: "2026-10-05T19:10:00+00:00",
    updated_at: "2026-10-05T19:11:00+00:00",
    received_at: "2026-10-05T19:11:01+00:00",
    universe_revision: "sp500-r1",
    reporting_state: "reports_differ",
    content_kind: "reporting",
    publisher: "benzinga.com",
    annotation: { event_type: null },
  },
  {
    sequence: 19,
    source: "benzinga",
    source_item_id: "203",
    story_id: "ev2_r2_press",
    source_count: 1,
    item_count: 2,
    title: "Nvidia publishes accelerator platform availability details",
    url: "https://www.benzinga.com/news/203",
    teaser: "",
    published_at: "2026-10-05T18:40:00+00:00",
    updated_at: "2026-10-05T18:41:00+00:00",
    received_at: "2026-10-05T18:41:01+00:00",
    universe_revision: "sp500-r1",
    reporting_state: "not_compared",
    content_kind: "press_release",
    publisher: "nvidia.com",
    annotation: { event_type: "product_launch" },
  },
  {
    sequence: 18,
    source: "benzinga",
    source_item_id: "204",
    story_id: "ev2_r2_single",
    source_count: 1,
    item_count: 1,
    title: "Nvidia adds a packaging partner for accelerator modules",
    url: "https://www.benzinga.com/news/204",
    teaser: "",
    published_at: "2026-10-05T18:20:00+00:00",
    updated_at: "2026-10-05T18:20:00+00:00",
    received_at: "2026-10-05T18:20:01+00:00",
    universe_revision: "sp500-r1",
    content_kind: "reporting",
    publisher: "benzinga.com",
    annotation: null,
  },
  {
    sequence: 17,
    source: "benzinga",
    source_item_id: "205",
    story_id: "ev2_r2_notcompared",
    source_count: 2,
    item_count: 2,
    title: "Nvidia reschedules its accelerator briefing",
    url: "https://www.benzinga.com/news/205",
    teaser: "",
    published_at: "2026-10-05T18:05:00+00:00",
    updated_at: "2026-10-05T18:06:00+00:00",
    received_at: "2026-10-05T18:06:01+00:00",
    universe_revision: "sp500-r1",
    reporting_state: "not_compared",
    content_kind: "reporting",
    publisher: "benzinga.com",
    annotation: { event_type: null },
  },
];

/**
 * The R2 snapshot fixture, built like snapshotFor. Restricted and unavailable set
 * the snapshot state with empty rows; the panel's EmptyState branch is driven by the
 * feed hook's load state, which those two states reach only through the response
 * status — the /api/news route answers 403 (restricted) and 500 (unavailable) with
 * this body (useTickerNewsFeed.loadSnapshot). source_health.state mirrors the state
 * word; parseHealth treats it as an opaque string.
 */
function r2Snapshot(state: R2SnapshotState) {
  return {
    schema: "ticker_news.snapshot.v1",
    editorial_policy: "ticker_news.curated.v1",
    editorial_view: NEWS_VIEW,
    ticker: "NVDA",
    security_id: "SEC:US-XNAS-NVDA",
    state,
    rows: (state === "restricted" || state === "unavailable" ? [] : R2_ROWS).map((row) => ({
      ...row,
      editorial_view: NEWS_VIEW,
    })),
    next_cursor: R2_ROWS[R2_ROWS.length - 1].sequence,
    has_more: false,
    source_health: {
      state: state === "live" || state === "catching_up" ? "live" : state,
      last_successful_catchup: "2026-10-05T19:31:01+00:00",
    },
    flow: FLOW_OK,
  };
}

/** A detail member: the representative row re-based onto one outlet's report. */
const r2Member = (row: NewsRow, overrides: Partial<NewsRow>) => ({
  ...row,
  ...overrides,
  editorial_view: NEWS_VIEW,
});

// Story detail routes, the idiom of e2e/ticker-news.spec.ts:262-297.
const R2_STORY_ROUTES: Record<string, Record<string, unknown>> = {
  ev2_r2_agree: {
    schema: "ticker_news.story.v1",
    editorial_view: NEWS_VIEW,
    story_id: "ev2_r2_agree",
    source_count: 3,
    item_count: 3,
    reporting_state: "no_material_difference",
    members: [
      r2Member(R2_ROWS[0], { sequence: 31, source_item_id: "a1", publisher: "benzinga.com" }),
      r2Member(R2_ROWS[0], {
        sequence: 30,
        source_item_id: "a2",
        title: "Nvidia lowers full-year outlook citing export licence limits",
        url: "https://www.reuters.com/news/202",
        publisher: "reuters.com",
        updated_at: null,
      }),
      r2Member(R2_ROWS[0], {
        sequence: 29,
        source_item_id: "a3",
        title: "Nvidia revises full-year outlook after export limit change",
        url: "https://www.bloomberg.com/news/203",
        publisher: "bloomberg.com",
      }),
    ],
  },
  ev2_r2_differ: {
    schema: "ticker_news.story.v1",
    editorial_view: NEWS_VIEW,
    story_id: "ev2_r2_differ",
    source_count: 2,
    item_count: 2,
    reporting_state: "reports_differ",
    members: [
      r2Member(R2_ROWS[1], { sequence: 28, source_item_id: "d1", publisher: "benzinga.com" }),
      r2Member(R2_ROWS[1], {
        sequence: 27,
        source_item_id: "d2",
        title: "Nvidia partner sees longer export licence review timelines",
        url: "https://www.reuters.com/news/204",
        publisher: "reuters.com",
      }),
    ],
  },
  ev2_r2_press: {
    schema: "ticker_news.story.v1",
    editorial_view: NEWS_VIEW,
    story_id: "ev2_r2_press",
    source_count: 1,
    item_count: 2,
    reporting_state: "not_compared",
    members: [
      r2Member(R2_ROWS[2], { sequence: 26, source_item_id: "p1", publisher: "nvidia.com", content_kind: "press_release" }),
      r2Member(R2_ROWS[2], {
        sequence: 25,
        source_item_id: "p2",
        title: "Nvidia accelerator platform listed for order intake",
        url: "https://www.benzinga.com/news/206",
        publisher: "benzinga.com",
        content_kind: "reporting",
      }),
    ],
  },
};

async function installR2StoryRoutes(page: Page) {
  for (const [storyId, detail] of Object.entries(R2_STORY_ROUTES)) {
    await page.route(`**/api/news/stories/${storyId}**`, (route) => route.fulfill({ json: detail }));
  }
}

// ---- flow fixtures (frozen contract section 5, verbatim; plus pin P13 extras) ---

const FLOW_METHOD =
  "distinct reports by source + source_item_id; active status only; " +
  "rights-allowed sources only; UTC calendar days; median of 28 prior days";

const flowProvenance = (publishedAt: number, receivedAt: number) => ({
  editorial_view: NEWS_VIEW,
  velocity_schema: "qbus.news_velocity.v1",
  sources_counted: ["benzinga"],
  status_counted: "active",
  distinct_by: "source + source_item_id",
  story_grouping: "news_cluster_members.cluster_id; a report in no cluster is its own story",
  cluster_policy_version: "qbus_news_cluster.v2",
  windows: {
    reports_24h: "rolling, closed at both ends: [as_of - 24h, as_of]",
    reports_7d: "rolling, closed at both ends: [as_of - 7d, as_of]",
    daily_28d: {
      start_date: "2026-09-14",
      end_date: "2026-10-11",
      unit: "UTC calendar day",
      excludes: "the current UTC day",
      order: "oldest first",
    },
  },
  calculation: { method: FLOW_METHOD, comparison_rule: "flow_compare.v1" },
  time_basis_counts_24h: { published_at: publishedAt, received_at: receivedAt },
});

const OK_DAILY = [2, 3, 1, 4, 2, 3, 0, 5, 2, 3, 2, 3, 1, 4, 2, 3, 2, 3, 1, 3, 2, 4, 2, 3, 2, 3, 2, 3];
const THIN_DAILY = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];

const FLOW_OK = {
  schema: "ticker_news.flow.v1",
  state: "ok",
  reason: null,
  coverage: "complete",
  as_of: "2026-10-12T10:30:00Z",
  reports_24h: 7,
  reports_7d: 21,
  stories_24h: 4,
  median_daily_28d: 2.5,
  daily_counts_28d: OK_DAILY,
  history_days_observed: 28,
  comparison: "busier",
  provenance: flowProvenance(6, 1),
};

const FLOW_PARTIAL = { ...FLOW_OK, coverage: "partial", comparison: null };

const FLOW_THIN = {
  schema: "ticker_news.flow.v1",
  state: "thin_history",
  reason: null,
  coverage: "complete",
  as_of: "2026-10-12T10:30:00Z",
  reports_24h: 2,
  reports_7d: 3,
  stories_24h: 2,
  median_daily_28d: null,
  daily_counts_28d: THIN_DAILY,
  history_days_observed: 6,
  comparison: "insufficient_history",
  provenance: flowProvenance(2, 0),
};

// Terminal-only fixtures (pin P13): the same shape at the two remaining comparisons.
const FLOW_TYPICAL = {
  ...FLOW_OK,
  reports_24h: 3,
  reports_7d: 17,
  stories_24h: 2,
  comparison: "typical",
  provenance: flowProvenance(3, 0),
};

const FLOW_QUIETER = {
  ...FLOW_OK,
  reports_24h: 1,
  reports_7d: 15,
  stories_24h: 1,
  comparison: "quieter",
  provenance: flowProvenance(1, 0),
};

const FLOW_UNAVAILABLE = {
  schema: "ticker_news.flow.v1",
  state: "unavailable",
  reason: "calculation_failed",
  coverage: "complete",
  as_of: null,
  reports_24h: null,
  reports_7d: null,
  stories_24h: null,
  median_daily_28d: null,
  daily_counts_28d: null,
  history_days_observed: null,
  comparison: null,
  provenance: null,
};

// ---- the cell matrix ------------------------------------------------------------

type ProjectName = "desktop" | "tablet" | "mobile";
type Lang = "en" | "zh";
type StateName = "busier" | "typical" | "quieter" | "thin" | "partial" | "unavailable" | "open";

const CELLS: Record<ProjectName, Record<Lang, string>> = {
  desktop: { en: "D1", zh: "D2" },
  tablet: { en: "D3", zh: "D4" },
  mobile: { en: "D5", zh: "D6" },
};

// The partial cell rides a catching_up snapshot; every other cell is live.
const STATE_FIXTURES: Record<StateName, { flow: unknown; snapshotState: "live" | "catching_up"; flowState: string }> = {
  busier: { flow: FLOW_OK, snapshotState: "live", flowState: "ok" },
  typical: { flow: FLOW_TYPICAL, snapshotState: "live", flowState: "ok" },
  quieter: { flow: FLOW_QUIETER, snapshotState: "live", flowState: "ok" },
  thin: { flow: FLOW_THIN, snapshotState: "live", flowState: "thin_history" },
  partial: { flow: FLOW_PARTIAL, snapshotState: "catching_up", flowState: "ok" },
  unavailable: { flow: FLOW_UNAVAILABLE, snapshotState: "live", flowState: "unavailable" },
  open: { flow: FLOW_OK, snapshotState: "live", flowState: "ok" },
};

// Unavailable sentence copied from lib/newsFlowLex.ts ("state.unavailable") — the
// strings are pinned here rather than imported, matching the e2e house style.
const GLANCE: Record<StateName, Record<Lang, [string, string]>> = {
  busier: { en: ["7 reports in 24h", "Busier than a typical day"], zh: ["24小时内 7 条报道", "比平日更密集"] },
  typical: { en: ["3 reports in 24h", "About a typical day"], zh: ["24小时内 3 条报道", "与平日相当"] },
  quieter: { en: ["1 report in 24h", "Quieter than a typical day"], zh: ["24小时内 1 条报道", "比平日清淡"] },
  thin: { en: ["2 reports in 24h", "Too little history to compare"], zh: ["24小时内 2 条报道", "历史尚短，暂不比较"] },
  partial: { en: ["7 reports in 24h", "Counts may be incomplete"], zh: ["24小时内 7 条报道", "计数可能不完整"] },
  unavailable: { en: ["Report counts unavailable right now", ""], zh: ["报道计数暂不可用", ""] },
  open: { en: ["7 reports in 24h", "Busier than a typical day"], zh: ["24小时内 7 条报道", "比平日更密集"] },
};

const MORE_LABEL: Record<Lang, string> = { en: "How these counts work", zh: "计数说明" };
const DETAIL_TITLE: Record<Lang, string> = { en: "Report count, last 28 days", zh: "近28天报道数" };

function snapshotFor(state: "live" | "catching_up", flow: unknown) {
  return {
    schema: "ticker_news.snapshot.v1",
    editorial_policy: "ticker_news.curated.v1",
    editorial_view: NEWS_VIEW,
    ticker: "NVDA",
    security_id: "SEC:US-XNAS-NVDA",
    state,
    rows: ROWS.map((row) => ({ ...row, editorial_view: NEWS_VIEW })),
    next_cursor: ROWS[ROWS.length - 1].sequence,
    has_more: false,
    source_health: {
      state: "live",
      last_successful_catchup: "2026-10-05T19:31:01+00:00",
    },
    flow,
  };
}

// ---- page harness (idioms of e2e/ticker-news.spec.ts:178-306) --------------------

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

async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, flow: unknown, snapshotState: "live" | "catching_up", r2State?: R2SnapshotState) {
  await isolateWatchlistStore(page, testInfo, baseURL);
  await installEventSourceStub(page);

  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({
    json: { quotes: { NVDA: { last: 180.2, chg: 2.5 } } },
  }));
  await page.route(/\/api\/news\/NVDA(?:\?.*)?$/, (route) => {
    // R2 cells serve the snapshot fixture; restricted/unavailable ride the load path
    // the panel actually exposes — the feed hook derives those load states from the
    // response status, not from a parsed payload (see r2Snapshot above).
    if (r2State === "restricted") return route.fulfill({ status: 403, json: r2Snapshot("restricted") });
    if (r2State === "unavailable") return route.fulfill({ status: 500, json: r2Snapshot("unavailable") });
    if (r2State) return route.fulfill({ json: r2Snapshot(r2State) });
    return route.fulfill({ json: snapshotFor(snapshotState, flow) });
  });

  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
}

async function setPresentation(page: Page, lang: Lang) {
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

// ---- assertions (pin P13) --------------------------------------------------------

/** Tab until the details button owns focus (at most 60 presses), then pin the ring. */
async function assertFocusRing(page: Page, button: ReturnType<Page["locator"]>) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
  });
  await page.keyboard.press("Shift+Tab");
  let focused = false;
  for (let i = 0; i < 60 && !focused; i++) {
    focused = await button.evaluate((el) => document.activeElement === el);
    if (!focused) await page.keyboard.press("Tab");
  }
  await expect(button).toBeFocused();
  const outline = await button.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { style: cs.outlineStyle, width: cs.outlineWidth };
  });
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBe("2px");
}

/** The live dot must paint exactly --brand-2 (and, under E1/east, not --buy). */
async function liveDotColors(page: Page) {
  return page.evaluate(() => {
    const dot = document.querySelector("[data-news-live-dot]");
    if (!dot) return null;
    const probeColor = (background: string) => {
      const el = document.createElement("div");
      el.style.position = "fixed";
      el.style.top = "-200px";
      el.style.background = background;
      document.body.appendChild(el);
      const color = getComputedStyle(el).backgroundColor;
      el.remove();
      return color;
    };
    return {
      dot: getComputedStyle(dot).backgroundColor,
      brand2: probeColor("var(--brand-2)"),
      buy: probeColor("var(--buy)"),
    };
  });
}

// ---- the live matrix: one test per state, one describe per language ---------------

async function runCell(page: Page, baseURL: string | undefined, testInfo: TestInfo, lang: Lang, state: StateName) {
  const project = testInfo.project.name as ProjectName;
  const cell = CELLS[project][lang];
  const { flow, snapshotState, flowState } = STATE_FIXTURES[state];

  await prepare(page, testInfo, baseURL, flow, snapshotState);
  await setPresentation(page, lang);
  const panel = await openNews(page, snapshotState);

  const strip = panel.locator("[data-flow-state]");
  await expect(strip).toHaveAttribute("data-flow-state", flowState);

  const line = strip.locator(":scope > p");
  await expect(line).toHaveCount(1);
  if (state === "unavailable") {
    // Only the unavailable sentence: no button, no tally, nothing else.
    await expect(line).toHaveText(GLANCE.unavailable[lang][0]);
    await expect(strip.locator("button")).toHaveCount(0);
  } else {
    const [countText, compareText] = GLANCE[state][lang];
    await expect(line).toContainText(countText);
    await expect(line).toContainText(compareText);
    if (state === "partial") {
      await expect(strip).toHaveAttribute("data-coverage", "partial");
    }
  }

  if (state === "open") {
    await panel.getByRole("button", { name: MORE_LABEL[lang] }).click();
    const detail = strip.locator("section");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(DETAIL_TITLE[lang]);
  }

  // The crop is taken before the assertion block so a red assertion still leaves
  // the cell's evidence image behind (an evidence spec captures first, judges after).
  await panel.screenshot({ path: join(CROPS_DIR, `${cell}-${state}.png`) });

  if (state === "open") {
    const boxes = await page.evaluate(() => {
      const detailEl = document.querySelector('[data-testid="ticker-news-panel"] [data-flow-state] section');
      const panelEl = document.querySelector('[data-testid="ticker-news-panel"]');
      if (!detailEl || !panelEl) return null;
      const d = detailEl.getBoundingClientRect();
      const p = panelEl.getBoundingClientRect();
      return {
        d: { left: d.left, top: d.top, right: d.right, bottom: d.bottom },
        p: { left: p.left, top: p.top, right: p.right, bottom: p.bottom },
        vw: document.documentElement.clientWidth,
        vh: document.documentElement.clientHeight,
      };
    });
    if (!boxes) throw new Error("details section not measurable");
    expect(boxes.d.left).toBeGreaterThanOrEqual(-1);
    expect(boxes.d.top).toBeGreaterThanOrEqual(-1);
    expect(boxes.d.right).toBeLessThanOrEqual(boxes.vw + 1);
    expect(boxes.d.bottom).toBeLessThanOrEqual(boxes.vh + 1);
    expect(boxes.d.left).toBeGreaterThanOrEqual(boxes.p.left - 1);
    expect(boxes.d.top).toBeGreaterThanOrEqual(boxes.p.top - 1);
    expect(boxes.d.right).toBeLessThanOrEqual(boxes.p.right + 1);
    expect(boxes.d.bottom).toBeLessThanOrEqual(boxes.p.bottom + 1);
  }

  // Zero horizontal document overflow, every cell and state.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // EN glance line: one line at 1440/820, at most two lines at 390.
  if (lang === "en") {
    const lineHeight = await line.evaluate((el) => el.getBoundingClientRect().height);
    expect(lineHeight).toBeLessThanOrEqual(project === "mobile" ? 36 : 20);
  }

  // Keyboard: the focus ring on the details control, where one exists.
  if (state !== "unavailable") {
    await assertFocusRing(page, strip.locator("button"));
  }

  // Every live cell (and E1): the dot paints --brand-2, never a direction token.
  if (snapshotState === "live") {
    const colors = await liveDotColors(page);
    if (!colors) throw new Error("live dot not rendered in a live cell");
    expect(colors.dot).toBe(colors.brand2);
  }
}

for (const lang of ["en", "zh"] as const) {
  test.describe(`${lang.toUpperCase()} news-flow cells`, () => {
    for (const state of ["busier", "typical", "quieter", "thin", "partial", "unavailable", "open"] as const) {
      test(`${state} state renders inside its cell`, async ({ page, baseURL }, testInfo) => {
        await runCell(page, baseURL, testInfo, lang, state);
      });
    }
  });
}

// ---- E1: east convention (desktop EN only) ----------------------------------------

test("E1 east convention keeps the live dot neutral", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "E1 runs in desktop only.");
  await prepare(page, testInfo, baseURL, FLOW_OK, "live");
  await setPresentation(page, "en");
  const panel = await openNews(page);
  await page.evaluate(() => document.documentElement.setAttribute("data-updown", "east"));

  await expect(panel.locator("[data-flow-state]")).toHaveAttribute("data-flow-state", "ok");

  const colors = await liveDotColors(page);
  if (!colors) throw new Error("live dot not rendered for E1");
  expect(colors.dot).toBe(colors.brand2);
  expect(colors.dot).not.toBe(colors.buy);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await panel.screenshot({ path: join(CROPS_DIR, "E1-live.png") });
});

// ---- SPECIMEN captures (light treatment, never live evidence — D-W1) --------------

test("light treatment SPECIMEN captures from the static specimen page", async ({ page }, testInfo) => {
  const project = testInfo.project.name as ProjectName;
  const letters: Record<ProjectName, [string, string]> = {
    desktop: ["L1", "L2"],
    tablet: ["L3", "L4"],
    mobile: ["L5", "L6"],
  };
  await page.goto("file://" + join(process.cwd(), "docs", "specimens", "news-flow.html"));
  const [enLetter, zhLetter] = letters[project];
  for (const [lang, letter] of [["en", enLetter], ["zh", zhLetter]] as const) {
    const section = page.locator(`[data-specimen-theme="light"][data-specimen-lang="${lang}"]`);
    await expect(section).toBeVisible();
    await section.screenshot({ path: join(CROPS_DIR, `${letter}-specimen.png`) });
  }
});

// ---- R2 evidence ladder (spec NEWS_INTELLIGENCE_RAIL_R2_SPEC.md §7 matrix R1–R7) --
//
// One cell per project × lang × state; crops land in R2_CROPS_DIR/<cell>.png, taken
// before the assertion block exactly as runCell does. Lexicon strings are pinned as
// literals read from the tree's lib/newsLadderLex.ts and the panel COPY, matching
// the e2e house style (GLANCE above) rather than importing them.

// Compiled CSS-module classes (Turbopack: <File>-module__<hash>__<local>): the spec's
// .topic/.clocks/.sourceLink/.moreReports selectors, matched by local-name suffix so
// the hash stays out of this spec.
const R2_CLS = {
  topic: '[class*="__topic"]',
  clocks: '[class*="__clocks"]',
  groupNote: '[class*="__groupNote"]',
  sourceLink: '[class*="__sourceLink"]',
  moreReports: '[class*="__moreReports"]',
} as const;

// topicFamily("guidance_cut", lang) — spec §2; "product_launch" is a NEWS_TOPIC_FAMILY
// key, so no substitution was needed for the ev2_r2_press fixture.
const R2_TOPIC: Record<Lang, string> = { en: "Guidance", zh: "业绩指引" };
// The ladder chip's visible steps (kind › outlets › reports › agreement), spec §3.5.
const R2_LADDER_TEXT: Record<Lang, string> = {
  en: "Reporting › 3 outlets › 3 reports › Reports agree",
  zh: "媒体报道 › 3 家媒体 › 3 条报道 › 报道一致",
};
const R2_CLOCK_LABELS: Record<Lang, string[]> = {
  en: ["Published", "Updated", "Received"],
  zh: ["发布", "更新", "接收"],
};
const R2_MORE: Record<Lang, string> = { en: "Show 1 more report", zh: "再显示 1 条报道" };
// Panel COPY for the two empty states (spec §5 ZH restricted fix included).
const R2_RESTRICTED: Record<Lang, string> = {
  en: "News access is unavailable for this account or feed.",
  zh: "此账户或新闻源暂无新闻访问权限。",
};
const R2_UNAVAILABLE: Record<Lang, string> = { en: "News is temporarily unavailable.", zh: "新闻暂时不可用。" };
const R2_RETRY: Record<Lang, string> = { en: "Retry", zh: "重试" };

const r2Row = (panel: ReturnType<Page["locator"]>, storyId: string) =>
  panel.locator(`[data-story-id="${storyId}"]`);

/** Zero horizontal document overflow, the runCell pin, reused by every R2 cell. */
async function r2Overflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/**
 * The ladder chip's readable text: the step labels joined by the separator. The
 * agreement glyph span is aria-hidden decoration and excluded — the browser-side
 * mirror of the unit suite's stepLabel helper — so the EN string reads exactly
 * "Reporting › 3 outlets › 3 reports › Reports agree".
 */
async function r2LadderText(ladder: ReturnType<Page["locator"]>) {
  return ladder.locator("[data-step]").evaluateAll((steps) =>
    steps
      .map((step) => [...step.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim())
      .join(" › "),
  );
}

test.describe("R2 evidence ladder", () => {
  for (const lang of ["en", "zh"] as const) {
    test(`collapsed cell (${lang})`, async ({ page, baseURL }, testInfo) => {
      const project = testInfo.project.name as ProjectName;
      await prepare(page, testInfo, baseURL, FLOW_OK, "live", "live");
      await setPresentation(page, lang);
      const panel = await openNews(page);
      const agree = r2Row(panel, "ev2_r2_agree");
      await agree.scrollIntoViewIfNeeded();

      // Evidence first, judgement after (runCell's ordering).
      await panel.screenshot({ path: join(R2_CROPS_DIR, `R2-${project}-${lang}-collapsed.png`) });

      await expect(agree.locator(R2_CLS.topic)).toHaveText(R2_TOPIC[lang]);
      const ladder = agree.locator("[data-news-ladder]");
      await expect(ladder).toHaveAttribute("aria-expanded", "false");
      expect(await r2LadderText(ladder)).toBe(R2_LADDER_TEXT[lang]);
      // live + reports agree → no NEXT CHECK on this row; the neighbours show theirs.
      await expect(agree.locator("[data-next-check]")).toHaveCount(0);
      await expect(r2Row(panel, "ev2_r2_differ").locator("[data-next-check]"))
        .toHaveAttribute("data-next-check", "next.differ");
      await expect(r2Row(panel, "ev2_r2_press").locator("[data-next-check]"))
        .toHaveAttribute("data-next-check", "next.announcement");

      // Spec §3/§4 geometry: 650 13px/18px headline on a fine pointer, 15px/20px at
      // max-width:860px or coarse pointer; ladder chip 24px tall, ≥40px wrapped.
      const finePointer = project === "desktop";
      const geometry = await agree.evaluate((el) => {
        const headline = el.querySelector("[data-news-headline]");
        const chip = el.querySelector("[data-news-ladder]");
        if (!headline || !chip) return null;
        const cs = getComputedStyle(headline);
        return {
          fontSize: cs.fontSize,
          lineHeight: cs.lineHeight,
          ladderHeight: chip.getBoundingClientRect().height,
        };
      });
      if (!geometry) throw new Error("ev2_r2_agree headline/ladder not measurable");
      expect(geometry.fontSize).toBe(finePointer ? "13px" : "15px");
      expect(geometry.lineHeight).toBe(finePointer ? "18px" : "20px");
      if (finePointer) expect(geometry.ladderHeight).toBe(24);
      else expect(geometry.ladderHeight).toBeGreaterThanOrEqual(40);

      // Spec §7 R5: the Mark reviewed control is present on every row and at least 44px
      // tall on the coarse-pointer viewport (rev4 P1-1).
      const markOne = agree.locator("[data-news-mark-one]");
      await expect(markOne).toBeVisible();
      if (project === "mobile") {
        const markBox = await markOne.boundingBox();
        expect(markBox?.height ?? 0).toBeGreaterThanOrEqual(44);
      }

      await assertFocusRing(page, ladder);
      expect(await r2Overflow(page)).toBeLessThanOrEqual(0);
    });

    test(`expanded cell (${lang})`, async ({ page, baseURL }, testInfo) => {
      const project = testInfo.project.name as ProjectName;
      await prepare(page, testInfo, baseURL, FLOW_OK, "live", "live");
      await installR2StoryRoutes(page);
      await setPresentation(page, lang);
      const panel = await openNews(page);

      const agree = r2Row(panel, "ev2_r2_agree");
      await agree.locator("[data-news-ladder]").click();
      const evidence = agree.locator('[role="group"]');
      await expect(evidence).toBeVisible();
      // ev2_r2_differ expanded too: it is the row whose NEXT CHECK line can prove the
      // evidence-view DOM order (ev2_r2_agree has none — live + reports agree).
      const differ = r2Row(panel, "ev2_r2_differ");
      await differ.locator("[data-news-ladder]").click();
      await expect(differ.locator('[role="group"]')).toBeVisible();
      await differ.scrollIntoViewIfNeeded();

      await panel.screenshot({ path: join(R2_CROPS_DIR, `R2-${project}-${lang}-expanded.png`) });

      await expect(agree.locator("[data-news-ladder]")).toHaveAttribute("aria-expanded", "true");
      await expect(evidence).toBeVisible();
      const clocks = evidence.locator(R2_CLS.clocks);
      await expect(clocks).toBeVisible();
      for (const label of R2_CLOCK_LABELS[lang]) {
        await expect(clocks).toContainText(label);
      }
      await expect(evidence.locator(R2_CLS.groupNote)).toBeVisible();
      await expect(evidence.locator(R2_CLS.sourceLink)).toHaveCount(2);
      const more = evidence.locator(R2_CLS.moreReports);
      await expect(more).toHaveText(R2_MORE[lang]);

      // Spec §3.6: inside the evidence view the clocks come first, then the group note,
      // then the members, then "Show n more" (rev4 P1-2); checked before the click removes it.
      const innerOrder = await evidence.evaluate((el, cls) => {
        const clocksEl = el.querySelector(cls.clocks);
        const noteEl = el.querySelector(cls.groupNote);
        const linkEl = el.querySelector(cls.sourceLink);
        const moreEl = el.querySelector(cls.moreReports);
        if (!clocksEl || !noteEl || !linkEl || !moreEl) return null;
        const following = (a: Element, b: Element) =>
          !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        return {
          clocksThenNote: following(clocksEl, noteEl),
          noteThenMember: following(noteEl, linkEl),
          memberThenMore: following(linkEl, moreEl),
        };
      }, R2_CLS);
      expect(innerOrder).toEqual({ clocksThenNote: true, noteThenMember: true, memberThenMore: true });
      await more.click();
      await expect(evidence.locator(R2_CLS.sourceLink)).toHaveCount(3);
      await expect(more).toHaveCount(0);

      // DOM order inside ev2_r2_differ: evidence view < NEXT CHECK < Mark reviewed.
      await expect(differ.locator("[data-news-mark-one]")).toBeVisible();
      const order = await differ.evaluate((el) => {
        const evidenceEl = el.querySelector('[role="group"]');
        const nextCheckEl = el.querySelector("[data-next-check]");
        const markEl = el.querySelector("[data-news-mark-one]");
        if (!evidenceEl || !nextCheckEl || !markEl) return null;
        const following = (a: Element, b: Element) =>
          !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        return {
          evidenceThenNext: following(evidenceEl, nextCheckEl),
          nextThenMark: following(nextCheckEl, markEl),
        };
      });
      expect(order).toEqual({ evidenceThenNext: true, nextThenMark: true });

      // The evidence box stays inside the panel box (runCell's boxes idiom).
      const boxes = await page.evaluate(() => {
        const evidenceEl = document.querySelector(
          '[data-testid="ticker-news-panel"] [data-story-id="ev2_r2_agree"] [role="group"]',
        );
        const panelEl = document.querySelector('[data-testid="ticker-news-panel"]');
        if (!evidenceEl || !panelEl) return null;
        const d = evidenceEl.getBoundingClientRect();
        const p = panelEl.getBoundingClientRect();
        return {
          d: { left: d.left, top: d.top, right: d.right, bottom: d.bottom },
          p: { left: p.left, top: p.top, right: p.right, bottom: p.bottom },
          vw: document.documentElement.clientWidth,
          vh: document.documentElement.clientHeight,
        };
      });
      if (!boxes) throw new Error("evidence box not measurable");
      expect(boxes.d.left).toBeGreaterThanOrEqual(boxes.p.left - 1);
      expect(boxes.d.top).toBeGreaterThanOrEqual(boxes.p.top - 1);
      expect(boxes.d.right).toBeLessThanOrEqual(boxes.p.right + 1);
      expect(boxes.d.bottom).toBeLessThanOrEqual(boxes.p.bottom + 1);
      expect(boxes.d.right).toBeLessThanOrEqual(boxes.vw + 1);
      expect(boxes.d.bottom).toBeLessThanOrEqual(boxes.vh + 1);

      expect(await r2Overflow(page)).toBeLessThanOrEqual(0);
    });

    test(`restricted cell (${lang})`, async ({ page, baseURL }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "restricted/unavailable are desktop cells (spec §7 R7).");
      await prepare(page, testInfo, baseURL, FLOW_OK, "live", "restricted");
      await setPresentation(page, lang);
      const panel = await openNews(page, "restricted");

      await panel.screenshot({ path: join(R2_CROPS_DIR, `R2-desktop-${lang}-restricted.png`) });

      await expect(panel.locator('[role="status"]')).toHaveText(R2_RESTRICTED[lang]);
      // Spec §3: the restricted state never shows Retry (#1105).
      await expect(panel.getByRole("button", { name: R2_RETRY[lang] })).toHaveCount(0);
      expect(await r2Overflow(page)).toBeLessThanOrEqual(0);
    });

    test(`unavailable cell (${lang})`, async ({ page, baseURL }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "restricted/unavailable are desktop cells (spec §7 R7).");
      await prepare(page, testInfo, baseURL, FLOW_OK, "live", "unavailable");
      await setPresentation(page, lang);
      const panel = await openNews(page, "unavailable");

      await panel.screenshot({ path: join(R2_CROPS_DIR, `R2-desktop-${lang}-unavailable.png`) });

      await expect(panel.locator('[role="status"]')).toHaveText(R2_UNAVAILABLE[lang]);
      // #1105: unavailable keeps the in-place Retry button.
      await expect(panel.getByRole("button", { name: R2_RETRY[lang] })).toBeVisible();
      expect(await r2Overflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test("static cell (en)", async ({ page, baseURL }, testInfo) => {
    const project = testInfo.project.name as ProjectName;
    await prepare(page, testInfo, baseURL, FLOW_OK, "live", "live");
    await setPresentation(page, "en");
    const panel = await openNews(page);
    const single = r2Row(panel, "ev2_r2_single");
    await single.scrollIntoViewIfNeeded();

    await panel.screenshot({ path: join(R2_CROPS_DIR, `R2-${project}-en-static.png`) });

    // A 1-report row renders the static chain: not a button, three steps, nothing
    // to expand and no NEXT CHECK (never on a 1-report row).
    const staticLadder = single.locator('[data-news-ladder="static"]');
    expect(await staticLadder.evaluate((el) => el.tagName)).not.toBe("BUTTON");
    await expect(staticLadder.locator("[data-step]")).toHaveCount(3);
    expect(await staticLadder.getAttribute("aria-expanded")).toBeNull();
    await expect(single.locator("[data-next-check]")).toHaveCount(0);
    expect(await r2Overflow(page)).toBeLessThanOrEqual(0);
  });

  test("catchup cell (en)", async ({ page, baseURL }, testInfo) => {
    const project = testInfo.project.name as ProjectName;
    await prepare(page, testInfo, baseURL, FLOW_OK, "catching_up", "catching_up");
    await setPresentation(page, "en");
    const panel = await openNews(page, "catching_up");
    const notcompared = r2Row(panel, "ev2_r2_notcompared");
    await notcompared.scrollIntoViewIfNeeded();

    await panel.screenshot({ path: join(R2_CROPS_DIR, `R2-${project}-en-catchup.png`) });

    // Precedence under a catching-up snapshot: the announcement row keeps
    // next.announcement; a not-compared reporting row earns next.catchup.
    await expect(notcompared.locator("[data-next-check]"))
      .toHaveAttribute("data-next-check", "next.catchup");
    await expect(r2Row(panel, "ev2_r2_press").locator("[data-next-check]"))
      .toHaveAttribute("data-next-check", "next.announcement");
    expect(await r2Overflow(page)).toBeLessThanOrEqual(0);
  });
});
