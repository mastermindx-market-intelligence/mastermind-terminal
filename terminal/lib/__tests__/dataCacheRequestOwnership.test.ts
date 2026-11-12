import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _neg404Has, getJSONResult, getOhlc, invalidate, peek } from "@/lib/dataCache";

const URL = "/data/NVDA.ohlc.json";
const bars = [{ time: "2026-09-21", open: 100, high: 105, low: 99, close: 104, volume: 900 }];
const response = (status: number, value: unknown = null) => new Response(JSON.stringify(value), { status });
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => { invalidate(); });
afterEach(() => { invalidate(); vi.unstubAllGlobals(); });

describe("data cache request ownership after refresh", () => {
  it.each([404, 410])("an invalidated request's late %i cannot hide successfully recovered OHLC", async (status) => {
    const old = deferred();
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(response(200, bars));
    vi.stubGlobal("fetch", fetcher);
    const outdated = getJSONResult(URL);
    invalidate(URL);
    expect(await getOhlc("NVDA")).toEqual(bars);
    old.resolve(response(status));
    expect(await outdated).toEqual({ status: "absent", httpStatus: status });
    expect(_neg404Has(URL)).toBe(false);
    expect(await getOhlc("NVDA")).toEqual(bars);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(["one", "all"])("a late 404 cannot undo %s-key invalidation before the next request", async (scope) => {
    const old = deferred();
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(response(200, bars));
    vi.stubGlobal("fetch", fetcher);
    const outdated = getJSONResult(URL);
    invalidate(scope === "all" ? undefined : URL);
    old.resolve(response(404)); await outdated;
    expect(_neg404Has(URL)).toBe(false);
    expect(await getOhlc("NVDA")).toEqual(bars);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("an LRU-evicted request cannot recreate a negative-cache entry", async () => {
    const old = deferred();
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockImplementation(async () => response(200, bars));
    vi.stubGlobal("fetch", fetcher);
    const outdated = getJSONResult(URL);
    for (let i = 0; i < 401; i += 1) await getJSONResult(`/data/test-${i}.json`);
    expect(peek(URL)).toBeUndefined();
    old.resolve(response(410)); await outdated;
    expect(_neg404Has(URL)).toBe(false);
    expect(await getOhlc("NVDA")).toEqual(bars);
    expect(fetcher).toHaveBeenCalledTimes(403);
  });
  it.each([404, 410])("still remembers a current request's genuine %i without duplicate requests", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(response(status)); vi.stubGlobal("fetch", fetcher);
    expect(await getJSONResult(URL)).toEqual({ status: "absent", httpStatus: status });
    expect(_neg404Has(URL)).toBe(true);
    expect(await getJSONResult(URL)).toEqual({ status: "absent" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not overwrite a newer successful response with a superseded successful response", async () => {
    const old = deferred();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(response(200, bars)));
    const outdated = getJSONResult(URL); invalidate(URL);
    await getOhlc("NVDA"); old.resolve(response(200, [{ close: 1 }])); await outdated;
    expect(await getOhlc("NVDA")).toEqual(bars);
  });
  it("does not convert transient transport failures into absence", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(503)).mockResolvedValue(response(200, bars));
    vi.stubGlobal("fetch", fetcher);
    expect(await getJSONResult(URL)).toEqual({ status: "unavailable", reason: "server", httpStatus: 503 });
    expect(_neg404Has(URL)).toBe(false);
    expect(await getOhlc("NVDA")).toEqual(bars);
  });
});
