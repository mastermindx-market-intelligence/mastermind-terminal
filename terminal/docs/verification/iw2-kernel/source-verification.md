# Investigation kernel repair — source verification

## Legacy save retries and stored invalid_payload refusals (T03j, 2026-10-09)

Base `9a17b8d8`. Two review findings on #804. Both concern a browser tab that was
opened before the current write contract and then lost a save response.

Legacy save retry (`app/api/investigations/route.ts`). Such a tab retries the lost
save with the same POST. The current write contract refuses that older request
shape, so the route answered `invalid_payload` (400) without asking the database,
even when the original had already committed. Now a POST that the current
contract refuses but the recovery parser accepts goes only to the reconciliation
owner, `reconcile_investigation_operation_v2`, with the full original request. The
owner returns the original receipt, a matching no-effect fence, or
`idempotency_conflict`. The request is never rewritten and never applied as a new
write. This is IW2's proposal patch `iw2-legacy-post-api-proposal-20261009.patch`
(SHA256 `c4f1d78cde88e9c03a8952035266b2c90e9e76a68dd693eb85ef86f5e2fbce55`),
applied unchanged in commit `8bebc87f`. `route.ts` is byte-identical to IW2's
proposed route (SHA256 `e48e5bbb93a8196c04c62e512976eeedfca2e0587cfa8f06346bcc8442a44fdf`).

1. Only recovery-shaped requests take this path. Current writes still go to apply,
   and PUT still goes to reconciliation. The current client cannot send a
   recovery-only shape: Save refuses it before sending, and Try save again sends
   either nothing or a new operation that the current contract accepts. Tests:
   "keeps strict current writes on apply and the PUT recovery path on
   reconcile" and the four "(iii) never sends a request with …" cases (no
   `argument_relations`, a calendar as-of date, a review baseline outside the
   evidence, a capture with `revision_id`).
2. The request names no account. The owner takes the account from the session.
   A body that names a `principal`, `user_id`, `owner`, `author_ref` or `actor`, at
   the top level or in the manifest, is refused with zero database calls. Two
   accounts send byte-identical owner arguments that contain neither account ID.
   Signed-out callers get 401, rate limiting runs before the session check, and the
   size limit runs before any database call.
3. A delayed original cannot commit after the fence. Against real SQL, the
   delayed original returns the fence and adds nothing, and a current POST that
   reuses the fenced operation is refused as `idempotency_conflict`.
4. A missing reconciliation function (before 0030 is applied, PostgREST
   `PGRST202`), a throw, a fence for another operation or a receipt for another
   operation each return 503. An owner miss returns 404. In every one of these
   cases the client keeps the save unconfirmed.

Stored `invalid_payload` refusal (`lib/investigationSave.ts`,
`InvestigationWorkspace.tsx`). An older tab that got that 400 stored the save as
refused. That refusal never proved the original failed. A reopened tab now
recovers it as unconfirmed with an owner recheck. The exact stored request is the
only request the owner is asked about. Save, Start new research and Try save
again send nothing new while it is unconfirmed. Other stored refusals
(`version_conflict`, `idempotency_conflict`, `invalid_transition`,
`reference_unavailable`, `layout_conflict`, `limit_reached`) are still trusted.

On reopen the tab makes the read it already made before this change: one receipt
read by operation ID. A receipt read returns only the result, not the action or the
layout capture, so it cannot confirm that the receipt answers this exact request.
When that read would end the uncertainty, the tab first sends the stored request,
unchanged, to the full-request owner. Only the owner's answer is shown. When the
read misses (404, 503, 401 or a network failure), nothing is sent and the save
stays unconfirmed: a receipt miss is not a fence. Check original outcome sends the
same full request to the owner, which fences a miss.

