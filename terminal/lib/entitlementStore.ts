"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  GUEST_IDENTITY, GUEST_OWNER, identityOwnerKey, isAccountOwner, type AccountIdentity,
} from "@/lib/accountIdentity";
import { normalizeSubscriptionTier, type SubscriptionTier } from "@/lib/subscriptionTier";
import { parseAccountPlan, type AccountPlan } from "@/lib/accountPlan";

/**
 * entitlementStore.ts — the ONE client-side reader of `GET /api/me` (E3/E4).
 *
 * ── What it replaces ──────────────────────────────────────────────────────────────────────
 *
 * There were two independent client truths about the same account, with different lifetimes and
 * opposite failure semantics:
 *
 *   * `lib/useEntitlement.ts` fetched `/api/me` once per mount, keyed on `!!email`, and turned an
 *     AUTHENTICATED failure into `free` — so a paid customer was silently degraded to Free
 *     whenever billing was briefly unreachable, and every mount re-asked.
 *   * `SettingsPanel` fetched and cached `/api/me` separately for Billing, keyed on the email,
 *     and then never re-fetched for the life of the mounted shell — so a user who upgraded
 *     through onboarding reopened Settings and was told they were still on Free.
 *
 * Two readers, two caches, two answers to one question. This module is the single canonical
 * one, keyed on the OWNER (lib/accountIdentity.ts), never the address.
 *
 * ── Why "unavailable" is its own state ────────────────────────────────────────────────────
 *
 * "We could not verify your entitlement" is not "you are Free" and it is not "you are Paid". The
 * server already preserves that distinction — a GUEST gets an explicit 200 Free default, while an
 * authenticated gateway failure is allowed to remain a failure — and collapsing it on the client
 * throws the information away. Both collapses are bad, in opposite directions:
 *
 *   * telling a paying customer they are Free because billing is down;
 *   * unlocking paid capability from a stale cache nobody re-verified.
 *
 * So there are TWO selectors over one state, and they deliberately disagree:
 *
 *   `displayEntitlement` — may show a SAME-OWNER last-good plan, flagged `stale`, so the pane can
 *     render "Pro · unable to refresh" instead of a lie or a spinner.
 *   `gateEntitlement`    — FAILS CLOSED. An unverified answer never newly unlocks protected
 *     capability, whatever the last-good said.
 *
 * A cross-owner last-good is never allowed in either: the cache is dropped outright on an owner
 * change, before anything of the incoming owner's is published.
 */

export type EntitlementState =
  /** Signed out. Free by definition, with no request spent establishing it. */
  | "GUEST_FREE"
  /** A verification is in flight and nothing same-owner is known yet. */
  | "LOADING"
  /** The authority answered: this account is on a free tier. */
  | "VERIFIED_FREE"
  /** The authority answered: this account is on a paid tier. */
  | "VERIFIED_PAID"
  /** The authority could not be reached, and there is no same-owner last-good to fall back on. */
  | "UNAVAILABLE"
  /** The authority could not be reached, but this SAME owner has a previously verified answer. */
  | "STALE_LAST_GOOD";

export type EntitlementSnapshot = {
  owner: string;
  state: EntitlementState;
  /** The last payload this OWNER verified, or null. Never another owner's. */
  plan: AccountPlan | null;
  /** When the plan above was verified (epoch ms), or 0. */
  verifiedAt: number;
};

const EMPTY: EntitlementSnapshot = { owner: GUEST_OWNER, state: "GUEST_FREE", plan: null, verifiedAt: 0 };

let snapshot: EntitlementSnapshot = EMPTY;
let owner = GUEST_OWNER;
let generation = 0;
let inflight = false;
const subs = new Set<() => void>();

function publish(next: Partial<EntitlementSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const fn of subs) fn();
}
function subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; }
function getSnapshot() { return snapshot; }
function getServerSnapshot() { return EMPTY; }

/**
 * Adopt an owner. Synchronous, and it drops the outgoing owner's payload BEFORE publishing
 * anything for the incoming one — a cross-owner last-good is never renderable, not even for the
 * frame between the switch and the first response.
 */
function setOwner(next: string) {
  if (owner === next) return false;
  owner = next;
  generation += 1;
  inflight = false;
  publish({
    owner: next,
    plan: null,
    verifiedAt: 0,
    state: isAccountOwner(next) ? "LOADING" : "GUEST_FREE",
  });
  return true;
}

