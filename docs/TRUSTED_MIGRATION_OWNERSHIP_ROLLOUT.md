# Protected migration owner rollout

Dormant protected source was installed by [PR1337](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1337).
The early-issuer lifecycle below is implemented by
[PR1356](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1356);
verify its exact protected-default source before activation. The
[2026-11-09 bootstrap observation](https://github.com/mastermindx-market-intelligence/Mastermind/issues/1607#issuecomment-6732916673)
records the named environment and explicit zero identity selectors. It does not
establish App enrollment, credential qualification, production issuance,
recovery, enforcement or consumer transfer. Recheck the actual environment's
master-only branch policy and administrator-bypass setting before activation.

This guide grants no App, credential, permission or release action and does not
clear PR1290's denied `GITHUB_TOKEN` queue read. All original groups are terminal;
a future operation needs its own applicable release authority. The existing
Ingest guard and its permissions remain unchanged in stage 1.

## Trust and identity

`trusted-migration-ownership.yml` consumes the fixed CI workflow's original
`workflow_run: in_progress` event. GitHub executes it from the default branch.
It checks out
exactly that protected event's `github.sha`, sparsely including three protected
Python modules, with no persisted checkout credential. It runs stdlib-only
Python with `-I -S`. There is no candidate checkout, dependency install, cache,
artifact extraction, caller code, supplied receipt, callback, dispatch trigger,
new scheduler or result store.

Before token mint, protected code authenticates the original in-progress event
and immutable run identity against the Actions API: repository name/numeric ID,
workflow ID/path/name, source event, head SHA/ref and run ID/attempt. The event
must have no conclusion. Fresh service metadata must describe that same attempt,
which may still be in progress or already completed with a recognized outcome.
Ownership qualification does not depend on overall source-CI success. Actions
metadata uses the issuer job's separate built-in token with **Actions read**;
that token is never used for the denied queue query.

The private key belongs only in the prospective `terminal-migration-owner`
environment. Configure a selected **branch** rule for `master` only, no tag
rule, and disallow administrator bypass. `workflow_run` has a default-branch
`GITHUB_REF`; candidate queue/PR refs must not receive this environment's key.
Confirm the actual repository plan supports these controls before enabling.
This trusts reviewed protected-default code, not a per-workflow secret ACL:
another protected master workflow could reference the same environment.

Before default-branch installation, separately authorize the empty environment
and verify its selected master branch policy. Do not let a workflow implicitly
create an unprotected environment. After qualifying the exact named nonsecret
variable preimages, pin repository-level `MIGRATION_OWNER_APP_ID` and
`MIGRATION_OWNER_INSTALLATION_ID` to `0` while bootstrapping. This explicit
disabled selection skips the supplementary workflow job before runner
allocation, with no App-produced check and no change to required checks.
Missing or partially configured selectors still reach strict preflight and
fail before any API client or token mint. An unconfigured environment alone
does not prove repository/organization fallback values absent. No key is needed to install the protected code in this state.
These settings were not read or changed by the source tests.

After the protected code is installed, provision the approved environment key
and actual installation binding. Change the repository installation ID first,
leaving App ID zero until the final authorized activation edge. Use repository
nonsecret identity variables for the workflow contexts; environment variables
arrive later on the runner. Verify actual rendered identity during subsequent
lawful qualification. This selection is not an execution grant: the key,
installation, service/run/source and full namespace predicates still apply.

The immutable GitHub-owned token action supports its numeric `app-id` input.
The issuer uses the same expected numeric App issuer as the
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

Both original event validators and the protected route use the same extracted
queue predicates. The complete queue response is validated first, including
exact repository/base, serial or 8/4 ALLGREEN profile, a complete queue page,
contiguous unique positions and unique H. Only then is the sorted contributing
prefix through that exact candidate retained for repeated proof. API order or
unrelated suffix changes alone do not invalidate that prefix. Protected tip,
configuration, entry IDs, predecessors, heads, trees and source identity remain
bound. Qualification retains the complete native predecessor chain, current
OPEN same-repository/master PRs and immutable source SHAs, first potential-merge
tree/parent checks, source ledger equality, migration Blob equality, complete
base directory/prefix absence and per-file absence.
All namespace schema/header/collision/application/redaction rules run in the
protected owner over bounded, complete, hash-checked immutable Git DATA. No
candidate SQL is executed. Ordinary PR/refresh heads are authenticated via the
current exact-head associated PR, not `PR_NUMBER`, branch-name parsing or a
downloaded artifact. An ambiguous/incomplete source PR set refuses.

The source run and original issuer are revalidated immediately before check
creation and completion; current namespace and contributing queue/PR evidence
are checked again before success publication. A deterministic post-create
qualification failure may complete only the exactly acknowledged original
in-progress check as failure, after the source and original issuer identities
are revalidated. Both failure and success PATCH acknowledgements must identify
that exact original check ID. Unavailable reads, superseded source/issuer and
unknown POST/PATCH effects remain unreplayed.

HTTP requests do not retry or follow redirects. A matching unsettled check or
changed source-code identity refuses another POST; a completed matching original
operation can only be reconciled. The acknowledged-check failure path grants no
recovery authority over historical pending checks. No native queue admission or
retry primitive is present.

The actual issuer's `GITHUB_RUN_ID` and `GITHUB_RUN_ATTEMPT` are separately
authenticated against Actions metadata: exact repository, issuer workflow
ID/path/name, `workflow_run` event, master ref, protected code SHA and current
attempt. Its service-generated run title binds the original CI run ID/attempt/H.
The check's fixed `details_url` retains that issuer's **first** attempt; it is
not accepted as authority without the actual issuer record. Phase-2 proof reads
that first attempt and validates the same original target and protected code.

Only the original issuer attempt can create or complete a check. The configured
workflow rejects reruns in preflight **before** minting. The owner helper can
read/reconcile an already completed original check on a later actual attempt,
but a missing or unsettled original check retains UNKNOWN and cannot reach any
POST/PATCH. Claiming attempt 1 does not override actual service attempt 2.
GitHub keeps a workflow-run ID across reruns and increments its attempt; changing
the issuer/source identity or creating another run is not a supported recovery
primitive here. The protected workflow invokes the mutation owner once, has no
manual trigger/retry wrapper, and the HTTP client does not retry it. This is an
enforced original-attempt boundary, not an assertion that a lost POST was unsent.

## Two-stage rollout and activation gates

Dormant source/bootstrap configuration and live activation are separate states.
The dated observation above establishes only the former. Real App identity,
production check issuance, recovery, enforcement and consumer transfer still
need their own evidence. Do not repeat completed bootstrap effects.

1. Review the exact source and grants against actual repository, security and
   release holds. Apply the governing Web self-check waiver where applicable;
   actual required non-author approvals remain binding. Current PR1290, its
   SQL/ACL bytes and source branch stay untouched. The denied built-in-token
   read cannot be retested through this route.
2. For initial source installation, qualify the authorized empty restricted
   environment and zero repository identity selectors described above, then use
   the normal protected source path. For the early-issuer followup, confirm
   PR1356's qualified bytes have actually landed on protected master. The owner
   remains supplementary: current Ingest still enforces live membership. Do not
   claim stage 1 alone can repair the held open-migration PR. A normal healthy
   source/CI candidate without that old membership failure is needed to prove
   the prospective owner, rather than replaying an old terminal group.
3. Only under separate administrator authorization, create/approve a controlled
   App with the exact repository/grants above, restricted installation and
   prequalified environment. Bind the actual nonsecret App/installation identity
   and the environment-only `MIGRATION_OWNER_PRIVATE_KEY`, leaving the repository
   App ID zero until the final authorized activation edge. No value was retrieved
   or provisioned here.
4. Separately qualify the exact full read operations and actual independent
   App check producer. A new denial holds its exact action; no automatic extra
   grant, alternate identity or old-read retry. Verify real successful checks
   on both an ordinary PR/refresh head and a native group using the same
   protected issuer bytes. Fixture responses are not that proof. A successful
   supplementary ownership check may be issued while source CI is running or
   ultimately fails; this proves the independent producer only. It does not
   satisfy the successful-CI cutover proof required in step 6.
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
   issuer bytes. Independently of early issuance,
   `migration_ownership_transition._proof()` still requires each original source
   CI run to be **completed and successful**, together with its completed
   successful App check and authenticated original issuer attempt. It repeats
   the rule/source/proof checks before returning.
7. Review and normally merge that complete six-path patch. It changes the
   real-tree merge-group test's membership-dependent assertion to content
   enforcement and extends the existing controller's exact context-to-App map.
   It also updates `AGENTS.md`, its `CLAUDE.md` import note, the incumbent
   workflow's producer comments and the actual controller tests, including the
   distinct-producer negative. All source uses the actual qualified App ID. Pure
   ownership negatives, original event/strict CLI behavior, ordinary PR law,
   Ingest's other tests/permissions, old checks, native-user admission and SQL
   remain intact. The new protected owner now supplies the mandatory full
   group membership/content gate. No environment/caller boolean enables this
   transfer; it is a separately verified source change.
   The companion source is generated in that same patch, as required by
   Terminal's existing release law. Do not split out or land the two-file core
   handoff without those companions. This is still unapplied source preparation,
   not proof of a configured App, required gate or actual activation release.
8. A subsequent new candidate's normal head/group checks and release are still
   owed. There is no authorization here to rearm or retry PR1290.

## Recovery entry (dormant, same publisher)

`trusted-migration-ownership-recovery.yml` is the manually invoked recovery
entry of the SAME ownership publisher, required by rollout step 4. It is a
separate `workflow_dispatch` workflow, because a switch inside the mutable
default-branch `trusted-migration-ownership.yml` cannot survive that workflow
being broken. Its only input is the completed original `ci_run_id` whose
candidate head needs the check. The job checks out exactly the dispatch-time
default-branch revision `github.sha` (sparse, no persisted credentials — the
same checkout law as the automatic issuer, asserted in-workflow by
`git rev-parse HEAD`) and runs the same three protected modules from it with
`--recover-preflight` before the key mint, then `--recover` after it. There is
no pinned older revision and no revision input at all: a caller cannot select
which bytes execute, so old weaker rules cannot be selected. The same
`terminal-migration-owner` environment, App, installation binding, minted
grant set, check name, required context and validator are reused; recovery
adds no new publisher, scheduler or credential path.

Dormancy: while either repository selector is `0` — the explicit disabled pair
or any partial configuration — there is nothing to recover, and a manual
dispatch fails loudly before any API client, environment allocation or mint.
The workflow splits this refusal into a `dormancy-guard` job with **no**
`environment:` that exits non-zero while a selector is `0`, and the credential
job (`terminal-migration-owner` environment) whose `if:` additionally requires
both selectors non-zero on top of the repository/ref/default-branch guards, so
a dormant or misconfigured dispatch can never allocate the environment or its
key. Recovery never forges workflow_run identity: the original run is re-read
and qualified, and the published check honestly records the recovery run, its
dispatching actor (sender, authenticated `triggering_actor`, and their
repository permission, which must be admin/maintain/write — proven in
`--recover-preflight` before the mint as well as after it) and the
dispatch-time protected revision in `external_id`, `details_url` and the check
output.

Anti-rollback/staleness: recovery executes exactly the dispatch-time
default-branch bytes and refuses unless those modules
(`check_supabase_migration_namespace.py`, `migration_merge_group.py`) **and the
issuer module `trusted_migration_ownership.py` itself** still carry exactly
the same content-addressed blob identity as **current `master`** at run time.
A dispatch whose executing law has since been changed on master is a stale run
and refuses before any mint; because no revision input exists, a revision that
predates the currently accepted validator/issuer-law identity can never mint a
green check under old law. Original-operation reconciliation runs before any
write: an existing check for the same `migration-owner:v1:{run}:{attempt}:
{head}` operation from either the automatic issuer or a prior recovery is read
back, its claimed issuer run is authenticated against Actions metadata at its
original attempt identity (a rerun — `run_attempt != 1` — of that prior issuer
run leaves later reconciliations refused, fail-closed like the automatic
path), a settled outcome is only reconciled, and an unsettled or unknown one
is never replayed; a rerun of the recovery run itself is likewise
reconcile-only. Recovery also refuses while the target CI run is still in
progress (its original issuer keeps the turn), while ANY not-yet-completed
automatic issuer attempt for the same target exists — queued, waiting,
pending, requested, action-required or in-progress, with that scan repeated
immediately before publication — and when an earlier recovery dispatch for the
same target is unsettled or already reached the publication step. For
pull-request targets the source PR must still be OPEN (a merged PR has no
remaining gate to supply). Merge-group recovery only works while the entry is
still queued: the authenticated queue snapshot must still carry the candidate
entry and its ordered contributing prefix (migration-bearing predecessors
included), which binds the candidate head commit. The operative binding of the
namespace material itself is the `{head}:supabase/migrations` tree read on
that queue-validated head commit; the head commit's root tree must equal the
queue entry's integrated tree as an additional commit-identity check (the root
tree and the nested `supabase/migrations` subtree are distinct git objects).

The `terminal-migration-owner` environment keeps the same configuration law as
the automatic issuer: a selected **branch** rule for `master` only, no tag
rule, no administrator bypass. Because `workflow_dispatch` can target any ref
that carries this workflow file, only that environment branch policy keeps a
hostile-ref dispatch of a modified copy away from the key; the module's
`GITHUB_REF` guard protects the legitimate master path only.

Administrator effects that remain outside this source: dispatching the
workflow, qualifying that the installation token may actually read the
collaborator permission endpoint under its granted scopes, App
approval/activation, and any required-check or environment change. Inert
tests prove none of those live behaviors.

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
- [Run ID and attempt semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/variables#default-environment-variables)
- [Read an exact workflow-run attempt](https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run-attempt)
