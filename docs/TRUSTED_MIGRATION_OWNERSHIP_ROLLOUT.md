# Prospective protected migration owner

This source proposal does not enroll an App, activate a workflow, change a rule,
or clear PR1290's denied `GITHUB_TOKEN` queue read. All original groups are
terminal. A future operation needs its own explicit release authorization.
The existing Ingest guard and its permissions are unchanged in stage 1.

## Trust and identity

`trusted-migration-ownership.yml` is an ordinary `workflow_run` consumer of the
fixed CI workflow. GitHub executes it from the default branch. It checks out
exactly that protected event's `github.sha`, sparsely including three protected
Python modules, with no persisted checkout credential. It runs stdlib-only
Python with `-I -S`. There is no candidate checkout, dependency install, cache,
artifact extraction, caller code, supplied receipt, callback, dispatch trigger,
new scheduler or result store.

Before token mint, protected code authenticates the original run against the
Actions API: repository name/numeric ID, workflow ID/path/name, source event,
head SHA/ref, run ID/attempt and successful completion. Actions metadata uses
the issuer job's separate built-in token with **Actions read**. It never uses
that token for the denied queue query.

The private key belongs only in the prospective `terminal-migration-owner`
environment. Configure a selected **branch** rule for `master` only, no tag
rule, and disallow administrator bypass. `workflow_run` has a default-branch
`GITHUB_REF`; candidate queue/PR refs must not receive this environment's key.
Confirm the actual repository plan supports these controls before enabling.
This trusts reviewed protected-default code, not a per-workflow secret ACL:
another protected master workflow could reference the same environment.

The immutable GitHub-owned token action supports its numeric `app-id` input.
This proposal deliberately uses the same expected numeric App issuer as the
required check source, so a private key for a different App cannot mint for it.
The input is deprecated in favor of client IDs in that pinned revision but is
still explicitly supported there. If adopting the preferred client-ID form in
future, first qualify its actual numeric-App mapping; do not silently unbind
the expected check producer. Exact returned installation ID is checked before
the token is used. The action revokes its token at job completion.

| Proposed identity | Permission | Purpose |
| --- | --- | --- |
| Dedicated installation, only `mastermind-terminal` | Merge queues: read | Fresh native membership/profile |
| Same installation | Contents: read | Immutable candidate/source trees and blobs |
| Same installation | Pull requests: read | Current original source PR identity |
| Same installation | **Checks: write** | Distinct App-produced check on exact H |
| Protected job's built-in token | Contents: read; Actions: read | Protected checkout and original run metadata only |

Checks write is an explicit **additional proposed grant**, not an already
approved least-read permission. No queue write, Administration, workflow write,
organization, SQL or account grant is proposed for the issuer App. GitHub does
not document exact per-query GraphQL permissions; this source and inert tests
do not prove the read grant set sufficient or attest an enrolled installation.

## New origin, unchanged ownership law

The nominal `_VerifiedRun` is issued inside protected code from the actual
workflow event and a fresh service read. `workflow_run` does not contain the old
merge-group event. The code never fabricates `checks_requested` or claims the
old `event.base_sha` was observed. For the new route, B is the current protected
tip from the issuer's actual authenticated queue snapshot.

Both original event validators and the new route use the same extracted queue
predicates. They retain exact repository/base, serial or 8/4 ALLGREEN profile,
complete queue page, contiguous unique positions, unique H, complete native
predecessor chain, current OPEN same-repository/master PRs and immutable source
SHAs, first potential-merge tree/parent checks, source ledger equality, migration
Blob equality, complete base directory/prefix absence and per-file absence.
All namespace schema/header/collision/application/redaction rules run in the
protected owner over bounded, complete, hash-checked immutable Git DATA. No
candidate SQL is executed. Ordinary PR/refresh heads are authenticated via the
current exact-head associated PR, not `PR_NUMBER`, branch-name parsing or a
downloaded artifact. An ambiguous/incomplete source PR set refuses.

The actual run, full current namespace and queue/PR observations are checked
again before success publication. Failure produces no success. HTTP requests
do not retry or follow redirects. Lost check POST/PATCH response remains
unconfirmed. A matching unsettled check or changed source-code identity refuses
another POST; a completed matching original operation can only be reconciled.
No native queue admission or retry primitive is present.

