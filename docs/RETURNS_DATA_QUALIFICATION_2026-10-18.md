# Returns: the remaining descriptive-data qualification

## Decision and current status

Use the existing Data OS view `terminal.bars.daily.ohlc_json` to bind and qualify
the actual Terminal-produced OHLC artifact for **current-vintage descriptive
returns**, if its governing policy permits that materializer and use. Historical
vintage remains unattested. Forecast admission remains a separate Eval OS decision.
This document is an integration proposal and source finding, not an owner approval.

The live NVDA artifact inspected on 2026-10-18 had 6,977 bars from 1999-01-22 through
2026-10-16, `src=yahoo`, real OHLC, and no `view` block. The local Macro snapshot had
6,971 rows through 2026-10-08, with no observed-open column, and no readable view
sidecar at that snapshot location. Those observations do not establish the state
of every production store. They do establish that substituting the older snapshot
would lose freshness and observed opens and would not qualify the current artifact.

## Existing source owners and the mismatch

At Macro source `59e26b1ef51dc3c83aac94ca26e7ee8c2c5fc580`:

- [`engine/price_ladder.py`](https://github.com/mastermindx-market-intelligence/macro/blob/59e26b1ef51dc3c83aac94ca26e7ee8c2c5fc580/engine/price_ladder.py)
  defines `terminal_daily_ohlc_contract_v1`: `CURRENT` evidence, `tradj` share basis,
  `equity.bars.daily.stocks` source registry, and the Terminal view output registry.
  Historical vintage is unattested; generation attestation is false. Factory
  serialization alone therefore is not evidence of historical availability.
- [`scripts/emit_view_contract.py`](https://github.com/mastermindx-market-intelligence/macro/blob/59e26b1ef51dc3c83aac94ca26e7ee8c2c5fc580/scripts/emit_view_contract.py)
  is the existing nightly sidecar writer. It emits the factory contract and
  source-store coverage/listing/refusal information. It does not qualify an
  unrelated direct fetch merely because both sources use Yahoo.
- The decision of record is
  `agentos/decisions/DEC-DATAOS-VIEW-CONTRACT-SIDECAR-IS-A-NIGHTLY-EMITTER.md`.

Terminal's `ingest/build_universe.py` reads this sidecar when materializing the
Macro store. It intentionally preserves existing Polygon/Yahoo real-OHLC files
instead of replacing them with shorter histories and reconstructed opens. The
flagship `ingest/build_polygon_universe.py` directly requests Yahoo's full history
with `auto_adjust=True`; that is a distinct materialization path. The Macro
sidecar's source-store binding cannot simply be copied onto those bars.

## Repair implemented in Terminal

The former failed-fetch fallback stripped metadata and labeled reused bars as
Yahoo. The repair returns the complete previous document and skips the OHLC write
on actual reuse. It preserves exact bytes, source, clocks and any metadata whose
binding remains valid. A shorter or older fresh fetch cannot erase deeper or newer
history. A fresh fetch receives source observations, requested adapter configuration,
adapter version when available, observation time, coverage and a digest of its
bars. These live under `source_observation`, explicitly `OBSERVATION_ONLY`, with
historical availability `UNATTESTED`; they do not populate `view`.

Fresh bars do not inherit a previous contract. Unknown legacy vendor metadata is
preserved, and the universe builder continues to protect observed opens using
`bar_quality=real_ohlc`. The original signal and backtest source routing remains
intact. Sixteen tests exercise these boundaries, including the actual flagship
main path preserving file bytes and modification time while retaining deep signal
input. Twelve existing atomic-publication tests also pass.

## Exact owner questions

1. Does the existing view permit an approved direct Terminal Yahoo materializer,
   or must this artifact first be ingested through `equity.bars.daily.stocks`?
2. Does evidenced `tradj` with `evidence.mode=CURRENT` permit retrospective returns,
   pace, volatility and drawdown while historical vintage remains `UNATTESTED`?
3. What source, transformation, generation and artifact-binding evidence does the
   owner require for that use? Which existing attestation/publication mechanism
   carries it?

If an owner policy extension is needed, change the existing owner object and its
materialization path. Do not add a second registry, infer approval from vendor
names, or allow a producer-controlled Boolean to admit its own output.

## Acceptance criteria for descriptive qualification

| Requirement | Evidence needed |
|---|---|
| Authorized materializer and use | Existing owner policy explicitly permits this source path and current-vintage descriptive use. |
| Actual artifact binding | Instrument, interval/session convention, observation time and exact content identity bind the contract to the delivered bars. |
| Evidenced price basis | The source and transformation satisfy the owner's definition of `tradj`; requested `auto_adjust=True` alone is insufficient. Do not call it total return without that definition. |
| Integrity | Deep history, real opens, identity, coverage and source-refusal handling are conserved and verified. |
| Honest history | Historical readings are labeled calculations on current-vintage history, not archived signals available at past dates. |
| Independent forecast boundary | Point-in-time inputs, predictive validation and canonical admission are still required; probabilities remain null. |
| Consumer proof | One exact live NVDA artifact matches the binding and deterministic 5/21/63-session calculations; a binding mismatch disables qualified state. |

One admitted stock does not establish universe-wide coverage or a qualified basket.
Every member and benchmark needs compatible evidence and complete common sessions.

## Predictive owner remains separate

Macro's existing Eval OS recovery architecture and measurement law were read at
`7c046cf` (the recorded source lookup). They retain engine registry, owner-native
scored ledgers and existing qualification/promotion paths. No Returns-specific
canonical admission receipt has been located or published. The seasonal output is
explicitly display-only and its leave-one-year-out procedure is not a chronological
forecast evaluation.

The frozen price-only NVDA candidate underperformed its class-prior baseline at
5, 21 and 63 sessions. See [the retained research result](RETURNS_RESEARCH_RESULT_2026-10-18.md).
Current descriptive source qualification would not reverse that result or admit
future-direction probabilities.

## 2026-10-19: owner implementation and production coverage

The technical ownership questions above were resolved through the existing Data
OS D00/D00A1 law and current assigned-session authority. The direct Yahoo path is
implemented in [Macro PR #9619](https://github.com/mastermindx-market-intelligence/macro/pull/9619),
source `d974d0f843737e49bc072c4481c2fd6539a02d4b`. Its dated clarification is
`research/TERMINAL_YAHOO_MATERIALIZATION_2026-10-19.md`. This source milestone is
separate from concluded review, CI, installation and live publication.

The pure owner leaf binds the actual request, current `store` and `yahoo_fetch`
aliases to one canonical listing, observation time, ordered OHLCV rows, code-file
hashes and current reference-file hashes. Its current-vintage vendor total-return
proxy does not attest historical availability or an identity generation. The
original Macro-store contract factory and C04 sidecar writer are unchanged.

Terminal loads that leaf and the existing canonical identity reader by explicit
files under the installed `MACRO_REPO`, without adding Macro to its Python import
path. The existing flagship writer remains the output writer. Complete input rows
are verified by the browser and both Returns server routes before cutoff filtering.
The portable codec uses ordered ISO dates and big-endian binary64 OHLCV; a copied
JSON Boolean cannot replace process-local verification. Append/trim/change invalidates
the binding, while a true no-op retains it. This checks content integrity against
trusted owner metadata; it is not a cryptographic issuer signature or admission.

Relative paths and baskets require a common transformation family as well as a
matching broad basis. A bare TRADJ label does not establish cross-vendor compatibility.
Qualified constituent baskets carry their common family to the benchmark comparison.

Read-only production inspection on 2026-10-19 found Yahoo real-OHLC histories through
2026-10-16 for NVDA, AMD, AVGO, SPY, QQQ, SMH and XLK; none yet had this new view or
source-observation block. The current canonical reference contains 3,105 master
and 8,926 alias rows. NVDA/AMD/AVGO resolve in both required namespaces; SPY/QQQ/SMH/XLK
do not. SPY has a reference listing and a dated Theta option-root alias, which does
not authorize a Yahoo fetch alias. Production reference hashes at this inspection:

- security_master.parquet: `c05bdcf2e5ece8d167a40d5d60eb33e054561f42947d5b9a7ef21eda63867b72`
- vendor_aliases.parquet: `d6eaabba0f737ec1e454a9211bf8be205851f4735415d71f8afd4f48bbefa8de`

The existing reference publisher is being traced for the legitimate benchmark
coverage path. No generated identities or aliases were hand-edited. Absolute
analytics remain independent of benchmark availability; the UI names an unavailable
comparison rather than showing an empty line as zero.

Current local proof: 117 application tests, 74 producer tests, complete TypeScript
check, and 21 browser scenarios across desktop/tablet/mobile passed. Browser tests
include the owner golden fixture qualifying via WebCrypto, then refusing a valid
OHLC mutation; the fixture is not installed into production data. The Macro owner
suite passed 63 tests; its combined registry/consumer/support/C04 selection passed
171, with 8 skips and 1 expected failure. See the dated review disposition for
review scope and outstanding release gates.
