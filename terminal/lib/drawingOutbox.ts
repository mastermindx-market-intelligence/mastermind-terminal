import {
  MAX_DRAWINGS_PER_SYMBOL,
  normalizeDrawings,
  type Drawing,
} from "@/lib/drawings";
import { parsePersistedDrawings, validDrawingRevision, validDrawingOperationId, type DrawingJournal } from "@/lib/drawingPersistence";

const DRAWING_OUTBOX_KEY = "mm.drawing.account-outbox.v1";
// An already-open legacy client replaces the entire v1 owner without Web Locks.
// Keep this generation's recovery bytes outside its write authority. v1 remains
// an import source, never a second cloud store and never rewritten by this client.
export const DRAWING_JOURNAL_KEY = "mm.drawing.account-outbox.v2";
// A copy is retired only by a positive acknowledgement recorded here. A cleared
// or evicted journal removes copies without acknowledging them, so a missing
// copy alone never discards another tab's unsaved memory or exact retry.
export const DRAWING_RECEIPTS_KEY = "mm.drawing.retired-copies.v1";
/**
 * Acknowledged copy IDs kept per owner, matching the server's 32 prior
 * operations. An older acknowledgement is forgotten: a stale tab's copy is
 * then kept again, but only for review. It never saves by itself, because the
 * missing receipt cannot prove whether an explicit discard removed it.
 */
export const DRAWING_RECEIPT_HISTORY = 32;
/** Account namespaces kept in the receipt store; the least recent is dropped first. */
export const DRAWING_RECEIPT_OWNERS = 8;

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

