import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntradayAssemblyTrace } from "../intradayEvidence";
import type { Bar6 } from "../intradayShared";

const fixture = vi.hoisted(() => ({
  day1: Date.UTC(2026, 5, 15, 9, 30) / 1000,
  day2: Date.UTC(2026, 5, 16, 9, 30) / 1000,
}));
const state = vi.hoisted(() => ({
  live: [] as number[][],
  output: [] as number[][],
  trace: null as unknown,
  fetchThrows: false,
  storeThrows: false,
  fetchCalls: 0,
  storeCalls: 0,
  now: 1_800_000_000_000,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: () => ({ ok: true }), tooMany: vi.fn() }));
vi.mock("@/lib/flowSource", () => ({ intradayFixture: async () => null }));
vi.mock("@/lib/intradaySources", async (original) => ({
  ...await original<typeof import("@/lib/intradaySources")>(),
  fetchIntraday: async () => {
    state.fetchCalls++;
    if (state.fetchThrows) throw new Error("upstream down");
    return state.live as never;
  },
}));
vi.mock("@/lib/intradayStore", () => ({
  withStoredHistory: async (
    _sym: string, _tf: string, _ext: boolean, _live: Bar6[],
    capture?: (trace: IntradayAssemblyTrace) => void,
  ) => {
    state.storeCalls++;
    if (state.storeThrows) throw new Error("store down");
    if (capture && state.trace) capture(state.trace as IntradayAssemblyTrace);
    return state.output as Bar6[];
  },
}));

import { GET } from "@/app/api/intraday/route";

const stored1hTrace = (): IntradayAssemblyTrace => ({
  origins: [[fixture.day1, "stored_1h"]],
  storeReads: [
    { base: "5m", status: "missing", content_sha256: null },
    { base: "1h", status: "available", content_sha256: "a".repeat(64) },
  ],
});
const bar = (epoch: number, close = 101): Bar6 => [epoch, 100, 102, 99, close, 50];
const call = (sym: string, tf = "4h", date = "") => GET(new Request(
  `https://unit.test/api/intraday?sym=${encodeURIComponent(sym)}&tf=${encodeURIComponent(tf)}${date ? `&date=${date}` : ""}`,
));

beforeEach(() => {
  state.live = [];
  state.output = [bar(fixture.day1)];
  state.trace = stored1hTrace();
  state.fetchThrows = false;
  state.storeThrows = false;
  state.fetchCalls = 0;
  state.storeCalls = 0;
  state.now = 1_800_000_000_000;
  vi.stubEnv("TERMINAL_REQUIRE_AUTH", "0");
  vi.stubEnv("FLOW_FIXTURE", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("existing intraday API source-evidence consumer", () => {
  it("discloses a provider-hourly fallback without changing the returned candle", async () => {
    const response = await call("LINEAGE-A", "4h", "2026-06-15");
    const body = await response.json();
    expect(body.bars).toEqual([bar(fixture.day1)]);
    expect(body.source_evidence.construction).toBe("stored_1h");
    expect(body.source_evidence.source_counts.stored_1h).toBe(1);
    expect(body.source_evidence.response_scope.requested_date).toBe("2026-06-15");
    expect(body.source_evidence.research_admission).toBe("not_assessed");
    expect(body.source_evidence.warnings).toContain("provider_hourly_open_alignment_not_guaranteed");
    expect(body.source_evidence).not.toHaveProperty("origins");
  });

  it("projects source counts after requested-date filtering", async () => {
    state.output = [bar(fixture.day1), bar(fixture.day2, 103)];
    state.trace = {
      origins: [[fixture.day1, "stored_1h"], [fixture.day2, "stored_5m"]],
      storeReads: stored1hTrace().storeReads,
    } satisfies IntradayAssemblyTrace;
    const body = await (await call("LINEAGE-DATE", "4h", "2026-06-15")).json();
    expect(body.bars).toEqual([bar(fixture.day1)]);
    expect(body.source_evidence.response_scope.returned_bars).toBe(1);
    expect(body.source_evidence.source_counts).toEqual({
      stored_5m: 0, stored_1h: 1, live_tail: 0, unattributed: 0,
    });
    expect(body.source_evidence.store_read_scope).toBe("whole_assembly_not_requested_date");
  });

  it("preserves assembly time and grows cache age on a cache hit", async () => {
    vi.spyOn(Date, "now").mockImplementation(() => state.now);
    const first = await (await call("LINEAGE-CACHE")).json();
    expect(first.source_evidence.assembly_clock.cache_state).toBe("new_assembly");
    expect(first.source_evidence.assembly_clock.cache_age_ms).toBe(0);
    const assembledAt = first.source_evidence.assembly_clock.assembled_at;

    state.now += 3_000;
    const second = await (await call("LINEAGE-CACHE")).json();
    expect(second.source_evidence.assembly_clock.cache_state).toBe("cache");
    expect(second.source_evidence.assembly_clock.assembled_at).toBe(assembledAt);
    expect(second.source_evidence.assembly_clock.cache_age_ms).toBe(3_000);
    expect(state.fetchCalls).toBe(1);
    expect(state.storeCalls).toBe(1);
  });

  it("marks an expired cached payload stale when both refresh legs fail", async () => {
    vi.spyOn(Date, "now").mockImplementation(() => state.now);
    const warm = await (await call("LINEAGE-STALE")).json();
    expect(warm.bars).toEqual([bar(fixture.day1)]);
    const assembledAt = warm.source_evidence.assembly_clock.assembled_at;

    state.now += 46_000;
    state.fetchThrows = true;
    state.storeThrows = true;
    const stale = await (await call("LINEAGE-STALE")).json();
    expect(stale.bars).toEqual(warm.bars);
    expect(stale.source_evidence.assembly_clock.cache_state).toBe("stale_cache");
    expect(stale.source_evidence.assembly_clock.assembled_at).toBe(assembledAt);
    expect(stale.source_evidence.assembly_clock.cache_age_ms).toBe(46_000);
    expect(stale.source_evidence.warnings).toContain("stale_cache_after_refresh_failure");
    expect(state.fetchCalls).toBe(2);
    expect(state.storeCalls).toBe(2);
  });

  it("does not attach US source qualification to a non-US response", async () => {
    const body = await (await call("0700.HK", "4h")).json();
    expect(body.bars).toEqual([bar(fixture.day1)]);
    expect(body).not.toHaveProperty("source_evidence");
  });

  it("leaves the second band outside the stored-history evidence path", async () => {
    vi.stubEnv("HUB_REALTIME_QUOTES", "1");
    state.live = [bar(fixture.day1)];
    const body = await (await call("LINEAGE-SECOND", "1s", "2026-06-15")).json();
    expect(body.bars).toEqual([bar(fixture.day1)]);
    expect(body.source).toBe("polygon-second");
    expect(body).not.toHaveProperty("source_evidence");
    expect(state.storeCalls).toBe(0);
  });
});
