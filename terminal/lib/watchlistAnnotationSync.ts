// E05 — the client sync engine for watchlist notes and flags. Pure: no React, no fetch, no clock.
//
// The Terminal shell keeps owning the two symbol→string maps it always had (`flags`, `symbolNotes`)
// and their per-owner browser envelopes. This engine keeps a per-owner LEDGER beside them that
// records, per symbol+field:
//   acked    — the last server state this device knows (revision + value);
//   pending  — a local value the server has not acknowledged yet, and the revision it was based on;
//   conflict — a local value and a different server value that moved past it (AC-E05-03);
//   imports  — guest values the user explicitly imported, retired from the guest slot only once
//              the server has acknowledged exactly that value (AC-E05-02).
//
// The rules that make the acceptance criteria hold:
//   * a local value is never replaced by a server value unless the ledger says this device had no
//     unacknowledged edit for that field — remote changes apply only on top of acknowledged state;
//   * a failed or uncertain save leaves `pending` untouched, so it is retried and never reported
//     as synced (AC-E05-04); a retry of a write that had in fact landed resolves as `ok`;
//   * note and flag are independent fields, so different-field edits from two devices both land.

import { isPlainObject, readOwnerSlot, writeOwnerSlot, type StoragePort } from "@/lib/ownerStorage";
import {
  ANNOTATION_FIELDS,
  ANNOTATION_WRITE_BATCH_MAX,
  normalizeAnnotationSymbol,
  normalizeAnnotationValue,
  recordField,
  type AnnotationField,
  type AnnotationRecord,
  type AnnotationWrite,
  type AnnotationWriteResult,
} from "@/lib/watchlistAnnotations";

export const ANNOTATION_SYNC_KEY = "mm.wlAnnotations.sync.v1";

export type Acked = { rev: number; value: string | null };
export type Pending = { value: string | null; base: number; invalid?: boolean };
export type Conflict = { mine: string | null; theirs: string | null; theirsRev: number; theirsAt: string | null };

export type SyncLedger = {
  v: 1;
  acked: Record<string, Acked>;
  pending: Record<string, Pending>;
  conflicts: Record<string, Conflict>;
  /** Guest values imported into this account, keyed like the rest; retired once acknowledged. */
  imports: Record<string, string>;
  /** Fingerprint of the guest offer the user answered "Not now" to. */
  importDismissed: string | null;
};

export type LocalMaps = { flags: Record<string, string>; notes: Record<string, string> };

export const emptyLedger = (): SyncLedger => ({ v: 1, acked: {}, pending: {}, conflicts: {}, imports: {}, importDismissed: null });

export const fieldKey = (symbol: string, field: AnnotationField) => `${symbol}|${field}`;

export function splitKey(key: string): { symbol: string; field: AnnotationField } | null {
  const at = key.lastIndexOf("|");
  if (at <= 0) return null;
  const field = key.slice(at + 1);
  if (field !== "note" && field !== "flag") return null;
  return { symbol: key.slice(0, at), field };
}

const mapFor = (maps: LocalMaps, field: AnnotationField) => (field === "note" ? maps.notes : maps.flags);

/**
 * A local value in the form the account stores it (`null` = absent), so a difference the server
 * would normalize away (an upper-case hex flag, a whitespace-only note) is never read as an edit —
 * otherwise every acknowledgement would look changed again and re-send forever. A value the account
 * would reject stays raw: it becomes a pending write that comes back "invalid" and is shown as
 * "can't sync", never silently dropped.
 */
export function canonicalLocal(field: AnnotationField, value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const normalized = normalizeAnnotationValue(field, value);
  return normalized === undefined ? value : normalized;
}

/** The local value of one field, compared in the account's stored form (`null` = absent). */
export function localValue(maps: LocalMaps, key: string): string | null {
  const parts = splitKey(key);
  if (!parts) return null;
  return canonicalLocal(parts.field, mapFor(maps, parts.field)[parts.symbol]);
}

// ───────────────────────────── persistence ─────────────────────────────

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const rev = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null);

function sanitizeEntries<T>(raw: unknown, read: (value: Record<string, unknown>) => T | null): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isPlainObject(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!splitKey(key) || !isPlainObject(value)) continue;
    const entry = read(value);
    if (entry) out[key] = entry;
  }
  return out;
}

