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

The existing Quote Hub is the intended owner for the new live futures adapter/fan-out; existing historical/archive owners retain immutable market events and materialized views. There is no new stream broker, user permission model, scheduler, alert engine or storage registry in this work.

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

The original source-only checkpoint was pushed as `a67b530a9e626687678c8f7050b88cbf7297ff13`. The continuation below supersedes that checkpoint's UI/next-action statements; it does not supersede the live-feed, rights, source-receipt or release gates.

### Pro continuation: implemented domain engine and development consumer

The additional implementation is inside the existing repositories and owners:

- `hub/lib/futuresMbo.js`: atomic complete-event book updates, lossless order identifiers/timestamps, correct trade/passive-fill/cancel separation, bounded capacity, idempotent current-cursor handling, gap refusal and snapshot recovery. `aggregateFootprint` derives observed buy/sell/unknown volume, candles, known-side delta, window-based CVD, diagonal imbalances and volume profile. `buildLiquidityTiles` derives time-weighted depth with explicit missing/stale coverage. These are pure domain reducers, not a licensed feed connection.
- `hub/tests/futuresMbo.test.js`: 64 new executable conformance/invariant tests, including 10,000 generated trade conservation, late corrections, unsupported flags, incomplete events, snapshot/live-tail behavior, crossed non-trading state, and missing versus zero depth. The complete Quote Hub suite passed **452/452** tests, including these 64.
- `hub/tools/build_futures_lab_fixture.js`: reproducible synthetic inputs run through those actual reducers, producing 192 executions, 4,203 observed contracts and 24 minutes of footprint/depth data. The generated JSON is 158,191 bytes, SHA-256 `31e5b7d2135a786a2c87e62755bfe73a9969560603495aa2c8c7ed3b9c9bcfff`. No vendor dataset or live price history is hidden in this fixture.
- `/dev/futures` in the actual Terminal application: Depth / Footprint modes, mapped GEX bubbles and price-axis bars, executed-volume profile, quote/source inspector, basis/ratio switch, replay cutoff, zoom, EN/zh labels, and deliberately selectable stale-publication/quote/feed-gap scenarios. Only bars available at the replay cutoff contribute to the volume profile. The synthetic development warning is permanent. The production route refuses before importing the laboratory component, covered by an additional unit test.

The gamma/frame suite is 56 tests; the production-boundary test brings the focused Terminal unit run to **57/57**. Browser acceptance covers 9 cases across 1440x900, 820x1180 and 390x844, both languages, mapped-level parity across modes, replay and exposure switches, missing-source states, touch geometry, page/console errors and zero document overflow. The first browser attempt caught React SVG-title hydration mismatches; these were fixed, not worked around by reload. Screenshots and final source hashes belong in `docs/pr-crops/futures-lab-20261012/`; the verification manifest binds the exact final files rather than relying on this prose. Production browser behavior has NOT been verified.

### Venue-specific findings that changed the implementation

The CME supplement [S14] confirms three non-obvious distinctions. `F_LAST` can be carried by a no-op record; some snapshot endings need the following live event before a valid complete book is visible. The reducer accepts a contiguous snapshot prefix followed by live records, but never a return into snapshot state midway through the batch. A locked or crossed book can be legitimate in a non-trading period; the view requires an explicit non-trading state to disclose that condition rather than labeling it executable. Finally, MBO covers displayed outright orders, while implied liquidity is a distinct book. The output says `displayed_orders_excludes_implied`; do not compare it against a combined real-plus-implied quote and call any difference corruption.

Exact raw DBN decoding/SDK normalization, event-batch assembly, source sequence/gap verification, session/status/contract-definition ingestion, trade correction adjudication, source receipt authentication and live subscription management remain outside these reducers and unimplemented in this PR. Publisher-specific flags are refused until their meaning is confirmed on the chosen data lane. This is not a generic all-products CME decoder. The official open-source DBN repository has tiny codec fixtures [S15], but its MBO fixture is only 465 bytes; codec examples cannot establish a full-session order-book or commercial display right.

### Performance finding, not a live-capacity claim

A single synthetic local run on Node v26.5.0/macOS arm64, with 10,000 resting orders, measured 10,000 one-order modifications in 329.64ms (about 30,336/s), and 100 full aggregated book views in 1,468.32ms (14.68ms mean per view). The initial synthetic snapshot took 103.42ms. The heap delta was 34.27MB but includes garbage-collection timing/temporary allocations and is not a steady-state estimate. The exact result is `kernel-benchmark.json`, reproducible with `node hub/tools/bench_futures_mbo.js`.

