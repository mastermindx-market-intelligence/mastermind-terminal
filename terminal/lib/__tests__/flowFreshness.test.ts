import { describe, expect, it } from "vitest";
import flowFixture from "@/public/data/flow_fixture.json";
import enrichFixture from "@/public/data/enrich_fixture.json";
import chainHeatFixture from "@/public/data/chain_heat_fixture.json";
import {
  LIVE_FLOW_META_V2,
  artifactSourceAgeMs,
  artifactSourceAsof,
  deriveLiveFlowFreshness,
  formatFlowAge,
  formatObservedCycle,
  parseLiveFlowMetaTiming,
  usOptionsSessionState,
} from "@/lib/flowFreshness";

const META_V2 = {
  schema: LIVE_FLOW_META_V2,
  asof: "2026-08-10T20:26:00Z",
  poll_floor_sec: 120,
  cycle_started_at: "2026-08-10T19:18:00Z",
  observed_start_to_start_sec: 4073.6,
  source_response_at_first: "2026-08-10T19:19:00Z",
  source_response_at_last: "2026-08-10T20:24:00Z",
};

describe("live_flow.meta/v2 timing parser", () => {
  it("accepts measured clocks and keeps the observed cycle separate from the poll floor", () => {
    expect(parseLiveFlowMetaTiming(META_V2)).toEqual({
      schema: LIVE_FLOW_META_V2,
      snapshotAt: "2026-08-10T20:26:00Z",
      cycleStartedAt: "2026-08-10T19:18:00Z",
      sourceResponseAtFirst: "2026-08-10T19:19:00Z",
      sourceResponseAtLast: "2026-08-10T20:24:00Z",
      observedCycleSec: 4073.6,
    });
  });

  it("fails v1 closed instead of treating target/measured aliases as cadence", () => {
    expect(parseLiveFlowMetaTiming({
      schema: "live_flow.meta/v1",
      asof: META_V2.asof,
      cadence_sec_target: 120,
      cadence_sec_measured: 4073.6,
      cycle_sec: 4073.6,
    })).toBeNull();
  });

  it("accepts only Macro's canonical observed start-to-start field", () => {
    const noncanonical = { ...META_V2 } as Record<string, unknown>;
    delete noncanonical.observed_start_to_start_sec;
    noncanonical.cycle_start_interval_sec_observed = 4073.6;
    expect(parseLiveFlowMetaTiming(noncanonical)).toBeNull();
  });

  it.each([
    "asof",
    "cycle_started_at",
    "source_response_at_first",
    "source_response_at_last",
    "observed_start_to_start_sec",
  ])("fails a partial v2 with missing %s", (key) => {
    const partial = { ...META_V2 } as Record<string, unknown>;
    delete partial[key];
    expect(parseLiveFlowMetaTiming(partial)).toBeNull();
  });

  it("accepts an explicit null observed interval on the first cycle", () => {
    expect(parseLiveFlowMetaTiming({
      ...META_V2,
      observed_start_to_start_sec: null,
    })?.observedCycleSec).toBeNull();
  });

  it("rejects reversed receipts and synthetic zero intervals", () => {
    expect(parseLiveFlowMetaTiming({
      ...META_V2,
      source_response_at_first: "2026-08-10T20:25:00Z",
      source_response_at_last: "2026-08-10T20:24:00Z",
    })).toBeNull();
    expect(parseLiveFlowMetaTiming({
      ...META_V2,
      observed_start_to_start_sec: 0,
    })).toBeNull();
  });
});

describe("render-time freshness", () => {
  const nowMs = Date.parse("2026-08-10T20:36:00Z");

  it("reports snapshot age plus the youngest-to-oldest source-response range", () => {
    const freshness = deriveLiveFlowFreshness(META_V2, nowMs);
    expect(freshness).not.toBeNull();
    expect(freshness?.snapshotAgeMs).toBe(10 * 60_000);
    expect(freshness?.sourceResponseAgeMinMs).toBe(12 * 60_000);
    expect(freshness?.sourceResponseAgeMaxMs).toBe(77 * 60_000);
    expect(formatObservedCycle(freshness?.timing.observedCycleSec ?? null)).toBe("1h 8m");
  });

  it("rejects future clocks rather than clamping them to a fresh-looking zero", () => {
    expect(deriveLiveFlowFreshness(META_V2, Date.parse("2026-08-10T20:25:00Z"))).toBeNull();
  });

  it("formats compact ages without asserting a fixed cadence", () => {
    expect(formatFlowAge(42_000)).toBe("<1m");
    expect(formatFlowAge(12 * 60_000)).toBe("12m");
    expect(formatFlowAge(68 * 60_000)).toBe("1h 8m");
    expect(formatFlowAge(27 * 3_600_000)).toBe("1d 3h");
    expect(formatFlowAge(-1)).toBeNull();
  });
});

