// @vitest-environment jsdom
/**
 * Failure-state truth on the live spine: useFlowStream must say what the last read of
 * its key established — data, a published absence, or a read that did not land — and
 * never let one key's payload render under another.
 *
 * The defects these lock down:
 *   - the stream (SSE and its polling fallback) stayed silent for an absent or a failed
 *     key, so a consumer of the stream alone could not tell either from "still loading";
 *   - a failed refresh after data landed left the old payload on screen unlabelled;
 *   - on a key change the previous key's payload rendered for one commit, because the
 *     reset ran in a passive effect after the render that used the new key.
 *
 * The real hook and the real flowClientCache run against an injected EventSource and fetch.
 */
import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFlowStream, type FlowStreamResult } from "../flowStream";
import { flowInvalidate } from "../flowClientCache";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class TestEventSource {
  static instances: TestEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, Array<(event: { data: string }) => void>>();
  closed = false;
  constructor(readonly url: string) { TestEventSource.instances.push(this); }
  addEventListener(type: string, fn: (event: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() { this.closed = true; }
  open() { this.onopen?.(); }
  fail() { this.onerror?.(); }
  frame(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
  /** The server's named `status` event: what its last upstream read of the key established. */
  status(status: string) {
    for (const fn of this.listeners.get("status") ?? []) fn({ data: JSON.stringify({ status }) });
  }
}

type ResponseStub = { ok: boolean; status: number; json: () => Promise<unknown> };
type Pending = { resolve: (value: ResponseStub) => void; reject: (reason: unknown) => void };
const ok = (data: unknown): ResponseStub => ({ ok: true, status: 200, json: async () => data });
const failed = (status: number): ResponseStub => ({ ok: false, status, json: async () => ({ error: "x" }) });
let pending: Pending[], root: Root, host: HTMLDivElement;
const fetcher = vi.fn(() => new Promise<ResponseStub>((resolve, reject) => pending.push({ resolve, reject })));

type Seen = { feed: string | null; snapshot: Omit<FlowStreamResult<unknown>, "retry"> };
let renders: Seen[];
let retry: (() => void) | null;
function Probe({ feed }: { feed: string | null }) {
  const result = useFlowStream(feed, { pollMs: 1000 });
  const { retry: r, ...snapshot } = result;
  // Every render is recorded, including the ones a later commit overwrites.
  renders.push({ feed, snapshot });
  useEffect(() => { retry = r; });
  return <output data-testid="one">{JSON.stringify(snapshot)}</output>;
}
async function render(feed: string | null = "feed") {
  await act(async () => { root.render(<Probe feed={feed} />); });
}
const snapshot = () => JSON.parse(host.querySelector('[data-testid="one"]')!.textContent!);
const source = () => TestEventSource.instances.at(-1)!;
async function fallback() { await act(async () => { source().fail(); source().fail(); source().fail(); }); }
async function answer(index: number, reply: ResponseStub | "reject") {
  await act(async () => {
    if (reply === "reject") pending[index].reject(new TypeError("Failed to fetch"));
    else pending[index].resolve(reply);
  });
}

beforeEach(() => {
  vi.useFakeTimers(); pending = []; renders = []; retry = null;
  fetcher.mockClear(); flowInvalidate(); TestEventSource.instances = [];
  vi.stubGlobal("EventSource", TestEventSource); vi.stubGlobal("fetch", fetcher);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  flowInvalidate(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("useFlowStream: the stream names an absent or a failed key", () => {
  it("is loading, not absent, before anything has answered", async () => {
    await render();
    expect(snapshot()).toMatchObject({ data: null, status: "loading", stale: false });
  });

  it.each(["absent", "unavailable"])("over SSE: the server's %s status reaches the consumer", async (status) => {
    await render();
    await act(async () => { source().open(); source().status(status); });
    expect(snapshot()).toMatchObject({ data: null, status, stale: false, connected: true });
  });

  it.each([
    ["a 5xx", failed(503), "unavailable"],
    ["a rejected fetch", "reject" as const, "unavailable"],
    ["a 404", failed(404), "absent"],
  ])("over the polling fallback: %s is %s", async (_label, reply, status) => {
    await render(); await fallback();
    expect(pending).toHaveLength(1);
    await answer(0, reply);
    expect(snapshot()).toMatchObject({ data: null, status, stale: false });
  });

  it("ignores a status frame it does not understand", async () => {
    await render();
    await act(async () => { source().open(); source().status("bogus"); });
    expect(snapshot()).toMatchObject({ data: null, status: "loading" });
  });
});

describe("useFlowStream: a failed refresh labels the payload it keeps", () => {
  it("over SSE: the last frame stays, marked stale, until a frame lands again", async () => {
    await render();
    await act(async () => { source().open(); source().frame({ v: 1 }); });
    expect(snapshot()).toMatchObject({ data: { v: 1 }, status: "data", stale: false });

    await act(async () => source().status("unavailable"));
    expect(snapshot()).toMatchObject({ data: { v: 1 }, status: "unavailable", stale: true });

    // The producer re-sends the frame on recovery, even with unchanged bytes.
    await act(async () => source().frame({ v: 1 }));
    expect(snapshot()).toMatchObject({ data: { v: 1 }, status: "data", stale: false });
  });

  it.each([
    ["a 5xx", failed(503)],
    ["a rejected fetch", "reject" as const],
  ])("over the polling fallback: %s after data keeps the payload and marks it stale", async (_label, reply) => {
    await render(); await fallback();
    await answer(0, ok({ v: 1 }));
    expect(snapshot()).toMatchObject({ data: { v: 1 }, status: "data", stale: false });

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(pending).toHaveLength(2);
    await answer(1, reply);
    expect(snapshot()).toMatchObject({ data: { v: 1 }, status: "unavailable", stale: true });
  });

  it("a late failed poll from a retired generation does not mark a recovered stream stale", async () => {
    await render(); await fallback();
    await act(async () => { source().open(); source().frame({ v: "SSE" }); });
    await answer(0, failed(503));
    expect(snapshot()).toMatchObject({ data: { v: "SSE" }, status: "data", stale: false });
  });

  it("Retry re-reads at once and clears the label when the read lands", async () => {
    await render();
    await act(async () => { source().open(); source().frame({ v: 1 }); source().status("unavailable"); });
    expect(snapshot()).toMatchObject({ stale: true });
    expect(pending).toHaveLength(0);

    await act(async () => retry!());
    expect(pending).toHaveLength(1);
    await answer(0, ok({ v: 2 }));
    expect(snapshot()).toMatchObject({ data: { v: 2 }, status: "data", stale: false });
  });

  it("a Retry that fails again keeps the payload and the label", async () => {
    await render();
    await act(async () => { source().open(); source().frame({ v: 1 }); source().status("unavailable"); });
    await act(async () => retry!());
    await answer(0, "reject");
    expect(snapshot()).toMatchObject({ data: { v: 1 }, status: "unavailable", stale: true });
  });
});

describe("useFlowStream: one key's payload never renders under another", () => {
  it("not even for the one render between the key change and the new subscription", async () => {
    await render("gex:AAPL");
    await act(async () => { source().open(); source().frame({ root: "AAPL" }); });
    renders = [];
    await render("gex:NVDA");
    const underNvda = renders.filter((r) => r.feed === "gex:NVDA");
    expect(underNvda.length).toBeGreaterThan(0);
    for (const r of underNvda) {
      expect(r.snapshot.data).toBeNull();
      expect(r.snapshot.status).toBe("loading");
    }
  });

  it("a key that goes null keeps its last payload for cross-tab consumers", async () => {
    await render("feed");
    await act(async () => { source().open(); source().frame({ v: 1 }); });
    await render(null);
    expect(snapshot()).toMatchObject({ data: { v: 1 }, connected: false });
  });
});
