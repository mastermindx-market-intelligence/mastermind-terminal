# Regional fundamentals: China, Hong Kong and Canada

## Problem and production scope

The Terminal's US collection and institutional-ownership model do not imply coverage of other listing markets. Canada was absent from the scheduled fundamental collector; CN refreshes could fail without propagating their status; HK financials and holders have different sources and availability. Intelligence previously required an earnings-event identity even when a listing already had useful reported fundamentals.

The current manifest observed on 2026-10-22 contains 1,729 mainland listings, 2,798 HK listings and 216 Canadian listings. These are listing counts, not a promise that a vendor supplies every field. Symbol identity is preserved, including .SS, .SZ, .BJ, .HK, .TO and supported .V; there is no ADR substitution.

## Source and semantic boundaries

| Area | Implemented source path | Qualification and limits |
| --- | --- | --- |
| Canada fundamentals | Existing Yahoo/yfinance raw cache and US-format emitter, with explicit Canadian schedule | Quote and statement currencies stay separate. Preserve older whole statement-family observations and annual actuals when a rolling vendor window shrinks. |
| Mainland primary statements | Existing Tushare collector | Explicit consolidated scope, filing/update metadata, request/cache-bound receipts. Conflicting revisions are held. Quarter bridges require compatible original observations; cumulative EPS is never subtracted. |
| Mainland fallback | Explicit MM_CN_FUND_SOURCE=yahoo; separate data/cn_yahoo cache | Raw time-series metadata must match the exact listing, CNY, and 3M or 12M duration. Adds absent whole periods only. Existing overlaps retain their values and original/unknown acquisition. This is a coverage extension, not a restatement-refresh policy. |
| HK statements | Existing HK financial collector and producer normalization | Preserve genuine fiscal cadence and financial-statement family. A total failed attempt cannot replace the prior cache or publish success. |
| Canada/HK reported holders | Yahoo's dated institutional_holders table | Separate listing-scoped ownership.reported contract. Source acquisition, holder report dates and attempt dates are distinct. No US 13F identity or completeness is inferred. |
| Intelligence | Regional company snapshot composition | Uses the same loaded fund artifact and safe annual comparisons. Retained event pins continue through the existing verified-event view. No invented events, transcripts, conviction or sizing. |

The configured Tushare credential was rejected during the initial investigation. It has not been replaced, and repeated retries do not repair it. The optional Yahoo path permits qualified fundamental coverage independently. CN deep intelligence, source-only ownership and unavailable analyst/transcript data remain limited until their actual sources qualify.

### Mainland fallback contract

ingest/cn_yahoo_fallback.py validates the raw response hash, exact meta.symbol, type, periodType, currency, reporting endpoint and finite value. Its metric mapping is explicit. A balance-sheet stock does not establish an income-reporting period. Conflicting duplicate observations fail qualification.

Retained legacy Tushare interims are labeled Q1/H1/9M/FY according to their established YTD convention. Fresh Yahoo 3M observations use Q1–Q4. Every emitted column carries fiscal identity, duration, provider, accounting-family label, normalization method and observation receipt. flow_basis=mixed_period prevents the consumer's legacy differencer from changing these values.

Growth comparisons require the same economic duration and comparison basis. Cross-provider annual and interim growth is withheld. Missing EPS and cash-flow observations stay null. A later source cache cannot redate preserved periods. Switching the primary emitter back to Tushare must not silently overwrite this mixed history; the source-convention guard holds publication until an explicit qualified transition is implemented.

Raw source receipts are retained under data/cn_yahoo/_receipts/<symbol>/<sha256>.json. Failed or empty attempts live separately under _attempts and leave acquired cache bytes unchanged. The bounded collector resumes via actual acquisition timestamps, applies a cooldown to unavailable listings, and prioritizes never-attempted/oldest-attempted names so a failing prefix cannot starve the universe.

Each invocation writes a finalized receipt binding the exact requested scope, admitted symbols, raw source hashes and per-symbol outcomes to its run ID. Production emission accepts only that admitted subset and rechecks its raw hashes. Qualified partial coverage can publish, but retains the previous complete-refresh success clock and returns an incomplete result. Publication time is recorded separately.

Fallback earnings actuals are reconciled from period receipts before publication: legacy Q2–Q4 EPS and unqualified additive bridges are withheld. Unknown retained taxonomy for a current bank/insurer is explicitly unqualified financial history; industrial-only geometry and comparisons are suppressed. Known filing/restatement metadata is preserved; absent evidence remains null.

## Runtime ownership and publication

The existing nightly owners remain the schedulers:

- ops/nightly_fund.sh includes a gentle Canadian pass.
- ops/nightly_cnhk.sh and the existing refresh scripts use ingest/regional_refresh.py.
- Both use the incumbent fund-writer lock before checkout or cache mutations. A stale/unidentified lock is not automatically reclaimed.
- CN and HK collection/emission/publication are independent. Failure in one market holds that market; it cannot authorize a residual bulk transfer.
- Missing dependencies fail preflight before provider calls.
- A daily soft budget and process-group hard bound constrain long collections.

