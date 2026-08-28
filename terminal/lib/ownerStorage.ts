/**
 * ownerStorage.ts — the ONE envelope format for owner-scoped browser state.
 *
 * Every owner-scoped localStorage key in the Terminal holds an ENVELOPE:
 *
 *     { "<owner>": <payload>, "<other owner>": <payload> }
 *
 * where `<owner>` is a key from `lib/accountIdentity.ts` (`guest` | `account:<uuid>`). One
 * owner's state is unreadable from another owner's slot, and a write for one owner leaves every
 * other owner's payload byte-identical.
 *
 * The format was introduced by `lib/watchlistOwner.ts` (bug-sweep A / PR #426) and is extracted
 * here so the preference lane uses the same three primitives rather than a second, subtly
 * different envelope. There is exactly one place where "read my slot" and "write my slot" are
 * implemented.
 */

import { GUEST_OWNER } from "@/lib/accountIdentity";

export type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** `localStorage` when it is reachable, else null (SSR, private mode, blocked storage). */
export function browserStorage(): StoragePort | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readEnvelope(storage: StoragePort, key: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(storage.getItem(key) || "{}");
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Read one owner's slot. Never falls back to another owner's payload, or to an unscoped one. */
export function readOwnerSlot(storage: StoragePort, key: string, owner: string): unknown {
  return readEnvelope(storage, key)[owner];
}

/** Replace one owner's slot. `undefined` deletes it; an emptied envelope removes the key. */
export function writeOwnerSlot(storage: StoragePort, key: string, owner: string, value: unknown): void {
  try {
    const envelope = readEnvelope(storage, key);
    if (value === undefined) delete envelope[owner];
    else envelope[owner] = value;
    if (Object.keys(envelope).length) storage.setItem(key, JSON.stringify(envelope));
    else storage.removeItem(key);
  } catch {
    // A full/blocked store degrades to in-memory state for the session.
  }
}

/**
 * Move ONE pre-boundary unscoped payload into the GUEST slot, once, then delete it.
 *
 * The adoption policy is `lib/watchlistOwner.ts`'s, and it is deliberately narrow: an unscoped
 * payload carries no owner, so handing it to whichever account signs in first is precisely the
 * bug the envelope exists to close. Guest is the only namespace that cannot be the wrong one.
 *
 * Returns true when it actually adopted something (so a test can assert the ONE-shot property).
 */
export function adoptLegacySlotIntoGuest(
  storage: StoragePort,
  opts: { legacyKey: string; scopedKey: string; receiptKey: string },
): boolean {
  const { legacyKey, scopedKey, receiptKey } = opts;
  try {
    if (storage.getItem(receiptKey) === "1") return false;
    let adopted = false;
    const raw = storage.getItem(legacyKey);
    if (raw && readOwnerSlot(storage, scopedKey, GUEST_OWNER) === undefined) {
      let parsed: unknown = null;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
      if (parsed !== null && parsed !== undefined) {
        writeOwnerSlot(storage, scopedKey, GUEST_OWNER, parsed);
        adopted = true;
      }
    }
    storage.removeItem(legacyKey);
    storage.setItem(receiptKey, "1");
    return adopted;
  } catch {
    return false;
  }
}
