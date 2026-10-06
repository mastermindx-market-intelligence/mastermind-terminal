/** Shared ticker-news contract types and validators (safe for client import; no server deps). */

export const TICKER_NEWS_SNAPSHOT_SCHEMA = "ticker_news.snapshot.v1" as const;
export const TICKER_NEWS_CHANGES_SCHEMA = "ticker_news.changes.v1" as const;
export const TICKER_NEWS_STORY_SCHEMA = "ticker_news.story.v1" as const;
export const TICKER_NEWS_RESTRICTED_SCHEMA = "ticker_news.restricted.v1" as const;
export const TICKER_NEWS_UNAVAILABLE_SCHEMA = "ticker_news.unavailable.v1" as const;

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export type StoryRow = {
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

export type ChangeRow = {
  sequence: number;
  kind: "upsert" | "remove";
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

export type NewsSnapshot = {
  schema: typeof TICKER_NEWS_SNAPSHOT_SCHEMA;
  ticker: string;
  security_id: string;
  state: string;
  rows: StoryRow[];
  next_cursor: number | null;
  has_more: boolean;
  source_health: Record<string, unknown>;
};

export type ChangePage = {
  schema: typeof TICKER_NEWS_CHANGES_SCHEMA;
  ticker: string;
  security_id: string;
  rows: ChangeRow[];
  next_sequence: number;
  has_more: boolean;
};

export type StoryDetail = {
  schema: typeof TICKER_NEWS_STORY_SCHEMA;
  story_id: string;
  source_count: number;
  item_count: number;
  members: StoryRow[];
};

export type RestrictedEvent = {
  schema: typeof TICKER_NEWS_RESTRICTED_SCHEMA;
  ticker: string;
  detail: string;
};

export type UnavailableEvent = {
  schema: typeof TICKER_NEWS_UNAVAILABLE_SCHEMA;
  ticker: string;
  detail: string;
};

export class NewsContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NewsContractError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function positiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return null;
  return value;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableTimestamp(value: unknown): string | null {
  if (value === null) return null;
  return typeof value === "string" && ISO_TIMESTAMP.test(value) ? value : null;
}

function requiredTimestamp(value: unknown): string | null {
  return nullableTimestamp(value);
}

function parseStoryRow(value: unknown): StoryRow | null {
  if (!isRecord(value)) return null;
  const sequence = positiveInt(value.sequence);
  const source = stringField(value.source);
  const source_item_id = stringField(value.source_item_id);
  const story_id = stringField(value.story_id);
  const source_count = positiveInt(value.source_count);
  const item_count = positiveInt(value.item_count);
  const title = stringField(value.title);
  const url = stringField(value.url);
  const teaser = stringField(value.teaser);
  const published_at = nullableTimestamp(value.published_at);
  const updated_at = nullableTimestamp(value.updated_at);
  const received_at = requiredTimestamp(value.received_at);
  const universe_revision = stringField(value.universe_revision);
  if (
    sequence === null || !source || !source_item_id || !story_id
    || source_count === null || item_count === null || title === null
    || url === null || teaser === null || published_at === undefined
    || updated_at === undefined || !received_at || !universe_revision
  ) return null;
  if (value.published_at !== null && published_at === null) return null;
  if (value.updated_at !== null && updated_at === null) return null;
  return {
    sequence,
    source,
    source_item_id,
    story_id,
    source_count,
    item_count,
    title,
    url,
    teaser,
    published_at,
    updated_at,
    received_at,
    universe_revision,
  };
}

function parseChangeRow(value: unknown): ChangeRow | null {
  if (!isRecord(value)) return null;
  const sequence = positiveInt(value.sequence);
  const kind = value.kind === "upsert" || value.kind === "remove" ? value.kind : null;
  const source = stringField(value.source);
  const source_item_id = stringField(value.source_item_id);
  const story_id = stringField(value.story_id);
  const title = stringField(value.title);
  const url = stringField(value.url);
  const teaser = stringField(value.teaser);
  const universe_revision = stringField(value.universe_revision);
  const observed_at = requiredTimestamp(value.observed_at);
  if (!Array.isArray(value.security_ids)) return null;
  const security_ids = value.security_ids.map((id) => (typeof id === "string" ? id : null));
  if (security_ids.some((id) => id === null)) return null;
  if (
    sequence === null || !kind || !source || !source_item_id || !story_id
    || title === null || url === null || teaser === null || !universe_revision || !observed_at
  ) return null;
  return {
    sequence,
    kind,
    source,
    source_item_id,
    story_id,
    title,
    url,
    teaser,
    security_ids: security_ids as string[],
    universe_revision,
    observed_at,
  };
}

function assertTicker(ticker: string, expectedTicker: string): void {
  if (ticker !== expectedTicker) {
    throw new NewsContractError("ticker_mismatch", `Expected ticker ${expectedTicker}, got ${ticker}`);
  }
}

export function parseSnapshot(x: unknown, expectedTicker: string): NewsSnapshot {
  if (!isRecord(x)) throw new NewsContractError("invalid_shape", "Snapshot is not an object");
  if (x.schema !== TICKER_NEWS_SNAPSHOT_SCHEMA) {
    throw new NewsContractError("invalid_schema", "Invalid snapshot schema");
  }
  const ticker = stringField(x.ticker);
  const security_id = stringField(x.security_id);
  const state = stringField(x.state);
  if (!ticker || !security_id || !state) {
    throw new NewsContractError("invalid_fields", "Snapshot missing required fields");
  }
  assertTicker(ticker, expectedTicker);
  if (!Array.isArray(x.rows)) throw new NewsContractError("invalid_rows", "Snapshot rows must be an array");
  const rows: StoryRow[] = [];
  for (const row of x.rows) {
    const parsed = parseStoryRow(row);
    if (!parsed) throw new NewsContractError("invalid_story_row", "Invalid story row in snapshot");
    rows.push(parsed);
  }
  const next_cursor = x.next_cursor === null ? null : nonNegativeInt(x.next_cursor);
  if (x.next_cursor !== null && next_cursor === null) {
    throw new NewsContractError("invalid_cursor", "Invalid next_cursor");
  }
  const has_more = x.has_more;
  if (typeof has_more !== "boolean") {
    throw new NewsContractError("invalid_has_more", "Invalid has_more");
  }
  if (!isRecord(x.source_health)) {
    throw new NewsContractError("invalid_source_health", "Invalid source_health");
  }
  return {
    schema: TICKER_NEWS_SNAPSHOT_SCHEMA,
    ticker,
    security_id,
    state,
    rows,
    next_cursor,
    has_more,
    source_health: { ...x.source_health },
  };
}

export function parseChanges(x: unknown, expectedTicker: string): ChangePage {
  if (!isRecord(x)) throw new NewsContractError("invalid_shape", "Changes page is not an object");
  if (x.schema !== TICKER_NEWS_CHANGES_SCHEMA) {
    throw new NewsContractError("invalid_schema", "Invalid changes schema");
  }
  const ticker = stringField(x.ticker);
  const security_id = stringField(x.security_id);
  if (!ticker || !security_id) {
    throw new NewsContractError("invalid_fields", "Changes missing required fields");
  }
  assertTicker(ticker, expectedTicker);
  if (!Array.isArray(x.rows)) throw new NewsContractError("invalid_rows", "Changes rows must be an array");
  const rows: ChangeRow[] = [];
  for (const row of x.rows) {
    const parsed = parseChangeRow(row);
    if (!parsed) throw new NewsContractError("invalid_change_row", "Invalid change row");
    rows.push(parsed);
  }
  const next_sequence = nonNegativeInt(x.next_sequence);
  if (next_sequence === null) throw new NewsContractError("invalid_sequence", "Invalid next_sequence");
  const has_more = x.has_more;
  if (typeof has_more !== "boolean") {
    throw new NewsContractError("invalid_has_more", "Invalid has_more");
  }
  return {
    schema: TICKER_NEWS_CHANGES_SCHEMA,
    ticker,
    security_id,
    rows,
    next_sequence,
    has_more,
  };
}

export function parseStory(x: unknown): StoryDetail {
  if (!isRecord(x)) throw new NewsContractError("invalid_shape", "Story is not an object");
  if (x.schema !== TICKER_NEWS_STORY_SCHEMA) {
    throw new NewsContractError("invalid_schema", "Invalid story schema");
  }
  const story_id = stringField(x.story_id);
  const source_count = positiveInt(x.source_count);
  const item_count = positiveInt(x.item_count);
  if (!story_id || source_count === null || item_count === null) {
    throw new NewsContractError("invalid_fields", "Story missing required fields");
  }
  if (!Array.isArray(x.members)) throw new NewsContractError("invalid_members", "Story members must be an array");
  const members: StoryRow[] = [];
  for (const row of x.members) {
    const parsed = parseStoryRow(row);
    if (!parsed) throw new NewsContractError("invalid_story_row", "Invalid story member row");
    members.push(parsed);
  }
  return {
    schema: TICKER_NEWS_STORY_SCHEMA,
    story_id,
    source_count,
    item_count,
    members,
  };
}

export function parseRestrictedEvent(x: unknown, expectedTicker: string): RestrictedEvent {
  if (!isRecord(x)) throw new NewsContractError("invalid_shape", "Restricted event is not an object");
  if (x.schema !== TICKER_NEWS_RESTRICTED_SCHEMA) {
    throw new NewsContractError("invalid_schema", "Invalid restricted schema");
  }
  const ticker = stringField(x.ticker);
  const detail = stringField(x.detail);
  if (!ticker || !detail) throw new NewsContractError("invalid_fields", "Restricted missing fields");
  assertTicker(ticker, expectedTicker);
  return { schema: TICKER_NEWS_RESTRICTED_SCHEMA, ticker, detail };
}

export function parseUnavailableEvent(x: unknown, expectedTicker: string): UnavailableEvent {
  if (!isRecord(x)) throw new NewsContractError("invalid_shape", "Unavailable event is not an object");
  if (x.schema !== TICKER_NEWS_UNAVAILABLE_SCHEMA) {
    throw new NewsContractError("invalid_schema", "Invalid unavailable schema");
  }
  const ticker = stringField(x.ticker);
  const detail = stringField(x.detail);
  if (!ticker || !detail) throw new NewsContractError("invalid_fields", "Unavailable missing fields");
  assertTicker(ticker, expectedTicker);
  return { schema: TICKER_NEWS_UNAVAILABLE_SCHEMA, ticker, detail };
}

/** Pure reducer: apply change rows after `watermark`, without mutating inputs. */
export function applyChanges(
  rows: StoryRow[],
  changes: ChangeRow[],
  watermark: number,
): { rows: StoryRow[]; watermark: number } {
  const out = rows.map((row) => ({ ...row }));
  let nextWatermark = watermark;
  for (const change of changes) {
    if (change.sequence <= watermark) continue;
    if (change.kind === "remove") {
      const idx = out.findIndex((r) => r.story_id === change.story_id);
      if (idx >= 0) out.splice(idx, 1);
    } else {
      const idx = out.findIndex((r) => r.story_id === change.story_id);
      if (idx >= 0) {
        const existing = out[idx]!;
        out[idx] = {
          ...existing,
          sequence: change.sequence,
          title: change.title,
          url: change.url,
          teaser: change.teaser,
          updated_at: change.observed_at,
        };
      } else {
        out.push({
          sequence: change.sequence,
          source: change.source,
          source_item_id: change.source_item_id,
          story_id: change.story_id,
          source_count: 1,
          item_count: 1,
          title: change.title,
          url: change.url,
          teaser: change.teaser,
          published_at: null,
          updated_at: change.observed_at,
          received_at: change.observed_at,
          universe_revision: change.universe_revision,
        });
      }
    }
    nextWatermark = Math.max(nextWatermark, change.sequence);
  }
  return { rows: out, watermark: nextWatermark };
}
