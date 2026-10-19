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

The technical ownership questions above were resolved through existing Data OS
D00/D00A1 law and the current assignment. The direct Yahoo owner is implemented in
[Macro PR #9619](https://github.com/mastermindx-market-intelligence/macro/pull/9619).
The first independently reviewed source was `d974d0f843737e49bc072c4481c2fd6539a02d4b`;
review hardening is published at `a380c1783b70fad9878298d282501b9c84b87df6`.
The dated owner contract is
`research/TERMINAL_YAHOO_MATERIALIZATION_2026-10-19.md`. Bounded source review and
local tests do not establish completed CI, installation or live qualification.

The pure owner leaf binds the actual request, current `store` and `yahoo_fetch`
aliases to one canonical listing, observation time, ordered OHLCV rows, code-file
hashes and reference-file hashes. Its CURRENT vendor total-return proxy leaves
historical availability and identity generation unattested. The original
Macro-store factory and C04 sidecar writer remain their existing owners.

Terminal loads the leaf and canonical identity reader by explicit files under the
configured `MACRO_REPO`, without putting Macro on its Python import path. The
existing flagship writer remains the output writer. Complete rows are verified
before browser or server cutoff filtering. The portable codec uses ISO dates and
big-endian binary64 OHLCV; a JSON Boolean cannot replace local verification.
Append, trim or change invalidates the binding; a true no-op retains it.
This checks consistency against trusted owner metadata, not a cryptographic
issuer signature or independent model admission.

Relative paths and baskets require a common transformation family and broad
basis. A bare TRADJ label does not establish cross-vendor compatibility.
Benchmark absence preserves usable absolute analysis and is explicitly labeled.

### Observed production coverage

Production inspection on 2026-10-19 found Yahoo real-OHLC histories through
2026-10-16 for NVDA, AMD, AVGO, SPY, QQQ, SMH and XLK. None then contained this new
view or source observation. The reference had 3,105 master and 8,926 alias rows.
NVDA/AMD/AVGO resolved in both required namespaces; SPY/QQQ/SMH/XLK did not.
SPY's existing reference listing and dated Theta option-root relation do not
admit a Yahoo fetch alias. The inspected hashes were:

- `security_master.parquet`: `c05bdcf2e5ece8d167a40d5d60eb33e054561f42947d5b9a7ef21eda63867b72`
- `vendor_aliases.parquet`: `d6eaabba0f737ec1e454a9211bf8be205851f4735415d71f8afd4f48bbefa8de`

No reference rows or production histories were hand-edited.

### Staged Terminal release

The reported-price foundation can be released independently of the new Macro
owner. If that leaf is not installed, the existing writer's typed owner-unavailable
path preserves observed bars without inventing qualification. Actual reuse keeps
the prior artifact and its clocks. The consumer can show reported-price paths,
calendar decomposition and labeled descriptive measurements while withholding
qualified trend states and all forward probabilities.

This staged release still requires ordinary Terminal review, required CI, merged
source, the existing production release owner and real browser/data readback of
that installed combination. It does not make Macro's required
`reference-integrity` failures optional. The three October 18 Sector Central
migration packets reported `packet-without-rig-receipt` on both the prior PR run
and its base; matching approval evidence has not been established by this work.

The installed production preflight returned CLEAN at 2026-10-19T05:25:11Z for
incumbent Terminal `e1c66d0b137bec948e9a714b22ae81e0e72a382f`.
Its receipt ID was
`d818d7e6e31c0cca19d99e2e6a37ab77b834b7ee9731658df61679d83a809a3c`
and source-audit ID
`c7d27646226d61b38787ce9000fe3eceb3b60ef2d02a23fc222c29336d916c16`.
That is a concluded entrance check on the incumbent source, not evidence that
Returns was built, deployed or viewed in production.

### Operational meaning of the binding

One exact reference snapshot is loaded for the ordinary flagship run. Its
recorded `read_at` and hashes describe those bytes, even if Macro republishes
during the run. The double read detects a change during acquisition; it does not
prove an atomic reference generation, upstream freshness or historical availability.

Selected alias rows retain their revision metadata. Null columns are normalized;
a non-null revision value unsupported by the canonical legacy reader refuses the
reference context. The adapter must not erase that evidence to regain availability.

Browser verification requires WebCrypto in a secure context, normally HTTPS.
Missing cryptographic support keeps the history unqualified; operational readback
must verify the actual consumer over the production HTTPS origin. The server
routes' 2 MiB input bound remains independent of the codec's 30,000-row limit.

### First qualified benchmark target

The smallest prospective extension is SPY-only, through the existing reference
writer and Data OS owner. It requires current support for the existing canonical
SPY listing, retained official listing evidence, and source evidence connecting
Yahoo's actual instrument to that listing. Matching ticker spelling, requested URL,
price data or an options/native-vendor relation is insufficient.

A new explicit Yahoo current-catalog intake may publish exactly the admitted
`yahoo_fetch` relation and its existing-owner evidence, preserving ETF classification,
issuer limitations, GMI exclusion and all unrelated rows. Current intake flags
correctly forbid this different effect and must not be bypassed.

A paired direct-ETF materialization profile can resolve the actual Yahoo request
first, then verify Terminal's filed output key under a closed producer contract.
That routing check does not allocate identity and need not manufacture a Macro
`data/stocks` artifact. The existing stock profile's two-namespace requirement
remains intact. The profile must enforce its own admission evidence/cutoff:
ordinary Yahoo AliasRow clock fields do not themselves provide generic point-in-time
lookup. This is a design decision, not an admitted SPY relation or implemented profile.

Qualification requires the existing writer's exact-delta dry run, reviewed and
merged owner/consumer source, normal fresh materialization and a real compatible
stock/SPY comparison. A broader useful universe, complete group coverage, retained
observations and historical membership remain subsequent obligations.

See [review disposition](RETURNS_REVIEW_DISPOSITION_2026-10-19.md) for source-scoped
tests and decisions. The frozen losing forecast remains unchanged and unadmitted.
