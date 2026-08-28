/**
 * watchlistOwner.ts — the owner boundary for the Terminal's LOCAL watchlist state, and the
 * durable record of deletions that have not reached the server yet.
 *
 * ── Why an owner boundary (A1) ────────────────────────────────────────────────────────────────
 * `mm.wls`, `mm.flags`, `mm.symbolNotes` and the `mm.wls.migrated.v1` receipt were BROWSER-GLOBAL:
 * one payload per browser, restored on every mount whoever was signed in. In one shared browser
 * that is not a stale-cache annoyance, it is an ownership failure with a write path attached:
 *
 *   User A builds lists → signs out → User B signs in → the shell restores A's `mm.wls` → B's rail
 *   renders A's rows, and TRAP-1's heal step fires `POST /api/watchlist {action:"add"}` for every
 *   local-only row, copying A's symbols into B's authenticated server list.
 *
 * Portfolio (`pfEmail`) and drawings (`drawingOwnerKey`) already draw this boundary. Watchlists
 * now draw it too, keyed on the IMMUTABLE auth user id rather than the email: an address can be
 * changed and reassigned, and an owner key that can be recycled is not an owner boundary.
 *
 * Every key below is an ENVELOPE — `{ "<owner>": <payload> }` — exactly like `mm.drawing.
 * account-outbox.v1`. One owner's state is unreadable from another owner's key, and a write for
 * one owner cannot mutate another's payload.
 *
 * ── Legacy adoption policy (deliberate, and deliberately narrow) ───────────────────────────────
 * The pre-boundary payloads carry no owner. Nothing in them says which identity wrote them, so
 * handing them to whichever account signs in first is precisely the bug. They are adopted ONCE,
 * into the GUEST namespace, and the legacy keys are then removed:
 *
 *   * guest is the only namespace that cannot be the wrong one — it is not an identity, and no
 *     authenticated write path reads it, so adoption there can never POST one user's rows into
 *     another user's account;
 *   * for a guest (no server copy at all) it is the difference between keeping their lists and
 *     destroying them;
 *   * a signed-in user's lists are already server-backed — W1b migrated every named list — so
 *     their rail refills from their own inventory on the next mount. What they lose is local ROW
 *     ORDER for lists that had never been migrated, which is the correct price for closing a
 *     cross-account write.
 *
 * The legacy MIGRATION RECEIPT is discarded rather than adopted: an unscoped "Gold Miners is
 * migrated" claim must not suppress a real per-account migration, and re-running the migration is
 * safe (`planWatchlistMigration` is idempotent by construction).
 *
 * ── Why deletions are durable (A3) ────────────────────────────────────────────────────────────
 * Server adoption is additive, so it cannot tell "another device added AAPL" from "this device
 * deleted AAPL and the DELETE never landed". W1b accepted the resurrection ("a delete made BEFORE
 * the read can still resurrect"); the user's explicit action simply reversed itself on the next
 * reload. A deletion intent is now written BEFORE the request and cleared only when the server
 * confirms the row is gone (ok, or 404/not-found), so a stale server row cannot be re-adopted
 * while the intent stands, and the delete is retried until it converges.
 */

import { GUEST_OWNER, ownerKeyFor } from "@/lib/accountIdentity";
import {
  isPlainObject, readOwnerSlot, writeOwnerSlot, type StoragePort,
} from "@/lib/ownerStorage";

export { GUEST_OWNER };
export type { StoragePort };

/** `mm.wls` — lists + active list + section metadata, per owner. */
export const WLS_KEY = "mm.wls.v2";
/** `mm.flags` — symbol → flag colour, per owner. */
export const WL_FLAGS_KEY = "mm.flags.v2";
/** `mm.symbolNotes` — symbol → note, per owner. */
export const WL_NOTES_KEY = "mm.symbolNotes.v2";
/** `mm.wls.migrated.v1` — the per-list local→server migration receipt, per owner. */
export const WLS_MIGRATED_KEY = "mm.wls.migrated.v2";
/** Deletions that have not been confirmed by the server yet, per owner. */
export const WLS_TOMBSTONE_KEY = "mm.wls.deleted.v1";

/** Pre-boundary keys. Read once by `adoptLegacyWatchlistState`, then removed. */
const LEGACY_KEYS = {
  lists: "mm.wls",
  flags: "mm.flags",
  notes: "mm.symbolNotes",
  migrated: "mm.wls.migrated.v1",
} as const;
/** Set once the legacy sweep has run, so a later guest edit is never re-overwritten by it. */
const LEGACY_ADOPTED_KEY = "mm.wls.legacy.v1";

/** A tombstone older than this is abandoned: the row it guarded is long gone or long re-added. */
export const TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Hard cap per owner. A pathological loop must not grow localStorage without bound. */
export const MAX_TOMBSTONES = 500;

