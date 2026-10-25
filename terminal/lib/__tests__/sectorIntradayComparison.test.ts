import { describe, expect, it } from "vitest";
import { feedSourceStamp } from "../sectorIntelligence";
import {
  INTRADAY_OWNER_STATUSES, readDayChangePct, readIntradayComparison, readIntradaySourceStamp, sectorIntradayEnvelope, sectorIntradayRead,
} from "../sectorIntradayComparison";
import {
  ELAPSED_MINUTES, EVALUATED_ASOF, FRESH_NOW, REFERENCE_ASOF, SESSION_DATE, SOURCE_ASOF,
  basket, basketPulse, mixedPulse, observedComparison, qualifiedBasketComparison,
  retainedClosingComparison, unavailableComparison,
} from "./sectorIntradayFixture";

const only = (payload: unknown, nowMs = FRESH_NOW) => {
  const row = sectorIntradayRead(payload, nowMs)!.rows[0];
  if (!row || !("ownerStatus" in row)) throw new Error("Expected a validated owner row");
  return row;
};

function expectConsumerUnavailable(rows: NonNullable<ReturnType<typeof sectorIntradayRead>>["rows"],
  outcome: "invalid" | "absent" = "invalid") {
  expect(rows).toHaveLength(1);
  expect(rows[0]).toEqual({ basketId: rows[0].basketId, outcome,
    reason: outcome === "absent" ? "absent" : "unverified", dayChangePct: null });
  // Exact shape excludes all owner status, clocks, coverage and financial metrics.
}

describe("intraday comparison — an observed new interval renders the owner's own values", () => {
  it("carries the interval, SPY-relative change, breadth and coverage exactly as the owner emitted them", () => {
    const row = only(basketPulse([basket("ai_infra", observedComparison())]));
    expect(row.outcome).toBe("observed");
    if (row.outcome !== "observed") throw new Error("expected an observed row");
    expect(row).toMatchObject({ basketId: "ai_infra", absoluteChangePct: 2, benchmarkChangePct: 0.5,
      relativeChangePct: 1.492537, positiveRelativeBreadthPct: 62.5,
      deliveryState: "new", isNewObservation: true, observationKind: "regular", dayChangePct: -1.25 });
    expect(row.coverage).toMatchObject({ matchedMembers: 8, totalMembers: 10, coveragePct: 80,
      excluded: [{ reason: "missing_observation", count: 2 }] });
  });

  it("keeps both clock endpoints at full precision rather than collapsing them to a date", () => {
    const row = only(basketPulse([basket("ai_infra", observedComparison())]));
    expect(row.clock).toMatchObject({ referenceAsOf: REFERENCE_ASOF, sourceAsOf: SOURCE_ASOF,
      sessionDate: SESSION_DATE, elapsedMinutes: ELAPSED_MINUTES, elapsedSeconds: 3600 });
  });

  it("reads the settled closing shape with its own settlement tolerance", () => {
    const row = only(basketPulse([basket("mag7", observedComparison({ observation_kind: "settled_regular", settlement_tolerance_seconds: 90 }))]));
    expect(row.outcome).toBe("observed");
    expect(row.observationKind).toBe("settled_regular");
    expect(row.settlementToleranceSeconds).toBe(90);
  });
});

