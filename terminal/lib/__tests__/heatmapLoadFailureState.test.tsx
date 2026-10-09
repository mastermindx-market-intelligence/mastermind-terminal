// @vitest-environment jsdom
/**
 * Failure-state truth on the Heatmap: a price snapshot that was never read is not an
 * empty market.
 *
 * The board reads the manifest from /api/flow first and from the static /data copy
 * second (the route answers guests 403, so the static copy is their source). The REAL
 * flowClientCache and dataCache run against a stubbed fetch, so the chain is exercised
 * end to end: transport → classification → board state → rendered copy.
 *
 * Only when EVERY read proved absence (404/410) may the canvas say "No data available".
 * A read that did not land — 5xx, a rejected fetch, an unparseable body, a 200 that is
 * not a manifest — renders a load error with a Retry that really re-reads. A refresh
 * that fails keeps the tiles on screen and says they are the last read.
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
        <li key={tile.ticker} data-testid="heatmap-tile">{tile.ticker}</li>
      ))}
    </ul>
  ),
  heatSwatches: () => ({ down: [], neutral: "", up: [], flowDown: "", flowUp: "" }),
}));

import { HeatmapView } from "@/components/heatmap/HeatmapView";
import { flowInvalidate } from "@/lib/flowClientCache";
import { invalidate } from "@/lib/dataCache";

const LOAD_ERROR = "Could not load the heatmap";
const NO_DATA = "No data available";
const LOADING = "Loading heatmap…";
const REFRESH_FAILED = "Could not refresh — showing the last read.";

// One injected transport answer per source. Anything unlisted is a published absence.
type Answer = { status: number; body: string };
type Reply = Answer | "reject" | "pending";
const json = (status: number, body: unknown): Answer => ({ status, body: JSON.stringify(body) });
const UNAVAILABLE = json(503, { error: "feed unavailable" });
const ABSENT = json(404, { error: "not published" });
const GUEST_REFUSED = json(403, { error: "pro_required" });
const UNPARSEABLE: Answer = { status: 200, body: "<html>upstream error page</html>" };
const NOT_A_MANIFEST = json(200, { as_of: "2026-10-08" });

const sym = (name: string, last: number, chg: number) => ({ name, sec: "Equities", last, chg, vol: 1_000_000, hi52: last * 1.2, lo52: last * 0.8 });
const MANIFEST = json(200, {
  as_of: "2026-10-08",
  source: "polygon",
  symbols: { AAPL: sym("Apple", 231.4, 1.2), MSFT: sym("Microsoft", 418.2, -0.4), NVDA: sym("Nvidia", 131.9, 2.1) },
});
const EMPTY_MANIFEST = json(200, { as_of: "2026-10-08", source: "polygon", symbols: {} });

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
const PRIMARY = "flow:manifest";
const STATIC = "/data/manifest.json";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  flowInvalidate();
  invalidate();
  replies = {};
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
const retryIn = (el: ParentNode | null = host) =>
  el ? [...el.querySelectorAll("button")].find((b) => b.textContent === "Retry") ?? null : null;
async function clickRetry(el: ParentNode | null) {
  const button = retryIn(el);
  expect(button).not.toBeNull();
  await act(async () => { button!.click(); });
  await settle();
}
const tiles = () => [...host.querySelectorAll('[data-testid="heatmap-tile"]')].map((li) => li.textContent);
// The breadth strip is derived from the same manifest: an unread universe has no
// advancer count and no market mode — not "0 / 0 (0%)" and not "Mixed".
function expectNoBreadthReading() {
  const breadth = within('[data-testid="heatmap-breadth"]');
  expect(breadth).not.toBeNull();
  expect(text(breadth)).not.toContain("(0%)");
  expect(text(breadth)).not.toContain("Mixed");
}

const FAILURES: [string, Reply, Reply][] = [
  ["a 5xx from both sources", UNAVAILABLE, UNAVAILABLE],
  ["a rejected fetch from both sources (network failure)", "reject", "reject"],
  ["a failed route read and a missing static copy", UNAVAILABLE, ABSENT],
  ["a guest refusal and a missing static copy", GUEST_REFUSED, ABSENT],
  ["an unparseable 200 and a 5xx", UNPARSEABLE, UNAVAILABLE],
  ["a 200 that is not a manifest and a missing static copy", NOT_A_MANIFEST, ABSENT],
];

describe("Heatmap: a failed read is not an empty market", () => {
  it.each(FAILURES)("renders the load error for %s", async (_label, primary, fallback) => {
    replies[PRIMARY] = primary;
    replies[STATIC] = fallback;
    await mount();
    expect(requested(PRIMARY)).toBe(1);
    expect(requested(STATIC)).toBe(1);
    const error = within('[data-testid="heatmap-load-error"]');
    expect(error).not.toBeNull();
    expect(text(error)).toContain(LOAD_ERROR);
    expect(retryIn(error)).not.toBeNull();
    expect(text()).not.toContain(NO_DATA);
    expect(text()).not.toContain(LOADING);
    expectNoBreadthReading();
  });

  it("keeps the empty state only when every source proved absence, with nothing to retry", async () => {
    replies[PRIMARY] = ABSENT;
    replies[STATIC] = ABSENT;
    await mount();
    expect(text()).toContain(NO_DATA);
    expect(within('[data-testid="heatmap-load-error"]')).toBeNull();
    expect(retryIn()).toBeNull();
  });

  it("keeps the empty state for a manifest that lists no names", async () => {
    replies[PRIMARY] = EMPTY_MANIFEST;
    await mount();
    expect(text()).toContain(NO_DATA);
    expect(within('[data-testid="heatmap-load-error"]')).toBeNull();
    expect(retryIn()).toBeNull();
  });

  it("paints the static copy when the route refuses the read (the guest path)", async () => {
    replies[PRIMARY] = GUEST_REFUSED;
    replies[STATIC] = MANIFEST;
    await mount();
    expect(tiles()).toEqual(["AAPL", "MSFT", "NVDA"]);
    expect(within('[data-testid="heatmap-load-error"]')).toBeNull();
    expect(retryIn()).toBeNull();
  });

  it("does not claim an empty market while the snapshot is still being read", async () => {
    replies[PRIMARY] = "pending";
    await mount();
    expect(text()).toContain(LOADING);
    expect(text()).not.toContain(NO_DATA);
    expect(within('[data-testid="heatmap-load-error"]')).toBeNull();
    expectNoBreadthReading();
  });

  it("re-reads in place: Retry asks the store again and renders what it answers", async () => {
    replies[PRIMARY] = UNAVAILABLE;
    replies[STATIC] = UNAVAILABLE;
    await mount();
    replies[PRIMARY] = MANIFEST;
    await clickRetry(within('[data-testid="heatmap-load-error"]'));
    expect(requested(PRIMARY)).toBe(2);
    expect(within('[data-testid="heatmap-load-error"]')).toBeNull();
    expect(tiles()).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  it("Retry reaches the static copy again even after it answered 404", async () => {
    replies[PRIMARY] = GUEST_REFUSED;
    replies[STATIC] = ABSENT;
    await mount();
    replies[STATIC] = MANIFEST;
    await clickRetry(within('[data-testid="heatmap-load-error"]'));
    expect(requested(STATIC)).toBe(2);
    expect(tiles()).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  it("a Retry that fails again stays a load error, never the empty state", async () => {
    replies[PRIMARY] = UNAVAILABLE;
    replies[STATIC] = UNAVAILABLE;
    await mount();
    replies[PRIMARY] = "reject";
    replies[STATIC] = "reject";
    await clickRetry(within('[data-testid="heatmap-load-error"]'));
    expect(requested(PRIMARY)).toBe(2);
    expect(within('[data-testid="heatmap-load-error"]')).not.toBeNull();
    expect(text()).not.toContain(NO_DATA);
  });

  describe("a refresh that fails keeps the tiles on screen", () => {
    async function mountThenPoll(primary: Reply, fallback: Reply) {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      replies[PRIMARY] = MANIFEST;
      await mount();
      expect(tiles()).toEqual(["AAPL", "MSFT", "NVDA"]);
      flowInvalidate("manifest");
      replies[PRIMARY] = primary;
      replies[STATIC] = fallback;
      await act(async () => { vi.advanceTimersByTime(60_000); });
      await settle();
      expect(requested(PRIMARY)).toBe(2);
    }

    it.each(FAILURES)("for %s, labelled as the last read with a Retry", async (_label, primary, fallback) => {
      await mountThenPoll(primary, fallback);
      expect(tiles()).toEqual(["AAPL", "MSFT", "NVDA"]);
      const stale = within('[data-testid="heatmap-refresh-failed"]');
      expect(stale).not.toBeNull();
      expect(text(stale)).toContain(REFRESH_FAILED);
      expect(text()).not.toContain(NO_DATA);
      expect(within('[data-testid="heatmap-load-error"]')).toBeNull();

      replies[PRIMARY] = MANIFEST;
      await clickRetry(stale);
      expect(requested(PRIMARY)).toBe(3);
      expect(within('[data-testid="heatmap-refresh-failed"]')).toBeNull();
      expect(tiles()).toEqual(["AAPL", "MSFT", "NVDA"]);
    });

    it("but a refresh where every source proved absence withdraws the tiles", async () => {
      await mountThenPoll(ABSENT, ABSENT);
      expect(tiles()).toEqual([]);
      expect(text()).toContain(NO_DATA);
      expect(within('[data-testid="heatmap-refresh-failed"]')).toBeNull();
      expect(retryIn()).toBeNull();
    });
  });
});
