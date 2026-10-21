import { normalizeDrawings, MAX_DRAWINGS_PER_SYMBOL, type Drawing } from "@/lib/drawings";
import { drawingToolAcceptsPersistedPointCount } from "@/lib/drawingTools";

/**
 * Request header that carries the page's owner key (`account:<auth uuid>`) on a drawings read.
 * Never a query parameter: owner identity must not land in URLs, proxy logs or the edge cache key.
 */
export const DRAWING_OWNER_HEADER = "x-drawing-owner";

export type DrawingRevision = string | null;
export type DrawingSnapshot = { drawings: Drawing[]; revision: DrawingRevision; schemaVersion: 1 };
export type DrawingAttempt = { operationId: string; expectedRevision: DrawingRevision; drawings: Drawing[] };
export type DrawingJournalEntry = {
  drawings: Drawing[];
  recoveryId?: string;
  alternatives?: DrawingJournalEntry[];
  // Absence means that the old outbox never observed a cloud revision.
  revision?: DrawingRevision;
  attempt?: DrawingAttempt;
  blocked?: "legacy" | "conflict" | "superseded" | "invalid";
  conflictCode?: "revision_conflict" | "owner_conflict" | "operation_payload_mismatch" | "unknown";
  operationUnknownPossible?: true;
  // In-pane edit made before the drawings GET observed a revision. Not a leftover copy.
  preload?: true;
};
export type DrawingJournal = Record<string, DrawingJournalEntry>;
export type DrawingSaveReceipt = {
  ok: true; operationId: string; revision: string; idempotentReplay: boolean; superseded: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validDrawingOperationId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
export const validDrawingRevision = (value: unknown): value is DrawingRevision => value === null
  || (typeof value === "string" && (UUID.test(value) || /^legacy:[0-9a-f]{64}$/.test(value)));

/** Validate before normalizing: normalization must not drop an invalid anchor or invent an ID. */
export function parsePersistedDrawings(value: unknown, canonical = true): Drawing[] | null {
  if (!Array.isArray(value) || value.length > MAX_DRAWINGS_PER_SYMBOL) return null;
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)
      || typeof candidate.id !== "string" || !candidate.id.trim() || ids.has(candidate.id.trim())
      || (canonical && (candidate.source !== "user" || candidate.schemaVersion !== 1))
      || !Array.isArray(candidate.points)
      || !drawingToolAcceptsPersistedPointCount(candidate.kind, candidate.points.length)) return null;
    ids.add(candidate.id.trim());
    for (const point of candidate.points) {
      if (!point || typeof point !== "object" || !Number.isFinite(point.p)
        || !(typeof point.t === "string" || (typeof point.t === "number" && Number.isFinite(point.t)))
        || !String(point.t).trim()) return null;
    }
  }
  const normalized = normalizeDrawings(value);
  if (normalized.length !== value.length || normalized.some((drawing) => drawing.source !== "user")) return null;
  // Retain the exact attempted JSON. Changing it on reload changes the operation's payload hash.
  return value as Drawing[];
}

export function parseDrawingSnapshot(value: unknown): DrawingSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const drawings = parsePersistedDrawings(raw.drawings);
  if (!drawings || raw.schemaVersion !== 1 || !validDrawingRevision(raw.revision)
    || (raw.revision === null && drawings.length !== 0)) return null;
  return { drawings, revision: raw.revision, schemaVersion: 1 };
}

export function parseDrawingSaveReceipt(value: unknown, attempt: DrawingAttempt): DrawingSaveReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.ok !== true || raw.operationId !== attempt.operationId
    || !validDrawingOperationId(raw.revision)
    || typeof raw.idempotentReplay !== "boolean" || typeof raw.superseded !== "boolean"
    || (raw.superseded && !raw.idempotentReplay)) return null;
  return raw as DrawingSaveReceipt;
}

/** Retrying an unknown outcome always returns the same operation and exact snapshot. */
export function prepareDrawingAttempt(entry: DrawingJournalEntry, operationId: () => string): DrawingAttempt | null {
  if (entry.blocked || entry.alternatives?.length) return null;
  if (entry.attempt) return entry.attempt;
  if (!Object.hasOwn(entry, "revision") || !validDrawingRevision(entry.revision)) {
    if (!entry.preload) entry.blocked = "legacy";
    return null;
  }
  entry.attempt = {
    operationId: operationId(), expectedRevision: entry.revision,
    drawings: JSON.parse(JSON.stringify(entry.drawings)) as Drawing[],
  };
  return entry.attempt;
}