describe("intraday comparison — millisecond source clocks preserve the producer's skew bound", () => {
  // Literal outputs of Macro bc193e674b07d91acbfa319f5b7943d9996f81cc,
  // build_basket_pulse.py:813-820. Reordering its two divisions changes a bound by one ULP.
  const cases = [
    { source: "2026-10-22T19:01:00.001000+00:00", elapsedMinutes: 1.0000166666666668, skew: 6.000100000000001 },
    { source: "2026-10-22T19:05:00.789000+00:00", elapsedMinutes: 5.01315, skew: 30.0789 },
    { source: "2026-10-22T19:09:59.999000+00:00", elapsedMinutes: 9.999983333333333, skew: 59.999900000000004 },
    { source: "2026-10-22T19:10:00+00:00", elapsedMinutes: 10, skew: 60 },
    { source: "2026-10-22T19:10:00.001000+00:00", elapsedMinutes: 10.000016666666667, skew: 60 },
  ];
  const comparison = (sample: typeof cases[number], patch: Record<string, unknown> = {}) =>
    observedComparison({
      reference_asof: "2026-10-22T19:00:00+00:00", source_asof: sample.source,
      elapsed_minutes: sample.elapsedMinutes, max_clock_skew_seconds: sample.skew, ...patch,
    });

  it.each(cases)("admits the exact producer bound at $source", sample => {
    expect(readIntradayComparison("ai_infra", comparison(sample), Date.parse(sample.source) + 60_000))
      .toMatchObject({ outcome: "observed", clock: { sourceAsOf: sample.source, maxClockSkewSeconds: sample.skew } });
  });

  it("keeps every basket in an arbitrary-millisecond build instead of invalidating the panel", () => {
    const sample = cases[1];
    const payload = basketPulse(["ai_infra", "mag7", "clean_energy"].map(id => basket(id, comparison(sample))), {
      as_of_quotes: sample.source, as_of_utc: "2026-10-22T19:06:00+00:00", built: "2026-10-22 19:06:00 UTC",
    });
    const read = sectorIntradayRead(payload, Date.parse("2026-10-22T19:06:00Z"))!;
    expect(read.rows.map(row => [row.basketId, row.outcome]))
      .toEqual([["ai_infra", "observed"], ["mag7", "observed"], ["clean_energy", "observed"]]);
  });

  it("retains zero-matched coverage, exclusions and clocks at the producer's millisecond bound", () => {
    const sample = cases[0];
    const row = readIntradayComparison("ai_infra", qualifiedBasketComparison("insufficient_matched_coverage", {
      reference_asof: "2026-10-22T19:00:00+00:00", source_asof: sample.source,
      elapsed_minutes: sample.elapsedMinutes, max_clock_skew_seconds: sample.skew,
      matched_members: 0, total_members: 10, coverage_pct: 0,
      excluded: { missing_observation: 7, nonadvancing_source: 3 },
    }), Date.parse(sample.source) + 60_000);
    expect(row).toMatchObject({
      outcome: "unqualified", ownerStatus: "insufficient_matched_coverage",
      clock: { sourceAsOf: sample.source, maxClockSkewSeconds: sample.skew },
      coverage: { matchedMembers: 0, totalMembers: 10, coveragePct: 0,
        excluded: [{ reason: "missing_observation", count: 7 }, { reason: "nonadvancing_source", count: 3 }] },
    });
    expect(row).not.toHaveProperty("relativeChangePct");
  });

  it.each([
    { sample: cases[0], skew: 6.000100000000002 },
    { sample: cases[1], skew: 30.078900000000004 },
    { sample: cases[4], skew: 60.00000000000001 },
  ])("rejects the next representable value above the bound: $skew", ({ sample, skew }) => {
    expect(readIntradayComparison("ai_infra", comparison(sample, { max_clock_skew_seconds: skew }),
      Date.parse(sample.source) + 60_000)).toBeNull();
  });
});

describe("intraday comparison — a retained closing observation is never a new event", () => {
  it("keeps the redelivered measurement and marks it retained, not new", () => {
    const row = only(basketPulse([basket("mag7", retainedClosingComparison())]));
    expect(row.outcome).toBe("observed");
    if (row.outcome !== "observed") throw new Error("expected an observed row");
    expect(row).toMatchObject({ deliveryState: "retained", isNewObservation: false,
      absoluteChangePct: 2, relativeChangePct: 1.492537 });
    expect(row.clock?.sourceAsOf).toBe(SOURCE_ASOF);
  });

  it("rejects a delivery whose novelty disagrees with its redelivery state", () => {
    for (const patch of [{ delivery_state: "new", is_new_observation: false },
      { delivery_state: "retained", is_new_observation: true }]) {
      const read = sectorIntradayRead(basketPulse([basket("mag7", retainedClosingComparison(patch))]), FRESH_NOW);
      expectConsumerUnavailable(read!.rows);
      expect(read!.presentCount).toBe(1);
    }
  });

  it("rejects a redelivery state the owner does not emit", () => {
    const read = sectorIntradayRead(basketPulse([basket("mag7", retainedClosingComparison({ delivery_state: "refreshed" }))]), FRESH_NOW);
    expectConsumerUnavailable(read!.rows);
  });
});

