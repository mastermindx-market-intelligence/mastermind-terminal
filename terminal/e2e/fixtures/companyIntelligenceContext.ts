/** Synthetic company records, shared across the existing standalone and Beta journeys. */
const SHA = "a".repeat(64);
const metrics = (overrides: Record<string, number | null> = {}) => ({
  sentiment: 68,
  performance: 72,
  confidence: 64,
  combined: 68,
  call_positivity: 71,
  management_confidence: 66,
  analyst_criticism: 22,
  future_outlook: 74,
  revenue_growth_pct: 18.4,
  eps_growth_pct: 21.1,
  gross_margin_pct: 74.2,
  analysts_count: 12,
  questions_count: 18,
  ...overrides,
});

function event(id: string, fiscalYear: number, fiscalQuarter: number, callDate: string, summary: string) {
  const eventMetrics = metrics();
  return {
    event_id: id,
    ticker: "NVDA",
    fiscal_year: fiscalYear,
    fiscal_quarter: fiscalQuarter,
    call_date: callDate,
    summary,
    highlights: ["Data-center demand remained broad across the period."],
    positive_highlights: ["Revenue growth accelerated with broad data-center demand."],
    negative_highlights: ["Supply and deployment timing remain watch items."],
    key_quote: "We continue to see broad demand across our platform.",
    tags: ["data center", "demand"],
    metrics: eventMetrics,
    field_lineage: {
      summary: "earnings_history",
      key_quote: "earnings_history",
      metrics: Object.fromEntries(Object.keys(eventMetrics).map((key) => [key, "score_overlay"])),
      positive_highlights: ["earnings_history"],
      negative_highlights: ["earnings_history"],
      highlights: ["earnings_history"],
      tags: { "data center": "earnings_history", demand: "earnings_history" },
    },
    previous_event_deltas: metrics({ revenue_growth_pct: 2.1, eps_growth_pct: 1.6, gross_margin_pct: 0.4, questions_count: 3 }),
    sources: [
      {
        source_ref: "earnings_history",
        kind: "earnings_history",
        status: "present",
        citation_precision: "document",
        url: "https://investor.nvidia.com/earnings",
        receipt: { source_hash: SHA, source_date: callDate, record_id: `${id}-earnings` },
      },
      {
        source_ref: "score_overlay",
        kind: "score_overlay",
        status: "metadata_only",
        citation_precision: "metadata",
        url: null,
        receipt: { source_hash: "b".repeat(64), source_date: callDate, record_id: `${id}-overlay` },
      },
      {
        source_ref: "transcript",
        kind: "transcript",
        status: "present",
        citation_precision: "document",
        url: `/data/tx/NVDA/${fiscalYear}Q${fiscalQuarter}.json.gz`,
        receipt: { source_hash: "c".repeat(64), source_date: callDate, record_id: `${fiscalYear}Q${fiscalQuarter}` },
      },
    ],
    claim_citations_pending: true,
  };
}

export function contextFixture() {
  const latest = event(
    "cie_d8488221fd8c710c53d6537d",
    2026,
    1,
    "2026-05-20",
    "NVIDIA reported broad platform demand, with revenue growth and gross-margin discipline remaining central to the event read-through.",
  );
  const prior = event(
    "cie_4c0410e7c4358283cf37a557",
    2025,
    4,
    "2026-02-19",
    "The preceding event established the demand and supply baseline for this quarter-over-quarter comparison.",
  );
  return {
    schema: "company_intelligence_context.v1",
    authority: "context_only",
    is_context_only: true,
    generated_at: "2026-08-01T12:00:00Z",
    generation_id: "a".repeat(24),
    company: { ticker: "NVDA", display_name: "NVIDIA Corporation", exchange: null },
    status: "ready",
    latest_event_id: latest.event_id,
    latest_event: latest,
    history: [latest, prior],
    topics: {
      timeline: [
        { tag: "data center", first_event_id: prior.event_id, last_event_id: latest.event_id, event_count: 2, status: "persistent" },
        { tag: "demand", first_event_id: latest.event_id, last_event_id: latest.event_id, event_count: 1, status: "added" },
      ],
      added: ["demand"],
      dropped: [],
      persistent: ["data center"],
    },
    source_completeness: {
      earnings_history: { status: "present", event_count: 2 },
      score_overlay: { status: "metadata_only", event_count: 2 },
      transcripts: { status: "present", event_count: 2 },
    },
    warnings: [],
    missing_sources: [],
    transport_lineage: {
      earnings_manifest: { generation_id: "b".repeat(24), sha256: "d".repeat(64) },
      tx_index: { schema: "mastermind.tx-index/v1", generation_id: "c".repeat(24), sha256: "e".repeat(64) },
      builder: "company_intelligence.v1",
    },
  };
}

