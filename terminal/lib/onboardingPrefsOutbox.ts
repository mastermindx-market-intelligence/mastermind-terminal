/**
 * The onboarding preferences delivery outbox (D5).
 *
 * A user's market/trade-type/theme choices were written to `user_metadata` fire-and-forget, and the
 * durable copy was deleted BEFORE the write was acknowledged. Two paths lost the choice outright:
 *
 *   • already authenticated — `persistPrefs()` called `auth.updateUser()` and advanced to the next
 *     step; a failure was `console.warn`ed and nothing else. The user was shown a completed flow.
 *   • guest → authenticated — the provider burned its one-shot in-memory latch, fired an
 *     un-awaited `updateUser(...).catch(console.warn)`, and removed the localStorage copy
 *     IMMEDIATELY. If that write failed, BOTH retry mechanisms were already destroyed: the latch
 *     said "done" and the durable record was gone.
 *
 * Either way, one transient Supabase hiccup and an explicitly chosen preference was gone forever,
 * with the user having watched onboarding reach Done normally.
 *
 * The rule this module enforces is ACKNOWLEDGE BEFORE DELETE. The pending record is an outbox:
 * written first, cleared only after the authority confirms the write, or when nothing owned remained to send, preserved on failure. It is
 * deliberately NOT a new lifecycle store — it is the same `mm.pendingPrefs` key that already
 * existed, given the one property it was missing.
 */
import type { PendingPrefs } from "@/components/onboarding/types";
import { LS_PENDING_PREFS } from "@/components/onboarding/types";
import { scopeAccountWrite } from "@/lib/accountPrefs";

/** How many times ONE delivery pass will try before giving the record back to the outbox.
 *
 *  Per-pass, deliberately, not a lifetime budget: a permanently failing write must not spin inside
 *  a single mount, but a later mount (or a later session) must still be able to deliver it. A
 *  lifetime cap would turn "bounded retry" into "silently abandoned after three failures" — the
 *  same class of loss this module exists to prevent, just slower. The stored `attempts` count
 *  accumulates across passes for diagnostics only; it never blocks a future attempt. */
export const MAX_DELIVERY_ATTEMPTS = 3;

/** Canonical stored shape. `attempts` is what makes the retry bounded and inspectable. */
type OutboxRecord = { prefs: PendingPrefs; attempts: number; owner_user_id?: string };
type CurrentSubject = () => Promise<string | null>;

function validOwner(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128
    && /^[A-Za-z0-9]/.test(value) && !/[^A-Za-z0-9_.:-]/.test(value);
}

function rawPendingPrefs(): string | null {
  try { return localStorage.getItem(LS_PENDING_PREFS); } catch { return null; }
}

function decodeRecord(raw: string | null): OutboxRecord | null {
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  // Rolling-format fence: the original D5 reader rejects ROOT arrays without
  // writing or clearing them. An owned object alone is unsafe for old tabs,
  // which ignore extra envelope fields and would deliver A's prefs to B.
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) return null;
    parsed = parsed[0];
    if (!isPrefsShape(parsed) || !("owner_user_id" in parsed)) return null;
  }
  if (!isPrefsShape(parsed)) return null;
  const enveloped = parsed as Partial<OutboxRecord>;
  const owned = Object.prototype.hasOwnProperty.call(parsed, "owner_user_id");
  if (owned && (!validOwner(enveloped.owner_user_id) || !isPrefsShape(enveloped.prefs))) return null;
  if (isPrefsShape(enveloped.prefs)) {
    const attempts = typeof enveloped.attempts === "number" && Number.isFinite(enveloped.attempts)
      && enveloped.attempts >= 0 ? enveloped.attempts : 0;
    return { prefs: enveloped.prefs, attempts, ...(owned ? { owner_user_id: enveloped.owner_user_id! } : {}) };
  }
  return { prefs: parsed as PendingPrefs, attempts: 0 };
}

function encodeRecord(record: OutboxRecord): string {
  return JSON.stringify(record.owner_user_id ? [record] : record);
}

function replaceSnapshot(raw: string, next: string | null): boolean {
  try {
    if (localStorage.getItem(LS_PENDING_PREFS) !== raw) return false;
    if (next === null) localStorage.removeItem(LS_PENDING_PREFS);
    else localStorage.setItem(LS_PENDING_PREFS, next);
    return true;
  } catch { return false; }
}

