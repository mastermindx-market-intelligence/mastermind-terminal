import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getJSON, getSliceAndOhlc, invalidate } from "@/lib/dataCache";

// T08 — the chart's required OHLC must not wait on its optional slice.
//
// `getSliceAndOhlc` used to `await Promise.all([ohlc, slice])`, so a slow slice held back a chart
// whose bars had already arrived. The two reads now settle independently; both still start at once
// and still share the cache's single in-flight request with any other consumer of the same URL.

const OHLC_URL = "/data/NVDA.json";
const SLICE_URL = "/data/NVDA.slice.json";
const ohlc = { bars: [["2026-09-21", 100, 105, 99, 104, 900]] };
const slice = { indicator: { signals: [{ ts: "2026-09-21", type: "BUY" }] } };
const response = (status: number, value: unknown = null) => new Response(JSON.stringify(value), { status });
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
const pending = Symbol("pending");
const settledWithin = async <T>(promise: Promise<T>) =>
  Promise.race([promise, new Promise<typeof pending>((done) => setTimeout(() => done(pending), 20))]);

beforeEach(() => { invalidate(); });
afterEach(() => { invalidate(); vi.unstubAllGlobals(); });

describe("chart data: required OHLC and optional slice settle independently", () => {
  it("OHLC resolves while the slice body is still pending", async () => {
    const slow = deferred();
    const fetcher = vi.fn((url: string) => (url === SLICE_URL ? slow.promise : Promise.resolve(response(200, ohlc))));
    vi.stubGlobal("fetch", fetcher);

    const requests = getSliceAndOhlc("NVDA");
    // Both requests start immediately — the slice is not deferred behind the bars.
    expect(fetcher.mock.calls.map(([url]) => url).sort()).toEqual([OHLC_URL, SLICE_URL]);
    expect(await settledWithin(requests.ohlc)).toEqual({ status: "data", data: ohlc });
    expect(await settledWithin(requests.slice)).toBe(pending);

    slow.resolve(response(200, slice));
    expect(await requests.slice).toEqual({ status: "data", data: slice });
  });

  it("a slow OHLC stays pending even when the slice has already arrived", async () => {
    const slow = deferred();
    vi.stubGlobal("fetch", vi.fn((url: string) => (url === OHLC_URL ? slow.promise : Promise.resolve(response(200, slice)))));

    const requests = getSliceAndOhlc("NVDA");
    expect(await settledWithin(requests.slice)).toEqual({ status: "data", data: slice });
    expect(await settledWithin(requests.ohlc)).toBe(pending);
    slow.resolve(response(200, ohlc));
    expect(await requests.ohlc).toEqual({ status: "data", data: ohlc });
  });

  it("keeps unavailable distinct from absent for both reads", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(response(url === OHLC_URL ? 503 : 404))));
    const requests = getSliceAndOhlc("NVDA");
    expect(await requests.ohlc).toMatchObject({ status: "unavailable", reason: "server", httpStatus: 503 });
    expect(await requests.slice).toMatchObject({ status: "absent", httpStatus: 404 });
  });

  it("shares one in-flight request per file with any other consumer", async () => {
    const slow = deferred();
    const fetcher = vi.fn((url: string) => (url === SLICE_URL ? slow.promise : Promise.resolve(response(200, ohlc))));
    vi.stubGlobal("fetch", fetcher);

    const shellSlice = getJSON(SLICE_URL);          // TerminalShell's own slice read
    const requests = getSliceAndOhlc("NVDA");
    const again = getSliceAndOhlc("NVDA");
    slow.resolve(response(200, slice));
    expect(await shellSlice).toEqual(slice);
    expect(await requests.slice).toEqual({ status: "data", data: slice });
    expect(await again.ohlc).toEqual({ status: "data", data: ohlc });
    expect(fetcher.mock.calls.filter(([url]) => url === SLICE_URL)).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([url]) => url === OHLC_URL)).toHaveLength(1);
  });

  it("an unusable symbol issues no request and answers absent", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const requests = getSliceAndOhlc("../secret");
    expect(await requests.ohlc).toEqual({ status: "absent" });
    expect(await requests.slice).toEqual({ status: "absent" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
