/** Browser-only synthetic `basket_pulse.v1` for the intraday comparison journey.
 * NEVER imported by production code, and not market evidence of any kind.
 *
 * The two benchmark source clocks are generated relative to the run so the recency gate is
 * deterministic wherever the suite executes, while the metric values are the same fixed ones the
 * unit fixtures use. Everything else is built to Macro's exact producer contract at
 * `bc193e674b07d91acbfa319f5b7943d9996f81cc`. */
type Json = Record<string, unknown>;

const MINUTE = 60_000;
/** The ET date of an instant. The owner states this as `session_date`; the consumer checks it
 * against the observed endpoint rather than trusting it. */
const sessionDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});

function comparison(now: number, patch: Json = {}): Json {
  const sourceMs = now - MINUTE, referenceMs = sourceMs - 60 * MINUTE;
  const reference = new Date(referenceMs).toISOString(), source = new Date(sourceMs).toISOString();
  return {
    schema: "basket_intraday_comparison.v1",
    benchmark: "SPY",
    method: "matched_member_equal_weight",
    observation_kind: "regular",
    settlement_tolerance_seconds: 0,
    status: "observed",
    max_clock_skew_seconds: 60,
    reference_asof: reference,
    source_asof: source,
    elapsed_minutes: (sourceMs - referenceMs) / MINUTE,
    session_date: sessionDay.format(new Date(sourceMs)),
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

/** A second observed basket whose figures deliberately differ from the first, so a section-wide
 * assertion about one basket's numbers can never be satisfied by the other one's. */
const retainedComparison = (now: number): Json => comparison(now, {
  observation_kind: "settled_regular",
  settlement_tolerance_seconds: 90,
  delivery_state: "retained",
  is_new_observation: false,
  // -1.75% absolute against a 0.50% benchmark is exactly -2.238806% relative.
  absolute_change_pct: -1.75,
  relative_change_pct: -2.238806,
  positive_relative_breadth_pct: 25,
});

/** One new observation, one redelivered settled close, and two owner-qualified baskets, so a
 * single payload exercises observation, redelivery and qualification in one rendered panel. */
export function intradayPulse(now = Date.now()): Json {
  const sourceMs = now - MINUTE, settledEnd = new Date(sourceMs).toISOString();
  return {
    schema: "basket_pulse.v1",
    market: "us",
    session: "rth",
    mode: "last_rth",
    built: new Date(now).toISOString(),
    as_of_utc: new Date(now).toISOString(),
    as_of_quotes: settledEnd,
    coverage_pct: 99.7,
    n_quotes_total: 2109,
    baskets: [
      { id: "ai_infra", n_members: 10, n_quoted: 10, live_ew_chg_pct: -1.25,
        intraday_comparison: comparison(now) },
      { id: "mag7", n_members: 10, n_quoted: 10, live_ew_chg_pct: 3.5,
        intraday_comparison: retainedComparison(now) },
      { id: "ai_software", n_members: 10, n_quoted: 10, live_ew_chg_pct: 0.4,
        intraday_comparison: { schema: "basket_intraday_comparison.v1", benchmark: "SPY",
          method: "matched_member_equal_weight", observation_kind: "regular",
          settlement_tolerance_seconds: 0, status: "baseline_missing" } },
      { id: "clean_energy", n_members: 10, n_quoted: 10, live_ew_chg_pct: null,
        intraday_comparison: comparison(now, { status: "insufficient_matched_coverage",
          delivery_state: undefined, is_new_observation: undefined,
          matched_members: 2, coverage_pct: 20, excluded: { missing_observation: 8 },
          absolute_change_pct: undefined, benchmark_change_pct: undefined,
          relative_change_pct: undefined, positive_relative_breadth_pct: undefined }) },
    ],
  };
}

/** A single aged comparison beside fresh peers, for the stale-evidence browser journey. */
export function intradayPulseWithStaleComparison(now = Date.now()): Json {
  const pulse = intradayPulse(now);
  // Rebuild the complete owner clock bundle: moving only its endpoints can cross New York
  // midnight while leaving session_date on the fresh observation's day.
  const stale = intradayPulse(now - 49 * MINUTE);
  (pulse.baskets as Json[])[0].intraday_comparison =
    (stale.baskets as Json[])[0].intraday_comparison;
  return pulse;
}
