// @vitest-environment jsdom
/**
 * Failure-state truth on the Flow Desk's feed: a read that did not land is not
 * "still loading", and the left rail that depends on the feed says so too.
 *
 * FeedPane is mounted for real with the new optional `status`/`onRetry` props:
 *   - status "unavailable" + no feed → a load error (role=alert) with Retry, no skeletons;
 *   - status "absent" + no feed      → published absence, nothing to retry;
 *   - status "loading" (or the prop absent — today's behavior) → the loading skeletons;
 *   - a held feed + "unavailable"    → the cards stay AND a refresh-failed note shows.
 * One FlowDeskView-level case (transport mocked, mirrors the chain-heat failure test)
 * pins the left rail: feed unavailable shows the watchlist feed note instead of the
 * endless rail skeleton.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stream = vi.hoisted(() => ({
  status: "unavailable" as "unavailable" | "loading",
  retry: vi.fn(),
}));
vi.mock("@/lib/flowStream", () => ({
  useFlowStream: () => ({
    data: null, connected: false, error: false,
    status: stream.status, stale: false, retry: () => stream.retry(),
  }),
}));
vi.mock("@/components/flowdesk/WatchlistRail", () => ({ WatchlistRail: () => null }));
vi.mock("@/components/flowdesk/RadarStrip", () => ({ RadarStrip: () => null }));
vi.mock("@/components/flowdesk/FlowGauge", () => ({ FlowGauge: () => null }));
vi.mock("@/components/flowdesk/InspectorPane", () => ({ InspectorPane: () => null }));
vi.mock("@/components/flowdesk/FeedPane", () => ({
  FeedPane: () => null,
  normalizeEnrichPayload: (raw: unknown) => raw,
}));
vi.mock("@/components/flowdesk/FiltersPanel", () => ({ DEFAULT_FILTERS: {} }));
vi.mock("@/components/tutorial/TutorialOverlay", () => ({ TutorialOverlay: () => null }));

import { FlowDeskView } from "@/components/flowdesk/FlowDeskView";
import type { FeedPane as FeedPaneComponent, FeedPayload, FlowEvent } from "@/components/flowdesk/FeedPane";
import type { DEFAULT_FILTERS as DEFAULT_FILTERS_TYPE } from "@/components/flowdesk/FiltersPanel";
import { FD, getFlowStr } from "@/lib/flowdeskStrings";
import { flowInvalidate } from "@/lib/flowClientCache";
import type { FlowStreamStatus } from "@/lib/flowStream";

// The REAL FeedPane and DEFAULT_FILTERS for direct mounting (the module is mocked
// above only as a FlowDeskView child); FlowDeskView itself keeps the mocked child.
const actualFeed = await vi.importActual<typeof import("@/components/flowdesk/FeedPane")>("@/components/flowdesk/FeedPane");
const actualFilters = await vi.importActual<typeof import("@/components/flowdesk/FiltersPanel")>("@/components/flowdesk/FiltersPanel");
const RealFeedPane: typeof FeedPaneComponent = actualFeed.FeedPane;
const REAL_DEFAULT_FILTERS: typeof DEFAULT_FILTERS_TYPE = actualFilters.DEFAULT_FILTERS;

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const word = (lang: "en" | "zh", key: Parameters<typeof getFlowStr>[1]) => getFlowStr(lang, key);
const EN = { err: FD.errFeed.en, why: FD.feedErrorWhy.en, absent: FD.feedAbsent.en, refreshFailed: FD.feedRefreshFailed.en, loading: FD.feedLoading.en, watchlistUnavailable: word("en", "watchlistFeedUnavailable") };
const ZH = { err: FD.errFeed.zh, why: FD.feedErrorWhy.zh, absent: FD.feedAbsent.zh, refreshFailed: FD.feedRefreshFailed.zh, loading: FD.feedLoading.zh, watchlistUnavailable: word("zh", "watchlistFeedUnavailable") };

const feedEv = (over: Partial<FlowEvent> = {}): FlowEvent => ({
  id: "ev1", ts: "2026-10-16T14:05:00Z", root: "SPX", group: "Index", group_zh: "指数",
  right: "C", exp: "2026-10-16", strike: 6000, dte: 0, dte_bucket: "0d",
  mny_bucket: "atm", side: "~buy", n_prints: 12, size: 250, avg_price: 3.1,
  premium: 930000, premium_z: 4.2, baseline_source: "90d", vol_gt_oi: true,
  repeated: false, zerodte: true, signing_source: "iso", ...over,
});

const feedPayload = (events: FlowEvent[]): FeedPayload => ({
  asof: "2026-10-16T15:00:00Z",
  session_date: "2026-10-16",
  events,
  unusual_names: [],
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
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

function mountPane(lang: "en" | "zh", opts: { feed: FeedPayload | null; status?: FlowStreamStatus; onRetry?: () => void }) {
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
    />,
  );
}

describe.each([
  ["en", EN],
  ["zh", ZH],
] as const)("FeedPane (%s): a failed feed read is not a read still in flight", (lang, W) => {
  it("feed=null + status unavailable renders a role=alert load error with Retry, no skeletons", async () => {
    const onRetry = vi.fn();
    await mountPane(lang, { feed: null, status: "unavailable", onRetry });
    const error = host.querySelector('[data-testid="flowfeed-load-error"]')!;
    expect(error).not.toBeNull();
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent).toContain(W.err);
    expect(error.textContent).toContain(W.why);
    expect(host.querySelectorAll(".obs-fd-card-skel").length).toBe(0);
    const retry = [...error.querySelectorAll("button")][0];
    expect(retry.textContent).toBe(lang === "zh" ? FD.errRetry.zh : FD.errRetry.en);
    expect(onRetry).not.toHaveBeenCalled();
    await act(async () => { retry.click(); });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("feed=null + status absent renders published absence, no skeleton, no alert", async () => {
    await mountPane(lang, { feed: null, status: "absent" });
    const absent = host.querySelector('[data-testid="flowfeed-absent"]')!;
    expect(absent).not.toBeNull();
    expect(absent.textContent).toContain(W.absent);
    expect(host.querySelector('[data-testid="flowfeed-load-error"]')).toBeNull();
    expect(host.querySelectorAll(".obs-fd-card-skel").length).toBe(0);
  });

  it("feed=null + status loading keeps the loading skeletons", async () => {
    await mountPane(lang, { feed: null, status: "loading" });
    expect(host.textContent).toContain(W.loading);
    expect(host.querySelectorAll(".obs-fd-card-skel").length).toBeGreaterThan(0);
    expect(host.querySelector('[data-testid="flowfeed-load-error"]')).toBeNull();
    expect(host.querySelector('[data-testid="flowfeed-absent"]')).toBeNull();
  });

  it("no status prop behaves exactly as today (loading skeletons)", async () => {
    await mountPane(lang, { feed: null });
    expect(host.querySelectorAll(".obs-fd-card-skel").length).toBeGreaterThan(0);
  });

  it("a held feed + status unavailable keeps the cards AND shows a role=status refresh-failed note", async () => {
    await mountPane(lang, { feed: feedPayload([feedEv({})]), status: "unavailable" });
    const note = host.querySelector('[data-testid="flowfeed-refresh-failed"]')!;
    expect(note).not.toBeNull();
    expect(note.getAttribute("role")).toBe("status");
    expect(note.textContent).toContain(W.refreshFailed);
    expect(host.querySelector(".obs-fc-card")).not.toBeNull();
    expect(host.querySelector('[data-testid="flowfeed-load-error"]')).toBeNull();
  });
});

describe("Flow Desk left rail: a feed the desk could not read is not an endless skeleton", () => {
  it("feed unavailable shows the watchlist feed note instead of the rail skeleton", async () => {
    try { localStorage.setItem("flowdesk.tutorial.seen", "1"); } catch {}
    await render(<FlowDeskView />);
    const note = host.querySelector('[data-testid="watchlist-feed-unavailable"]')!;
    expect(note).not.toBeNull();
    expect(note.getAttribute("role")).toBe("status");
    expect(note.textContent).toContain(word("en", "watchlistFeedUnavailable"));
    expect(note.className).toContain("obs-card");
    expect(host.querySelector(".fin-skel")).toBeNull();
  });
});
