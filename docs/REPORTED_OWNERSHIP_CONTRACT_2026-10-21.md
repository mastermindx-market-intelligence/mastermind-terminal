# `mastermind.reported-ownership/v1` — provider-reported institutional holders

Status: candidate, awaiting parent acceptance. Source checkpoint `38723cef`.
Producer: `ingest/reported_ownership.py` · Reader: `terminal/lib/reportedOwnership.ts` ·
UI: `terminal/components/fin/ReportedOwnershipPanel.tsx` · Wiring: `terminal/components/fin/OwnershipPage.tsx`

## The problem this solves

`fund.ownership.top_inst` carries a holder name, an undated percentage and a value with no currency.
It erases the reporting date, the share count and the source. The Terminal therefore cannot render it
as institutional ownership — presenting it next to the verified 13F roster would assert a provenance
and a date the cache never carried.

The incumbent raw collector cache, however, already holds the same provider's `institutional_holders`
frame with the reporting dates, share counts and `fetched_at` intact. This contract carries those
dated records to the screen under their own name, so the Terminal shows what the provider actually
stated instead of showing nothing or showing the undated field as if it were verified.

## The contract

An optional, atomic block at `fund.ownership.reported`, scoped to exactly one listing.

| Field | Type | Notes |
| --- | --- | --- |
| `schema` | `"mastermind.reported-ownership/v1"` | exact |
| `listing` | `{ticker, market}` | `market` is `ca` or `hk`; the reader refuses any other symbol |
| `population` | `"vendor_institutional_holders"` | exact |
| `source` | `{name, adapter, field, url}` | fixed `Yahoo Finance` / `yfinance` / `institutional_holders`, URL `https://finance.yahoo.com/quote/<encoded ticker>/holders/` |
| `acquired_at` | ISO-8601 `Z` or `null` | the raw `fetched_at`, verbatim; never re-derived |
| `latest_attempt_at` | ISO-8601 `Z` or `null` | the real attempt clock, which moves even when acquisition does not |
| `publication_time` | always `null` | this provider method establishes no publication time |
| `percentage_basis` | `"provider_reported_unspecified"` | the denominator is never stated, so it is never inferred |
| `availability` | `available` \| `partial` \| `unavailable` \| `source_error` | |
| `unavailable_reason` | stable code or `null` | required whenever availability is not `available` |
| `normalizer_version` | `"1"` | |
| `raw_input_sha256` | 64-hex or `null` | SHA-256 of the **exact raw bytes** |
| `rows[]` | | `holder_name`, `reported_date` (`YYYY-MM-DD`), `shares` (integer string or `null`), `reported_fraction` (plain decimal string in `[0,1]` or `null`) |
| `content_sha256` | 64-hex | SHA-256 of the canonical JSON of this block, excluding `content_sha256` |

Only the Yahoo `institutional_holders` table is qualified here. This adapter does not claim HK
holder backfill: the existing HK raw cache carries an aggregate held percentage and no named table,
so HK listings render an explicit absence until a dated named-holder feed exists.

## What is deliberately absent

* **`Value` and `pctChange`.** Dropped. A value with no currency is a guess, and a period change is a
  trend claim this panel does not make.
* **Aggregate counts, totals or rankings.** The block is a list of what the provider said.
* **Every float.** All numeric observations are canonical decimal/integer *strings* and every other
  leaf is a string or null, so the canonical JSON is byte-identical in Python and JS. `Value` and
  `pctChange` never reach the panel, and no currency or denominator is assumed anywhere.

## The integrity receipt is not a signature

`raw_input_sha256` covers the raw bytes the block was derived from; `content_sha256` covers the
block itself. Together they prove the block was not corrupted or edited between the collector cache
and the screen. They are **not** a signature, **not** an attestation that the provider said what it
said, and **not** CI manifest verification. They say nothing about whether a 13F was filed.

Neither may be used to qualify, authorize, or substitute for a verified Company Intelligence event.
The reader (`lib/reportedOwnership.ts`) deliberately does not import the CI reader, and the panel
never reads the CI payload. The two snapshots are independent in both directions: an invalid CI
result does not hide a qualified reported block, and a qualified reported block does not rescue an
invalid CI one.

## Degraded fetches never restamp old data

On a fetch or field failure with a previously qualified block, the earlier rows are retained
verbatim along with their **original** `acquired_at` and their original report dates. Availability
is degraded to `partial` and `latest_attempt_at` records the real attempt when one is known. The
retained `raw_input_sha256` keeps describing the bytes those rows actually came from, and the block
is re-sealed so the content hash still matches its own content. A previous block that no longer seals
its own content is not retained.

An absent block is rendered as an absence. CN listings render absence too, and none of them ever
fall back to `top_inst`.

## Consumer rules

`verifyReportedOwnership` re-derives everything independently of CI and fails closed. A block is
rejected for: a symbol or market that does not match; a wrong schema, population, normalizer
version or percentage basis; a publication time that is not null; a source name, adapter, field or
URL that is not the fixed one; a malformed or future acquisition or attempt timestamp; a missing raw
receipt when rows are present; a non-finite or otherwise numeric leaf anywhere in the hashed block; a
fraction outside `[0,1]`; a share count that is not a non-negative integer string; a blank holder; a
malformed, impossible or future-dated report; a status that contradicts the rows; or a content hash
that does not match. The hash is recomputed with WebCrypto, is abortable, and a verdict for a
superseded listing is discarded by an identity key, so the previous symbol's rows can never render
under the new one.

**Dates.** Reported dates are the provider's own and are shown as stated. Report-date age alone
never proves the upstream feed is stale — a provider that has not filed this quarter is not a broken
feed — so only the acquisition timestamp can raise the stale disclosure, at a disclosed 30-day
threshold. Unknown dates stay unknown and are never back-filled.

## Testing

* `tests/test_reported_ownership.py` — 34 tests: exact-bytes receipt, date and `_errors`
  preservation, the deliberate absence of `Value`/`pctChange`/floats, degraded retention without
  date advance, and the cross-language golden.
* `terminal/lib/__tests__/reportedOwnership.test.ts` — 52 tests: the same golden recomputed through
  `JSON.stringify`, plus every rejection rule above and the percentage derivation (`0.0507` → `5.07%`).
* `terminal/lib/__tests__/reportedOwnershipPanel.test.tsx` — 30 tests: rendering, absence, degraded
  and rejected states, no `top_inst` fallback, rapid symbol switching with an in-flight digest,
  zh/en copy, and OwnershipPage routing including US behavior being unchanged.

One block file, `terminal/lib/__tests__/fixtures/reported_ownership/ca_block.json`, is asserted by
both languages: Python asserts the normalizer still produces it, and JS re-hashes it through
`JSON.stringify` and must reach the same `content_sha256`. The fixtures are **synthetic** — their
shape is copied from the real collector cache, but the rows and hashes are invented for tests and
are not evidence of a live provider fetch.

## Wiring left to the parent

This change delivers the normalizer, the reader, the panel and the page routing. It does **not**
wire the generator: `MegaPane.tsx` is untouched and still calls `<OwnershipPage sym={sym} />`, so
the optional `fund` / `fundLoading` props default to absent and every regional listing renders an
explicit absence until the parent passes them. `ingest/nightly_fund.sh` and the emitters are
untouched for the same reason — they are owned by other active workers.