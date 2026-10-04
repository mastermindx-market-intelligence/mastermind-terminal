export const EPISODE_STATES = [
  "PROBING",
  "ARMED",
  "TURNING",
  "CANDIDATE",
  "INVALIDATED",
  "EXPIRED",
  "RESOLVED",
] as const;

export type EpisodeState = (typeof EPISODE_STATES)[number];

export type EpisodeCatalyst = {
  radar_episode_schema: string;
  radar_episode_id: string;
  fresh_until: string;
  relevant_until: string;
  coverage: string;
};

export type LiveEntryEpisode = {
  episode_id: string;
  ticker: string;
  detector_id: string;
  detector_version: string;
  detector_spec_hash: string;
  state: string;
  market_session: string;
  variant: string;
  first_armed_at: string | null;
  candidate_at: string | null;
  last_observed_at: string | null;
  bar_availability: Record<string, unknown>;
  feature_snapshot: Record<string, unknown>;
  universe_admission: Record<string, unknown>;
  lobe_nominations: unknown[];
  price_at_signal: unknown;
  risk_geometry: Record<string, unknown>;
  detector_score: null;
  research_priority: null;
  opportunity_score: null;
  data_quality: string;
  freshness: Record<string, unknown>;
  evidence_refs: unknown[];
  schema: string;
  catalyst?: EpisodeCatalyst;
};

export type EntryRadarFile = {
  asof: string;
  schema: string;
  session: string;
  pack: { as_of: string; pack_hash?: string };
  health: { state: string; [k: string]: unknown };
  episodes?: LiveEntryEpisode[];
  [k: string]: unknown;
};

export type Stance = "forming" | "confirmed" | "ended";

export type EpisodeDisplay = {
  stance: Stance;
  stance_en: string;
  stance_zh: string;
  knowable_at: string | null;
  delay_badge_en: "Delayed data (≈15 min)";
  delay_badge_zh: "延迟数据（约15分钟）";
};

export type DislocationEpisode = LiveEntryEpisode & { display: EpisodeDisplay };

export type SourceFallbackReason = "malformed" | "missing" | "unreadable" | "schema";

export type SourceReadOk = {
  kind: "ok";
  file: EntryRadarFile;
  mtimeMs: number;
  loadedAt: number;
  servedFromCache: boolean;
  fallback_reason: SourceFallbackReason | null;
};

export type SourceReadUnavailable = {
  kind: "unavailable";
  reason: "missing" | "unreadable" | "malformed" | "schema";
  lastGood: { asof: string; at: number } | null;
};

export type SourceRead = SourceReadOk | SourceReadUnavailable;

export type FreshnessVerdict = {
  stale: boolean;
  pack_fresh: boolean;
  age_s: number | null;
  reason: "fresh" | "pack_old" | "pack_asof_after_session" | "file_old" | "no_asof";
};