/** A superseded replay cannot authorize queued edits against another tab's newer revision. */
export function settleDrawingAttempt(entry: DrawingJournalEntry, receipt: DrawingSaveReceipt): "saved" | "queued" | "blocked" {
  if (!entry.attempt || entry.attempt.operationId !== receipt.operationId) return "blocked";
  if (receipt.superseded) { entry.blocked = "superseded"; return "blocked"; }
  const savedLatest = JSON.stringify(entry.drawings) === JSON.stringify(entry.attempt.drawings);
  entry.revision = receipt.revision;
  delete entry.attempt;
  return savedLatest ? "saved" : "queued";
}

/** Monotonic per-symbol token for in-flight drawing GETs. */
export type DrawingLoadGenerations = Record<string, number>;

export function beginDrawingLoad(generations: DrawingLoadGenerations, symbol: string): number {
  const next = (generations[symbol] ?? 0) + 1;
  generations[symbol] = next;
  return next;
}

export function abandonDrawingLoad(generations: DrawingLoadGenerations, symbol: string): void {
  generations[symbol] = (generations[symbol] ?? 0) + 1;
}

export function abandonAllDrawingLoads(generations: DrawingLoadGenerations): void {
  for (const symbol of Object.keys(generations)) generations[symbol] += 1;
}

export function isCurrentDrawingLoad(
  generations: DrawingLoadGenerations,
  symbol: string,
  generation: number,
): boolean {
  return generations[symbol] === generation;
}

/** Recovery GET for Review cloud: ignore a late 200 after leave, owner change, or a newer load. */
export function shouldApplyDrawingCloudCopy(input: {
  generations: DrawingLoadGenerations;
  symbol: string;
  startedGeneration: number;
  ownerEpoch: number;
  currentOwnerEpoch: number;
  symbolStillOpen: boolean;
}): boolean {
  if (!input.symbolStillOpen) return false;
  if (input.ownerEpoch !== input.currentOwnerEpoch) return false;
  return (input.generations[input.symbol] ?? 0) === input.startedGeneration;
}

/** After a save settles, a newer local edit must not sit without a flush timer. */
export function shouldRescheduleDrawingFlush(input: {
  hasPending: boolean;
  timerArmed: boolean;
  saveSettledOk: boolean;
}): boolean {
  if (input.timerArmed) return false;
  return input.saveSettledOk && input.hasPending;
}

export type DrawingLoadReconciliation = {
  cloudIds: readonly string[];
  cloudRevision: DrawingRevision;
  hasPending: boolean;
  pendingIds: readonly string[];
  pendingRevisionPresent: boolean;
  pendingRevision?: DrawingRevision;
  pendingBlocked?: DrawingJournalEntry["blocked"];
  pendingHasAlternatives?: boolean;
  pendingPreload?: boolean;
  /** The entry holds an operation whose flush is scheduled or in flight. */
  pendingAttemptQueued?: boolean;
  cloudDrawings?: readonly Drawing[];
  pendingDrawings?: readonly Drawing[];
};

export type DrawingLoadParkReason = "preload" | "overlap" | "conflict" | "too_many";
export type DrawingLoadDecision =
  | { action: "stamp" }
  | { action: "keep" }
  | { action: "merge" }
  | { action: "defer" }
  | { action: "park"; reason: DrawingLoadParkReason };
export type DrawingPreloadUnion =
  | { ok: true; drawings: Drawing[] }
  | { ok: false; reason: "overlap" | "too_many" };

function drawingStoredEqual(a: Drawing, b: Drawing): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Drop preload pending drawings that are already in the cloud with the same stored fields. */
export function remainingPreloadPending(cloud: readonly Drawing[], pending: readonly Drawing[]): Drawing[] {
  const byId = new Map(cloud.map((drawing) => [drawing.id, drawing]));
  return pending.filter((drawing) => {
    const existing = byId.get(drawing.id);
    return !existing || !drawingStoredEqual(existing, drawing);
  });
}