This excludes network, SDK decoding, event recording, actual market bursts, user fan-out and browser drawing. It supports a narrow implementation choice: ingest all valid events, but build/fan out display views at a bounded cadence rather than rebuilding the full price ladder for every order modification. Actual ES/NQ peak-load, reconnect, long-session memory and mobile frame-time tests remain necessary before choosing production worker capacity. Do not advertise these synthetic throughput figures as achieved exchange latency.

### Actual remaining critical path

Next: establish a lawfully usable ES/NQ full-depth sample and the exact source entitlement/receipt/definition path. Connect the official SDK-decoded event stream to the existing Quote Hub and compare the reconstructed DISPLAYED book with the matching source book; conserve trades through footprint, tape and profiles, then connect current options/quote receipts to the same replay clock. Confirm independent code review and exact-head CI before merge; activate only through the existing deployment owner after source and commercial display/retention rights are established.

This pass has not bought data, contacted vendors, launched a background worker/watch, merged the PR or deployed to production. It has not completed production chart-shell integration, NQ browser proof, 0DTE filtering, generalized price/time aggregation, historical feed corrections, calibrated absorption/sweep alerts, or prospective predictive validation. The live-data gate is not permission to invent those capabilities or call a synthetic chart finished. All completed source/evidence remains on PR #964, with no duplicate Agent OS or runtime store.


## Resume continuation: official SDK and source adapter

This subsection supersedes the earlier statement that raw decoding and source-event
assembly are unimplemented. On the existing PR/carrier, the official native DBN
decoder is now connected through `hub/tools/normalize_futures_dbn.py` and
`hub/tools/replay_futures_source.js` to `hub/lib/futuresSource.js` and the existing
book/footprint reducers. It supports source-integrity hashes, bounded streaming,
lossless fields, atomic new-output publication, explicit retrospective availability,
per-instrument complete-event assembly, gap/sequence handling, definition validity
and venue-status selection. It does not own sockets, storage, security master,
receipt authentication or subscriber entitlements.

Verification: 498/498 full Hub tests (46 new source cases) and 15/15 SDK tests.
Evidence: `docs/evidence/futures-source-20261012/`. Official upstream codec assets
are pinned/licensed/hashes retained in `hub/tests/fixtures/databento-dbn/`.
Their two ESH1 cancellations have no snapshot; the real canary correctly refuses
to claim depth. Separate synthetic native-DBN tests connect decoder to book/trades
and preserve a historical availability cutoff. A full-session reference comparison
remains open. No purchase, live subscription, merge, deployment, or independent
review is claimed. The existing Quote Hub CI job now runs the SDK tests.

Next safe phase: NQ browser coverage, explicit source-session expiry lenses and
price/time aggregation, while authentic feed/receipt and release requirements stay
unchanged. The unavailability of a full licensed sample does not block these
independent source/consumer improvements. Reuse this original PR and worktree.

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
- S14 Databento CME venue supplement: https://databento.com/docs/venues-and-datasets/glbx-mdp3 (complete events, passive fills, generated snapshots, implied liquidity and non-trading crossed books).
- S15 Databento official DBN codec source/test fixtures: https://github.com/databento/dbn (software/codec examples, not a new market-data entitlement).
- S13 CME fair value: https://www.cmegroup.com/trading/equity-index/fairvalue.html (theoretical versus actual futures prices).
- I1 Terminal original kernel: 615f8ae56009e494178c211187a9bee7af79f3a9, `terminal/lib/futuresGexProjection.ts`.
- I2 Terminal base: e0c405a09b6897df3b5e4a2f22344f3560b800a4, `terminal/lib/gexLadder.ts`, `terminal/lib/optionsLevels.ts`, `terminal/lib/flowClientCache.ts`, `hub/`.
- I3 Macro 1338e106c6303a62ed14ca8432d3b4a1291007fc, `engine/options_hub.py`, `agentos/workstreams/WS-ADVANCED-DATA-OPTIONS.md` (source units/cadence and canonical ThetaData ruling; organizational record is not current host-liveness proof).
- I4 Terminal base as I2, `docs/DATABENTO_INTEGRATION_DESIGN.md` (design-only UTC/display-epoch integration warning; not a shipping feed).
