# Intraday source lineage: partial implementation, consumer held

Operation: `rotation-intraday-lineage-20260916-sol-001`.
Owner: Sol under current Chairman continuation. Existing programme owner: Macro `WS:TECHNICAL-OPPORTUNITY-INTELLIGENCE`.
Procedure: protected Mastermind `0fe8074ff953b2ced9025ed40f0f66019c759967`, compatible Skillpack 1.0.1.
Pickup: Terminal `8f518af76231667a75d5af91a79ae8454b937424`, the merged prior early-close repair. That repair's deployment was previously refused and is not retried here. Macro W1 #7174 and PC-runner recovery stay with their separate lanes.

## User/machine outcome

A research or product consumer must be able to distinguish a four-hour candle built from finer stored observations from one derived from provider-hourly history. A common candle label is not common source coverage. The diagnostic must describe the returned dates and bars, not import a recent live tail's evidence into an old requested session.

## Implemented, not yet exposed

`terminal/lib/intradayStore.ts` retains the existing selection, filtering, live-over-history merge, ascending deduplication and 20,000-result limit. An optional callback captures the origin of each retained bar and the exact file-read outcome. Four-argument callers still receive the same bar-array interface.

One exact byte read supplies parsing and its SHA-256. Missing, unreadable, malformed and empty store files are distinct diagnostic facts; the existing fallback behavior is unchanged. No provider credentials, file contents, full filesystem path, writer, second data store or network call is added.

`terminal/lib/intradayEvidence.ts` folds those origins over only the bars supplied by its caller. It separates stored 5m, stored 1h, live-tail and unattributed contributions; conflicting origin records stay unattributed. Its assembly/serve clocks explicitly are not market-data freshness. Price/volume adjustment, instrument identity, PIT availability and research admission remain unverified or unassessed. Finer source bars alone do not prove completeness.

## Consumer boundary: real and still RED

The intended modification to the EXISTING `/api/intraday` route was blocked by the platform before execution. The route is byte-unchanged. It does NOT yet request the optional callback or expose `source_evidence`. No alternative connector, worker, or rewritten payload repeats that blocked mutation.

`intradayEvidenceRoute.test.ts` exercises the actual route with deterministic source fixtures. It first verifies the unchanged candle, then fails specifically because the public evidence field is absent. This is a required missing-consumer test, not an expected-failure skip. Do not merge or call the capability implemented end to end while it fails.

The pure/store tests are source-component proof only. Their cache/date-slice cases do not establish actual route-cache behavior. Actual HTTP, browser, final source review, release and production acceptance remain owed.

## New actual-store findings

A bounded read-only production inspection (native process 83627) found 4,009 hourly files and 669 five-minute files. These are file inventories, not valid-file counts or the historical all-US eligible-universe denominator. No overlap percentage is inferred.

DINO has an hourly file but no five-minute file at the inspected location. VLO and XOM have both. This matters to future intraday rotation coverage; it is NOT proof that missing DINO intraday history caused Prophet's current daily recommendation behavior.

The fourteen inspected symbol/grain combinations were AAPL, SPY, NVDA, JPM, XOM, DINO and VLO at 5m/1h; DINO 5m was absent. The thirteen readable documents did not contain `adjusted`, `price_basis`, `known_at` or `captured_at` values. A null here means unreceipted, not raw/unadjusted by inference.

SPY and NVDA five-minute files each held exactly 60,000 rows and 315/314 observed calendar dates; their hourly files held 1,303 observed dates. Source `ingest/backfill_intraday.py` at the pickup revision explicitly truncates incremental merged history to its last 60,000 rows. This count-based retention can give names different calendar spans; it is not a common research horizon.

The same source defines `asof = rows[-1][0]`: last bar-start display epoch, not ingestion/availability time. It overwrites the current file after merging refreshed bars. A current digest identifies the bytes read now; it cannot reconstruct when a historical revision was first available.

Sample immutable file identities from the native read:
- DINO 1h: `1e65f77c59ce721e03fef9738118eb07d147d6086f28e89ebed2ac24e570c7a8`, 10,623 rows, 1,128 observed dates.
- VLO 5m: `c6c2af3124c34241679e0aebeb7781231c367bd87b11ca7967d324f46c793132`, 29,690 rows, 322 observed dates.
- XOM 5m: `cd16da9180dc457cd2388533e20cd5737bf1f1d1c5b4e5a3294002c841fb30c0`, 43,672 rows, 322 observed dates.
A later proposed deeper inventory/session probe was refused before execution. No result or extra coverage claim is credited to it.

## External data contracts verified 2026-09-16

Primary sources: Massive Custom Bars REST docs (`https://www.massive.com/docs/rest/stocks/aggregates/custom-bars`); stock flat-file overview (`https://massive.com/docs/flat-files/stocks/overview`); extended-hours FAQ (`https://massive.com/knowledge-base/article/does-massive-offer-pre-market-and-after-hours-data`).

REST aggregate timestamps mark the START of the window and its `adjusted` flag addresses splits. Flat files are unadjusted. Eligible-trade rules can omit aggregate intervals, especially in extended hours. Thus a missing aggregate is not automatically a feed outage, and sparse candles do not prove that overnight price discovery did not occur. Do not forward-fill as though a trade occurred.

The REST specification uses millisecond aggregate query timestamps. A generic FAQ mentions nanoseconds; the endpoint-specific contract wins. Unit conversion must be explicit per endpoint, not copied from marketing prose.

## Exact integration contract, once an approved write path exists

Keep the existing request, auth-before-cache and second-band kill-switch behavior. For US minute/hour responses only, capture the existing assembler's optional trace and keep it beside the existing cached bar payload, never in a second cache/store. Date-filter the bar response first and then derive evidence over exactly those returned epochs.

Report new assembly, cache hit and stale-cache fallback distinctly. Preserve the original assembly timestamp on cache reuse; re-serving a response cannot refresh the underlying input. Whole-assembly file-read attempts are separately labeled so an old-session response does not pretend every attempted file contributed to its result.

Do not modify the second-band, macro, crypto, CN/HK/CA or fixture response semantics. Do not assign US-session or adjusted-price qualification to them. Do not add provider requests to produce diagnostics. Keep absolute error messages and source paths out of the new bounded evidence fields.

Acceptance: the existing route consumer test must become green through actual wiring; add real date-slice/cache/stale-fallback/authorization tests; demonstrate a real hourly-fallback case and finer-history control via the existing HTTP path. Final independent source review, current-base checks and normal release/production proof are required. No auto-merge or release while consumer integration is absent.

ChartPanel is an explicit no-edit boundary in this wave because current PR590 owns it. A source API result is not a visible UI warning; any later user-facing presentation requires its own actual integration and browser proof, not a claim that the current chart already renders the new fields.

## Verified source-component state

The mechanical native-pool child authored 45 real-module tests, then exited. Parent typechecking caught test-only import/type errors despite passing Vitest; these were repaired without weakening assertions. The last full TypeScript check and changed-file ESLint passed. The combined seven source/store/session/route-regression/math suites passed 164 tests. The new actual-route acceptance test fails once, specifically on missing `source_evidence`; no skip, expected-failure decoration, or fabricated endpoint result hides it.

This is PARTIAL implementation, not a trading improvement and not API completion. Preserve this source carrier. Stop at the blocked route write; do not repeat it through another tool or worker. A fresh allowed continuation must recover exact current source and permission state before proceeding. Research/control/source-basis work remains owned by the existing TOI, Temporal Grain, Entry Radar and Prophet owners.
