import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const disk = vi.hoisted(() => ({ available: false, get: vi.fn() }));
vi.mock("../idbJsonStore", () => ({
  isAvailable: () => disk.available, idbGet: disk.get,
  idbPut: vi.fn(), idbDelete: vi.fn(), idbClear: vi.fn(),
}));
import { getJSONResult, getOhlc, invalidate, peek, prefetch, type CacheOutcome } from "../dataCache";
const URL = "/data/manifest.json";
const old = { as_of: "2026-09-18", symbols: { NVDA: { name: "NVIDIA", last: 100 } } };
const fresh = { as_of: "2026-09-21", symbols: { NVDA: { name: "NVIDIA", last: 110 } } };
const fetcher = vi.fn();
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
async function checkpoint() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => { disk.available = false; disk.get.mockReset(); invalidate(); fetcher.mockReset(); vi.stubGlobal("fetch", fetcher); vi.stubGlobal("window", {}); });
afterEach(() => { invalidate(); vi.unstubAllGlobals(); });
async function seed(url = URL, data: unknown = old) { fetcher.mockResolvedValueOnce(response(data)); await getJSONResult(url); }

describe("warm cache refresh handoff", () => {
  it.each(["prefetch", "reader"])("serves a cached manifest immediately behind a %s refresh and corrects every subscriber", async (owner) => {
    await seed(); const network = deferred<Response>(); fetcher.mockReturnValueOnce(network.promise);
    const first = vi.fn(), second = vi.fn();
    if (owner === "prefetch") prefetch(URL, { ttl: 0 });
    else expect(await getJSONResult(URL, { ttl: 0, onRevalidate: first })).toEqual({ status: "data", data: old });
    let delivered: CacheOutcome | null = null;
    const joined = getJSONResult(URL, { ttl: 0, onRevalidate: second }).then((v) => { delivered = v; return v; });
    await checkpoint(); const immediate = delivered;
    const blocking = getJSONResult(URL, { swr: false });
    network.resolve(response(fresh)); await blocking; await joined;
    expect(immediate).toEqual({ status: "data", data: old });
    expect(second).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledWith(fresh);
    expect(first).toHaveBeenCalledTimes(owner === "reader" ? 1 : 0);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(peek(URL)).toEqual(fresh);
  });
  it.each(["strict", "no-correction"])("keeps %s consumers waiting for the actual response", async (mode) => {
    await seed("/data/NVDA.json"); const network = deferred<Response>(); fetcher.mockReturnValueOnce(network.promise);
    prefetch("/data/NVDA.json", { ttl: 0 }); const corrected = vi.fn(); let delivered = false;
    const read = mode === "strict" ? getJSONResult("/data/NVDA.json", { swr: false, onRevalidate: corrected }) : getOhlc("NVDA");
    const joined = read.then((v) => { delivered = true; return v; });
    await checkpoint(); const early = delivered; network.resolve(response(fresh)); await joined;
    expect(early).toBe(false); expect(corrected).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("never serves a null placeholder on a cold in-flight miss", async () => {
    const network = deferred<Response>(); fetcher.mockReturnValueOnce(network.promise);
    const first = getJSONResult(URL); const corrected = vi.fn(); let early: unknown;
    const second = getJSONResult(URL, { onRevalidate: corrected }).then((v) => { early = v; return v; });
    await checkpoint(); const before = early; network.resolve(response(fresh)); await first;
    expect(before).toBeUndefined(); expect(await second).toEqual({ status: "data", data: fresh });
    expect(corrected).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["current", "invalidated", "failed"])("isolates correction callbacks for a %s request", async (mode) => {
    await seed(); const network = deferred<Response>(); fetcher.mockReturnValueOnce(network.promise);
    const first = vi.fn(() => { throw new Error("one consumer failed"); }), second = vi.fn();
    await getJSONResult(URL, { ttl: 0, onRevalidate: first });
    const joined = getJSONResult(URL, { ttl: 0, onRevalidate: second });
    const blocking = getJSONResult(URL, { swr: false });
    if (mode === "invalidated") invalidate(URL);
    network.resolve(response(mode === "failed" ? null : fresh, mode === "failed" ? 503 : 200));
    await blocking; await joined;
    expect(first).toHaveBeenCalledTimes(mode === "current" ? 1 : 0);
    expect(second).toHaveBeenCalledTimes(mode === "current" ? 1 : 0);
  });
  it("stops delivering an old generation if a correction consumer invalidates it", async () => {
    await seed(); const network = deferred<Response>(); fetcher.mockReturnValueOnce(network.promise);
    await getJSONResult(URL, { ttl: 0, onRevalidate: () => invalidate(URL) });
    const later = vi.fn(); const joined = getJSONResult(URL, { onRevalidate: later });
    const blocking = getJSONResult(URL, { swr: false });
    network.resolve(response(fresh)); await blocking; await joined;
    expect(later).not.toHaveBeenCalled(); expect(peek(URL)).toBeUndefined();
  });
  it.each([false, 0, ""])("does not mistake cached %j for an empty entry", async (cached) => {
    await seed(URL, cached); const network = deferred<Response>(); fetcher.mockReturnValueOnce(network.promise);
    prefetch(URL, { ttl: 0 }); let delivered: CacheOutcome | null = null;
    const joined = getJSONResult(URL, { onRevalidate: vi.fn() }).then((v) => { delivered = v; });
    await checkpoint(); const before = delivered; network.resolve(response(fresh)); await joined;
    expect(before).toEqual({ status: "data", data: cached });
  });
  it("preserves nonblocking correction for consumers racing through IndexedDB", async () => {
    disk.available = true;
    const diskA = deferred<unknown>(), diskB = deferred<unknown>(), network = deferred<Response>();
    disk.get.mockReturnValueOnce(diskA.promise).mockReturnValueOnce(diskB.promise);
    fetcher.mockReturnValueOnce(network.promise);
    const firstCorrection = vi.fn(), secondCorrection = vi.fn();
    const first = getJSONResult(URL, { onRevalidate: firstCorrection });
    let delivered: CacheOutcome | null = null;
    const second = getJSONResult(URL, { onRevalidate: secondCorrection }).then((v) => { delivered = v; return v; });
    const persisted = { url: URL, data: old, ts: Date.now() - 90_000 };
    diskA.resolve(persisted); expect(await first).toEqual({ status: "data", data: old });
    diskB.resolve(persisted); await checkpoint(); const immediate = delivered;
    const blocking = getJSONResult(URL, { swr: false });
    network.resolve(response(fresh)); await blocking; await second;
    expect(immediate).toEqual({ status: "data", data: old });
    expect(firstCorrection).toHaveBeenCalledTimes(1); expect(firstCorrection).toHaveBeenCalledWith(fresh);
    expect(secondCorrection).toHaveBeenCalledTimes(1); expect(secondCorrection).toHaveBeenCalledWith(fresh);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
