/** Synthetic contract specimen; never served by a production route. */
export function candidateFixture() {
  const names = ["Aster Instruments", "Beacon Systems", "Cedar Networks", "Dawn Materials"];
  return {
    schema: "mastermind.prophet_candidate_pool_read.v1", market: "US",
    source: { path: "site/factordata/us_standouts.json", sha256: `sha256:${"a".repeat(64)}`, bytes: 2200 },
    projection: {
      status: "ready", reason: null, as_of: "2026-11-12", display_only: true, source_digest: "b".repeat(64),
      counts: { eligible: 4, in_buy_lane: 2, off_buy_lane: 2, scored: 2, unscored: 2 },
      rows: ["DEMOA", "DEMOB", "DEMOC", "DEMOD"].map((ticker, i) => ({
        ticker, name: names[i], sector: ["Industrials", "Technology", "Technology", "Materials"][i],
        pool_rank: [7, 1, 4, 12][i] as number | string | null, in_buy_lane: i < 2,
        lane: i < 2 ? "featured" : "forming",
        headline_reason: ["board_featured", "already_open", "sector_cap_overflow", "entry_status_wait"][i],
        lane_reasons: [] as string[] | null, tier_cascade: null, admission_class: null,
        prophet_score_basis: i < 2 ? "buy_lane_pool" : null,
        prophet: i < 2 ? { score: i === 0 ? 82.5 : 0 } : null,
      })),
    },
  };
}
