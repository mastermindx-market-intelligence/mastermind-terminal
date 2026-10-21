import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isolateWatchlistStore } from "./watchlistStore";
import { NEWS_VIEW } from "../lib/__tests__/fixtures/newsEditorial";

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
  updated_at: string;
  received_at: string;
  universe_revision: string;
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

async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, flow: unknown, snapshotState: "live" | "catching_up") {
  await isolateWatchlistStore(page, testInfo, baseURL);
  await installEventSourceStub(page);

  await page.route("**/data/manifest.json**", (route) => route.fulfill({ json: MANIFEST }));
  await page.route("**/api/quote**", (route) => route.fulfill({
    json: { quotes: { NVDA: { last: 180.2, chg: 2.5 } } },
  }));
  await page.route(/\/api\/news\/NVDA(?:\?.*)?$/, (route) => route.fulfill({ json: snapshotFor(snapshotState, flow) }));

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