Full-request path: PUT `/api/investigations` → `mutate(request, true)` →
`parseInvestigationCommand(body, true)` → `reconcileInvestigationOperation` →
`reconcile_investigation_operation_v2`. The legacy POST branch above ends at the
same owner. The parsed manifest differs from the stored one only in key order,
and the database compares `jsonb` values regardless of key order.

IW2's first persisted-refusal test required a receipt-only read
(`iw2-persisted-invalid-payload-counterexample.test.tsx`, SHA256 `42810993…`).
IW2 withdrew that requirement as a transport assumption. That test is kept only as
the historical failure. This repair adds no read to satisfy it. Its acceptance
target is IW2's adapted owner test (`iw2-persisted-invalid-payload-owner.test.tsx`,
SHA256 `8450686a…1b42`; config `3f2defd8…3184`).

Evidence (fixture and local-database receipts, not authenticated production
proof):

- Route tests 25/25: IW2's 19 proposal cases and the six account checks. Helper
  tests 41/41 and mount tests 105/105, including 36 new owner recheck mounts
  across three request shapes.
- IW2 harness copies, run against committed source at the head and at `9a17b8d8`
  (copies differ only in the head constant, evidence directory and output path):
  owner test 2/2 (1 pass, 1 fail at `9a17b8d8`), account binding 4/4 (0/4), API
  proposal 19/19 (8 pass, 11 fail), route regression 25/25, saved-layout clear 3/3.
- Local PostgreSQL 17.11 with 0028–0030 from the head. API proposal qualifier:
  before 0030 4/4, with 0030 10/10, account and delayed-original checks 9/9; it
  fails at `9a17b8d8`. Cutover qualifier: 11/11, one record for one lost response
  (1 head, 1 revision, 1 receipt). At `9a17b8d8` its baseline reproduces the false
  refusal, and the repaired checks fail there (7 of 11 false). Unlike the harness
  copies above, these SQL qualifier copies add checks for this round: the account
  and delayed-original checks, the route read from git at the tested head, and a
  repaired mode for the cutover. A diff against each IW2 original is kept with the
  copies.
- Browser: the two new journeys pass at 1440×900, 820×1180 and 390×844 from a cold
  start, with screenshots of the unconfirmed state and of the saved record. A
  receipt miss sends nothing until Check original outcome; a found receipt is
  confirmed by the owner first. Neither journey sends a POST. The whole
  Investigation browser file passes all 51 cases at the three sizes from a cold
  start.
- Changes that undo the repair turn tests red, and none was committed. Removing
  the recovery rule fails 45 unit tests and both new browser journeys. Removing
  the owner check fails 18 mount tests and the found-receipt browser journey.
- Full Vitest: 500 files, 8,407 pass, four existing TODOs. TypeScript passes. The
  component's lint result is unchanged from `9a17b8d8`.

Status. 0030 is not applied and its bytes are unchanged. This round does not
qualify or accept the stale-tab, API and SQL cutover for 0030. Production
backup/restore is already accepted (scoped) under Macro #7532: 520 rows across 13
tables, readback of the exact references, and cleanup of the scratch project and
temporary credential. It is not a remaining prerequisite and was not rerun. Every
other #804 hold remains in force.

## Saved layout references have their own choice (repair round 2, 2026-10-09)

Base `36e5c5d7`. Two review findings on #804.

Saved layout references. When a draft started from a saved record or from a
retained create already named layout references, the layout list showed No
layout selected, and that choice meant "keep them". So after a
`reference_unavailable` refusal of those references, choosing No layout
selected changed nothing: Save stayed blocked and there was no way to send the
draft without them. Now:

1. The layout list has its own choice, Keep the saved layout (保留已保存的布局),
   whenever the saved record or the retained create names layout references. It
   is the selected choice when such a draft opens. It keeps those references
   exactly as saved and sends no layout capture.
2. No layout selected now means no layout: Save sends no layout references and
   no capture. After a refusal it is a deliberate change, so it allows exactly
   one send. The question, Thesis versions, evidence, baseline and next steps
   are sent as they were.
