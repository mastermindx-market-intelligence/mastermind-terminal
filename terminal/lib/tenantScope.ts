// tenantScope.ts — pure application-side tenant scope decision.
//
// This module is one deterministic function: given an identity, the caller's
// memberships, a resource, and any explicit grants, it decides whether the
// identity may see the resource, and why. It has NO I/O and imports NOTHING
// at runtime (only `import type` from itself) — no framework, no database
// client, no fetch. The database-side authority is Row Level Security in
// migration 0014 (tenancy foundation, Terminal PR #514) — unmerged and
// self-declared NOT APPLIED at line 10 of that migration. This module is the
// application-side SECOND gate, never a replacement for RLS.
// TODO(F12): once PR #514 merges, restore the literal migration path in
// this comment (supabase, migrations dir, file "0014_tenancy_foundation" +
// ".sql") — it is worded without that literal for now only because
// tests/test_migration_ledger.py::test_referenced_migration_filenames_exist
// would otherwise fail on a file that does not exist on master yet.
//
// Every `reason` string here is internal and machine-readable — it is never
// user-facing. A caller that needs to show something to a person maps the
// reason to the plain-language sentence in
// docs/F12_TENANT_SCOPE_CONTRACT_2026-09-06.md §5.

// ── vocabulary ─────────────────────────────────────────────────────────────

/** Mirrors terminal/lib/teams.ts:21 (PR #514). Duplicated, not imported: teams.ts
 *  reaches into the watchlists module and a Node builtin, and this module must stay I/O-free. */
export type TeamRole = "owner" | "admin" | "member";

/** V1 supports exactly two values. "public" is NOT supported and denies (fail closed). */
export type Visibility = "private" | "team";
export const TENANT_SCOPE_VISIBILITIES: readonly Visibility[] = ["private", "team"];

export type Identity = { userId: string | null };

/** `userId` is REQUIRED and is the row's owner: the decision function only ever
 *  honours a membership whose `userId` matches the calling `identity.userId`. This
 *  is load-bearing — `listMembers(session.db, session.userId, teamId)` in
 *  `terminal/lib/teams.ts` (PR #514) returns every member of a team, i.e. OTHER
 *  users' rows too. A caller must build `memberships` from
 *  `listTeams(session.db, session.userId)` (same file, PR #514), which is
 *  identity-scoped; but even if a caller passes the wrong (team-wide) source by
 *  mistake, this module still only honours rows
 *  that carry the caller's own `userId` — a foreign membership row can never grant
 *  access. A revoked membership is carried as a FACT on the input, never read from
 *  a clock — that is what keeps "revoked membership denies immediately" testable
 *  in a pure function. */
export type Membership = { userId: string; teamId: string; role: TeamRole; revokedAt?: string | null };

/** No `resource_grants` table exists (see the doc's Nulls Printed section). A Grant is
 *  caller-supplied. */
export type Grant = { resourceId: string; granteeUserId: string; revokedAt?: string | null };

/** `ownerId` is the caller's mapping of the canonical `user_id` column
 *  (0001_init.sql:31 etc.). `visibility` is deliberately `string | null`, NOT `Visibility`:
 *  an unknown value must REACH the decider so it can fail closed. */
export type ScopedResource = {
  id: string;
  ownerId: string | null;
  teamId: string | null;
  visibility: string | null;
};

export type AllowReason = "owner_match" | "explicit_grant" | "team_member_visible";
export type DenyReason =
  | "no_identity"
  | "malformed_resource"
  | "visibility_absent"
  | "visibility_unrecognized"
  | "grant_revoked"
  | "private_not_owner"
  | "resource_has_no_team"
  | "membership_revoked"
  | "wrong_team"
  | "no_membership";
export type TenantScopeReason = AllowReason | DenyReason;

/** Declaration order is load-bearing: the conformance table is ordered by it,
 *  and it mirrors the decision function's evaluation order below. */
