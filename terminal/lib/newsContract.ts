import type {
  TickerNewsChange,
  TickerNewsChangeKind,
  TickerNewsSnapshot,
  TickerNewsState,
  TickerNewsStory,
} from "@/lib/newsTypes";
import {
  TickerNewsContractError,
  asBoolean,
  asNonNegativeInt,
  asPositiveInt,
  asRecord,
  asStoryId,
  asText,
  asTimestamp,
  asHttpUrl,
  normalizeTickerNewsSymbol,
  parseHealth,
  parseStoryRow,
} from "@/lib/newsValidation";

export type * from "@/lib/newsTypes";
export { TickerNewsContractError, normalizeTickerNewsSymbol };

const STATES = new Set<TickerNewsState>([
  "live",
  "catching_up",
  "degraded",
  "quiet",
  "restricted",
  "unavailable",
]);

export function parseTickerNewsSnapshot(value: unknown): TickerNewsSnapshot {
  const obj = asRecord(value, "snapshot");
  if (obj.schema !== "ticker_news.snapshot.v1") {
    throw new TickerNewsContractError("snapshot_schema");
  }
  const state = asText(obj.state, "snapshot_state", 64) as TickerNewsState;
  if (!STATES.has(state)) throw new TickerNewsContractError("snapshot_state");
  if (!Array.isArray(obj.rows)) throw new TickerNewsContractError("snapshot_rows");
  const nextCursor =
    obj.next_cursor === null
      ? null
      : asPositiveInt(obj.next_cursor, "snapshot_next_cursor");
  return {
    schema: "ticker_news.snapshot.v1",
    ticker: normalizeTickerNewsSymbol(asText(obj.ticker, "snapshot_ticker", 32)),
    security_id: asText(obj.security_id, "snapshot_security_id", 1024),
    state,
    rows: obj.rows.map(parseStoryRow),
    next_cursor: nextCursor,
    has_more: asBoolean(obj.has_more, "snapshot_has_more"),
    source_health: parseHealth(obj.source_health),
  };
}

export function parseTickerNewsChange(value: unknown): TickerNewsChange {
  const obj = asRecord(value, "change");
  const kind = asText(obj.kind, "change_kind", 16) as TickerNewsChangeKind;
  if (kind !== "upsert" && kind !== "remove") {
    throw new TickerNewsContractError("change_kind");
  }
  if (!Array.isArray(obj.security_ids)) {
    throw new TickerNewsContractError("change_security_ids");
  }
  return {
    sequence: asPositiveInt(obj.sequence, "change_sequence"),
    kind,
    source: asText(obj.source, "change_source", 128),
    source_item_id: asText(obj.source_item_id, "change_source_item_id", 256),
    story_id: asStoryId(obj.story_id, "change_story_id"),
    title: asText(obj.title, "change_title", 4096, true),
    url: asHttpUrl(obj.url, "change_url"),
    teaser: asText(obj.teaser, "change_teaser", 65536, true),
    security_ids: obj.security_ids.map((v) =>
      asText(v, "change_security_id", 1024),
    ),
    universe_revision: asText(
      obj.universe_revision,
      "change_universe_revision",
      1024,
    ),
    observed_at: asTimestamp(obj.observed_at, "change_observed_at")!,
  };
}

export function parseTickerNewsStory(value: unknown): TickerNewsStory {
  const obj = asRecord(value, "story");
  if (obj.schema !== "ticker_news.story.v1") {
    throw new TickerNewsContractError("story_schema");
  }
  const id = asStoryId(obj.story_id);
  if (!Array.isArray(obj.members)) {
    throw new TickerNewsContractError("story_members");
  }
  const members = obj.members.map(parseStoryRow);
  if (members.some((member) => member.story_id !== id)) {
    throw new TickerNewsContractError("story_member_id");
  }
  const sourceCount = asNonNegativeInt(obj.source_count, "story_source_count");
  const itemCount = asNonNegativeInt(obj.item_count, "story_item_count");
  if (itemCount !== members.length) {
    throw new TickerNewsContractError("story_item_count");
  }
  return {
    schema: "ticker_news.story.v1",
    story_id: id,
    source_count: sourceCount,
    item_count: itemCount,
    members,
  };
}