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


## Hosted trace result and readiness repair — 2026-11-03

### Completed hosted result: faster wall time, reliability not accepted

The exact `ec642aa1d3dfe7c3e8616b7e11f78a90c7e4e70f` candidate completed
[run 41559833666](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/41559833666)
with all 23 jobs successful. The preceding `5d28d9ecf7e2f98ed980f2fc8e59dc91e878e8d9`
[run 41535132670](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/41535132670)
used the same 7/5/5 broad shard layout.

| Measure | Preceding head | Trace candidate |
| --- | ---: | ---: |
| Whole workflow wall time | 79m29s | 33m31s |
| Sum of job execution minutes | 443.900 | 445.233 |
| Initial job queue delay | 7m17s–31m04s | 2–10s |
| Final required-gate queue delay | 18m42s | 1s |
| Browser cases that passed only after retry | 1 | 63 |

The 57.8% elapsed reduction is largely associated with runner availability;
job execution minutes increased 0.30%. This comparison does **not** establish
that tracing caused the elapsed improvement or the reliability regression.
The <=40m elapsed target and <=10% job-minute bound were met on this run, but
first-attempt reliability and independent review remain unaccepted.

All 18 browser job logs were consumed. The complete native matrix accounts for
**3,973 selected = 3,031 passed + 879 existing skips + 63 retry-pass cases + 0 final failures**.
The serial job's additional opt-ins reported 16 passed/8 skipped and 7 passed/2 skipped.
The longest job was tablet-4 at 33m20s; desktop-7 followed at 32m39s.
A green final gate must not hide the additional retry cost.

### Bounded repair on top of ec642aa

A local zero-retry reproduction exposed early observation in four test files:

| Path | Preserved outcome and repaired synchronization |
| --- | --- |
| `terminal/e2e/mobile-chart-chrome.spec.ts` | Poll the existing >0.9 viewport-height predicate in the two reproduced expansion cases after the detent changes. Keep subsequent scrolling, scrim and drag assertions. |
| `terminal/e2e/onboarding-signin-completion.spec.ts` | Arm DOMContentLoaded before releasing the sign-in response. Retain proof of a new document, one submission, exact URL state, sheet closure and chart visibility. |
| `terminal/e2e/search-accessibility.spec.ts` | Poll the existing >1 accessible-option count while search rows load. Keep the active-option and ARIA assertions. |
| `terminal/e2e/mobile-chart-touch-upgrade.spec.ts` | Wait for the same Chinese no-samples substring in the January title before reading it and matching the visible detail. |

These changes do not alter application code, retry policy, worker count,
project/shard selection, existing timeouts, declared skips, or required gates.
No fixed sleeps or weaker expected values were introduced. The first three
files fixed the reproduced geometry/navigation/search failures; the next run
exposed the independently observed language transition, which the fourth file repairs.

### Positive and negative qualification

Same local M2/macOS, Node 26.5.0 and locked Playwright 1.61.1; tablet and mobile,
repeat three, workers one, retries zero. The 54 selections include six existing
project skips. These are behavioral proofs, not controlled speed measurements
or substitutes for Ubuntu/Node20 hosted execution.

| Source | Passed | Existing skips | Unexpected failures | Retry-pass | Native exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| ec642aa baseline | 38 | 6 | 10 | 0 | 1 |
| First three repairs | 47 | 6 | 1 | 0 | 1 |
| All four repairs | 48 | 6 | 0 | 0 | 0 |

The final run took 265.961s. Its wrapper mistakenly set `PORT=57161`, while
this configuration reads `TERMINAL_E2E_PORT`; the real fresh CI server used
3108. Listener PID/CWD and the native configuration report establish this,
and `transition-final-port-correction.json` preserves the correction. The
server was started by this invocation with reuse disabled; the timing is not
an A/B performance claim. The initial baseline and intermediate run used their
recorded explicit ports. A native-esbuild invocation error during fault-fixture
preparation was corrected before any fault run; it is not a test outcome.

Five disposable faults were then run once through the real browser harness,
mobile, workers one, retries zero, with a fresh server on port65198:

| Injected fault | Observed rejection |
| --- | --- |
| Cap Drawings sheet at 62vh | Same >0.9 predicate failed at 0.61998 within its existing 5s assertion budget. |
| Cap analysis hub at 60vh | Same >0.9 predicate failed at 0.59999 within its existing 5s assertion budget. |
| Keep the no-samples label in English | Chinese title assertion failed on `Jan · no samples`. |
| Withhold sign-in response completion | Armed document-load wait failed at 15s; no false sign-in success. |
| Remove option semantics from all but one row | Same >1 predicate failed with count1. |

Native fault run: **exit1, five intended failures, zero passes/skips/retries,
62.126s, no wrapper timeout**. Each failure reached its intended new readiness
assertion. Fault copies and reports remain outside normal test discovery.

Full TypeScript `--noEmit` passes. Full native `--list --reporter=json`
returns **3,973 cases and identical parsed suite objects** to the trace
candidate, including project/title/location/status metadata. The earlier
identity digest remains unchanged. `git diff --check` passes.

Reproduce the positive cohort from `terminal/` with `CI=1` and an unused
`TERMINAL_E2E_PORT`, retaining JSON output separately:

```sh
node node_modules/@playwright/test/cli.js test \
  e2e/search-accessibility.spec.ts e2e/onboarding-signin-completion.spec.ts \
  e2e/mobile-chart-chrome.spec.ts e2e/mobile-chart-touch-upgrade.spec.ts \
  e2e/transcript-compare.spec.ts --project=tablet --project=mobile \
  --grep 'combobox whose|deadline notice reads|acknowledged sign-in closes|the Drawings sheet opens at|opens the analysis hub at|sparse history announces' \
  --retries=0 --repeat-each=3 --workers=1 --reporter=line,json
```

The retained `transition-readiness-artifact-index.json` binds source hashes,
reports, negative failure analysis and native discovery under the existing
investigation directory. Key receipt SHA256 values:

- `transition-baseline-receipt.json`: `be296d53e5b919d369e6663a1dfcb2f5fb5eb4fc798cef54f63b6c4c7052d750`.
- `transition-final-receipt.json`: `a3d4a796956e02d13efde62736ed79a5d33a7b8e729f699fe185239b20cda131`.
- `transition-final-static-receipt.json`: `f0585aeb9cd28842a671978b2170ce39dfedf76b163973f0f8957691221277af`.
- `transition-negative-run-receipt.json`: `2854045914cd2b268143c478a656c9a2661c6ee79ae833fcddde5264f3846f02`.

### Remaining decision and next experiment

This is a qualified local readiness repair inside the existing Draft PR, not
acceptance of the full trace/shard experiment. The 63 hosted retry-pass cases
also include drawing-journal, Portfolio, Options Tape and other failures not
resolved by this cohort. Do not declare them fixed from these results.
The existing technical-review request was refused before launch; no review,
approval, alternate reviewer route, merge or deployment is claimed.

Freeze the repaired head, then compare the complete actual critical shard
under `retain-on-failure` and `on-first-retry` on comparable hosted resources,
with workers1, unchanged retries/timeouts, fresh servers and the same cache
condition. Bound the experiment to at most two counterbalanced pairs. Record
identities, attempt-zero and retry durations/outcomes, setup versus test wall
time, queue delay, runner resources and failure signatures. Do not infer
causality from different queue conditions or rebalance based on retry tails.
The existing CI dispatch only accepts `pr_number`; there is no current bounded
trace-comparison carrier in this source. A concrete diagnostic carrier must
preserve the full required CI path and cannot replace its checks.

Further drawing-journal synchronization must preserve deliberately stale
writers and the real storage fence; a barrier before competing writes could
mask the production race. Workers2 remains unqualified against the shared dev
server and serial-group constraints. No new capacity, runner assignment,
cache deletion, protection change, or merge step is part of this repair.


## T3 continuation: native per-attempt timing recorded per invocation

This is a **source implementation**, not performance acceptance. The original
7/5/5 experiment remains Draft; hosted CI run 41568490896 is red on the
Investigation transition and its required aggregate. This slice changes no
test selection, asserted behavior, CI retry setting (2), worker count (1),
60-minute job cap or protected aggregate/fan-in.

The Playwright config retains the GitHub CI reporter and adds the built-in
JSON reporter only when MMX_CI_ATTEMPT_REPORT_PATH is supplied. The existing
CI job supplies separate main, investor-shell and shared-shell report paths.
The existing always() upload includes both test-results and the new
ci-attempt-reports root, outside Playwright's disposable outputDir.
A reporter file absent after interruption is INCOMPLETE, never zero work.

The native 1.61.1 hermetic fixture produced exactly one pass, one flaky
initial-failure/retry-pass, one permanent three-attempt failure and one skip,
with attempt startTime/duration/retry/workerIndex/parallelIndex/status.
The intentionally red command exited 1; mixed.json was 28,289 bytes with
SHA256 64cf82ac11b09e57b744695c4b64854ba1115312dc4431f568733e0d6c3ecaf8.
A subsequent pass-only command exited 0; corrected.json was 3,812 bytes with
SHA256 e8614b198dea5c536dbcd6d9a3283b2890188d3ecdd9eba4af5bf6a7f3e31c2d.
Its Playwright outputDir cleanup removed a sentinel without modifying the
first JSON hash. A corrected no-browser pass also proved automatic creation
of missing nested JSON report directories. A first incorrect anchored grep
was retained as a separate no-tests diagnostic, not a qualified result.

Actual Terminal config, CI=1, --list mobile shard 4/5: 257 selected tests in
52 files and a 191,052-byte JSON report. This was collection-only, not a
browser run. The existing shard guard plus the new output-path assertions:
23 passed. The first local TypeScript run was obstructed by a previously
retained, ignored Investigation probe.config.ts invalid extension import.
An otherwise identical temporary project config excluding only test-results
passed TypeScript exit 0; the existing diagnostic was preserved unchanged.
All positive checks are macOS/Node26 local, not hosted Linux/Node20 proof.

Hosted attempt timing status: BUILT_NOT_PROVEN. First natural hosted CI must
bind each report to actual checkout, run, job, shard and invocation, retain
failed/incomplete reporting distinctly, and measure attempt-zero/retry costs.
Nominal timeout allowance is not measured savings. Original Investigation
component PR #804 remains a distinct incumbent source writer; this CI slice
does not overwrite its product code or imply the Portfolio cases are fixed.
No merge, queue, Ready, un-draft or relabel is authorized here.
