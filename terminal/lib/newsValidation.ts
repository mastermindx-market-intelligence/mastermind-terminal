import type { TickerNewsSourceHealth, TickerNewsStoryRow } from "@/lib/newsTypes";

export class TickerNewsContractError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`ticker_news_contract:${code}`);
    this.name = "TickerNewsContractError";
    this.code = code;
  }
}

export function asRecord(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TickerNewsContractError(code);
  }
  return value as Record<string, unknown>;
}

export function asText(
  value: unknown,
  code: string,
  max = 8192,
  allowEmpty = false,
): string {
  if (typeof value !== "string") throw new TickerNewsContractError(code);
  const out = value.trim();
  if ((!allowEmpty && !out) || out.length > max || out.includes("\0")) {
    throw new TickerNewsContractError(code);
  }
  return out;
}

export function asNonNegativeInt(value: unknown, code: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new TickerNewsContractError(code);
  }
  return Number(value);
}

export function asPositiveInt(value: unknown, code: string): number {
  const out = asNonNegativeInt(value, code);
  if (out < 1) throw new TickerNewsContractError(code);
  return out;
}

export function asBoolean(value: unknown, code: string): boolean {
  if (typeof value !== "boolean") throw new TickerNewsContractError(code);
  return value;
}

export function asTimestamp(
  value: unknown,
  code: string,
  nullable = false,
): string | null {
  if (nullable && value === null) return null;
  const out = asText(value, code, 128);
  if (!Number.isFinite(Date.parse(out))) throw new TickerNewsContractError(code);
  return out;
}

export function asHttpUrl(value: unknown, code: string): string {
  const out = asText(value, code, 8192, true);
  if (!out) return "";
  let url: URL;
  try {
    url = new URL(out);
  } catch {
    throw new TickerNewsContractError(code);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TickerNewsContractError(code);
  }
  return out;
}

export function normalizeTickerNewsSymbol(raw: string): string {
  if (typeof raw !== "string") throw new TickerNewsContractError("symbol");
  const symbol = raw.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(symbol)) {
    throw new TickerNewsContractError("symbol");
  }
  return symbol;
}

export function asStoryId(value: unknown, code = "story_id"): string {
  const out = asText(value, code, 256);
  if (!/^ev2_[A-Za-z0-9._-]{1,240}$/.test(out)) {
    throw new TickerNewsContractError(code);
  }
  return out;
}

export function parseStoryRow(value: unknown): TickerNewsStoryRow {
  const obj = asRecord(value, "row");
  return {
    sequence: asPositiveInt(obj.sequence, "row_sequence"),
    source: asText(obj.source, "row_source", 128),
    source_item_id: asText(obj.source_item_id, "row_source_item_id", 256),
    story_id: asStoryId(obj.story_id, "row_story_id"),
    source_count: asNonNegativeInt(obj.source_count, "row_source_count"),
    item_count: asPositiveInt(obj.item_count, "row_item_count"),
    title: asText(obj.title, "row_title", 4096, true),
    url: asHttpUrl(obj.url, "row_url"),
    teaser: asText(obj.teaser, "row_teaser", 65536, true),
    published_at: asTimestamp(obj.published_at, "row_published_at", true),
    updated_at: asTimestamp(obj.updated_at, "row_updated_at", true),
    received_at: asTimestamp(obj.received_at, "row_received_at")!,
    universe_revision: asText(obj.universe_revision, "row_universe_revision", 1024),
  };
}

export function parseHealth(value: unknown): TickerNewsSourceHealth {
  const obj = asRecord(value, "source_health");
  return {
    state: asText(obj.state ?? "unavailable", "source_health_state", 64),
    last_successful_catchup:
      obj.last_successful_catchup == null
        ? null
        : asTimestamp(
            obj.last_successful_catchup,
            "source_health_last_successful_catchup",
          ),
  };
}