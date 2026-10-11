/** Browser auth-lifecycle fence for intlPolicyPreviewSession (internal, unmounted).
 *
 * Exposes only an opaque auth_epoch, the principal partition (the auth user id,
 * the same nonsecret value the Terminal already keys owners on) and an honest
 * availability. It is transient browser fencing for late replies, never an
 * access decision: server auth stays the authority for every request.
 *
 * Source is the existing browser auth owner (./client: the @supabase/ssr
 * 0.12.0 browser singleton over auth-js 2.108.2). One onAuthStateChange
 * subscription per caller; no second client, no storage, no logging. The
 * callback is synchronous, never throws back into the SDK (auth-js rethrows
 * the first subscriber error from every notification) and makes no Supabase
 * call. On its custom-lock path auth-js delivers the callback while holding its
 * auth lock; the Terminal's client passes no lock, so 2.108.2 runs lockless.
 *
 * Observation: (sub, session_id, aal) decoded from the access token payload,
 * with a readable user.id equal to sub. Decoding is not verification. It only
 * keys the fence and never grants "ready" on its own, whatever the user field
 * holds (missing, null or auth-js's user-not-available proxy).
 *
 * Verification: "ready" is published only after the same client's
 * auth.getClaims(token) verifies the exact token observed. The check starts on
 * a later task (setTimeout 0), never inside the callback, and with an explicit
 * token getClaims takes no auth lock. It checks expiry and an asymmetric
 * signature against the project JWKS, or asks the auth server (getUser) when
 * the key is symmetric. Its claims must equal the observation exactly, or the
 * identity fails closed. An error, a throw or a missing result leaves the
 * identity unverified on the same epoch until the SDK's next event; nothing
 * retries on its own. The token lives only in the one pending check and is
 * never stored, exposed or logged.
 *
 * Generation fence: every event that changes the state or carries a new token
 * replaces or voids the pending check, and so does unsubscribe. A result
 * applies only while its check is still the pending one, so it cannot restore
 * "ready" after sign-out, another principal, A-B-A, reauthentication, a newer
 * event, recovery or unsubscribe.
 *
 * auth_epoch is 128 random bits minted here whenever the fenced identity
 * changes. It is never derived from an owner key, a clock, a generation or a
 * qualification, and an identity that comes back (A, B, A) gets a new epoch.
 *
 * Event policy:
 * - INITIAL_SESSION: honoured only as the first event this subscription hears,
 *   then checked like any other. After any other event it is a stale storage
 *   read and is ignored, so it never replaces a later session.
 * - SIGNED_IN, TOKEN_REFRESHED: a new (sub, session_id, aal) gets a new epoch
 *   and stays unverified until checked. The same identity already ready keeps
 *   "ready" and its epoch with no new check (duplicate, focus or cross-tab
 *   SIGNED_IN, same-session refresh). The same identity still unverified is
 *   checked again with the token just observed.
 * - USER_UPDATED: always a new epoch, unverified until checked, and it ends a
 *   recovery hold. auth-js emits it after updateUser (a password change
 *   included) with the same session and token, so equal claims prove nothing.
 *   Harmless profile edits invalidate too.
 * - MFA_CHALLENGE_VERIFIED: always a new epoch, unverified until checked.
 * - PASSWORD_RECOVERY: a new epoch on entry and no check; unverified until
 *   USER_UPDATED or another identity. A reset link proves control of the
 *   mailbox, not a finished reset. The hold lives in this subscription only.
 * - SIGNED_OUT, a null session, an unreadable observation, verified claims
 *   that differ, an unknown event or a failure here: unavailable, principal
 *   null, and a new epoch when an identity was held (the old one is kept only
 *   when no new epoch can be minted; principal null still changes the binding).
 *
 * getSnapshot() is current as soon as the callback or a check result returns.
 * Listeners are told afterwards on a separate task, coalesced, so consumer
 * code never runs inside the SDK callback. A consumer rebinds from
 * getSnapshot() before accepting a reply and starts a preview only while
 * availability is "ready". */
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
  /** auth-js getClaims with an explicit token: SDK-owned verification. */
  getClaims(jwt: string): Promise<unknown>;
}

type Identity = { readonly principal: string; readonly session: string; readonly aal: string | null };
type State = {
  readonly availability: AuthAvailability;
  readonly identity: Identity | null;
  readonly recovery: boolean;
  readonly epoch: string;
};
/** The next state, and whether the token just observed must be checked. */
type Step = { readonly state: State; readonly check: boolean };
type Check = { readonly token: string };

const SESSION_EVENTS = new Set<string>([
  "INITIAL_SESSION",
  "SIGNED_IN",
  "TOKEN_REFRESHED",
  "USER_UPDATED",
  "MFA_CHALLENGE_VERIFIED",
  "PASSWORD_RECOVERY",
]);
/** Always a new epoch, even for the same identity. */
const ROTATING = new Set<string>(["USER_UPDATED", "MFA_CHALLENGE_VERIFIED"]);
const BASE64URL = /^[A-Za-z0-9_-]+$/;
/** Paired only with "unavailable", when no epoch could be minted at all. */
const NO_EPOCH = "";

