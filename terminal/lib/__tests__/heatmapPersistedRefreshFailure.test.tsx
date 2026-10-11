// @vitest-environment jsdom
/**
 * Failure-state truth on the Heatmap when the board is painted from the PERSISTED manifest.
 *
 * In a real browser `/data/manifest.json` is almost always already in IndexedDB — the Terminal
 * shell, the Screener and Alerts all read it, and dataCache writes every successful read through
 * to disk. On a fresh page the cache therefore answers the Heatmap's static read with that disk
 * copy (older than the 60s TTL, so it is served stale) and refreshes it in the background. When
 * that refresh fails, the tiles on screen are a previous session's prices — and the board must
 * say so ("Could not refresh — showing the last read."), exactly as it does when a poll fails.
 *
 * heatmapLoadFailureState.test.tsx covers the same label with NO disk copy (jsdom has no
 * IndexedDB), which is why it never caught this: there the failed read is the caller's own.
 * Here a minimal in-memory IndexedDB is installed and the record is written by the REAL
 * idbJsonStore writer, so the whole chain runs: disk read-back → stale serve → background
 * refresh → failure → board state → rendered copy.
 *
 * The flow layer reads /data/flow_idx.json through the same cache as its second source, so a
 * disk copy of the flow index behind a failed /api/flow read is the same defect on that layer.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HeatmapTile } from "@/components/heatmap/types";
import { makeFakeIndexedDB } from "./helpers/fakeIndexedDB";

vi.mock("@/lib/searchTrack", () => ({ trackSearch: () => undefined }));
vi.mock("@/components/ui/Tip", () => ({
  Tip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// The treemap's layout engine needs real geometry; the board's state is what is under test.
vi.mock("@/components/heatmap/Treemap", () => ({
  Treemap: ({ tiles }: { tiles: HeatmapTile[] }) => (
    <ul>
      {tiles.map((tile) => (
        <li key={tile.ticker} data-testid="heatmap-tile" data-flow={String(tile.hasFlow)}>{tile.ticker}</li>
      ))}
    </ul>
  ),
  heatSwatches: () => ({ down: [], neutral: "", up: [], flowDown: "", flowUp: "" }),
}));

import { HeatmapView } from "@/components/heatmap/HeatmapView";
import { flowInvalidate } from "@/lib/flowClientCache";
import { invalidate } from "@/lib/dataCache";
import { _resetForTests as resetIdb, idbGet, idbPut } from "@/lib/idbJsonStore";

const NO_DATA = "No data available";
const REFRESH_FAILED = "Could not refresh — showing the last read.";
const FLOW_REFRESH_FAILED = "Could not refresh the flow layer — showing the last read.";
const TONE_NOTE = "Positioning tone from the change in open interest";

type Answer = { status: number; body: string };
type Reply = Answer | "reject";
const json = (status: number, body: unknown): Answer => ({ status, body: JSON.stringify(body) });
const UNAVAILABLE = json(503, { error: "feed unavailable" });
const ABSENT = json(404, { error: "not published" });

const sym = (name: string, last: number, chg: number) => ({ name, sec: "Equities", last, chg, vol: 1_000_000, hi52: last * 1.2, lo52: last * 0.8 });
// What an earlier session read and dataCache wrote through to disk.
const PERSISTED = {
  as_of: "2026-10-07",
  source: "polygon",
  symbols: { AAPL: sym("Apple", 229.1, 0.3), MSFT: sym("Microsoft", 415.0, 0.1), NVDA: sym("Nvidia", 128.4, -1.2) },
};
// What the network answers once it is reachable again — one more name, so a real refresh shows.
const CURRENT = json(200, {
  as_of: "2026-10-08",
  source: "polygon",
  symbols: { ...PERSISTED.symbols, AMD: sym("AMD", 162.7, 3.4) },
});
const SIX_HOURS = 6 * 60 * 60_000;
const flowRow = (key: string) => ({ key, asof: "2026-10-07", net_premium_mn: 12.5, tone: "pos", doi_pc: 0.62, verdict: "call-led" });
// An earlier session's flow index on disk (two names), and the current one (three names).
const PERSISTED_FLOW = { as_of: "2026-10-07", rows: [flowRow("AAPL"), flowRow("NVDA")] };
const CURRENT_FLOW = json(200, { as_of: "2026-10-08", rows: [flowRow("AAPL"), flowRow("MSFT"), flowRow("NVDA")] });

let replies: Record<string, Reply>;
const keyOf = (input: RequestInfo | URL) => {
  const url = new URL(String(input), "http://terminal.test");
  if (url.pathname === "/api/flow") return `flow:${url.searchParams.get("f") ?? ""}`;
  return url.pathname;
};
const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const reply = replies[keyOf(input)] ?? ABSENT;
  if (reply === "reject") throw new TypeError("Failed to fetch");
  return new Response(reply.body, { status: reply.status, headers: { "content-type": "application/json" } });
});
const PRIMARY = "flow:manifest";
const STATIC = "/data/manifest.json";
const FLOW_PRIMARY = "flow:flow_idx";
const FLOW_STATIC = "/data/flow_idx.json";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("indexedDB", makeFakeIndexedDB());
  resetIdb();
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
  resetIdb();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** An earlier session's read, written to disk by the real write-through writer. */
