/** Browser auth-lifecycle fence for intlPolicyPreviewSession (internal, unmounted).
 *
 * Exposes only an opaque auth_epoch, the principal partition (the auth user id,
 * the same nonsecret value the Terminal already keys owners on) and an honest
 * availability. It is transient browser fencing for late replies, never an
 * access decision: server auth stays the authority for every request.
 *
 * Source is the existing browser auth owner (./client: the @supabase/ssr
 * 0.12.0 browser singleton over auth-js 2.108.2). One onAuthStateChange
 * subscription per caller; no second client, no Supabase call, no storage, no
 * logging. The callback is synchronous and never throws back into the SDK
 * (auth-js rethrows the first subscriber error from every notification).
 *
 * Identity is (sub, session_id, aal) read from the access token payload. That
 * is an unverified local claim read, not a signature check or validator. A
 * readable user.id must equal sub. The token, the session object and
 * session_id never leave this closure and are never exposed.
 *
 * auth_epoch is 128 random bits minted here whenever the fenced identity
 * changes. It is never derived from an owner key, a clock, a generation or a
 * qualification, and an identity that comes back (A, B, A) gets a new epoch.
 *
 * Event policy:
 * - SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED: ready. A new epoch only when
 *   (sub, session_id, aal) changed, so a duplicate, focus or cross-tab
 *   SIGNED_IN and a same-session refresh keep the epoch (the frozen reducer
 *   discards the draft on every epoch change). A new session for the same
 *   user gets a new epoch.
 * - MFA_CHALLENGE_VERIFIED: ready, always a new epoch (step-up ceremony).
 * - INITIAL_SESSION: storage-loaded, so unverified, unless the same identity
 *   is already ready (the SDK delivers it after init events).
 * - PASSWORD_RECOVERY: a new epoch on entry, then unverified until
 *   USER_UPDATED. A reset link proves control of the mailbox, not a finished
 *   reset. The hold lives in this subscription only.
 * - SIGNED_OUT, a null session, an unreadable identity, an unknown event or a
 *   failure here: unavailable, principal null, and a new epoch when an
 *   identity was held.
 *
 * "ready" certifies that the SDK delivered a confirming event for this
 * identity; init and focus SIGNED_IN re-read browser storage. A subscriber
 * that attaches after the singleton initialized hears only INITIAL_SESSION
 * and stays unverified until the SDK's next confirming event.
 *
 * getSnapshot() is current as soon as the callback returns. Listeners are told
 * afterwards on a separate task, coalesced, so consumer code never runs inside
 * the SDK callback. A consumer rebinds from getSnapshot() before accepting a
 * reply and starts a preview only while availability is "ready". */
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { createClient } from "./client";

export type AuthAvailability = "pending" | "unverified" | "ready" | "unavailable";

export interface AuthLifecycleSnapshot {
  readonly availability: AuthAvailability;
  readonly principal_partition: string | null;
  readonly auth_epoch: string;
}

export interface AuthLifecycleSubscription {
  getSnapshot(): AuthLifecycleSnapshot;
  unsubscribe(): void;
}

export interface AuthObserver {
  onAuthStateChange(callback: (event: AuthChangeEvent, session: Session | null) => void): {
    data: { subscription: { unsubscribe(): void } };
  };
}

type Identity = { readonly principal: string; readonly session: string; readonly aal: string | null };
type State = {
  readonly availability: AuthAvailability;
  readonly identity: Identity | null;
  readonly recovery: boolean;
  readonly epoch: string;
};

const CONFIRMING = new Set<string>(["SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED", "MFA_CHALLENGE_VERIFIED"]);
const SESSION_EVENTS = new Set<string>([...CONFIRMING, "INITIAL_SESSION", "PASSWORD_RECOVERY"]);
const BASE64URL = /^[A-Za-z0-9_-]+$/;
/** Paired only with "unavailable", when no epoch could be minted at all. */
const NO_EPOCH = "";

function mintEpoch(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function readClaims(token: unknown): Identity | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !BASE64URL.test(parts[1])) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (claims === null || typeof claims !== "object" || Array.isArray(claims)) return null;
    const { sub, session_id: session, aal } = claims as Record<string, unknown>;
    if (typeof sub !== "string" || !sub || typeof session !== "string" || !session) return null;
    if (aal !== undefined && typeof aal !== "string") return null;
    return { principal: sub, session, aal: aal ?? null };
  } catch {
    return null;
  }
}

