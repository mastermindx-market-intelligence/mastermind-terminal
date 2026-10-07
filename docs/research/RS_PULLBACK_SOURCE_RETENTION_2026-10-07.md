# RS Pullback Launch: source observation retention

Operation: `rs-pullback-launch-source-retention-20261007-sol-002`
Parent: `WS:LIVE-ENTRY-RADAR` / `market-timing-intelligence`
Source base: Terminal `ad36a332cd4b53af1d917a94f6fb3a10e27dad84`
Protected procedure recovered by parent: Mastermind `ee120e80f5d5e0344c453dd7cbf4108b9c429b38`

Basis-declaration continuation: `rs-pullback-launch-basis-binding-20261007-sol-005`
Source base: Terminal `52b9107b2f33738256b1e4877bbf166a45556525`
Current protected procedure pin: Mastermind `1fc040f7343dde73fec3556dd3bf9bc8c1b18129`

## Delivered capability and boundary

The existing intraday producer can opt in to preserving original finalized one-minute
observations, successful-response receipts and later changed versions inside its existing
`<symbol>.1m.json` file. It continues to emit the legacy six-value `bars` projection.
One conventional per-file lock now serializes read, fetch, merge and atomic replacement.
There is no second collector, store, scheduler, lifecycle, revision selector or authority plane.

This is source retention infrastructure. No runtime cohort was enrolled, schedule changed,
provider called, outcome read, detector added or production activation performed by this
implementation. The RS Phase 1 verdict remains **NOT_ADMITTED**; H1/H2/H3 remain **NOT_TESTED**.
Neither source merge nor successful synthetic tests establish live collection or data admission.

## Existing-owner invocation

```bash
python3 ingest/backfill_intraday.py \
  --capture-minutes --symbols MU,SPY,QQQ,SMH --tf 1m --workers 1
```

This example describes the source interface, not a performed production action. The new mode
requires 1–16 unique, explicit uppercase symbols and true `1m`. It bypasses manifest ranking
and defaults to the existing incremental refresh path. `--symbols` without capture mode,
other timeframes, `--top`, `--limit`, or `--existing-only` together with explicit capture mode
are refused. The symbol cap is an operational bound, not an investable universe or a scientific
cohort definition. Existing `--force`/`--update` behavior remains available within that cohort.

Ordinary default timeframes stay `1h,5m`. The existing nightly command and 900-second finality
lag are unchanged. Once a file has a valid capture envelope, a later ordinary producer refresh
of that file continues recording captures. A direct row-only overwrite of an enabled file
refuses with `capture_context_required`; malformed or tampered capture state is never silently
reinitialized. With `--existing-only --tf 1m`, a validated already-enabled file whose chart is
empty can full-fetch through this same owner: it preserves its old capture prefix, appends the
new attempt and populates the chart only from a complete response whose returned adjustment
declarations all support the requested adjusted chart basis. This covers initial empty,
forming-only and failed captures. Missing files are not created by existing-only mode; empty
legacy files and unreadable stores still refuse before transport.

The first successful short or empty fetch is retained even below the legacy 20-row minimum.
An empty fetch on an already populated store still fails the existing overlap/freshness check
and preserves the chart, while its completed-empty response remains visible in the capture.

## Wire contract

The existing JSON object gains exactly one `minute_capture` envelope:

```text
schema: mastermind.intraday_minute_capture.v2
observer_id: terminal.backfill_intraday
authority: {research_admitted: false, trading_authority: false}
captures: ordered list of sealed capture records
prefix_sha256: final capture_sha256, or 64 zeroes for the empty prefix
```

The writer reads both v1 and v2 envelopes. A v2 envelope may contain an exact sealed v1
record prefix followed by v2 records. V1 payloads have no payload `schema`; v2 payloads carry
`schema="mastermind.intraday_minute_capture_payload.v2"`. A v1 record after the first v2 record
refuses. Appending v2 changes the outer envelope schema but never changes a prior record,
sequence, capture ID, predecessor, payload hash or record hash. Old reader receipts still
refer to the same sealed prefixes; no legacy observation is manufactured during upgrade.
Capacity refusal leaves even the outer v1 envelope byte-identical.

