# Investigation kernel repair — source verification

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
relabels the draft without checking its layout. While a save is pending, every
draft edit is locked, so at settle time the draft still names the sent layout,
and that change has no reachable effect. Removing `disabled={frozen}` on the
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
