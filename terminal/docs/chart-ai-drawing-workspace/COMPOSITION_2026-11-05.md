# Chart AI drawing workspace — current source composition, 2026-11-05

## Outcome and scope

Original Terminal [PR #1048](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1048)
is composed onto protected master `50713efda7cbd06c60b6dce2f88b31cea5c005a2`.
The first parent is the original carrier's namespace reservation
`1d026f58fb0de4cd6ff1a0bf7a38edc7ddf46a34`; the additional parent is that
protected master. This file's containing commit identifies the full composition.
No alternate PR, runtime, journal, drawing owner, queue or release path is created.

The original objective remains the useful native AI drawing/indicator workflow:
multi-tool plans on the exact chart target, inspectable individual and compound
objects, accessible AI inventory, human/AI ownership, durable recovery, coherent
study settings, Stop/continuation, and honest execution readback. This source
integration advances that objective; it does not establish deployment or live
ordinary-provider acceptance.

The original delivery plan and all 42 files under
`terminal/docs/pr-crops/chart-ai-drawing-workspace-20261018/` are preserved by
their original Git blobs. Their old screenshots, reports and test counts are
historical evidence, not verification of this composition. The current Chairman
Web review waiver supersedes the older plan's blanket independent technical
review requirement. Actual protected CI, formal review vetoes, mandatory
non-author approval and release/security holds still bind.

## Current source owners retained

| Surface | Composition |
| --- | --- |
| Account identity and drawing API | Current authenticated owner header, UUID session lifecycle, existing invoker read/replace RPC path and full error handling. No old owner_id insert/delete path. |
| CAS and operation replay | Existing expected revision and operation ID; an unknown attempt retains its exact drawings and identifiers. No new attempt is substituted to bypass an unknown result. |
| Local recovery | Existing v2 journal, Web Lock/IndexedDB ownership and cross-tab union/receipt semantics. Legacy human imports remain compatible; unadmitted AI payloads are never filtered into a human-only import. |
| Shell state | Existing shared drawStore, pending saves, journal and synchronous ref. Human edits/undo preserve the latest AI partition; AI edits preserve current human drawings. A refused commit does not consume undo history. |
| AI command owner | Current chart bus target/receipt/Stop path, committed account and chart activation, current symbol/timeframe/pane checks and accepted load generation. Undefined means unresolved; an accepted empty array means empty. |
| Native selection | Existing exact-child AI remove callback. Absent/refused ownership keeps selection; no human persistence fallback or invented command ACK. |
| Thesis navigation | Current browser-location subscription and stable useEffectEvent popstate listener. Router changes invalidate a queued reconciliation which rechecks current pending/dirty/session/selection state. |

Journal commits validate both every new working copy and every immutable
attempt **before** any durable write or receipt claim. This closes a concrete
source-test failure where invalid in-memory data could replace a readable
journal and then disappear on the next read. Previously good bytes survive a
refused write.

## Installed capability and strict mixed contract

The literal `chart.ai_drawing.v1` is accepted only from a successful collection
read belonging to the current account epoch and load generation. A client
constant, placeholder array or feature flag cannot certify installation.

Mixed documents retain the existing 500-object collection bound and admit at
most 60 AI objects, 64 points per object, bounded IDs/command/batch provenance,
48 native draw.tool kinds, safe nonnegative sequence numbers, compatible
operation/kind geometry, positive finite prices and supported epoch-second
coordinates. Independent child IDs and shared sequence numbers remain legal.
Captions use at most 140 UTF-16 units; fresh text truncation preserves scalar
boundaries. Malformed UTF-16, NUL and contradictory provenance are refused.
Stored operation payloads are validated without normalization or repair.

Missing/unknown capability leaves human-only work usable. A retained mixed
local copy remains visible through a derived view of the same drawStore when
its GET/receipt is unresolved. It does not enter the command mirror or become
an accepted collection. Individual visibility and whole-layer visibility are
preserved; an accepted successor replaces that view without duplication.

The existing ChartPane/ChartPanel path carries an explicit AI read-only
presentation condition. Inspector changes, native drag/handle movement, text
commits, wheel styling, arrow keys, AI-derived paste and automatic legacy-pane
conversion refuse unavailable AI targets. Existing AI Delete delegation and
legend gates remain intact. Readiness loss cancels only an actual AI edit,
discards its temporary clone/preview and restores the current AI projection.
A human gesture remains active even when the prior selection is AI. The
persisted locked flag is not rewritten to simulate this boundary.

## SQL 0050 and namespace

0050 was reserved on the original carrier **before** SQL authoring. Its row is
now taken by `0050_chart_ai_drawing_workspace.sql`, PR #1048 open, application
false and application date null. All other reservation rows, including #1290's
0049 claim, are unchanged. Unmerged 0049 SQL is absent.

The source migration replaces only the incumbent 0031 validator and collection
reader. The existing replace RPC body, operation replay/CAS, table privileges,
owner filtering and RLS remain unchanged. 0031 itself is preserved byte for
byte. The new reader returns the installed capability only on accepted reads.
Legacy rows cannot smuggle AI provenance into a human payload.

**UNAPPLIED.** Source publication has no database effect. The migration operator
must qualify and execute the entire transaction atomically, with real catalog,
owner isolation, replay and behavior receipts. BEGIN/COMMIT must not be applied
one statement at a time. The adjacent migration README records the exact source
digest, prerequisites and rollback limits. Automatic downgrade deliberately
refuses. Manual restoration of only the two 0031 definitions requires proof
that no mixed operation was ever accepted, writers are quiesced, and no mixed
attempt is in flight or has an unknown outcome. Empty current AI rows cannot
prove that operation-history condition. Otherwise retain compatible reads,
data and exact receipts and use a forward-compatible repair.

## Verification actually executed

- **267/267 actual-source test-body cases passed** across drawingPersistence,
  drawingSaveConflict, drawingAiPersistence, drawingAiPersistenceContract,
  chartNativeDrawingTools, drawingOwnerLifecycle and drawingOutbox. These ran
  through a local assertion adapter, not the native Vitest runtime. Nineteen
  real TypeScript module bodies were loaded; four unrelated indicator imports
  were tripwires and none was called.
- **30/30 actual-source callback cases passed** with controlled hook/I/O ports:
  accepted-read authority, account/load retirement, exact pending attempts,
  human/AI partition and undo, capacity refusal, native exact-child deletion,
  public history sanitation, unresolved recovery visibility/hidden inventory,
  accepted empty/populated successors, AI edit and clone retirement, and
  preservation of unrelated human gestures. This is not a React/DOM/browser run.
- Namespace validation passed in normal and PR #1048 scope, preserving the
  truthful disclosure that its authored migration remains in an open PR.
- Python AST parsing passed for the disposable PostgreSQL fixture. Source
  inputs, changed paths, unchanged owner contracts and the complete publication
  tree are checked separately and recorded in the PR's composition receipt.

The first persistence adapter run exposed the invalid-journal overwrite
defect; the implementation was repaired and the original failing assertion
passed. A source audit also caught and repaired recovery-control JSX and
native read-only transaction edge cases. Assertions were not weakened to
obtain these results.

## Authored qualification that remains unexecuted here

Native tests retain existing assertions and add current-contract cases for
mixed API reads/replacements, v2 unknown-attempt recovery, unsupported installed
capability, independent child provenance, malformed text, A→B→A account/chart
retirement, disabled inventory controls and history reconciliation without an
unauthorized retry loop. The browser recovery cases now assert visible
read-only AI geometry and unchanged exact journal attempts through native
selection, styling, keyboard and drag gestures.

`tests/test_chart_ai_drawings_postgres.py` uses the established disposable
local socket fixture pattern. It installs 0002/0031/0050, reapplies 0050, checks
that the replace RPC is unchanged, and exercises mixed validation, owner
isolation, operation replay/hash/CAS/superseded receipts, bounds and legacy AI
refusal. It accepts no production endpoint or credential.

React/Vitest, a full TypeScript compiler, browser runtime and PostgreSQL
binaries were unavailable in this session. Those native checks and production
proof are **DEFERRED/NOT PROVEN**, as permitted by the current Chairman
instruction. Newly published source must receive its natural exact-head
hosted CI; historical green checks do not qualify it.

## Remaining delivery frontier

### Natural-CI repair on the same source carrier

The initial composition at `0a01cacc781c4a7f15045a2a115054d92e2d500e`
produced concrete failures in
[run 42075207358](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/42075207358).
This follow-up repairs their source causes while preserving the original
assertions and historical evidence:

- Unit job `127413475118` reported 15 failed, 18,995 passed, 50 skipped and
  four todo cases. A late thesis-list completion could overwrite a detail
  401 and cause another detail request. The existing owner reset now retires
  both request generations; non-auth list outcomes preserve session expiry.
  Held response/body/rejection and retired-account cases are added to the
  existing mounted test. Twenty-three new AI-specific EN/ZH keys move to
  `chartAiCopy.ts`, restoring shared i18n to the exact master bytes without
  changing unrelated evidence projections.
- Five legacy visual packets need genuine captures after their source changed.
  The existing CI owner conditionally invokes their existing producers:
  claims12, research20, proposals8, Conductor6 and Options5. Options runs
  asynchronously inside PL6's original warmed fixture server. PL6/VI remain
  two immutable operations with 50 selected cases. Existing native readers
  and the existing always-uploaded diagnostics directory remain the owners.
  Complete previous and returned packets are archived, including partial
  Options output when its child fails. Conductor `before/` and the historical
  Options coverage audit must remain byte-identical. No PNG or historical
  manifest is restamped or committed by this repair.
- The four enrolled legacy producers now share bounded owned-server settlement,
  attempt-bound completion and refusal propagation in that same CI owner.
  They remain dependency-light when imported before dependency installation,
  capture the full required matrix, and inspect the actual dev-indicator DOM
  without removing overlays. New packet receipts say
  `CAPTURED_AWAITING_UNIT_VALIDATION`; a zero capture exit is not product
  acceptance. The existing 55-minute capture / 90-minute unit limits remain.
- Tablet job `127413475266` exposed two recovery races. Capability rereading
  after a deferred load now requires successful save settlement, preserving
  the superseded/blocked review choice. Later cloud reads preserve the exact
  persisted conflict classification. Ownership and unknown-save rejections
  take precedence over other park reasons; the recovery handler rechecks both
  the durable entry and displayed allowed choices before any mutation.
- The command-palette and overnight-refresh fixtures requested EMA `len`,
  which the current strict indicator contract does not define. Their intended
  period37 uses `ma1Len`; target invalidation, application receipts and
  persistence expectations remain intact. This repairs the EN/ZH tablet
  command cases and the two desktop4 overnight cases without weakening the
  production validator.

Follow-up local verification executed 60 native Node orchestration/control
tests; 16 focused actual-source conflict test bodies; 17 actual recovery
callback/condition probes; 10 actual thesis async-source cases; and 46 EN/ZH
copy lookups. The source adapters are not mounted React, Vitest or browser
execution. The new full browser captures and current-head native suites still
belong to the next natural CI attempt.

Natural exact-head CI42075207358 on composition0a01cacc reported one ingest
failure in job127413476648: 0050 lacked the required down/readback blocks
(3659 passed, 1 failed, 36 skipped, 297 subtests passed). The follow-up adds an
explicit refusal of automatic downgrade, the conditional exact-0031 recovery
procedure, and four catalog readback queries. The canonical existing applier
reports no idempotency findings and parses one refusal/four readback statements.
All nine executable migration statements are unchanged after stripping comments.
No database operation or rollback was performed. The migration README digest
tracks the actual revised source bytes.

1. Reconcile this composition on the original #1048 branch and inspect its
   natural hosted CI. Repair concrete failures on that carrier.
2. Complete any actually mandatory protected approval and the real SQL operator
   qualification/application gate. This document neither self-approves nor
   self-merges the source.
3. Advance paired [Macro #9601](https://github.com/mastermindx-market-intelligence/macro/pull/9601)
   through its actual gateway/shared-widget/Sector Central release constraints.
   Keep producer/receiver compatibility and existing release ownership.
4. Use the existing git-gated deployment path and record served-source identity.
   Prove the ordinary-provider workflow on desktop/tablet/390px, EN/ZH, with
   exact target/ACK, native selection, persistence/recovery and truthful
   uncertainty. No fixture, screenshot or model reply constitutes trade authority.

Canonical sweep coordination remains
[Mastermind #2028](https://github.com/mastermindx-market-intelligence/Mastermind/issues/2028).
The source-law pin for this work is
`0efd0744ac705ddc24880acde1cb4ac6e8c55d05`. This is a source integration
milestone; the original product acceptance remains open.

## Saved-detail history reconciliation follow-up — 2026-11-05

Exact published head `d2b80088b4d29f9647a0c835c10e2a87c48d04af` passed its
unit/typecheck job in natural CI42090185933. Desktop-5 job127466715514 then
reported245 passed,23 skipped and two failures, each repeated on all three
attempts: `thesis-workspace.spec.ts` five-key v2 recovery and historical six-key
recovery reached Retry same request but lost the expected Saved-as-version
message. One exact log and exact-head component/spec sources established this
bounded source diagnosis; no browser trace or final DOM state is inferred.
The later mobile-3/job127466715687 and tablet-3/job127466715456 logs show the
same two failures on all three attempts, with340 passed/108 skipped and
349 passed/98 skipped respectively. Both used integrated checkout
`c84bb2c` from d2b80088 into50713. No distinct failure or broader repair is
inferred from those logs, and neither job was rerun here.

The accepted four-field201 receipt was valid. Its consumer cleared pending,
published the saved route and message, then awaited the list read while detail
state was still idle. The current history catch-up therefore treated the saved
route as an unstarted detail, called the ordinary reopen path, cleared the
receipt message and started another detail read. The recovery fixtures and
their exact-byte POST/storage-clear assertions are retained unchanged.

The existing consumer now claims its detail-request generation and sets the
saved selection to loading before publishing its route or yielding. After the
list read returns, it starts the canonical detail read only if that same
generation still owns the transition, passing the claimed token into the
existing loader. Later navigation or owner retirement therefore prevents an
obsolete save continuation from starting another detail read. This adds no
retry, storage, identity, cache or history owner. The actual same-id/idle history
catch-up and terminal401 latch remain unchanged.

**Local validation:** twelve probes execute the actual `consumeResponse`,
`loadDetail` and `reconcileHistoryLocation` callbacks, with the actual exact-key
and pending-subject helper bodies, through Node24 TypeScript stripping and
controlled committed-state, route, parser, storage-settlement and network ports.
The previous source passes seven and fails five discriminating transition
cases; the repaired source passes all twelve. The final component SHA256 is
`cf5ce887428f61689dfc9e1a7867ab44013dbd87d27c66579cf1ace4be9effd3`.
These probes are not native React, Vitest, browser, POST or production execution.

Three mounted regressions are added to the existing ontology/history suite:
both original recovery-envelope forms keep the receipt while a controlled list
read is pending, and a later real history transition retains ownership when
that list finally settles. They retain exact request bytes and original storage
clearing. These mounted cases are authored but unrun locally; normal current-head
CI remains responsible for them and the unchanged browser recovery journeys.

Only the component, its existing mounted suite and this note change. The strict
receipt grammar, pending carrier, source-qualified drawing behavior, native
evidence readers, complete capture matrices and historical artifacts remain.
The incumbent capture owner will regenerate any genuinely required packets from
the new source in its disposable CI checkout; no screenshot/hash restamp or
manual rerun occurred. SQL0050 remains unapplied, Macro#9601 coordinated release
and ordinary-provider live acceptance remain separate, and this follow-up adds
no merge admission, deployment or product-completion claim.

## Recovery confirmation visibility follow-up — 2026-11-05

Natural CI[42098881998](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/42098881998)
at source head `69e09a15c022c746b7bba814345857f1b6308278` exposed a
separate rendering defect in unit job[127496922202](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/42098881998/job/127496922202).
The full job reported19,015 passing tests and two failures. In the existing
ontology/history suite, both recovery-envelope regressions expected the accepted
Saved-as-version confirmation while the controlled list read remained pending;
the detail pane rendered only Loading. The later-navigation generation case
passed. This is evidence of hidden confirmation rendering, not evidence that
the prior generation-retirement guard failed.

The existing message paragraph is moved once from the editor-only alternative
to immediately after the back control and before the detail-state conditional.
It stays inside the same authenticated workspace/detail pane, below the existing
session-expired branch. Its state, copy, status role, class and clearing rules
are unchanged. No request, receipt, pending carrier, generation, route, save,
history or authentication behavior changes. Removing the one message line from
both old and new source yields byte-identical component text; the new component
Git blob is `85b33a8f3309d31a95107bc77d90d6b799234b58`.

The existing two failing mounted tests and the later-history test are retained
byte-for-byte. The local execution workspace became unavailable during this
sweep. This follow-up was therefore checked by exact Git blob verification,
bounded source/diff inspection and the relocation-only equality check through
the working GitHub connection. Native React/Vitest, TypeScript, browser and
production execution were not performed locally. The Chairman's express
completion-proof waiver permits this source repair without those unavailable
local checks; it does not waive protected CI or any release/security hold.
The new source head's natural CI must establish the resulting test outcome.

The incumbent capture owner still recaptures genuinely changed source with the
existing full packet readers; no evidence is restamped and no manual rerun is
requested. SQL0050 remains unapplied. Macro#9601 coordinated release and
ordinary-provider live acceptance remain separate. This source follow-up adds
no merge admission, deployment or product-completion claim.