/** Read this owner's ledger. Anything malformed is dropped entry-by-entry, never trusted. */
export function readLedger(storage: StoragePort, owner: string): SyncLedger {
  const raw = readOwnerSlot(storage, ANNOTATION_SYNC_KEY, owner);
  if (!isPlainObject(raw) || raw.v !== 1) return emptyLedger();
  const imports: Record<string, string> = {};
  if (isPlainObject(raw.imports)) {
    for (const [key, value] of Object.entries(raw.imports)) if (splitKey(key) && typeof value === "string" && value) imports[key] = value;
  }
  return {
    v: 1,
    acked: sanitizeEntries(raw.acked, (value) => {
      const r = rev(value.rev);
      return r === null ? null : { rev: r, value: str(value.value) };
    }),
    pending: sanitizeEntries(raw.pending, (value) => {
      const base = rev(value.base);
      if (base === null) return null;
      return value.invalid === true ? { value: str(value.value), base, invalid: true } : { value: str(value.value), base };
    }),
    conflicts: sanitizeEntries(raw.conflicts, (value) => {
      const theirsRev = rev(value.theirsRev);
      return theirsRev === null ? null : { mine: str(value.mine), theirs: str(value.theirs), theirsRev, theirsAt: str(value.theirsAt) };
    }),
    imports,
    importDismissed: str(raw.importDismissed),
  };
}

export function writeLedger(storage: StoragePort, owner: string, ledger: SyncLedger): boolean {
  return writeOwnerSlot(storage, ANNOTATION_SYNC_KEY, owner, ledger);
}

// ───────────────────────────── local edits ─────────────────────────────

const clone = (ledger: SyncLedger): SyncLedger => ({
  v: 1,
  acked: { ...ledger.acked },
  pending: { ...ledger.pending },
  conflicts: { ...ledger.conflicts },
  imports: { ...ledger.imports },
  importDismissed: ledger.importDismissed,
});

/** Keys the engine tracks: every local annotation plus everything the ledger knows. */
function trackedKeys(ledger: SyncLedger, maps: LocalMaps): Set<string> {
  const keys = new Set<string>([...Object.keys(ledger.acked), ...Object.keys(ledger.pending), ...Object.keys(ledger.conflicts)]);
  for (const field of ANNOTATION_FIELDS) {
    for (const [symbol, value] of Object.entries(mapFor(maps, field))) {
      // A symbol the server could never key (non-canonical spelling) stays local-only.
      if (typeof value === "string" && value && normalizeAnnotationSymbol(symbol) === symbol) keys.add(fieldKey(symbol, field));
    }
  }
  return keys;
}

/**
 * Fold the shell's current maps into the ledger. Anything that differs from what this device
 * believes the account holds becomes (or updates) a pending write — including clears. Returns the
 * SAME object when nothing changed, so callers can skip a storage write.
 */
export function detectLocalEdits(ledger: SyncLedger, maps: LocalMaps): SyncLedger {
  let next: SyncLedger | null = null;
  const edit = () => (next ??= clone(ledger));
  for (const key of trackedKeys(ledger, maps)) {
    const local = localValue(maps, key);
    const conflict = ledger.conflicts[key];
    if (conflict) {
      if (conflict.mine !== local) edit().conflicts[key] = { ...conflict, mine: local };
      continue;
    }
    const pending = ledger.pending[key];
    if (pending) {
      if (pending.value !== local) edit().pending[key] = { value: local, base: pending.base };
      continue;
    }
    const acked = ledger.acked[key];
    if ((acked?.value ?? null) !== local) edit().pending[key] = { value: local, base: acked?.rev ?? 0 };
  }
  return next ?? ledger;
}

// ───────────────────────────── server read ─────────────────────────────

/** A change the shell must make to its maps: set `key` to `to`, but only if it still holds `from`. */
export type LocalApply = { symbol: string; field: AnnotationField; from: string | null; to: string | null };

/**
 * Reconcile a successful GET with the ledger. `complete === false` means rows past the read limit
 * are unknown, so a key missing from the answer is left exactly as it is.
 *
 * Call `detectLocalEdits` with the latest maps FIRST: every unacknowledged local edit must already
 * be pending, or this would treat it as acknowledged state and apply the server value over it.
 */
