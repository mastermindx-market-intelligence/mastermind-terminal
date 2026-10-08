import { normalizeDrawings, MAX_DRAWINGS_PER_SYMBOL, type Drawing } from "@/lib/drawings";
import { drawingToolAcceptsPersistedPointCount } from "@/lib/drawingTools";

export type DrawingRevision = string | null;
export type DrawingSnapshot = { drawings: Drawing[]; revision: DrawingRevision; schemaVersion: 1 };
export type DrawingAttempt = { operationId: string; expectedRevision: DrawingRevision; drawings: Drawing[] };
export type DrawingJournalEntry = {
  drawings: Drawing[];
  // Absence means that the old outbox never observed a cloud revision.
  revision?: DrawingRevision;
  attempt?: DrawingAttempt;
  blocked?: "legacy" | "conflict" | "superseded" | "invalid";
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
  if (entry.blocked) return null;
  if (entry.attempt) return entry.attempt;
  if (!Object.hasOwn(entry, "revision") || !validDrawingRevision(entry.revision)) {
    entry.blocked = "legacy";
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
