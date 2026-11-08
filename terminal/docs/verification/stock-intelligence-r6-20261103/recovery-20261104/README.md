# R6 recovery — displayed-price search and release preflight

This evidence continues Terminal PR #1274 and issue #612 on the original managed operation. It does not create another source/review/release carrier.

## Actual defect and correction

The R6 candidate rendered prices with two decimals, but indexed only the raw producer number. Searching a visible `187.00`, `97.20` or `922.16` could therefore omit the very record showing that price. The minimal fix adds the same displayed representation to the existing literal search text, alongside the original full-precision number. It does not round producer data, alter event classification, change entry authority or add another cache.

Seven regression cases cover integer/trailing-zero, rounded four-decimal, small and zero prices for both signals and candidate receipts, checking that absent prices do not become zero and source object identity/precision remain unchanged. Six cases failed before the fix. The same 238 focused tests passed afterward. The EN/ZH browser journey now searches the exact displayed `100.00`, not the less discriminating `100`.

`live-price-search-proof.json` compares the pre-fix and fixed helper against the exact same live public response bytes, identified by SHA-256. Across AMZN/COST/NVDA there were 1,162 observations, 1,161 with finite prices. Displayed-price misses changed from 160/224/161 to 0/0/0. These are live-data input checks of the local candidate, not evidence that the fix is deployed. Raw market datasets are not redistributed here.

## Production facts, not fixture claims

The deployed marker and canonical checkout both identified `db06eacd8938cf44588d3906bca95bfd7122b74b`. The current-source preflight completed CLEAN with immutable receipt `d1f447335634ac90d466f91c3443c730132c3db735fc926c88c1e6e3fdbf1abe`; see the sanitized readback. No build, source reset, service restart or runtime-data mutation occurred.

The four `production-before-r6-*` screenshots are fresh unauthenticated browser sessions against the live AMZN route, with no response interception or auth override. Desktop EN and mobile ZH opened all four Intelligence tabs without page exceptions or horizontal overflow. They intentionally show the older deployed interface: no R6 overview marker and no Activity searchbox. They are baseline evidence, NOT R6 production acceptance. Authenticated acceptance remains unproven.

## Hosted checks and source compatibility

All 17 jobs in original PR-head CI run 41777007903 succeeded on `da1d713634e7f39ea2ffe5fd1e7a27ac6cbb6c22`, including the three native required checks. That evidence does not certify the later displayed-price repair. Fresh required hosted checks are owed after publication of this repair on the same branch.

Protected Terminal advanced to `3930ce93bb1ed6f3d66ba1ae4cac7e441995ba78`; beyond the already-read agent guides, movement is limited to TodayWorkspace, its readingPayloads dependency and readingWorkspaces tests. Those paths do not overlap this stock Intelligence repair. There is no ancestry-only merge or replacement PR.

The Mastermind procedure pin is refreshed to `75a6540519cf519edfef7633e74f57b68aef9329` after material delivery/review policy movement. INDEX and core bootstrap/execution/reliability/delegation paths were byte-unchanged in the bounded compare; current material delivery/review sources were read. The proposed risk exemption is not treated as deployed, and this executable change is not passive FAST scope.

## Remaining gates

The existing GitHub reviewer request remains pending; no formal non-author approval was observed. The one Secretary coordination message was platform safety-blocked and was not resent or rerouted. Executive reads reported backend/Session Bridge unavailable; no Fabric reviewer/root/Attempt was fabricated, and no historical refused review was replayed. Protected review, current-head checks, authorized merge, exact-target deployment and R6 live journeys remain separate, unclaimed stages.
