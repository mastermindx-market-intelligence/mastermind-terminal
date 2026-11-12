// @vitest-environment jsdom
/**
 * Unknown is not zero on the Flow Desk feed (review of #1198, M1/M2/m1/m2).
 *
 *   - With no feed the left rail draws NO flow gauge: an empty event list rendered as
 *     "$0" and an even call/put split is a reading the desk never made. The rail's
 *     existing states carry the truth instead: the unavailable note, the absent note,
 *     or the loading skeleton while a read is in flight.
 *   - A feed held from an earlier read whose latest read found nothing published says
 *     so (a status note with nothing to retry); a held feed whose latest read failed
 *     keeps the refresh-failed note with Retry. The note is keyed on the hook's
 *     `stale`, with a status-derived fallback for callers that do not pass it.
 *   - The ZH load-error reason no longer claims chain heat is unaffected, and the
 *     unavailable ring's track takes the theme hairline instead of a dark literal.
 */
import React, { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowStreamStatus } from "@/lib/flowStream";

const stream = vi.hoisted(() => ({
  data: null as unknown,
  status: "unavailable" as FlowStreamStatus,
  stale: false,
}));
const gauge = vi.hoisted(() => ({ calls: 0, Real: null as null | ((props: never) => unknown) }));
const pane = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));

vi.mock("@/lib/flowStream", () => ({
  useFlowStream: (f: string) => f === "feed"
    ? { data: stream.data, connected: false, error: false, status: stream.status, stale: stream.stale, retry: () => {} }
    : { data: null, connected: false, error: false, status: "loading", stale: false, retry: () => {} },
}));
vi.mock("@/components/flowdesk/WatchlistRail", () => ({ WatchlistRail: () => null }));
vi.mock("@/components/flowdesk/RadarStrip", () => ({ RadarStrip: () => null }));
vi.mock("@/components/flowdesk/FlowGauge", async () => {
  const R = await import("react");
  return {
    FlowGauge: (props: Record<string, unknown>) => {
      gauge.calls++;
      return gauge.Real ? R.createElement(gauge.Real as unknown as React.ComponentType, props) : null;
    },
  };
});
vi.mock("@/components/flowdesk/InspectorPane", () => ({ InspectorPane: () => null }));
vi.mock("@/components/flowdesk/FeedPane", () => ({
  FeedPane: (props: Record<string, unknown>) => { pane.props = props; return null; },
  normalizeEnrichPayload: (raw: unknown) => raw,
}));
vi.mock("@/components/flowdesk/FiltersPanel", () => ({ DEFAULT_FILTERS: {} }));
vi.mock("@/components/tutorial/TutorialOverlay", () => ({ TutorialOverlay: () => null }));

import { FlowDeskView } from "@/components/flowdesk/FlowDeskView";
import type { FeedPane as FeedPaneComponent, FeedPayload, FlowEvent } from "@/components/flowdesk/FeedPane";
import type { DEFAULT_FILTERS as DEFAULT_FILTERS_TYPE } from "@/components/flowdesk/FiltersPanel";
import { RingGauge } from "@/components/ui/RingGauge";
import { FD, getFlowStr } from "@/lib/flowdeskStrings";

const actualFeed = await vi.importActual<typeof import("@/components/flowdesk/FeedPane")>("@/components/flowdesk/FeedPane");
const actualFilters = await vi.importActual<typeof import("@/components/flowdesk/FiltersPanel")>("@/components/flowdesk/FiltersPanel");
const actualGauge = await vi.importActual<typeof import("@/components/flowdesk/FlowGauge")>("@/components/flowdesk/FlowGauge");
const RealFeedPane: typeof FeedPaneComponent = actualFeed.FeedPane;
const REAL_DEFAULT_FILTERS: typeof DEFAULT_FILTERS_TYPE = actualFilters.DEFAULT_FILTERS;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WATCHLIST_UNAVAILABLE = {
  en: "Session flow totals and the watchlist need the flow feed, which did not load.",
  zh: "本时段资金流合计与观察列表依赖资金流数据，目前未能加载。",
};
const REFRESH_ABSENT = {
  en: "The latest read found no flow feed published — showing the last read.",
  zh: "最新读取未发现已发布的资金流数据 — 显示上次读取的数据。",
};