/** Ask the authority. `force` re-asks even when a fresh verified answer is already held. */
export function refreshEntitlement(force = false): void {
  if (!isAccountOwner(owner)) return;
  if (inflight && !force) return;
  const gen = generation;
  inflight = true;
  // Keep whatever is already displayed while the refresh is out. A revalidation must not blank
  // a plan the user is looking at; only a FAILED first read has nothing to show.
  if (!snapshot.plan) publish({ state: "LOADING" });

  fetch("/api/me", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((raw) => {
      if (gen !== generation) return;                 // the owner changed mid-flight
      inflight = false;
      const plan = parseAccountPlan(raw);
      publish({
        plan,
        verifiedAt: Date.now(),
        state: normalizeSubscriptionTier(plan.tier) === "free" ? "VERIFIED_FREE" : "VERIFIED_PAID",
      });
    })
    .catch(() => {
      if (gen !== generation) return;
      inflight = false;
      // A read that did not land is NOT a Free account. If this same owner verified something
      // earlier, that is what we still know; otherwise we know nothing.
      publish({ state: snapshot.plan ? "STALE_LAST_GOOD" : "UNAVAILABLE" });
    });
}

/**
 * Drop the verified answer and re-ask. Call after an action that CHANGES the entitlement — a
 * completed checkout, a plan change, a portal return — so the pane does not keep showing the
 * plan the user just replaced.
 */
export function invalidateEntitlement(): void {
  if (!isAccountOwner(owner)) return;
  generation += 1;               // orphan any in-flight answer describing the pre-change plan
  inflight = false;
  publish({ plan: null, verifiedAt: 0, state: "LOADING" });
  refreshEntitlement(true);
}

/** How old the held answer is, in ms. `Infinity` when nothing has been verified. */
export function entitlementAgeMs(now = Date.now()): number {
  return snapshot.verifiedAt ? now - snapshot.verifiedAt : Infinity;
}

/**
 * Take `who` as the owner and verify if it is worth asking.
 *
 * A guest needs no request at all: the server answers Free for an unauthenticated caller by
 * design, so spending a round trip to learn it only slows the public UI down.
 *
 * UNAVAILABLE is re-asked on every adoption. The store it replaced was a per-mount hook that
 * re-asked on each mount; this one is module-level and outlives navigation, so without the
 * retry ONE failed verification would gate a paid account as Free for the rest of the SPA
 * session however many times they returned to a gated surface. A VERIFIED answer is not
 * re-asked (that is what the panel's TTL and explicit invalidation are for), and neither is a
 * STALE_LAST_GOOD — there is something same-owner to show and the gate is already closed.
 */
function adopt(who: string): void {
  const changed = setOwner(who);
  const worthAsking = changed || snapshot.state === "LOADING" || snapshot.state === "UNAVAILABLE";
  if (isAccountOwner(who) && worthAsking) refreshEntitlement();
}

// ── selectors ────────────────────────────────────────────────────────────────────────────

export type DisplayEntitlement = {
  tier: SubscriptionTier;
  /** The raw payload for the Billing pane (status, period end, source, interval, budget). */
  plan: AccountPlan | null;
  /** Nothing to show yet and a request is out. */
  loading: boolean;
  /** The authority could not be reached AND there is no same-owner last-good. */
  unavailable: boolean;
  /** `plan` is a same-owner last-good, not a fresh verification. Label it in the UI. */
  stale: boolean;
};

/**
 * What to SHOW. May present a same-owner last-good next to an "unable to refresh" note — a
 * paying customer must not be told they are Free because billing had a bad minute.
 */
export function displayEntitlement(s: EntitlementSnapshot = snapshot): DisplayEntitlement {
  const stale = s.state === "STALE_LAST_GOOD";
  return {
    tier: normalizeSubscriptionTier(s.plan?.tier),
    plan: s.plan,
    loading: s.state === "LOADING",
    unavailable: s.state === "UNAVAILABLE",
    stale,
  };
}

export type GateEntitlement = {
  tier: SubscriptionTier;
  features: string[];
  /** True while the answer is still being established — callers may show a skeleton, not a gate. */
  loading: boolean;
  /** The gate could not be verified. Treated as Free, and worth saying so rather than silently. */
  unverified: boolean;
};

/**
 * What to GATE on. FAILS CLOSED: only a verified answer grants anything. A stale last-good — even
 * a paid one — never NEWLY unlocks protected capability, because nobody re-checked that the
 * subscription still exists.
 *
 * This is the client-side hint lane. The server authority (lib/entitlement.ts → macro-api) is
 * unchanged and still decides; this only stops the UI from offering what the server will refuse.
 */
export function gateEntitlement(s: EntitlementSnapshot = snapshot): GateEntitlement {
  const verified = s.state === "VERIFIED_FREE" || s.state === "VERIFIED_PAID";
  return {
    tier: verified ? normalizeSubscriptionTier(s.plan?.tier) : "free",
    features: verified ? (s.plan?.features ?? []) : [],
    loading: s.state === "LOADING",
    unverified: s.state === "UNAVAILABLE" || s.state === "STALE_LAST_GOOD",
  };
}

// ── hooks ────────────────────────────────────────────────────────────────────────────────

/** Subscribe to the canonical snapshot, adopting `identity` as the owner. */
export function useEntitlementSnapshot(identity?: AccountIdentity | null): EntitlementSnapshot {
  const who = identityOwnerKey(identity ?? GUEST_IDENTITY);
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => { adopt(who); }, [who]);

  return snap;
}

/** The GATE selector, bound to the shell identity. Fails closed on an unverified answer. */
export function useGateEntitlement(identity?: AccountIdentity | null): GateEntitlement {
  return gateEntitlement(useEntitlementSnapshot(identity));
}

/** The DISPLAY selector, bound to the shell identity. May report a same-owner stale plan. */
export function useDisplayEntitlement(identity?: AccountIdentity | null): DisplayEntitlement & {
  refresh: () => void;
  invalidate: () => void;
} {
  const snap = useEntitlementSnapshot(identity);
  const refresh = useCallback(() => refreshEntitlement(true), []);
  const invalidate = useCallback(() => invalidateEntitlement(), []);
  return { ...displayEntitlement(snap), refresh, invalidate };
}

/** Test seam — resets the module store between cases. */
export function __resetEntitlementStore() {
  snapshot = EMPTY;
  owner = GUEST_OWNER;
  generation = 0;
  inflight = false;
}

/** Test seam — the same `adopt` the hook's effect calls, so the two cannot drift apart. */
export function __adoptEntitlementOwner(who: string) { adopt(who); }

/** Test seam — the currently published snapshot. */
export function __entitlementSnapshot(): EntitlementSnapshot { return snapshot; }
