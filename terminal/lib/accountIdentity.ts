/**
 * accountIdentity.ts — the ONE identity contract every owner-scoped client surface keys on.
 *
 * ── The contract ──────────────────────────────────────────────────────────────────────────
 *
 *   AccountIdentity =
 *     | { kind: "guest" }
 *     | { kind: "account", userId: <auth UUID>, email: <display / routing address> }
 *
 * `userId` is OWNERSHIP. `email` is mutable presentation and contact information.
 *
 * The distinction is not pedantry. An address can be changed, and a changed address must not
 * create a new preference owner: same UUID + new email = the same account, holding the same
 * watchlists, the same market prefs and the same entitlement. An address can also be RELEASED
 * and reassigned, at which point an email-keyed owner boundary hands the previous holder's
 * state to a stranger. `lib/watchlistOwner.ts` already draws its boundary on the uuid for
 * exactly that reason (bug-sweep A / PR #426); this module is that rule extracted so every
 * other owner-scoped lane draws it the same way instead of re-deciding per surface.
 *
 * ── Why an email WITHOUT a user id resolves to GUEST ───────────────────────────────────────
 *
 * A surface that knows an address but not a subject cannot name the account it would be
 * writing to. The safe direction is local-only: guest state is the one namespace that cannot
 * be the wrong one, and no authenticated write path reads it. A surface that means "signed in"
 * must supply the uuid — every shell does (`getClaims().sub`, or TerminalShell's `userId`).
 *
 * Deliberately free of React, Supabase and DOM imports: this is a pure contract module, so a
 * unit test can assert the boundary without a harness.
 */

export type AccountIdentity =
  | { kind: "guest" }
  | { kind: "account"; userId: string; email: string };

/** The single guest value. Frozen so a consumer cannot mutate the shared instance. */
export const GUEST_IDENTITY: AccountIdentity = Object.freeze({ kind: "guest" as const });

/** Owner key for a signed-out browser. Matches `lib/watchlistOwner.ts`'s namespace. */
export const GUEST_OWNER = "guest";

/** Prefix for an account owner key. Keeps the two spaces disjoint even if a uuid were "guest". */
const ACCOUNT_PREFIX = "account:";

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Resolve a shell's `(userId, email)` pair into the frozen contract above.
 *
 * A missing / blank `userId` is a GUEST regardless of the email — see the module note.
 */
export function accountIdentity(userId?: string | null, email?: string | null): AccountIdentity {
  const id = clean(userId);
  if (!id) return GUEST_IDENTITY;
  return { kind: "account", userId: id, email: clean(email) };
}

/** `guest` | `account:<uuid>` — the storage / cache namespace for one owner. */
export function ownerKeyFor(userId?: string | null): string {
  const id = clean(userId);
  return id ? `${ACCOUNT_PREFIX}${id}` : GUEST_OWNER;
}

/** The owner key an identity writes under. */
export function identityOwnerKey(identity: AccountIdentity | null | undefined): string {
  return identity && identity.kind === "account" ? ownerKeyFor(identity.userId) : GUEST_OWNER;
}

/** The uuid inside an owner key, or "" for guest. The inverse of `ownerKeyFor`. */
export function ownerUserId(owner: string): string {
  return owner.startsWith(ACCOUNT_PREFIX) ? owner.slice(ACCOUNT_PREFIX.length) : "";
}

/** True when this owner key names a real account (i.e. a network write is addressable). */
export function isAccountOwner(owner: string): boolean {
  return !!ownerUserId(owner);
}

/** The immutable id, or "" for a guest. */
export function identityUserId(identity: AccountIdentity | null | undefined): string {
  return identity && identity.kind === "account" ? identity.userId : "";
}

/** The display / routing address, or "" for a guest. NEVER an ownership key. */
export function identityEmail(identity: AccountIdentity | null | undefined): string {
  return identity && identity.kind === "account" ? identity.email : "";
}

/**
 * Do two identities name the SAME owner? An email change is not an owner change — that is the
 * whole point of the contract, and the assertion this predicate exists to make testable.
 */
export function sameOwner(
  a: AccountIdentity | null | undefined,
  b: AccountIdentity | null | undefined,
): boolean {
  return identityOwnerKey(a) === identityOwnerKey(b);
}
