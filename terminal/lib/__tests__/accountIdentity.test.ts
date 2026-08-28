/**
 * The frozen identity contract (E0).
 *
 * Every assertion here exists because the opposite behaviour was, or would be, a real ownership
 * failure rather than a style preference:
 *
 *   • keying an owner on the EMAIL forks one account's state in two the moment the user changes
 *     their address, and hands a released address's state to whoever inherits it;
 *   • treating an email WITHOUT a uuid as "signed in" names an account we cannot actually
 *     address, so writes would go somewhere unverifiable.
 */
import { describe, it, expect } from "vitest";
import {
  accountIdentity, GUEST_IDENTITY, GUEST_OWNER, identityEmail, identityOwnerKey, identityUserId,
  isAccountOwner, ownerKeyFor, ownerUserId, sameOwner,
} from "@/lib/accountIdentity";

const UUID_A = "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22";
const UUID_B = "0b6d1f57-3c84-4a11-8e29-6d40cc1b7f93";

describe("accountIdentity — resolving a shell's (userId, email) pair", () => {
  it("builds an account identity from a uuid, carrying the email as presentation only", () => {
    expect(accountIdentity(UUID_A, "chris@example.com"))
      .toEqual({ kind: "account", userId: UUID_A, email: "chris@example.com" });
  });

  it("resolves an email WITHOUT a user id to GUEST — an unnameable account is never an account", () => {
    expect(accountIdentity("", "chris@example.com")).toEqual({ kind: "guest" });
    expect(accountIdentity(null, "chris@example.com")).toEqual({ kind: "guest" });
    expect(accountIdentity(undefined, "chris@example.com")).toEqual({ kind: "guest" });
    expect(accountIdentity("   ", "chris@example.com")).toEqual({ kind: "guest" });
  });

  it("is an account even with NO email — the uuid alone is what ownership needs", () => {
    expect(accountIdentity(UUID_A)).toEqual({ kind: "account", userId: UUID_A, email: "" });
  });

  it("trims, so a padded claim cannot mint a second owner key for one account", () => {
    expect(accountIdentity(` ${UUID_A} `, " chris@example.com "))
      .toEqual({ kind: "account", userId: UUID_A, email: "chris@example.com" });
  });
});

describe("owner keys", () => {
  it("namespaces an account under its uuid and a signed-out browser under guest", () => {
    expect(ownerKeyFor(UUID_A)).toBe(`account:${UUID_A}`);
    expect(ownerKeyFor("")).toBe(GUEST_OWNER);
    expect(identityOwnerKey(GUEST_IDENTITY)).toBe(GUEST_OWNER);
    expect(identityOwnerKey(null)).toBe(GUEST_OWNER);
  });

  it("keeps the two spaces disjoint even for the pathological id 'guest'", () => {
    expect(ownerKeyFor("guest")).toBe("account:guest");
    expect(ownerKeyFor("guest")).not.toBe(GUEST_OWNER);
  });

  it("round-trips a uuid through the key, and reports guest as not-an-account", () => {
    expect(ownerUserId(ownerKeyFor(UUID_A))).toBe(UUID_A);
    expect(ownerUserId(GUEST_OWNER)).toBe("");
    expect(isAccountOwner(ownerKeyFor(UUID_A))).toBe(true);
    expect(isAccountOwner(GUEST_OWNER)).toBe(false);
  });
});

describe("the boundary rule", () => {
  it("SAME uuid + a CHANGED email is the SAME owner — an address change is not an account change", () => {
    const before = accountIdentity(UUID_A, "old@example.com");
    const after = accountIdentity(UUID_A, "new@example.com");
    expect(sameOwner(before, after)).toBe(true);
    expect(identityOwnerKey(before)).toBe(identityOwnerKey(after));
  });

  it("DIFFERENT uuids at the SAME address are DIFFERENT owners — an address can be reassigned", () => {
    const first = accountIdentity(UUID_A, "desk@example.com");
    const second = accountIdentity(UUID_B, "desk@example.com");
    expect(sameOwner(first, second)).toBe(false);
    expect(identityOwnerKey(first)).not.toBe(identityOwnerKey(second));
  });

  it("never treats a guest and an account as the same owner", () => {
    expect(sameOwner(GUEST_IDENTITY, accountIdentity(UUID_A, ""))).toBe(false);
  });
});

describe("accessors", () => {
  it("reads the id and the address off an identity, and empty strings off a guest", () => {
    const id = accountIdentity(UUID_A, "chris@example.com");
    expect([identityUserId(id), identityEmail(id)]).toEqual([UUID_A, "chris@example.com"]);
    expect([identityUserId(GUEST_IDENTITY), identityEmail(GUEST_IDENTITY)]).toEqual(["", ""]);
    expect([identityUserId(null), identityEmail(undefined)]).toEqual(["", ""]);
  });
});
