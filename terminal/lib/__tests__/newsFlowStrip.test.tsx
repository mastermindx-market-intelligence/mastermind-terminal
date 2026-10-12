// @vitest-environment jsdom
// Wave B3 — render pins for components/news/NewsFlowStrip.tsx and its mount inside
// TickerNewsPanel (design pin P6/P7). Strip-level cases cover every spec section 5
// state; panel-level cases pin the hiding rules, the keyboard path and the
// accessible wiring. @testing-library is not a dependency of this repo, so this
// suite uses the same createRoot + act + accessibleName pattern as
// tickerNewsA11y.test.tsx.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NewsFlowStrip from "@/components/news/NewsFlowStrip";
import TickerNewsPanel from "@/components/news/TickerNewsPanel";
import type { TickerNewsSnapshot, TickerNewsStoryRow, TickerNewsState, TickerNewsFlow } from "@/lib/newsTypes";
import { parseTickerNewsFlow } from "@/lib/newsValidation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The feed hook is mocked at module level so the mount predicate in
// TickerNewsPanel is exercised directly (the real hook never publishes a
// mismatched ticker, so the symbol-guard case is unreachable through fetch).
const M = vi.hoisted(() => ({
  feed: {
    snapshot: null as null | unknown,
    loadState: "loading" as string,
    liveInterrupted: false,
  },
}));
vi.mock("@/components/news/useTickerNewsFeed", () => ({
  useTickerNewsFeed: (_symbol: string) => M.feed,
}));

// ---- contract section 5 fixtures (verbatim; see newsFlowContract.test.ts) ------

const FLOW_METHOD =
  "distinct reports by source + source_item_id; active status only; " +
  "rights-allowed sources only; UTC calendar days; median of 28 prior days";