/** Decide how a settled drawings GET should combine with in-pane pending work. */
export function decideDrawingLoadReconciliation(input: DrawingLoadReconciliation): DrawingLoadDecision {
  if (input.pendingBlocked || input.pendingHasAlternatives) return { action: "park", reason: "conflict" };
  // The queued operation's receipt (saved, superseded) or 409 is the authority for
  // this symbol. Parking it first would withhold an exact replay that may already
  // have committed. A revision-less entry is a pre-load row: its flush waits for
  // this GET instead of sending, so it cannot settle the symbol.
  if (input.pendingAttemptQueued && input.pendingRevisionPresent) return { action: "defer" };
  if (!input.hasPending) return { action: "stamp" };
  if (input.pendingRevisionPresent) {
    return input.pendingRevision === input.cloudRevision
      ? { action: "keep" }
      : { action: "park", reason: "conflict" };
  }
  if (input.pendingIds.length === 0) return { action: "stamp" };
  if (!input.pendingPreload) return { action: "park", reason: "conflict" };
  const pendingIds = input.cloudDrawings && input.pendingDrawings
    ? remainingPreloadPending(input.cloudDrawings, input.pendingDrawings).map((drawing) => drawing.id)
    : input.pendingIds;
  if (pendingIds.length === 0) return { action: "stamp" };
  const cloud = new Set(input.cloudIds);
  if (pendingIds.some((id) => cloud.has(id))) return { action: "park", reason: "overlap" };
  if (input.cloudIds.length + pendingIds.length > MAX_DRAWINGS_PER_SYMBOL) {
    return { action: "park", reason: "too_many" };
  }
  return { action: "merge" };
}

/** Cloud drawings plus disjoint pre-load additions. Overlap or a cap overflow cannot merge. */
export function unionCloudWithPreloadAdditions(cloud: Drawing[], pending: Drawing[]): DrawingPreloadUnion {
  const ids = new Set(cloud.map((drawing) => drawing.id));
  for (const drawing of pending) {
    if (ids.has(drawing.id)) return { ok: false, reason: "overlap" };
  }
  if (cloud.length + pending.length > MAX_DRAWINGS_PER_SYMBOL) return { ok: false, reason: "too_many" };
  return { ok: true, drawings: [...cloud, ...pending] };
}

/** Cloud ∪ pending with pending overriding same-id drawings. Preload pending is additions, not a snapshot. */
export function unionCloudWithPreloadKeepMine(cloud: Drawing[], pending: Drawing[]): DrawingPreloadUnion {
  const byId = new Map(cloud.map((drawing) => [drawing.id, drawing]));
  const extra: Drawing[] = [];
  for (const drawing of pending) {
    if (byId.has(drawing.id)) byId.set(drawing.id, drawing);
    else extra.push(drawing);
  }
  const drawings = [...byId.values(), ...extra];
  if (drawings.length > MAX_DRAWINGS_PER_SYMBOL) return { ok: false, reason: "too_many" };
  return { ok: true, drawings };
}

/** PUT set for "Replace cloud with local copy". Non-preload rows stay a full-snapshot replace. */
export function keepMinePutDrawings(
  cloud: Drawing[],
  pending: Drawing[],
  preload: boolean,
): DrawingPreloadUnion {
  if (!preload) {
    if (pending.length > MAX_DRAWINGS_PER_SYMBOL) return { ok: false, reason: "too_many" };
    return { ok: true, drawings: pending };
  }
  return unionCloudWithPreloadKeepMine(cloud, pending);
}

/**
 * A preload-merge PUT that lost revision_conflict can settle as saved after one
 * cloud re-read finds every pending drawing present and deep-equal, unless an
 * edit followed the attempt: settling would drop that newer edit.
 * owner_conflict / unknown / payload_mismatch stay conflict.
 */
export function settlePreloadMergeRevisionConflict(input: {
  wasPreloadMerge: boolean;
  conflictCode: unknown;
  pending: readonly Drawing[];
  /** The journal entry's drawings now, compared as settleDrawingAttempt does. */
  latest: readonly Drawing[];
  cloud: readonly Drawing[] | null;
}): "saved" | "conflict" {
  if (!input.wasPreloadMerge || input.conflictCode !== "revision_conflict" || !input.cloud) {
    return "conflict";
  }
  if (JSON.stringify(input.latest) !== JSON.stringify(input.pending)) return "conflict";
  const byId = new Map(input.cloud.map((drawing) => [drawing.id, drawing]));
  const saved = input.pending.every((drawing) => {
    const existing = byId.get(drawing.id);
    return existing !== undefined && drawingStoredEqual(existing, drawing);
  });
  return saved ? "saved" : "conflict";
}
