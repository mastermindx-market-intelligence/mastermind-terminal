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
digest, prerequisites and rollback limits. After mixed data exists, rollback
must preserve that data and use a forward-compatible repair.

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