describe("derived-artifact source clocks", () => {
  it("uses source_asof and never falls back to a newer asof or built_at", () => {
    const derived = {
      source_asof: "2026-08-10T18:00:00Z",
      asof: "2026-08-10T20:55:00Z",
      built_at: "2026-08-10T21:00:00Z",
    };
    expect(artifactSourceAsof(derived)).toBe("2026-08-10T18:00:00Z");
    expect(artifactSourceAgeMs(derived, Date.parse("2026-08-10T21:00:00Z"))).toBe(3 * 3_600_000);
    expect(artifactSourceAsof({ asof: derived.asof, built_at: derived.built_at })).toBeNull();
  });

  it("pins fixture enrich and chain heat to explicit source receipts", () => {
    expect(artifactSourceAsof(enrichFixture)).toBe(enrichFixture.source_asof);
    expect(artifactSourceAsof(chainHeatFixture)).toBe(chainHeatFixture.source_asof);
  });
});

describe("US options session posture", () => {
  it("calls pre-open and after-hours last session, never stalled current data", () => {
    expect(usOptionsSessionState("2026-08-11", new Date("2026-08-11T13:29:00Z"))).toBe("last_session");
    expect(usOptionsSessionState("2026-08-11", new Date("2026-08-11T20:00:00Z"))).toBe("last_session");
  });

  it("accepts only the matching session date during the ET regular window", () => {
    expect(usOptionsSessionState("2026-08-11", new Date("2026-08-11T13:30:00Z"))).toBe("regular");
    expect(usOptionsSessionState("2026-08-11", new Date("2026-08-11T19:59:00Z"))).toBe("regular");
    // A holiday/closure keeps the prior session_date even when the wall clock is
    // inside the usual window, so it remains a last-session read.
    expect(usOptionsSessionState("2026-08-10", new Date("2026-08-11T14:00:00Z"))).toBe("last_session");
  });

  it("keeps weekends and malformed dates on the conservative last-session path", () => {
    expect(usOptionsSessionState("2026-08-15", new Date("2026-08-15T14:00:00Z"))).toBe("last_session");
    expect(usOptionsSessionState(undefined, new Date("2026-08-11T14:00:00Z"))).toBe("last_session");
  });

  it("ends the regular session at the NYSE early close and on full closures", () => {
    // 2026-11-27 and 2026-12-24 close at 13:00 ET; 2026-11-26 is Thanksgiving.
    expect(usOptionsSessionState("2026-11-27", new Date("2026-11-27T17:59:00Z"))).toBe("regular");
    expect(usOptionsSessionState("2026-11-27", new Date("2026-11-27T18:00:00Z"))).toBe("last_session");
    expect(usOptionsSessionState("2026-12-24", new Date("2026-12-24T19:30:00Z"))).toBe("last_session");
    expect(usOptionsSessionState("2026-11-26", new Date("2026-11-26T16:00:00Z"))).toBe("last_session");
  });

  it("keeps the local open across the DST change", () => {
    expect(usOptionsSessionState("2026-11-02", new Date("2026-11-02T14:29:00Z"))).toBe("last_session");
    expect(usOptionsSessionState("2026-11-02", new Date("2026-11-02T14:30:00Z"))).toBe("regular");
  });

  it("fails closed outside the session projection", () => {
    expect(usOptionsSessionState("2029-01-03", new Date("2029-01-03T16:00:00Z"))).toBe("last_session");
  });
});

describe("fixture contract", () => {
  it("exercises v2 measured timing without the misleading v1 cadence aliases", () => {
    expect(parseLiveFlowMetaTiming(flowFixture.meta)).not.toBeNull();
    expect(flowFixture.meta.schema).toBe(LIVE_FLOW_META_V2);
    expect(JSON.stringify(flowFixture.meta)).not.toContain("cadence_sec_target");
    expect(JSON.stringify(flowFixture.meta)).not.toContain("cadence_sec_measured");
  });
});
