// @vitest-environment jsdom
/**
 * Failure-state truth on the Flow Desk's Chain Heat rail: a read that did not land is not
 * "still loading".
 *
 * The rail reads `chainheat` from /api/flow through the REAL flowClientCache against a
 * stubbed fetch. Four states:
 *   - pending        → "Loading chain heat…";
 *   - data           → the campaigns, or the threshold copy when the session has none;
 *   - 404/410        → published absence: no artifact for this session, nothing to retry;
 *   - anything else  → a load error with a Retry that really re-reads.
 * A 45 s refresh that fails keeps the campaigns on screen and says they are the last read.
 * The tape, gauges, rails and inspector are mocked: the rail's read is what is under test.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/flowStream", () => ({ useFlowStream: () => ({ data: null, connected: false, error: false }) }));
vi.mock("@/components/flowdesk/WatchlistRail", () => ({ WatchlistRail: () => null }));
vi.mock("@/components/flowdesk/RadarStrip", () => ({ RadarStrip: () => null }));
vi.mock("@/components/flowdesk/FlowGauge", () => ({ FlowGauge: () => null }));
vi.mock("@/components/flowdesk/InspectorPane", () => ({ InspectorPane: () => null }));
vi.mock("@/components/flowdesk/FlowFreshnessReceipt", () => ({ ArtifactSourceReceipt: () => null }));
vi.mock("@/components/tutorial/TutorialOverlay", () => ({ TutorialOverlay: () => null }));
vi.mock("@/components/flowdesk/FeedPane", () => ({
  FeedPane: () => null,
  normalizeEnrichPayload: (raw: unknown) => raw,
}));
vi.mock("@/components/flowdesk/FiltersPanel", () => ({ DEFAULT_FILTERS: {} }));

import { FlowDeskView } from "@/components/flowdesk/FlowDeskView";
import { flowInvalidate } from "@/lib/flowClientCache";

const LOADING = "Loading chain heat…";
const LOAD_ERROR = "Could not load chain heat";
const ABSENT = "No chain heat published for this session yet";
const EMPTY = "No campaigns today";
const REFRESH_FAILED = "Could not refresh chain heat — showing the last read.";

type Answer = { status: number; body: string };
type Reply = Answer | "reject" | "pending";
const json = (status: number, body: unknown): Answer => ({ status, body: JSON.stringify(body) });
const UNAVAILABLE = json(503, { error: "feed unavailable" });
const NOT_PUBLISHED = json(404, { error: "not published" });
const UNPARSEABLE: Answer = { status: 200, body: "<html>upstream error page</html>" };

const campaign = (ticker: string, premium: number) => ({
  option_symbol: `O:${ticker}261016C00150000`,
  ticker,
  type: "CALL",
  strike: 150,
  expiry: "2026-10-16",
  dte: 7,
  total_premium_mn: premium,
  alert_count: 6,
  span_minutes: 42,
  first_seen: "2026-10-09T14:05:00Z",
  ask_share: 0.6,
  lean: "accumulation",
  direction_reliability: "soft",
  authority_tier: "derived",
});
const CHAINHEAT = json(200, {
  asof: "2026-10-09T15:00:00Z",
  session_date: "2026-10-09",
  threshold_mn: 3,
  campaigns: [campaign("NVDA", 12.4), campaign("AAPL", 4.1)],
});
const NO_CAMPAIGNS = json(200, { asof: "2026-10-09T15:00:00Z", session_date: "2026-10-09", threshold_mn: 3, campaigns: [] });

let replies: Record<string, Reply>;
const keyOf = (input: RequestInfo | URL) => {
  const url = new URL(String(input), "http://terminal.test");
  if (url.pathname === "/api/flow") return url.searchParams.get("f") ?? "";
  return url.pathname;
};
const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const reply = replies[keyOf(input)] ?? NOT_PUBLISHED;
  if (reply === "reject") throw new TypeError("Failed to fetch");
  if (reply === "pending") return new Promise<Response>(() => undefined);
  return new Response(reply.body, { status: reply.status, headers: { "content-type": "application/json" } });
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  // The idle enrich bootstrap is not under test; keep it off the request log.
  vi.stubGlobal("requestIdleCallback", () => 0);
  vi.stubGlobal("cancelIdleCallback", () => undefined);
  fetchMock.mockClear();
  flowInvalidate();
  try { localStorage.setItem("flowdesk.tutorial.seen", "1"); } catch {}
  replies = { chainheat: CHAINHEAT, tide: json(200, { asof: "2026-10-09T15:00:00Z", minutes: [], spy: [], sectors: [], top_net_impact: [] }) };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  flowInvalidate();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function mount() {
  await act(async () => root.render(<FlowDeskView />));
  await settle();
}
const rail = () => host.querySelector('[data-tut="chain-heat"]');
const text = (el: ParentNode | null = host) => (el as Element | null)?.textContent ?? "";
const requested = (key: string) => fetchMock.mock.calls.filter(([u]) => keyOf(u) === key).length;
const retryIn = (el: ParentNode | null) =>
  el ? [...el.querySelectorAll("button")].find((b) => b.textContent === "Retry") ?? null : null;
async function clickRetry(el: ParentNode | null) {
  const button = retryIn(el);
  expect(button).not.toBeNull();
  await act(async () => { button!.click(); });
  await settle();
}
const tickers = () => [...host.querySelectorAll(".obs-fd-chain-ticker")].map((el) => el.textContent);

const FAILURES: [string, Reply][] = [
  ["a 5xx", UNAVAILABLE],
  ["a rejected fetch (network failure)", "reject"],
  ["an unparseable 200", UNPARSEABLE],
];

describe("Flow Desk Chain Heat: a failed read is not a read still in flight", () => {
  it.each(FAILURES)("renders the load error with Retry for %s", async (_label, reply) => {
    replies.chainheat = reply;
    await mount();
    expect(requested("chainheat")).toBe(1);
    const error = host.querySelector('[data-testid="chainheat-load-error"]');
    expect(error).not.toBeNull();
    expect(text(error)).toContain(LOAD_ERROR);
    expect(retryIn(error)).not.toBeNull();
    expect(text(rail())).not.toContain(LOADING);
    expect(text(rail())).not.toContain(EMPTY);
  });

  it("a 404 is published absence: its own copy and nothing to retry", async () => {
    replies.chainheat = NOT_PUBLISHED;
    await mount();
    const absent = host.querySelector('[data-testid="chainheat-absent"]');
    expect(absent).not.toBeNull();
    expect(text(absent)).toContain(ABSENT);
    expect(retryIn(rail())).toBeNull();
    expect(text(rail())).not.toContain(LOADING);
    expect(host.querySelector('[data-testid="chainheat-load-error"]')).toBeNull();
  });

  it("a session with no campaigns keeps the threshold copy", async () => {
    replies.chainheat = NO_CAMPAIGNS;
    await mount();
    expect(text(rail())).toContain(EMPTY);
    expect(retryIn(rail())).toBeNull();
  });

  it("says loading only while the read is in flight", async () => {
    replies.chainheat = "pending";
    await mount();
    expect(text(rail())).toContain(LOADING);
    expect(host.querySelector('[data-testid="chainheat-load-error"]')).toBeNull();
  });

  it("re-reads in place: Retry asks the store again and renders what it answers", async () => {
    replies.chainheat = UNAVAILABLE;
    await mount();
    replies.chainheat = CHAINHEAT;
    await clickRetry(host.querySelector('[data-testid="chainheat-load-error"]'));
    expect(requested("chainheat")).toBe(2);
    expect(host.querySelector('[data-testid="chainheat-load-error"]')).toBeNull();
    expect(tickers()).toEqual(["NVDA", "AAPL"]);
  });

  it("a Retry that fails again stays a load error, never loading", async () => {
    replies.chainheat = UNAVAILABLE;
    await mount();
    replies.chainheat = "reject";
    await clickRetry(host.querySelector('[data-testid="chainheat-load-error"]'));
    expect(requested("chainheat")).toBe(2);
    expect(host.querySelector('[data-testid="chainheat-load-error"]')).not.toBeNull();
    expect(text(rail())).not.toContain(LOADING);
  });

  describe("a refresh that fails keeps the campaigns on screen", () => {
    async function mountThenPoll(reply: Reply) {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      await mount();
      expect(tickers()).toEqual(["NVDA", "AAPL"]);
      flowInvalidate("chainheat");
      replies.chainheat = reply;
      await act(async () => { vi.advanceTimersByTime(45_000); });
      await settle();
      expect(requested("chainheat")).toBe(2);
    }

    it.each(FAILURES)("for %s, labelled as the last read with a Retry", async (_label, reply) => {
      await mountThenPoll(reply);
      expect(tickers()).toEqual(["NVDA", "AAPL"]);
      const stale = host.querySelector('[data-testid="chainheat-refresh-failed"]');
      expect(stale).not.toBeNull();
      expect(text(stale)).toContain(REFRESH_FAILED);
      expect(host.querySelector('[data-testid="chainheat-load-error"]')).toBeNull();

      replies.chainheat = CHAINHEAT;
      await clickRetry(stale);
      expect(requested("chainheat")).toBe(3);
      expect(host.querySelector('[data-testid="chainheat-refresh-failed"]')).toBeNull();
      expect(tickers()).toEqual(["NVDA", "AAPL"]);
    });

    it("but a refresh that proves absence withdraws the campaigns", async () => {
      await mountThenPoll(NOT_PUBLISHED);
      expect(tickers()).toEqual([]);
      expect(host.querySelector('[data-testid="chainheat-absent"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="chainheat-refresh-failed"]')).toBeNull();
    });
  });
});