3. Keep the saved layout with references that were just refused still sends
   nothing, keeps the draft and session storage the same byte for byte, and
   shows the same guidance. The check in Save is unchanged.
4. An unrelated edit, such as the next question, keeps saved references entry
   for entry.

Review finding on the relabel survivor. The earlier record said the unchecked
relabel had no reachable effect. It does have one. After a save is confirmed
not applied, the form is open again, and Try save again sends the retained
request exactly. So the draft can name another layout while that retry sends
the old one. If the retry is refused for `layout_conflict`, the unchecked
relabel replaced the user's newer choice with the refused layout. A new mount
test, "keeps the newer choice selected after layout_conflict, and the next
Save sends it", fails under that change and passes with the current code.

Evidence. With only the new tests added, the six keep-choice tests fail against
the `36e5c5d7` product files; the two unrelated-edit checks, the blocked-again
check and the relabel test pass there. The unchecked relabel turns the relabel
test red there and on the repair. Eight more changes that undo part of the
repair were run on it, and every one turns tests red. The new browser journey fails against the `36e5c5d7` component and
passes all three sizes, 1440×900, 820×1180 and 390×844, from a cold start, with
screenshots of the kept choice while refused and after No layout selected. The
Investigation browser file passes all 45 cases. Full Vitest: 499 files, 8,325
pass, four existing TODOs. TypeScript passes. The component keeps its one
existing lint error and three warnings, identical by rule to `36e5c5d7`. These
are fixture-based receipts, not authenticated production proof. 0030 bytes are
unchanged. This round does not qualify the stale-tab, API and SQL cutover for
0030, and every #804 hold remains in force.

## Refused layout and Thesis references are not sent again unchanged (repair round 1 follow-up, 2026-10-09)

Base `da8cb09f`. 0030 refuses a save for good when a named layout no longer
matches its saved revision (`layout_conflict`, 0030 lines 251 and 255) or when a
layout or Thesis version named in the draft is no longer available to the account
(`reference_unavailable`, lines 231–233, 237–241 and 250). Before this change, ordinary Save sent
the same refused references again under a new operation, and the message was the
generic conflict text. Now:

1. A pure check, `resendsRefusedReferences` in `lib/investigationSave.ts`, runs in
   Save after the request is built and before anything is stored or sent. Within
   the refused request's own line (any create after a refused create, or a revise
   of the same record), it blocks the same layout capture after
   `layout_conflict`, and the same capture, layout references and Thesis versions
   after `reference_unavailable`. Order and Thesis role do not count as a change,
   because the server does not judge them. Other refusal reasons, other accounts
   and other records are never blocked. A deliberate change of layout, No layout
   selected, Remove reference, or another Thesis version allows exactly one send;
   a new refusal blocks again. Start new research resets the state.
2. A blocked Save sends nothing: the draft and session storage stay byte for
   byte the same. The message says what was refused and which control fixes it,
   in English and Chinese. It never says Title is required. A create is never
   told to reopen a latest revision. A reopened revise, which has no record to
   reopen from the page, is directed to Open latest revision. The copy never
   promises that choosing the same revision again will help.
3. After an in-session refusal, the refused capture stays the retained choice.
   The draft is relabelled only if it still names the refused layout, and the
   layout list is read again with the same owner filter and nothing selected
   for the user. A failed read shows the layout-unavailable message and keeps
   Save blocked. A chosen layout that the list no longer shows is listed as
   Chosen layout (not in the current list), and Save names it instead of
   sending.
4. "Try save again" appears only after `not_applied`, so it was already absent
   after these two refusals on `da8cb09f`; tests pin that it stays absent. For a
   reopened revise, its three "cannot retry unchanged" messages now direct the
   user to Open latest revision. Creates keep their copy.
5. A test-only check pins that the as-of controls stay inert while the save
   outcome is unconfirmed.