Publication reads remote file hashes, persists candidate bytes and a receipt, writes a pending fence, and only then transfers its exact manifest. The remote content is read again. Fully applied candidates finish locally; fully unapplied candidates can be reconciled; mixed/unknown effects remain fenced. Unreadable status is never overwritten.

Reconciling a prior transfer preserves its originating run and does not count as a new source refresh. The current run must complete its own work before its success clock advances. Generation/publication clocks never replace source-acquisition clocks.

## Operational rollout

Deploy only through merged source and the existing Git-gated build owner. Do not copy unmerged collector/UI code into production.

After the merged ingest revision is installed in the existing M1 deploy clone, configure the established environment owner with:

- MM_CN_SOURCE_DISABLED=1 while the rejected primary credential remains unresolved.
- MM_CN_FUND_SOURCE=yahoo to opt into the qualified coverage extension.

These settings disable the rejected CN primary calls while allowing only the fund phase to use the fallback. The deep-intelligence phase remains explicitly incomplete. Removing the opt-in requires a reviewed source-transition plan for mixed history.

The bounded source pass and emitter can be exercised independently in an isolated candidate directory:

    python ingest/run_bounded.py --seconds 1800 -- \
      python ingest/collect_cn_yahoo.py --deadline-seconds 1790
    python ingest/gen_fund_cn_yahoo.py \
      --out /tmp/cn-candidate --previous-dir terminal/public/data

Use the existing regional driver for actual publication so the receipt/fence logic remains in force. For HK, the reported-holder collector has a separate 1,800-second budget and resumes through its named source cache. Empty holder tables are explicit unavailability; they do not invalidate qualified statements.

## Qualification evidence at implementation time

- The original Canadian refresh acquired 216 raw listing caches with no empty results. Of these, 206 contain dated institutional holders (1,230 rows).
- The first data-only release refreshed 211 Canadian files. Five retained their prior files because the old emitter would have shortened statement history.
- The corrected emitter was run against all 216 raw caches and the current served files: no period losses or currency changes, 206 qualified holder blocks / 1,230 rows. Five prior holds become releasable with preserved history.
- A read-only Yahoo qualification on 2026-10-22 validated 600519.SS, 000858.SZ, and 601318.SS. Each retained six annual periods and added the June 2026 quarter as a thirteenth interim period. The overlapping annual revenue values were unchanged. Missing Q2 EPS and CFO remained null.
- These three probes qualify the adapter boundary, not all 1,729 mainland listings. The backfill receipt must report actual successes, unavailable listings and deferred work.
- The integrated focused regional tests passed: 172 Python and 272 TypeScript cases. The Intelligence snapshot includes schema/calendar validation, source-aware annual acquisition display, safe partial estimates, and an SSR pinned-event boundary test. The broader local Python run reported 2,671 passing and 38 failing in unchanged beta-deployment fixtures; macOS ownership/path assumptions explain the observed failures by source inspection. The unchanged Ubuntu CI Python gate remains required.

Production rollout counts, exact deployed revision, and live route proofs belong in the release receipt. Do not mark this implementation document as evidence that unmerged code or unexecuted backfills are live.

### Prior-history publication binding

Every CN/HK fundamental emitter now reads an immutable copy of its local prior artifacts. Publication requires the live remote hashes to match exactly those input bytes (including absence for a new listing); any mismatch holds publication and requires synchronizing the live baseline before regeneration. The durable receipt stores both candidate and replaced bytes with their hashes for rollback. Changing the CN provider flag is not a data rollback.

### Consumer compatibility and complete financial projection

CN Yahoo additions are published inside one optional, versioned regional_financials envelope in the existing fund artifact. The legacy top-level statements, earnings and statement source remain a coherent prior view for already-open older clients. New readers verify the exact listing/currencies, a portable base projection digest, the exact serialized payload digest, and aligned period metadata before selecting the new complete financial view. Cache objects are never mutated. The current getter, Compare peer reader, Screener evidence/producer, and AI financial reader all use this materializer. Pure snapshot/scan readers reject an unselected envelope. A new listing has an empty legacy financial view until a compatible client selects the extension.

The shared Python/TypeScript golden proves number identities (including decimal and negative zero) agree without depending on JSON float formatting. Missing, corrupted or future projection versions fail closed. Returning to the primary CN source requires an explicit transition policy; the generic history merger refuses to silently discard an envelope.

Ownership UI verification now passes TextEncoder bytes directly to WebCrypto (Node22/jsdom realm compatibility). Its tests await the actual reader promises rather than assuming one event-loop tick completes hashing. HK holder collection prioritizes unattempted names, preserves failed-attempt status during a bounded cooldown, and reports deferred scope as incomplete. Both Yahoo collectors stop when the provider signals rate limiting.

Parent checkpoint validation: 141 focused regional Python tests passed before the explicit-index selector regression, 183 focused TypeScript tests passed (including real ownership digest/rendering and the cross-language projection golden), and the complete TypeScript typecheck passed. Broad provider collection is staging-only until the exact-head review/CI and merged-source deployment finish. The source selector excludes explicit non-equity manifest entries from the company-coverage denominator.