`observer_id` identifies the logical collector. It is not an invented host identity, entitlement
receipt, signed attestation or independent proof that a vendor supplied the bytes.

Each record contains:

| Field | Meaning |
|---|---|
| `sequence` | Contiguous one-based index. |
| `capture_id` | Immutable 32-character UUID hex identifier for this attempt. |
| `previous_capture_sha256` | Previous sealed record hash; 64 zeroes for genesis. |
| `payload_sha256` | Hash of the canonical retained payload. |
| `payload` | Sanitized attempt evidence described below. |
| `capture_sha256` | Hash of the record excluding this field. |

Canonical hash encoding is Python `json.dumps(value, sort_keys=True, separators=(",", ":"),
ensure_ascii=True, allow_nan=False).encode("utf-8")`, followed by SHA-256. Complete prefix
validation checks contiguous sequence, unique IDs, every payload seal, each predecessor and
the final prefix seal. Hashes detect content changes; they are not signatures.

### Attempt payload

- Version: `schema="mastermind.intraday_minute_capture_payload.v2"` on new payloads only.
- Identity: `symbol`, `timeframe="1m"`, `source="polygon"`.
- Chart compatibility: `chart_eligible`, a strict boolean distinct from acquisition status.
- Disposition: `status="complete"|"partial"|"failed"` and `failure_kind`.
- True UTC clocks: `started_at_utc_ns`, `completed_at_utc_ns`,
  `finality_reference_utc_ns`, and integer `finality_lag_s=900`.
- Sanitized request: `multiplier=1`, `timespan="minute"`, ISO `from_date`/`to_date`,
  `adjusted=true`, `sort="asc"`, `limit=50000`.
- `pages`: successful HTTP body-read receipts, including an invalid-body receipt when the
  successful HTTP read cannot be decoded or its aggregate envelope is invalid.
- `observations`: changed finalized minute episodes with their original consumed values.
- `counts`: `rows_received`, `finalized_rows`, `forming_skipped`, `unchanged_suppressed`,
  and `observations_retained`.

A complete empty response has `status="complete"` and zero rows. A forming-only response
has positive received/forming counts and no finalized observations. A failed HTTP/transport
attempt before any body was read has `status="failed"`; a later-page or malformed-response
failure after a body was received has `status="partial"`. Only complete attempts may
contribute to an eventual consumer. These states are not feed-completeness assertions.

Fixed failure kinds are `transport_exhausted`, `http_error`, `malformed_response`,
`invalid_response`, `malformed_bar`, `pagination_incomplete`, `source_failure`, and
`clock_invalid`. Complete attempts require `failure_kind=null`. Capacity refusals are
separate exceptions: they preserve the prior file and do not claim that the refused attempt
was retained.

Each page receipt contains zero-based `page_index`, `request_started_at_utc_ns`,
`response_received_at_utc_ns`, exact received-byte `response_sha256`/`response_bytes`,
`status="OK"|"DELAYED"|"INVALID"`, and its received/finalized/forming row counts.
Request/response clocks must lie inside the attempt clocks. `DELAYED` stays an explicit
source declaration; it is not relabeled real time.

Each v2 page also has exactly `response_adjusted: {"state": STATE}`. This is derived from the
actual top-level `adjusted` declaration in that exact response body, whose hash/count and page
location are already sealed. No arbitrary declaration value is retained.

| State | Actual response evidence |
|---|---|
| `TRUE` | Exactly JSON boolean `true`. |
| `FALSE` | Exactly JSON boolean `false`. |
| `MISSING` | Parsed object has no top-level `adjusted` key. |
| `NULL` | Exactly JSON `null`. |
| `INVALID_TYPE` | Present value is any other type; numbers and strings are never coerced. |
| `UNPARSED` | Body could not be decoded or is not an object. |
| `AMBIGUOUS` | More than one top-level `adjusted` key, even if values agree. |

