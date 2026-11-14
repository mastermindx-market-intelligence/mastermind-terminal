# International → Terminal shared shell: design-first expansion
Chairman commission 14 November 2026 (America/Vancouver). Existing programme: WS:PAPER-INTERNATIONAL-WAVES, existing IM00–IM10 task tree and Macro design record #8040. This is the source plan for the new ten-destination Paper refinement, not a new runtime or lifecycle owner.

## Outcome and order
Design, verify and annotate the current International menu top-to-bottom: World Dashboard → Stock Dashboard → Global Market Cycles → Country Cycles → Thematic Baskets → Japan → South Korea → Euro Area → United Kingdom → India. Complete Paper composition and interaction/state requirements before production implementation. The parent outcome remains a native Terminal shared-shell experience consuming the canonical engines, with real responsive/authenticated/browser proof.

## Source freeze
- Procedure: Mastermind `199fd4f91ecc426b1d974eb3bf47f5162476cf24`, skillpack 1.0.1/bootstrap 1.
- Macro: `e856ef0200a0c508c78ef9a6666116020e4835d1`.
- Terminal: `43093737b9d3b682bb19859c3a6fc4cd6cae6b77`.
- Existing International Paper: `01M3P1TW5Y3XWQC37ADDS8K5AG` (Core + Global Surveillance).
- Shared shell: `01M6Y2GT8S3YP4TK052PPESZEC`, F01 `p-1-0`; Today `p-4-0`.
- Original International lineage: `01M2WGNCX9475G79JRKJTCM08P/p-C-0`; preserve original boards and frozen/uncertain targets.

## Design contract
One principal question and analytical surface per destination. Shared 224px labeled navigation / 72px compact rail / 64px top bar, canonical search/identity/theme/language/watchlist/alerts. Use the actual shell and existing theme tokens. Quiet neutral borders, no colored container rails. Make each element earn its place; no repeated explanation or internal builder copy on product frames. Keep material data limitations adjacent to affected values. Put methodology in named accessible disclosures and implementation details in Build pages.

World chooses markets; Stocks explains company leadership; Global Cycles maps relative market-state leadership; Country Cycles investigates local/FX/USD transitions; Baskets tests a cross-country theme; regional pages explain distinct local drivers. Preserve the existing 13 World workspace views and 18 Library research families through contextual entrances rather than simultaneous panels.

## Routes and canonical owners
All ten routes already exist as legacy entries in `terminal/lib/sharedShellRoutes.generated.json`; preserve IDs, aliases and entitlement tier. World `intl.html` and Global Cycles `markets.html` are different destinations.
- World/Stocks: `scripts/build_intl.py`; `engine/intl_run.py`, `intl_workspace_overview.py`, `intl_stocks.py`; stock library remains `scripts/build_intl_library.py`.
- Global/Country Cycles: `scripts/build_markets.py` projects `country_cycles.json`; `engine/country_cycles.py` reuses `sector_cycles.py` / `country_fx.py`.
- Baskets: `engine/baskets_intl.py` → `baskets_region.py`; retain membership/benchmark definitions.
- Regions: `engine/international_macro_dashboard.py`, `scripts/build_international_macro.py`, `international_macro_dashboard.v1`.
Presentation moves into Terminal via thin versioned adapters. No duplicate calculation, identity, source, state, alert, routing or history owner.

## Truth constraints
Illustrative values in Paper are design fixtures, never current quotes. Current World return basis is price, local or USD unhedged; not total return. Stock residual leadership is measured within each local market, not globally calibrated. Curated Global Cycle overlays remain distinct from calculated country states. Basket history is hindsight-curated/descriptive, not a validated backtest. JP/KR/IN dossiers have no qualified coverage; do not invent news or series. Missing is not zero, closed is not stale, revised history is not original-as-known replay. No new trading signal, probability, forecast, allocation or sizing authority.

## Ordered work and proof
1. Recover exact incumbent files/boards and shared-shell reference. Read visual doctrine and engine semantics. Save initial plan.
2. Refine World primary journey and its compare/inspector/states; inspect native screenshots.
3. Progress through the other four core destinations, each with a distinct primary analysis, useful interactions and build notes.
4. Refine five regional destinations on one shared contract with region-specific research lenses.
5. Complete responsive/theme/EN-ZH/state parity and accessible interaction destinations; verify exact native nodes and source-linked notes.
6. Only after design completion, implement through existing Terminal route/data owners; qualify real data, browser navigation, access, history, persistence and production release.
Paper edits, screenshots, implementation, CI, release and acceptance remain separate.

