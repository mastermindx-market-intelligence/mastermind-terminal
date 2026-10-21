export type TickerNewsViewMode = "news" | "company" | "all";
export type TickerNewsEditorialView = {
  schema: "ticker_news.editorial_view.v1";
  rules: string;
  mode: TickerNewsViewMode;
  revision: string;
  name_coverage: "names_and_symbols" | "symbols_only" | "unavailable";
};
export type TickerNewsEditorial = {
  schema: "ticker_news.editorial_view.v1";
  format: "unclassified" | "roundup" | "investment_template" | "commentary";
  format_reason: string | null;
  company_reference: "headline" | "summary" | "not_observed";
  eligible: boolean;
};

export type TickerNewsState =
  | "live"
  | "catching_up"
  | "degraded"
  | "quiet"
  | "restricted"
  | "unavailable";

export type TickerNewsChangeKind = "upsert" | "remove";

export type TickerNewsReportingState =
  | "not_compared"
  | "no_material_difference"
  | "reports_differ"
  | "comparison_limited";

export type TickerNewsContentKind = "reporting" | "press_release";

export type TickerNewsStoryRow = {
  sequence: number;
  source: string;
  source_item_id: string;
  story_id: string;
  source_count: number;
  item_count: number;
  title: string;
  url: string;
  teaser: string;
  published_at: string | null;
  updated_at: string | null;
  received_at: string;
  universe_revision: string;
  reporting_state?: TickerNewsReportingState;
  content_kind?: TickerNewsContentKind;
  editorial_view?: TickerNewsEditorialView;
  editorial?: TickerNewsEditorial | null;
};

export type TickerNewsSourceHealth = {
  state: string;
  last_successful_catchup: string | null;
};

export type TickerNewsRightsBasis = {
  receipt_id: string;
  source: string;
  provider: string;
  effective_at: string;
  expires_at: string;
};

export type TickerNewsSnapshot = {
  schema: "ticker_news.snapshot.v1";
  editorial_policy?: string;
  editorial_view?: TickerNewsEditorialView;
  change_sequence?: number;
  ticker: string;
  security_id: string;
  universe_known_at?: string | null;
  rights_basis?: TickerNewsRightsBasis | null;
  state: TickerNewsState;
  rows: TickerNewsStoryRow[];
  next_cursor: number | null;
  has_more: boolean;
  source_health: TickerNewsSourceHealth;
  flow: TickerNewsFlow | null;
};

// ---- ticker_news.flow.v1 (Wave B; frozen wire contract wb_news_flow_contract.md) ----

export type TickerNewsFlowState = "ok" | "thin_history" | "unavailable";
export type TickerNewsFlowReason = "no_accessible_sources" | "calculation_failed" | "malformed";
export type TickerNewsFlowComparison = "busier" | "typical" | "quieter" | "insufficient_history";

export type TickerNewsFlowProvenance = {
  editorial_view?: TickerNewsEditorialView;
  velocity_schema: string;
  sources_counted: string[];
  status_counted: string;
  distinct_by: string;
  story_grouping: string;
  cluster_policy_version: string;
  windows: {
    reports_24h: string;
    reports_7d: string;
    daily_28d: {
      start_date: string;
      end_date: string;
      unit: string;
      excludes: string;
      order: string;
    };
  };
  calculation: {
    method: string;
    comparison_rule: string;
  };
  time_basis_counts_24h: {
    published_at: number;
    received_at: number;
  };
};

export interface TickerNewsFlow {
  schema: "ticker_news.flow.v1";
  state: TickerNewsFlowState;
  reason: TickerNewsFlowReason | null;
  coverage: "complete" | "partial";
  as_of: string | null;
  reports_24h: number | null;
  reports_7d: number | null;
  stories_24h: number | null;
  median_daily_28d: number | null;
  daily_counts_28d: number[] | null;
  history_days_observed: number | null;
  comparison: TickerNewsFlowComparison | null;
  provenance: TickerNewsFlowProvenance | null;
}

export type TickerNewsChange = {
  sequence: number;
  kind: TickerNewsChangeKind;
  source: string;
  source_item_id: string;
  story_id: string;
  title: string;
  url: string;
  teaser: string;
  security_ids: string[];
  universe_revision: string;
  observed_at: string;
  // Additive current-state projection; sequence remains the delivery cursor.
  source_count?: number | null;
  item_count?: number | null;
  published_at?: string | null;
  updated_at?: string | null;
  received_at?: string | null;
  reporting_state?: TickerNewsReportingState;
  content_kind?: TickerNewsContentKind;
  editorial_view?: TickerNewsEditorialView;
  editorial?: TickerNewsEditorial | null;
};

export type TickerNewsStory = {
  schema: "ticker_news.story.v1";
  story_id: string;
  source_count: number;
  item_count: number;
  members: TickerNewsStoryRow[];
  reporting_state?: TickerNewsReportingState;
  content_kind?: TickerNewsContentKind;
  editorial_view?: TickerNewsEditorialView;
  editorial?: TickerNewsEditorial | null;
};