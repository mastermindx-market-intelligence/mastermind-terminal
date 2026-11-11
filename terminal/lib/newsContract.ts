import type {
  TickerNewsChange,
  TickerNewsChangeKind,
  TickerNewsEditorialView,
  TickerNewsSnapshot,
  TickerNewsState,
  TickerNewsStory,
} from "@/lib/newsTypes";
import { parseRightsBasis, parseUniverseKnownAt } from "@/lib/newsProvenance";
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
  parseReportingState,
  parseContentKind,
  parseEditorial,
  parseEditorialView,
  normalizeTickerNewsView,
  requireSameEditorialView,
  parseStoryRow,
  parseTickerNewsFlow,
} from "@/lib/newsValidation";

export type * from "@/lib/newsTypes";
export { TickerNewsContractError, normalizeTickerNewsSymbol, normalizeTickerNewsView, parseEditorialView, requireSameEditorialView };


/** Forward only the closed, version-bound editorial query contract. */
export function tickerNewsViewQuery(params: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const key of ["view", "view_revision"]) {
    if (params.getAll(key).length > 1) throw new TickerNewsContractError("editorial_query");
  }
  const mode = params.get("view");
  const revision = params.get("view_revision");
  if (mode !== null) out.set("view", normalizeTickerNewsView(mode));
  if (revision !== null) {
    if (mode === null || !/^[0-9a-f]{64}$/.test(revision)) throw new TickerNewsContractError("editorial_view_revision");
    out.set("view_revision", revision);
  }
  return out;
}

/** A selected reader view must be acknowledged before its payload leaves the proxy. */
export function requireRequestedEditorialView(
  query: URLSearchParams, actual: TickerNewsEditorialView | undefined,
): void {
  const mode = query.get("view");
  const revision = query.get("view_revision");
  if ((mode !== null && actual?.mode !== mode) ||
      (revision !== null && actual?.revision !== revision)) {
    throw new TickerNewsContractError("editorial_view_mismatch");
  }
}

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
  const editorialView = parseEditorialView(obj.editorial_view);
  const rows = obj.rows.map(parseStoryRow);
  for (const row of rows) requireSameEditorialView(editorialView, row.editorial_view);
  let flow = "flow" in obj ? parseTickerNewsFlow(obj.flow) : null;
  if (editorialView && flow && flow.state !== "unavailable") {
    try { requireSameEditorialView(editorialView, flow.provenance?.editorial_view); }
    catch { flow = null; } // An inconsistent flow must never describe these rows.
  }
  return {
    schema: "ticker_news.snapshot.v1",
    editorial_view: editorialView,
    change_sequence: obj.change_sequence === undefined ? undefined : asNonNegativeInt(obj.change_sequence, "change_sequence"),
    editorial_policy: obj.editorial_policy === undefined ? undefined
      : asText(obj.editorial_policy, "editorial_policy", 128),
    ticker: normalizeTickerNewsSymbol(asText(obj.ticker, "snapshot_ticker", 32)),
    security_id: asText(obj.security_id, "snapshot_security_id", 1024),
    universe_known_at: parseUniverseKnownAt(obj.universe_known_at),
    rights_basis: parseRightsBasis(obj.rights_basis),
    state,
    rows,
    next_cursor: nextCursor,
    has_more: asBoolean(obj.has_more, "snapshot_has_more"),
    source_health: parseHealth(obj.source_health),
    // Wave B: an absent flow key (old API, or a cursor page) is null; a present key
    // parses to a flow or the terminal-only MALFORMED flow — never a snapshot throw.
    flow,
  };
}

type ChangeProjection = Pick<TickerNewsChange,
  "source_count" | "item_count" | "published_at" | "updated_at" | "received_at">;

function parseChangeProjection(obj: Record<string, unknown>, kind: TickerNewsChangeKind): ChangeProjection {
  const projection: ChangeProjection = {};
  for (const key of ["source_count", "item_count"] as const) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const value = obj[key];
    projection[key] = value === null && kind === "remove" ? null
      : key === "item_count" && kind === "upsert"
        ? asPositiveInt(value, "change_" + key)
        : asNonNegativeInt(value, "change_" + key);
  }
  if (typeof projection.source_count === "number" && typeof projection.item_count === "number" &&
      projection.source_count > projection.item_count) {
    throw new TickerNewsContractError("change_source_count");
  }
  for (const key of ["published_at", "updated_at", "received_at"] as const) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    projection[key] = asTimestamp(obj[key], "change_" + key, key !== "received_at" || kind === "remove");
  }
  return projection;
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
    reporting_state: parseReportingState(obj.reporting_state),
    content_kind: parseContentKind(obj.content_kind),
    editorial_view: parseEditorialView(obj.editorial_view),
    editorial: parseEditorial(obj.editorial),
    ...parseChangeProjection(obj, kind),
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
  const editorialView = parseEditorialView(obj.editorial_view);
  for (const member of members) requireSameEditorialView(editorialView, member.editorial_view);
  if (members.some((member) => member.story_id !== id)) {
    throw new TickerNewsContractError("story_member_id");
  }
  const sourceCount = asNonNegativeInt(obj.source_count, "story_source_count");
  const itemCount = asNonNegativeInt(obj.item_count, "story_item_count");
  if (itemCount !== members.length) {
    throw new TickerNewsContractError("story_item_count");
  }
  if (sourceCount > itemCount) throw new TickerNewsContractError("story_source_count");
  return {
    schema: "ticker_news.story.v1",
    story_id: id,
    source_count: sourceCount,
    item_count: itemCount,
    members,
    reporting_state: parseReportingState(obj.reporting_state),
    content_kind: parseContentKind(obj.content_kind),
    editorial_view: parseEditorialView(obj.editorial_view),
    editorial: parseEditorial(obj.editorial),
  };
}