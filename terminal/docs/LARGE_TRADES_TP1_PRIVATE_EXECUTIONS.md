# Private TP-1 executions and correction accounting

This increment connects native TP-1 transaction records to the existing Large
Trades engine. It also makes correction uncertainty explicit in snapshots,
inspection and chart exports. It does not activate a public TP-1 feed.

## Input and quantities

`ingest/tp1_large_trades.py` consumes the existing
`equity.tick_plane.stream_event/v0` **T** records. It does not consume minute
aggregates, R0 context, candles or a signed observation without its native trade.
The converter opens no socket, classifies no side and publishes no source.

The initial quantity basis is **gross as reported**: all integral shares in the
supplied native T reports, before correction reconciliation. Condition and
consolidated-volume eligibility remain unqualified. Identical economic reports
count once even when retransmitted in another frame. Conflicting economic
identities refuse the candidate. Exchange/TRF scope remains part of identity.

The exact decimal size is authoritative. A row with integer size 1 and decimal
size `"1.5"` refuses the entire candidate; it cannot become one share or disappear
silently from a supposedly complete batch. Unsupported scale, unsafe price or
aggregate quantity, malformed clocks, contradictory identity, additional
qualification fields and excessive conditions likewise refuse the candidate.
A fixed price scale of 1,000,000,000 prevents later finer-price observations from
rewriting the earlier price representation. It does not establish tick size.

Direction stays unknown. TP-1's separate signed observation may have a later
decision timestamp; placing that side on the original receipt would backdate
knowledge. A future signed-side increment must use the incumbent signer and
preserve that separate qualification clock.

## Clocks and private evidence

SIP time is **reporting time**, with native millisecond precision. It is not a
substitute for the earlier participant execution time. Original frame receipt,
participant/TRF timestamps, native sequence, exchange/TRF identity, frame hash,
event index, receipt ID, exact price/size strings, conditions and correction/action
labels are retained in the private conversion's `sourceRecords`.

Fixture mode is explicit. Historical mode requires:
SIP time <= original receipt <= supplied acquisition <= generation. Availability
then uses acquisition, while retaining original receipt in private evidence.
The historical convention does not authenticate the input. Both modes return
`sourceAuthenticated=false`, `productionApproved=false` and
`publicDeliveryAllowed=false`. Neither can claim live or delayed service.

The producer's nonconsecutive sequence values do not establish packet loss.
Coverage remains unknown, and tick size remains unqualified.

## Additive v1 accounting

An envelope may supply `accounting`:

- `quantityBasis`: `gross_as_reported` or `net_of_observed_cancels`.
- `correctionCoverage`: `unsupported`, `unknown` or `complete`.
- `correctionEvidence`: null unless complete; then an explicit start, end,
  knowledge timestamp and source reference.

“Complete” applies only to that evidence range as of its knowledge timestamp.
It never promises that no later correction can arrive. A complete declaration
requires a correction-compatible quantity basis, a valid range within the
envelope, and knowledge no earlier than its range end or later than generation.
An envelope labeled gross cannot also contain cancellation records.

Every engine snapshot resolves this metadata at its knowledge cutoff. A future
attestation and its reference are withheld until available. Missing legacy
metadata preserves parsing, quantities and observed-cancel handling, while
resolving to net of observed cancels with unknown correction coverage. Existing
historical IEX artifact bytes and hashes are unchanged.

Qualified response additionally requires correction evidence covering the
whole cluster response window. Its knowledge time participates in response
`knownAtNs`. All previous side, tick, source, quote-path, maturity and integrity
gates still apply. TP-1's unsupported correction coverage cannot produce
qualified absorption or failed-continuation intelligence.

## Consumer journey

The existing chart overlay displays exact quantities and report counts.
Provisional totals are identified in the dock; inspection exposes the quantity
basis and correction status. SIP timestamps use reporting-time labels.
Correction range/time and the condition policy remain under evidence details.
Native chart exports retain provisional accounting and SIP-clock disclosures.
The existing replay, chart ownership and settings paths are reused.

The public API source-admission function remains unchanged and IEX-historical
only. A fixture intercept in browser tests is consumer verification, not source
admission or production proof.

## Deterministic provenance and verification

The native fixture was produced from synthetic T frames using the existing
Macro normalizer:

- Repository: `mastermindx-market-intelligence/macro`
- Commit: `6cc0858fa93fa3200268390c9588bcc67358eb23`
- Path: `engine/tick_plane/stream_events.py`
- Git blob: `1d85b29cda38bf763d0e517c964e384cced53fdf`
- Producer SHA-256: `636b8fa03638c2fe955d7289ee2d5a4c500a4a7b869ba5e3c0b8298cb4114a33`
- Native fixture SHA-256: `cab0972a4183a4c823ea564e804dd95dea601ffa109f1e682c2d6638d088834d`
- Converted envelope SHA-256: `cae784e1c3915afd8c36880fd806e8b9e1ef4f79eb439ba615f8eec33fd54179`

Six supplied rows contain five distinct reports and 3,101 reported shares. Three
reports form the 1,301-share cluster. One row is a retransmission. These are
synthetic validation facts, not market observations or out-of-sample results.

Run from the repository root:

```sh
python3 -m pytest -q tests/test_tp1_large_trades.py
```

Run from `terminal/`:

```sh
npm test -- lib/__tests__/largeTradesTp1.test.ts lib/__tests__/largeTrades.engine.test.ts
npx tsc --noEmit
npm run test:e2e:responsive -- e2e/large-trades.spec.ts --grep "native TP-1 gross executions" --workers=1 --project=desktop --project=tablet --project=mobile
```

The Python tests regenerate the consumed envelope from the normalized native
fixture. Terminal tests prove positive clustering, economic deduplication,
quantity conservation, cutoff invariance and correction abstention. Browser
tests cover chart, inspector and replay on the three responsive viewports, with
English and Chinese dark variants. The current Terminal shell is explicitly
dark-only (app/layout.tsx and globals.css). An initial light-preference test
confirmed that it stays dark; this increment does not claim a working light
product theme or alter the shared theme owner.

## Saved verification

The [verification manifest](pr-crops/large-trades-tp1-private/manifest.json) binds
source-file hashes, synthetic provenance, logs, native PNG exports and responsive
screenshots. Local verification passed 34 Python cases, 222 Terminal unit cases,
type checking, an 18-case integration run and a 9-case visibility/export run
(six cases overlap). Native wheel checks prove the accounting and SIP-clock
fields are reachable inside the phone, tablet and desktop inspector. Export
checks prove that the rendered PNG retains the quantity and clock disclosures.

## Source and entitlement references

- [Native TP-1 producer](https://github.com/mastermindx-market-intelligence/macro/blob/6cc0858fa93fa3200268390c9588bcc67358eb23/engine/tick_plane/stream_events.py)
- [Official trade fields](https://massive.com/docs/websocket/stocks/trades), checked 2026-10-17:
  decimal size, SIP/participant/TRF clock distinctions and nonconsecutive sequences.
- [Existing enterprise entitlement record](https://github.com/mastermindx-market-intelligence/macro/blob/9629927bfc7a4dad13b89590e86cd1b9be33573a/research/licenses/MASSIVE_ENTITLEMENT_RECORD.md).
  The general equity licensing gate is already closed; specific dataset
  designations, authentic capture and consumer admission retain their owners.

Authentic captured input, incumbent publication, authenticated product access
and production verification remain separate acceptance steps. This increment
does not supply CME/MNQ licensing or claim statistical trading efficacy.
