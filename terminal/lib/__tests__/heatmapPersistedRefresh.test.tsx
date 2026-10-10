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
import { idbGet, idbPut } from "@/lib/idbJsonStore";
import { flowInvalidate } from "@/lib/flowClientCache";
import { invalidate } from "@/lib/dataCache";

const LOAD_ERROR = "Could not load the heatmap";
const NO_DATA = "No data available";
const REFRESH_FAILED = "Could not refresh — showing the last read.";

// One injected transport answer per source. Anything unlisted is a published absence.
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
const EMPTY_MANIFEST = json(200, { as_of: "2026-10-08", source: "polygon", symbols: {} });

type Rec = { url: string; data: unknown; ts: number };
type FakeHandler = ((event: { target: unknown }) => void) | null;
type FakeRequest<T> = { onsuccess: FakeHandler; onerror: FakeHandler; result: T | undefined };
type FakeCursor = { value: Rec; delete: () => boolean; continue: () => void };

function makeFakeIndexedDB() {
  const data = new Map<string, Rec>();

  // Microtask-defer a request's success so on* handlers (assigned after the call
  // returns, exactly like real IDB) are already attached when they fire.
  function fire<T>(makeResult: () => T) {
    const req: FakeRequest<T> = { onsuccess: null, onerror: null, result: undefined };
    queueMicrotask(() => {
      try {
        req.result = makeResult();
        req.onsuccess?.({ target: req });
      } catch {
        req.onerror?.({ target: req });
      }
    });
    return req;
  }

  function makeStore() {
    return {
      get: (url: string) => fire(() => data.get(url)),
      put: (rec: Rec) => fire(() => {
        data.set(rec.url, rec);
        return rec.url;
      }),
      delete: (url: string) => fire(() => {
        data.delete(url);
        return undefined;
      }),
      clear: () => fire(() => {
        data.clear();
        return undefined;
      }),
      count: () => fire(() => data.size),
      index: () => ({
        openCursor: () => {
          // Ascending-by-ts cursor.
          const sorted = [...data.values()].sort((a, b) => a.ts - b.ts);
          let i = 0;
          const req: FakeRequest<FakeCursor | null> = { onsuccess: null, onerror: null, result: undefined };
          const step = () => {
            queueMicrotask(() => {
              if (i >= sorted.length) {
                req.result = null;
                req.onsuccess?.({ target: req });
                return;
              }
              const rec = sorted[i];
              req.result = {
                value: rec,
                delete: () => data.delete(rec.url),
                continue: () => {
                  i++;
                  step();
                },
              };
              req.onsuccess?.({ target: req });
            });
          };
          step();
          return req;
        },
      }),
      createIndex: () => {},
    };
  }

  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => makeStore(),
    transaction: () => {
      const tx = { oncomplete: null as FakeHandler, onerror: null as FakeHandler, onabort: null as FakeHandler, objectStore: () => makeStore() };
      // Resolve the transaction as complete after pending request microtasks.
      queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.({ target: tx })));
      return tx;
    },
    close: () => {},
    onversionchange: null,
  };

  return {
    _data: data,
    open: () => {
      const req: FakeRequest<typeof db> & { onupgradeneeded: FakeHandler; onblocked: FakeHandler } = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: db };
      queueMicrotask(() => {
        req.onupgradeneeded?.({ target: req });
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
}


const persistedIDB = makeFakeIndexedDB();
let logicalNow = Date.now();
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
  logicalNow = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => logicalNow);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  vi.stubGlobal("indexedDB", persistedIDB);
  persistedIDB._data.clear();
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
async function seedDisk(age: number) {
  await settle(); // let original invalidation finish; do not erase the seeded fixture
  await idbPut(STATIC, JSON.parse(MANIFEST.body), logicalNow - age);
  expect((await idbGet(STATIC))?.data.symbols.AAPL).toBeTruthy();
}
async function failedPoll() {
  logicalNow += 61_000;
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  await settle();
}
describe("Heatmap real persisted fallback failure — caller-only proposal", () => {
  it.each([0, 600_000])("a %ims-old persisted snapshot cannot substitute for a failed cold source read", async (age) => {
    replies[PRIMARY] = GUEST_REFUSED;
    replies[STATIC] = UNAVAILABLE;
    await seedDisk(age);
    await mount();
    expect(within('[data-testid="heatmap-load-error"]')).not.toBeNull();
    expect(text()).toContain(LOAD_ERROR);
    expect(text()).not.toContain(NO_DATA);
    expect(within('[data-testid="heatmap-tile"]')).toBeNull();
    expect((await idbGet(STATIC))?.data.symbols.AAPL).toBeTruthy(); // no shared IDB delete
    expect(requested(STATIC)).toBeGreaterThan(0);
  });
  it("a failed persisted refresh keeps actual last-read tiles and labels them, then Retry fetches new bytes", async () => {
    replies[PRIMARY] = GUEST_REFUSED;
    replies[STATIC] = MANIFEST;
    await mount();
    expect(text()).toContain("AAPL");
    expect((await idbGet(STATIC))?.data.as_of).toBe("2026-10-08");
    replies[STATIC] = UNAVAILABLE;
    await failedPoll();
    expect(text()).toContain("AAPL");
    expect(text()).toContain(REFRESH_FAILED);
    expect(within('[data-testid="heatmap-load-error"]')).toBeNull();
    expect((await idbGet(STATIC))?.data.as_of).toBe("2026-10-08");
    const n = requested(STATIC);
    replies[STATIC] = json(200, { as_of: "2026-10-09", source: "polygon", symbols: { TSLA: sym("Tesla", 260, 1.4) } });
    const retry = retryIn();
    expect(retry).not.toBeNull();
    await act(async () => { retry!.click(); });
    await settle();
    expect(requested(STATIC)).toBeGreaterThan(n);
    expect(text()).toContain("TSLA");
    expect(text()).not.toContain("AAPL");
    expect(text()).not.toContain(REFRESH_FAILED);
  });
  it("repeated failed refreshes cannot reseed persisted data as a fresh read", async () => {
    replies[PRIMARY] = GUEST_REFUSED; replies[STATIC] = MANIFEST;
    await mount(); replies[STATIC] = UNAVAILABLE;
    await failedPoll(); await failedPoll();
    expect(text()).toContain(REFRESH_FAILED);
    expect(text()).toContain("AAPL");
    expect(requested(STATIC)).toBeGreaterThanOrEqual(3);
    expect((await idbGet(STATIC))?.data.as_of).toBe("2026-10-08");
  });
  it("known empty data remains an empty market with no Retry", async () => {
    replies[PRIMARY] = GUEST_REFUSED; replies[STATIC] = EMPTY_MANIFEST;
    await mount(); expect(text()).toContain(NO_DATA); expect(text()).not.toContain(LOAD_ERROR); expect(retryIn()).toBeNull();
  });
  it("both authoritative absent replies remain absence with no Retry", async () => {
    replies[PRIMARY] = ABSENT; replies[STATIC] = ABSENT;
    await mount(); expect(text()).toContain(NO_DATA); expect(text()).not.toContain(LOAD_ERROR); expect(retryIn()).toBeNull();
  });
  it("no-IDB cold failures still remain unavailable", async () => {
    vi.stubGlobal("indexedDB", undefined); replies[PRIMARY] = UNAVAILABLE; replies[STATIC] = UNAVAILABLE;
    await mount(); expect(text()).toContain(LOAD_ERROR); expect(text()).not.toContain(NO_DATA);
  });
  it("malformed live fallback is unavailable even when an older disk snapshot exists", async () => {
    replies[PRIMARY] = GUEST_REFUSED; replies[STATIC] = UNPARSEABLE;
    await seedDisk(600_000); await mount(); expect(text()).toContain(LOAD_ERROR); expect(text()).not.toContain(NO_DATA);
  });
});