export function reconcileServer(ledger: SyncLedger, records: AnnotationRecord[], complete: boolean): { ledger: SyncLedger; applies: LocalApply[] } {
  const next = clone(ledger);
  const applies: LocalApply[] = [];
  const server = new Map<string, AnnotationRecord>();
  for (const record of records) server.set(record.symbol, record);

  const keys = new Set<string>([...Object.keys(ledger.acked), ...Object.keys(ledger.pending), ...Object.keys(ledger.conflicts)]);
  for (const record of records) for (const field of ANNOTATION_FIELDS) keys.add(fieldKey(record.symbol, field));

  for (const key of keys) {
    const parts = splitKey(key);
    if (!parts) continue;
    const record = server.get(parts.symbol);
    if (!record && !complete) continue;
    const present = !!record;
    const current = recordField(record, parts.field);
    const theirs: Acked = { rev: current.revision, value: current.value };
    const pending = next.pending[key];
    const conflict = next.conflicts[key];

    if (pending) {
      if (!present) {
        // The account holds no row at all (never written, or the table was rebuilt): nothing to
        // conflict with — send this device's value as a first write. Clearing a value the account
        // never held is already true and needs no write.
        if (pending.value === null) delete next.pending[key];
        else next.pending[key] = { ...pending, base: 0 };
        delete next.acked[key];
      } else if (current.value === pending.value) {
        next.acked[key] = theirs;
        delete next.pending[key];
      } else if (current.revision !== pending.base) {
        next.conflicts[key] = { mine: pending.value, theirs: current.value, theirsRev: current.revision, theirsAt: current.updatedAt };
        next.acked[key] = theirs;
        delete next.pending[key];
      }
      continue;
    }

    if (conflict) {
      if (!present) {
        next.pending[key] = { value: conflict.mine, base: 0 };
        delete next.conflicts[key];
        delete next.acked[key];
      } else if (current.value === conflict.mine) {
        next.acked[key] = theirs;
        delete next.conflicts[key];
      } else {
        next.acked[key] = theirs;
        if (current.revision !== conflict.theirsRev) {
          next.conflicts[key] = { ...conflict, theirs: current.value, theirsRev: current.revision, theirsAt: current.updatedAt };
        }
      }
      continue;
    }

    const acked = next.acked[key];
    if (!present) {
      // A key this device had acknowledged is gone from the account. Never read that as "clear
      // my copy": re-send the acknowledged local value instead, so a rebuilt table repopulates
      // rather than wiping every device.
      if (acked && acked.value !== null) next.pending[key] = { value: acked.value, base: 0 };
      delete next.acked[key];
      continue;
    }
    const knownValue = acked?.value ?? null;
    if (!acked || acked.rev !== current.revision || knownValue !== current.value) {
      if (knownValue !== current.value) applies.push({ symbol: parts.symbol, field: parts.field, from: knownValue, to: current.value });
      next.acked[key] = theirs;
    }
  }
  return { ledger: next, applies };
}

// ───────────────────────────── server write ─────────────────────────────

/** The pending writes to send, in stable order, chunked to the route's batch limit. */
export function buildWriteBatches(ledger: SyncLedger): AnnotationWrite[][] {
  const writes: AnnotationWrite[] = [];
  for (const key of Object.keys(ledger.pending).sort()) {
    const pending = ledger.pending[key];
    const parts = splitKey(key);
    if (!parts || pending.invalid) continue;
    writes.push({ symbol: parts.symbol, field: parts.field, value: pending.value, baseRevision: pending.base });
  }
  const batches: AnnotationWrite[][] = [];
  for (let index = 0; index < writes.length; index += ANNOTATION_WRITE_BATCH_MAX) batches.push(writes.slice(index, index + ANNOTATION_WRITE_BATCH_MAX));
  return batches;
}

/**
 * Fold one POST's per-write answers into the ledger. `sent` is what that POST carried; the user
 * may have edited further while it was in flight, which is why every rule compares against the
 * CURRENT pending value rather than assuming it is what was sent. A write with no answer, or an
 * `error` answer, stays pending exactly as it is.
 */
