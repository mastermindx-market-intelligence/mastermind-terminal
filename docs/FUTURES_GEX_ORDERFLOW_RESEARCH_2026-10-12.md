# Futures GEX + Depth + Footprint: research and implementation frontier

Research as of 2026-10-12 UTC / 2026-10-11 Pacific. Current Chairman continuation explicitly requests deeper Pro research and implementation. This is an extension of Terminal's existing Options/Market Structure and Quote Hub owners, not another product backend or control plane.

## Decision

Build one ES/NQ microstructure workspace with two synchronized views: Depth and Footprint. Reuse the existing options source, chart-coordinate owner, quote hub, access checks, and replay/storage owners. Add only the missing futures event adapter, domain reducers, and renderer layers. Do not buy native futures-options data just to put SPX/NDX gamma on ES/NQ. Actual CME futures trades and resting order data are still required for genuine footprint and depth; converted gamma does not supply them.

The target screenshots prove desired presentation, not source licensing, forecasting accuracy, or the provider's unpublished algorithm. QuantData documents a full-depth MBO stream powering its futures views [S1]. Its published exposure guide describes ratio-based level conversion [S2]; this does not establish the exact internal implementation of the new screenshot overlay.

## Research corrections that change the build

1. **Massive cannot supply the depth map today.** Its explicit L2 FAQ says no market-depth/order-book channel; its futures page still marks depth and futures options as coming soon [S3,S4]. A futures trades/quotes subscription can support prices and some tape work, not recreate resting liquidity. Unknown aggressor side must remain unknown.
2. **ThetaData futures remains a roadmap dependency.** CME futures/options/depth is on its Q4 2026 horizon, not verified shipping from that page [S5]. Existing Theta options data remains our canonical positioning input. Neither a roadmap nor an existing subscription implies new commercial redistribution rights.
3. **Two legitimate coordinate conventions differ.** Additive mapping is K+(F-S); ratio mapping is K*F/S. Their difference is (F-S)*(K/S-1). For illustrative S=7,500, F=7,616.25 and K=7,800, they differ by 4.65 points. This is arithmetic, not an observed error estimate. Support both, label the selected method, never silently change it during replay. Use ratio in the first explicitly configured index-to-futures consumer, with additive retained for comparison and compatibility.
4. **A synchronized pair can still be stale.** The original kernel only tested quote-to-quote skew. Both quotes can be old, or today's futures can be compared with yesterday's cash close. Absolute age and publication availability now need separate checks. Overnight cash-closed behavior must be last-valid/frozen with age disclosure, a separately specified forward estimate, or unavailable; never recompute an apparently live basis against frozen cash.
5. **MBO trades and fills are not book decrements.** Databento defines T/F as non-book-mutating records; cancellations/modifications carry the book changes. Trade-side B is buyer aggressor, while fill-side B means the passive bid. Using both as buys or subtracting fills and cancellations doubles counts activity [S6,S7].
6. **Snapshot and event completion matter.** Publish only complete instrument events; snapshots need their generated availability, not the old entry times of their constituent orders. Top-of-book/MBP flags must not be mistaken for individual orders, and an unrecoverable feed gap must darken the book pending resynchronization [S6,S8].

## The coordinate contract

`terminal/lib/futuresGexProjection.ts` remains pure math. It now supports explicit basis/ratio selection, quarterly ES/NQ symbol syntax, safe integer clocks, runtime type checks, duplicate-strike rejection, unchanged signed exposure, and separate unrounded coordinates/tick-rounded labels. Syntax is not a verified contract definition.

`terminal/lib/futuresGexFrame.ts` consumes the EXISTING `options_hub.gex/v1` payload. `by_strike[].gamma_net` is already USD millions; matrix cells are not interchangeable. The frame requires a verified source-publication receipt, a named contract definition/validity interval, both quote availability times, a decision/replay timestamp, and explicit freshness policy. Missing, future, stale, wrong-root, wrong-session or all-unknown data is refused with a typed reason. Genuine zero remains zero. Existing `coverage.oi_date` is preserved; it is not manufactured when absent. This first adapter exposes ALL expiries only; it does not falsely claim 0DTE filtering.

These are caller-supplied, already-verified receipts. The pure adapter does not authenticate them or cryptographically bind arbitrary input to an artifact ID. The source-serving owner must perform that verification. A date-only `asof`, a successful HTTP response, or a new local timestamp is not evidence that old data was available at a historical trading decision.

**Exposure meaning stays explicit:** the amplitude is USD millions of source-index delta-notional change per +1% index move under a positioning estimate. Moving its y coordinate onto ES/NQ does not turn it into native futures-options gamma, guaranteed dealer holdings, option P&L, or an executed futures order. Do not multiply the GEX bar by the futures contract multiplier merely to convert coordinates.

## Event architecture and source boundaries

The existing Quote Hub owns live futures ingestion/fan-out; existing historical/archive owners retain immutable market events and materialized views. There is no new stream broker, user permission model, scheduler, alert engine or storage registry in this work.

