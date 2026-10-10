# RS Pullback Launch: source observation retention

Operation: `rs-pullback-launch-source-retention-20261007-sol-002`
Parent: `WS:LIVE-ENTRY-RADAR` / `market-timing-intelligence`
Source base: Terminal `ad36a332cd4b53af1d917a94f6fb3a10e27dad84`
Protected procedure recovered by parent: Mastermind `ee120e80f5d5e0344c453dd7cbf4108b9c429b38`

Basis-declaration continuation: `rs-pullback-launch-basis-binding-20261007-sol-005`
Source base: Terminal `52b9107b2f33738256b1e4877bbf166a45556525`
Current protected procedure pin: Mastermind `1fc040f7343dde73fec3556dd3bf9bc8c1b18129`

Unadjusted-acquisition continuation: `rs-pullback-launch-unadjusted-capture-20261007-sol-007`.
The current v3 contract, source-only invocation and verification are in
[Unadjusted acquisition continuation (v3)](#unadjusted-acquisition-continuation-v3).
Earlier v1/v2 sections and their receipts are retained as historical context.

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


## Unadjusted acquisition continuation (v3)

Operation: `rs-pullback-launch-unadjusted-capture-20261007-sol-007`.
Source base: Terminal `29224303b192bf70c2692227239a62cde1ee0c6b`.
Protected procedure: Mastermind `1fc040f7343dde73fec3556dd3bf9bc8c1b18129`.
This section supersedes the v2-only wire and invocation descriptions above for the
new writer; the earlier verification receipts remain historical evidence.

The existing producer gains one exclusive mode:

```bash
python3 ingest/backfill_intraday.py \
  --capture-unadjusted-minutes --symbols MU,SPY,QQQ,SMH --tf 1m --workers 1
```

This is an interface example, not an authorized or performed provider acquisition.
The new flag is mutually exclusive with `--capture-minutes`. It requires the same
1–16 explicit-symbol bound and 1–16 workers, and refuses other grains, `--existing-only`,
`--top`, `--limit`, `--update`, `--force`, and `--expect-advance`.
The distinct flag plus required `--symbols` also refuses on the old v2 CLI: that
binary requires `--capture-minutes` for an explicit symbol cohort.

Each invocation selects one acquisition role. Raw mode makes one acquisition chain
per explicit symbol through the existing fetch owner, per-file lock, capture session,
bounded no-redirect transport and atomic writer. It issues no companion chart fetch.
It bypasses chart refresh, chart watermark, basis-ratio check, rebuild and merge. The
existing noncapture fields—including `bars`, `asof`, extra metadata and fractional
chart values—are preserved as JSON values; their canonical byte representation is
unchanged. The enclosing JSON file is still atomically serialized and therefore its
original whitespace is not a promised invariant. A legitimately missing file receives
the existing identity envelope with an empty chart. An unreadable, mismatched or
tampered existing input refuses before transport; it is not reinitialized.

Raw mode always reuses the existing one-minute **40-day** request profile. It neither
uses a chart watermark nor introduces a raw watermark. The exact from/to dates remain
sealed request provenance. Compaction reduces stored observations, **not request
traffic**: another invocation downloads that window again. The shared caps remain
16 pages per acquisition, 8 MiB per response, 4,096 total captures across both roles,
32 MiB for the whole file, and the existing up-to-five transport attempts per page.
No live cadence, cohort, request budget or scheduler change is approved here.

### Version and role law

The outer schema becomes `mastermind.intraday_minute_capture.v3`. Every newly created
payload—including an ordinary adjusted chart capture—uses
`mastermind.intraday_minute_capture_payload.v3` and includes `acquisition_role`.
All existing record keys, seals, count definitions, page declarations and observations
remain unchanged.

| Payload | Acquisition role | Required request.adjusted |
|---|---|---|
| v1 (no payload schema) | Derived `chart_adjusted` | Actual Boolean `true` |
| v2 | Derived `chart_adjusted` | Actual Boolean `true` |
| v3 | Explicit `chart_adjusted` | Actual Boolean `true` |
| v3 | Explicit `research_unadjusted` | Actual Boolean `false` |

No numeric/string substitute is a Boolean. The v3 envelope permits an exact sealed
v1 prefix, then v2, then v3; versions never decrease, and a record version cannot
exceed its envelope version. Either legacy prefix can be absent. Upgrading the outer
schema leaves prior IDs, observations, clocks and seals exact, including zero-observation
suppressed records. Exact sealed-record replay remains idempotent. Legacy mismatched
responses are never retrospectively promoted to the raw role.

Request, response declaration, transport completeness and chart eligibility remain
separate facts. All seven normalized `response_adjusted.state` values are unchanged.
A chart payload is eligible only for the chart role, an actual true request, complete
acquisition, nonempty successful page receipts, and a TRUE declaration on every page.
A raw request complies only with an actual false request, complete acquisition,
nonempty successful page receipts, and a FALSE declaration on every page. Complete
empty responses remain distinguishable from failed and forming-only responses.
Every raw payload has `chart_eligible:false`, including a mismatched TRUE response.

Raw TRUE/missing/null/invalid/ambiguous responses remain complete retained evidence
with a fixed `captured_response_adjusted_not_false` refusal. Malformed or non-object
responses retain UNPARSED receipts and their existing partial/failed distinction.
No returned raw display rows enter the chart projection. Source numeric volume retains
fractional, null and missing values exactly. The true-UTC event boundaries and
900-second finality lag are unchanged; the latest fifteen minutes remain structurally
unavailable under that finality rule.

The first raw URL explicitly requests `adjusted=false`. A pagination URL must preserve
the original aggregate path, admitted HTTPS host and all supplied query invariants.
A cursor-only URL is accepted and gains `adjusted=false` before its outgoing raw
request. A supplied true or mixed true/false query refuses rather than being overwritten.
The chart path's prior pagination behavior is unchanged. Redirects remain disabled,
and an explicit conflicting response ticker contributes no rows.

### Compaction and consumer boundary

The latest complete observation map is partitioned by acquisition role and requested
adjusted Boolean, then keyed by event start. Its equality comparison is the unchanged
canonical raw row plus the exact referenced page's normalized declaration. Date-window
changes do not define a new partition. Equal values and even equal returned declarations
in different roles cannot suppress each other. A→B→A remains three observed episodes
within each role.

Partial and failed attempts never replace the latest complete baseline. Empty and
fully suppressed complete attempts contribute no new observation to that baseline.
This preserves the inherited recovery behavior: a later complete response retains
only changes relative to that role's latest complete observations. An interruption in
another role neither suppresses a correction nor re-expands previously suppressed rows.
The inherited 25-row partial-recovery case still retains one changed row, and the
mixed-page recovery case still suppresses one row and retains one.

A compatible Macro reader must be delivered before this v3 writer can be released.
It must preserve whole-file integrity checks and apply payload version/order/role
semantics only to the visible enrolled capture prefix. Its actual read receipt remains
a custody link, not a provider authenticity attestation. The response-bound role and
FALSE declaration do not provide action factors, historical security identity or full
basis admission. The consumer still emits `basis_id:null` and
`TERMINAL_BASIS_UNPROVEN` until the existing source owner supplies the separately
required reconstructable evidence. The parent owns that dependent implementation.

### V3 source verification

The affected synthetic gate passed **405 tests**, including **159 capture cases** and
the unchanged 59 D0 qualification/CLI/session-chain cases (Studio Direct process
`71298`, exit 0). The command is the eight-file affected gate recorded above, with
bytecode and pytest cache disabled. Eight unrelated inherited pytest cleanup warnings
concern older Chromium temporary directories.

New controls exercise the actual producer and atomic store: every chart field across
raw success/empty/forming/refusal/partial/failed outcomes; fractional/null/missing volume;
all raw outgoing page queries; cursor-only and explicit-false pagination; conflicting
queries/ticker/path/host and standard-urllib redirects; explicit CLI bounds; corruption
before transport; all four capacity limits and atomic-replace failure without retry;
equal-declaration role isolation; independent correction/reversion histories; same-role
and cross-role interruptions; exact v1/v2 prefix migration; correctly resealed invalid
role/request/version combinations; two-process mixed-role serialization; and both
actual file-entry modes from outside the checkout.

The first expanded run exposed two new test expectations that incorrectly treated an
empty chart refresh as successful. Those expectations were corrected to preserve the
existing EmptyOverlap refusal; no producer behavior or inherited recovery assertion
was changed for that correction. The final affected gate passed.

Only these four source/test/documentation files change. No provider or credential
operation, live store, Macro source, schedule, deployment, outcome or admission effect
occurred. This packet awaits independent source review; it is not a merged or installed
capability. Phase 1 remains **NOT_ADMITTED**, H1/H2/H3 remain **NOT_TESTED**, and all
authority flags remain false.


## Captured HTTP Content-Length completeness repair

The captured-read path checks outstanding declared Content-Length before creating
a successful page receipt or decoding an in-bound body. Python's bounded
`HTTPResponse.read(size)` can return a syntactically valid JSON prefix while
declared bytes remain outstanding; such a response now follows the existing
bounded transport retry path. Five failed attempts yield `transport_exhausted`: a
first-page failure records no successful pages or observations, and a later-page
failure retains only prior complete-page observations in a partial acquisition.
Neither case publishes chart data or becomes chart-eligible. These failed HTTP
attempts do not acquire successful response receipts, matching the existing
truncated-chunked behavior; no new wire or failure diagnostic is introduced.

Complete Content-Length, complete chunked and normal EOF-delimited responses remain
supported. A response exceeding `MAX_RESPONSE_BYTES` retains the existing immediate
capacity refusal without extra framing retries or a truncated page receipt; the
prior valid file stays byte-identical. Noncapture reads, retry policy, private
redirect guard, helpers, sealed prefixes, roles and compaction remain unchanged.
The same transport check is applied to both v2 and v3 producers. Verification uses
real `http.client.HTTPResponse` framing with synthetic sockets, existing CLI/store
paths and temporary stores; it establishes no provider or historical availability.
