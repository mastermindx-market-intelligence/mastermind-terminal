# Analysis read lifetime and honest loading

Continuation of the beta-shell sweep recorded in Terminal #1364, `docs/verification/beta-shell-sweep-20261109/PLAN.md`. Original managed operation: `beta-analysis-quotes-20261109-astra-01`; source base `8390cc4ad41b1c0773e979198c80e742852c01dc`.

## Confirmed repairs
1. The previous company's fundamentals, bars and intelligence could be passed to the newly selected company in its first render, before passive-effect reset. The existing local snapshot now carries its company identity, and projection checks it synchronously. Existing alive guards still reject departed requests, including A-to-B-to-A.
2. Overview, Statements, Statistics, Dividends, Earnings and Revenue treated a still-pending fundamental read as missing coverage. Their existing parent now presents an honest EN/ZH busy state until the read settles. True absence and existing data remain unchanged. Independent Intelligence, transcripts, Forecast, Ownership and Compare keep their own loading owners.
3. Analysis polled quotes on every page every 15 seconds although the only recipient, Statistics, does not consume that prop. The unused poll and state are removed. This does not change chart quotes or substitute a live price into snapshot ratios.

## Hypothesis correction
The initial quote-race experiment demonstrated a latent prop-ordering problem, not a rendered price defect. Consumer inspection found no use of `quote.last` in Statistics. Rather than ship extra retry/cancellation machinery for unused work, the final fix removes it. A test renders real Statistics with two different quote values and proves identical output while retaining the published P/E. The rejected experiment is not part of this diff or the claimed final tests.

## Qualification
Exact source hashes and screenshots: `qualification.json`.

- Original-company source: 5 failures / 5 passes; final 10/10 pass.
- Original financial loading: 7 failures / 15 passes; final 22/22 pass.
- Combined affected units, navigation/route and financial-math checks: **132 tests / 5 files, all passed**.
- ESLint over five changed TS/TSX files and `tsc --noEmit`: passed after Next type generation.
- Real local browser switch NVDA -> AAPL with the new fund request deliberately pending: **6/6 passed**, EN/ZH at desktop, tablet and phone. Checks published statistics identity, pending copy, settled data, no unused quote requests, no page errors and no overflow. Twelve screenshots retained. No new test skip/retry.
- Author self-review, no independent-review claim. Existing #1041 navigation hunks and #1275 origin-context work were inspected; they are not replaced or released by this repair.

This is candidate qualification, not deployed or authenticated production proof. Required hosted CI, protected merge and beta installation remain distinct. No auth, entitlement, source publisher or release policy was changed.