## Custody and effects
Only this principal writes the assigned new/refined canvas targets; reasoning children supplied UX, engine architecture and source judgment without canvas mutations. Direct work: PRINCIPAL_JUDGMENT / UNIQUE_APPROVED_ACCESS; no Fable dispatch.
M2 Paper reads returned UPSTREAM_UNAVAILABLE; its supported prepare timed out and post-read remains unavailable. No canvas mutation was sent there. M1 RDC is a separately authorized pre-effect carrier using the verified immutable v20 bridge `1a73ab...22ced`; exact International and shell reads succeeded, write schema reports compatible allowed writers. Preserve target-scoped original-carrier receipts and never retry uncertain edits.
Macro #9596 stays Draft/HOLD at `621bd44dfac13ea18671fe64c773aa8675928dd6`; publication `9533be2476ba264880c1aa067eb3af32f3d0703a794679a7818b9677f1838d15` remains EFFECT_UNKNOWN. This design branch does not replace or replay it. Preserve International History287, Comparison164 and frozen R14 boundaries.

## Current frontier
All ten menu destinations now have native desktop compositions and mobile companions in Paper (20 product frames). Desktop and mobile screenshots were visually inspected. Interaction-state design and detailed implementation contracts are in progress. No source implementation or release has occurred. MISSION_COMPLETE:false.


## Native Paper milestone — five core screens