export type LocalWatchlistState = {
  lists: Record<string, { symbol: string; section: string }[]>;
  active: string;
  meta: Record<string, { sections: string[]; collapsed: string[] }>;
};

/**
 * The owner key for a session. `guest` for a signed-out browser; `account:<auth uuid>` otherwise.
 *
 * Thin alias for `ownerKeyFor` in `lib/accountIdentity.ts`, which is now the ONE definition of
 * the owner namespace — shared by watchlists, preferences and entitlement, so the three cannot
 * drift into different answers about who is asking.
 */
export function watchlistOwnerKey(userId: string | null | undefined): string {
  return ownerKeyFor(userId);
}

// Envelope primitives now live in `lib/ownerStorage.ts` — one implementation, shared with the
// preference lane, so the two cannot drift into subtly different notions of "my slot".
const readSlot = readOwnerSlot;
const writeSlot = writeOwnerSlot;

// ───────────────────────────── lists ─────────────────────────────

function normalizeRows(value: unknown): { symbol: string; section: string }[] | null {
  if (!Array.isArray(value)) return null;
  const rows: { symbol: string; section: string }[] = [];
  for (const row of value) {
    if (!isPlainObject(row) || typeof row.symbol !== "string" || !row.symbol) continue;
    rows.push({ symbol: row.symbol, section: typeof row.section === "string" ? row.section : "" });
  }
  return rows;
}

function normalizeState(value: unknown): LocalWatchlistState | null {
  if (!isPlainObject(value) || !isPlainObject(value.lists)) return null;
  const lists: LocalWatchlistState["lists"] = {};
  for (const [name, rows] of Object.entries(value.lists)) {
    const normalized = normalizeRows(rows);
    if (normalized) lists[name] = normalized;
  }
  if (!Object.keys(lists).length) return null;
  const meta: LocalWatchlistState["meta"] = {};
  if (isPlainObject(value.meta)) {
    for (const [name, entry] of Object.entries(value.meta)) {
      if (!isPlainObject(entry)) continue;
      const strings = (list: unknown) => (Array.isArray(list)
        ? list.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
        : []);
      meta[name] = { sections: strings(entry.sections), collapsed: strings(entry.collapsed) };
    }
  }
  const active = typeof value.active === "string" && lists[value.active] ? value.active : Object.keys(lists)[0];
  return { lists, active, meta };
}

/** One owner's saved lists, or `null` when that owner has never saved any in this browser. */
export function readOwnerWatchlists(storage: StoragePort, owner: string): LocalWatchlistState | null {
  return normalizeState(readSlot(storage, WLS_KEY, owner));
}

export function writeOwnerWatchlists(storage: StoragePort, owner: string, state: LocalWatchlistState): void {
  writeSlot(storage, WLS_KEY, owner, { lists: state.lists, active: state.active, meta: state.meta });
}

// ───────────────────────────── flags / notes ─────────────────────────────

/** Symbol→string maps (flag colours, notes). Non-string values are dropped, never coerced. */
export function readOwnerStringMap(storage: StoragePort, key: string, owner: string): Record<string, string> {
  const stored = readSlot(storage, key, owner);
  if (!isPlainObject(stored)) return {};
  const map: Record<string, string> = {};
  for (const [symbol, value] of Object.entries(stored)) {
    if (symbol && typeof value === "string") map[symbol] = value;
  }
  return map;
}

export function writeOwnerStringMap(storage: StoragePort, key: string, owner: string, map: Record<string, string>): void {
  writeSlot(storage, key, owner, Object.keys(map).length ? map : undefined);
}

// ───────────────────────────── migration receipt ─────────────────────────────

export function readOwnerMigrationMarker(storage: StoragePort, owner: string): Record<string, boolean> {
  const stored = readSlot(storage, WLS_MIGRATED_KEY, owner);
  if (!isPlainObject(stored)) return {};
  const marker: Record<string, boolean> = {};
  for (const [name, value] of Object.entries(stored)) {
    if (typeof value === "boolean") marker[name] = value;
  }
  return marker;
}

export function writeOwnerMigrationMarker(storage: StoragePort, owner: string, marker: Record<string, boolean>): void {
  writeSlot(storage, WLS_MIGRATED_KEY, owner, Object.keys(marker).length ? marker : undefined);
}

// ───────────────────────────── deletion intents (tombstones) ─────────────────────────────

/** list name → symbol → epoch ms the deletion was requested. */
export type TombstoneBook = Record<string, Record<string, number>>;

function normalizeTombstones(value: unknown, now: number): TombstoneBook {
  if (!isPlainObject(value)) return {};
  const book: TombstoneBook = {};
  let kept = 0;
  for (const [listName, entry] of Object.entries(value)) {
    if (!isPlainObject(entry)) continue;
    for (const [symbol, at] of Object.entries(entry)) {
      if (typeof at !== "number" || !Number.isFinite(at)) continue;
      if (now - at > TOMBSTONE_TTL_MS) continue;   // abandoned; the row is long since settled
      if (kept >= MAX_TOMBSTONES) break;
      (book[listName] ??= {})[symbol] = at;
      kept += 1;
    }
  }
  return book;
}

