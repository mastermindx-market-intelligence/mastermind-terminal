# F12 Tenant Scope Contract (2026-09-06)

Packet B-PLAT-4 (lane `marketontology-b4-plat-tenant-scope-contract`, wave B4, Meta-CEO B).

## 1. What this is / what it is not

`terminal/lib/tenantScope.ts` exports one pure function, `decideTenantScope`,
that decides whether an identity may see a team-scoped row, and why. It has
no I/O and no framework import — it is a deterministic table lookup over its
arguments.

The database-side authority is Row Level Security, defined in migration 0014
(tenancy foundation, Terminal PR #514, **OPEN/unmerged**; the migration's own
header at line 10 says `-- NOT APPLIED by packet B-F12-1 — application is a
separate privileged act.`). This module is the application-side **second
gate**. It never replaces RLS and never talks to a database — every input it
reads (identity, memberships, resource, grants) is supplied by the caller.

TODO(F12): once PR #514 merges, restore the literal migration path here
(supabase, migrations dir, file "0014_tenancy_foundation" + ".sql") — it is
worded without that literal for now only because
`tests/test_migration_ledger.py::test_referenced_migration_filenames_exist`
scans `terminal/lib/**/*.ts` and `terminal/app/**/*.ts*` for exactly this
pattern, and while this file is not itself in that scan set today, keeping
the wording consistent with `terminal/lib/tenantScope.ts`'s own comment
avoids a doc that names, as a scannable literal, a file absent from
`master`.

## 2. Data contract

```ts
export type TeamRole = "owner" | "admin" | "member";

export type Visibility = "private" | "team";
export const TENANT_SCOPE_VISIBILITIES: readonly Visibility[] = ["private", "team"];

export type Identity = { userId: string | null };

export type Membership = { userId: string; teamId: string; role: TeamRole; revokedAt?: string | null };

export type Grant = { resourceId: string; granteeUserId: string; revokedAt?: string | null };

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

export type ScopeDecision =
  | { allow: true; reason: AllowReason; via: "owner" | "grant" | "membership" }
  | { allow: false; reason: DenyReason };

export function decideTenantScope(
  identity: Identity | null | undefined,
  memberships: readonly Membership[] | null | undefined,
  resource: ScopedResource | null | undefined,
  grants: readonly Grant[] | null | undefined = [],
): ScopeDecision;

export function isKnownVisibility(value: unknown): value is Visibility;
```

## 3. Decision table

Evaluated top to bottom; the first row whose condition holds produces the
result.

| # | Condition | Result | Reason |
|---|---|---|---|
| 1 | `identity` is null/undefined, or `identity.userId` is not a non-empty trimmed string | DENY | `no_identity` |
| 2 | `resource` is null/undefined, or `resource.id` is not a non-empty trimmed string | DENY | `malformed_resource` |
| 3 | `resource.visibility` is null/undefined/empty-after-trim | DENY | `visibility_absent` |
| 4 | `resource.visibility` is not in `TENANT_SCOPE_VISIBILITIES` | DENY | `visibility_unrecognized` |
| 5 | `resource.ownerId === identity.userId` | ALLOW (`via: "owner"`) | `owner_match` |
| 6 | a grant exists with `resourceId === resource.id && granteeUserId === identity.userId` and `revokedAt` is null/undefined (not revoked) | ALLOW (`via: "grant"`) | `explicit_grant` |
| 7 | `resource.visibility === "team"` and an OWN membership (`userId === identity.userId`) exists with `teamId === resource.teamId` and `revokedAt` null/undefined (not revoked) | ALLOW (`via: "membership"`) | `team_member_visible` |
| 8 | a grant exists for the same pair **with** `revokedAt` present — any value other than null/undefined, an empty string included | DENY | `grant_revoked` |
| 9 | `resource.visibility === "private"` | DENY | `private_not_owner` |
| 10 | `resource.teamId` is not a non-empty trimmed string | DENY | `resource_has_no_team` |
| 11 | an OWN membership exists for that `teamId` **with** `revokedAt` present — any value other than null/undefined, an empty string included | DENY | `membership_revoked` |
| 12 | any OWN membership exists (but none match this team) | DENY | `wrong_team` |
| 13 | otherwise | DENY | `no_membership` |

A membership is "OWN" only when its `userId` equals `identity.userId`; a
membership row for a different user is invisible to every row above (see
ruling 4).

### Three rulings

1. **Fail-closed outranks ownership.** Rows 3-4 sit above row 5, so an owner
   is denied on a row whose visibility is absent or unrecognized. *Rejected
   alternative:* letting the owner through first — it makes the fail-closed
   test unpinnable for the most privileged identity, which is the identity
   that most needs the fence.
2. **`"public"` is not a supported value in V1.** It hits row 4 and denies.
   *Rejected alternative:* adding a public tier — no schema, no product
   decision, and no ledger row asks for one; inventing it here would be an
   LLM-originated escalation of access.