Evidence. Against the `da8cb09f` product files with the final tests, 25 tests
fail and 54 pass; the as-of check and the create-copy check pass there by
design. Eighteen reverted-fix runs were made; 17 turn tests red. The survivor
relabels the draft without checking its layout. This round recorded it as
having no reachable effect; that was wrong, and repair round 2 below corrects
it with a test that fails under it. Removing `disabled={frozen}` on the
form, or the edit lock in exact-time apply or as-of removal, turns the as-of
check red. With the check in Save removed, both new browser journeys fail at
1440×900. Focused Vitest: 5 files, 114 tests pass. Full Vitest: 499 files,
8,315 pass, four existing TODOs. TypeScript passes. The component keeps its
one existing lint error and three warnings, identical by rule to `da8cb09f`.
The Investigation browser file passes all 42 cases from a cold start at
1440×900, 820×1180 and 390×844, with screenshots of the reopened
`layout_conflict` and `reference_unavailable` states. These are fixture-based
receipts, not authenticated production proof. 0030 bytes are unchanged
(SHA-256 `b840b111…471f4e`). This round does not qualify the stale-tab, API and
SQL cutover for 0030, and every #804 hold remains in force.

## Legacy as-of dates and recovered drafts (repair round 1, 2026-10-09)

Base `a156f6be`. IW2's retry proposal is applied unchanged as `f7d55f23`: its
changes are byte-identical, file by file, to the proposed patch (SHA-256
`3c96c021…600ee7`), and it changes no other file.
Four client defects dropped or silently refused saved context:

1. Editing a saved record dropped its `research_as_of`. An exact instant is now
   carried byte for byte, and an absent value stays absent. A calendar date
   blocks Save: nothing is sent, the draft and any retained request stay
   unchanged, and the message names the date and the way to fix it.
2. After an owner-confirmed `not_applied`, "Try save again" did nothing visible
   when the retained request could not be sent unchanged. It now says why (a
   calendar as-of date or a layout recorded in the older format), and session
   storage stays unchanged.
3. Ordinary Save of a recovered create rebuilt the record from the visible form,
   dropping subjects, evidence, the review baseline, argument relations,
   continuation and the layout capture. The retained request is now the base, as
   the saved record already is for an edit. A layout recorded with the older
   `revision_id` cannot be sent (0030 accepts only `layout_id` and
   `expected_revision`) and is not dropped: Save asks the user to choose the
   layout again. The symbol is locked, as it is for an edit.
4. A calendar as-of date has one deliberate path: an exact UTC date and time the
   user types, checked by the strict parser, or removal. Nothing is filled in
   for the user. English and Chinese copy; keyboard operable.

The retained as-of value is shown in the rejected-save details and while
editing. IW2's retry rule is kept; a unit test pins that a layout recorded in
the older format makes the retry return nothing.

IW2's four counterexamples are ported with stronger assertions. With them, the
mounted recovery file fails two of eight tests (the calendar edit and the
recovered date) and passes six, on both `a156f6be` and `f7d55f23`. Each fix has a run that fails before it
and at least one reverted-fix run that turns its tests red. The mounted recovery
file has 37 tests, and the save state file has 15. Full Vitest: 499 files, 8,288
pass, four existing TODOs. TypeScript passes. The browser journey for a calendar
as-of date fails against the `f7d55f23` component and passes from a cold start at
1440×900, 820×1180 and 390×844. The whole Investigation browser file passes all
36 cases. These are fixture-based receipts, not authenticated production proof.
The component keeps its existing one lint error and three warnings, which are
identical by rule and message to the baseline. 0030 bytes are unchanged
(SHA-256 `b840b111…471f4e`). This round does not qualify the stale-tab, API and
SQL cutover for 0030, and every #804 hold remains in force.

## Saved Research inventory ordering repair (2026-10-09)