Exact working file: [International Markets · Core + Global Surveillance](https://app.paper.design/file/01M3P1TW5Y3XWQC37ADDS8K5AG). All new pages below are disjoint successors; incumbent/frozen/uncertain nodes remain preserved.

| Order | New page | Frame | Applied and visually inspected |
|---|---|---|---|
| 01 | p-R-0 · World · Terminal shared shell | TAW-0 | Seven-market return matrix, focus inspector, currency effect, relevant next action |
| 02 | p-S-0 · Stocks · Terminal shared shell | TR6-0 | Cross-market candidate screener; country×sector rank; residual z-score; 21-session momentum |
| 03 | p-T-0 · Global cycles · Terminal shared shell | TYM-0 | Current USD price-cycle position; actual-price history; historical timing window; curated gaps separated |
| 04 | p-U-0 · Country cycles · Terminal shared shell | U79-0 | Paired local/USD phase and position; USD-only regional case |
| 05 | p-V-0 · Thematic baskets · Terminal shared shell | UG5-0 | Theme selector, benchmark-relative history, current constituent performance |

Native edit receipts were APPLIED_RESPONSE_OBSERVED on the original M1 carrier and screenshots were OBSERVED. One inherited text-color parsing issue and chart-axis spacing were corrected and re-rendered. Screenshot review proves composition only; it does not prove executable interactions, source freshness, numerical production parity, accessibility or end-user acceptance. All displayed numerical values are illustrative design fixtures, not current market observations.

### Source refinements that bind the build

- Stocks: `alpha` is a within-market winsorized cross-sectional z-score of sector-centered residual information ratio; never pp or percentage return. `sector_rank / sector_n` is country×sector rank. `rev_1m` is the sum of daily simple returns over 21 sessions, not compounded monthly price return. Canonical ticker joins supply company/sector names; canonical country config supplies the model benchmark. Formation is `eps.shift(21).rolling(252)`; latest 21 sessions excluded.
- Cycles: phases are Trough / Recovery / Expansion / Peak / Downturn. `pos_v2 = 100 × Φ(z)` measures price position relative to trend; not a turn probability, growth/inflation quadrant, valuation, all-time-high distance or empirical percentile. Legacy `pos/phase/osc` is a different range-stochastic family. Current canonical position is available; a canonical historical trajectory is not exported. Existing Global smooth interpolation is schematic. Show actual price history and confirmed turns; export a versioned canonical history before adding a trail.
- Global mapping: nine possible engine mappings (UK, Japan, Hong Kong, Canada, China, India, Taiwan, Korea, Australia) plus explicit US/Europe mapping gaps. Europe does have a VGK aggregate in Country Cycles; do not claim that Europe lacks all engine coverage. Runtime record presence is still required.
- Timing windows are historical half-cycle quartiles after enough confirmed turns, not calibrated confidence bounds. An elapsed window must stay elapsed.
- Baskets: all 17 configured themes are equal weighted. The **benchmark** `_INTLC` uses current static capitalization weights. These are distinct. Constituent performance exists; contribution-to-return and weight history do not. Membership copy says monthly rebalancing while the current level builder averages eligible member returns daily; resolve that source discrepancy before exact rebalance or attribution claims.
- Regions: inspected `data/international_macro/{JP,KR,EZ,GB,IN}_latest.json` at the pinned Macro commit. Specialist lenses frequently have no metric and say they await a verified official adapter. `history` is descriptive-state history, not arbitrary wage, export, inflation-component or bank-lending history. Current CPI is stale in JP/KR/GB/IN; IN growth, labour and policy/short-rate values are unavailable. Many policy/FX values have unknown observation dates. Do not relabel a policy/short-rate proxy as a current verified official central-bank rate.
- Regional target-state frames may illustrate the qualified-source experience, but must be named as target/illustrative and linked to explicit source-admission gates. A current-coverage fallback must remain useful and truthful. A calendar date that passed is not a verified decision outcome; a source homepage is not a numerical series or exact release receipt.

Evidence: [residual engine](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/engine/residual_alpha.py), [cycle ontology](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/engine/cycle_ontology.py), [Global mapping](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/scripts/build_markets.py), [basket membership](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/data/baskets_intl/membership.json), [basket level owner](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/engine/baskets.py), [regional owner](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/engine/international_macro_dashboard.py).

## Native Paper milestone — all ten destinations and mobile companions

| Destination | Desktop page / frame | Mobile page / frame | Primary investigation |
|---|---|---|---|
| World | p-R-0 / TAW-0 | p-11-0 / VM2-0 | Market return, currency effect, drill-through |
| Stocks | p-S-0 / TR6-0 | p-12-0 / VPI-0 | Within-market sector leaders and residual scores |
| Global cycles | p-T-0 / TYM-0 | p-13-0 / VS3-0 | Current equity price-cycle position |
| Country cycles | p-U-0 / U79-0 | p-14-0 / VV6-0 | Paired local/USD positions and unavailable legs |
| Thematic baskets | p-V-0 / UG5-0 | p-15-0 / VYP-0 | Theme comparison and constituent returns |
| Japan | p-W-0 / UNM-0 | p-16-0 / W0R-0 | Real wages, services prices, policy and rates |
| South Korea | p-X-0 / UTC-0 | p-17-0 / W2U-0 | Exports beyond chips; demand and production |
| Euro Area | p-Y-0 / V06-0 | p-18-0 / W5N-0 | Member divergence, bank lending, sovereign spread |
| United Kingdom | p-Z-0 / V82-0 | p-19-0 / W81-0 | GB regular pay, UK services prices, borrowing |
| India | p-10-0 / VDN-0 | p-1A-0 / WA4-0 | Production, non-food bank credit, inflation |

Regional frame names explicitly say target qualified-source experience / illustrative fixture. They do not assert that specialist adapters exist. Each mobile frame has its own page: native root positioning was not reliable for side-by-side artboards, so no frame depends on unverified offsets. All original pages remain preserved.

Review repairs applied with observed receipts: consistent World one-month label; USD focus label; named regional release links; Markets continuation on every regional desktop; contrast improvement for 54 metadata/axis labels plus SVG axes; dashed second series and endpoint markers on Japan/UK; consistent Japan series colors; explicit local currencies on mobile Country Cycles. The exact native batch updated 64 text nodes, followed by 12 component replacements. No unknown mutation effect in this owned wave.

### Basket basis and FX-effect rulings

Basket labels now use **Adjusted returns · FX excluded**. The collector requests auto-adjusted closes in each listing's quote currency and the basket path aggregates their returns without FX conversion. This is not a certified USD, price-only, total-return, or hedged portfolio series. History uses current members and is descriptive, not point-in-time held performance. The benchmark uses the same unconverted return matrix with static weights. Required payload additions: quote currency/unit, adjustment/source identity, basket/benchmark basis, explicit conversion:none, same-window endpoints, missing-member treatment and weighting version. [Collector](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/collectors/intl_universe.py), [regional basket calculation](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/engine/baskets_region.py), [benchmark](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/engine/baskets_intl.py).

World **FX effect** = USD return minus local return, in percentage points, over the same qualified window, including equity/currency interaction. It is not raw FX return. If FX is unavailable, local performance can remain while USD/FX cells are withheld. [Canonical record calculation](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/engine/intl_performance_records.py).

Next safe design work: four-market comparison, selected-metric inspector, current regional-coverage fallback, basket methodology, filtered stock cohort, supported cycle-history state, regional Markets continuation, light/Chinese adaptation, and native builder contracts. These are within the existing design-first assignment; implementation remains downstream.