const flowProvenance = (publishedAt: number, receivedAt: number) => ({
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
  schema: "ticker_news.flow.v1", state: "ok", reason: null, coverage: "complete",
  as_of: "2026-10-12T10:30:00Z", reports_24h: 7, reports_7d: 21, stories_24h: 4,
  median_daily_28d: 2.5, daily_counts_28d: OK_DAILY, history_days_observed: 28,
  comparison: "busier", provenance: flowProvenance(6, 1),
} as unknown as TickerNewsFlow;

const FLOW_PARTIAL = { ...FLOW_OK, coverage: "partial", comparison: null } as TickerNewsFlow;
const FLOW_THIN = {
  schema: "ticker_news.flow.v1", state: "thin_history", reason: null, coverage: "complete",
  as_of: "2026-10-12T10:30:00Z", reports_24h: 2, reports_7d: 3, stories_24h: 2,
  median_daily_28d: null, daily_counts_28d: THIN_DAILY, history_days_observed: 6,
  comparison: "insufficient_history", provenance: flowProvenance(2, 0),
} as unknown as TickerNewsFlow;
const FLOW_THIN_PARTIAL = { ...FLOW_THIN, coverage: "partial", comparison: null } as TickerNewsFlow;
const FLOW_NO_ACCESS = {
  schema: "ticker_news.flow.v1", state: "unavailable", reason: "no_accessible_sources", coverage: "complete",
  as_of: null, reports_24h: null, reports_7d: null, stories_24h: null, median_daily_28d: null,
  daily_counts_28d: null, history_days_observed: null, comparison: null, provenance: null,
} as unknown as TickerNewsFlow;
const FLOW_UNAVAILABLE = { ...FLOW_NO_ACCESS, reason: "calculation_failed" } as TickerNewsFlow;

// Terminal-only glance fixtures (design pin P13 definitions).
const FLOW_TYPICAL = {
  ...FLOW_OK, reports_24h: 3, reports_7d: 17, stories_24h: 2, comparison: "typical",
  provenance: flowProvenance(3, 0),
} as unknown as TickerNewsFlow;
const FLOW_QUIETER = {
  ...FLOW_OK, reports_24h: 1, reports_7d: 15, stories_24h: 1, comparison: "quieter",
  provenance: flowProvenance(1, 0),
} as unknown as TickerNewsFlow;
// Spec section 5: ok, zero today — median below 2 keeps the comparison typical.
const FLOW_ZERO_TYPPICAL = {
  ...FLOW_OK, reports_24h: 0, reports_7d: 12, stories_24h: 0, median_daily_28d: 1,
  comparison: "typical", provenance: flowProvenance(0, 0),
} as unknown as TickerNewsFlow;
// Spec section 5: ok, zero today with median at least 2 reads quieter.
const FLOW_ZERO_QUIETER = {
  ...FLOW_OK, reports_24h: 0, reports_7d: 12, stories_24h: 0, median_daily_28d: 2,
  comparison: "quieter", provenance: flowProvenance(0, 0),
} as unknown as TickerNewsFlow;

/** Parse a wire fixture through the real parser so the strip gets a typed flow. */
const flow = (fixture: unknown): TickerNewsFlow => parseTickerNewsFlow(fixture);

// ---- panel harness ------------------------------------------------------------

const row = (storyId: string, sequence: number): TickerNewsStoryRow => ({
  sequence,
  source: "benzinga",
  source_item_id: storyId + "-item",
  story_id: storyId,
  source_count: 1,
  item_count: 1,
  title: "Story " + storyId,
  url: "https://www.benzinga.com/news/" + storyId,
  teaser: "",
  published_at: "2026-10-05T14:00:00+00:00",
  updated_at: null,
  received_at: "2026-10-05T14:01:01+00:00",
  universe_revision: "sp500-r1",
});

const panelSnapshot = (over: {
  flow?: TickerNewsFlow | null;
  rows?: TickerNewsStoryRow[];
  state?: TickerNewsState;
  ticker?: string;
} = {}): TickerNewsSnapshot => ({
  schema: "ticker_news.snapshot.v1",
  ticker: over.ticker ?? "NVDA",
  security_id: "SEC:US-XNAS-NVDA",
  state: over.state ?? "live",
  rows: over.rows ?? [row("ev2_a", 2), row("ev2_b", 1)],
  next_cursor: null,
  has_more: false,
  source_health: { state: "live", last_successful_catchup: "2026-10-05T14:01:01+00:00" },
  flow: over.flow === undefined ? null : over.flow,
});

/** jsdom's own window: Node's built-in `localStorage` global shadows jsdom's here. */
const jsdomWindow = () => (globalThis as unknown as { jsdom: { window: Window & typeof globalThis } }).jsdom.window;

let host: HTMLDivElement;
let root: Root;

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

function accessibleName(el: Element): string {
  const label = el.getAttribute("aria-label");
  if (label && label.trim()) return label.replace(/\s+/g, " ").trim();
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

const stripEl = () => host.querySelector("[data-testid=ticker-news-panel] [data-flow-state]");
const moreButton = () =>
  host.querySelector<HTMLButtonElement>("[data-testid=ticker-news-panel] [data-flow-state] button");

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: jsdomWindow().localStorage, configurable: true, writable: true });
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  M.feed.snapshot = null;
  M.feed.loadState = "loading";
  M.feed.liveInterrupted = false;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

// ---- strip-level: every spec section 5 state ----------------------------------