async function persistManifest(ageMs: number) {
  await idbPut(STATIC, PERSISTED, Date.now() - ageMs);
  expect((await idbGet(STATIC))?.data).toEqual(PERSISTED);
}
async function settle() {
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function mount() {
  await act(async () => root.render(<HeatmapView />));
  await settle();
}
async function poll() {
  await act(async () => { vi.advanceTimersByTime(60_000); });
  await settle();
}
const text = (el: ParentNode | null = host) => (el as Element | null)?.textContent ?? "";
const within = (selector: string) => host.querySelector(selector);
const requested = (key: string) => fetchMock.mock.calls.filter(([u]) => keyOf(u) === key).length;
const tiles = () => [...host.querySelectorAll('[data-testid="heatmap-tile"]')].map((li) => li.textContent);
const staleLabel = () => within('[data-testid="heatmap-refresh-failed"]');
const flowStaleLabel = () => within('[data-testid="heatmap-flow-refresh-failed"]');
const flowTiles = () =>
  [...host.querySelectorAll('[data-testid="heatmap-tile"][data-flow="true"]')].map((li) => li.textContent);
async function showFlowLayer() {
  const chip = [...host.querySelectorAll("button")].find((b) => b.textContent === "FLOW");
  expect(chip).toBeDefined();
  await act(async () => { chip!.click(); });
  await settle();
}
async function clickRetry(el: ParentNode | null) {
  const button = el ? [...el.querySelectorAll("button")].find((b) => b.textContent === "Retry") : undefined;
  expect(button).toBeDefined();
  await act(async () => { button!.click(); });
  await settle();
}

const REFRESH_FAILURES: [string, Reply][] = [
  ["a 5xx", UNAVAILABLE],
  ["a rejected fetch (network failure)", "reject"],
];

describe("Heatmap: tiles painted from the persisted manifest", () => {
  it.each(REFRESH_FAILURES)(
    "are labelled as the last read when every refresh fails with %s",
    async (_label, failure) => {
      await persistManifest(SIX_HOURS);
      replies[PRIMARY] = failure;
      replies[STATIC] = failure;
      await mount();

      // The disk copy painted, and the cache really tried to refresh it.
      expect(tiles()).toEqual(["AAPL", "MSFT", "NVDA"]);
      expect(requested(PRIMARY)).toBe(1);
      expect(requested(STATIC)).toBe(1);

      const stale = staleLabel();
      expect(stale).not.toBeNull();
      expect(text(stale)).toContain(REFRESH_FAILED);
      expect(within('[data-testid="heatmap-load-error"]')).toBeNull();
      expect(text()).not.toContain(NO_DATA);
      // The failed refresh evicts memory but not the disk record — which is why every later read
      // is answered with the same copy, and why the label is the only honest signal.
      expect((await idbGet(STATIC))?.data).toEqual(PERSISTED);
    },
  );

  // Development mounts every effect twice (React StrictMode), and two surfaces can read the
  // manifest at once: the second read meets the first one's refresh in flight. It is the read
  // the board keeps, so it must come back with the copy and the failure, not "could not load".
  it.each(REFRESH_FAILURES)(
    "are labelled when a second concurrent read joins the failing refresh (StrictMode double mount, %s)",
    async (_label, failure) => {
      await persistManifest(SIX_HOURS);
      replies[PRIMARY] = failure;
      replies[STATIC] = failure;
      await act(async () => root.render(<React.StrictMode><HeatmapView /></React.StrictMode>));
      await settle();

      expect(requested(STATIC)).toBe(1);                       // one refresh, shared
      expect(tiles()).toEqual(["AAPL", "MSFT", "NVDA"]);
      expect(text(staleLabel())).toContain(REFRESH_FAILED);
      expect(within('[data-testid="heatmap-load-error"]')).toBeNull();
    },
  );

  it("stay labelled on the next poll, which is answered by the same disk copy", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await persistManifest(SIX_HOURS);
    replies[PRIMARY] = UNAVAILABLE;
    replies[STATIC] = "reject";
    await mount();
    expect(staleLabel()).not.toBeNull();

    await poll();
    expect(requested(PRIMARY)).toBe(2);
    expect(requested(STATIC)).toBe(2);
    expect(tiles()).toEqual(["AAPL", "MSFT", "NVDA"]);
    expect(text(staleLabel())).toContain(REFRESH_FAILED);
  });

  it("lose the label when Retry reaches a source again", async () => {
    await persistManifest(SIX_HOURS);
    replies[PRIMARY] = UNAVAILABLE;
    replies[STATIC] = UNAVAILABLE;
    await mount();
    replies[PRIMARY] = CURRENT;
    await clickRetry(staleLabel());
    expect(staleLabel()).toBeNull();
    expect(tiles()).toEqual(["AAPL", "MSFT", "NVDA", "AMD"]);
  });

  it("lose the label when a later poll's refresh succeeds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await persistManifest(SIX_HOURS);
    replies[PRIMARY] = UNAVAILABLE;
    replies[STATIC] = UNAVAILABLE;
    await mount();
    expect(staleLabel()).not.toBeNull();

    replies[STATIC] = CURRENT;
    await poll();
    expect(staleLabel()).toBeNull();
    expect(tiles()).toEqual(["AAPL", "MSFT", "NVDA", "AMD"]);
  });

  // Negative controls: the label is a statement about a FAILED refresh, not about disk reads.
  it("are not labelled when the background refresh succeeds — they are replaced", async () => {
    await persistManifest(SIX_HOURS);
    replies[PRIMARY] = UNAVAILABLE;
    replies[STATIC] = CURRENT;
    await mount();
    expect(requested(STATIC)).toBe(1);
    expect(tiles()).toEqual(["AAPL", "MSFT", "NVDA", "AMD"]);
    expect(staleLabel()).toBeNull();
  });

  it("are not labelled while the disk copy is inside its freshness window (nothing to refresh)", async () => {
    await persistManifest(5_000);
    replies[PRIMARY] = UNAVAILABLE;
    replies[STATIC] = UNAVAILABLE;
    await mount();
    expect(requested(STATIC)).toBe(0);
    expect(tiles()).toEqual(["AAPL", "MSFT", "NVDA"]);
    expect(staleLabel()).toBeNull();
  });
});