Keep raw UTC nanoseconds, exact uint64 order IDs and fixed-point price units lossless in the ingest boundary (decimal strings/BigInt, not JS floating-point identifiers). Bind instrument identity to publisher, source session and named contract definition; vendor instrument IDs alone need not identify one contract forever [S6,S9]. Normalize trade records once and derive footprint, tape, CVD and executed-volume profile from that same population. Never synthesize a bid/ask footprint by splitting OHLC volume.

The depth path reconstructs the actual order state. A heatmap tile needs an explicit time reduction (time-weighted mean resting size for the primary layer; optional maximum/persistence views), covered price range and quality mask. Dropping outside top-10 coverage means unknown, not cancelled or zero. Aggregated depth and full MBO are separate advertised capabilities.

A single timeline joins positioning snapshot, contract mapping, trades and book state using the same decision/availability cutoff. Existing Terminal intraday code has a legacy display-epoch convention; the prior integration design warns that feeding true UTC into that path untagged corrupts session logic [I4]. Keep true UTC in the new event data and transform only at the known rendering seam. Do not migrate every historical bar consumer as an incidental prerequisite.

### Required footprint behavior

Volume cells contain buyer-aggressed, seller-aggressed and unknown-side executed contracts separately. Total volume must reconcile to their sum. Known-side delta is buy minus sell; full delta/CVD cannot claim completeness with unclassified volume. Diagonal imbalance uses opposite sides at adjacent price levels and an explicit ratio/minimum-volume policy. A missing comparison cell is not an infinite imbalance. POC tie-breaking is deterministic and disclosed. Session reset, interval and price aggregation are explicit.

Trade correction/cancel revisions, cross-feed duplicates, late availability and session boundaries must be resolved by the canonical event owner before accepted aggregates are published. No silent deletion of contradictory data. Absorption/replenishment/sweeps are candidate descriptors over observations, not proof of intent, iceberg size, spoofing or future reversal.

### Required depth behavior

Start from a valid complete snapshot; apply changes in source order; expose only completed events. Keep full contract identity across rolls. Missing sequence/continuity, malformed updates, unsupported flags, negative residual size and impossible order references cannot leave a green live label. A recovered snapshot repairs future book state, not historical gaps. MBO snapshot records are not historical executions.

## Product shape

Inside Terminal's existing Chart workflow, add a Market Microstructure workspace mode with Depth / Footprint and a shared instrument, interval, session and replay cursor. Keep the existing options Exposure workspace as the detailed source inspector, not a second GEX calculator.

The chart layers must remain independently legible: resting liquidity heat, candles, executed-trade markers, modeled GEX strike-time bubbles, price-axis GEX bars, and session volume profile. Trade bubble size is contracts executed; GEX bubble size is modeled exposure. Distinguish them in shape/legend/tooltips rather than letting the same visual imply the same measure. The GEX sidebar uses a fixed or explicitly rolling scale, never a hidden future-session maximum.

Each selected level opens a compact inspector: original index strike, mapped futures coordinate, method and quote timestamps, exposure and inventory timestamps, expiry scope, contract definition, source coverage and any gap. Phones use one chart view at a time and a bottom inspector, not a desktop-wide forced canvas. Chart workers/typed arrays/tiled rendering are implementation options; frame-time and memory measurements choose the renderer. Reuse the existing coordinate/pan/zoom owner, and avoid touching the active chart-linked options heatmap PR #723 without reconciling its actual writer.

## Data procurement: scoped gate, not a stop on all coding

Databento MBO is the leading documented technical candidate, not an approved purchase. Its Standard listing is $199/month; Plus is $1,750/month on an annual contract and lists external distribution, with license fees separately. Both list only one month of included L2/L3 history; longer raw depth is not implied by the much longer L1 history [S10]. Retail and internal-use fees are not our all-in commercial price.

Obtain a written ES/NQ-only quote specifying CME venue, full-depth real-time MBO, historical sample/replay rights, internal non-display computation, external authenticated display, subscriber declarations/reporting, derived GEX overlays, retention, territories and disaster-recovery replicas. Do not blindly sum illustrative provider/exchange/subscriber fee tables into a firm quote. CME's current agreement center has revised 2026 schedules; old August research is not current legal clearance [S11]. Do not purchase, claim a fee waiver, relay user data to sales, or activate external data on the strength of this report.

Until that gate is met, source parsing, deterministic reducers, integration tests and clearly labeled synthetic development rendering can advance. None is live market-data proof.

## Ordered acceptance path