Nested keys do not affect the top-level declaration. Invalid values, error strings and unknown
metadata are discarded. Legacy v1 pages have derived state `UNRECORDED`; that state is never
written into or resealed within an old record and differs from observed v2 `MISSING`.

`chart_eligible` is true only for a complete capture with at least one page and `TRUE` on every
page. A complete response with false/missing/null/invalid/ambiguous declarations remains a
complete retained observation, with `failure_kind=null` and `chart_eligible=false`. The writer
returns the fixed diagnostic `captured_response_adjusted_not_true`, reports a store failure,
and preserves the prior chart fields. It does not recast successful acquisition as a partial
transport failure. An initially incompatible capture creates the evidence envelope with an
empty chart, which can later recover through the existing owner. Partial/failed attempts
always have `chart_eligible=false`. Mixed-page declarations retain each page's state separately.

A returned `TRUE` supports only compatibility with this request. Native identity, action
lineage, transform/vintage, price and volume basis, and exact occurrence-bound downstream
admission evidence remain separate obligations. This flag grants no research or trade authority.

Each observation contains zero-based `page_index`/`row_index`, `event_start_utc_ms`,
`event_end_utc_ms`, and `raw`. The raw allowlist is only `t/o/h/l/c/v`; all other provider
fields are discarded. UTC starts come directly from integer source `t`, aligned to a minute;
ends are start plus 60,000 ms. Valid finalized rows must satisfy the recorded finality cutoff
and have ended before their page was received. No display-epoch guessing is used.

Raw volume preserves absent `v`, explicit `null`, zero, integer and fractional values.
The legacy projection keeps its existing display-epoch and integer-volume behavior. Thus
the retained raw observation, not the lossy chart tuple, is the downstream source input.
Request `adjusted=true` is only a request declaration; native security identity, action
lineage, and qualified price/volume basis remain separate owner obligations.

Request URLs, credentials, headers, unknown metadata and string-valued provider payloads
are never retained. The response-byte hash is provenance for the actual bytes read; the
full response body is **not** retained. Only reviewed input fields are recoverable from this
store. Captured pagination requires HTTPS on the original host and the exact original
aggregate path: ticker, multiplier, timespan and both date bounds must match. A next URL cannot
contain credentials or a fragment. Opaque cursor parameters are allowed; supplied `adjusted`,
`sort` and `limit` values, including duplicates, must match the original request. Contradictions
refuse before another request, leaving the attempt noncomplete and the chart unchanged. An
explicit response `ticker` that conflicts with the requested symbol marks that page `INVALID`
before any of its rows contribute to observations or the chart. Its byte receipt and received
row count may be retained, with `failure_kind="invalid_response"`. These are request-consistency
checks; they do not establish native security identity or action/adjustment-basis admission.

Captured requests also use a private standard-urllib opener that refuses HTTP redirects before
following `Location`, including same-host redirects. A first-request redirect records
`failed`/`http_error`; a later-page redirect records `partial`/`http_error` and preserves only
earlier safe response receipts. Redirect bodies are not successful aggregate-body receipts.
The legacy noncapture transport remains unchanged. Synthetic integrations must inject the
captured transport at `backfill_intraday._open_capture_request(request, *, timeout)` (the caller
supplies `timeout=45`); patching `urllib.request.urlopen` alone does not intercept capture mode.

## Compaction, replay and preservation

