export type TickerNewsState =
  | "live"
  | "catching_up"
  | "degraded"
  | "quiet"
  | "restricted"
  | "unavailable";

export type TickerNewsChangeKind = "upsert" | "remove";

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
};

export type TickerNewsSourceHealth = {
  state: string;
  last_successful_catchup: string | null;
};

export type TickerNewsSnapshot = {
  schema: "ticker_news.snapshot.v1";
  ticker: string;
  security_id: string;
  state: TickerNewsState;
  rows: TickerNewsStoryRow[];
  next_cursor: number | null;
  has_more: boolean;
  source_health: TickerNewsSourceHealth;
};

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
};

export type TickerNewsStory = {
  schema: "ticker_news.story.v1";
  story_id: string;
  source_count: number;
  item_count: number;
  members: TickerNewsStoryRow[];
};