Over exact source `95bfaf62845b777001f8ceeccb1a3e8de1e30b6e`, a delayed
mount-time library read could replace the post-save list, or a delayed failure
could hide the healthy list. Inventory installation now requires both the newest
request ticket and the original active authentication scope. An account scope
reset also clears the old library error. This changes neither RPCs nor persistence.

The nine component regressions use the actual save/readback flow with deferred
external responses. The unchanged source fails seven and passes two; the repair
passes all nine. Combined selection/save/recovery suites: 41 pass. Full Vitest:
466 files, 7,673 pass, four existing TODOs. TypeScript no-emit/non-incremental passes.
The affected responsive suite passes all 27 cases across 1440×900, 820×1180 and
390×844, including EN/ZH, 320px doubled text and the new delayed-response journey.
These are fixture-based browser receipts, not authenticated production proof.

The new component test and affected browser test pass ESLint with zero warnings.
The component itself has the same pre-existing one set-state-in-effect error and
three exhaustive-deps warnings on both the baseline and candidate; their rule,
severity and message identities were compared. Component lint is not claimed green.
Evidence and screenshots are retained under the original external evidence root
with prefix `inventory-race-`. Fabric request `iw2-inventory-race-20261009`
returned `NONE reason=no_pool_available`, then `NOT_FOUND`: no worker started.
The parent performed this bounded repair in the sole integration checkout.
All #804 review, rights, ingress, migration, CI and release gates remain in force.

Carrier: Terminal #804, original root `01a104c8-6e11-7e52-93c1-6b8dbc45bb9c`.
Base: current master `df7a4da3892655f242f626e78ff063d47c6a32ec`, integrated as
`b265bbdb322c068725e438d72417c2f36772c44c`. The release hold remains in force.

## Repair scope

- B1/B2: closed argument annotations, exact endpoint resolution, independent
  evidence ceiling, and full baseline membership.
- B3/B6: server UUID/lineage/digest/operation wrapper; retained layout owner mints
  and reuses one immutable identity per source revision.
- B10: same-operation reconciliation fence; delayed originals cannot write after
  terminal no-effect. Reopen uses receipt GET only; explicit Check uses PUT.
- B12/B14: shared canonical bytes/digests and exact RFC3339 milliseconds UTC.
  Old immutable records remain readable unchanged; new writes are strict.
- B4 source: selected issuer-release projection with injectable current rights,
  default denied. The previous mixed-workspace public-primary grant is removed.
- B13: PostgreSQL coverage runs inside the existing Python all-tests CI job.

## Local evidence

- 48 new semantic/canonical vectors consumed by TS, Python and PostgreSQL, covering
  256 relations and exact 131072/131073-byte boundaries.
- 57 isolated PostgreSQL kernel/CI cases pass, including real concurrent CAS,
  capture identity reuse, receipt failure rollback, delayed-original fencing,
  legacy readback, full dump/restore and read-preserving write-disable rollback.
- 321 focused TypeScript/component tests passed before the additional stored-read
  regression corpus. The later three-suite run passed 73 tests, including all
  added legacy-read cases and unchanged Pine runtime assertions.
- Full Vitest: 7404 passed, 4 todo, one Pine runtime 3000ms timeout under concurrent
  load. The unchanged four-case Pine suite passed in isolation; no budget raised.
- Full Python: 1641 passed, 8 local skips, 5 failures. The old-applied-migration
  corpus and two ledger metadata failures were repaired (94 targeted cases pass,
  one existing skip). Two unchanged Unix-socket tests passed on their normal
  temporary filesystem after the SSD-wide test base exposed cross-device rename.
- Responsive browser: all 36 cases passed at 1440x900, 820x1180 and 390x844, including
  bilingual views, 320px doubled text and keyboard. Nine affected recovery/review
  cases then passed again after adding the read-only reload assertion and preserving
  old evidence members when advancing the reviewed baseline.
- Type generation/typecheck is run with the dev server quiescent. An overlapping
  dev type-file write was regenerated; it is not an application type error.

