import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  decideTenantScope,
  isKnownVisibility,
  TENANT_SCOPE_REASONS,
  type Grant,
  type Identity,
  type Membership,
  type ScopedResource,
} from "@/lib/tenantScope";

describe("tenantScope decision function", () => {
  it("has no runtime imports, no I/O, no framework", () => {
    const src = readFileSync(new URL("../tenantScope.ts", import.meta.url), "utf8");
    const importLines = src.split("\n").filter((l) => /^\s*import\s+/.test(l));
    for (const line of importLines) {
      expect(line).toMatch(/^\s*import\s+type\b/);
    }
    for (const banned of [
      "next/",
      '"react"',
      "@supabase",
      "node:",
      "server-only",
      "@/lib/",
      "fetch(",
      "process.env",
      "Date.now(",
      "Math.random(",
    ]) {
      expect(src).not.toContain(banned);
    }
  });

  const identity: Identity = { userId: "u1" };
  const owned: ScopedResource = { id: "res-1", ownerId: "u1", teamId: "team-a", visibility: "private" };

  it("is deterministic across repeated calls", () => {
    const memberships: Membership[] = [{ userId: "u1", teamId: "team-a", role: "member", revokedAt: null }];
    const grants: Grant[] = [];
    const a = decideTenantScope(identity, memberships, owned, grants);
    const b = decideTenantScope(identity, memberships, owned, grants);
    expect(a).toEqual(b);
  });

  it("does not mutate its inputs", () => {
    const memberships: Membership[] = [{ userId: "u1", teamId: "team-a", role: "member", revokedAt: null }];
    const grants: Grant[] = [{ resourceId: "res-1", granteeUserId: "u1", revokedAt: null }];
    const resource: ScopedResource = { ...owned };
    const identityClone = { ...identity };
    const membershipsClone = memberships.map((m) => ({ ...m }));
    const grantsClone = grants.map((g) => ({ ...g }));
    const resourceClone = { ...resource };

    decideTenantScope(identity, memberships, resource, grants);

    expect(identity).toEqual(identityClone);
    expect(memberships).toEqual(membershipsClone);
    expect(grants).toEqual(grantsClone);
    expect(resource).toEqual(resourceClone);
  });

  it("fails closed on an unrecognized visibility, even for the owner", () => {
    const base = { id: "res-2", ownerId: "u1", teamId: null };
    const denyUnrecognized = ["public", "PRIVATE", "shared", 0 as unknown as string, {} as unknown as string];
    for (const visibility of denyUnrecognized) {
      const decision = decideTenantScope(identity, [], { ...base, visibility }, []);
      expect(decision).toEqual({ allow: false, reason: "visibility_unrecognized" });
    }
    const denyAbsent: (string | null | undefined)[] = ["", " ", null, undefined];
    for (const visibility of denyAbsent) {
      const decision = decideTenantScope(identity, [], { ...base, visibility: visibility as string | null }, []);
      expect(decision).toEqual({ allow: false, reason: "visibility_absent" });
    }
  });

  it("honours row order — owner outranks an existing grant", () => {
    const resource: ScopedResource = { id: "res-3", ownerId: "u1", teamId: null, visibility: "private" };
    const grants: Grant[] = [{ resourceId: "res-3", granteeUserId: "u1", revokedAt: null }];
    const decision = decideTenantScope(identity, [], resource, grants);
    expect(decision).toEqual({ allow: true, reason: "owner_match", via: "owner" });
  });

  it("honours row order — grant outranks team membership", () => {
    const resource: ScopedResource = { id: "res-4", ownerId: "u2", teamId: "team-a", visibility: "team" };
    const grants: Grant[] = [{ resourceId: "res-4", granteeUserId: "u1", revokedAt: null }];
    const memberships: Membership[] = [{ userId: "u1", teamId: "team-a", role: "member", revokedAt: null }];
    const decision = decideTenantScope(identity, memberships, resource, grants);
    expect(decision).toEqual({ allow: true, reason: "explicit_grant", via: "grant" });
  });

  it("BLOCKER: a membership row belonging to a different user never grants access", () => {
    // A caller could mis-source `memberships` from a team-wide reader (e.g.
    // `listMembers`, PR #514 diff line 286) instead of the identity-scoped
    // `listTeams` (PR #514 diff line 368). Even then, a membership row whose
    // `userId` is not the caller's must be invisible to the decision.
    const resource: ScopedResource = { id: "res-5", ownerId: "u3", teamId: "team-a", visibility: "team" };
    const foreignMemberships: Membership[] = [{ userId: "u2", teamId: "team-a", role: "member", revokedAt: null }];
    const decision = decideTenantScope(identity, foreignMemberships, resource, []);
    expect(decision).toEqual({ allow: false, reason: "no_membership" });
  });

  it("MAJOR: an active team membership outranks an unrelated revoked grant", () => {
    // A revoked one-off grant to THIS resource must never deny a user who
    // separately holds an active membership on the resource's team.
    const resource: ScopedResource = { id: "res-6", ownerId: "u2", teamId: "team-a", visibility: "team" };
    const memberships: Membership[] = [{ userId: "u1", teamId: "team-a", role: "member", revokedAt: null }];
    const grants: Grant[] = [{ resourceId: "res-6", granteeUserId: "u1", revokedAt: "2026-01-01T00:00:00Z" }];
    const decision = decideTenantScope(identity, memberships, resource, grants);
    expect(decision).toEqual({ allow: true, reason: "team_member_visible", via: "membership" });
  });

  it("BLOCKER: an empty-string revokedAt on a grant is treated as revoked, not active", () => {
    // Bare truthiness (`!g.revokedAt`) reads "" as falsy, i.e. NOT revoked —
    // fail-OPEN on a malformed/truncated write. This module fails closed:
    // any present revokedAt value, empty string included, denies.
    const resource: ScopedResource = { id: "res-7", ownerId: "u2", teamId: null, visibility: "private" };
    const grants: Grant[] = [{ resourceId: "res-7", granteeUserId: "u1", revokedAt: "" }];
    const decision = decideTenantScope(identity, [], resource, grants);
    expect(decision).toEqual({ allow: false, reason: "grant_revoked" });
  });

  it("BLOCKER: an empty-string revokedAt on a membership is treated as revoked, not active", () => {
    const resource: ScopedResource = { id: "res-8", ownerId: "u2", teamId: "team-a", visibility: "team" };
    const memberships: Membership[] = [{ userId: "u1", teamId: "team-a", role: "member", revokedAt: "" }];
    const decision = decideTenantScope(identity, memberships, resource, []);
    expect(decision).toEqual({ allow: false, reason: "membership_revoked" });
  });

  it("carries `via` on every allow and omits it on every deny", () => {
    const allow = decideTenantScope(identity, [], owned, []);
    expect("via" in allow).toBe(allow.allow);

    const deny = decideTenantScope(null, [], owned, []);
    expect("via" in deny).toBe(deny.allow);
  });

  it("only ever returns a totalized reason", () => {
    const cases: Array<[Identity | null, Membership[], ScopedResource | null, Grant[]]> = [
      [null, [], null, []],
      [identity, [], null, []],
      [identity, [], { id: "x", ownerId: "u2", teamId: null, visibility: null }, []],
      [identity, [], { id: "x", ownerId: "u2", teamId: null, visibility: "public" }, []],
      [identity, [], owned, []],
    ];
    for (const [id, memberships, resource, grants] of cases) {
      const decision = decideTenantScope(id, memberships, resource, grants);
      expect(TENANT_SCOPE_REASONS).toContain(decision.reason);
    }
  });

  it("isKnownVisibility recognizes exactly the V1 set", () => {
    expect(isKnownVisibility("private")).toBe(true);
    expect(isKnownVisibility("team")).toBe(true);
    expect(isKnownVisibility("public")).toBe(false);
    expect(isKnownVisibility("Private")).toBe(false);
    expect(isKnownVisibility(null)).toBe(false);
    expect(isKnownVisibility(undefined)).toBe(false);
    expect(isKnownVisibility("")).toBe(false);
    expect(isKnownVisibility(1)).toBe(false);
  });
});