describe("intraday comparison — corrections, non-advancing clocks and missing coverage stay qualified", () => {
  it.each(["baseline_corrected", "baseline_nonadvancing", "benchmark_nonadvancing", "membership_changed",
    "session_boundary", "benchmark_basis_changed", "unsupported_session", "outside_regular_session",
    "benchmark_unavailable", "insufficient_matched_coverage", "invalid_return", "baseline_missing",
    "baseline_invalid", "invalid_evaluation_clock", "benchmark_invalid_return"] as const)
  ("renders the owner's %s token as a qualified row carrying no number at all", status => {
    const row = only(basketPulse([basket("ai_infra", unavailableComparison(status))]));
    expect(row.outcome).toBe("unqualified");
    expect(row.ownerStatus).toBe(status);
    // A qualified row carries no change figure at all — not a zero, not a blank.
    expect(Object.keys(row)).not.toContain("absoluteChangePct");
    expect(Object.keys(row)).not.toContain("relativeChangePct");
    expect(Object.keys(row)).not.toContain("positiveRelativeBreadthPct");
  });

  it("maps each owner status to its accepted presentation class", () => {
    expect(only(basketPulse([basket("b", unavailableComparison("baseline_missing"))])))
      .toMatchObject({ outcome: "unqualified", reason: "awaiting" });
    expect(only(basketPulse([basket("b", unavailableComparison("baseline_corrected"))])))
      .toMatchObject({ outcome: "unqualified", reason: "reset" });
    expect(only(basketPulse([basket("b", unavailableComparison("outside_regular_session"))])))
      .toMatchObject({ outcome: "unqualified", reason: "no_session" });
    expect(only(basketPulse([basket("b", unavailableComparison("benchmark_unavailable"))])))
      .toMatchObject({ outcome: "unqualified", reason: "unavailable" });
    expect(only(basketPulse([basket("b", unavailableComparison("benchmark_invalid_return"))])))
      .toMatchObject({ outcome: "unqualified", reason: "unavailable" });
  });

  it("keeps a per-basket qualified row's clocks and coverage instead of dropping them", () => {
    const row = only(basketPulse([basket("clean_energy", qualifiedBasketComparison("insufficient_matched_coverage"))]));
    expect(row.outcome).toBe("unqualified");
    expect(row.clock?.sourceAsOf).toBe(SOURCE_ASOF);
    expect(row.coverage).toMatchObject({ matchedMembers: 2, totalMembers: 10, coveragePct: 20 });
  });

  it("withdraws only the currency of an observation whose endpoint is stale or ahead of this device", () => {
    const stale = only(basketPulse([basket("ai_infra", observedComparison())]), FRESH_NOW + 46 * 60_000);
    expect(stale).toMatchObject({ outcome: "unverified", reason: "stale", ownerStatus: "observed" });
    expect(Object.keys(stale)).not.toContain("relativeChangePct");
    // The clocks stay readable so a reader can still judge how old the observation is.
    expect(stale.clock?.sourceAsOf).toBe(SOURCE_ASOF);

    const ahead = sectorIntradayRead(basketPulse([basket("ai_infra", observedComparison())]), FRESH_NOW - 6 * 60_000)!.rows[0];
    expect(ahead).toMatchObject({ outcome: "unverified", reason: "clock_disagreement" });
  });

  it("never turns an unknown owner status into a reason we would have had to invent", () => {
    const read = sectorIntradayRead(basketPulse([basket("ai_infra", unavailableComparison("something_new"))]), FRESH_NOW);
    expectConsumerUnavailable(read!.rows);
    expect(read!.presentCount).toBe(1);
  });
});