Raw test logs remain outside the repository under the original evidence root;
no account data, browser secrets or provider credentials are included here.

## Migration and remaining gates

0030 is NOT applied. 0028 and 0029 executable/source files remain byte-identical:

- 0028 SHA256 `149e1a8ab0568430429e895031f8bd6314670879a647e75a30b8c103cb5187ea`
- 0029 SHA256 `edd8c8eb854c19a3487eca5f75155eddf97e197112fb56d300111ebf6591864f`

B5 raw ingress remains outstanding pending the original handoff's explicit
restriction on the denied #792 follow-up. The existing rights owner #7870 remains
Draft/open at `f12db8bff1d1a46a2c9fbf100bed8f6f3abc9ec9`; this source does not
manufacture its registry row or current authority. Independent review, exact-head
hosted CI, migration application/readback, deployment and repeated authenticated
G1 acceptance remain separate. This is not G1 or parent G0–G9 completion.

## Fabric contribution

`rs_20261005T073632Z_61956`, requested DeepSeek Flash through the actual GLM-preferred
picker, supplied the CI/fixture repair. Parent reviewed both files, added executable
binary checks and CI refusal tests, and preserved the old migration corpus. The run
settled COMPLETE with residual0. The worker reported preparing output before START;
that capsule-only scope violation was recorded separately from source acceptance.
No descendants or production rights were granted.

## Selected-release integration follow-through

The existing review and replay routes now recognize `selection.field=issuer_release`.
The current-rights dependency remains absent/default-deny in production. A permitted
fixture exercises only the closed release reference projection; the old mixed-owner
adapter is preserved and remains denied by its compatibility authorization function.

Container and selected-release fingerprints remain distinct in review, history and
explicit baseline advancement. A transcript-only container change is not a release
content change. The selected snapshot walks the same immutable owner history and
checks the selected older release's current rights independently of the root.
No current-generation fallback, new evidence store or source-body display is added.

Validation: 48 focused owner/route/component tests passed; 12 responsive browser
cases passed across desktop/tablet/mobile in English and Chinese; both selected
release journeys then passed at 320px with doubled text and keyboard focus. The
browser checks prove explicit GET-only review/replay and draft selection, including
separate selection/container identities and no automatic replay after reload.
These are source/fixture receipts, not production-rights or G2/G4 acceptance.

A further real-lock regression found that `recorded_at` was sampled before the
capacity lock wait. The unapplied 0030 migration now samples the write-phase time
after all lock admission and fallible validation. RED demonstrated a timestamp
before the admission marker; all 58 PostgreSQL/kernel/CI checks then passed,
including dump/restore and no-effect fencing. This does not rewrite older receipts
or claim a PostgreSQL physical commit timestamp.

## Actual migration transport

The approved `scripts/supabase_apply.py` sends separate statements on separate
connections. A real PostgreSQL regression reproduced `LOCK TABLE can only be
used in transaction blocks` with the old outer BEGIN/COMMIT file, after its
validator replacement had already committed. Unapplied 0030 now executes its
unchanged repair statements inside one dollar-quoted DO/EXECUTE block with a
transaction-local search path. The helper, applied migrations and readback
contract are unchanged.

The actual helper's `run_apply` now runs against separate local PostgreSQL
connections in `tests/test_investigation_migration_transport.py`: initial apply,
idempotent reapply, exact original receipt/manifest retention, and both ambiguous
receipt and duplicate-capture failures. Failure cases compare schema, function
definitions, grants, indexes, constraints and retained rows before/after. All 61
transport/kernel/CI checks passed. A production aggregate-only preflight found
one head/revision and zero duplicate captures, ambiguous receipt associations,
missing parents or missing head revisions; no 0030 columns were present. This
preflight is read-only and does not establish production migration acceptance.