export function applyWriteResults(ledger: SyncLedger, sent: AnnotationWrite[], results: AnnotationWriteResult[]): SyncLedger {
  const next = clone(ledger);
  const sentByKey = new Map(sent.map((write) => [fieldKey(write.symbol, write.field), write]));
  for (const result of results) {
    const key = fieldKey(result.symbol, result.field);
    const write = sentByKey.get(key);
    if (!write) continue;
    const pending = next.pending[key];
    if (result.status === "ok") {
      next.acked[key] = { rev: result.revision, value: result.value };
      if (pending) {
        if (pending.value === result.value) delete next.pending[key];
        else next.pending[key] = { value: pending.value, base: result.revision };
      }
    } else if (result.status === "conflict") {
      next.acked[key] = { rev: result.revision, value: result.value };
      if (pending) {
        if (pending.value === result.value) delete next.pending[key];
        else {
          next.conflicts[key] = { mine: pending.value, theirs: result.value, theirsRev: result.revision, theirsAt: result.updatedAt };
          delete next.pending[key];
        }
      }
    } else if (result.status === "invalid") {
      if (pending && pending.value === write.value) next.pending[key] = { ...pending, invalid: true };
    }
  }
  return next;
}

// ───────────────────────────── conflict resolution ─────────────────────────────

/** Keep this device's value: it becomes a write based on the server revision it now knows. */
export function keepMine(ledger: SyncLedger, key: string): SyncLedger {
  const conflict = ledger.conflicts[key];
  if (!conflict) return ledger;
  const next = clone(ledger);
  delete next.conflicts[key];
  next.pending[key] = { value: conflict.mine, base: conflict.theirsRev };
  return next;
}

/** Take the other device's value. The caller applies `apply` to the shell's maps. */
export function takeTheirs(ledger: SyncLedger, key: string): { ledger: SyncLedger; apply: LocalApply | null } {
  const conflict = ledger.conflicts[key];
  const parts = splitKey(key);
  if (!conflict || !parts) return { ledger, apply: null };
  const next = clone(ledger);
  delete next.conflicts[key];
  next.acked[key] = { rev: conflict.theirsRev, value: conflict.theirs };
  return { ledger: next, apply: { symbol: parts.symbol, field: parts.field, from: conflict.mine, to: conflict.theirs } };
}

/** Apply engine changes to one of the shell's maps, skipping any key the user changed meanwhile. */
export function applyToMap(map: Record<string, string>, applies: LocalApply[], field: AnnotationField): Record<string, string> {
  let next: Record<string, string> | null = null;
  for (const apply of applies) {
    if (apply.field !== field) continue;
    const current = canonicalLocal(field, map[apply.symbol]);
    if (current !== apply.from || current === apply.to) continue;
    next ??= { ...map };
    if (apply.to === null) delete next[apply.symbol];
    else next[apply.symbol] = apply.to;
  }
  return next ?? map;
}

// ───────────────────────────── status ─────────────────────────────

export type SyncSignals = {
  /** A GET has succeeded during this page's life for this owner. */
  readOk: boolean;
  /** The latest GET failed (network or 5xx other than 503). */
  readFailed: boolean;
  /** The latest POST failed or could not reach the server. */
  writeFailed: boolean;
  /** The server says the store does not exist (503). */
  unavailable: boolean;
  /** The server says this session is not signed in (401). */
  unauthenticated: boolean;
  /** A request is on the wire right now. */
  inFlight: boolean;
};

export type SyncStatus =
  | { kind: "auth" }
  | { kind: "unavailable" }
  | { kind: "conflict"; count: number }
  | { kind: "retrying"; count: number }
  | { kind: "readFailed" }
  | { kind: "saving" }
  | { kind: "rejected"; count: number }
  | { kind: "checking" }
  | { kind: "synced" };

export function ledgerCounts(ledger: SyncLedger): { pending: number; invalid: number; conflicts: number } {
  let pending = 0;
  let invalid = 0;
  for (const entry of Object.values(ledger.pending)) {
    if (entry.invalid) invalid++;
    else pending++;
  }
  return { pending, invalid, conflicts: Object.keys(ledger.conflicts).length };
}

/**
 * One honest label. "synced" requires: a successful read this session, nothing pending, nothing
 * in flight, no conflict and no failure. Everything else names what is actually true.
 */