export const TENANT_SCOPE_REASONS: readonly TenantScopeReason[] = [
  "no_identity",
  "malformed_resource",
  "visibility_absent",
  "visibility_unrecognized",
  "owner_match",
  "explicit_grant",
  "team_member_visible",
  "grant_revoked",
  "private_not_owner",
  "resource_has_no_team",
  "membership_revoked",
  "wrong_team",
  "no_membership",
];

export type ScopeDecision =
  | { allow: true; reason: AllowReason; via: "owner" | "grant" | "membership" }
  | { allow: false; reason: DenyReason };

// ── helpers (private) ───────────────────────────────────────────────────────

function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// A revocation timestamp is meaningful only as a genuine, non-empty
// string. `null`/`undefined` mean "never revoked" (active). Any other
// present value — including the empty/whitespace string a malformed or
// truncated write can leave behind — is treated as REVOKED, never as
// active: this module fails closed, so an ambiguous revocation marker
// denies rather than silently granting access. See doc §3 ruling 6.
function isRevoked(value: unknown): boolean {
  return value !== null && value !== undefined;
}

function isAbsentVisibility(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim().length === 0);
}

export function isKnownVisibility(value: unknown): value is Visibility {
  return typeof value === "string" && (TENANT_SCOPE_VISIBILITIES as readonly string[]).includes(value);
}

// ── the one decision function ──────────────────────────────────────────────

export function decideTenantScope(
  identity: Identity | null | undefined,
  memberships: readonly Membership[] | null | undefined,
  resource: ScopedResource | null | undefined,
  grants: readonly Grant[] | null | undefined = [],
): ScopeDecision {
  // Row 1
  if (!identity || !isNonEmptyTrimmedString(identity.userId)) {
    return { allow: false, reason: "no_identity" };
  }
  // Row 2
  if (!resource || !isNonEmptyTrimmedString(resource.id)) {
    return { allow: false, reason: "malformed_resource" };
  }
  // Row 3
  if (isAbsentVisibility(resource.visibility)) {
    return { allow: false, reason: "visibility_absent" };
  }
  // Row 4
  if (!isKnownVisibility(resource.visibility)) {
    return { allow: false, reason: "visibility_unrecognized" };
  }

  const userId = identity.userId;
  const safeGrants = grants ?? [];
  // A membership row is only ever honoured for THIS identity. Whatever source
  // the caller used (even a team-wide `listMembers` dump), a row whose
  // `userId` does not match the caller can never contribute an ALLOW or a
  // DENY here — it is simply invisible to this decision.
  const ownMemberships = (memberships ?? []).filter((m) => m.userId === userId);

  // Row 5
  if (resource.ownerId === userId) {
    return { allow: true, reason: "owner_match", via: "owner" };
  }

  // Row 6
  const activeGrant = safeGrants.find(
    (g) => g.resourceId === resource.id && g.granteeUserId === userId && !isRevoked(g.revokedAt),
  );
  if (activeGrant) {
    return { allow: true, reason: "explicit_grant", via: "grant" };
  }

  // Row 7 — an ACTIVE team membership allows a team-visible row. This is
  // evaluated BEFORE the revoked-grant check (row 8, formerly row 7): a
  // membership is a durable, independent grounds for access, and an
  // unrelated one-off grant being revoked must never override it. See doc
  // §3 ruling 4.
  if (resource.visibility === "team" && isNonEmptyTrimmedString(resource.teamId)) {
    const activeMembership = ownMemberships.find(
      (m) => m.teamId === resource.teamId && !isRevoked(m.revokedAt),
    );
    if (activeMembership) {
      return { allow: true, reason: "team_member_visible", via: "membership" };
    }
  }

  // Row 8
  const revokedGrant = safeGrants.find(
    (g) => g.resourceId === resource.id && g.granteeUserId === userId && isRevoked(g.revokedAt),
  );
  if (revokedGrant) {
    return { allow: false, reason: "grant_revoked" };
  }

  // Row 9
  if (resource.visibility === "private") {
    return { allow: false, reason: "private_not_owner" };
  }

  // Row 10
  if (!isNonEmptyTrimmedString(resource.teamId)) {
    return { allow: false, reason: "resource_has_no_team" };
  }

  // Row 11
  const revokedMembership = ownMemberships.find(
    (m) => m.teamId === resource.teamId && isRevoked(m.revokedAt),
  );
  if (revokedMembership) {
    return { allow: false, reason: "membership_revoked" };
  }

  // Row 12
  if (ownMemberships.length > 0) {
    return { allow: false, reason: "wrong_team" };
  }

  // Row 13
  return { allow: false, reason: "no_membership" };
}