describe("Heatmap: flow tiles painted from the persisted flow index", () => {
  /** The price board is healthy; the flow index's route read fails and its static copy is on disk. */
  async function persistFlowIdx(ageMs: number) {
    replies[PRIMARY] = CURRENT;
    await idbPut(FLOW_STATIC, PERSISTED_FLOW, Date.now() - ageMs);
    expect((await idbGet(FLOW_STATIC))?.data).toEqual(PERSISTED_FLOW);
  }

  it.each(REFRESH_FAILURES)(
    "are labelled as the last read when every refresh fails with %s",
    async (_label, failure) => {
      await persistFlowIdx(SIX_HOURS);
      replies[FLOW_PRIMARY] = failure;
      replies[FLOW_STATIC] = failure;
      await mount();
      await showFlowLayer();

      expect(requested(FLOW_PRIMARY)).toBe(1);
      expect(requested(FLOW_STATIC)).toBe(1);
      expect(flowTiles()).toEqual(["AAPL", "NVDA"]);
      expect(text()).toContain(TONE_NOTE);
      expect(text(flowStaleLabel())).toContain(FLOW_REFRESH_FAILED);
      expect(within('[data-testid="heatmap-flow-load-error"]')).toBeNull();
      expect(staleLabel()).toBeNull();                          // the price board's refresh landed
      expect((await idbGet(FLOW_STATIC))?.data).toEqual(PERSISTED_FLOW);
    },
  );

  it("lose the label when Retry reaches a source again", async () => {
    await persistFlowIdx(SIX_HOURS);
    replies[FLOW_PRIMARY] = UNAVAILABLE;
    replies[FLOW_STATIC] = UNAVAILABLE;
    await mount();
    await showFlowLayer();
    replies[FLOW_PRIMARY] = CURRENT_FLOW;
    await clickRetry(flowStaleLabel());
    expect(flowStaleLabel()).toBeNull();
    expect(flowTiles()).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  it("are not labelled when the background refresh succeeds — they are replaced", async () => {
    await persistFlowIdx(SIX_HOURS);
    replies[FLOW_PRIMARY] = UNAVAILABLE;
    replies[FLOW_STATIC] = CURRENT_FLOW;
    await mount();
    await showFlowLayer();
    expect(requested(FLOW_STATIC)).toBe(1);
    expect(flowTiles()).toEqual(["AAPL", "MSFT", "NVDA"]);
    expect(flowStaleLabel()).toBeNull();
  });
});
