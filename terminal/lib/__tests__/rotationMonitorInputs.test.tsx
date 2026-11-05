// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRotationMonitorInputs } from "@/components/workspaces/useRotationMonitorInputs";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Pending = { url: string; signal: AbortSignal; resolve: (response: Response) => void };
let root: Root, host: HTMLDivElement, hidden: boolean;
let pending: Pending[];
const fetcher = vi.fn((url: string, init: RequestInit) => new Promise<Response>(resolve => {
  pending.push({ url, signal: init.signal as AbortSignal, resolve });
}));
function Probe({ account = "first", enabled = true }: { account?: string | null; enabled?: boolean }) {
  const input = useRotationMonitorInputs(account, enabled);
  return <output>{JSON.stringify(input)}</output>;
}
const value = () => JSON.parse(host.querySelector("output")!.textContent!);
const quoteReads = () => pending.filter(p => p.url.startsWith("/api/quote?"));
const barReads = () => pending.filter(p => p.url.startsWith("/api/intraday?"));
const response = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
async function render(account: string | null = "first", enabled = true) {
  await act(async () => root.render(<Probe account={account} enabled={enabled} />));
}
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function resolve(p: Pending, body: unknown, status = 200, headers?: Record<string, string>) {
  await act(async () => p.resolve(response(body, status, headers)));
}
async function visibility(next: boolean) {
  hidden = next;
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-27T15:00:00Z"));
  hidden = false; pending = []; fetcher.mockClear();
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  vi.stubGlobal("fetch", fetcher);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.useRealTimers(); vi.unstubAllGlobals(); delete (document as unknown as Record<string, unknown>).hidden;
});

describe("rotation view owns its reads, not market clocks", () => {
  it("does not read for guests or before the user opens the monitor", async () => {
    await render(null); expect(pending).toHaveLength(0);
    await render("first", false); expect(pending).toHaveLength(0);
    expect(value().quotes).toEqual({});
  });

  it("bounds history fanout and keeps the quote lane independent of slow bars", async () => {
    await render();
    expect(quoteReads()).toHaveLength(1); expect(barReads()).toHaveLength(3);
    expect(new URL(quoteReads()[0].url, "https://terminal.test").searchParams.get("view")).toBe("regular");
    expect(new URL(quoteReads()[0].url, "https://terminal.test").searchParams.get("syms")?.split(",")).toHaveLength(12);
    for (const p of barReads()) {
      const url = new URL(p.url, "https://terminal.test");
      expect(url.searchParams.get("date")).toBe("2026-10-27");
      expect(url.searchParams.get("tf")).toBe("5m"); expect(url.searchParams.get("ext")).toBe("0");
    }
    await resolve(quoteReads()[0], { quotes: { XLK: { asOfMs: 123, regularChg: 2 } } });
    expect(value().quotes.XLK.asOfMs).toBe(123); // Receipt time never restamps the source.
    await tick(5_000);
    expect(quoteReads()).toHaveLength(2); expect(barReads()).toHaveLength(3);
    await tick(2_000); expect(quoteReads()).toHaveLength(2);
    for (let i = 0; i < 12; i++) await resolve(barReads()[i], { bars: [], fixture: i });
    expect(barReads()).toHaveLength(12); expect(value().historyState).toBe("ready");
    expect(Object.keys(value().histories)).toHaveLength(12);
  });

  it("clears quotes on failure and respects Retry-After without a retry loop", async () => {
    await render();
    await resolve(quoteReads()[0], { quotes: { XLK: { regularChg: 2 } } });
    await tick(5_000);
    await resolve(quoteReads()[1], { error: "rate" }, 429, { "Retry-After": "120" });
    expect(value().quotes).toEqual({}); expect(value().quoteState).toBe("unavailable");
    await tick(119_000); expect(quoteReads()).toHaveLength(2);
    await tick(1_000); expect(quoteReads()).toHaveLength(3);
  });

  it("rejects an explicitly truncated quote envelope rather than silently dropping sectors", async () => {
    await render();
    await resolve(quoteReads()[0], { quotes: { XLK: { regularChg: 2 } }, truncated: { omitted: ["SPY"] } });
    expect(value().quotes).toEqual({}); expect(value().quoteState).toBe("unavailable");
  });

  it("access denial clears both lanes, aborts reads and does not resume on visibility", async () => {
    await render();
    await resolve(quoteReads()[0], { quotes: { XLK: { regularChg: 2 } } });
    await resolve(barReads()[0], { bars: [] });
    await resolve(barReads()[1], { error: "access" }, 403);
    expect(value().quoteState).toBe("access"); expect(value().historyState).toBe("access");
    expect(value().quotes).toEqual({}); expect(value().histories).toEqual({});
    expect(barReads().every(p => p.signal.aborted)).toBe(true);
    const count = pending.length;
    await visibility(true); await visibility(false); await tick(180_000);
    expect(pending).toHaveLength(count);
  });

  it("discards responses from an old account even if transport ignores abort", async () => {
    await render("first"); const old = quoteReads()[0];
    await render("second"); expect(old.signal.aborted).toBe(true);
    expect(value().quotes).toEqual({});
    await resolve(quoteReads()[1], { quotes: { XLK: { marker: "new" } } });
    await resolve(old, { quotes: { XLK: { marker: "old" } } });
    expect(value().quotes.XLK.marker).toBe("new");
    await render(null); expect(value().quotes).toEqual({}); expect(value().histories).toEqual({});
  });

  it("hides stale results while backgrounded and reconnects without carrying an old baseline", async () => {
    await render();
    await resolve(quoteReads()[0], { quotes: { XLK: { marker: "before" } } });
    const oldBars = barReads().slice();
    await visibility(true);
    expect(value().quotes).toEqual({}); expect(value().histories).toEqual({});
    expect(value().quoteState).toBe("paused"); expect(oldBars.every(p => p.signal.aborted)).toBe(true);
    const count = pending.length; await tick(120_000); expect(pending).toHaveLength(count);
    await visibility(false);
    expect(quoteReads()).toHaveLength(2); expect(value().historyState).toBe("loading");
    for (const p of oldBars) await resolve(p, { bars: [[1, 1, 1, 1, 1, 1]] });
    expect(value().histories).toEqual({});
  });

  it("holds one flight through JSON settlement and abandons a timed-out response", async () => {
    await render();
    let json!: (value: unknown) => void;
    await act(async () => quoteReads()[0].resolve({
      ok: true, status: 200, headers: new Headers(),
      json: () => new Promise(resolveJson => { json = resolveJson; }),
    } as Response));
    await tick(7_000); expect(quoteReads()).toHaveLength(1);
    await tick(1_000); expect(quoteReads()[0].signal.aborted).toBe(true);
    await act(async () => json({ quotes: { XLK: { marker: "late" } } }));
    expect(value().quotes).toEqual({});
  });

  it("partial history keeps the actual response population and does not fill missing names", async () => {
    await render();
    await resolve(barReads()[0], { error: "missing benchmark" }, 503);
    for (let i = 1; i < 12; i++) await resolve(barReads()[i], { bars: [], symbol: i });
    expect(value().historyState).toBe("partial");
    expect(Object.keys(value().histories)).toHaveLength(11);
    expect(value().histories.SPY).toBeUndefined();
  });
});