describe("NewsFlowStrip — glance line per state (spec section 5)", () => {
  const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

  const renderStrip = (fixture: unknown, lang: "en" | "zh") => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const strip = createRoot(container);
    act(() => {
      strip.render(<NewsFlowStrip flow={flow(fixture)} lang={lang} />);
    });
    return { container, strip };
  };

  const cases = [
    ["ok busier", FLOW_OK, "7 reports in 24h·, Busier than a typical day", "24小时内 7 条报道·, 比平日更密集"],
    ["ok typical", FLOW_TYPICAL, "3 reports in 24h·, About a typical day", "24小时内 3 条报道·, 与平日相当"],
    ["ok quieter", FLOW_QUIETER, "1 report in 24h·, Quieter than a typical day", "24小时内 1 条报道·, 比平日清淡"],
    ["ok zero today with median below 2", FLOW_ZERO_TYPPICAL, "No reports in 24h·, About a typical day", "24小时内暂无报道·, 与平日相当"],
    ["ok zero today normally covered", FLOW_ZERO_QUIETER, "No reports in 24h·, Quieter than a typical day", "24小时内暂无报道·, 比平日清淡"],
    ["thin history", FLOW_THIN, "2 reports in 24h·, Too little history to compare", "24小时内 2 条报道·, 历史尚短，暂不比较"],
    ["partial coverage", FLOW_PARTIAL, "7 reports in 24h·, Counts may be incomplete", "24小时内 7 条报道·, 计数可能不完整"],
    ["thin and partial", FLOW_THIN_PARTIAL, "2 reports in 24h·, Counts may be incomplete", "24小时内 2 条报道·, 计数可能不完整"],
  ] as const;

  it.each(cases)("%s renders the composed line in EN and ZH", (_name, fixture, en, zh) => {
    for (const lang of ["en", "zh"] as const) {
      const { container, strip } = renderStrip(fixture, lang);
      const line = container.querySelector("[data-flow-state] p");
      expect(line, lang).toBeTruthy();
      expect(normalize(line!.textContent!), lang).toBe(lang === "en" ? en : zh);
      act(() => strip.unmount());
      container.remove();
    }
  });

  it.each([
    ["calculation_failed", FLOW_UNAVAILABLE],
    ["malformed", { garbage: true }],
  ])("unavailable (%s) renders only the unavailable sentence, with no button", (_name, fixture) => {
    for (const lang of ["en", "zh"] as const) {
      const { container, strip } = renderStrip(fixture, lang);
      const box = container.querySelector("[data-flow-state]")!;
      expect(box.getAttribute("data-flow-state"), lang).toBe("unavailable");
      expect(box.querySelector("button"), lang).toBeNull();
      expect(box.querySelectorAll("*").length, lang).toBe(1); // the <p> only
      const expected =
        lang === "en" ? "Report counts unavailable right now" : "报道计数暂不可用";
      expect(normalize(box.textContent!), lang).toBe(expected);
      act(() => strip.unmount());
      container.remove();
    }
  });

  it("busier, typical and quieter differ only in the comparison words", () => {
    const compareText = (fixture: unknown) => {
      const { container, strip } = renderStrip(fixture, "en");
      const out = container.querySelector("[data-flow-state] p")!.lastElementChild!.textContent;
      act(() => strip.unmount());
      container.remove();
      return out;
    };
    const words = [compareText(FLOW_OK), compareText(FLOW_TYPICAL), compareText(FLOW_QUIETER)];
    expect(new Set(words).size).toBe(3);
  });
});

// ---- panel-level: mount and hiding rules --------------------------------------

describe("TickerNewsPanel — news-flow strip mount (design pin P6)", () => {
  const renderPanel = async (over: Parameters<typeof panelSnapshot>[0], symbol = "NVDA", lang: "en" | "zh" = "en") => {
    M.feed.snapshot = panelSnapshot(over);
    M.feed.loadState = "ready";
    await render(<TickerNewsPanel symbol={symbol} lang={lang} userId="user-a" />);
  };

  it("mounts the strip for a ready snapshot with flow", async () => {
    await renderPanel({ flow: flow(FLOW_OK) });
    const strip = stripEl();
    expect(strip).toBeTruthy();
    expect(strip!.getAttribute("data-flow-state")).toBe("ok");
    expect(strip!.getAttribute("data-comparison")).toBe("busier");
    expect(strip!.getAttribute("data-coverage")).toBe("complete");
  });

  it("mounts the strip directly after the rail bar, outside the scroll area", async () => {
    await renderPanel({ flow: flow(FLOW_OK) });
    const panel = host.querySelector("[data-testid=ticker-news-panel]")!;
    expect(panel.children[0].tagName).toBe("DIV"); // .bar
    expect(panel.children[1]).toBe(stripEl());
  });

  it.each([
    ["flow null (old API, or a cursor page)", { flow: null }],
    ["reason no_accessible_sources", { flow: flow(FLOW_NO_ACCESS) }],
    ["zero rows (the empty state already speaks)", { flow: flow(FLOW_OK), rows: [] }],
    ["snapshot state restricted", { flow: flow(FLOW_OK), state: "restricted" }],
    ["snapshot state unavailable", { flow: flow(FLOW_OK), state: "unavailable" }],
  ])("the strip is hidden when %s", async (_name, over) => {
    await renderPanel(over);
    expect(stripEl()).toBeNull();
  });

  it("the strip is hidden while snapshot.ticker differs from the symbol prop", async () => {
    await renderPanel({ flow: flow(FLOW_OK), ticker: "MSFT" }, "NVDA");
    expect(stripEl()).toBeNull();
  });

  it("the strip is hidden while the feed is not ready", async () => {
    M.feed.snapshot = panelSnapshot({ flow: flow(FLOW_OK) });
    M.feed.loadState = "loading";
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    expect(stripEl()).toBeNull();
  });

  it("the live dot is rendered through NewsLiveDot with a localized name", async () => {
    await renderPanel({ flow: flow(FLOW_OK) }, "NVDA", "en");
    const enDot = host.querySelector("[data-news-live-dot]");
    expect(enDot?.getAttribute("role")).toBe("img");
    expect(accessibleName(enDot!)).toBe("Live");

    await act(async () => root.unmount());
    root = createRoot(host);
    M.feed.snapshot = panelSnapshot({ flow: flow(FLOW_OK) });
    M.feed.loadState = "ready";
    await render(<TickerNewsPanel symbol="NVDA" lang="zh" userId="user-a" />);
    expect(accessibleName(host.querySelector("[data-news-live-dot]")!)).toBe("实时");
  });
});