describe("intraday comparison — the consumer computes no comparative metric of its own", () => {
  it("reads one named basket directly and keeps its cohort identity on the row", () => {
    const row = readIntradayComparison("ai_infra", observedComparison(), FRESH_NOW);
    expect(row).toMatchObject({ basketId: "ai_infra", outcome: "observed", relativeChangePct: 1.492537 });
  });
  it("fails closed on a relative change that disagrees with the owner's absolute and benchmark", () => {
    const read = sectorIntradayRead(basketPulse([basket("ai_infra", observedComparison({ relative_change_pct: 1.6 }))]), FRESH_NOW);
    expectConsumerUnavailable(read!.rows);
  });

  it("rejects an interval length that disagrees with the two source clocks", () => {
    expectConsumerUnavailable(sectorIntradayRead(basketPulse([basket("b", observedComparison({ elapsed_minutes: 15 }))]), FRESH_NOW)!.rows);
  });

  it("rejects an endpoint that does not advance past its reference", () => {
    expectConsumerUnavailable(sectorIntradayRead(basketPulse([basket("b", observedComparison({ source_asof: REFERENCE_ASOF }))]), FRESH_NOW)!.rows);
  });

  it("rejects a clock skew larger than the disclosed sampling tolerance", () => {
    expectConsumerUnavailable(sectorIntradayRead(basketPulse([basket("b", observedComparison({ max_clock_skew_seconds: 61 }))]), FRESH_NOW)!.rows);
    // The owner derives the bound from the interval; a much shorter interval admits less skew.
    expectConsumerUnavailable(sectorIntradayRead(basketPulse([basket("b", observedComparison({
      source_asof: "2026-10-22T18:01:00.000Z", elapsed_minutes: 1, max_clock_skew_seconds: 60,
    }))]), FRESH_NOW)!.rows);
  });

  it("rejects a session date that is not the observed endpoint's New York date", () => {
    expectConsumerUnavailable(sectorIntradayRead(basketPulse([basket("b", observedComparison({ session_date: "2026-10-21" }))]), FRESH_NOW)!.rows);
  });

  it("rejects coverage that does not agree with its own matched and total counts", () => {
    expectConsumerUnavailable(sectorIntradayRead(basketPulse([basket("b", observedComparison({ coverage_pct: 92 }))]), FRESH_NOW)!.rows);
  });

  it("rejects an observation whose matched coverage is below the owner's own floor", () => {
    const read = sectorIntradayRead(basketPulse([basket("b", observedComparison({
      matched_members: 2, total_members: 10, coverage_pct: 20, excluded: { missing_observation: 8 } }))]), FRESH_NOW);
    expectConsumerUnavailable(read!.rows);
  });

  it("rejects exclusions that do not account for every unmatched member", () => {
    expectConsumerUnavailable(sectorIntradayRead(basketPulse([basket("b", observedComparison({ excluded: { missing_observation: 1 } }))]), FRESH_NOW)!.rows);
  });
});