// ── conformance table ───────────────────────────────────────────────────────

export type ConformanceCase = {
  id: string;
  scenario: string;
  identity: Identity | null;
  memberships: readonly Membership[];
  resource: ScopedResource | null;
  grants: readonly Grant[];
  expect: { allow: boolean; reason: TenantScopeReason };
};

export const TENANT_SCOPE_CONFORMANCE: readonly ConformanceCase[] = [
  {
    id: "anonymous-visitor-denied",
    scenario: "Someone who is not signed in asks for a team row",
    identity: null,
    memberships: [],
    resource: { id: "r1", ownerId: "u2", teamId: "team-a", visibility: "team" },
    grants: [],
    expect: { allow: false, reason: "no_identity" },
  },
  {
    id: "malformed-row-denied",
    scenario: "The row arrives with no identifier at all",
    identity: { userId: "u1" },
    memberships: [],
    resource: null,
    grants: [],
    expect: { allow: false, reason: "malformed_resource" },
  },
  {
    id: "no-visibility-column-denied",
    scenario: "The row's sharing setting was never recorded",
    identity: { userId: "u1" },
    memberships: [],
    resource: { id: "r3", ownerId: "u2", teamId: "team-a", visibility: null },
    grants: [],
    expect: { allow: false, reason: "visibility_absent" },
  },
  {
    id: "unrecognized-visibility-denied",
    scenario: "The row claims a sharing setting this version does not understand",
    identity: { userId: "u1" },
    memberships: [],
    resource: { id: "r4", ownerId: "u2", teamId: "team-a", visibility: "public" },
    grants: [],
    expect: { allow: false, reason: "visibility_unrecognized" },
  },
  {
    id: "owner-reads-own-row",
    scenario: "The person who created the row reads it",
    identity: { userId: "u1" },
    memberships: [],
    resource: { id: "r5", ownerId: "u1", teamId: null, visibility: "private" },
    grants: [],
    expect: { allow: true, reason: "owner_match" },
  },
  {
    id: "explicit-grant-single-row",
    scenario: "Someone outside the team was given this one row and reads it",
    identity: { userId: "u1" },
    memberships: [],
    resource: { id: "r6", ownerId: "u2", teamId: null, visibility: "private" },
    grants: [{ resourceId: "r6", granteeUserId: "u1", revokedAt: null }],
    expect: { allow: true, reason: "explicit_grant" },
  },
  {
    id: "member-reads-team-row",
    scenario: "A team member reads their team's row",
    identity: { userId: "u1" },
    memberships: [{ userId: "u1", teamId: "team-a", role: "member", revokedAt: null }],
    resource: { id: "r10", ownerId: "u2", teamId: "team-a", visibility: "team" },
    grants: [],
    expect: { allow: true, reason: "team_member_visible" },
  },
  {
    id: "revoked-grant-with-active-membership-allowed",
    scenario: "A member reads the team row after an unrelated one-off grant to it was withdrawn",
    identity: { userId: "u1" },
    memberships: [{ userId: "u1", teamId: "team-a", role: "member", revokedAt: null }],
    resource: { id: "r14", ownerId: "u2", teamId: "team-a", visibility: "team" },
    grants: [{ resourceId: "r14", granteeUserId: "u1", revokedAt: "2026-01-01T00:00:00Z" }],
    expect: { allow: true, reason: "team_member_visible" },
  },
  {
    id: "revoked-grant-denied",
    scenario: "That same person reads it after the share was withdrawn",
    identity: { userId: "u1" },
    memberships: [],
    resource: { id: "r7", ownerId: "u2", teamId: null, visibility: "private" },
    grants: [{ resourceId: "r7", granteeUserId: "u1", revokedAt: "2026-01-01T00:00:00Z" }],
    expect: { allow: false, reason: "grant_revoked" },
  },
  {
    id: "empty-string-revoked-grant-denied",
    scenario: "A share whose revocation timestamp was left as an empty string is treated as revoked, not active",
    identity: { userId: "u1" },
    memberships: [],
    resource: { id: "r7b", ownerId: "u2", teamId: null, visibility: "private" },
    grants: [{ resourceId: "r7b", granteeUserId: "u1", revokedAt: "" }],
    expect: { allow: false, reason: "grant_revoked" },
  },
  {
    id: "private-row-stranger-denied",
    scenario: "A signed-in stranger asks for someone else's private row",
    identity: { userId: "u1" },
    memberships: [],
    resource: { id: "r8", ownerId: "u2", teamId: null, visibility: "private" },
    grants: [],
    expect: { allow: false, reason: "private_not_owner" },
  },
  {
    id: "team-row-without-team-denied",
    scenario: "A row marked team-visible carries no team",
    identity: { userId: "u1" },
    memberships: [],
    resource: { id: "r9", ownerId: "u2", teamId: null, visibility: "team" },
    grants: [],
    expect: { allow: false, reason: "resource_has_no_team" },
  },
  {
    id: "revoked-membership-denied",
    scenario: "That member reads it after being removed from the team",
    identity: { userId: "u1" },
    memberships: [{ userId: "u1", teamId: "team-a", role: "member", revokedAt: "2026-01-01T00:00:00Z" }],
    resource: { id: "r11", ownerId: "u2", teamId: "team-a", visibility: "team" },
    grants: [],
    expect: { allow: false, reason: "membership_revoked" },
  },
  {
    id: "empty-string-revoked-membership-denied",
    scenario: "A membership whose revocation timestamp was left as an empty string is treated as revoked, not active",
    identity: { userId: "u1" },
    memberships: [{ userId: "u1", teamId: "team-a", role: "member", revokedAt: "" }],
    resource: { id: "r11b", ownerId: "u2", teamId: "team-a", visibility: "team" },
    grants: [],
    expect: { allow: false, reason: "membership_revoked" },
  },
  {
    id: "different-team-denied",
    scenario: "A member of another team asks for this team's row",
    identity: { userId: "u1" },
    memberships: [{ userId: "u1", teamId: "team-b", role: "member", revokedAt: null }],
    resource: { id: "r12", ownerId: "u2", teamId: "team-a", visibility: "team" },
    grants: [],
    expect: { allow: false, reason: "wrong_team" },
  },
  {
    id: "non-member-denied",
    scenario: "A signed-in person who belongs to no team asks for a team row",
    identity: { userId: "u1" },
    memberships: [],
    resource: { id: "r13", ownerId: "u2", teamId: "team-a", visibility: "team" },
    grants: [],
    expect: { allow: false, reason: "no_membership" },
  },
  {
    id: "foreign-membership-row-denied",
    scenario: "A membership row belonging to someone else is mixed into the caller's own list",
    identity: { userId: "u1" },
    memberships: [{ userId: "u2", teamId: "team-a", role: "member", revokedAt: null }],
    resource: { id: "r15", ownerId: "u3", teamId: "team-a", visibility: "team" },
    grants: [],
    expect: { allow: false, reason: "no_membership" },
  },
];

export function renderConformanceMarkdown(
  cases: readonly ConformanceCase[] = TENANT_SCOPE_CONFORMANCE,
): string {
  const header = "| # | Scenario | Row visibility | Decision | Reason |";
  const sep = "| --- | --- | --- | --- | --- |";
  const rows = cases.map((c, i) => {
    const vis =
      c.resource === null
        ? "(no row)"
        : c.resource.visibility === null || c.resource.visibility === undefined
          ? "(absent)"
          : `\`${c.resource.visibility}\``;
    const decision = c.expect.allow ? "ALLOW" : "DENY";
    return `| ${i + 1} | ${c.scenario} | ${vis} | ${decision} | \`${c.expect.reason}\` |`;
  });
  return [header, sep, ...rows].join("\n");
}
