// @vitest-environment jsdom
/**
 * Failure-state truth on the Heatmap's overlays: the flow layer, the live-quote note and
 * the search filter.
 *
 * FLOW LAYER — the board reads flow_idx from /api/flow first and from the static /data copy
 * second. The REAL flowClientCache and dataCache run against a stubbed fetch. Four states:
 *   - data          → the tone disclaimer;
 *   - both 404/410  → "Flow data unavailable — showing price layer" (published absence);
 *   - route 403 + static 404 → needs live options access (the guest's real answer — not a
 *                     failure to retry and not an absence);
 *   - anything else that did not land → a load error with a Retry that really re-reads.
 * A refresh that fails keeps the flow tiles and says they are the last read.
 *
 * LIVE QUOTES — "live (15m delayed) top N" is a claim about currency. A quote refresh that
 * did not land must stop making it for values it did not refresh.
 *
 * SEARCH — a filter that matches nothing is not a market with no data.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeatmapTile } from "@/components/heatmap/types";

vi.mock("@/lib/searchTrack", () => ({ trackSearch: () => undefined }));
vi.mock("@/components/ui/Tip", () => ({
  Tip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// The treemap's layout engine needs real geometry; the board's state is what is under test.
vi.mock("@/components/heatmap/Treemap", () => ({
  Treemap: ({ tiles }: { tiles: HeatmapTile[] }) => (
    <ul>
      {tiles.map((tile) => (
        <li key={tile.ticker} data-testid="heatmap-tile" data-flow={String(tile.hasFlow)} data-chg={String(tile.chg1d)}>
          {tile.ticker}
        </li>
      ))}
    </ul>
  ),
  heatSwatches: () => ({ down: [], neutral: "", up: [], flowDown: "", flowUp: "" }),
}));

import { HeatmapView } from "@/components/heatmap/HeatmapView";
import { flowInvalidate } from "@/lib/flowClientCache";
import { invalidate } from "@/lib/dataCache";

const FLOW_LOAD_ERROR = "Could not load the flow layer";
const FLOW_ABSENT = "Flow data unavailable — showing price layer";
const FLOW_AUTH = "Flow layer needs live options access";
const FLOW_REFRESH_FAILED = "Could not refresh the flow layer — showing the last read.";
const TONE_NOTE = "Positioning tone from the change in open interest";
const NO_DATA = "No data available";
const NO_MATCH = "No names match";
const LIVE_NOTE = "live (15m delayed) top 3";

type Answer = { status: number; body: string };
type Reply = Answer | "reject" | "pending";
const json = (status: number, body: unknown): Answer => ({ status, body: JSON.stringify(body) });
const UNAVAILABLE = json(503, { error: "feed unavailable" });
const ABSENT = json(404, { error: "not published" });
const GUEST_REFUSED = json(403, { error: "pro_required" });
const UNPARSEABLE: Answer = { status: 200, body: "<html>upstream error page</html>" };

const sym = (name: string, last: number, chg: number) => ({ name, sec: "Equities", last, chg, vol: 1_000_000, hi52: last * 1.2, lo52: last * 0.8 });
const MANIFEST = json(200, {
  as_of: "2026-10-08",
  source: "polygon",
  symbols: { AAPL: sym("Apple", 231.4, 1.2), MSFT: sym("Microsoft", 418.2, -0.4), NVDA: sym("Nvidia", 131.9, 2.1) },
});
const row = (key: string) => ({ key, asof: "2026-10-08", net_premium_mn: 12.5, tone: "pos", doi_pc: 0.62, verdict: "call-led" });
const FLOW_IDX = json(200, { as_of: "2026-10-08", rows: [row("AAPL"), row("NVDA")] });
const QUOTES = json(200, { quotes: { AAPL: { chg: 0.8 }, MSFT: { chg: -0.1 }, NVDA: { chg: 3.4 } } });

let replies: Record<string, Reply>;
const keyOf = (input: RequestInfo | URL) => {
  const url = new URL(String(input), "http://terminal.test");
  if (url.pathname === "/api/flow") return `flow:${url.searchParams.get("f") ?? ""}`;
  return url.pathname;
};
const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const reply = replies[keyOf(input)] ?? ABSENT;
  if (reply === "reject") throw new TypeError("Failed to fetch");
  if (reply === "pending") return new Promise<Response>(() => undefined);
  return new Response(reply.body, { status: reply.status, headers: { "content-type": "application/json" } });
});
const FLOW_PRIMARY = "flow:flow_idx";
const FLOW_STATIC = "/data/flow_idx.json";
const QUOTE = "/api/quote";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  flowInvalidate();
  invalidate();
  replies = { "flow:manifest": MANIFEST, [FLOW_PRIMARY]: FLOW_IDX, [QUOTE]: QUOTES };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  flowInvalidate();
  invalidate();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function mount() {
  await act(async () => root.render(<HeatmapView />));
  await settle();
}
const text = (el: ParentNode | null = host) => (el as Element | null)?.textContent ?? "";
const within = (selector: string) => host.querySelector(selector);
const requested = (key: string) => fetchMock.mock.calls.filter(([u]) => keyOf(u) === key).length;
const buttonNamed = (name: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === name) ?? null;
const retryIn = (el: ParentNode | null) =>
  el ? [...el.querySelectorAll("button")].find((b) => b.textContent === "Retry") ?? null : null;
async function clickRetry(el: ParentNode | null) {
  const button = retryIn(el);
  expect(button).not.toBeNull();
  await act(async () => { button!.click(); });
  await settle();
}
async function showFlowLayer() {
  const chip = buttonNamed("FLOW");
  expect(chip).not.toBeNull();
  await act(async () => { chip!.click(); });
  await settle();
}
const tiles = () => [...host.querySelectorAll('[data-testid="heatmap-tile"]')];
const tickers = () => tiles().map((li) => li.textContent);
const flowTiles = () => tiles().filter((li) => li.getAttribute("data-flow") === "true").map((li) => li.textContent);
async function typeSearch(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Search ticker…"]');
  expect(input).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

const FLOW_FAILURES: [string, Reply, Reply][] = [
  ["a 5xx from both sources", UNAVAILABLE, UNAVAILABLE],
  ["a rejected fetch from both sources (network failure)", "reject", "reject"],
  ["a failed route read and a missing static copy", UNAVAILABLE, ABSENT],
  ["an unparseable 200 and a 5xx", UNPARSEABLE, UNAVAILABLE],
  ["a guest refusal and a static copy that did not load", GUEST_REFUSED, UNAVAILABLE],
];

describe("Heatmap flow layer: a failed read is not an absent flow index", () => {
  it.each(FLOW_FAILURES)("renders the flow load error with Retry for %s", async (_label, primary, fallback) => {
    replies[FLOW_PRIMARY] = primary;
    replies[FLOW_STATIC] = fallback;
    await mount();
    await showFlowLayer();
    const error = within('[data-testid="heatmap-flow-load-error"]');
    expect(error).not.toBeNull();
    expect(text(error)).toContain(FLOW_LOAD_ERROR);
    expect(retryIn(error)).not.toBeNull();
    expect(text()).not.toContain(FLOW_ABSENT);
    expect(tickers()).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  it("keeps the absent copy only when both sources proved absence, with nothing to retry", async () => {
    replies[FLOW_PRIMARY] = ABSENT;
    replies[FLOW_STATIC] = ABSENT;
    await mount();
    await showFlowLayer();
    expect(text()).toContain(FLOW_ABSENT);
    expect(within('[data-testid="heatmap-flow-load-error"]')).toBeNull();
    expect(retryIn(within('[data-testid="heatmap-flow-absent"]'))).toBeNull();
  });

  it("a guest refused by the route with no public copy needs access — not a failure, not an absence", async () => {
    replies[FLOW_PRIMARY] = GUEST_REFUSED;
    replies[FLOW_STATIC] = ABSENT;
    await mount();
    await showFlowLayer();
    const auth = within('[data-testid="heatmap-flow-auth"]');
    expect(auth).not.toBeNull();
    expect(text(auth)).toContain(FLOW_AUTH);
    expect(retryIn(auth)).toBeNull();
    expect(text()).not.toContain(FLOW_LOAD_ERROR);
    expect(text()).not.toContain(FLOW_ABSENT);
  });

  it("paints the static copy when the route refuses the read", async () => {
    replies[FLOW_PRIMARY] = GUEST_REFUSED;
    replies[FLOW_STATIC] = FLOW_IDX;
    await mount();
    await showFlowLayer();
    expect(flowTiles()).toEqual(["AAPL", "NVDA"]);
    expect(text()).toContain(TONE_NOTE);
    expect(within('[data-testid="heatmap-flow-load-error"]')).toBeNull();
  });

  it("re-reads in place: Retry asks both sources again and renders what they answer", async () => {
    replies[FLOW_PRIMARY] = UNAVAILABLE;
    replies[FLOW_STATIC] = ABSENT;
    await mount();
    await showFlowLayer();
    replies[FLOW_PRIMARY] = FLOW_IDX;
    await clickRetry(within('[data-testid="heatmap-flow-load-error"]'));
    expect(requested(FLOW_PRIMARY)).toBe(2);
    expect(within('[data-testid="heatmap-flow-load-error"]')).toBeNull();
    expect(flowTiles()).toEqual(["AAPL", "NVDA"]);
    expect(text()).toContain(TONE_NOTE);
  });

  it("a Retry that fails again stays a load error, never the absent copy", async () => {
    replies[FLOW_PRIMARY] = UNAVAILABLE;
    replies[FLOW_STATIC] = UNAVAILABLE;
    await mount();
    await showFlowLayer();
    replies[FLOW_PRIMARY] = "reject";
    replies[FLOW_STATIC] = "reject";
    await clickRetry(within('[data-testid="heatmap-flow-load-error"]'));
    expect(requested(FLOW_PRIMARY)).toBe(2);
    expect(within('[data-testid="heatmap-flow-load-error"]')).not.toBeNull();
    expect(text()).not.toContain(FLOW_ABSENT);
  });

  it("does not claim the flow index is absent while it is still being read", async () => {
    replies[FLOW_PRIMARY] = "pending";
    await mount();
    await showFlowLayer();
    expect(text()).not.toContain(FLOW_ABSENT);
    expect(within('[data-testid="heatmap-flow-load-error"]')).toBeNull();
  });

  it("a failed flow read does not put a flow warning on the price layer", async () => {
    replies[FLOW_PRIMARY] = UNAVAILABLE;
    replies[FLOW_STATIC] = UNAVAILABLE;
    await mount();
    expect(within('[data-testid="heatmap-flow-load-error"]')).toBeNull();
    expect(text()).not.toContain(FLOW_ABSENT);
  });

  describe("a flow refresh that fails keeps the flow tiles on screen", () => {
    async function mountThenPoll(primary: Reply, fallback: Reply) {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      await mount();
      await showFlowLayer();
      expect(flowTiles()).toEqual(["AAPL", "NVDA"]);
      flowInvalidate("flow_idx");
      replies[FLOW_PRIMARY] = primary;
      replies[FLOW_STATIC] = fallback;
      await act(async () => { vi.advanceTimersByTime(60_000); });
      await settle();
      expect(requested(FLOW_PRIMARY)).toBe(2);
    }

    it.each(FLOW_FAILURES)("for %s, labelled as the last read with a Retry", async (_label, primary, fallback) => {
      await mountThenPoll(primary, fallback);
      expect(flowTiles()).toEqual(["AAPL", "NVDA"]);
      const stale = within('[data-testid="heatmap-flow-refresh-failed"]');
      expect(stale).not.toBeNull();
      expect(text(stale)).toContain(FLOW_REFRESH_FAILED);
      expect(text()).not.toContain(FLOW_ABSENT);
      expect(within('[data-testid="heatmap-flow-load-error"]')).toBeNull();

      replies[FLOW_PRIMARY] = FLOW_IDX;
      await clickRetry(stale);
      expect(requested(FLOW_PRIMARY)).toBe(3);
      expect(within('[data-testid="heatmap-flow-refresh-failed"]')).toBeNull();
      expect(flowTiles()).toEqual(["AAPL", "NVDA"]);
    });

    it("but a refresh where both sources proved absence withdraws the flow tiles", async () => {
      await mountThenPoll(ABSENT, ABSENT);
      expect(flowTiles()).toEqual([]);
      expect(text()).toContain(FLOW_ABSENT);
      expect(within('[data-testid="heatmap-flow-refresh-failed"]')).toBeNull();
    });
  });
});

describe("Heatmap live quotes: a quote refresh that did not land is not live", () => {
  it("states the live overlay once quotes land", async () => {
    await mount();
    const note = within('[data-testid="heatmap-live-note"]');
    expect(text(note)).toContain(LIVE_NOTE);
    expect(note?.getAttribute("data-state")).toBe("live");
  });

  it.each([["a 5xx", UNAVAILABLE], ["a rejected fetch", "reject" as const]])(
    "a refresh that fails with %s stops calling the held values live", async (_label, reply) => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      await mount();
      expect(text(within('[data-testid="heatmap-live-note"]'))).toContain(LIVE_NOTE);
      replies[QUOTE] = reply;
      await act(async () => { vi.advanceTimersByTime(5 * 60_000); });
      await settle();
      expect(requested(QUOTE)).toBe(2);
      const note = within('[data-testid="heatmap-live-note"]');
      expect(note?.getAttribute("data-state")).toBe("stale");
      expect(text(note)).not.toContain("live (15m delayed)");
      expect(text(note)).toContain("could not refresh");
    },
  );

  it("a first quote read that fails claims nothing live and says the board is EOD", async () => {
    replies[QUOTE] = UNAVAILABLE;
    await mount();
    const note = within('[data-testid="heatmap-live-note"]');
    expect(note?.getAttribute("data-state")).toBe("failed");
    expect(text()).not.toContain("live (15m delayed)");
    expect(tiles().map((li) => li.getAttribute("data-chg"))).toEqual(["1.2", "-0.4", "2.1"]);
  });
});

describe("Heatmap search: a filter with no match is not an empty market", () => {
  it("says no names match, never 'No data available'", async () => {
    await mount();
    await typeSearch("zzzz");
    const noMatch = within('[data-testid="heatmap-no-match"]');
    expect(noMatch).not.toBeNull();
    expect(text(noMatch)).toContain(NO_MATCH);
    expect(text()).not.toContain(NO_DATA);
    await typeSearch("");
    expect(tickers()).toEqual(["AAPL", "MSFT", "NVDA"]);
    expect(within('[data-testid="heatmap-no-match"]')).toBeNull();
  });

  it("an empty market under a search is still the empty market", async () => {
    replies["flow:manifest"] = json(200, { as_of: "2026-10-08", source: "polygon", symbols: {} });
    await mount();
    await typeSearch("zzzz");
    expect(text()).toContain(NO_DATA);
    expect(within('[data-testid="heatmap-no-match"]')).toBeNull();
  });
});