type LegacyLink = { sourceId: string; token: string };
type JournalRecord = { format: 2; copies: Copies; legacySeen: Record<string, string>; legacyLinks: Record<string, LegacyLink> };
type JournalNamespace = Record<string, JournalRecord>;
type LegacyImports = Record<string, Copies>;
const journalNamespaces = new WeakMap<DrawingJournal, JournalNamespace>();
/** Unreadable receipts read as none: the fail-safe direction keeps copies. */
function readRetiredCopies(storage: StoragePort, owner: string): string[] {
  try {
    const raw: unknown = JSON.parse(storage.getItem(DRAWING_RECEIPTS_KEY) || "{}");
    const ids = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>)[owner] : undefined;
    return Array.isArray(ids) ? ids.filter(validDrawingOperationId).slice(-DRAWING_RECEIPT_HISTORY) : [];
  } catch { return []; }
}
/** Unreadable receipt bytes are set aside here once, never silently overwritten. */
export const DRAWING_RECEIPTS_UNREADABLE_KEY = `${DRAWING_RECEIPTS_KEY}.unreadable`;
function writeRetiredCopies(storage: StoragePort, owner: string, ids: string[]): void {
  let envelope: Record<string, unknown> = {};
  const stored = storage.getItem(DRAWING_RECEIPTS_KEY);
  let readable = false;
  try {
    const raw: unknown = JSON.parse(stored || "{}");
    if (raw && typeof raw === "object" && !Array.isArray(raw)) { envelope = raw as Record<string, unknown>; readable = true; }
  } catch { /* Kept below for inspection; rebuilding keeps copies rather than dropping them. */ }
  // Keep other accounts' unreadable receipts recoverable instead of erasing them.
  if (!readable && stored !== null && storage.getItem(DRAWING_RECEIPTS_UNREADABLE_KEY) === null) storage.setItem(DRAWING_RECEIPTS_UNREADABLE_KEY, stored);
  // Re-insert this owner last so the bound drops the least recently used account.
  delete envelope[owner];
  envelope[owner] = ids.slice(-DRAWING_RECEIPT_HISTORY);
  const owners = Object.keys(envelope);
  for (const stale of owners.slice(0, Math.max(0, owners.length - DRAWING_RECEIPT_OWNERS))) delete envelope[stale];
  storage.setItem(DRAWING_RECEIPTS_KEY, JSON.stringify(envelope));
}
function resolveLegacyAlias(record: JournalRecord, alias: string | undefined, token: string | undefined, retired: ReadonlySet<string>): { id: string; retired: boolean } | undefined {
  if (!alias || !token) return;
  // A UUID with a local observed preimage was genuinely durable, whether
  // imported or created here. Its absence retires unchanged memory only with
  // a receipt (or import link) that an acknowledgement removed it, even when
  // that acknowledgement removed the namespace; memory forks are not UUIDs.
  if (!alias.startsWith("legacy:")) {
    if (validDrawingOperationId(alias) && !record.copies[alias]
      && (retired.has(alias) || Object.hasOwn(record.legacyLinks, alias))) return { id: alias, retired: true };
    return;
  }
  const sourceId = alias.slice("legacy:".length);
  const matches = Object.entries(record.legacyLinks).filter(([, link]) => link.sourceId === sourceId && link.token === token);
  const retained = matches.find(([id]) => record.copies[id]);
  if (retained) return { id: retained[0], retired: false };
  if (matches.length) return { id: matches[0][0], retired: true };
  // Compatibility with the earlier, never-released v2 candidate: adopt only
  // one exact physical preimage, never choose among ambiguous copies.
  if (record.legacySeen[sourceId] === token) {
    const exact = Object.entries(record.copies).filter(([, copy]) => fingerprint(copy) === token);
    if (exact.length === 1) return { id: exact[0][0], retired: false };
  }
}
function strictEnvelope(storage: StoragePort, key: string): StoredEnvelope {
  const raw = JSON.parse(storage.getItem(key) || "{}");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid recovery envelope");
  return raw as StoredEnvelope;
}
function ownerNamespace(envelope: StoredEnvelope, owner: string): Record<string, unknown> {
  const raw = envelope[owner];
  if (raw && (typeof raw !== "object" || Array.isArray(raw))) throw new Error("Invalid recovery owner");
  return raw ?? {};
}
function journalState(storage: StoragePort, owner: string, allowUnreadableLegacy = false): { envelope: StoredEnvelope; namespace: JournalNamespace; imports: LegacyImports } {
  const envelope = strictEnvelope(storage, DRAWING_JOURNAL_KEY);
  const namespace: JournalNamespace = {};
  for (const [symbol, raw] of Object.entries(ownerNamespace(envelope, owner))) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid recovery record");
    const record = raw as { format?: number; copies?: unknown; legacySeen?: unknown; legacyLinks?: unknown };
    if (record.format !== 2 || !record.copies || typeof record.copies !== "object" || Array.isArray(record.copies)) throw new Error("Invalid recovery copies");
    const copies = readCopies(raw);
    if (Object.keys(record.copies).length !== Object.keys(copies).length) throw new Error("Invalid recovery copy; preserve stored bytes");
    const seen = record.legacySeen ?? {};
    if (!seen || typeof seen !== "object" || Array.isArray(seen)
      || Object.values(seen).some((token) => typeof token !== "string" || !token.length)) throw new Error("Invalid legacy import receipt");
    const links = record.legacyLinks ?? {};
    if (!links || typeof links !== "object" || Array.isArray(links)
      || Object.entries(links).some(([id, value]) => !validDrawingOperationId(id) || !value || typeof value !== "object"
        || typeof (value as LegacyLink).sourceId !== "string" || typeof (value as LegacyLink).token !== "string")) throw new Error("Invalid legacy import link");
    namespace[symbol] = { format: 2, copies, legacySeen: { ...seen as Record<string, string> }, legacyLinks: { ...links as Record<string, LegacyLink> } };
  }
  const imports: LegacyImports = {};
  try {
  const legacy = ownerNamespace(strictEnvelope(storage, DRAWING_OUTBOX_KEY), owner);
  for (const [symbol, raw] of Object.entries(legacy)) {
    const copies = readCopies(raw);
    const container = raw as { format?: number; copies?: Record<string, unknown> } | undefined;
    if (!Object.keys(copies).length || (container?.format === 2
      && Object.keys(container.copies ?? {}).length !== Object.keys(copies).length)) throw new Error("Invalid legacy copy; preserve stored bytes");
    for (const [sourceId, entry] of Object.entries(copies)) {
      // Compare exact semantic content, not a lossy hash. A receipt suppresses
      // only the unchanged legacy snapshot the user already acknowledged.
      if (namespace[symbol]?.legacySeen[sourceId] !== fingerprint(entry)) {
        (imports[symbol] ??= {})[`legacy:${sourceId}`] = entry;
      }
    }
  }
  } catch (error) {
    if (!allowUnreadableLegacy) throw error;
    // Valid v2 pending work remains visible. Every write still reads strictly
    // and fails closed, retaining both stores and preventing a cloud PUT.
    return { envelope, namespace, imports: {} };
  }
  return { envelope, namespace, imports };
}

