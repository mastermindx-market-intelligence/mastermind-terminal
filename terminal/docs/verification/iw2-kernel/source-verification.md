# Investigation kernel repair — source verification

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
the changed DO wrapper requires its own review. #804 remains Draft/HOLD.