Fabric SQL review `rs_20261005T085012Z_43838` returned PASS_SCOPED on 272596eb;
parent accepted its SQL-only findings, verified terminal cleanup and released
lease 67e935d33ff3. That earlier review did not cover the deployment transport;
the changed DO wrapper subsequently passed scoped review `rs_20261005T092050Z_23778` on 3db9d31a, with released lease 2d66ae4d43b6 and proven residual-zero cleanup. Constants-only live DO/EXECUTE probes confirmed transport syntax, without applying the migration. #804 remains Draft/HOLD.


## Current-base recovery qualification

Integration c6a1c9b0 merges Terminal master 99a7d973 without changing the repaired
kernel, migration or client recovery files. The complete Investigation Python
selection passed 177 tests plus 40 subtests with CI missing-binary enforcement;
139 selected TypeScript cases and TypeScript checking passed. PostgreSQL's first
local attempt could not start because macOS's temporary Unix socket path exceeded
103 bytes; the unchanged suite passed with a short external-SSD basetemp.

Parent integration testing then reproduced a client race: after the owner fences
a failed operation and a new save begins, a delayed failure response from the old
operation could reject the new pending state and unlock editing. Every POST,
reconcile PUT and receipt GET now carries its issuing command into settlement;
responses for a different operation, target, action, expected revision or owner
are ignored. A fenced retry clears obsolete failure text and confirms the exact
new operation in the local draft buffer before sending. Six mounted race tests
and seven recovery-state tests pass, including delayed-original failure and
failed exact retry-buffer readback.

The preceding static recovery review rs_20261005T101236Z_6577 returned
PASS_SCOPED but did not close the concurrent response-ordering gap exposed by the
parent's RED test. Its lease 726e02d55d18 is released with residual-zero cleanup;
its verdict is not accepted as approval of the final repaired source. Independent
review of this bounded delta, exact-head CI, B5, current rights, 0030 apply,
deployment and renewed authenticated G1 proof remain separate requirements.

## Receipt-cap no-effect fence and reload recovery

On 76e22c3d, reconcile of a new operation at the 4,000-receipt cap returned
`unavailable` and wrote no fence, so a delayed original could still commit after
the client had been told nothing. Apply and reconcile now share
`investigation_receipt_capacity_reached_v2`, checked under the capacity lock after
the receipt lookup. At the cap, apply of a new operation returns `limit_reached`
and reconcile returns the conclusive `not_applied` with `reason: "limit_reached"`;
neither writes a row. Receipts are monotone (authenticated callers cannot delete
them, no migration deletes them, the only cascade is account deletion), so the
original can never commit later. A service-role receipt deletion voids this.
Four new PostgreSQL tests fail when run against the 0030 bytes of 76e22c3d:

- `test_receipt_cap_reconcile_is_conclusive_and_the_delayed_original_cannot_commit`
  (the cap-1 fence, the conclusive answer at the cap, and the delayed original);
- `test_receipt_cap_keeps_existing_outcomes_replayable_and_is_per_principal`
  (replays and changed-reuse conflicts over the cap, and other principals);
- `test_receipt_cap_has_one_definition_shared_by_apply_and_reconcile`
  (one cap definition shared by apply and reconcile);
- `test_receipt_capacity_refuses_a_stale_snapshot_without_writing`
  (a REPEATABLE READ caller is refused and nothing is written).

Reconcile waiting for an in-flight apply is older coverage,
`test_reconcile_waits_for_original_transaction_and_returns_exact_commit`. It
already existed on 76e22c3d, passes there, and this round did not change it.

The client treats the at-cap answer as final: the uncertain state ends with a
limit message, the draft stays, and neither the original nor a replacement is
offered. A new save receives `limit_reached`. An unknown reason stays uncertain.
A reopened page with an uncertain save reads the original receipt exactly once
and never posts; browser and mounted tests record that read and fail when the
mount read is removed. Every mocked browser answer is a status the real route can
return. 0030 remains unapplied in production.