3. **Role does not branch READ decisions in V1.** `owner`/`admin`/`member`
   all read a team-visible row alike; `role` is carried on `Membership` only
   so future write/admin decisions have it.
4. **An active team membership outranks an unrelated revoked grant.** Row 7
   (`team_member_visible`) is evaluated before row 8 (`grant_revoked`), so a
   withdrawn one-off share to this specific resource never denies a user who
   separately holds an active membership on the resource's team — pinned by
   `tenantScope.test.ts`'s "an active team membership outranks an unrelated
   revoked grant". *Rejected alternative:* leaving the grant check first (the
   original shape) — it let one revoked, unrelated grant silently override a
   standing team membership, which is not what "member of the team" means to
   a user.
5. **A membership is honoured only for its own `userId`.** `Membership`
   carries a required `userId`, and every row that reads `memberships`
   (7, 11, 12) filters to `m.userId === identity.userId` first. This is a
   fail-closed default even against a caller mistake: `listMembers(session.db,
   session.userId, teamId)` (`terminal/lib/teams.ts`, PR #514) returns every
   member of a team — i.e. rows for OTHER users — while `listTeams(session.db,
   session.userId)` (same file, PR #514) is the identity-scoped reader §8
   requires callers to use. Passing `listMembers`'s output by mistake used
   to grant access from any membership row the caller handed in; it cannot
   any more — pinned by `tenantScope.test.ts`'s "a membership row belonging to
   a different user never grants access".

6. **A revocation marker is "present" the moment it is not null/undefined —
   an empty string counts.** `isRevoked()` treats any value other than
   `null`/`undefined` as revoked, so a malformed or truncated write that
   leaves `revokedAt: ""` denies (rows 8, 11) rather than being read as an
   active grant/membership. *Rejected alternative:* bare truthiness
   (`!revokedAt`) — it reads `""` as falsy, i.e. NOT revoked, which is a
   fail-OPEN reading of an ambiguous value in a module whose whole contract
   is fail-closed; pinned by `tenantScope.test.ts`'s two "an empty-string
   revokedAt ... is treated as revoked, not active" cases and by the
   `empty-string-revoked-grant-denied` / `empty-string-revoked-membership-denied`
   conformance rows.

## 4. Conformance table

<!-- BEGIN:tenant-scope-conformance (generated from terminal/lib/tenantScope.ts TENANT_SCOPE_CONFORMANCE — do not hand-edit; tenantScopeConformance.test.ts asserts byte identity) -->
| # | Scenario | Row visibility | Decision | Reason |
| --- | --- | --- | --- | --- |
| 1 | Someone who is not signed in asks for a team row | `team` | DENY | `no_identity` |
| 2 | The row arrives with no identifier at all | (no row) | DENY | `malformed_resource` |
| 3 | The row's sharing setting was never recorded | (absent) | DENY | `visibility_absent` |
| 4 | The row claims a sharing setting this version does not understand | `public` | DENY | `visibility_unrecognized` |
| 5 | The person who created the row reads it | `private` | ALLOW | `owner_match` |
| 6 | Someone outside the team was given this one row and reads it | `private` | ALLOW | `explicit_grant` |
| 7 | A team member reads their team's row | `team` | ALLOW | `team_member_visible` |
| 8 | A member reads the team row after an unrelated one-off grant to it was withdrawn | `team` | ALLOW | `team_member_visible` |
| 9 | That same person reads it after the share was withdrawn | `private` | DENY | `grant_revoked` |
| 10 | A share whose revocation timestamp was left as an empty string is treated as revoked, not active | `private` | DENY | `grant_revoked` |
| 11 | A signed-in stranger asks for someone else's private row | `private` | DENY | `private_not_owner` |
| 12 | A row marked team-visible carries no team | `team` | DENY | `resource_has_no_team` |
| 13 | That member reads it after being removed from the team | `team` | DENY | `membership_revoked` |
| 14 | A membership whose revocation timestamp was left as an empty string is treated as revoked, not active | `team` | DENY | `membership_revoked` |
| 15 | A member of another team asks for this team's row | `team` | DENY | `wrong_team` |
| 16 | A signed-in person who belongs to no team asks for a team row | `team` | DENY | `no_membership` |
| 17 | A membership row belonging to someone else is mixed into the caller's own list | `team` | DENY | `no_membership` |
<!-- END:tenant-scope-conformance -->

## 5. Reason strings are internal — the caller owes plain words

Every `reason` above is internal and machine-readable. It must **never** be
rendered directly to a person. A future route that calls `decideTenantScope`
and gets `allow: false` maps `reason` to a complete-sentence message, the
same way `terminal/lib/teams.ts:97` (PR #514) documents `InvalidCode` as "the
route maps `code` to a complete-sentence `message`":

| reason | plain-words sentence the caller must render |
|---|---|
| `no_identity` | "Sign in to see this." |
| `malformed_resource` | "We could not read that item." |
| `visibility_absent` | "This item does not say who it is shared with yet, so we are not showing it." |
| `visibility_unrecognized` | "This item's sharing setting is not one this version understands, so we are not showing it." |
| `private_not_owner` | "This item is private to the person who made it." |
| `resource_has_no_team` | "This item is marked team-visible but is not attached to a team." |
| `no_membership` | "You are not on a team yet." |
| `wrong_team` | "This item belongs to a team you are not on." |
| `membership_revoked` | "You no longer have access to this team." |
| `grant_revoked` | "This item is no longer shared with you." |

`owner_match`, `explicit_grant`, and `team_member_visible` are ALLOW reasons
and never need a denial sentence.

## 6. Nulls printed — what does not exist today

- **No `visibility` column exists on any table.** `git grep visibility --
  supabase` returns zero schema hits; every canonical table carries `user_id`
  only (`0001_init.sql:29,31,51,53,76,78`; `0002_drawings.sql:9,11`;
  `0007_portfolio_positions.sql:84,86`; `0012_thesis_objects.sql:10,12`).
  `visibility` is therefore **caller-supplied with no persisted source**. A
  caller for a table with no such column must pass `"private"` **explicitly**;
  it must not pass `null` expecting a default, because `null` denies (row 3).
  The default is deliberately absent so the mapping is a visible decision
  rather than a silent one.
- **No resource-level `team_id` column exists.** `team_id` appears only on
  `team_members`/`team_invites` in the unmerged `0014_tenancy_foundation.sql:23,32`.
- **No grants table exists.** There is no `resource_grants` relation anywhere
  and this packet creates none. `Grant` is a caller-supplied record only.
- **Migration 0014 is unmerged and unapplied.** PR #514 is OPEN; the file's
  own header (line 10) says `NOT APPLIED`. `teams`/`team_members` therefore
  do not exist in the live database, so **no part of this contract can be
  exercised end-to-end against production data today.** That is stated, not
  worked around.
- **The canonical owner column is `user_id`, not `owner_id`.** The
  `user_id → ownerId` mapping is the caller's, performed at the adapter
  boundary.
- **Role does not branch read decisions in V1.** All three roles read a
  team-visible row alike.
- **No clock is read.** Revocation is an input fact (`revokedAt`), not a
  comparison against `now()`; an expiring grant is not modelled.

## 7. Ledger rows — closed vs. not closed

- `MO-PAID-052` ("Shared watchlists, scenarios, analyses, coverage";
  closure test in
  `research/market_intelligence_productization/MARKET_ONTOLOGY_F00C_GRANULAR_CLOSURE_LEDGER_2026-09-02.csv:114`
  = *"a second authenticated user reads a shared watchlist via explicit
  grant"*): **the decision half only.** The function answers correctly for
  an explicit grant; there is no grants table and no route, so the closure
  test is NOT met by this packet.
- `MO-PAID-082` ("Roles / permissions"; closure test at the same file line
  121 = *"two roles produce two authorization outcomes on one route"*):
  **NOT closed.** Read decisions do not branch on role here; write/admin
  authorization lives in `terminal/lib/teams.ts` (PR #514) and in B-F12-3.
- `MO-PAID-083` ("Workspace settings", line 122): **untouched** — no
  workspace concept is introduced.

This packet names no ledger row to close.

## 8. Entry-point wiring

**Real at merge:**
- `terminal/vitest.config.ts:9`'s glob collects both test files with no
  registration — running `npm test` in `terminal/` executes them, and
  `.github/workflows/ci.yml`'s `terminal-unit` job (`name: Terminal unit +
  typecheck (shard)`) runs exactly that inside its protected context (as of
  `origin/master@be898be5`: `npx tsc --noEmit` then `npm test`, in that
  order — cite the job NAME, not a line number, since the workflow is
  reshuffled/sharded independently of this packet).
- The same job's `npx tsc --noEmit` step typechecks
  `terminal/lib/tenantScope.ts` as part of the Next project.
- This doc is served at the live URL by GitHub the moment the squash-merge
  lands on `master`.

**Explicitly NOT claimed:** no route in `terminal/app/**` imports
`tenantScope` at merge time, and this packet does not add one (that is
B-F12-3's lane). The two existing nav families are untouched; no third
header is created.

**Interface B-F12-3 must consume:** a route builds `Identity` from Supabase
auth, `Membership[]` from `listTeams`/`listMembers` in `terminal/lib/teams.ts`,
and `ScopedResource` by mapping `user_id → ownerId` plus an explicit
`visibility`; it calls `decideTenantScope`; on `allow:false` it renders the
§5 plain-words sentence for the returned `reason` and never the reason
itself.

## 9. Theme treatment

Not applicable: this packet introduces no user-facing surface, no markup, no
CSS, and no LEX tuple. If any reason string ever reaches a screen, this
contract has been violated; `tenantScopeConformance.test.ts` greps
`terminal/lib/i18n.tsx` as the tripwire.
