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
 * written first, cleared only after the authority confirms the write, preserved on failure. It is
 * deliberately NOT a new lifecycle store — it is the same `mm.pendingPrefs` key that already
 * existed, given the one property it was missing.
 */
import type { PendingPrefs } from "@/components/onboarding/types";
import { LS_PENDING_PREFS } from "@/components/onboarding/types";

/** How many times ONE delivery pass will try before giving the record back to the outbox.
 *
 *  Per-pass, deliberately, not a lifetime budget: a permanently failing write must not spin inside
 *  a single mount, but a later mount (or a later session) must still be able to deliver it. A
 *  lifetime cap would turn "bounded retry" into "silently abandoned after three failures" — the
 *  same class of loss this module exists to prevent, just slower. The stored `attempts` count
 *  accumulates across passes for diagnostics only; it never blocks a future attempt. */
export const MAX_DELIVERY_ATTEMPTS = 3;

/** Canonical stored shape. `attempts` is what makes the retry bounded and inspectable. */
type OutboxRecord = { prefs: PendingPrefs; attempts: number };

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
  let raw: string | null = null;
  try { raw = localStorage.getItem(LS_PENDING_PREFS); } catch { return null; } // storage blocked
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!isPrefsShape(parsed)) return null;
  const enveloped = parsed as Partial<OutboxRecord>;
  if (isPrefsShape(enveloped.prefs)) {
    const attempts = typeof enveloped.attempts === "number" && enveloped.attempts >= 0 ? enveloped.attempts : 0;
    return { prefs: enveloped.prefs, attempts };
  }
  return { prefs: parsed as PendingPrefs, attempts: 0 };   // legacy bare payload
}

/** Write (or overwrite) the pending intent. Called BEFORE the authoritative write is attempted. */
export function writePendingPrefs(prefs: PendingPrefs): void {
  try { localStorage.setItem(LS_PENDING_PREFS, JSON.stringify({ prefs, attempts: 0 } satisfies OutboxRecord)); }
  catch { /* storage blocked — delivery still attempts below, it just cannot be retried later */ }
}

/** Clear the outbox. ONLY ever called after the authority acknowledged the write. */
export function clearPendingPrefs(): void {
  try { localStorage.removeItem(LS_PENDING_PREFS); } catch { /* ignore */ }
}

function recordAttempt(record: OutboxRecord, attempts: number): void {
  try { localStorage.setItem(LS_PENDING_PREFS, JSON.stringify({ prefs: record.prefs, attempts } satisfies OutboxRecord)); }
  catch { /* ignore */ }
}

export type DeliveryOutcome =
  | { status: "delivered" }
  | { status: "nothing-pending" }
  | { status: "failed"; attempts: number; exhausted: boolean };

/**
 * Deliver whatever is pending, clearing the record only on a confirmed success.
 *
 * `updateUser` is injected rather than imported so the contract is testable without a Supabase
 * client, and so the caller decides which client performs the write.
 */
export async function deliverPendingPrefs(
  updateUser: (data: Record<string, unknown>) => Promise<{ error?: { message?: string } | null } | void>,
): Promise<DeliveryOutcome> {
  const record = readPendingPrefs();
  if (!record) return { status: "nothing-pending" };

  // The budget is PER PASS. `record.attempts` is history, not a veto — a record that failed three
  // times yesterday must still be deliverable today.
  let madeThisPass = 0;
  while (madeThisPass < MAX_DELIVERY_ATTEMPTS) {
    madeThisPass += 1;
    let ok = false;
    try {
      const result = await updateUser(record.prefs as unknown as Record<string, unknown>);
      // Supabase reports failure in the RESULT, not by throwing — treating a resolved promise as
      // success is precisely how the original fire-and-forget call declared victory over an error.
      ok = !(result && typeof result === "object" && "error" in result && result.error);
    } catch { ok = false; }
    if (ok) { clearPendingPrefs(); return { status: "delivered" }; }
  }

  // Still undelivered: keep the record (and the running count) so a later mount can try again.
  const attempts = record.attempts + madeThisPass;
  recordAttempt(record, attempts);
  return { status: "failed", attempts, exhausted: madeThisPass >= MAX_DELIVERY_ATTEMPTS };
}
