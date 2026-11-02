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