describe("intraday comparison — malformed and unsupported input fails closed, in place", () => {
  it.each([
    ["a non-object row", "not-a-row"], ["a null row", null], ["an array row", []],
    ["a look-alike schema", observedComparison({ schema: "basket_intraday_comparison.v2" })],
    ["a different benchmark", observedComparison({ benchmark: "QQQ" })],
    ["a different method", observedComparison({ method: "equal_weight_all_members" })],
    ["an unknown observation kind", observedComparison({ observation_kind: "pre_market" })],
    ["a settled row with the wrong tolerance", observedComparison({ observation_kind: "settled_regular", settlement_tolerance_seconds: 30 })],
    ["a non-finite change", observedComparison({ absolute_change_pct: "2" })],
    ["a change beyond any plausible bound", observedComparison({ relative_change_pct: 400 })],
    ["breadth outside 0-100", observedComparison({ positive_relative_breadth_pct: 140 })],
    ["a non-integer member count", observedComparison({ matched_members: 8.5 })],
    ["an unclamped timestamp", observedComparison({ source_asof: "2026-10-22 19:00:00" })],
  ])("rejects %s", (_label, value) => {
    expectConsumerUnavailable(sectorIntradayRead(basketPulse([basket("b", value)]), FRESH_NOW)!.rows,
      value === null ? "absent" : "invalid");
  });

  it("retains an invalid basket in place while preserving valid neighbors", () => {
    const read = sectorIntradayRead(basketPulse([
      basket("ai_infra", observedComparison()),
      basket("broken", { schema: "wrong" }),
      basket("mag7", observedComparison()),
    ]), FRESH_NOW);
    expect(read!.rows.map(row => row.basketId)).toEqual(["ai_infra", "broken", "mag7"]);
    expect(read!.rows[1]).toEqual({ basketId: "broken", outcome: "invalid", reason: "unverified", dayChangePct: null });
    expect(read!.presentCount).toBe(3);
  });

  it("rejects the whole envelope only when the envelope itself is not the admitted contract", () => {
    expect(sectorIntradayEnvelope({ ...basketPulse([]), schema: "basket_pulse.v2" })).toBe(false);
    expect(sectorIntradayEnvelope({ ...basketPulse([]), market: "hk" })).toBe(false);
    expect(sectorIntradayEnvelope({ ...basketPulse([]), baskets: "none" })).toBe(false);
    expect(sectorIntradayEnvelope(basketPulse([basket("a", observedComparison())]))).toBe(true);
    expect(sectorIntradayRead({ ...basketPulse([]), market: "hk" }, FRESH_NOW)).toBeNull();
  });

  it("treats a build with no comparisons as an absent capability, not a failure", () => {
    const read = sectorIntradayRead(basketPulse([basket("ai_infra", undefined), basket("mag7", null)]), FRESH_NOW);
    expect(read).not.toBeNull();
    expect(read).toMatchObject({ presentCount: 0, totalBaskets: 2 });
    expect(read!.rows).toEqual([
      { basketId: "ai_infra", outcome: "absent", reason: "absent", dayChangePct: null },
      { basketId: "mag7", outcome: "absent", reason: "absent", dayChangePct: null },
    ]);
  });
});

describe("intraday comparison — the envelope's own clocks and cohorts survive", () => {
  it("reports the owner build stamps without substituting the transport receipt", () => {
    const read = sectorIntradayRead(mixedPulse(), FRESH_NOW);
    expect(read).toMatchObject({ market: "us", session: "rth", built: "2026-10-22 19:04:00 UTC", asOfUtc: EVALUATED_ASOF, quoteSourceAsOf: SOURCE_ASOF });
    expect(read!.presentCount).toBe(4);
    expect(read!.totalBaskets).toBe(4);
    expect(read!.rows.map(row => row.basketId).sort()).toEqual(["ai_infra", "ai_software", "clean_energy", "mag7"]);
  });

  it("ignores duplicate and malformed basket ids without shrinking the rest", () => {
    const read = sectorIntradayRead(basketPulse([basket("ai_infra", observedComparison()),
      basket("ai_infra", observedComparison()), basket("BAD ID", observedComparison())]), FRESH_NOW);
    expect(read!.rows.map(row => row.basketId)).toEqual(["ai_infra"]);
    expect(read!.totalBaskets).toBe(1);
  });

  it("covers every owner status token this consumer understands", () => {
    expect(INTRADAY_OWNER_STATUSES).toHaveLength(16);
    expect(INTRADAY_OWNER_STATUSES).toContain("observed");
    expect(INTRADAY_OWNER_STATUSES).toContain("session_boundary");
  });
});

describe("intraday comparison — the day change stays on its own clock", () => {
  it("reads the owner's whole-day change only when that field is usable", () => {
    expect(readDayChangePct({ live_ew_chg_pct: -1.25 })).toBe(-1.25);
    expect(readDayChangePct({ live_ew_chg_pct: 0 })).toBe(0);
    expect(readDayChangePct({ live_ew_chg_pct: null })).toBeNull();
    expect(readDayChangePct({ live_ew_chg_pct: "1.25" })).toBeNull();
    expect(readDayChangePct({ live_ew_chg_pct: 900 })).toBeNull();
    expect(readDayChangePct({})).toBeNull();
  });

  it("keeps an unusable day change out of the panel while the interval still reads", () => {
    const row = only(basketPulse([basket("ai_infra", observedComparison(), { live_ew_chg_pct: null })]));
    expect(row.outcome).toBe("observed");
    expect(row.dayChangePct).toBeNull();
  });
});

