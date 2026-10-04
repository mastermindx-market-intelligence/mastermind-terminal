import { describe, expect, it } from "vitest";
import { buildIntradaySourceEvidence } from "../intradayEvidence";
import type { IntradayAssemblyTrace, EvidenceContext } from "../intradayEvidence";
import type { Bar6 } from "../intradayShared";

type BarOrigin = "stored_5m" | "stored_1h" | "live_tail" | "unattributed";

const fakeTrace = (origins: Array<[number, BarOrigin]>, storeReads: unknown[] = []): IntradayAssemblyTrace => ({
  origins,
  storeReads: storeReads as IntradayAssemblyTrace["storeReads"],
});

const ctx = (overrides: Partial<EvidenceContext> = {}): EvidenceContext => ({
  symbol: "AAPL",
  timeframe: "5m",
  extended: false,
  sessionDate: "2026-09-14",
  assembledAtMs: 1_726_400_000_000,
  servedAtMs: 1_726_400_050_000,
  cacheState: "new_assembly",
  ...overrides,
});

const bar = (epoch: number): Bar6 => [epoch, 100, 101, 99, 100.5, 1000];

describe("buildIntradaySourceEvidence", () => {
  // ── Pure projection counts ──────────────────────────────────────────────────

  it("separates stored_5m / stored_1h / live_tail counts", () => {
    const bars: Bar6[] = [bar(1000), bar(2000), bar(3000), bar(4000)];
    const trace = fakeTrace([
      [1000, "stored_5m"], [2000, "stored_5m"],
      [3000, "stored_1h"], [4000, "stored_1h"],
    ]);
    const result = buildIntradaySourceEvidence(bars, trace, ctx());
    expect(result.source_counts).toEqual({
      stored_5m: 2, stored_1h: 2, live_tail: 0, unattributed: 0,
    });
  });

  it("counts live_tail separately from stored", () => {
    const bars: Bar6[] = [bar(1000), bar(2000), bar(5000)];
    const trace = fakeTrace([
      [1000, "stored_5m"], [2000, "stored_5m"], [5000, "live_tail"],
    ]);
    const result = buildIntradaySourceEvidence(bars, trace, ctx());
    expect(result.source_counts).toEqual({
      stored_5m: 2, stored_1h: 0, live_tail: 1, unattributed: 0,
    });
  });

  it("counts unattributed for epochs with no origin entry", () => {
    const bars: Bar6[] = [bar(1000), bar(2000), bar(3000)];
    const trace = fakeTrace([[1000, "stored_5m"]]);
    const result = buildIntradaySourceEvidence(bars, trace, ctx());
    expect(result.source_counts.unattributed).toBe(2);
  });

  it("returns empty counts for empty bars", () => {
    const result = buildIntradaySourceEvidence([], null, ctx());
    expect(result.source_counts).toEqual({
      stored_5m: 0, stored_1h: 0, live_tail: 0, unattributed: 0,
    });
    expect(result.construction).toBe("empty");
  });

  it("reports mixed construction when bars come from more than one origin", () => {
    const bars: Bar6[] = [bar(1000), bar(5000)];
    const trace = fakeTrace([[1000, "stored_5m"], [5000, "live_tail"]]);
    const result = buildIntradaySourceEvidence(bars, trace, ctx());
    expect(result.construction).toBe("mixed");
  });

  it("reports single-origin construction name", () => {
    const bars: Bar6[] = [bar(1000), bar(2000)];
    const trace = fakeTrace([[1000, "stored_5m"], [2000, "stored_5m"]]);
    const result = buildIntradaySourceEvidence(bars, trace, ctx());
    expect(result.construction).toBe("stored_5m");
  });

  // ── Conflict attribution ─────────────────────────────────────────────────────

  it("marks conflicting epochs as unattributed", () => {
    const bars: Bar6[] = [bar(1000)];
    const trace = fakeTrace([[1000, "stored_5m"], [1000, "stored_1h"]]);
    const result = buildIntradaySourceEvidence(bars, trace, ctx());
    expect(result.source_counts.unattributed).toBe(1);
    expect(result.source_counts.stored_5m).toBe(0);
    expect(result.source_counts.stored_1h).toBe(0);
  });

  it("ignores non-finite epochs", () => {
    const bars: Bar6[] = [bar(1000)];
    const trace = fakeTrace([[NaN, "stored_5m"], [1000, "stored_5m"]]);
    const result = buildIntradaySourceEvidence(bars, trace, ctx());
    expect(result.source_counts.stored_5m).toBe(1);
  });

  it("ignores invalid origin strings", () => {
    const bars: Bar6[] = [bar(1000)];
    const trace = fakeTrace([[1000, "stored_5m"], [1000, "invalid" as BarOrigin]]);
    const result = buildIntradaySourceEvidence(bars, trace, ctx());
    // only the valid stored_5m survives; epoch 1000 still has one valid origin
    expect(result.source_counts.stored_5m).toBe(1);
  });

  // ── Warnings ─────────────────────────────────────────────────────────────────

  it("warns when stored_1h used without extended session", () => {
    const bars: Bar6[] = [bar(1000)];
    const trace = fakeTrace([[1000, "stored_1h"]]);
    const result = buildIntradaySourceEvidence(bars, trace, ctx({ extended: false }));
    expect(result.warnings).toContain("provider_hourly_open_alignment_not_guaranteed");
  });

  it("warns when live_tail is present", () => {
    const bars: Bar6[] = [bar(5000)];
    const trace = fakeTrace([[5000, "live_tail"]]);
    const result = buildIntradaySourceEvidence(bars, trace, ctx());
    expect(result.warnings).toContain("live_tail_construction_not_receipted");
  });

  it("warns when unattributed bars are returned", () => {
    const bars: Bar6[] = [bar(3000)];
    const trace = fakeTrace([[1000, "stored_5m"]]);
    const result = buildIntradaySourceEvidence(bars, trace, ctx());
    expect(result.warnings).toContain("returned_bar_origin_unknown");
  });

  it("warns when cache state is stale_cache", () => {
    const bars: Bar6[] = [bar(1000)];
    const trace = fakeTrace([[1000, "stored_5m"]]);
    const result = buildIntradaySourceEvidence(bars, trace, ctx({ cacheState: "stale_cache" }));
    expect(result.warnings).toContain("stale_cache_after_refresh_failure");
  });

  it("warns when served-before-assembled (negative age)", () => {
    const bars: Bar6[] = [bar(1000)];
    const trace = fakeTrace([[1000, "stored_5m"]]);
    const result = buildIntradaySourceEvidence(
      bars, trace, ctx({ assembledAtMs: 2000, servedAtMs: 1000 }),
    );
    expect(result.warnings).toContain("server_clock_interval_unavailable");
  });

  it("warns when cache age is not finite", () => {
    const bars: Bar6[] = [bar(1000)];
    const trace = fakeTrace([[1000, "stored_5m"]]);
    const result = buildIntradaySourceEvidence(
      bars, trace, ctx({ assembledAtMs: NaN, servedAtMs: 1000 }),
    );
    expect(result.warnings).toContain("server_clock_interval_unavailable");
  });

  // ── Date-sliced result scoping ────────────────────────────────────────────────

  it("first_bar_time / last_bar_time reflect returned bars only", () => {
    const bars: Bar6[] = [bar(3000), bar(4000), bar(5000)];
    const trace = fakeTrace([[3000, "stored_5m"], [4000, "stored_5m"], [5000, "live_tail"]]);
    const result = buildIntradaySourceEvidence(bars, trace, ctx());
    expect(result.response_scope.first_bar_time).toBe(3000);
    expect(result.response_scope.last_bar_time).toBe(5000);
  });

  it("date_sliced list counts only returned epochs", () => {
    const bars: Bar6[] = [bar(1000), bar(2000)];
    const trace = fakeTrace([
      [1000, "stored_5m"], [2000, "stored_5m"], [3000, "live_tail"], [4000, "live_tail"],
    ]);
    const result = buildIntradaySourceEvidence(bars, trace, ctx());
    // only bars 1000 and 2000 are returned; live_tail bars (3000, 4000) are not in bars array
    expect(result.source_counts.stored_5m).toBe(2);
    expect(result.source_counts.live_tail).toBe(0);
  });

  // ── Store reads ─────────────────────────────────────────────────────────────

  it("maps unknown base to null", () => {
    const bars: Bar6[] = [bar(1000)];
    const trace = fakeTrace([[1000, "stored_5m"]], [{ base: "2h", status: "available", content_sha256: null }]);
    const result = buildIntradaySourceEvidence(bars, trace, ctx());
    expect(result.assembly_store_reads[0].base).toBeNull();
  });

  it("maps invalid sha256 to null", () => {
    const bars: Bar6[] = [bar(1000)];
    const trace = fakeTrace([[1000, "stored_5m"]], [{ base: "5m", status: "available", content_sha256: "not-a-hash" }]);
    const result = buildIntradaySourceEvidence(bars, trace, ctx());
    expect(result.assembly_store_reads[0].content_sha256).toBeNull();
  });

  it("accepts valid sha256", () => {
    const bars: Bar6[] = [bar(1000)];
    const validHash = "a".repeat(64);
    const trace = fakeTrace([[1000, "stored_5m"]], [{ base: "5m", status: "available", content_sha256: validHash }]);
    const result = buildIntradaySourceEvidence(bars, trace, ctx());
    expect(result.assembly_store_reads[0].content_sha256).toBe(validHash);
  });

  it("maps unknown status to unreadable", () => {
    const bars: Bar6[] = [bar(1000)];
    const trace = fakeTrace([[1000, "stored_5m"]], [{ base: "5m", status: "bogus", content_sha256: null }]);
    const result = buildIntradaySourceEvidence(bars, trace, ctx());
    expect(result.assembly_store_reads[0].status).toBe("unreadable");
  });

  it("limits store_reads to two entries", () => {
    const bars: Bar6[] = [bar(1000)];
    const trace = fakeTrace(
      [[1000, "stored_5m"]],
      [
        { base: "5m", status: "available", content_sha256: null },
        { base: "1h", status: "available", content_sha256: null },
        { base: "5m", status: "available", content_sha256: null },
      ],
    );
    const result = buildIntradaySourceEvidence(bars, trace, ctx());
    expect(result.assembly_store_reads).toHaveLength(2);
  });

  // ── Assembly clock ──────────────────────────────────────────────────────────

  it("reports cache_age_ms as served - assembled", () => {
    const result = buildIntradaySourceEvidence([], null, ctx({ assembledAtMs: 1000, servedAtMs: 1500 }));
    expect(result.assembly_clock.cache_age_ms).toBe(500);
  });

  it("reports null cache_age_ms when age is negative", () => {
    const result = buildIntradaySourceEvidence([], null, ctx({ assembledAtMs: 1500, servedAtMs: 1000 }));
    expect(result.assembly_clock.cache_age_ms).toBeNull();
  });

  it("does not reset cache_age on cache/stale_cache", () => {
    const base = ctx({ assembledAtMs: 1000, servedAtMs: 1500, cacheState: "new_assembly" as const });
    const cached = ctx({ assembledAtMs: 1000, servedAtMs: 1500, cacheState: "cache" as const });
    const stale = ctx({ assembledAtMs: 1000, servedAtMs: 1500, cacheState: "stale_cache" as const });
    const r1 = buildIntradaySourceEvidence([], null, base);
    const r2 = buildIntradaySourceEvidence([], null, cached);
    const r3 = buildIntradaySourceEvidence([], null, stale);
    expect(r1.assembly_clock.cache_age_ms).toBe(500);
    expect(r2.assembly_clock.cache_age_ms).toBe(500);
    expect(r3.assembly_clock.cache_age_ms).toBe(500);
  });

  it("marks assembled_at / served_at as ISO strings", () => {
    const ms = 1_726_400_000_000;
    const result = buildIntradaySourceEvidence([], null, ctx({ assembledAtMs: ms, servedAtMs: ms }));
    expect(result.assembly_clock.assembled_at).toBe(new Date(ms).toISOString());
    expect(result.assembly_clock.served_at).toBe(new Date(ms).toISOString());
  });

  it("returns null for out-of-range timestamps", () => {
    const result = buildIntradaySourceEvidence([], null, ctx({ assembledAtMs: 9e15, servedAtMs: 9e15 }));
    expect(result.assembly_clock.assembled_at).toBeNull();
  });

  // ── Inputs immutable ────────────────────────────────────────────────────────

  it("does not mutate the input bars array", () => {
    const bars: readonly Bar6[] = Object.freeze([bar(1000), bar(2000)]);
    const trace = fakeTrace([[1000, "stored_5m"], [2000, "stored_5m"]]);
    buildIntradaySourceEvidence(bars, trace, ctx());
    // If mutation occurred this would throw or be visible in counts
    expect(true).toBe(true);
  });

  it("does not mutate the trace object", () => {
    const trace: IntradayAssemblyTrace = { origins: [[1000, "stored_5m"]], storeReads: [] };
    buildIntradaySourceEvidence([bar(1000)], trace, ctx());
    expect(trace.origins).toHaveLength(1);
  });
});