1. Source consumer: verified publication receipts, per-feed clocks and named-contract definitions connected to the tested GEX frame. No future data in replay; no unchanged cash-close masquerading as a fresh basis.
2. Futures event canary: one lawfully obtained ES/NQ sample; exact raw-event conservation and source BBO agreement; documented flags and gap/correction cases.
3. Footprint vertical: same trade population feeds cells, candles, tape, volume profile and CVD; unknown side is visible; absent feed has an honest unavailable state.
4. Depth vertical: full-book reconstruction and quality-masked tiles; snapshot recovery and synthetic-gap tests; no double count of T/F/C.
5. Shared UI/replay: identical GEX coordinates in both views, cold-load and instrument switch isolation, expired-contract handling, cache invalidation, DST/holiday/overnight boundaries, EN/zh and all three responsive viewports.
6. Release: independent review, exact-head CI, normal git-gated deployment, incognito browser proof and measured live freshness/lag on the licensed feed. Only then call the capability PROVEN_LIVE.

There is no calibrated directional edge claim yet. Later hypotheses need a chronological held-out/prospective comparison against price/volume-only and gamma-only baselines, execution costs, session/volatility conditioning and confidence intervals. The initial UI displays measurements and explicitly modeled positioning, not automated trade sizing or unvalidated alerts.

## Evidence and continuation

Procedural pin retained: Mastermind 85807cf48e29e2fe5df19534d6b181fc25b9746f (skillpack 1.0.1). Attended mode: Pro, user-reported. This phase retained directly because source/quantitative boundary decisions and implementation are coupled; no worker dispatch or background wake is claimed.

Carrier: original RDC M2 Studio worktree and branch `claude/futures-gex-projection-20261011`; Terminal PR #964. Original head 615f8ae56009e494178c211187a9bee7af79f3a9 is a source-only kernel, not a delivered chart. New GEX/frame tests: 56/56 REAL Vitest cases passed on M2 (including a deterministic 1,000-case loop under both mappings); full Terminal `tsc --noEmit` exited 0. Local Node runner also passed the same assertions; it is not counted as a second independent validation. Fixtures are synthetic. No live futures feed, purchase, UI integration, production change, or independent review has occurred in this phase.

Next action: extend the existing hub's source-event domain code and executable conformance tests, then connect one jointly-timed development consumer. Release and live-feed gates remain explicit. This document is the cumulative research/implementation checkpoint, not a new execution queue. Update its frontier when the next coherent result is verified.

## Source register

All public sources below were inspected through official pages in this research pass. Publisher claims remain claims; no authenticated QuantData runtime teardown or vendor negotiation was performed.

- S1 QuantData Futures: https://quantdata.us/futures (MBO, depth/footprint feature descriptions; retail product, not redistribution quote).
- S2 QuantData exposure/conversion guide: https://help.quantdata.us/en/articles/16936089-mastering-the-exposure-forecast-pin-grind-and-volatile-market-states (documented ratio mapping, not source-code proof of the screenshot).
- S3 Massive L2 FAQ: https://massive.com/knowledge-base/article/does-massive-offer-level-2-data (explicitly unavailable).
- S4 Massive Futures: https://massive.com/futures (depth/futures options coming soon).
- S5 ThetaData roadmap: https://www.thetadata.net/roadmap (Q4 2026 horizon, not observed release).
- S6 Databento fields/actions/flags: https://databento.com/docs/standards-and-conventions/common-fields-enums-types (Side, Action, Flags, timestamps, prices, instrument identity).
- S7 Databento order tracking: https://databento.com/docs/examples/order-book/order-tracking (event-boundary and update semantics; implementation here is original).
- S8 Databento snapshots: https://databento.com/docs/standards-and-conventions/mbo-snapshot (generated snapshot clocks and reset semantics).
- S9 Databento MBO schema: https://databento.com/docs/schemas-and-data-formats/mbo (lossless identifiers/price/timestamp fields).
- S10 Databento pricing: https://databento.com/pricing (tier, history, distribution and additional fee qualifiers).
- S11 CME agreement center: https://www.cmegroup.com/market-data/license-data/market-data-policy-education-center.html (2026 agreement/schedule revisions).
- S12 CME equity index basis: https://www.cmegroup.com/education/courses/introduction-to-equity-index-products/what-is-equity-index-basis (basis definition/carry).
- S13 CME fair value: https://www.cmegroup.com/trading/equity-index/fairvalue.html (theoretical versus actual futures prices).
- I1 Terminal original kernel: 615f8ae56009e494178c211187a9bee7af79f3a9, `terminal/lib/futuresGexProjection.ts`.
- I2 Terminal base: e0c405a09b6897df3b5e4a2f22344f3560b800a4, `terminal/lib/gexLadder.ts`, `terminal/lib/optionsLevels.ts`, `terminal/lib/flowClientCache.ts`, `hub/`.
- I3 Macro 1338e106c6303a62ed14ca8432d3b4a1291007fc, `engine/options_hub.py`, `agentos/workstreams/WS-ADVANCED-DATA-OPTIONS.md` (source units/cadence and canonical ThetaData ruling; organizational record is not current host-liveness proof).
- I4 Terminal base as I2, `docs/DATABENTO_INTEGRATION_DESIGN.md` (design-only UTC/display-epoch integration warning; not a shipping feed).
