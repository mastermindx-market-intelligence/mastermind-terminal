// Original synthetic display specimen shaped like the incumbent publisher.
export const macroForecastFixture = () => {
 const champion = { point: .15, p10: -.1, p25: .05, p50: .16, p75: .25, p90: .4 };
 const headline = { release: "cpi", release_type: "cpi_headline", period: "2026-10", release_date: "2026-11-16", target: "mom_sa_pct", cutoff_label: "T-1", projection: champion,
  primary_forecast_basis: "combined_v1_benchmark_augmented", context_metrics_basis: "champion_legacy_target_v1", basis_warning: "Synthetic source: the primary blend and context metrics have different bases.",
  combined: { display_only: true, authority: false, combined_point: .2, p10: -.05, p25: .1, p50: .21, p75: .3, p90: .45, combined_components: { inputs_used: ["champion", "cleveland"], weights: { champion: .5, cleveland: .5 }, points: { champion: .15, cleveland: .25 }, cold_start: true } },
  input_completeness: 1, coverage_flags: { fresh_proxy_coverage: .8 }, benchmark_set: { naive_prior: .3, cleveland_nowcast: .25 },
  expectation_read: { expectation_median: 9.99, sources: ["cleveland_nowcast"] }, surprise_distribution: { p_hot: .95, p_inline: .03, p_cold: .02 },
  components: [{ name: "energy", contrib_pp: -.05 }, { name: "shelter", contrib_pp: .2 }],
  shadows: { v3_factor: { display_only: true, claim_withdrawn: { verdict: "WITHDRAWN", receipt_sha256: "d".repeat(64) }, point: 777, p10: 700, p90: 800 } },
 };
 return { schema: "release_forecast.v2", display_only: true, asof: "2026-10-16T18:18:59Z", authority: { can_score: false, can_size: false, can_trade: false },
  methodology_status: { accuracy_claim: "withheld_until_clean_aligned_forward_evidence", street_consensus: "unavailable" },
  upcoming: [headline, { ...headline, release_type: "cpi_core", projection: { ...champion, point: null }, primary_forecast_basis: "champion_legacy_target_v1", context_metrics_basis: "champion_legacy_target_v1", combined: null, expectation_read: null, surprise_distribution: null },
   { release: "claims", release_type: "claims", period: "2026-11-19", release_date: "2026-11-19", target: "change_thousands", target_epoch: "official_initial_level_v1", projection: { mode: "benchmark_only", reason: "Source model is withheld. Benchmarks remain available." }, benchmark_set: { naive_prior: 215, trailing_4w: 223.75 } },
   { release: "retail", release_type: "retail_sales", period: null, release_date: null, target: "mom_sa_pct", projection: { point: null }, pit: { reason: "no_data", note: "The source has not published a retail projection." } }],
  track_record: { schema: "release_forecast_track_record.v1", display_min_n: 12, verdict_min_n: 24, releases: [{ release: "cpi_headline", model: "champion", display_state: "proxy_or_mixed_target", clean_n: 2, first_print_matched_n: 0, proxy_scored_n: 2, other_basis_n: 0, target_epochs: ["proxy"], mae_ours: 99, mae_ours_ci: [90, 100] }], shadows: [] },
  last_scored_all_forward: [{ release: "cpi_headline", period: "2026-09", frozen_projection_point: .2, actual_first: .3, evaluation: { eligible: false, basis: "mixed", excluded_defect_ids: ["synthetic_exclusion"] } }],
 };
};
