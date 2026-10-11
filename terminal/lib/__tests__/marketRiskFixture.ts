// Synthetic contract fixture. Dates and observations are not historical research evidence.
export const MARKET_RISK_NOW = Date.parse("2026-10-08T12:00:00Z");
export function riskEnvelopeFixture() {
  return {
    schema: "mastermind.risk_envelope/v1", definition_id: "risk-envelope-fixture/v1",
    market: "US", revision: "settled", bundle_id: "fixture-rotation-001",
    source_session: "2026-10-07", as_of: "2026-10-07",
    observed_at: "2026-10-08T06:00:00Z", produced_at: "2026-10-08T06:00:00Z", stale_after: null,
    measured_state: { source_artifact: "market-state-latest", verdict: "MIXED", score: 51, as_of: "2026-10-07", usable: true },
    hazard_summary: { stage: "FRAGILE", display_only: true },
    policy_summary: { posture: "NORMAL", basis: "zero_active_policies", policy_count: 0, display_only: true },
    authority: { envelope_may_execute: false, envelope_may_gate: false, envelope_may_rank: false, envelope_may_size: false },
    data_state: "PARTIAL", freshness: { source_session: "2026-10-07", all_on_session: false, off_session_sources: ["optional-context"] },
    rotation_context: {
      source_artifact: "site-marketdata-rotation-events", state: "DEFENSIVE_RELATIVE_STRENGTH", as_of: "2026-10-07",
      usable: true, coverage: "FRESH", display_only: true, excluded_reason: null,
      early_context: { schema: "rotation_early_context/v1", definition_id: "fixture/v1", as_of: "2026-10-07",
        state: "DEFENSIVE_RELATIVE_STRENGTH", pairs: [], coverage: { registered_pairs: 0 }, display_only: true },
      confirmed_events: { active_count: 0, active_ids: [], as_of: "2026-09-29", usable: false },
    },
    confluence: {
      definition_id: "risk-confluence-fixture/v1", state: "DEFENSIVE_RELATIVE_STRENGTH__MIXED",
      measured_backdrop: "MIXED", rotation_state: "DEFENSIVE_RELATIVE_STRENGTH", lineage_status: "PARTIAL",
      nonredundant_components: [["market-state-latest", "site-marketdata-rotation-events"]], nonredundant_component_count: null,
      unknown_lineage_sources: ["optional-context"], source_relationships: [], excluded_sources: [],
      statistical_independence_established: false, changes_hazard_stage: false, changes_policy: false, display_only: true,
    },
    market_transition: {
      basis: "market_state_forward_log", status: "AVAILABLE", current_matches_latest_record: true, display_only: true,
      latest_recorded_change: {
        before: { asof: "2026-09-29", verdict: "RISK_ON", score: 61 },
        after: { asof: "2026-09-30", verdict: "MIXED", score: 54 },
        verdict_changed: true, cause: "not_inferred_from_snapshot_differences",
      },
    },
  };
}
export function marketRiskSourceFixture() {
  return {
    schema: "market_state.v1", asof: "2026-10-07", built: "2026-10-08T06:00:00Z",
    verdict: "MIXED", score: 51, raw_score: 51, score_source: "blend", capped: false, score_caps: [],
    label_en: "Mixed", label_zh: "混合", color: "amber", headline_en: "Source-native mixed backdrop.", headline_zh: "来源判断：混合背景。",
    freshness: { stale: false }, radar: { state: "CAUTION", binding: false, can_force: false },
  };
}
