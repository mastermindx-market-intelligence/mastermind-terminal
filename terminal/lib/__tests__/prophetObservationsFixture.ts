export const prophetAuthority = () => ({ buy: false, alert: false, entry_open: false, rank: false, size: false, episode_write: false });
export function prophetFixture(ticker = "KO") {
  const receipt = `sha256:${"a".repeat(64)}`;
  return {
    schema: "prophet.early_observations/v1", market: "US", status: "CURRENT_SESSION",
    source_receipt: receipt, snapshot_id: `early:${"b".repeat(64)}`, reference_session: "2026-10-16",
    clocks: { source_session: "2026-10-16", logical_known_at: "2026-10-16T20:00:00Z", actual_clock_state: "NOT_RECORDED", published_at: null },
    coverage: { state: "VERIFIED_SOURCE_PARTITION", total: 378, featured: 40, beyond_cap: 338, source_artifact_receipt: `sha256:${"c".repeat(64)}` },
    authority: prophetAuthority(),
    counts: { source: 378, matched: 1, returned: 1 }, page: { offset: 0, limit: 50, next_offset: null },
    rows: [{ ticker, security_id: `SEC:US-XNYS-${ticker}`, identity_basis: "CURRENT_REFERENCE_ONLY",
      source_event_id: `turn_watch:${"d".repeat(64)}`, source_receipt: receipt, source_session: "2026-10-16",
      triggers_fired: ["pre_confluence_2d"], source_visibility: "BEYOND_CAP",
      source_evidence: { triggers: { pre_confluence_2d: { fired: true, evaluated: true, last_date: "2026-10-15", days_since: 1 } }, counterevidence: [], counterevidence_state: "RECORDED" },
      lineage: { selection_era: "anticipation-v1-2026-08-08", anchor_era: "abs-session-2026-08-06", source_artifact_receipt: `sha256:${"c".repeat(64)}` },
      episode_relation: { state: "BLOCKED_BY_ACTIVE_EPISODE", reason: "ACTIVE_EPISODE_DIFFERENT_ANCHOR", episode_id: null, generation_id: `peg:${"e".repeat(64)}` },
      authority: prophetAuthority(),
    }],
  };
}
