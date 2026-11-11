// @vitest-environment jsdom
import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFlowStream } from "../flowStream";
import { flowGet, flowInvalidate } from "../flowClientCache";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class TestEventSource {
  static instances: TestEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState: number = TestEventSource.CONNECTING;
  closed = false;
  constructor(readonly url: string) { TestEventSource.instances.push(this); }
  addEventListener() { /* the named status event is covered by flowStreamFailureState */ }
  close() { this.closed = true; this.readyState = TestEventSource.CLOSED; }
  open() { this.readyState = TestEventSource.OPEN; this.onopen?.(); }
  // An ordinary failed attempt: the agent stays CONNECTING and retries by itself.
  fail() { this.readyState = TestEventSource.CONNECTING; this.onerror?.(); }
  // A fatal failure per the WHATWG model: readyState settles at CLOSED and
  // `error` fires once — the agent will never reconnect this stream by itself.
  failClosed() { this.readyState = TestEventSource.CLOSED; this.onerror?.(); }
  frame(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
type ResponseStub = { ok: boolean; status?: number; json: () => Promise<unknown> };
const response = (data: unknown): ResponseStub => ({ ok: true, json: async () => data });
const denied = (status: number): ResponseStub => ({ ok: false, status, json: async () => ({ reason: "forbidden" }) });
let pending: Array<(value: ResponseStub) => void>, root: Root, host: HTMLDivElement;
const fetcher = vi.fn(() => new Promise<ResponseStub>(resolve => pending.push(resolve)));
function Probe({ feed, id = "one" }: { feed: string | null; id?: string }) {
  const snapshot = useFlowStream(feed, { pollMs: 1000 });
  return <output data-testid={id}>{JSON.stringify(snapshot)}</output>;
}
async function render(feed: string | null = "feed", second = false, strict = false) {
  await act(async () => {
    const probes = <><Probe feed={feed} />{second && <Probe feed={feed} id="two" />}</>;
    root.render(strict ? <StrictMode>{probes}</StrictMode> : probes);
  });
}
const snapshot = (id = "one") => JSON.parse(host.querySelector(`[data-testid="${id}"]`)!.textContent!);
const source = () => TestEventSource.instances.at(-1)!;
async function fallback() { await act(async () => { source().fail(); source().fail(); source().fail(); }); }
async function resolvePoll(index: number, data: unknown) { await act(async () => { pending[index](response(data)); }); }
beforeEach(() => {
  vi.useFakeTimers(); pending = []; fetcher.mockClear(); flowInvalidate(); TestEventSource.instances = [];
  vi.stubGlobal("EventSource", TestEventSource); vi.stubGlobal("fetch", fetcher);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  flowInvalidate(); vi.useRealTimers(); vi.unstubAllGlobals();
});
describe("mounted flow stream transport ownership", () => {
  it("drops a delayed fallback response after SSE recovers", async () => {
    await render(); await fallback(); expect(pending).toHaveLength(1);
    await act(async () => { source().open(); source().frame({ value: "SSE" }); });
    await resolvePoll(0, { value: "old poll" });
    expect(snapshot()).toEqual({ data: { value: "SSE" }, connected: true, error: false, status: "data", stale: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("a valid arriving SSE frame takes ownership over a pending fallback", async () => {
    await render(); await fallback();
    await act(async () => source().frame({ value: "frame" }));
    await resolvePoll(0, { value: "old poll" });
    expect(snapshot().data).toEqual({ value: "frame" });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not reuse a retired poll's cached bytes during the next fallback", async () => {
    await render(); await fallback();
    await act(async () => { source().open(); source().frame({ value: "SSE" }); });
    await resolvePoll(0, { value: "retired poll" });
    await fallback();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(snapshot().data).toEqual({ value: "SSE" });
    await resolvePoll(1, { value: "new fallback" });
    expect(snapshot()).toEqual({ data: { value: "new fallback" }, connected: false, error: false, status: "data", stale: false });
  });
  it("does not adopt an earlier generation's still-pending request after another outage", async () => {
    await render(); await fallback();
    await act(async () => { source().open(); source().frame({ value: "SSE" }); });
    await fallback();
    await resolvePoll(0, { value: "retired poll" });
    expect(snapshot().data).toEqual({ value: "SSE" });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await resolvePoll(1, { value: "current fallback" });
    expect(snapshot().data).toEqual({ value: "current fallback" });
  });
  it("awaits a fresh fallback request instead of publishing an SWR cache preimage", async () => {
    const warming = flowGet("feed"); pending[0](response({ value: "cached" })); await warming;
    await render(); await fallback();
    expect(fetcher).toHaveBeenCalledTimes(2); expect(snapshot().data).toBeNull();
    await resolvePoll(1, { value: "fresh" }); expect(snapshot().data).toEqual({ value: "fresh" });
  });
  it("shares one connection and one outstanding fallback request between mounted consumers", async () => {
    await render("feed", true); expect(TestEventSource.instances).toHaveLength(1);
    await fallback(); await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await resolvePoll(0, { value: "shared" }); expect(snapshot()).toEqual(snapshot("two"));
    await render("feed", false); expect(source().closed).toBe(false);
    await act(async () => root.render(null)); expect(source().closed).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects the departed feed's callbacks and pending response after a key change", async () => {
    await render("gex:AAPL"); const old = source(); await fallback();
    await render("gex:NVDA"); expect(old.closed).toBe(true);
    await act(async () => { source().open(); source().frame({ value: "NVDA" }); old.frame({ value: "AAPL" }); });
    await resolvePoll(0, { value: "old fallback" }); expect(snapshot().data).toEqual({ value: "NVDA" });
  });
  it("retains the last good frame on malformed JSON and accepts producer time corrections", async () => {
    await render(); await act(async () => { source().open(); source().frame({ asof: 200 }); source().onmessage?.({ data: "{" }); });
    expect(snapshot().data).toEqual({ asof: 200 });
    await act(async () => source().frame({ asof: 100 })); expect(snapshot().data).toEqual({ asof: 100 });
  });
  it("keeps fallback functional when EventSource is absent", async () => {
    vi.stubGlobal("EventSource", undefined); delete (window as unknown as { EventSource?: unknown }).EventSource;
    await render(); expect(TestEventSource.instances).toHaveLength(0);
    await resolvePoll(0, { value: "poll only" }); expect(snapshot().data).toEqual({ value: "poll only" });
  });
  it("cleans StrictMode's discarded connection and prevents its late callbacks", async () => {
    await render("feed", false, true); expect(TestEventSource.instances).toHaveLength(2);
    const old = TestEventSource.instances[0]; expect(old.closed).toBe(true);
    await act(async () => { source().open(); source().frame({ value: "current" }); old.frame({ value: "discarded" }); });
    expect(snapshot().data).toEqual({ value: "current" });
  });
});
describe("fatal CLOSED stream recovery", () => {
  it("starts the existing polling fallback on one fatal CLOSED error and delivers fresh meta", async () => {
    await render("meta");
    await act(async () => { source().failClosed(); });
    expect(pending).toHaveLength(1);
    await resolvePoll(0, { value: "fresh meta" });
    expect(snapshot()).toEqual({ data: { value: "fresh meta" }, connected: false, error: false, status: "data", stale: false });
  });
  it("does not poll while the agent still reconnects; the third CONNECTING error starts one fallback", async () => {
    await render();
    await act(async () => { source().fail(); });
    expect(pending).toHaveLength(0);
    await act(async () => { source().fail(); });
    expect(pending).toHaveLength(0);
    await act(async () => { source().fail(); });
    expect(pending).toHaveLength(1);
  });
  it("stops the closed-stream fallback when the consumer unmounts", async () => {
    await render();
    await act(async () => { source().failClosed(); });
    await resolvePoll(0, { value: "kept" });
    const src = source();
    await act(async () => root.render(null));
    expect(src.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    fetcher.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetcher).toHaveBeenCalledTimes(0);
  });
  it("keeps a denied fallback read classified unavailable and never shows it as fresh data", async () => {
    await render();
    await act(async () => { source().failClosed(); });
    expect(pending).toHaveLength(1);
    await act(async () => { pending[0](denied(403)); });
    expect(snapshot()).toEqual({ data: null, connected: false, error: true, status: "unavailable", stale: false });
  });
  it("keeps one fallback interval and one bounded read after duplicate closed callbacks", async () => {
    const interval = vi.spyOn(globalThis, "setInterval");
    try {
      await render("meta");
      await act(async () => { source().failClosed(); source().failClosed(); });
      expect(pending).toHaveLength(1);
      expect(interval).toHaveBeenCalledTimes(1);
      expect(interval).toHaveBeenCalledWith(expect.any(Function), 1000);
      // One polling interval plus the existing cache owner's pending-read deadline.
      expect(vi.getTimerCount()).toBe(2);
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(interval).toHaveBeenCalledTimes(1);
      await resolvePoll(0, { value: "fresh meta" });
      expect(vi.getTimerCount()).toBe(1); // Completed read cleared its deadline.
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(2);
      expect(interval).toHaveBeenCalledTimes(1);
      await resolvePoll(1, { value: "next meta" });
      expect(vi.getTimerCount()).toBe(1);
      await act(async () => root.render(null));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      interval.mockRestore();
    }
  });
});
