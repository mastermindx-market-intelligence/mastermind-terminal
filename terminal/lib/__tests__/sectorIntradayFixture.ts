/** Deterministic `basket_pulse.v1` fixtures built to the exact producer contract at
 * Macro `bc193e674b07d91acbfa319f5b7943d9996f81cc` (`scripts/build_basket_pulse.py`,
 * `_intraday_comparisons`), with the accepted presentation's admission rules applied.
 *
 * These are synthetic transport fixtures. They prove this consumer's decoding and presentation
 * contract; they are not production market evidence and never stand in for it.
 */

/** The session under test. 19:00Z is 15:00 America/New_York on 2026-10-22 (EDT), so the ET session
 * date of both benchmark endpoints really is 2026-10-22. */
export const SESSION_DATE = "2026-10-22";
export const REFERENCE_ASOF = "2026-10-22T18:00:00.000Z";
export const SOURCE_ASOF = "2026-10-22T19:00:00.000Z";
/** Build evaluation is later than the quote instant and earlier than transport receipt. */
export const EVALUATED_ASOF = "2026-10-22T19:04:00.123456Z";
export const ELAPSED_SECONDS = 3600;
export const ELAPSED_MINUTES = 60;
/** A device clock five minutes after the observed endpoint — inside the 45-minute currency bound. */
export const FRESH_NOW = Date.parse("2026-10-22T19:05:00.000Z");

type Json = Record<string, unknown>;

/** A complete, internally coherent `observed` comparison: 8 of 10 members matched, two excluded
 * for a missing observation. `absolute` 2.00% against a 0.50% benchmark is exactly the relative
 * change below, so the coherence gate has something real to check. */
export function observedComparison(patch: Json = {}): Json {
  return {
    schema: "basket_intraday_comparison.v1",
    benchmark: "SPY",
    method: "matched_member_equal_weight",
    observation_kind: "regular",
    settlement_tolerance_seconds: 0,
    status: "observed",
    max_clock_skew_seconds: 60,
    reference_asof: REFERENCE_ASOF,
    source_asof: SOURCE_ASOF,
    elapsed_minutes: ELAPSED_MINUTES,
    session_date: SESSION_DATE,
    matched_members: 8,
    total_members: 10,
    coverage_pct: 80,
    excluded: { missing_observation: 2 },
    delivery_state: "new",
    is_new_observation: true,
    absolute_change_pct: 2,
    benchmark_change_pct: 0.5,
    relative_change_pct: 1.492537,
    positive_relative_breadth_pct: 62.5,
    ...patch,
  };
}

/** The same settled-closing shape the producer emits at settlement, redelivered rather than
 * re-measured: identical endpoint and identical values, explicitly marked retained. */
export function retainedClosingComparison(patch: Json = {}): Json {
  return observedComparison({
    observation_kind: "settled_regular",
    settlement_tolerance_seconds: 90,
    delivery_state: "retained",
    is_new_observation: false,
    ...patch,
  });
}

/** One of the producer's `unavailable(reason)` rows: schema/benchmark/method/kind/tolerance and the
 * status token, and deliberately NO clock and NO coverage — an unknown interval, not a zero one. */
export function unavailableComparison(status: string, patch: Json = {}): Json {
  return {
    schema: "basket_intraday_comparison.v1",
    benchmark: "SPY",
    method: "matched_member_equal_weight",
    observation_kind: "regular",
    settlement_tolerance_seconds: 0,
    status,
    ...patch,
  };
}

/** A per-basket qualified row: it does carry both clocks and coverage, but no change figures. */
export function qualifiedBasketComparison(status: string, patch: Json = {}): Json {
  return unavailableComparison(status, {
    max_clock_skew_seconds: 60,
    reference_asof: REFERENCE_ASOF,
    source_asof: SOURCE_ASOF,
    elapsed_minutes: ELAPSED_MINUTES,
    session_date: SESSION_DATE,
    matched_members: 2,
    total_members: 10,
    coverage_pct: 20,
    excluded: { missing_observation: 8 },
    ...patch,
  });
}

export const basket = (id: string, comparison: unknown, patch: Json = {}): Json => ({
  id, n_members: 10, n_quoted: 10, live_ew_chg_pct: -1.25, ...patch,
  ...(comparison === undefined ? {} : { intraday_comparison: comparison }),
});

export function basketPulse(baskets: Json[], patch: Json = {}): Json {
  return {
    schema: "basket_pulse.v1",
    market: "us",
    session: "rth",
    mode: "last_rth",
    built: "2026-10-22 19:04:00 UTC",
    as_of_utc: EVALUATED_ASOF,
    as_of_quotes: SOURCE_ASOF,
    coverage_pct: 99.7,
    n_quotes_total: 2109,
    baskets,
    ...patch,
  };
}

/** A ready payload carrying one new observation, one retained closing observation and two
 * qualified rows, so one fixture exercises observation, redelivery and qualification together. */
export function mixedPulse(): Json {
  return basketPulse([
    basket("ai_infra", observedComparison()),
    basket("mag7", retainedClosingComparison(), { live_ew_chg_pct: 3.5 }),
    basket("ai_software", unavailableComparison("baseline_missing")),
    basket("clean_energy", qualifiedBasketComparison("insufficient_matched_coverage")),
  ]);
}