function isPrefsShape(value: unknown): value is PendingPrefs {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read the outbox.
 *
 * Read-tolerant by design, exactly like normalizePlanKey: a tab that started onboarding on an
 * OLDER deploy wrote the bare payload under this key with no envelope, and that record is a real
 * user's real choice. Dropping it would reintroduce the very data loss this module exists to stop.
 * Writes are always canonical.
 */
export function readPendingPrefs(): OutboxRecord | null {
  return decodeRecord(rawPendingPrefs());
}

/** Write (or overwrite) the pending intent. Called BEFORE the authoritative write is attempted. */
export function writePendingPrefs(prefs: PendingPrefs, owner_user_id?: string): boolean {
  if (owner_user_id !== undefined && !validOwner(owner_user_id)) return false;
  const raw = rawPendingPrefs(), existing = decodeRecord(raw);
  // An unowned guest or a different account cannot replace a bound choice.
  if (existing?.owner_user_id && existing.owner_user_id !== owner_user_id) return false;
  // A present but malformed ownership claim is held, never recast as a guest.
  if (raw && !existing) return false;
  try {
    localStorage.setItem(LS_PENDING_PREFS, encodeRecord({ prefs, attempts: 0,
      ...(owner_user_id ? { owner_user_id } : {}) }));
    return true;
  } catch { return false; }
}

/** Clear the outbox. Called after the authority acknowledged the write, OR when nothing owned remained to send. */
export function clearPendingPrefs(): void {
  const raw = rawPendingPrefs(), record = decodeRecord(raw);
  if (raw && record && !record.owner_user_id) replaceSnapshot(raw, null);
}

export type DeliveryOutcome =
  | { status: "delivered" }
  | { status: "nothing-pending" }
  | { status: "held"; reason: "subject_unavailable" | "subject_mismatch" | "snapshot_changed" }
  | { status: "failed"; attempts: number; exhausted: boolean };

/**
 * Deliver whatever is pending, clearing the record after the authority acknowledged the write, OR when nothing owned remained to send.
 *
 * `updateUser` is injected rather than imported so the contract is testable without a Supabase
 * client, and so the caller decides which client performs the write.
 */
export async function deliverPendingPrefs(
  updateUser: (data: Record<string, unknown>) => Promise<{ error?: { name?: string; message?: string } | null } | void>,
  currentSubject?: CurrentSubject,
): Promise<DeliveryOutcome> {
  let raw = rawPendingPrefs();
  const record = decodeRecord(raw);
  if (!record) return { status: "nothing-pending" };
  async function held(): Promise<DeliveryOutcome | null> {
    if (record!.owner_user_id) {
      let subject: string | null = null;
      try { subject = currentSubject ? await currentSubject() : null; } catch { /* retain */ }
      if (!subject) return { status: "held", reason: "subject_unavailable" };
      if (subject !== record!.owner_user_id) return { status: "held", reason: "subject_mismatch" };
    }
    return rawPendingPrefs() === raw ? null : { status: "held", reason: "snapshot_changed" };
  }
  if (record.owner_user_id) { const stop = await held(); if (stop) return stop; }

  // A patch that scopes to empty is nothing the Terminal may write: strip foreign
  // keys from the durable record, deliver what remains, and clear when
  // nothing owned remains (including a {} / empty-prefs record). Never an
  // unbounded retry of keys we will never send.
  const { data, dropped } = scopeAccountWrite(record.prefs as unknown as Record<string, unknown>);
  if (dropped.length && process.env.NODE_ENV !== "production") {
    console.warn("[onboardingPrefsOutbox] dropping keys the Terminal does not own", dropped);
  }
  if (Object.keys(data).length === 0) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[onboardingPrefsOutbox] no owned key in patch");
    }
    return replaceSnapshot(raw!, null) ? { status: "nothing-pending" }
      : { status: "held", reason: "snapshot_changed" };
  }
  if (dropped.length) {
    record.prefs = data as unknown as PendingPrefs;
    const next = encodeRecord(record);
    if (!replaceSnapshot(raw!, next)) return { status: "held", reason: "snapshot_changed" };
    raw = next;
  }

  // The budget is PER PASS. `record.attempts` is history, not a veto — a record that failed three
  // times yesterday must still be deliverable today.
  let madeThisPass = 0;
  while (madeThisPass < MAX_DELIVERY_ATTEMPTS) {
    if (record.owner_user_id) { const stop = await held(); if (stop) return stop; }
    else if (rawPendingPrefs() !== raw) return { status: "held", reason: "snapshot_changed" };
    madeThisPass += 1;
    let ok = false;
    try {
      const result = await updateUser(record.prefs as unknown as Record<string, unknown>);
      // Supabase reports failure in the RESULT, not by throwing — treating a resolved promise as
      // success is precisely how the original fire-and-forget call declared victory over an error.
      ok = !(result && typeof result === "object" && "error" in result && result.error);
    } catch { ok = false; }
    const stop = await held(); if (stop) return stop;
    if (ok) {
      return replaceSnapshot(raw!, null) ? { status: "delivered" }
        : { status: "held", reason: "snapshot_changed" };
    }
  }

  // Still undelivered: keep the record (and the running count) so a later mount can try again.
  const attempts = record.attempts + madeThisPass;
  if (!replaceSnapshot(raw!, encodeRecord({ ...record, attempts })))
    return { status: "held", reason: "snapshot_changed" };
  return { status: "failed", attempts, exhausted: madeThisPass >= MAX_DELIVERY_ATTEMPTS };
}