// ---- panel-level: details interaction (G9) ------------------------------------

describe("TickerNewsPanel — news-flow details control (G9)", () => {
  const openDetails = async () => {
    M.feed.snapshot = panelSnapshot({ flow: flow(FLOW_OK) });
    M.feed.loadState = "ready";
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    const button = moreButton()!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    return button;
  };

  it("the control is a native button, so Enter and Space toggle it (platform behavior)", async () => {
    M.feed.snapshot = panelSnapshot({ flow: flow(FLOW_OK) });
    M.feed.loadState = "ready";
    await render(<TickerNewsPanel symbol="NVDA" lang="en" userId="user-a" />);
    const button = moreButton()!;
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(accessibleName(button)).toBe("How these counts work");
  });

  it("opens on click; aria-expanded flips and aria-controls points at the details", async () => {
    const button = await openDetails();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const details = host.querySelector(`#${CSS.escape(button.getAttribute("aria-controls")!)}`)!;
    expect(details.tagName).toBe("SECTION");
    expect(details.querySelector("h3")?.textContent).toBe("Report count, last 28 days");

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(`#${CSS.escape(button.getAttribute("aria-controls")!)}`)).toBeNull();
  });

  it("Escape closes the details and returns focus to the button", async () => {
    const button = await openDetails();
    button.focus();
    expect(document.activeElement).toBe(button);
    await act(async () => {
      button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("no element inside the panel carries a title attribute (details open)", async () => {
    await openDetails();
    expect(host.querySelectorAll("[data-testid=ticker-news-panel] [title]")).toHaveLength(0);
  });

  it("the tally aria-label carries the numbers", async () => {
    await openDetails();
    const svg = host.querySelector("[data-testid=ticker-news-panel] [data-flow-state] svg[role=img]");
    expect(svg).toBeTruthy();
    const label = svg!.getAttribute("aria-label") ?? "";
    expect(label).toContain("28 days on record");
    expect(label).toContain("typical day 2.5");
    expect(label).toContain("last 24 hours 7");
  });

  it("the details list the facts as dt/dd pairs with the fixture numbers", async () => {
    await openDetails();
    const facts = host.querySelector("[data-testid=ticker-news-panel] dl");
    expect(facts).toBeTruthy();
    const dts = [...facts!.querySelectorAll("dt")].map((el) => el.textContent);
    expect(dts).toEqual([
      "Typical day", "Last 7 days", "Last 24h",
      "Placed by published time", "Placed by received time",
      "Sources counted", "Counted at",
    ]);
    const dds = [...facts!.querySelectorAll("dd")].map((el) => el.textContent);
    expect(dds[0]).toBe("2.5 reports (median of the 28 days before today)");
    expect(dds[1]).toBe("21 reports");
    expect(dds[2]).toBe("7 reports in 4 stories");
    expect(dds[3]).toBe("6");
    expect(dds[4]).toBe("1");
    expect(dds[5]).toContain("Benzinga");
  });
});
