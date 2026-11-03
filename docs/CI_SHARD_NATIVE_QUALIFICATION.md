# Terminal native-shard qualification: 2026-11-02

This is a source-bound implementation/evidence record for task T3 in
[the Terminal CI qualification plan](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/50e6447c22f3c6bfee8072f7af1d13b6c25f487f/docs/CI_SHARD_QUALIFICATION.md),
not a new runtime, scheduler, workstream or accepted performance result.
Parent continuity: [Mastermind #1607](https://github.com/mastermindx-market-intelligence/Mastermind/issues/1607).
Original source carrier: [Terminal #1223](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1223),
`sol/ci-shard-critical-path-20261102`; operation correlation `ci-shard-critical-path-20261102`.
Protected procedure pin: Mastermind `22c08067ed0f480d1d5324a815fa248661c4ab46`.

## Source and measured bottlenecks

Run 41521626838 checked out **`3c2122788f7332af4a9d026da5eb40f3ab517972`**:
the merge of source `a8eadffd07e54b7d7744aa085464a233b42d2086` into protected
base `ed2e633852564dcd604afc26eb03eeed54954dee`. Its 23 successful jobs cost
481.300 summed job-minutes and took 41m23s, missing the <=40m experiment target.
Its desktop-1 job took 41.250m; the native reporter attributed 7.3m to the Pine file.
The source workspace was fast-forwarded to this exact already-measured merge tree
before the following coverage comparison. Earlier bare-head list probes are not
used as the integrated baseline. Current master may move; the next hosted checkout
and timing must be recorded separately, not inferred from this local proof.

A second concrete defect surfaced during native list qualification: Playwright's
normal test discovery imports `e2e/tools/visualEvidence.test.cjs`, which registers
**Node test-runner tests**, not Playwright cases. The native JSON report was followed
by their side-effect output. On the integrated-tree local collection, just the
writer-reader contract case consumed **121.523 seconds**.
That is local evidence of misplaced work, not an estimate of hosted runner savings.

## Bounded implementation

1. Move the unchanged Pine browser test to `e2e/pine-chart-engine.spec.ts`.
   Native selection now puts its eleven cases on desktop-5, tablet-4 and mobile-4.
   The one active source comment referencing its old name is updated. No assertion,
   fixture, iteration count, timeout, retry, worker setting, project or serial group
   changes; no custom test selector, duration database or new runner is introduced.
2. Move the unchanged Node contract to `e2e/tools/visualEvidence.node-unit.cjs`,
   outside Playwright's default filename pattern. Run it explicitly **once** in the
   existing required `terminal-unit` job with
   `node --test e2e/tools/visualEvidence.node-unit.cjs`.
   This is segregation of an unchanged native unit suite, not removal of browser
   coverage. Its failure still reaches `Terminal typecheck + tests` through the
   existing unit dependency. No new job or fail-open/conditional step is added.
   Twelve immutable historical operation/start receipts referencing the old name
   remain unchanged; they are not relabeled as evidence from this source revision.

Byte preservation against the measured merge tree:

| Suite | Bytes | SHA-256 before and after |
| --- | ---: | --- |
| Pine | 8074 | `ab00561c1f8cc47de557814ba00eb4c044885cf0e54c0fd80cbce7934fbc402a` |
| Native evidence contract | 25728 | `0a919d6b924b70a9746dc1d04a3eafdc435b243f2bc2c7807d1cb3b3f28ed47f` |

## Actual local qualification

Locked Playwright 1.61.1, the original configuration and CI environment selector.
Before and after native `--list --reporter=json` reports retain **3,973 identical
browser-test identities**, normalizing only the Pine filename. Identity comparison
includes project, file, nested titles, source line/column, timeout, expected status
and annotations. Counts remain 1,287 each for desktop/tablet/mobile; 27 each for the
three company-intelligence projects; 4 intermediate-chrome cases; and 27 workspace
cases. This includes pre-existing declared skips; it is not a claim that every case
was executed in this local collection.

Every one of the existing 18 matrix entries was then invoked with its actual native
project/shard flags and `--list --reporter=json`. Their union equals the complete
unsharded identity set: **zero missing cases, zero duplicated identities**. Output
is now strict JSON without the Node-suite diagnostics. These are local collection
times with two concurrent readers, not hosted execution time or fleet percentiles.

| Native matrix entry | Cases | Pine cases | Collection seconds |
| --- | ---: | ---: | ---: |
| desktop-1 | 184 | 0 | 4.098 |
| desktop-2 | 184 | 0 | 4.092 |
| desktop-3 | 184 | 0 | 2.244 |
| desktop-4 | 184 | 0 | 2.257 |
| desktop-5 | 184 | 11 | 2.087 |
| desktop-6 | 184 | 0 | 2.061 |
| desktop-7 | 183 | 0 | 2.291 |
| tablet-1 | 258 | 0 | 2.285 |
| tablet-2 | 258 | 0 | 2.411 |
| tablet-3 | 257 | 0 | 2.557 |
| tablet-4 | 257 | 11 | 3.508 |
| tablet-5 | 257 | 0 | 3.472 |
| mobile-1 | 258 | 0 | 2.934 |
| mobile-2 | 258 | 0 | 3.051 |
| mobile-3 | 257 | 0 | 2.218 |
| mobile-4 | 257 | 11 | 2.364 |
| mobile-5 | 257 | 0 | 2.196 |
| serial | 112 | 0 | 0.820 |

The full preserved Node suite ran under its own runner: **38 passed, 0 failed,
0 skipped**, 176.631 seconds locally. A temporary mutation changed one existing
assertion from expected 30 to 31; the native runner returned exit 1. That mutation
and its one-case diagnostic selector were removed and are not CI source changes.

The original shard guards plus the new native-contract guard cover missing,
duplicated or inconsistent shards, narrowed selection, missing/duplicated unit
execution, a test-name filter, masked exit status, conditional/fail-open steps,
multiplication by a unit matrix, wrong working directory, an omitted required
aggregate dependency, missing contract source and accidental rediscovery under
its old browser-test filename. Type generation, full TypeScript checking and diff
validation also passed. The existing Python CI command collects `tests/`, including
these coverage guards.

## Remaining acceptance gates

This candidate remains **Draft / performance unaccepted** until a complete hosted
run demonstrates the <=40m wall-time and <=10% job-minute-increase boundaries against
the documented references. File placement is source-dependent and must be remeasured
as the suite evolves. The unit job retains its existing 20-minute cap. Independent
nonauthor review, protected integration and representative postmerge proof remain
separate requirements. Local collection equality, byte preservation, typecheck and
native unit results do not constitute browser execution or release acceptance.


## T3 continuation: reduce routine CI trace collection

Recorded 2026-11-03 UTC under the same original #1223 operation and task tree.
Protected procedure for this continuation: Mastermind
`7f1242bfa90f0f0448e66e400e054bd5aa5fa15a`.
The experiment baseline is published Terminal
`5d28d9ecf7e2f98ed980f2fc8e59dc91e878e8d9`.

### Completed hosted baseline and the remaining queue constraint

Run [41535132670](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/41535132670)
completed successfully, 23/23 jobs, in **79m29s** from creation to workflow completion.
Summed job wall time was **443.900 minutes**. Initial jobs queued for 7m17s–31m04s;
the final gate queued for 18m42s before executing for 5s. Its longest execution
was desktop-7 at 38m11s. The <=40m total-latency target was not met. Removing queue
time mathematically is not an observed successful run.

The earlier 7/5/5 reference used 481.300 job-minutes: the newer 443.900 is 7.77%
lower directionally, not a controlled same-head estimate or a billed-cost claim.
All 18 browser-job logs were inspected. One retry-pass was reported, in
`settings-targets-summary.spec.ts:9:7`, Chinese desktop. It is separate from
#1225's entrance-geometry repair.

The retained desktop-7 artifact is 13187566024, SHA-256
`de592dbef2f75fb836c944545115421978aa809b59512c469e297b2444149202`.
Its trace records the Settings click action ending before the test-client call
returns; the subsequent tab click starts only after timeout teardown begins.
That localizes the reported error but does not establish tracing as the cause.
Four exact-head local cases (EN/ZH, repeat twice, zero retries) passed in 38.7s. The hosted
stall remains unresolved; no Settings assertion or product behavior was edited.

### Trace-only candidate and explicit diagnostics tradeoff

CI now selects `on-first-retry`; local default remains `retain-on-failure`.
This avoids recording and then discarding traces for successful initial CI
attempts. CI still has two retries, one worker and its 60s timeout. Screenshots
remain `only-on-failure`. All test assertions, projects, matrix entries, native
unit execution and required dependencies remain intact.

With two configured retries, the first retry's trace is retained even when that
retry passes. Initial-attempt and final-retry traces are not collected by default.
Initial failures retain their screenshot, error context and normal reporter
output, subject to the usual timeout/teardown availability. First-attempt-only
failures may therefore have less diagnostic detail. For a bounded diagnostic
reproduction, use the existing CLI override `--trace=retain-on-failure`; this
does not reconstruct an earlier missing trace or introduce an automatic rerun policy.

Primary behavior reference:
[Playwright recording modes](https://playwright.dev/docs/test-use-options#recording-options),
verified against locked Playwright 1.61.1. This is an explicit diagnostics-policy
experiment, not removal of tests or a claimed fix for the hosted timeout.

### Local measurements

All measurements use the unchanged baseline source, macOS/M2, Node 26.5.0,
Playwright 1.61.1 and the installed lockfile/browser. Each arm starts a fresh
`CI=1` dev-server process with its own free port and output directory. Existing
Next compilation caches remain; these are not clean-cache or Ubuntu/Node 20
benchmarks. The host has other work, so full hosted acceptance remains required.

| Experiment | Retain every attempt | Trace first retry | Observed result |
| --- | ---: | ---: | --- |
| Settings EN/ZH repeat twice, A/B/B/A, zero retries in both arms |34.677s,33.970s|29.450s,27.591s|16/16 executions passed; average process wall17% lower |
| Settings, watchlist-review, workspace-refinement;14 cases per arm, normal CI retries 2 |125.016s|110.952s|28/28 passed, no skips/retries; process wall11.25% lower |

The small A/B/B/A experiment's summed test times average 18.7335s versus14.167s.
The broader cohort's summed test times were 105.305s versus95.849s. The broader
A/B order was not counterbalanced; its result is supporting local evidence.
Do not extrapolate these percentages to the complete workflow, queue, fleet
percentiles, or merge turnaround.

Reproduce the small experiment with `CI=1 TERMINAL_E2E_PORT=<free-port>` and
`playwright test e2e/settings-targets-summary.spec.ts --project=desktop
--workers=1 --retries=0 --repeat-each=2 --trace=<mode>`, in A/B/B/A order.
For the broader experiment select that file plus `e2e/watchlist-review.spec.ts`
and `e2e/workspace-refinement.spec.ts`, omit the retry override and repeat flag,
and retain the same one-worker, fresh-server conditions.

### Coverage and failure-evidence qualification

Native before/after collection preserves **3,973 identical browser identities**,
including project, file, nested titles, line/column, timeout, expected status and
annotations. Canonical JSON identity digest:
`6461d543c601e0cd5290281187c72af4f7267310e9fef6d263b36749441b1aea`.
This includes existing declared skips; collection is not full browser execution.
The 33 existing shard and native-unit ownership guards pass. Full TypeScript
checking and diff validation also pass.

A disposable qualification fixture outside `e2e/` used the real browser runner,
two retries and the proposed trace mode. One intentional first-attempt failure
passed its first retry; a second intentional failure failed all three attempts.
The runner returned **exit 1**, reporting one flaky case and one failed case.
Every failed attempt retained screenshot/error context. Exactly two trace ZIPs
were retained at retry 1, including the passing retry, each containing test and
browser trace streams. Thus the trace policy does not turn a permanent failure
green. These deliberate failures and their fixture are not committed CI cases.

The original workspace retains the incident archive, native reports, local
timings and negative proof under
`terminal/test-results/ci-shard-investigation-20261103/`.
They are diagnostic outputs, not a new authoritative state store.

### Release decision

This remains a **Draft experiment, not accepted or deployed policy**. Full
exact-head hosted browser execution, total <=40m wall time, the existing <=10%
job-minute-increase bound, independent nonauthor review, protected integration
and representative postmerge evidence are still required. Queue admission is
an independent constraint; trace collection alone does not resolve it.