Only consecutive equal finalized raw values **and normalized referenced-page declarations**
relative to the latest **complete** observation for that minute are suppressed. Equality uses
canonical `{"raw": RAW, "response_adjusted": DECLARATION}`; response-byte hashes alone are not
a compaction key. V1 uses derived `{"state":"UNRECORDED"}`. Equal OHLCV with declarations
false → true → false retains three episodes; another false observation may suppress. A new
v2 `MISSING` differs from v1 `UNRECORDED`, even when raw values match. Different unsupported
values within the same `INVALID_TYPE` class do not require retention of their arbitrary data.
A → A retains one changed episode; A → B → A retains three.
Partial/failed attempts never advance that complete-observation state and never suppress a
later successful observation. The full original attempt is sealed in memory before replay
handling; persisted payload seals cover the explicitly compacted evidence.

`append_capture` builds a record from an already-compacted payload.
`append_sealed_capture(envelope, sealed_record)` is the explicit replay interface: it accepts
the exact immutable record, preserving bytes after subsequent captures, and rejects changed
content under the same ID. It does not recompact a raw historical attempt against the current
state. Suppressed rows are never expanded into a new observation vintage, including during
v1-to-v2 upgrade. Re-retaining the same finalized in-memory `CaptureAttempt` reuses its immutable seal
and rejects changed original attempt data. Tests cover a replay that actually suppressed
24 of 25 rows.

All producer writing paths preserve the envelope, including unchanged fetches, overlap
corrections, basis rebuilds and row-cap trimming of the chart projection. Old captured
versions are never pruned when the chart's latest-row projection changes. A later-page
failure retains its safe sanitized partial attempt when capacity allows, but leaves the
chart projection unchanged. A failed atomic replacement is not silently retried by the
post-fetch retention step.

The persistent `.json.lock` inode is ordinary per-file flock coordination. It is deliberately
not unlinked on release: replacing a held lock inode would permit concurrent owners.
Thread reentrancy allows existing nested read/write paths within the same critical section.
The existing tmp → file fsync → replace → directory fsync write remains the only commit.

## Bounded retention

| Bound | Limit |
|---|---:|
| Explicit cohort | 16 symbols |
| Captures per symbol file | 4,096 |
| Successful response bodies per capture | 16 |
| One received response body | 8 MiB |
| Entire serialized symbol file | 32 MiB |

Crossing a count, page, response or whole-file limit returns failure and leaves the prior
valid file byte-identical. It emits an explicit capacity/refusal reason and makes no retention
claim for the refused addition. No automatic prefix pruning, secondary archive, retry daemon
or fabricated coverage continuation is provided. The existing owner must choose a reviewed
retention evolution before these bounds prevent further accrual.

## Consumer clock and authority

Collector request/response time is **not** file visibility or Radar `known_at`. A page can
arrive before a later multi-page failure or before an atomic file becomes readable.
The Macro bridge reads exact file bytes, validates the capture prefix, and records its own
actual read-completion clock. The earliest valid reader receipt covering a prefix is the
only permitted `known_at` for the corresponding episodes in the existing RS input bundle.

A first read that discovers A/B/A together gives those episodes the same knowledge time.
The existing selector then refuses the conflicting revisions. Neither Terminal nor the
bridge invents time offsets or adds another revision-selection authority. Legacy D0 file
qualification continues to withhold as-observed admission because it does not interpret this
new envelope; its canonical revision boundary remains with Radar.

Nightly receipt retention cannot reconstruct earlier daytime availability. The 15-minute
finality lag also prevents claiming that this unchanged producer serves the freshest closed
intraday frame. Cohort/cadence activation, natural-session accrual, lawful storage rights,
identity/action-basis/calendar receipts, current daily context and faithful incumbent
assessment evidence remain actual program dependencies.

## Verification

The focused injected-transport suite and existing affected producer/nightly suites passed:

```bash
python3 -m pytest tests/test_intraday_capture.py \
  tests/test_backfill_intraday.py tests/test_backfill_intraday_refresh.py \
  tests/test_backfill_intraday_breaker.py tests/test_nightly_wiring.py -q
```