function mintEpoch(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromClaims(claims: unknown): Identity | null {
  if (claims === null || typeof claims !== "object" || Array.isArray(claims)) return null;
  const { sub, session_id: session, aal } = claims as Record<string, unknown>;
  if (typeof sub !== "string" || !sub || typeof session !== "string" || !session) return null;
  if (aal !== undefined && typeof aal !== "string") return null;
  return { principal: sub, session, aal: aal ?? null };
}

/** Unverified local decode of the access-token payload. */
function decodeClaims(token: string): Identity | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !BASE64URL.test(parts[1])) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return fromClaims(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch {
    return null;
  }
}

function observe(session: Session | null): { identity: Identity; token: string } | null {
  if (session === null || typeof session !== "object") return null;
  let token: unknown;
  try {
    token = session.access_token;
  } catch {
    return null;
  }
  if (typeof token !== "string") return null;
  const identity = decodeClaims(token);
  if (identity === null) return null;
  let userId: unknown;
  try {
    userId = session.user?.id;
  } catch {
    userId = undefined; // auth-js's "user not available" proxy throws on read
  }
  return userId === undefined || userId === identity.principal ? { identity, token } : null;
}

/** Claims from a successful getClaims result; null when it is not one. */
function verifiedClaims(result: unknown): unknown {
  if (result === null || typeof result !== "object") return null;
  const { data, error } = result as { data?: unknown; error?: unknown };
  if (error !== null || data === null || typeof data !== "object") return null;
  const claims = (data as { claims?: unknown }).claims;
  return claims !== null && typeof claims === "object" && !Array.isArray(claims) ? claims : null;
}

function sameIdentity(a: Identity | null, b: Identity | null): boolean {
  return a !== null && b !== null && a.principal === b.principal && a.session === b.session && a.aal === b.aal;
}

function closed(epoch: string): State {
  return { availability: "unavailable", identity: null, recovery: false, epoch };
}

/** Pure transition; only mint() can throw. Never grants "ready": only a check result does. */
function transition(prev: State, event: string, identity: Identity | null, mint: () => string): Step {
  if (identity === null || !SESSION_EVENTS.has(event)) {
    return { state: closed(prev.identity === null ? prev.epoch : mint()), check: false };
  }
  const same = sameIdentity(prev.identity, identity);
  if (event === "PASSWORD_RECOVERY") {
    if (same && prev.recovery) return { state: prev, check: false };
    return { state: { availability: "unverified", identity, recovery: true, epoch: mint() }, check: false };
  }
  if (same && !ROTATING.has(event)) {
    if (prev.recovery || prev.availability === "ready") return { state: prev, check: false };
    return { state: prev, check: true };
  }
  return { state: { availability: "unverified", identity, recovery: false, epoch: mint() }, check: true };
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
  let heard = false;
  let auth: AuthObserver | null = null;
  let pending: Check | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
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

  const settle = (mine: Check, result: unknown) => {
    if (pending !== mine) return; // superseded, voided or unsubscribed
    pending = null;
    try {
      const claims = verifiedClaims(result);
      if (claims === null) return; // not verified: stays unverified on this epoch
      if (sameIdentity(fromClaims(claims), state.identity)) commit({ ...state, availability: "ready" });
      else commit(closed(mintEpoch()));
    } catch {
      commit(closed(state.epoch));
    }
  };

  const startCheck = () => {
    checkTimer = undefined;
    const mine = pending;
    if (mine === null) return;
    let result: Promise<unknown>;
    try {
      result = Promise.resolve((auth as AuthObserver).getClaims(mine.token));
    } catch (error) {
      result = Promise.reject(error);
    }
    result.then((r) => settle(mine, r), () => settle(mine, null));
  };

  const onEvent = (event: AuthChangeEvent, session: Session | null): void => {
    if (disposed) return;
    if (event === "INITIAL_SESSION" && heard) return; // a stale storage read
    heard = true;
    try {
      const seen = observe(session);
      const step = transition(state, event, seen?.identity ?? null, mintEpoch);
      if (step.state !== state || !step.check) pending = null;
      if (step.check && seen !== null && pending?.token !== seen.token) {
        pending = { token: seen.token };
        if (checkTimer === undefined) checkTimer = setTimeout(startCheck, 0);
      }
      commit(step.state);
    } catch {
      pending = null;
      commit(closed(state.epoch));
    }
  };

  const unsubscribe = () => {
    if (disposed) return;
    disposed = true;
    pending = null;
    if (timer !== undefined) clearTimeout(timer);
    if (checkTimer !== undefined) clearTimeout(checkTimer);
    timer = checkTimer = undefined;
    try {
      subscription?.unsubscribe();
    } catch {
      // the callback is inert once disposed
    }
    retire();
  };

  try {
    auth = authFactory();
    const result = auth.onAuthStateChange(onEvent);
    const candidate = result?.data?.subscription;
    if (candidate && typeof candidate.unsubscribe === "function") subscription = candidate;
  } catch {
    subscription = null;
  }
  // No observer means no lifecycle: fail closed and stay inert.
  if (subscription === null) unsubscribe();

  return { getSnapshot: () => snapshot, unsubscribe };
}
