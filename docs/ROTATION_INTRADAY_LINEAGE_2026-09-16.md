# Intraday source lineage: API consumer connected locally; release held

Operation: `rotation-intraday-lineage-20260916-sol-001`.
Owner: Sol under current Chairman continuation. Existing programme owner: Macro `WS:TECHNICAL-OPPORTUNITY-INTELLIGENCE`.
Procedure: continuation re-pinned to protected Mastermind `a78b8fe23d8e1ed129880ac47e97ebe96afa8aea`, compatible Skillpack 1.0.1.
Pickup: Terminal `8f518af76231667a75d5af91a79ae8454b937424`, the merged prior early-close repair. That repair's deployment was previously refused and is not retried here. Macro W1 #7174 and PC-runner recovery stay with their separate lanes.

## User/machine outcome

A research or product consumer must be able to distinguish a four-hour candle built from finer stored observations from one derived from provider-hourly history. A common candle label is not common source coverage. The diagnostic must describe the returned dates and bars, not import a recent live tail's evidence into an old requested session.

## Implemented source components

`terminal/lib/intradayStore.ts` retains the existing selection, filtering, live-over-history merge, ascending deduplication and 20,000-result limit. An optional callback captures the origin of each retained bar and the exact file-read outcome. Four-argument callers still receive the same bar-array interface.

One exact byte read supplies parsing and its SHA-256. Missing, unreadable, malformed and empty store files are distinct diagnostic facts; the existing fallback behavior is unchanged. No provider credentials, file contents, full filesystem path, writer, second data store or network call is added.

`terminal/lib/intradayEvidence.ts` folds those origins over only the bars supplied by its caller. It separates stored 5m, stored 1h, live-tail and unattributed contributions; conflicting origin records stay unattributed. Its assembly/serve clocks explicitly are not market-data freshness. Price/volume adjustment, instrument identity, PIT availability and research admission remain unverified or unassessed. Finer source bars alone do not prove completeness.

## Existing API consumer now connected locally; release still held

Fresh continuation operation `rotation-intraday-lineage-route-consumer-20260916-sol-002` recovered the prior refused mutation as a known no-effect result, re-pinned current procedure/source, and modified the same PR/worktree carrier. `/api/intraday` now requests the optional trace only for non-second US-equity responses, stores that trace and assembly timestamp beside the existing cached payload, and derives `source_evidence` only after any requested-date bar filtering. No second cache/store or provider request was added.

The cache preserves the original assembly timestamp. A normal cache hit reports `cache`; an expired payload returned only after both refresh legs fail reports `stale_cache` and a warning. Re-serving a payload therefore cannot make its inputs look newer. Auth and the second-band kill switch remain ahead of cache access. Second-band, macro, crypto, CN/HK/CA and fixture behavior stays outside this US source-qualification path.

`intradayEvidenceRoute.test.ts` now carries six route-level discriminators: hourly fallback without candle mutation, evidence after requested-date filtering, cache-age preservation, stale-cache labeling after dual refresh failure, non-US isolation, and second-band isolation. The existing auth/cache gate tests remain green.

Actual HTTP proof used this branch in a local Next server with provider fetching disabled and exact public production store inputs fetched read-only from the live static-data path. DINO on 2026-09-11 returned two 4h bars with construction `stored_1h`, a missing 5m read, exact 1h digest `1e65f77c59ce721e03fef9738118eb07d147d6086f28e89ebed2ac24e570c7a8`, and the hourly-alignment warning. XOM on the same date returned two 4h bars with construction `stored_5m`, digest `cd16da9180dc457cd2388533e20cd5737bf1f1d1c5b4e5a3294002c841fb30c0`, and no hourly warning. Both retained `research_admission: not_assessed`. A repeated DINO HTTP request preserved its first assembly timestamp while cache age increased. This proves the branch consumer path locally; it is not production deployment proof.

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

## Implemented consumer contract and remaining release boundary

Keep the existing request, auth-before-cache and second-band kill-switch behavior. For US minute/hour responses only, capture the existing assembler's optional trace and keep it beside the existing cached bar payload, never in a second cache/store. Date-filter the bar response first and then derive evidence over exactly those returned epochs.

Report new assembly, cache hit and stale-cache fallback distinctly. Preserve the original assembly timestamp on cache reuse; re-serving a response cannot refresh the underlying input. Whole-assembly file-read attempts are separately labeled so an old-session response does not pretend every attempted file contributed to its result.

Do not modify the second-band, macro, crypto, CN/HK/CA or fixture response semantics. Do not assign US-session or adjusted-price qualification to them. Do not add provider requests to produce diagnostics. Keep absolute error messages and source paths out of the new bounded evidence fields.

Consumer acceptance is now met locally: actual route wiring is green, date-slice/cache/stale-fallback tests discriminate the intended semantics, existing authorization/cache tests stay green, and real DINO hourly-fallback plus XOM finer-history controls passed through HTTP. Remaining gates are immutable-head independent review, hosted required checks, merge/release authorization and production proof. No auto-merge or production claim follows from local success.

ChartPanel is an explicit no-edit boundary in this wave because current PR590 owns it. A source API result is not a visible UI warning; any later user-facing presentation requires its own actual integration and browser proof, not a claim that the current chart already renders the new fields.

## Verified source and test state

The original mechanical child authored the pure/store tests and exited; parent repaired test-only typing without weakening assertions. After the route consumer was connected, the seven focused lineage/session/source/gate suites passed 95 tests, full TypeScript checking passed, and changed-file ESLint passed. The branch's repo-wide local Vitest run produced 5,373 passes, 4 todos and 109 failures; inspection found those failures dominated by missing worktree fixture/evidence files across 27 distinct ENOENT paths (for example AAPL data, GEX/ticker fixtures and crop evidence). They are not credited as green and are not repaired in this wave; hosted CI remains the release-quality integration receipt.

Capability state is now BUILT_NOT_PROVEN for the API consumer: source lineage is connected and locally proven through the real HTTP route, but the branch is not merged or deployed. It remains descriptive-only and grants no trading, ranking, model-selection, admission or capital authority. Research/control/source-basis work remains owned by the existing TOI, Temporal Grain, Entry Radar and Prophet owners.
