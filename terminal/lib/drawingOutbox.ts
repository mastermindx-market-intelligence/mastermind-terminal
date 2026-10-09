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

type Entry = DrawingJournal[string];
type Copies = Record<string, Entry>;
type JournalBaseline = Record<string, { active: string; hashes: Record<string, string> }>;
const baselines = new WeakMap<DrawingJournal, JournalBaseline>();
export type DrawingJournalLocks = Pick<LockManager, "request">;

function parseEntry(value: unknown): Entry | null {
  if (Array.isArray(value)) {
    const drawings = parsePersistedDrawings(value, false);
    return drawings ? { drawings: normalizeDrawings(drawings), blocked: "legacy" } : null;
  }
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const drawings = parsePersistedDrawings(raw.drawings);
  if (!drawings) return null;
  const entry: Entry = { drawings };
  if (Object.hasOwn(raw, "revision") && validDrawingRevision(raw.revision)) entry.revision = raw.revision;
  if (["legacy", "conflict", "superseded", "invalid"].includes(String(raw.blocked))) entry.blocked = raw.blocked as Entry["blocked"];
  if (raw.attempt && typeof raw.attempt === "object") {
    const attempt = raw.attempt as Record<string, unknown>;
    const attemptedDrawings = parsePersistedDrawings(attempt.drawings);
    if (attemptedDrawings && validDrawingOperationId(attempt.operationId) && validDrawingRevision(attempt.expectedRevision)) {
      entry.attempt = { operationId: attempt.operationId, expectedRevision: attempt.expectedRevision, drawings: attemptedDrawings };
    } else entry.blocked = "invalid";
  }
  if (!Object.hasOwn(entry, "revision") && !entry.attempt) entry.blocked ??= "legacy";
  return entry;
}
function storedEntry(entry: Entry): Entry {
  const { recoveryId: _id, alternatives: _alternatives, ...payload } = entry;
  return payload;
}
function fingerprint(entry: Entry): string {
  // parseEntry rebuilds the envelope fields in a fixed order. Compare semantic
  // envelope fields without rewriting the attempted drawing JSON itself.
  return JSON.stringify([
    entry.drawings, Object.hasOwn(entry, "revision"), entry.revision ?? null,
    entry.blocked ?? null,
    entry.attempt ? [entry.attempt.operationId, entry.attempt.expectedRevision, entry.attempt.drawings] : null,
  ]);
}
function readCopies(value: unknown): Copies {
  if (value && typeof value === "object" && !Array.isArray(value)
      && (value as Record<string, unknown>).format === 2) {
    const copies = (value as Record<string, unknown>).copies;
    if (!copies || typeof copies !== "object" || Array.isArray(copies)) return {};
    return Object.fromEntries(Object.entries(copies).flatMap(([id, raw]) => {
      const entry = parseEntry(raw);
      return entry && (id === "legacy" || validDrawingOperationId(id)) ? [[id, entry]] : [];
    }));
  }
  const entry = parseEntry(value);
  return entry ? { legacy: entry } : {};
}

/** Read competing copies independently; no GET can silently choose or rebase one. */
export function readDrawingJournal(storage: StoragePort, owner: string): DrawingJournal {
  const journal: DrawingJournal = {};
  const baseline: JournalBaseline = {};
  if (accountOwner(owner)) {
    const stored = readEnvelope(storage)[owner];
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      for (const [symbol, value] of Object.entries(stored)) {
        const copies = readCopies(value);
        const ids = Object.keys(copies).sort();
        if (!ids.length) continue;
        const entries = ids.map((id) => ({ ...copies[id], recoveryId: id }));
        journal[symbol] = entries[0];
        if (entries.length > 1) journal[symbol].alternatives = entries.slice(1);
        baseline[symbol] = { active: ids[0], hashes: Object.fromEntries(ids.map((id) => [id, fingerprint(copies[id])])) };
      }
    }
  }
  baselines.set(journal, baseline);
  return journal;
}