/** Every deletion this owner has made that the server has not confirmed yet. */
export function readWatchlistTombstones(storage: StoragePort, owner: string, now = Date.now()): TombstoneBook {
  return normalizeTombstones(readSlot(storage, WLS_TOMBSTONE_KEY, owner), now);
}

/** The symbols one list must NOT re-adopt from a server response. */
export function tombstonedSymbols(book: TombstoneBook, listName: string): Set<string> {
  return new Set(Object.keys(book[listName] ?? {}));
}

/** Record a deletion BEFORE the request goes out, so a crash mid-flight still holds the line. */
export function recordWatchlistTombstones(
  storage: StoragePort,
  owner: string,
  listName: string,
  symbols: readonly string[],
  now = Date.now(),
): TombstoneBook {
  if (!symbols.length) return readWatchlistTombstones(storage, owner, now);
  const book = readWatchlistTombstones(storage, owner, now);
  const list = (book[listName] ??= {});
  for (const symbol of symbols) if (symbol) list[symbol] = now;
  const pruned = normalizeTombstones(book, now);
  writeSlot(storage, WLS_TOMBSTONE_KEY, owner, Object.keys(pruned).length ? pruned : undefined);
  return pruned;
}

/** Clear only once the server has CONFIRMED the row is gone (deleted, or already absent). */
export function clearWatchlistTombstones(
  storage: StoragePort,
  owner: string,
  listName: string,
  symbols: readonly string[],
  now = Date.now(),
): TombstoneBook {
  const book = readWatchlistTombstones(storage, owner, now);
  const list = book[listName];
  if (!list) return book;
  for (const symbol of symbols) delete list[symbol];
  if (!Object.keys(list).length) delete book[listName];
  writeSlot(storage, WLS_TOMBSTONE_KEY, owner, Object.keys(book).length ? book : undefined);
  return book;
}

/** Drop a whole list's intents — the list itself is gone, so its rows cannot resurrect into it. */
export function forgetListTombstones(storage: StoragePort, owner: string, listName: string, now = Date.now()): void {
  const book = readWatchlistTombstones(storage, owner, now);
  if (!(listName in book)) return;
  delete book[listName];
  writeSlot(storage, WLS_TOMBSTONE_KEY, owner, Object.keys(book).length ? book : undefined);
}

// ───────────────────────────── legacy sweep ─────────────────────────────

/**
 * Move the pre-boundary unscoped payloads into the GUEST namespace, once, then delete them.
 *
 * Runs before the first owner-scoped read of a session. It never writes into an account
 * namespace, and it never overwrites a guest payload that already exists — after the first sweep
 * the legacy keys are gone, so the second call is a no-op even if the receipt were lost.
 *
 * Returns true when it actually adopted something (tests assert the ONE-shot property).
 */
export function adoptLegacyWatchlistState(storage: StoragePort): boolean {
  let adopted = false;
  try {
    if (storage.getItem(LEGACY_ADOPTED_KEY) === "1") return false;
    const guestHasLists = readOwnerWatchlists(storage, GUEST_OWNER);
    const legacyState = normalizeState((() => {
      try { return JSON.parse(storage.getItem(LEGACY_KEYS.lists) || "null"); } catch { return null; }
    })());
    if (legacyState && !guestHasLists) {
      writeOwnerWatchlists(storage, GUEST_OWNER, legacyState);
      adopted = true;
    }
    for (const [legacyKey, scopedKey] of [[LEGACY_KEYS.flags, WL_FLAGS_KEY], [LEGACY_KEYS.notes, WL_NOTES_KEY]] as const) {
      const existing = readOwnerStringMap(storage, scopedKey, GUEST_OWNER);
      if (Object.keys(existing).length) continue;
      let legacyMap: unknown = null;
      try { legacyMap = JSON.parse(storage.getItem(legacyKey) || "null"); } catch { legacyMap = null; }
      if (!isPlainObject(legacyMap)) continue;
      const map: Record<string, string> = {};
      for (const [symbol, value] of Object.entries(legacyMap)) {
        if (symbol && typeof value === "string") map[symbol] = value;
      }
      if (!Object.keys(map).length) continue;
      writeOwnerStringMap(storage, scopedKey, GUEST_OWNER, map);
      adopted = true;
    }
    // The receipt is DISCARDED, never adopted — see the policy note at the top of this file.
    for (const key of Object.values(LEGACY_KEYS)) storage.removeItem(key);
    storage.setItem(LEGACY_ADOPTED_KEY, "1");
  } catch {
    // Storage unavailable (private mode, quota): the session runs on in-memory state.
  }
  return adopted;
}