/** Read competing copies independently; no GET can silently choose or rebase one. */
export function readDrawingJournal(storage: StoragePort, owner: string): DrawingJournal {
  const journal: DrawingJournal = {};
  const baseline: JournalBaseline = {};
  if (accountOwner(owner)) {
    try {
      const { namespace, imports } = journalState(storage, owner, true);
      journalNamespaces.set(journal, namespace);
      for (const symbol of new Set([...Object.keys(namespace), ...Object.keys(imports)])) {
        const copies = { ...namespace[symbol]?.copies, ...imports[symbol] };
        const ids = Object.keys(copies).sort();
        if (!ids.length) continue;
        const entries = ids.map((id) => ({ ...copies[id], recoveryId: id }));
        journal[symbol] = entries[0];
        if (entries.length > 1) journal[symbol].alternatives = entries.slice(1);
        baseline[symbol] = { active: ids[0], hashes: Object.fromEntries(ids.map((id) => [id, fingerprint(copies[id])])) };
      }
    } catch { /* Unreadable bytes stay intact; writes also fail closed. */ }
  }
  baselines.set(journal, baseline);
  return journal;
}

/**
 * Web Locks serialize this versioned envelope across tabs and accounts.
 * A stale writer forks its selected copy; an acknowledgement removes only the
 * selected unchanged copy. Browser-storage failure never reports durability.
 */
