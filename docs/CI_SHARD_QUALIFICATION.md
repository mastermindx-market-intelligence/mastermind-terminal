# Terminal CI shard qualification

## Scope and source

Parent implementation plan and recovery record: [Mastermind issue #1607](https://github.com/mastermindx-market-intelligence/Mastermind/issues/1607).
Original shard experiment: [Terminal #1223](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1223), branch `sol/ci-shard-critical-path-20261102`.
Parent operation correlation: `execution-throughput-20261015-c3-001` (not an Executive Job identity).
Protected procedure: Mastermind `22c08067ed0f480d1d5324a815fa248661c4ab46`.
Terminal source base for the settings reliability repair: `ed2e633852564dcd604afc26eb03eeed54954dee`.
Task-tree identity: this path at its containing Git commit; the publication receipt records that exact commit.
Recorded: 2026-11-02. No matching current Agent OS workstream was resolved in the bounded recovery lookup; no new workstream or task registry is created here.

This file owns the Terminal task breakdown and acceptance rules, not runtime state,
worker leases, a second wave plan, or a CI observer. Current effects and the next
execution action remain in their canonical owners and the parent recovery record.

## Outcome

Reduce full Terminal CI wall time by at least 20% against the recorded successful
5/3/3 references (approximately <=40 minutes), with at most 10% extra summed job
wall-minutes, without losing any Playwright projects, assertions or fail-closed
checks. Different-head observations are directional evidence, not causal estimates,
fleet percentiles or invoiced charges. Representative integrated and postmerge
runs are still required before operational acceptance.

## Evidence that determines the next experiment

| Layout | Run | Full wall minutes | Summed job minutes | Interpretation |
| --- | --- | ---: | ---: | --- |
| 5/3/3 | 41496257793 | 50.8 | 444.3 | Successful earlier reference |
| 5/3/3 | 41498350253 | 53.8 | 471.3 | Successful earlier reference |
| 6/4/4 | 41507479087 | 44.0 | 462.7 | Correct, below performance target |
| 6/5/5 | 41514788591 | 41.1 | 489.5 | Correct, below target; settings retry-pass |
| 7/5/5 | 41521626838 | 41.383 | 481.300 | 23/23 jobs successful, below target |

The 7/5/5 head is `a8eadffd07e54b7d7744aa085464a233b42d2086`.
Desktop-1 took 41.250 minutes while desktop-2 through desktop-6 took 18.333-21.733
minutes; desktop-7 took 36.667 minutes. Its native reporter attributed 7.3 minutes
to `e2e/chart-engine-pine.spec.ts`. Fourteen route warmups consumed only 12 seconds.
This supports investigating test-duration placement rather than assuming startup
caching or another physical runner is the answer. Exact source and measurement
receipt: [#1223 comment 6589002530](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1223#issuecomment-6589002530).

## Task tree

### T1 - Qualify the original native shard experiment

**Editorial state: implementation_complete; performance not accepted.**
Keep #1223 as the only shard-source PR. Native `--shard=i/N` coverage must remain
complete and unique, including the original serial dependency projects. Required
`Terminal typecheck + tests`, one CI worker per process, two existing retries,
60-minute job limit and fail-fast=false remain unchanged. A green run alone does
not satisfy the wall-time, cost or reliability criteria.

### T2 - Remove the proven settings entrance-measurement race

**Editorial state: implementation_complete; independent review and release owed.**
This path-disjoint test repair depends only on the existing settings implementation,
not release of #1223. The card's production `acsCardIn` animation starts at
scale(.985), so 1140 CSS pixels temporarily measure as 1123. Await the card's final
transform before taking its bounding box; retain exact 1140x772 and all existing
navigation, visual-material and responsive assertions. A real-page regression must
replay the production keyframes, expose the initial 1123 measurement, and pass only
when the shared measurement helper waits. Removing that wait must fail the new
regression. Do not disable production motion, sleep unconditionally, relax geometry,
raise retries or wait for infinite decorative animations. Repeat with no retries
in all three existing browser projects. Owner: the currently assigned source
integrator; the reviewer must be independent of its builder.

### T3 - Reduce the measured native-shard duration imbalance

**Editorial state: proposed; depends on T1's exact run evidence.**
Prefer the smallest reproducible change within native Playwright discovery and
sharding. First inspect actual selected test identities and heavy-file placement.
A placement-only candidate must preserve test bytes and normalized test identities,
respect serial groups, add no exclusions, and pass the existing negative coverage
tests. Do not introduce a new selector, duration database, sharding engine, runner
pool or changed server mode without a separate justified design and qualification.
Any predicted saving is a hypothesis until a complete exact-head hosted run proves
wall time and job-minutes. Keep the original experiment draft while its performance
criterion is unmet.

### T4 - Independent acceptance and protected release

**Editorial state: blocked on qualified candidate evidence and nonauthor review.**
Dependencies: stable scoped source, actual local qualification, required exact-head
hosted checks, and independent nonauthor source review. A stable locally-qualified
repair can be Ready while full CI runs; unresolved experimental acceptance keeps
#1223 Draft. The designated release owner alone operates the native protected merge
queue. Integrated merge-group results and representative natural postmerge latency,
cost and retry evidence are separate obligations. No self-approval, self-merge,
branch-protection bypass or synthetic rerun solely to seek a green result.

## Held boundaries

Mastermind #1616 is already merged; do not reconstruct its six-shard implementation.
Mastermind #1570 and the separate Macro FIF investigation retain their own source
owners and effect fences. This task tree neither retries a refused source edit nor
changes those projects. Test timing instrumentation must use existing CI artifacts
and authoritative native collection, not a second lifecycle or truth store.
