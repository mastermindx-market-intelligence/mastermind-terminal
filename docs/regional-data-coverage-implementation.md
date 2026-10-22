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

Raw source receipts are retained under data/cn_yahoo/_receipts/<symbol>/<sha256>.json. Failed or empty attempts live separately under _attempts and leave acquired cache bytes unchanged. The bounded collector resumes via actual acquisition timestamps and applies a cooldown to unavailable listings.

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
- The focused regional tests passed before integration. The broader local Python run reported 2,671 passing and 38 failing in unchanged beta-deployment fixtures; macOS ownership/path assumptions explain the observed failures by source inspection. The unchanged Ubuntu CI Python gate remains required.

Production rollout counts, exact deployed revision, and live route proofs belong in the release receipt. Do not mark this implementation document as evidence that unmerged code or unexecuted backfills are live.
