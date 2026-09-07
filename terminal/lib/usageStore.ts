"use client";
import { useEffect, useSyncExternalStore } from "react";
import {
  GUEST_IDENTITY, GUEST_OWNER, identityOwnerKey, isAccountOwner, type AccountIdentity,
} from "@/lib/accountIdentity";
import { parseAccountUsage, type AccountQuotas, type AccountUsage } from "@/lib/accountPlan";

/**
 * usageStore.ts — the owner-scoped reader of `GET /api/brain/me` (E4).
 *
 * ── Why this is a SEPARATE authority from the plan ────────────────────────────────────────
 *
 * `/api/me` says what the account is ENTITLED to; `/api/brain/me` says how much of it is LEFT.
 * They change on completely different clocks: a plan changes when the user buys something, a
 * quota changes every time they ask the assistant a question. Folding them into one cache means
 * picking one refresh policy for two facts, and whichever you pick is wrong for the other.
 *
 * The old panel cached usage by EMAIL for the life of the mounted shell and never re-fetched.
 * Since the shell is long-lived on /terminal, that meant the meters could sit for an entire
 * session showing the remaining questions of an hour ago — the number most likely of all to have
 * moved, since the user spends it from inside the very same page.
 *
 * Policy here: verify on Usage ENTRY, and again on re-entry once the held answer is older than
 * `USAGE_TTL_MS`. Bounded, cheap, and never stale for longer than one tab switch.
 *
 * Failure semantics match lib/entitlementStore.ts, for the same reason: a read that did not land
 * is not "you have no quota left". A same-owner last-good is shown, flagged stale; a cross-owner
 * one never is.
 */

/** A held usage answer older than this is re-verified on the next Usage entry. */
export const USAGE_TTL_MS = 60_000;

/** A refresh that has not settled by this point is abandoned so `inflight` cannot latch forever. */
const USAGE_FETCH_TIMEOUT_MS = 10_000;

export type UsageState = "GUEST" | "LOADING" | "VERIFIED" | "UNAVAILABLE" | "STALE_LAST_GOOD";

export type UsageSnapshot = {
  owner: string;
  state: UsageState;
  usage: AccountUsage | null;
  verifiedAt: number;
};

const EMPTY: UsageSnapshot = { owner: GUEST_OWNER, state: "GUEST", usage: null, verifiedAt: 0 };

let snapshot: UsageSnapshot = EMPTY;
let owner = GUEST_OWNER;
let generation = 0;
let inflight = false;
const subs = new Set<() => void>();

function publish(next: Partial<UsageSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const fn of subs) fn();
}
function subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; }
function getSnapshot() { return snapshot; }
function getServerSnapshot() { return EMPTY; }

/** Adopt an owner, dropping the outgoing owner's meters before anything incoming is published. */
function setOwner(next: string): boolean {
  if (owner === next) return false;
  owner = next;
  generation += 1;
  inflight = false;
  publish({
    owner: next,
    usage: null,
    verifiedAt: 0,
    state: isAccountOwner(next) ? "LOADING" : "GUEST",
  });
  return true;
}

/** Ask the brain gateway. `force` re-asks regardless of how fresh the held answer is. */
export function refreshUsage(force = false, now = Date.now()): void {
  if (!isAccountOwner(owner)) return;
  if (inflight && !force) return;
  // `snapshot.usage` is always a (possibly content-free) object once any 2xx has landed — the
  // TTL and "has something to show" checks must discriminate on the LANES, not the wrapper, or a
  // single quota-less 200 permanently reads as a fresh, non-stale answer.
  if (!force && snapshot.usage?.quotas && now - snapshot.verifiedAt < USAGE_TTL_MS) return;
  const gen = generation;
  inflight = true;
  // A revalidation keeps the current meters on screen; only a first read has nothing to show.
  if (!snapshot.usage?.quotas) publish({ state: "LOADING" });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), USAGE_FETCH_TIMEOUT_MS);
  const settle = () => { clearTimeout(timeoutId); inflight = false; };

  fetch("/api/brain/me", { cache: "no-store", signal: controller.signal })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((raw) => {
      if (gen !== generation) { settle(); return; }
      settle();
      publish({ usage: parseAccountUsage(raw), verifiedAt: now, state: "VERIFIED" });
    })
    .catch(() => {
      if (gen !== generation) { settle(); return; }
      settle();
      publish({ state: snapshot.usage?.quotas ? "STALE_LAST_GOOD" : "UNAVAILABLE" });
    });
}

export type UsageView = {
  /** The metered lanes, or null when nothing is known for THIS owner. */
  quotas: AccountQuotas | null;
  tier: string | undefined;
  loading: boolean;
  /** Nothing same-owner is known and the authority could not be reached. */
  unavailable: boolean;
  /** `quotas` is a same-owner last-good, not a fresh verification. */
  stale: boolean;
};

export function usageView(s: UsageSnapshot = snapshot): UsageView {
  return {
    quotas: s.usage?.quotas ?? null,
    tier: s.usage?.tier,
    loading: s.state === "LOADING",
    unavailable: s.state === "UNAVAILABLE",
    stale: s.state === "STALE_LAST_GOOD",
  };
}

/**
 * Bind the store to an owner and verify while `active`.
 *
 * `active` is "the Usage section is on screen" — entry and re-entry are the refresh trigger, so
 * the meters are re-read exactly when someone is looking at them and never polled when nobody is.
 */
export function useUsage(identity: AccountIdentity | null | undefined, active: boolean): UsageView {
  const who = identityOwnerKey(identity ?? GUEST_IDENTITY);
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    setOwner(who);
    if (active) refreshUsage();
  }, [who, active]);

  return usageView(snap);
}

/** Test seam — resets the module store between cases. */
export function __resetUsageStore() {
  snapshot = EMPTY;
  owner = GUEST_OWNER;
  generation = 0;
  inflight = false;
}

/** Test seam — adopt an owner and (optionally) verify, exactly as the hook's effect would. */
export function __adoptUsageOwner(who: string, active = true, now = Date.now()) {
  setOwner(who);
  if (active) refreshUsage(false, now);
}

/** Test seam — the currently published snapshot. */
export function __usageSnapshot(): UsageSnapshot { return snapshot; }