const feedEv = (over: Partial<FlowEvent> = {}): FlowEvent => ({
  id: "ev1", ts: "2026-10-16T14:05:00Z", root: "SPX", group: "Index", group_zh: "指数",
  right: "C", exp: "2026-10-16", strike: 6000, dte: 0, dte_bucket: "0d",
  mny_bucket: "atm", side: "~buy", n_prints: 12, size: 250, avg_price: 3.1,
  premium: 930000, premium_z: 4.2, baseline_source: "90d", vol_gt_oi: true,
  repeated: false, zerodte: true, signing_source: "iso", ...over,
});
const feedPayload = (events: FlowEvent[]): FeedPayload => ({
  asof: "2026-10-16T15:00:00Z", session_date: "2026-10-16", events, unusual_names: [],
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  gauge.calls = 0;
  gauge.Real = actualGauge.FlowGauge as unknown as (props: never) => unknown;
  pane.props = null;
  stream.data = null;
  stream.status = "unavailable";
  stream.stale = false;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  try { localStorage.setItem("flowdesk.tutorial.seen", "1"); } catch { /* blocked storage */ }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render(ui: React.ReactElement) {
  await act(async () => root.render(ui));
}

const leftRail = () => host.querySelector(".obs-fd-left")!;

function expectNoGaugeReading() {
  expect(gauge.calls, "FlowGauge rendered without a feed").toBe(0);
  expect(host.querySelector('[data-testid="flow-gauge-slot"]')).toBeNull();
  const text = leftRail().textContent ?? "";
  expect(text).not.toContain("$0");
  expect(text).not.toContain("50%");
}

describe("Flow Desk left rail: no flow gauge without a feed (M1)", () => {
  it("(a) feed null + unavailable: no gauge, and the rail note names what did not load", async () => {
    stream.status = "unavailable";
    await render(<FlowDeskView />);
    expectNoGaugeReading();
    const note = host.querySelector('[data-testid="watchlist-feed-unavailable"]')!;
    expect(note).not.toBeNull();
    expect(note.textContent).toBe(WATCHLIST_UNAVAILABLE.en);
    expect(getFlowStr("zh", "watchlistFeedUnavailable")).toBe(WATCHLIST_UNAVAILABLE.zh);
  });

  it("(b) feed null + loading: no gauge and no $0, only the rail skeleton", async () => {
    stream.status = "loading";
    await render(<FlowDeskView />);
    expectNoGaugeReading();
    expect(leftRail().querySelector(".fin-skel")).not.toBeNull();
  });

  it("(c) feed null + absent: no gauge, the absent note carries the rail", async () => {
    stream.status = "absent";
    await render(<FlowDeskView />);
    expectNoGaugeReading();
    expect(host.querySelector('[data-testid="watchlist-feed-absent"]')).not.toBeNull();
  });

  it("a held feed draws the gauge inside a layout-neutral slot", async () => {
    stream.data = feedPayload([feedEv({})]);
    stream.status = "data";
    await render(<FlowDeskView />);
    expect(gauge.calls).toBeGreaterThan(0);
    const slot = host.querySelector<HTMLElement>('[data-testid="flow-gauge-slot"]')!;
    expect(slot).not.toBeNull();
    expect(slot.style.display).toBe("contents");
  });

  it("passes the hook's stale to FeedPane", async () => {
    stream.data = feedPayload([feedEv({})]);
    stream.status = "absent";
    stream.stale = true;
    await render(<FlowDeskView />);
    expect(pane.props?.stale).toBe(true);
  });
});

function mountPane(lang: "en" | "zh", opts: { feed: FeedPayload | null; status?: FlowStreamStatus; stale?: boolean; onRetry?: () => void }) {
  return render(
    <RealFeedPane
      feed={opts.feed}
      connected={false}
      flowMeta={null}
      enrich={null}
      lang={lang}
      selectedId={null}
      onSelect={() => {}}
      filters={{ ...REAL_DEFAULT_FILTERS }}
      onFiltersChange={() => {}}
      status={opts.status}
      onRetry={opts.onRetry}
      {...(opts.stale === undefined ? {} : { stale: opts.stale })}
    />,
  );
}

describe.each([
  ["with the hook's stale", true],
  ["without the stale prop (status-derived)", undefined],
] as const)("FeedPane: a held feed says why it is held (M2, %s)", (_label, stale) => {
  it.each(["en", "zh"] as const)("(d/f) data then absent: cards stay, a no-retry absent note shows (%s)", async (lang) => {
    await mountPane(lang, { feed: feedPayload([feedEv({})]), status: "absent", stale });
    const note = host.querySelector('[data-testid="flowfeed-refresh-absent"]')!;
    expect(note).not.toBeNull();
    expect(note.getAttribute("role")).toBe("status");
    expect(note.textContent).toBe(REFRESH_ABSENT[lang]);
    expect(note.querySelector("button")).toBeNull();
    expect(host.querySelector(".obs-fc-card")).not.toBeNull();
    expect(host.querySelector('[data-testid="flowfeed-refresh-failed"]')).toBeNull();
  });

  it.each(["en", "zh"] as const)("(e/f) data then unavailable: the refresh-failed note and Retry are unchanged (%s)", async (lang) => {
    const onRetry = vi.fn();
    await mountPane(lang, { feed: feedPayload([feedEv({})]), status: "unavailable", stale, onRetry });
    const note = host.querySelector('[data-testid="flowfeed-refresh-failed"]')!;
    expect(note).not.toBeNull();
    expect(note.textContent).toContain(lang === "zh" ? FD.feedRefreshFailed.zh : FD.feedRefreshFailed.en);
    const retry = note.querySelector("button")!;
    expect(retry.textContent).toBe(lang === "zh" ? FD.errRetry.zh : FD.errRetry.en);
    await act(async () => { retry.click(); });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="flowfeed-refresh-absent"]')).toBeNull();
    expect(host.querySelector(".obs-fc-card")).not.toBeNull();
  });
});

describe("FeedPane: a fresh read carries no held-feed note", () => {
  it("data + stale false: neither note shows", async () => {
    await mountPane("en", { feed: feedPayload([feedEv({})]), status: "data", stale: false });
    expect(host.querySelector('[data-testid="flowfeed-refresh-absent"]')).toBeNull();
    expect(host.querySelector('[data-testid="flowfeed-refresh-failed"]')).toBeNull();
  });
});

describe("copy and token repairs (m1, m2)", () => {
  it("(g) the ZH load-error reason does not claim chain heat is unaffected", () => {
    expect(FD.feedErrorWhy.zh).toBe("读取未能到达数据源，因此无法判断今日的资金流。链式热度单独读取。");
    expect(FD.feedErrorWhy.zh).not.toContain("不受影响");
  });

  it("(h) the unavailable ring's track takes the theme hairline, not an rgba literal", async () => {
    await render(<RingGauge value={null} />);
    const track = host.querySelector('[data-score-state="unavailable"] circle')!;
    expect(track).not.toBeNull();
    expect(track.getAttribute("stroke")).toBeNull();
    expect(track.getAttribute("style") ?? "").toContain("var(--hairline)");
    expect(track.getAttribute("style") ?? "").not.toMatch(/rgba\(/);
  });

  it("the dark root defines --hairline as the literal the track used, so dark pixels hold", () => {
    const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");
    expect(css).toMatch(/--hairline:\s*rgba\(255,255,255,\.08\);/);
  });
});

// Audit r6 G1: the held-feed note sat loose in the first card cell of the feed grid
// (pushing the first card right), and the gauge drew the last read's totals unqualified.
const GAUGE_HELD = { en: "Totals are from the last read", zh: "合计为上次读取的数据" };

describe("G1: a held feed's note is its own row, and the gauge qualifies its totals", () => {
  it("the feed grid's state-row helper spans every column", () => {
    const css = readFileSync(join(__dirname, "../../app/observatory.css"), "utf8");
    expect(css).toContain(".obs-fd-feed-state{grid-column:1/-1}");
  });

  it.each([
    ["absent", "flowfeed-refresh-absent"],
    ["unavailable", "flowfeed-refresh-failed"],
  ] as const)("data then %s: the note is a full-width grid row before every card, not a card cell", async (status, testid) => {
    const feed = feedPayload([feedEv({ id: "a" }), feedEv({ id: "b", root: "NVDA" })]);
    await mountPane("en", { feed, status, stale: true, onRetry: () => {} });
    const grid = host.querySelector(".obs-fd-list")!;
    const note = host.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!;
    expect(note).not.toBeNull();
    expect(note.parentElement).toBe(grid);
    expect(note.classList.contains("obs-fd-feed-state")).toBe(true);
    expect(note.closest(".obs-fc-card")).toBeNull();
    const cards = grid.querySelectorAll(".obs-fc-card");
    expect(cards.length).toBe(2);
    for (const card of cards) {
      expect(note.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // Even borders on a neutral row: one border on every side, no single-edge rule.
    const css = note.getAttribute("style") ?? "";
    expect(css).toContain("border: 1px solid var(--line-2)");
    expect(css).not.toMatch(/border-(left|right|top|bottom)/);
  });

  it.each([
    ["absent", true, true],
    ["unavailable", true, true],
    ["absent", false, false],
    ["data", false, false],
  ] as const)("FlowDeskView: status %s, stale %s: the gauge's last-read qualifier shown=%s", async (status, stale, shown) => {
    stream.data = feedPayload([feedEv({})]);
    stream.status = status;
    stream.stale = stale;
    await render(<FlowDeskView />);
    const g = host.querySelector('[data-tut="flow-gauge"]')!;
    expect(g).not.toBeNull();
    const q = g.querySelector('[data-testid="flow-gauge-held"]');
    if (!shown) {
      expect(q).toBeNull();
      return;
    }
    expect(q).not.toBeNull();
    expect(q!.textContent).toBe(GAUGE_HELD.en);
    expect(q!.getAttribute("role")).toBe("note");
    // The qualifier comes before the totals it qualifies.
    const total = g.querySelector(".num")!;
    expect(q!.compareDocumentPosition(total) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each(["en", "zh"] as const)("FlowGauge held: the qualifier reads in %s; without held there is none", async (lang) => {
    const Real = actualGauge.FlowGauge;
    await render(<Real feed={feedPayload([feedEv({})]) as never} lang={lang} held />);
    expect(host.querySelector('[data-testid="flow-gauge-held"]')!.textContent).toBe(GAUGE_HELD[lang]);
    expect(lang === "zh" ? FD.gaugeHeld.zh : FD.gaugeHeld.en).toBe(GAUGE_HELD[lang]);
    await render(<Real feed={feedPayload([feedEv({})]) as never} lang={lang} />);
    expect(host.querySelector('[data-testid="flow-gauge-held"]')).toBeNull();
  });
});