## Complete two-stage rollout (none executed)

1. Root reviews the exact source, grants and scoped independent consequence
   review. Current PR1290, its SQL/ACL bytes and source branch stay untouched.
   The denied built-in-token read cannot be retested with this proposal.
2. Deliver the stage-1 source through the normal protected path. Its new owner
   is supplementary: current Ingest still enforces live membership. Do not
   claim stage 1 alone can repair the held open-migration PR. A normal healthy
   source/CI candidate without that old membership failure is needed to prove
   the prospective owner, rather than replaying an old terminal group.
3. Only under separate administrator authorization, create/approve a controlled
   App with the exact repository/grants above, restricted installation and
   protected environment. Configure nonsecret `MIGRATION_OWNER_APP_ID` and
   `MIGRATION_OWNER_INSTALLATION_ID`, and the environment-only
   `MIGRATION_OWNER_PRIVATE_KEY`. No value was retrieved or provisioned here.
4. Separately qualify the exact full read operations and actual independent
   App check producer. A new denial holds its exact action; no automatic extra
   grant, alternate identity or old-read retry. Verify real successful checks
   on both an ordinary PR/refresh head and a native group using the same
   protected issuer bytes. Fixture responses are not that proof.
5. Make `Migration namespace / protected owner` required on `master`, pinned
   to the actual App ID, never Any source. Preserve all three original strict
   GitHub Actions checks and the native merge queue. Read back the effective
   configuration through the owning administrator's existing permitted path.
6. The separately authorized administrator can then invoke:

   ```sh
   python3 -m scripts.migration_ownership_transition \
     --app-id <enrolled-numeric-App-ID> \
     --run <real-successful-PR-CI-run-ID> \
     --run <real-successful-native-group-CI-run-ID> \
     --output <new-private-source-patch-path>
   ```

   Its `MIGRATION_TRANSITION_TOKEN` is the separately authorized administrator's
   existing intended-repository read capability, not the issuer key or a new
   requested credential. It needs the actual branch-protection/rules metadata
   read; do not add Administration to the issuer App to make this tool pass.
   This command was **not run**. It performs fresh fixed-repository reads, no
   GitHub mutation, then exclusively writes an unapplied source patch. It
   requires strict old checks plus the pinned new gate, the native queue,
   genuine App successes for both source modes, and exact current protected
   issuer bytes. It repeats the rule/source/proof checks before returning.
7. Review and normally merge that exact patch. It changes only the real-tree
   merge-group test's membership-dependent assertion to content enforcement,
   and extends the existing controller's exact context-to-App map. Pure
   ownership negatives, original event/strict CLI behavior, ordinary PR law,
   Ingest's other tests/permissions, old checks, native-user admission and SQL
   remain intact. The new protected owner now supplies the mandatory full
   group membership/content gate. No environment/caller boolean enables this
   transfer; it is a separately verified source change.
8. A subsequent new candidate's normal head/group checks and release are still
   owed. There is no authorization here to rearm or retry PR1290.

## Rollback

Restore the stage-2 patch in reverse through normal reviewed protected source
**before** withdrawing its required new App gate or environment grant. Verify
the original strict Ingest enforcement is restored. Because the old token
denial is unresolved, this intentionally stops open-migration release; do not
mask the failure or mark its ledger merged. Only then may a separately
authorized administrator withdraw the new required check/App credential.
If the App is unavailable before source rollback completes, keep the new gate
required and hold release. Original denied and unknown operations stay intact.

## Evidence limits and official interfaces

Tests use API-shaped disposable responses and the actual protected validators,
HTTP request/JSON codec, namespace implementation, generated controller and
reversible source patch. They do not attest live identity, permissions, rules,
enrollment, workflow execution, required checks, deployment or SQL application.

- [Workflow-run default-code and security contract](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
- [Installation-token permissions](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app)
- [Check creation requires Checks write](https://docs.github.com/en/rest/checks/runs#create-a-check-run)
- [Required checks with expected App source](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)
- [Environment ref restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#deployment-branches-and-tags)