describe("repair contract — every basket and its clocks", () => {
  it("retains a legitimate zero-matched owner outcome without a financial return", () => {
    const read = sectorIntradayRead(basketPulse([basket("empty_match",
      qualifiedBasketComparison("insufficient_matched_coverage", {
        matched_members: 0, total_members: 10, coverage_pct: 0, excluded: { missing_observation: 10 },
      }))]), FRESH_NOW)!;
    expect(read.rows).toHaveLength(1);
    expect(read.rows[0]).toMatchObject({ basketId: "empty_match", outcome: "unqualified",
      ownerStatus: "insufficient_matched_coverage", coverage: { matchedMembers: 0, totalMembers: 10, coveragePct: 0 } });
    expect(read.rows[0]).not.toHaveProperty("absoluteChangePct");
  });

  it("retains missing and malformed neighbors without fabricating owner status", () => {
    const read = sectorIntradayRead(basketPulse([
      basket("valid", observedComparison()), basket("missing", undefined),
      basket("null_row", null), basket("broken", { schema: "wrong" }),
    ]), FRESH_NOW)!;
    expect(read.rows.map(row => row.basketId)).toEqual(["valid", "missing", "null_row", "broken"]);
    expect(read.rows.slice(1).map(row => row.outcome)).toEqual(["absent", "absent", "invalid"]);
    for (const row of read.rows.slice(1)) {
      expect(row).not.toHaveProperty("ownerStatus");
      expect(row).not.toHaveProperty("absoluteChangePct");
      expect(row.dayChangePct).toBeNull();
    }
  });
});

describe("quote, evaluation and retained observation clocks", () => {
  it("keeps quote-source precision and never borrows evaluation time", () => {
    const source = "2026-10-22T19:00:00.123456Z";
    expect(readIntradaySourceStamp({ source_asof: source, as_of_quotes: SOURCE_ASOF, as_of_utc: EVALUATED_ASOF })).toBe(source);
    expect(readIntradaySourceStamp({ as_of_quotes: source, as_of_utc: EVALUATED_ASOF })).toBe(source);
    expect(feedSourceStamp("intraday", { as_of_quotes: source, as_of_utc: EVALUATED_ASOF })).toBe(source);
    expect(feedSourceStamp("intraday", { as_of_utc: EVALUATED_ASOF })).toBeNull();
    for (const value of [undefined, "2026-10-22", "2026-10-22 19:00:00", "not-a-clock"]) {
      expect(readIntradaySourceStamp({ as_of_quotes: value, as_of_utc: EVALUATED_ASOF })).toBeNull();
    }
  });

  it("preserves a date-only quote as a bar date without inventing a quote instant", () => {
    expect(sectorIntradayRead(basketPulse([], { as_of_quotes: SESSION_DATE }), FRESH_NOW))
      .toMatchObject({ quoteSourceAsOf: null, quoteBarDate: SESSION_DATE, asOfUtc: EVALUATED_ASOF });
  });

  it("preserves verified delivery evidence when an observed close becomes stale", () => {
    const row = only(basketPulse([basket("retained", retainedClosingComparison())]), FRESH_NOW + 41 * 60_000);
    expect(row).toMatchObject({ outcome: "unverified", reason: "stale", ownerStatus: "observed",
      deliveryState: "retained", isNewObservation: false, clock: { sourceAsOf: SOURCE_ASOF },
      coverage: { matchedMembers: 8, totalMembers: 10 } });
    expect(row).not.toHaveProperty("absoluteChangePct");
  });

  it("still refuses zero coverage as an observed financial return and refuses 0/0 coverage", () => {
    expect(readIntradayComparison("b", observedComparison({ matched_members: 0,
      coverage_pct: 0, excluded: { missing_observation: 10 } }), FRESH_NOW)).toBeNull();
    expect(readIntradayComparison("b", qualifiedBasketComparison("insufficient_matched_coverage", {
      matched_members: 0, total_members: 0, coverage_pct: 0, excluded: {},
    }), FRESH_NOW)).toBeNull();
  });
});