export function themeContextFixture() {
  return {
    schema: "company_theme_exposure.v1",
    authority: "context_only",
    is_context_only: true,
    generated_at: "2026-08-01T12:00:00Z",
    generation_id: "f".repeat(24),
    status: "partial",
    company: { ticker: "NVDA" },
    company_intelligence: {
      generation_id: "a".repeat(24),
      context_sha256: "9".repeat(64),
      latest_event_id: "cie_d8488221fd8c710c53d6537d",
      latest_event_call_date: "2026-05-20",
    },
    exposures: [{
      theme_id: "ai_infrastructure",
      name_en: "AI Infrastructure",
      name_zh: "人工智能基础设施",
      basket_id: "ai_semiconductors",
      mapping_qualifier: "proxy",
    }],
    coverage: { status: "mixed", active_basket_count: 2, mapped_basket_count: 1, unmapped_basket_count: 1 },
    theme_state: { status: "stale", as_of: "2026-07-28", sha256: "8".repeat(64) },
    warnings: ["active_membership_unmapped", "theme_state_stale"],
  };
}

export function institutionalContextFixture() {
  return {
    schema: "company_institutional_context.v1",
    authority: "context_only",
    is_context_only: true,
    generated_at: "2026-08-01T12:00:00Z",
    generation_id: "7".repeat(24),
    status: "ready",
    company: { ticker: "NVDA" },
    company_intelligence: {
      generation_id: "a".repeat(24),
      context_sha256: "6".repeat(64),
      latest_event_id: "cie_d8488221fd8c710c53d6537d",
      latest_event_call_date: "2026-05-20",
    },
    period: {
      build_as_of: "2026-08-01",
      consensus_period: "2026-03-31",
      comparison_period: "2025-12-31",
      filing_window_closed_on: "2026-05-15",
      consensus_available_on: "2026-05-15",
      latest_reporting_filing_date: "2026-05-15",
    },
    coverage: {
      configured_manager_count: 4,
      active_manager_count: 3,
      closed_manager_count: 1,
      reporting_manager_count: 3,
      missing_manager_count: 0,
      comparison_reporting_manager_count: 3,
      comparison_missing_manager_count: 0,
      resolved_position_count: 3,
      unresolved_position_count: 0,
    },
    positions: [
      {
        manager: "alpha", manager_name: "Alpha Capital", manager_style: "quality_growth", manager_grade: "A",
        action: "add", is_current_holder: true, value_usd: 12_000_000, book_weight_pct: 2.4, shares: 40_000,
        shares_change_pct: 25, period_end: "2026-03-31", filing_date: "2026-05-14",
        snapshot: { path: "data/smart_money/alpha/2026-03-31.parquet", sha256: "1".repeat(64), bytes: 2400 },
      },
      {
        manager: "gamma", manager_name: "Gamma Investments", manager_style: "compounder", manager_grade: "A-",
        action: "hold", is_current_holder: true, value_usd: 8_000_000, book_weight_pct: 1.8, shares: 26_000,
        shares_change_pct: 2, period_end: "2026-03-31", filing_date: "2026-05-15",
        snapshot: { path: "data/smart_money/gamma/2026-03-31.parquet", sha256: "2".repeat(64), bytes: 2100 },
      },
      {
        manager: "beta", manager_name: "Beta Partners", manager_style: "value", manager_grade: "B+",
        action: "trim", is_current_holder: true, value_usd: 8_000_000, book_weight_pct: 1.2, shares: 20_000,
        shares_change_pct: -15, period_end: "2026-03-31", filing_date: "2026-05-15",
        snapshot: { path: "data/smart_money/beta/2026-03-31.parquet", sha256: "3".repeat(64), bytes: 2200 },
      },
    ],
    consensus: {
      current_holder_count: 3, buyer_count: 1, trimmer_count: 1, exit_count: 0, unknown_move_count: 0,
      total_value_usd: 28_000_000, ownership_hhi: 0.346939, max_book_weight_pct: 2.4, avg_book_weight_pct: 1.8,
    },
    trend: {
      status: "available", direction: "accumulating", eligible_period_count: 3,
      periods: [
        { period_end: "2025-09-30", available_on: "2025-11-14", reporting_manager_count: 3, missing_manager_count: 0, holder_count: 1, total_value_usd: 9_000_000, eligible: true },
        { period_end: "2025-12-31", available_on: "2026-02-17", reporting_manager_count: 3, missing_manager_count: 0, holder_count: 2, total_value_usd: 18_000_000, eligible: true },
        { period_end: "2026-03-31", available_on: "2026-05-15", reporting_manager_count: 3, missing_manager_count: 0, holder_count: 3, total_value_usd: 28_000_000, eligible: true },
      ],
    },
    warnings: [],
  };
}