function readIdentity(session: Session | null): Identity | null {
  if (session === null || typeof session !== "object") return null;
  let identity: Identity | null;
  try {
    identity = readClaims(session.access_token);
  } catch {
    return null;
  }
  if (identity === null) return null;
  let userId: unknown;
  try {
    userId = session.user?.id;
  } catch {
    userId = undefined; // auth-js's "user not available" proxy throws on read; sub stands alone
  }
  return userId === undefined || userId === identity.principal ? identity : null;
}

function sameIdentity(a: Identity | null, b: Identity): boolean {
  return a !== null && a.principal === b.principal && a.session === b.session && a.aal === b.aal;
}

function closed(epoch: string): State {
  return { availability: "unavailable", identity: null, recovery: false, epoch };
}

/** Pure transition; only mint() can throw. */
function transition(prev: State, event: string, identity: Identity | null, mint: () => string): State {
  if (identity === null || !SESSION_EVENTS.has(event)) {
    return closed(prev.identity === null ? prev.epoch : mint());
  }
  const same = sameIdentity(prev.identity, identity);
  const enteringRecovery = event === "PASSWORD_RECOVERY" && !(same && prev.recovery);
  const rotate = !same || event === "MFA_CHALLENGE_VERIFIED" || enteringRecovery;
  const recovery = event === "PASSWORD_RECOVERY" || (event !== "USER_UPDATED" && same && prev.recovery);
  let availability: AuthAvailability;
  if (recovery) availability = "unverified";
  else if (CONFIRMING.has(event)) availability = "ready";
  else availability = !rotate && prev.availability === "ready" ? "ready" : "unverified";
  return { availability, identity, recovery, epoch: rotate ? mint() : prev.epoch };
}

function toSnapshot(state: State): AuthLifecycleSnapshot {
  return Object.freeze({
    availability: state.availability,
    principal_partition: state.identity?.principal ?? null,
    auth_epoch: state.epoch,
  });
}

export function subscribeAuthLifecycle(
  listener: (snapshot: AuthLifecycleSnapshot) => void,
  authFactory: () => AuthObserver = () => createClient().auth,
): AuthLifecycleSubscription {
  let state: State;
  try {
    state = { availability: "pending", identity: null, recovery: false, epoch: mintEpoch() };
  } catch {
    const snapshot = toSnapshot(closed(NO_EPOCH));
    return { getSnapshot: () => snapshot, unsubscribe: () => {} };
  }
  let snapshot = toSnapshot(state);
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let subscription: { unsubscribe(): void } | null = null;

  const retire = () => {
    let epoch = state.epoch;
    try {
      if (state.identity !== null) epoch = mintEpoch();
    } catch {
      // keep the old epoch; principal null still changes the binding
    }
    state = closed(epoch);
    snapshot = toSnapshot(state);
  };

  const commit = (next: State) => {
    state = next;
    const prev = snapshot;
    if (
      prev.availability === next.availability &&
      prev.principal_partition === (next.identity?.principal ?? null) &&
      prev.auth_epoch === next.epoch
    ) return;
    snapshot = toSnapshot(next);
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (disposed) return;
      try {
        listener(snapshot);
      } catch {
        // a consumer failure never reaches the SDK or the next notification
      }
    }, 0);
  };

  const onEvent = (event: AuthChangeEvent, session: Session | null): void => {
    if (disposed) return;
    try {
      commit(transition(state, event, readIdentity(session), mintEpoch));
    } catch {
      commit(closed(state.epoch));
    }
  };

  const unsubscribe = () => {
    if (disposed) return;
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    try {
      subscription?.unsubscribe();
    } catch {
      // the callback is inert once disposed
    }
    retire();
  };

  try {
    const result = authFactory().onAuthStateChange(onEvent);
    const candidate = result?.data?.subscription;
    if (candidate && typeof candidate.unsubscribe === "function") subscription = candidate;
  } catch {
    subscription = null;
  }
  // No observer means no lifecycle: fail closed and stay inert.
  if (subscription === null) unsubscribe();

  return { getSnapshot: () => snapshot, unsubscribe };
}
