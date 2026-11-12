# P12.T30 — truthful account-verification failure

Original AUTH-03 requires unknown access when identity verification is unavailable,
without a false signed-out or entitled result. At protected source
`84566aa6a4e9221720c7430eae23d622c81e9675`, Analysis and the shared layout discarded
`getClaims().error`. Missing claims rendered the signup gate or guest-owned chrome;
stale claims accompanying an error could still mount an account workspace.

The existing `memberIdentity` server boundary now also supplies a bounded local
claims reader. It retains `getClaims`, calls no additional `getUser`, and returns
only a verified UUID and display email on success. A proven missing session or
successful anonymous read remains guest. Other claims-verification errors,
including unrelated HTTP 401/403 errors, thrown failures and the existing 12-second
deadline, remain unavailable even when claims accompany the error. A non-null
malformed claims object also remains unavailable; only an absent/null successful
claims result establishes anonymous access. The existing
`readShellMember`/`getUser` behavior and error policy are preserved.

Analysis and the server layout select the existing
`MemberVerificationUnavailable` component before mounting the private workspace
or `AppShell` on failure. Its existing English/Chinese account-unavailable message
and account-verification retry are reused. The retry uses the incumbent router
refresh, which performs a new server verification. No new styles, chrome,
account/store union, permission, auth provider or development fixture is added.
The existing preview and explicitly scoped development-fixture branches are unchanged.

## Controlled source checks

All auth responses below are local mocks; no provider, account or browser calls
were made.

- Old-source page/layout fault tests: **5 failed / 5 passed**, reproducing false
  guest, stale-claims account, uncaught verifier failure and failed recovery.
- Repaired source: **153 tests passed across 11 affected suites**, including 13
  claims-reader checks and 12 Analysis/layout/bilingual retry checks. Existing
  member-page, owner, guest-bundle, preview, fixture isolation, Analysis route,
  scenario-resolution and thesis-token checks are included. Verified-claims test
  placeholders were corrected to UUIDs; development fixture behavior is unchanged.
- `tsc --noEmit`, scoped ESLint and `git diff --check` passed.

Affected tests use the existing Vitest/React DOM harness. The local Node 26 run
used `NODE_OPTIONS=--no-experimental-webstorage`, preserving the incumbent
test environment's DOM storage behavior. No dependency was added.

The unchanged unavailable component retains its existing theme and responsive
presentation. DOM checks cover English/Chinese semantics and the actual retry
handler; they do not claim new rendered visual or served-browser acceptance.

## Delegation and release boundary

Fabric task `shared-shell-auth03-t30-20261103-carson` settled with provider error
`EAI_AGAIN` / unrecognized `glm-5.3-flash`, with no source artifacts or quality
acceptance. The same retained result was consumed; it was not retried. The
bounded implementation continued in the admitted isolated local writer under the
original root and parent commission.

One fresh nonauthor auth-risk review and the normal protected release are required.
A limited auth-risk review repair added malformed-claims discrimination: 6
focused old-branch failures reproduced the false guest, followed by **44 passing
helper, Analysis/layout and incumbent-member checks**, plus repaired-source
typecheck and scoped lint. The independent reviewer will consume
the exact repaired delta; the earlier full affected checks remain scoped to their
unchanged source.

Source checks do not establish served acceptance, authenticated recovery, private
data access or programme completion. Original browser refusals, runtime holds,
unresolved operations and installation ownership remain in force.