Result after the review repairs: **242 passed** (55 capture cases), with four
unrelated existing pytest cleanup warnings. The new cases exercise actual injected HTTP-body
read → fetch → atomic file → validated read, original values and secret exclusion, A/A/B/A,
partial failure and recovery, first empty/short captures, malformed/transport failure, basis
rebuild, each capacity refusal with unchanged preimage, existing-owner continuation, tamper
refusal, two-process serialization, sealed replay, and file entry from outside the checkout
with a hostile ambient import path. Existing nightly wiring remains unchanged.

The 19 review cases cover symbol, multiplier, timespan, date-bound and query-invariant
pagination conflicts before a second request; valid same-request cursor paging with omitted
or explicit matching invariants; response ticker contradictions on the first or later page;
empty/forming-only/failed enabled-file recovery; and legacy empty/unreadable/missing refusal.
Against the reviewed pre-repair source, the initial 18-case gate produced 14 failures and four
passing controls. After repair, the expanded 19-case gate passed. All transports were injected.

A second review gate exercises the standard urllib HTTP/error/redirect handler chain with a
synthetic HTTPS handler and no network. Same-host wrong-grain redirects, cross-host redirects
and a later-page redirect all failed their refusal assertions against pre-repair `ee385847`,
while the direct valid-response control passed. After redirect refusal was added, all four
passed: no redirected request was issued, no later payload was retained, and earlier safe
receipts and chart bytes were preserved. Existing injected fixtures use the new private
transport seam, including the concurrent-process and actual-file-entry checks.

The parent also runs a reproducible cross-repository synthetic harness through the actual
Macro reader and canonical RS selector. Its acceptance receipt belongs to the parent carrier;
local test success here does not substitute for independent review, hosted checks, source
merge or real runtime proof. The v2 producer must not be activated before the paired Macro
dual-version reader is delivered. The transport injection seam is unchanged; synthetic positive
fixtures must declare actual top-level `adjusted:true`. That declaration alone does not satisfy
the consumer's independently required occurrence-bound basis evidence. The unchanged D0 qualification, CLI and session-chain suites
also passed separately: **59 passed**, with the same four unrelated cleanup warnings.


### Basis-declaration continuation verification

The continuation uses synthetic bodies through `_open_capture_request`, actual producer fetch,
atomic store replacement and validated file reads. Its controls cover unchanged v1 record/seal
prefixes, legacy `UNRECORDED` to observed `MISSING`/`TRUE`, false/true/false equal-value episodes,
all normalized unavailable states, duplicate top-level keys including equal duplicates, nested
key isolation, mixed-page declarations, partial failures, empty recovery and capacity refusal.
The unchanged response-identity, cursor pagination and redirect defenses continue to run in
the same focused suite. Captured raw fractional/null/missing volume remains exact; legacy chart
volume remains its existing integer projection. No scheduler, cohort, rights, source endpoint,
finality cutoff, cap, lock or atomic-write route is changed.

The affected gate passed **325 tests**, including **79 capture cases** and **59 unchanged D0
qualification/CLI/session-chain cases** (Studio Direct process `35871`, exit 0). It ran with
bytecode and pytest cache disabled, isolated temporary inputs, and no provider access:

```bash
python3 -B -m pytest tests/test_intraday_capture.py \
  tests/test_backfill_intraday.py tests/test_backfill_intraday_refresh.py \
  tests/test_backfill_intraday_breaker.py tests/test_nightly_wiring.py \
  tests/test_intraday_qualification.py tests/test_intraday_qualification_cli.py \
  tests/test_intraday_session_chain.py -q -p no:cacheprovider
```

A separate actual producer-to-file sample (`25272`, exit 0) retained a `TRUE` declaration bound
to its exact page hash/count, immutable capture/payload seals and original fractional volume.
It used the private injected transport and a temporary store. Source hashes and independent
review belong to the frozen worker packet. The Phase 1 verdict remains **NOT_ADMITTED**, all
authority flags remain false, and no outcome or scientific hypothesis is tested by these
engineering controls.