export async function writeDrawingJournal(
  storage: StoragePort, owner: string, journal: DrawingJournal,
  locks: DrawingJournalLocks | null = typeof navigator !== "undefined" ? navigator.locks ?? null : null,
): Promise<boolean> {
  if (!accountOwner(owner) || !locks) return false;
  try {
    return await locks.request(DRAWING_JOURNAL_KEY, () => {
      const { envelope, namespace, imports } = journalState(storage, owner);
      const receipts = readRetiredCopies(storage, owner), retired = new Set(receipts), acknowledged: string[] = [];
      const previous = baselines.get(journal) ?? {};
      const next: JournalBaseline = {};
      const updates: Array<[Entry, string]> = [];
      const restored: Entry[] = [];
      const retiredSymbols: string[] = [];
      for (const symbol of new Set([...Object.keys(namespace), ...Object.keys(imports), ...Object.keys(previous), ...Object.keys(journal)])) {
        const record = namespace[symbol] ?? { format: 2 as const, copies: {}, legacySeen: {}, legacyLinks: {} };
        const copies = record.copies;
        const imported: Record<string, { id: string; token: string }> = {};
        for (const [sourceId, importedEntry] of Object.entries(imports[symbol] ?? {})) {
          const id = crypto.randomUUID(), token = fingerprint(importedEntry);
          copies[id] = storedEntry(importedEntry);
          record.legacySeen[sourceId.slice("legacy:".length)] = token;
          record.legacyLinks[id] = { sourceId: sourceId.slice("legacy:".length), token };
          imported[sourceId] = { id, token };
        }
        const entry = journal[symbol];
        const base = previous[symbol];
        const resolve = (id: string | undefined): string | undefined => {
          if (id && imported[id]) return base?.hashes[id] === imported[id].token ? imported[id].id : undefined;
          const alias = resolveLegacyAlias(record, id, id ? base?.hashes[id] : undefined, retired);
          if (alias) return alias.id;
          return id;
        };
        if (!entry) {
          const id = resolve(base?.active);
          if (base && id && copies[id] && fingerprint(copies[id]) === base.hashes[base.active]) {
            delete copies[id];
            acknowledged.push(id);
          }
        } else {
          const alias = resolveLegacyAlias(record, entry.recoveryId, entry.recoveryId ? base?.hashes[entry.recoveryId] : undefined, retired);
          if (alias?.retired && fingerprint(entry) === base?.hashes[entry.recoveryId!]) {
            // Another tab acknowledged this exact observed copy. A stale hydration
            // is not a new edit and must not manufacture a replacement copy.
            retiredSymbols.push(symbol);
            continue;
          }
          let id = resolve(entry.recoveryId);
          const unchanged = id && copies[id] && base?.hashes[entry.recoveryId!] === fingerprint(copies[id]);
          // An observed copy missing without a receipt was either lost with
          // browser storage or removed by an explicit discard whose receipt has
          // aged out or been cleared. Keep it under its own ID, with its exact
          // operation as evidence, for an explicit choice: never as an attempt
          // that saves by itself over the cloud.
          const lost = !alias && id && id === entry.recoveryId && base?.hashes[id] && !copies[id] && validDrawingOperationId(id);
          if (!unchanged && !lost) id = crypto.randomUUID();
          copies[id!] = lost ? { ...storedEntry(entry), blocked: entry.blocked ?? "conflict" } : storedEntry(entry);
          if (lost) restored.push(entry);
          updates.push([entry, id!]);
          for (const alternative of entry.alternatives ?? []) {
            const importedCopy = imported[alternative.recoveryId ?? ""];
            if (importedCopy && base?.hashes[alternative.recoveryId!] === importedCopy.token) updates.push([alternative, importedCopy.id]);
          }
          next[symbol] = { active: id!, hashes: Object.fromEntries(Object.entries(copies).map(([copyId, copy]) => [copyId, fingerprint(copy)])) };
        }
        // Keep an import receipt after the last copy is acknowledged: clearing
        // it would resurrect the unchanged v1 tombstone on the next reload.
        if (Object.keys(copies).length || Object.keys(record.legacySeen).length || Object.keys(record.legacyLinks).length) namespace[symbol] = record;
        else delete namespace[symbol];
      }
      if (Object.keys(namespace).length) envelope[owner] = namespace;
      else delete envelope[owner];
      // Receipts first: a failure between the two writes leaves a receipt for a
      // copy that is still stored, which retires nothing.
      if (acknowledged.length) writeRetiredCopies(storage, owner, [...receipts.filter((id) => !acknowledged.includes(id)), ...acknowledged]);
      if (Object.keys(envelope).length) storage.setItem(DRAWING_JOURNAL_KEY, JSON.stringify(envelope));
      else storage.removeItem(DRAWING_JOURNAL_KEY);
      // Change the in-memory baseline only after the actual durable write.
      updates.forEach(([entry, id]) => { entry.recoveryId = id; });
      restored.forEach((entry) => { entry.blocked ??= "conflict"; });
      retiredSymbols.forEach((symbol) => { delete journal[symbol]; });
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

/** Refresh an owner on re-entry while retaining unsaved memory and exact retries. */
export function reconcileDrawingJournal(storage: StoragePort, owner: string, journal?: DrawingJournal): DrawingJournal {
  const fresh = readDrawingJournal(storage, owner);
  if (!journal) return fresh;
  const baseline = baselines.get(journal) ?? {};
  const freshBaseline = baselines.get(fresh) ?? {};
  const namespace = journalNamespaces.get(fresh) ?? {};
  const retired = new Set(readRetiredCopies(storage, owner));
  for (const symbol of new Set([...Object.keys(journal), ...Object.keys(fresh)])) {
    const stored = fresh[symbol];
    const current = journal[symbol];
    if (!current) { if (stored) { journal[symbol] = stored; baseline[symbol] = freshBaseline[symbol]; } continue; }
    const memoryCopies = [current, ...(current.alternatives ?? [])].filter((copy) => {
      const token = copy.recoveryId ? baseline[symbol]?.hashes[copy.recoveryId] : undefined;
      const record = namespace[symbol] ?? { format: 2 as const, copies: {}, legacySeen: {}, legacyLinks: {} };
      const alias = resolveLegacyAlias(record, copy.recoveryId, token, retired);
      if (alias?.retired && fingerprint(copy) === token) return false;
      if (alias && !alias.retired && fingerprint(record.copies[alias.id]) === token) {
        baseline[symbol].hashes[alias.id] = token!;
        copy.recoveryId = alias.id;
      }
      return true;
    });
    const storedCopies = stored ? [stored, ...(stored.alternatives ?? [])] : [];
    const hashes = { ...baseline[symbol]?.hashes, ...freshBaseline[symbol]?.hashes };
    for (const copy of memoryCopies) {
      const sameId = storedCopies.find((candidate) => candidate.recoveryId === copy.recoveryId);
      if (sameId && fingerprint(sameId) !== fingerprint(copy)) {
        // A memory-only fork is not a durable receipt. The next locked write
        // allocates its actual stored ID without changing the retry operation.
        copy.recoveryId = `memory:${crypto.randomUUID()}`;
        hashes[copy.recoveryId] = fingerprint(copy);
      }
    }
    const combined = [...memoryCopies];
    for (const copy of storedCopies) {
      if (!combined.some((candidate) => candidate.recoveryId === copy.recoveryId && fingerprint(candidate) === fingerprint(copy))) combined.push(copy);
    }
    if (!combined.length) { delete journal[symbol]; delete baseline[symbol]; continue; }
    const active = combined[0];
    journal[symbol] = active;
    if (combined.length > 1) active.alternatives = combined.slice(1).map(({ alternatives: _nested, ...copy }) => copy);
    else delete active.alternatives;
    baseline[symbol] = { active: active.recoveryId!, hashes };
  }
  baselines.set(journal, baseline);
  return journal;
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
  // Selection changes which observed copy an explicit discard acknowledges.
  // Keep the original preimage hashes so concurrent edits remain protected.
  const baseline = baselines.get(journal)?.[symbol];
  if (baseline?.hashes[id]) baseline.active = id;
  return entry;
}
