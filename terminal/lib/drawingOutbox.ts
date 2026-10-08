import {
  MAX_DRAWINGS_PER_SYMBOL,
  normalizeDrawings,
  type Drawing,
} from "@/lib/drawings";
import { parsePersistedDrawings, validDrawingRevision, validDrawingOperationId, type DrawingJournal } from "@/lib/drawingPersistence";

const DRAWING_OUTBOX_KEY = "mm.drawing.account-outbox.v1";

export type DrawingOutbox = Record<string, Drawing[]>;
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type StoredEnvelope = Record<string, Record<string, unknown>>;

function accountOwner(owner: string): boolean {
  return owner.startsWith("account:") && owner.length > "account:".length;
}

function readEnvelope(storage: StoragePort): StoredEnvelope {
  try {
    const value = JSON.parse(storage.getItem(DRAWING_OUTBOX_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as StoredEnvelope
      : {};
  } catch {
    return {};
  }
}

/** Account-scoped recovery snapshots are never exposed to another identity. */
export function readDrawingOutbox(storage: StoragePort, owner: string): DrawingOutbox {
  if (!accountOwner(owner)) return {};
  const stored = readEnvelope(storage)[owner];
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const outbox: DrawingOutbox = {};
  for (const [symbol, value] of Object.entries(stored)) {
    if (!Array.isArray(value) || value.length > MAX_DRAWINGS_PER_SYMBOL) continue;
    const normalized = normalizeDrawings(value).filter((drawing) => drawing.source === "user");
    if (normalized.length === value.length) outbox[symbol] = normalized;
  }
  return outbox;
}

/** Replace one owner's durable recovery namespace without touching other accounts. */
export function writeDrawingOutbox(storage: StoragePort, owner: string, outbox: DrawingOutbox): boolean {
  if (!accountOwner(owner)) return false;
  try {
    const envelope = readEnvelope(storage);
    const valid: DrawingOutbox = {};
    for (const [symbol, drawings] of Object.entries(outbox)) {
      // [] is a meaningful replace-all tombstone: omitting it can resurrect a
      // server drawing that the user cleared immediately before signing out.
      if (drawings.length > MAX_DRAWINGS_PER_SYMBOL) continue;
      valid[symbol] = drawings;
    }
    if (Object.keys(valid).length) envelope[owner] = valid;
    else delete envelope[owner];
    if (Object.keys(envelope).length) storage.setItem(DRAWING_OUTBOX_KEY, JSON.stringify(envelope));
    else storage.removeItem(DRAWING_OUTBOX_KEY);
    return true;
  } catch {
    // The in-memory owner outbox remains authoritative when browser storage is
    // unavailable or full; callers can retry it during the same app lifetime.
    return false;
  }
}

export { DRAWING_OUTBOX_KEY };

/** The existing namespace also holds versioned attempts; old arrays remain explicit recovery work. */
export function readDrawingJournal(storage: StoragePort, owner: string): DrawingJournal {
  if (!accountOwner(owner)) return {};
  const stored = readEnvelope(storage)[owner];
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const journal: DrawingJournal = {};
  for (const [symbol, value] of Object.entries(stored)) {
    if (Array.isArray(value)) {
      const drawings = parsePersistedDrawings(value, false);
      if (drawings) journal[symbol] = { drawings: normalizeDrawings(drawings), blocked: "legacy" };
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const raw = value as Record<string, unknown>;
    const drawings = parsePersistedDrawings(raw.drawings);
    if (!drawings) continue;
    const entry: DrawingJournal[string] = { drawings };
    if (Object.hasOwn(raw, "revision") && validDrawingRevision(raw.revision)) entry.revision = raw.revision;
    if (["legacy", "conflict", "superseded", "invalid"].includes(String(raw.blocked))) entry.blocked = raw.blocked as typeof entry.blocked;
    if (raw.attempt && typeof raw.attempt === "object") {
      const attempt = raw.attempt as Record<string, unknown>;
      const attemptedDrawings = parsePersistedDrawings(attempt.drawings);
      if (attemptedDrawings && validDrawingOperationId(attempt.operationId) && validDrawingRevision(attempt.expectedRevision)) {
        entry.attempt = { operationId: attempt.operationId, expectedRevision: attempt.expectedRevision, drawings: attemptedDrawings };
      } else entry.blocked = "invalid";
    }
    if (!Object.hasOwn(entry, "revision") && !entry.attempt) entry.blocked ??= "legacy";
    journal[symbol] = entry;
  }
  return journal;
}

export function writeDrawingJournal(storage: StoragePort, owner: string, journal: DrawingJournal): boolean {
  if (!accountOwner(owner)) return false;
  try {
    const envelope = readEnvelope(storage);
    if (Object.keys(journal).length) envelope[owner] = journal;
    else delete envelope[owner];
    if (Object.keys(envelope).length) storage.setItem(DRAWING_OUTBOX_KEY, JSON.stringify(envelope));
    else storage.removeItem(DRAWING_OUTBOX_KEY);
    return true;
  } catch { return false; }
}
