import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bar6 } from "../intradayShared";
import type { BoatsHistoryEvidence } from "../tiingoBoatsStore";

const state = vi.hoisted(() => ({
  now: Date.parse("2026-10-19T01:15:20Z"),
  fetches: 0,
  holdRefresh: false,
  releaseRefresh: null as null | (() => void),
}));

// Keep the real daytime cache, 24H API route, serializer and chart consumer in
// one process. Replace only network, disk and Next's after() scheduler at the edges.
vi.mock("next/server", async original => ({
  ...await original<typeof import("next/server")>(), after: vi.fn(),
}));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }), tooMany: vi.fn() }));
vi.mock("@/lib/flowSource", () => ({ intradayFixture: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const daytimeBar: Bar6 = [Date.parse("2026-10-16T15:59:00Z") / 1000, 100, 102, 99, 101, 12];
vi.mock("@/lib/intradaySources", async original => ({
  ...await original<typeof import("@/lib/intradaySources")>(),
  fetchIntraday: async () => {
    state.fetches++;
    if (state.holdRefresh) await new Promise<void>(resolve => { state.releaseRefresh = resolve; });
    return [daytimeBar];
  },
}));
vi.mock("@/lib/intradayStore", () => ({
  withStoredHistory: async (_sym: string, _tf: string, _ext: boolean,
    live: Bar6[], capture?: (trace: { origins: [number, "live_tail"][]; storeReads: [] }) => void,
  ) => {
    capture?.({ origins: live.map(bar => [bar[0], "live_tail"]), storeReads: [] });
    return live;
  },
}));
vi.mock("@/lib/tiingoBoatsStore", async original => ({
  ...await original<typeof import("@/lib/tiingoBoatsStore")>(),
  readTiingoBoatsHistory: async (symbol: string) => ({
    bars: [],
    evidence: {
      schema: "terminal.tiingo_boats_history_evidence.v1", status: "missing",
      source: "tiingo-boats-rest", venue: "BOATS",
      requested_symbol: symbol, vendor_symbol: symbol,
      content_sha256: null, receipt_ids: [],
      read_scope: "whole_input_file_not_requested_date",
      observed_at_utc: [], price_basis: "vendor_reported_unqualified",
      volume_basis: "vendor_reported_shares", coverage: "captured_vendor_bars_only",
      complete: false, input_bars: 0, calendar_excluded_bars: 0,
      returned_bars: 0, conflicts_excluded: 0,
    } satisfies BoatsHistoryEvidence,
  }),
}));

import { GET } from "@/app/api/intraday/route";
import { boatsChartRefresh } from "../boatsChartRefresh";

afterEach(() => {
  state.releaseRefresh?.();
  state.releaseRefresh = null;
  state.holdRefresh = false;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("complete daytime cache -> 24H route -> chart consumer", () => {
  it("keeps a source-complete daytime snapshot during revalidation without inventing BOATS freshness", async () => {
    const initialNow = state.now;
    vi.spyOn(Date, "now").mockImplementation(() => state.now);
    vi.stubEnv("TERMINAL_REQUIRE_AUTH", "0");
    vi.stubEnv("FLOW_FIXTURE", "0");
    vi.stubEnv("TIINGO_BOATS_LIVE_DIR", "");
    const request = () => GET(new Request("https://unit.test/api/intraday?sym=WARMGUARD&tf=1m&session=24h"));

    state.fetches = 0;
    state.holdRefresh = false;
    const first = await (await request()).json();
    expect(first.bars).toEqual([daytimeBar]);
    expect(first.daytime_cache).toMatchObject({
      assembly_complete: true, refresh_pending: false, refresh_error: null,
      meaning: "daytime_assembly_not_market_data_freshness",
    });
    expect(first.boats_history.observed_at_utc).toEqual([]);
    expect(state.fetches).toBe(1);

    state.now = initialNow + 46_000; // expire the 45-second daytime TTL
    state.holdRefresh = true; // deterministic in-flight refresh, no upstream I/O
    const warm = await (await request()).json();
    expect(state.fetches).toBe(2);
    expect(warm.bars).toEqual([daytimeBar]);
    expect(warm.daytime_cache).toMatchObject({
      cache_state: "stale_cache", refresh_pending: true, assembly_complete: true,
      refresh_error: null, meaning: "daytime_assembly_not_market_data_freshness",
    });
    expect(warm.daytime_cache.assembled_at).toBe(first.daytime_cache.assembled_at);
    expect(warm.boats_history.observed_at_utc).toEqual([]);

    const adopted = boatsChartRefresh(warm, "WARMGUARD", "1m", null, 0, state.now);
    expect(adopted).toMatchObject({
      bars: [{ time: daytimeBar[0], o: 100, h: 102, l: 99, c: 101, v: 12 }],
      captureMs: 0, appliedTradeMs: 0,
    });
    expect(boatsChartRefresh({
      ...warm, daytime_cache: { ...warm.daytime_cache, assembly_complete: false },
    }, "WARMGUARD", "1m", null, 0, state.now)).toBeNull();
    state.releaseRefresh?.();
    state.releaseRefresh = null;
  });
});
