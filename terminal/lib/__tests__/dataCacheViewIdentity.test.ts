// Data OS U02 — view-aware OHLC cache identity. v1 publishes exactly one view per URL
// (CURRENT_TRADJ_VIEW): the view key exists so a future second view can never alias
// today's entry, and an unsupported view must refuse BEFORE any fetch or cache write.
// Fetch stubbing follows lib/__tests__/dataCacheRequestOwnership.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CURRENT_TRADJ_VIEW, getOhlc, getOhlcView, getSliceAndOhlc, invalidate, ohlcViewKey,
} from "@/lib/dataCache";

const URL = "/data/NVDA.json";
const bars = [{ time: "2026-09-21", open: 100, high: 105, low: 99, close: 104, volume: 900 }];
const response = (status: number, value: unknown = null) => new Response(JSON.stringify(value), { status });

beforeEach(() => { invalidate(); });
afterEach(() => { invalidate(); vi.unstubAllGlobals(); });

describe("ohlcViewKey", () => {
  it("distinct views get distinct keys; equal views get the same key; unusable symbols get null", () => {
    const tradj = ohlcViewKey("nvda", CURRENT_TRADJ_VIEW);
    expect(tradj).toBe("NVDA|tradj|latest|CURRENT");
    // Same view VALUES in a fresh object — identity is structural, not referential.
    expect(ohlcViewKey(" NVDA ", { basis: "tradj", revision: "latest", mode: "CURRENT" })).toBe(tradj);
    // A second view (a future SADJ series) can never alias today's entry.
    expect(ohlcViewKey("NVDA", { basis: "sadj", revision: "latest", mode: "CURRENT" })).not.toBe(tradj);
    expect(ohlcViewKey("NVDA", { basis: "tradj", revision: "r-2", mode: "CURRENT" })).not.toBe(tradj);
    expect(ohlcViewKey("NVDA", { basis: "tradj", revision: "latest", mode: "REPLAY" })).not.toBe(tradj);
    // Unusable symbols (canonicalChartSymbol null) never mint a key.
    for (const bad of ["", "   ", "A B", "A/B", "NVDÄ"]) expect(ohlcViewKey(bad, CURRENT_TRADJ_VIEW)).toBe(null);
  });
});

describe("getOhlcView", () => {
  it("an unsupported view refuses with no fetch and no cache write", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, bars));
    vi.stubGlobal("fetch", fetcher);
    const unsupported = { basis: "sadj", revision: "latest", mode: "CURRENT" };
    await expect(getOhlcView("NVDA", unsupported)).resolves.toEqual({
      status: "refused", reason: "VIEW_UNSUPPORTED", view: unsupported,
    });
    expect(fetcher).toHaveBeenCalledTimes(0);
    // The refusal left no cache entry: the next plain read still performs its own fetch.
    expect(await getOhlc("NVDA")).toEqual(bars);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(URL);
  });

  it("a supported view and getSliceAndOhlc(sym).ohlc started together collapse onto ONE fetch", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      response(String(input).endsWith(".slice.json") ? 404 : 200, String(input).endsWith(".slice.json") ? null : bars));
    vi.stubGlobal("fetch", fetcher);
    const [viewRead, chartReads] = [getOhlcView("NVDA"), getSliceAndOhlc("NVDA")];
    const [viewOutcome, ohlcOutcome] = await Promise.all([viewRead, chartReads.ohlc]);
    // Same URL, same cache entry, same answer shape as the chart's own read.
    expect(viewOutcome).toEqual(ohlcOutcome);
    expect(viewOutcome).toEqual({ status: "data", data: bars });
    expect(fetcher.mock.calls.filter((c) => String(c[0]) === URL)).toHaveLength(1);
    await chartReads.slice;   // let the optional slice settle too
  });
});
