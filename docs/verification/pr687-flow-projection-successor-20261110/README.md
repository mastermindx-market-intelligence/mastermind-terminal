# PR #687 — Flow Desk time projection successor

## Scope and custody

This packet qualifies the original display-only time projection on `sol/skylit-r8-flow-projection-20260920`, from original head `34ffd6b5e93162e63b812869ecce011f6357782d`, composed with fixed protected Terminal `b5afc7eca5c37b3e2eee25871b764807203957a6`. Procedure source is Mastermind `5257967eb23d10418dc2326bb7a7b31f7e6a5915`. The current principal recovery claim is [6773370982](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/687#issuecomment-6773370982).

The historical body reported an unspecified tool-blocked browser-e2e write without a retained action, refusal reason or request/effect identifier. It remains **UNCLASSIFIED historical tool obstruction**. This packet records new prospective source repair and actual execution; it does not turn the old action into a success or clear an identifiable denial.

The projection remains downstream of the existing filtered Tape. It adds no event identity, store, filter grammar, score, rank, gate or trading authority. This is synthetic fixture-backed local consumer qualification, not live producer or deployment proof.

## Source result

Seven source/test files form the residual against the fixed protected base:

- `terminal/lib/flowProjection.ts`: a shared admission path for buckets and drill-down.
- `terminal/components/flowdesk/FlowProjectionStrip.tsx`: interval state and explicit omission disclosure.
- `terminal/components/flowdesk/FeedPane.tsx`: projection integration and expansion/pagination resets.
- `terminal/components/prophet/optionsAlphaMeasuredEvidence.ts`: export-only access to the existing pure `measuredInstant` parser; its implementation and existing callers are unchanged.
- `terminal/lib/__tests__/flowProjection.test.ts`: 52 adapter cases.
- `terminal/lib/__tests__/flowProjectionControls.test.tsx`: six actual component cases.
- `terminal/e2e/flow-projection.spec.ts`: real-route responsive browser cases.

IDs must be nonempty normalized strings. Repeated IDs are counted across the entire already-filtered input before other admission checks, and every occurrence is withheld. Rejections are counted once in identity, timestamp, then magnitude order. This does not deduplicate the canonical Tape or manufacture an ID.

The existing strict instant parser rejects invalid calendars and missing timezone information. Integer nonnegative size/print counts and finite nonnegative premium are required, with real zero retained. No coercion, rounding or arbitrary aggregate ceiling is introduced. Unknown right/side premium remains separately unknown rather than becoming put/mixed premium.

Selected members must still pass admission and belong to the actual half-open bucket interval. Selection preserves the Tape's order and event references. No selection returns a shallow copy of the complete supplied Tape, including projection-ineligible rows.

Bucket/interval changes and a bucket disappearing after a feed update reset expanded cards and pagination. The parent's selected-print inspector remains under its existing owner. All-loaded coverage, filters, sort order, held/loading/error states, retry control and transport stay with their protected implementations. The original unused-import-only change in `optionsFlowBoards.test.ts` is restored to protected bytes.

### Primary source basis

At Macro `d13fe68bf6716c7dd970b1b53fd791f8fd3d0ebd`, [live_flow.py](https://github.com/mastermindx-market-intelligence/Macro/blob/d13fe68bf6716c7dd970b1b53fd791f8fd3d0ebd/engine/live_flow.py) (blob `e6c8f3cf54eb0af41465367c4078992689c99e3b`) rejects malformed/fractional source size before computation, coalesces integer size and row-count print totals, and owns source-time conversion. [Its tests](https://github.com/mastermindx-market-intelligence/Macro/blob/d13fe68bf6716c7dd970b1b53fd791f8fd3d0ebd/tests/test_live_flow.py) (blob `2491adf5dfaca05c217ec0be4d93046a0e09b75f`) cover fractional rejection and aggregation. [The poller](https://github.com/mastermindx-market-intelligence/Macro/blob/d13fe68bf6716c7dd970b1b53fd791f8fd3d0ebd/scripts/live_flow_poller.py) (blob `62ab723b1d36db7c2796a3d3e4d891184488ebf7`) requires normalized nonempty IDs and rejects duplicates. These are source-contract evidence, not a claim that a live generation was exercised.

## Counterexamples and affected checks

The initial run executed 58 tests: 26 passed and 32 failed. `red-reconciliation.json` distinguishes 28 behavioral source counterexamples, one newly introduced diagnostic-field assertion, and three failures caused by jsdom's missing `HTMLElement.scrollIntoView`. The test harness supplied and restored only that missing method. React state, handlers and assertions remained real.

A targeted run after that harness repair reproduced all three expansion-reset defects against unchanged production source; three other component cases were unselected. After the source repair, **190/190 affected tests passed**, with zero failures or skips, in 2.308 seconds. The ten scopes cover projection, the actual controls, canonical flow boards, held/absent/error/unknown/malformed feed behavior, print inspector and both measured-evidence consumers. Source snapshots contain 2,771 stable inputs per test operation.

Full Next type generation and TypeScript checks passed. Scoped ESLint had **zero errors and one inherited warning**: the protected FeedPane's unused `DEFAULT_FILTERS` import. `lint-disposition.json` records the exact protected comparison. The full source-check window retained 3,425 identical inputs, and generated types were restored. This is not a claim of zero lint warnings.

## Real browser qualification

`browser-chromium/execution.json` records **12/12 Chromium cases passed**, zero failures, flakes, skips, retries or page errors. The run used the actual `/options?tab=desk` route, unchanged protected Playwright server/warmup, the incumbent W3A fixture and normal EventSource/poll consumers. Only the feed response was routed; other application routes continued normally. Viewports remained fixed at desktop, tablet and phone sizes in English and Chinese.

Six main journeys exercised keyboard expansion, bucket selection and clearing, exact Tape membership/order, the real AAPL search, unchanged all-loaded coverage, physical pointer/tap selection, visible selected-print identity and premium arithmetic, interval changes and restored Tape. Six held-absence journeys retained the last data, existing translated absence reason and usable bucket selection without changing transport ownership.

The inspector uses the existing right rail. At narrower layouts it wraps below the feed; ordinary page and rail scrolling reveals its actual contents. The proof does not grow the viewport, force styles, add a drawer, or replace the component.

The execution took 33.682 seconds, retained **3,432 identical inputs and 13 unchanged protected owners**, restored generated types, and verified port 47687 closed. Twenty-four unique PNGs are retained, plus their report attachments. Root manually inspected the seven images listed and hashed in `visual-review.json`; this is not a claim that every PNG was manually inspected.

The exact 32-input EOD, 29-input GEX, 71-input joint browser and 76-input expiry reader sets have no intersection with the seven source/test residuals. Their accepted captures were not replayed or restamped. Historical PL6/VI proof is not reclassified as current.

## Publication and remaining acceptance

`INVENTORY.json` hashes the complete packet except itself. `source-review.json` ties the qualified source hashes, protected owners, counters, browser results and visual review together. The original branch publication must use one expected-head compare-and-swap, retain the two actual parents, and read back the same ref and PR head. Its immutable commit and publication receipt are recorded on #687 after publication.

**Keep Draft until eligible natural CI for the published successor is green.** The real-route local browser condition is now proven. No approval, auto-merge enrollment, merge, deployment, live-feed freshness or parent release acceptance is claimed by this packet. The retained approval-enforcement coverage gap still prevents new root auto enrollment.