/**
 * Web Locks serialize the entire existing envelope across tabs and accounts.
 * A stale writer forks its selected copy; an acknowledgement removes only the
 * selected unchanged copy. Browser-storage failure never reports durability.
 */
export async function writeDrawingJournal(
  storage: StoragePort, owner: string, journal: DrawingJournal,
  locks: DrawingJournalLocks | null = typeof navigator !== "undefined" ? navigator.locks ?? null : null,
): Promise<boolean> {
  if (!accountOwner(owner) || !locks) return false;
  try {
    return await locks.request(DRAWING_OUTBOX_KEY, () => {
      const raw = JSON.parse(storage.getItem(DRAWING_OUTBOX_KEY) || "{}");
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid recovery envelope");
      const envelope = raw as StoredEnvelope;
      if (envelope[owner] && (typeof envelope[owner] !== "object" || Array.isArray(envelope[owner]))) throw new Error("Invalid recovery owner");
      const namespace = { ...(envelope[owner] ?? {}) };
      const previous = baselines.get(journal) ?? {};
      const next: JournalBaseline = {};
      const updates: Array<[Entry, string]> = [];
      for (const symbol of new Set([...Object.keys(previous), ...Object.keys(journal)])) {
        const copies = readCopies(namespace[symbol]);
        const stored = namespace[symbol] as { format?: number; copies?: Record<string, unknown> } | undefined;
        if (stored !== undefined && (!Object.keys(copies).length
          || (stored?.format === 2 && Object.keys(stored.copies ?? {}).length !== Object.keys(copies).length))) {
          throw new Error("Invalid recovery copy; preserve the stored bytes");
        }
        const entry = journal[symbol];
        const base = previous[symbol];
        if (!entry) {
          if (base && copies[base.active] && fingerprint(copies[base.active]) === base.hashes[base.active]) delete copies[base.active];
        } else {
          let id = entry.recoveryId;
          const unchanged = id && copies[id] && base?.hashes[id] === fingerprint(copies[id]);
          if (!unchanged) id = crypto.randomUUID();
          copies[id!] = storedEntry(entry);
          updates.push([entry, id!]);
          next[symbol] = { active: id!, hashes: { ...base?.hashes, [id!]: fingerprint(entry) } };
        }
        if (Object.keys(copies).length) namespace[symbol] = { format: 2, copies };
        else delete namespace[symbol];
      }
      if (Object.keys(namespace).length) envelope[owner] = namespace;
      else delete envelope[owner];
      if (Object.keys(envelope).length) storage.setItem(DRAWING_OUTBOX_KEY, JSON.stringify(envelope));
      else storage.removeItem(DRAWING_OUTBOX_KEY);
      // Change the in-memory baseline only after the actual durable write.
      updates.forEach(([entry, id]) => { entry.recoveryId = id; });
      baselines.set(journal, next);
      return true;
    });
  } catch { return false; }
}

/** Reconcile only a completed/discarded symbol without disturbing live edits. */
export function refreshDrawingJournalSymbol(storage: StoragePort, owner: string, journal: DrawingJournal, symbol: string): Entry | undefined {
  const fresh = readDrawingJournal(storage, owner);
  const baseline = baselines.get(journal) ?? {};
  if (fresh[symbol]) {
    journal[symbol] = fresh[symbol];
    baseline[symbol] = baselines.get(fresh)![symbol];
  } else {
    delete journal[symbol]; delete baseline[symbol];
  }
  baselines.set(journal, baseline);
  return journal[symbol];
}

export function selectDrawingRecoveryCopy(journal: DrawingJournal, symbol: string, id: string): Entry | undefined {
  const current = journal[symbol];
  if (!current) return;
  const copies = [current, ...(current.alternatives ?? [])];
  const selected = copies.find((copy) => copy.recoveryId === id);
  if (!selected) return;
  const entry = { ...selected };
  entry.alternatives = copies.filter((copy) => copy.recoveryId !== id).map(({ alternatives: _alternatives, ...copy }) => copy);
  journal[symbol] = entry;
  return entry;
}