export function syncStatus(ledger: SyncLedger, signals: SyncSignals): SyncStatus {
  const counts = ledgerCounts(ledger);
  if (signals.unauthenticated) return { kind: "auth" };
  if (signals.unavailable) return { kind: "unavailable" };
  if (counts.conflicts > 0) return { kind: "conflict", count: counts.conflicts };
  if (counts.pending > 0 && signals.writeFailed) return { kind: "retrying", count: counts.pending };
  if (signals.readFailed) return { kind: "readFailed" };
  if (counts.pending > 0 || signals.inFlight) return signals.readOk ? { kind: "saving" } : { kind: "checking" };
  if (counts.invalid > 0) return { kind: "rejected", count: counts.invalid };
  if (!signals.readOk) return { kind: "checking" };
  return { kind: "synced" };
}

// ───────────────────────────── guest import ─────────────────────────────

export type ImportItem = { symbol: string; field: AnnotationField; value: string };
export type ImportCollision = ImportItem & { accountValue: string };
export type ImportOffer = { items: ImportItem[]; collisions: ImportCollision[]; fingerprint: string };

function fingerprint(items: ImportItem[]): string {
  // FNV-1a over the sorted entries: only used to remember "Not now" for this exact offer.
  let hash = 0x811c9dc5;
  const text = items.map((item) => `${item.symbol}|${item.field}|${item.value}`).sort().join("\n");
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${items.length}:${hash.toString(16)}`;
}

/**
 * What the signed-in account could import from this browser's guest notes/flags. Items the
 * account already holds identically are not offered; items where the account holds a DIFFERENT
 * value are never imported over it — they are listed so the user can see them, and stay in the
 * guest slot. Items already imported and awaiting acknowledgement are not offered twice.
 */
export function guestImportOffer(guest: LocalMaps, account: LocalMaps, ledger: SyncLedger): ImportOffer {
  const items: ImportItem[] = [];
  const collisions: ImportCollision[] = [];
  for (const field of ANNOTATION_FIELDS) {
    for (const [symbol, raw] of Object.entries(mapFor(guest, field))) {
      if (normalizeAnnotationSymbol(symbol) !== symbol) continue;
      const value = typeof raw === "string" ? normalizeAnnotationValue(field, raw) : undefined;
      if (typeof value !== "string") continue;
      const key = fieldKey(symbol, field);
      if (ledger.imports[key] !== undefined) continue;
      const accountValue = localValue(account, key);
      if (accountValue === value) continue;
      if (accountValue !== null) collisions.push({ symbol, field, value, accountValue });
      else items.push({ symbol, field, value });
    }
  }
  return { items, collisions, fingerprint: fingerprint([...items, ...collisions]) };
}

/** Record an accepted import. The caller adds the items to the shell's maps (which makes them pending). */
export function recordImport(ledger: SyncLedger, items: ImportItem[]): SyncLedger {
  const next = clone(ledger);
  for (const item of items) next.imports[fieldKey(item.symbol, item.field)] = item.value;
  return next;
}

export function dismissImport(ledger: SyncLedger, fingerprintValue: string): SyncLedger {
  if (ledger.importDismissed === fingerprintValue) return ledger;
  return { ...clone(ledger), importDismissed: fingerprintValue };
}

/**
 * Imports whose fate is settled. `retire` — the server acknowledged exactly the imported value, so
 * the guest original may go (only if the guest slot still holds that same value). `forget` — the
 * key settled on some OTHER value (edited or resolved elsewhere): stop tracking it and leave the
 * guest original where it is. Anything still pending or in conflict stays journaled.
 */
export function settledImports(ledger: SyncLedger): { retire: ImportItem[]; forget: string[] } {
  const retire: ImportItem[] = [];
  const forget: string[] = [];
  for (const [key, value] of Object.entries(ledger.imports)) {
    if (ledger.pending[key] || ledger.conflicts[key]) continue;
    const acked = ledger.acked[key];
    if (!acked) continue;
    const parts = splitKey(key);
    if (!parts) continue;
    if (acked.value === value) retire.push({ symbol: parts.symbol, field: parts.field, value });
    else forget.push(key);
  }
  return { retire, forget };
}

export function clearImports(ledger: SyncLedger, keys: string[]): SyncLedger {
  if (!keys.length) return ledger;
  const next = clone(ledger);
  for (const key of keys) delete next.imports[key];
  return next;
}
