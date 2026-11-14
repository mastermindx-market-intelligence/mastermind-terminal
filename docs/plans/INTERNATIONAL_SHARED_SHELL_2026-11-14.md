# International → Terminal shared shell: design-first expansion
Chairman commission 14 November 2026. Existing programme: WS:PAPER-INTERNATIONAL-WAVES, existing IM00–IM10 task tree and Macro design record #8040. This is the source plan for the new ten-destination Paper refinement, not a new runtime or lifecycle owner.

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
Only this principal writes the assigned new/refined canvas targets; reasoning children supplied UX, engine architecture and source judgment without canvas mutations. Direct work: PRINCIPAL_JUDGMENT / LOWER_TOTAL_OVERHEAD; no paid Fabric execution or admission claimed.
M2 Paper reads returned UPSTREAM_UNAVAILABLE; its supported prepare timed out and post-read remains unavailable. No canvas mutation was sent there. M1 RDC is a separately authorized pre-effect carrier using the verified immutable v20 bridge `1a73ab...22ced`; exact International and shell reads succeeded, write schema reports compatible allowed writers. Preserve target-scoped original-carrier receipts and never retry uncertain edits.
Macro #9596 stays Draft/HOLD at `621bd44dfac13ea18671fe64c773aa8675928dd6`; publication `9533be2476ba264880c1aa067eb3af32f3d0703a794679a7818b9677f1838d15` remains EFFECT_UNKNOWN. This design branch does not replace or replay it. Preserve International History287, Comparison164 and frozen R14 boundaries.

## Current frontier
All ten menu destinations have native desktop and mobile compositions. The delivered wave contains 33 product frames and four builder boards, all visually inspected, with source-linked contracts below. No application implementation or production release has occurred. MISSION_COMPLETE:false.


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

Review repairs applied with observed receipts: consistent World one-month label; USD focus label; named regional release links; Markets continuation on every regional desktop; contrast improvement for 52 metadata/axis labels plus SVG axes; dashed second series and endpoint markers on Japan/UK; consistent Japan series colors; explicit local currencies on mobile Country Cycles. The exact native batch updated 64 text nodes, followed by 12 component replacements. No unknown mutation effect in this owned wave.

### Basket basis and FX-effect rulings

Basket labels now use **Adjusted returns · FX excluded**. The collector requests auto-adjusted closes in each listing's quote currency and the basket path aggregates their returns without FX conversion. This is not a certified USD, price-only, total-return, or hedged portfolio series. History uses current members and is descriptive, not point-in-time held performance. The benchmark uses the same unconverted return matrix with static weights. Required payload additions: quote currency/unit, adjustment/source identity, basket/benchmark basis, explicit conversion:none, same-window endpoints, missing-member treatment and weighting version. [Collector](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/collectors/intl_universe.py), [regional basket calculation](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/engine/baskets_region.py), [benchmark](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/engine/baskets_intl.py).

World **FX effect** = USD return minus local return, in percentage points, over the same qualified window, including equity/currency interaction. It is not raw FX return. If FX is unavailable, local performance can remain while USD/FX cells are withheld. [Canonical record calculation](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/engine/intl_performance_records.py).

The interaction/adaptation and builder-contract work listed in the earlier milestone is now delivered in the following index; implementation remains downstream.


## Design delivery — 31 product frames and four builder boards

The ordered ten-destination foundation, ten mobile companions and eleven interaction/adaptation states are now native editable Paper frames. Four builder-only boards carry the page, state, data and migration contracts. All 35 frames were visually inspected at native screenshot scale. The file now presents the ten desktop destinations in the requested order, then mobile, interaction/adaptation states, builder notes and the preserved prior work. The 25 original pages and their relative order remain intact. Five dividers separate these groups; no old frame was deleted.

### Interaction and adaptation index

All entries are in the same [International Paper file](https://app.paper.design/file/01M3P1TW5Y3XWQC37ADDS8K5AG).

| Page / frame | Designed state | Binding behavior |
|---|---|---|
| p-1B-0 / WJ1-0 | World Compare, light theme | Four removable markets, Edit markets, aligned rebased USD prices, local/FX/USD reconciliation, selected FX inspector |
| p-1C-0 / WPW-0 | India current coverage | Actual pinned snapshot availability; stale headline CPI; unavailable production/credit/growth/policy; surviving Nifty 50 market context |
| p-1D-0 / WV7-0 | Japan Markets continuation | World selection and one-month/USD basis retained; Nikkei 225; technology leaders; EWJ cycle context explicitly separate; exact Back |
| p-1E-0 / X0M-0 | Filtered Stocks cohort | Japan Technology, sector rank ≤5, five of 37 illustrative records; selected Tokyo Electron listing/model evidence |
| p-1F-0 / X9Q-0 | Cycle price-history selection | EWJ/EWT rebased actual-price concept, selected date/levels; historical cycle-position trajectory explicitly unavailable |
| p-1G-0 / XEM-0 | Basket methodology | Current members, adjusted closes, FX excluded, static-cap benchmark; contribution unavailable |
| p-1H-0 / XJW-0 | Scoped research library | Existing six groups/eighteen families; “Find the leaders”; three existing destination bindings; Workspaces entrance |
| p-1I-0 / XOA-0 | Chinese comparison, 320 × 844 | Rebased-price label, four distinct line patterns, Edit markets, compact return rows |
| p-1J-0 / XR3-0 | Chinese evidence, 320 × 844 | Full-screen currency explanation, source identities, same-window formula, return to comparison |
| p-1K-0 / XSG-0 | Japan release and revision | Observation period, publication date and same-period preliminary/revised values; revision pp; unequal chart endpoints |
| p-1L-0 / XZW-0 | World tablet, 820 × 1180 | Compact shared header, return matrix, inline Japan inspector and continuation |
| p-1M-0 / Y68-0 | BUILD 01: Page contracts | Reading order, retained depth, primary question and binding gate for every destination |
| p-1N-0 / Y8U-0 | BUILD 02: Interaction/failure states | Loading, empty filters, missing FX, stale, transport, signed-out, denied, unknown identity, compare limit; keyboard/touch/return |
| p-1O-0 / YBK-0 | BUILD 03: Source contracts | Series identity, period, lineage, semantic repairs and regional source requirements |
| p-1P-0 / YDQ-0 | BUILD 04: Migration/proof | Existing owners, thirteen-view route constraint, implementation dependency order and acceptance |

Default desktop compositions are 1440 × 1024 and mobile companions 390 × 960. These are design canvases, not a claim that the implementation has passed the canonical 1440 × 900 / 390 × 844 viewport matrix. The tablet and narrow Chinese studies exercise the explicitly named dimensions. The build must also qualify scroll/fold behavior at canonical heights and text zoom.

All numerical target examples remain illustrative. India’s current-coverage frame deliberately uses the pinned 14 October 2026 payload and labels that snapshot; it is not a current November reading. Regional target frames explicitly say target/illustrative in their native names. No executable Paper prototype connections were exposed by the inspected catalog, so these are visual interaction specifications, not a working click-through prototype.

### Final visual and semantic repairs

- World’s Japan input is **Nikkei 225**, not TOPIX. The Europe row is **STOXX Europe 600**, not Euro Stoxx 50 and not an assertion that the equity universe equals Euro Area macro geography.
- The corrected identities propagate into comparison, currency evidence, Japan continuation, Chinese and tablet surfaces. Instruments/universe must ultimately come from the payload.
- Four-market selection has explicit edit/remove affordances. A fifth selection never silently displaces a pin.
- Chinese comparison correctly says USD price rebased to 100; the return rows remain percentages.
- All five regional sidebars expand the Regions group and identify the selected destination.
- The review batch adjusted 52 metadata/axis text colors, other copy/currency labels and SVG axes; 64 text nodes were updated in that batch. Dashed second series, endpoint markers and Japan mobile color consistency reduce reliance on color.
- Each region offers a named release action and Markets continuation without adding a permanent methods banner.
- Root screenshot inspection found no clipping or overlapping content in the delivered frames. Keyboard execution, screen-reader behavior, real touch interaction, 200% zoom and cold-reader comprehension are **not yet tested**; screenshots cannot prove them.

A builder-page creation initially used an unsupported decorative icon. The original receipt reported EFFECT_UNKNOWN with an upstream schema-validation error. Same-carrier readback proved the complete 56-page list and document snapshot identical, with no target page created. The recorded disposition is SCHEMA_VALIDATION_REJECTED_NO_EFFECT; a materially corrected enum value then returned APPLIED_RESPONSE_OBSERVED. The historical receipt was retained. There is no unresolved new canvas effect in this wave. Exact-node finish was applied to these 35 owned frames only.

## Page-level interaction contracts

### World Dashboard

The first viewport answers which markets led over the selected horizon and whether currency helped or hurt. The matrix is the selection surface; the inspector explains the selected row. Compare is a deliberate state of the same investigation, capped at four markets.

Row activation opens the selected market context; pin activation changes only comparison membership and does not also navigate. The compare selection preserves order, identity and basis. Removing one market retains the remaining pins. Chart selection updates the corresponding accessible data row and evidence trigger; it does not introduce a second state owner. “Open Japan” carries the market/instrument context and returns to the exact comparison entry.

Price return is the supported basis. Local and USD unhedged can be selected only when qualified. FX effect equals USD return minus local return in percentage points, including the interaction term, over the same dates. Missing FX retains independent qualified local data while withholding USD and attribution. Closed market, older observation, stale series, absent coverage and transport failure are distinct states.

Saved views must use the incumbent Investigation/Saved interface and its current admission. The visible Save view action is a design target, not permission to invent local persistence, a second Saved store, Follow or alerts. Keep any unavailable binding explicit until its existing owner qualifies it.

### Stock Dashboard

Country and sector filters define the cohort before ranking. The first table shows company/listing identity, local sector rank, residual z-score and clearly named 21-session momentum. One selected listing opens model/source detail and the existing company destination. Search resolves canonical listing identity; identical company names or cross-listings must not collapse into one instrument.

The filtered state keeps Japan, Technology and rank ≤5 visible, displays the result count, and provides a targeted filter clear plus reset. Empty results preserve the filter context. Sorting residual scores across markets cannot be labeled a calibrated global alpha ranking. Mobile prioritizes company, rank and score; secondary measures remain in the same row detail, not a separate calculation path.

### Global Market Cycles and Country Cycles

Both consume the same canonical country-cycle projection. Global Cycles is the overview of current equity-price cycle position; Country Cycles investigates the relationship between supported local and USD legs. A local index and a USD ETF proxy may be different instruments: paired position is not a mathematical FX-return attribution.

A selected history date displays actual rebased price observations and period. The current canonical position must not be drawn as a historical trajectory until that owner exports one. Confirmed turns and historical half-cycle quartiles can be inspected with their sample count and elapsed status; they are not calibrated forecasts or probability intervals. Curated US/Europe references remain visually and semantically separate from the nine mapped engine markets. Optional hazard/narrative/DNA/series bundles load through existing owners only when supported.

### Thematic Baskets

Select a theme, inspect its adjusted-return history against the configured benchmark, then inspect current constituents. Membership, weighting, source adjustment and benchmark construction belong behind a named methodology action. A constituent row opens its canonical listing/company context with an exact return path.

“Adjusted returns · FX excluded” is a substantive basis label. Current members applied to historical prices are descriptive hindsight history. The 17 configured themes are not a guarantee that all 17 produced a qualified output; fewer than three eligible cached members can skip a basket. Constituent returns can be shown; absent contribution-to-return and weight history stay unavailable. Resolve the monthly-rebalance copy versus daily return-averaging implementation before publishing precise rebalance, contribution or held-backtest claims.

### Regional workspaces

The five regions share navigation, release evidence and Markets continuation, but each has a distinct primary investigation rather than a duplicated generic card grid.

| Region | Reading order | Advanced detail and source constraint |
|---|---|---|
| Japan | Real wages/services prices → release → policy/rates → market context | Unequal latest observation dates; same-period revisions; exact wage deflator; Nikkei vs EWJ identity |
| South Korea | Export composition/breadth → retail and production → release → market context | Exact semiconductor exclusion and taxonomy; nominal trade vs volume; production vs domestic demand |
| Euro Area | Member growth/inflation → bank lending → sovereign spread → release | Quarterly GDP/monthly HICP; official aggregate/composition; adjusted loans vs BLS net balance |
| United Kingdom | GB regular pay/UK services inflation → borrowing → rates → release | Three-month pay vs monthly inflation; CPIH real-pay convention; approvals vs lending and new vs outstanding rates |
| India | Production/non-food bank credit → inflation components → release → market context | Exact new-base histories; headline vs component identity; production vs household consumption |

A release inspector binds a single observation period before showing preliminary/revised values. Period-over-period change, same-period revision and consensus surprise are three different concepts. No verified consensus feed was established; do not display a surprise number. A past calendar event is not evidence that its outcome was acquired.

## Shared state, accessibility and responsive behavior

| State/interaction | Contract |
|---|---|
| Loading | Preserve shell, route selection and panel geometry; mark the updating region busy; never draw zeroes or artificial history |
| Empty filters | Keep filters visible; announce count; offer the smallest useful clear action |
| Missing metric/FX | Explain locally beside the affected value; keep independent qualified information |
| Stale observation | Show observation period and status; build/fetch time does not become observation time |
| Transport error | Preserve eligible same-account prior data and source timestamp; bounded user retry; no new retry service |
| Signed out | Preserve public chrome and intended return URL; use the existing sign-in owner |
| Access denied | Preserve upstream entitlement and current plan flow; no unrelated options entitlement |
| Unknown identity | Withhold private reads; do not degrade unknown into guest or reuse another account’s data |
| Drawer/dialog | Named trigger, correct dialog semantics, initial focus, Escape, close control, focus restored to the exact trigger |
| Desktop/tablet/mobile | Right evidence panel → inline tablet detail → mobile full-screen detail, preserving the same state and source |
| Charts | Keyboard-selectable evidence and accessible data table; patterns and endpoint markers; no essential hover-only content |
| Touch | Target ≥44px; row pin/remove and row navigation have distinct hit areas |
| Locale/theme | Existing presentation owner; translated strings and units; preserved selection; no second locale/token root |
| Reduced motion/zoom | Respect existing preference; no essential animation; reflow at 200%; verify 320px stress separately |
| Navigation | Cold load, reload, Back/Forward and cross-page return retain view, market, pins, horizon, basis, filters, hash, focus and scroll |
| Saved state | Reuse incumbent Investigation/Saved contract; do not persist a private view under an unknown or previous subject |

Ordinary query/hash bytes survive navigation except the bridge transport keys. No account identifier or bearer token is added to URLs. Cancellation and selection/account generation prevent late responses from rendering under a different owner. These are implementation acceptance criteria, not claims that Paper has implemented them.

## Preserve all thirteen World workspaces and the research catalogue

World’s route grammar includes `view`, `market`, `pins`, `horizon`, `basis`, `return_basis` and `group`. Reuse the incumbent state parser and preserve compatible aliases rather than starting another serialized state format.

| View | Existing owner to retain/map |
|---|---|
| overview | `engine/intl_workspace_overview.py` |
| compare | `lib/intl_compare_mount.py` |
| macro | Existing `intl_macro_mount` composition |
| risk | Existing `intl_risk_mount` composition |
| history | Existing `intl_history_mount` composition |
| library | `lib/intl_library_mount.py` and canonical catalogue |
| scanner / dislocations / transmission / dossier / scenario / replay / coverage | Corresponding `lib/intl_gs_*_view.py` owners and `lib/intl_surveillance_mount.py` |

Sources: [workspace state](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/templates/intl_workspace_state.js), [shell](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/templates/intl_workspace/shell.html.j2), [catalogue](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/config/intl_library_catalogue.json), [Library mount](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/lib/intl_library_mount.py).

The native Research tools view consumes the existing catalogue; it is not a second global All tools directory. Groups route through `/intl.html?view=library&group=<key>`, preserving other state. Catalogue data_state is unknown public metadata, not numerical qualification.

| Group | Family | Existing destination |
|---|---|---|
| Find the leaders | Performance & currency | #lb-board |
| Find the leaders | Leadership rotation | #intl-leadership-rotation |
| Find the leaders | Cross-country comparison | #intl-cross-country |
| Check the recovery | Market turns | #intl-market-turns |
| Check the recovery | Recovery quality | Unbound |
| Check the recovery | Participation & concentration | Unbound |
| Follow policy divergence | Rates, curves & carry | #intl-rates-curves |
| Follow policy divergence | Central banks & liquidity | #intl-central-banks |
| Follow policy divergence | Credit & bonds | #intl-credit-bonds |
| Understand the backdrop | Euro-area fragmentation | #intl-euro-fragmentation |
| Understand the backdrop | Growth & inflation | #intl-growth-inflation |
| Understand the backdrop | Dollar conditions | #intl-dollar-conditions |
| Trace the pressure | Structural fragility | #intl-structural-fragility |
| Trace the pressure | Contagion | #intl-contagion |
| Trace the pressure | Trade & supply links | Unbound |
| Challenge the conclusion | Cross-market correlation | #intl-cross-market-correlation |
| Challenge the conclusion | Risk-radar track record | Unbound |
| Challenge the conclusion | Country sectors & stocks | /intl_stocks.html |

An anchor is advertised only when it occurs exactly once in the actual rendered page; data-conditional absence still means unavailable. The four unbound families do not receive fake clickable destinations. The generic Stocks destination must not silently invent a country filter absent an established contract.

## Source audit: repair semantic mismatches in the existing regional owner

The five regional payloads share `international_macro_dashboard.v1`. Their `history` values are descriptive state scores, not underlying economic observations. The current specialist lens projection accepts a finite `macro[lens.metric]` and attaches intended static source metadata without proving component/instrument/period identity. This can make a numerical value look qualified for a different question.

| UI/lens intent | Actual pinned source binding | Required repair |
|---|---|---|
| EZ core/services inflation | `cpi_yoy` → all-items HICP `CP0000EZ19M086NEST` | Exact component and area composition; never re-label headline as core/services |
| GB services inflation | `cpi_yoy` → headline `CPALTT01GBM659N` | Exact services CPI series |
| IN food inflation | `cpi_yoy` → headline `INDCPIALLMINMEI` | Exact food component; the pinned 2.95% Mar 2025 is headline |
| KR headline-sounding inflation | `KORCPICORMINMEI` | Label as core or qualify a separate headline series |
| Non-EZ policy rate | `policy_rate = short_3m` | Distinguish 3M interbank proxy from central-bank policy instrument |
| JP/GB curve | 10Y government yield less 3M interbank | Label the two instruments; a scalar is not a full sovereign curve |
| IN reserves/external balance | USD/INR only | Do not imply reserves/current-account coverage |
| Regional chart history | Assessment history | Acquire/export exact numeric series and vintages before economic charts |

EZ has a separate deposit-rate field; do not erase that distinction when repairing non-EZ proxy semantics. Fix the canonical projection and qualification metadata, not only the frontend wording. Last-non-null selection also requires observation-cadence validation.

Primary source code: [regional projector](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/engine/international_macro_dashboard.py), [Macro input snapshot](https://github.com/mastermindx-market-intelligence/macro/blob/e856ef0200a0c508c78ef9a6666116020e4835d1/engine/intl_inputs.py), and country/source configuration referenced by those owners.

Pinned payload availability is a baseline, not current market data:

| Country | Observation limitations in inspected payload |
|---|---|
| JP | CPI Jun 2021; GDP Apr 2026; labour Jul 2026; 10Y Aug 2026; policy proxy/FX observation dates unknown |
| KR | Core CPI Apr 2025; GDP Apr 2026; labour Jul 2026; 10Y Aug 2026; policy proxy date unknown |
| EZ | Headline HICP Aug 2026; GDP Apr 2026; labour Aug 2026; 10Y Jan 2026; policy observation date unknown |
| GB | Headline CPI Mar 2025; GDP Apr 2026; labour May 2026; 10Y Aug 2026; policy proxy date unknown |
| IN | Headline CPI 2.95% Mar 2025; GDP/labour/policy unavailable; 10Y Jul 2026; FX date unknown |

Payload dates are 14–15 October 2026, with the inspected build on 18 October. JP/KR/IN dossiers have no qualified coverage. India’s fallback preserves the available Nifty 50 context (22,622.7, drawdown/technical context from that snapshot) without inventing specialist data or news.

## Official-source qualification for regional target designs

Extend the existing canonical producer/qualification owner with a versioned series envelope:

- Identity: publisher, dataset, exact series ID, geography/population, component, instrument/tenor and definition version.
- Measurement: unit/scale, frequency, nominal/real, base year, seasonal/calendar adjustment and deflator.
- Observation: period start/end, value or null, release status and revision/vintage identifier.
- Time: publication, ingestion and verification timestamps as separate fields.
- Lineage: exact source release/endpoint, formula and input IDs, calculation owner, rounding and qualification reference.
- Coverage: cadence, gaps, stale/unavailable reason, unknown timestamp and method/base break.
- Revisions: prior/current values for the same observation period, not sequential months.
- Fixture isolation: design fixtures never fall back into production values.

Do not interpolate monthly/quarterly releases into daily measured histories, splice base years without an official bridge, infer a five-year line from two points, or label a causal transmission without a validated model.

### Region-specific gates

**Japan.** MHLW real wages are already deflated. Preserve the exact all-items versus excluding-imputed-rent CPI deflator and avoid subtracting services CPI again. The Statistics Bureau introduced the 2025-base CPI in August 2026, so component history needs a qualified base transition. Keep policy decisions separate from provisional/final overnight call rates, and MOF constant-maturity yields separate from auction yields. [MHLW methodology](https://www.mhlw.go.jp/toukei/list/dl/maikin-kaisetsu-2025.pdf), [Statistics Bureau CPI](https://www.stat.go.jp/english/data/cpi/index.htm), [BoJ call rates](https://www.boj.or.jp/en/statistics/market/short/mutan/index.htm), [MOF interest-rate definitions](https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/qa.htm).

**South Korea.** Qualify the precise KCS/MOTIR trade classification and semiconductor exclusion; do not combine HS and industry taxonomies without a documented mapping. Exports in nominal USD do not measure volume. Working-day comparisons need explicit treatment, and breadth needs an exact denominator. Industrial production includes export production; retail is a separate domestic-demand measure. [KOSIS official economic dashboard](https://kosis.kr/visual/economyBoard/economyDash.do?lang=en). These are adapter requirements, not a claim that an official numerical endpoint has already been admitted.

**Euro Area.** Keep quarterly GDP, monthly HICP and quarterly lending-survey balances separate. Use the official aggregate/composition rather than an equal country average. HICP’s 2025 reference and ECOICOP 2 classification require explicit history/version handling. ECB adjusted bank lending is distinct from a Bank Lending Survey net balance; rates on new business and outstanding loans are also distinct. [Eurostat HICP information](https://ec.europa.eu/eurostat/web/hicp/information-data). Precise ECB series and vintages must be qualified before target charts are enabled.

**United Kingdom.** Regular-pay data cover Great Britain and commonly use a three-month basis; services CPI covers the UK and is monthly. The ONS real-pay convention uses CPIH, so a pay-minus-services chart is not official real AWE. Mortgage approvals are not completed borrowing, and new lending rates are not the stock rate. Refinancing estimates need maturity/exposure data. [ONS October 2026 AWE release](https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/bulletins/averageweeklyearningsingreatbritain/october2026), [BoE September 2026 money and credit](https://www.bankofengland.co.uk/statistics/money-and-credit/2026/september-2026).

**India.** Qualify IIP 2022–23-base and CPI 2024-base histories with official backseries. Non-food bank credit is not all private credit; IIP consumer-goods production is not national-accounts household consumption. Use the RBI’s exact published core definition, not an improvised exclusion. Inflation-component rates are not additive headline contributions. [Official CPI base-release note](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2291051&lang=1&reg=48), [official IIP base-release note](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2267531&lang=1&reg=3).

## Terminal implementation: actual seams and dependency order

The original source pin remains valid for the relevant admission seams. A bounded current-master check at **48da28456ccbd3527a255684018a123660770125** found the same blobs for `readingProxy.ts`, `sharedShellRoutes.generated.json`, `sharedShellRoutes.ts` and `SharedShellRuntime.tsx`. All ten routes remain legacy / public_shell_premium_payload. The generated catalogue’s embedded source tuple is separate from the design-review pins; preserve that distinction.

The newer [Native Macro Economy note](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/48da28456ccbd3527a255684018a123660770125/terminal/docs/NATIVE_MACRO_ECONOMY_2026-11-14.md) introduces no route/catalog/proxy admission and cites Terminal #1495/#1503 and Macro #11246/#11253 as dependencies. Their proposed plumbing is not evidence of installed capability. Reconcile those original carriers before touching overlapping integration paths.

| Responsibility | Existing owner | Build rule |
|---|---|---|
| Application shell | `terminal/app/(shell)/layout.tsx`, `components/chrome/AppShell.tsx` | Render native content inside the one shell |
| Runtime/legacy host | `SharedShellRuntime.tsx`, `LegacyPageHost.tsx` | One content owner; account-generation and entry-specific restoration |
| Identity | `lib/shared-shell/memberIdentity.ts`, `useShellIdentity`, `identityOwnerKey` | Verified immutable subject; unknown is not guest |
| Theme/locale | `SharedShellPresentation.tsx` | Existing presentation owner; no duplicate provider/token root |
| Route classification | `sharedShellRoutes.generated.json`, `sharedShellRoutes.ts` | Canonical Macro registry/export; no handwritten parallel allowlist |
| Navigation protocol | `sharedShellContracts.ts` | Disjoint native/legacy paths; safe URLs; preserve ordinary query/hash |
| Compatibility | `app/api/shared-shell/status/route.ts` | Build/protocol/registry check, not premium entitlement |
| Read gateway | `lib/shared-shell/readingProxy.ts` | Current closed resources: catalog/search/read/today; International not yet admitted |
| Projection pattern | `intelligenceResponse.ts`, `intelligencePayloads.ts` | Bounded projection after incumbent auth/acquisition; source errors and private/no-store preserved |

The World route is `macro:intl /intl.html`; Stocks `macro:intl_stocks /intl_stocks.html`; Global Cycles `macro:markets /markets.html`; Country Cycles `macro:country_cycles /country_cycles.html`; Baskets `macro:baskets_intl /baskets_intl.html`; regional IDs are `macro:japan`, `macro:south_korea`, `macro:euro_area`, `macro:united_kingdom`, `macro:india`, on their matching .html routes.

**Authentication is a binding integration choice.** The bearer-based reading proxy and existing static Macro-output cookie path have different contracts. Inspect the incumbent applicable server reader before extending its closed resource selection. Do not put a static JSON path into a bearer resource and assume authorization works. Preserve public chrome/premium payload policy; copying a whole-page member-only gate can change access policy. The live-options entitlement is not a generic International gate. No generic URL proxy, new cache, direct premium browser fetch or second authentication plane.

### Ordered implementation

1. Finish the exact page/state and thirteen-view migration disposition against the delivered Paper boards and preserved prior depth. Reconcile any changed source contracts.
2. Qualify World’s canonical producer-to-server read through the existing authenticated owner, including nulls, dates, series identity, basis and entitlement.
3. Build native World Overview/Compare/evidence and Japan Markets return inside the existing shell. Prove stale-response rejection and account state clearing.
4. Admit a distinct native entrance for an incremental slice, or complete/map all thirteen views before migrating `/intl.html`. Route classification is by pathname, not the `view` query. A half-native pathname is not a supported fallback strategy.
5. Continue Stocks, then Global/Country Cycles through one shared adapter, then Baskets with resolved semantics.
6. Render the five regional current-coverage consumers and qualify each specialist lens independently. A single missing source does not block unrelated qualified work.
7. Update the canonical Macro registry/export, regenerate Terminal’s projection, complete protected source/CI/release, then verify the deployed authenticated consumer.

### Required production proof

The first vertical journey is canonical snapshot → authorized server read → bounded World projection → Overview → four-market Compare → selected evidence → Japan Markets → Back to exact previous state.

Acceptance must show:

- Values, identities, periods, source status and null reasons match actual canonical inputs.
- Local/USD/FX arithmetic uses qualified equal windows; missing FX is not zero.
- Existing query/hash behavior survives cold load, reload and Back/Forward.
- Pin/remove/fifth-market behavior is deliberate and accessible.
- Identity states preserve the incumbent boundary; delayed account-A responses never appear under account B.
- Exactly one shell and one route content owner render.
- The installed build/registry tuple matches the admitted release.
- Dark/light, EN/ZH, desktop/tablet/mobile and narrow stress cases preserve the journey.
- Real user understanding is tested separately from screenshot review.

Block promotion if native and legacy render together, the catalogue says native without a page, source data bypasses authentication, a local stock rank becomes global, basket hindsight becomes a backtest, regional score history becomes an economic series, or green CI/fixtures are presented as real production acceptance.

## Continuation, custody and completion limits

This delivery completes the **top-level design foundation and the named interaction/adaptation wave**, not the parent production migration. Retained deep World workspaces must receive an explicit native disposition before pathname migration; source qualification and executable behavior are still open. No Next.js application code, numerical engine, source adapter, entitlement, route registry, deployment or production data was changed by this documentation/design wave.

Reuse the native boards and the exact source audit. Do not repeat the estate census, recreate the shell, invent a new research catalogue or redraw accepted screens without a material finding. Preserve Macro #9596’s Draft/HOLD and publication uncertainty, History287, Comparison164 and frozen R14. Prior review/CI/publication gates are not cleared by these designs.

Principal reasoning children supplied bounded source, architecture and UX advice; the author integrated and self-checked it. This is not a formal GitHub non-author approval. All canvas writes stayed on the original M1 bridge and were reconciled. No durable background worker, source implementation, executable prototype or production acceptance is claimed.

The next design-to-build action is to bind the existing thirteen World views to their native/retained dispositions, then qualify the World source-read and route-admission vertical slice. The user’s design-first sequencing remains in force: do not fill unqualified regional charts with Paper numbers to start implementation early.


## World control completion — 37 total native frames

After the first 35-frame plan merged in Terminal PR1531, two additional interaction designs closed specific navigation gaps. The final delivered count is **33 product frames plus four builder boards**. Both new frames were applied on the original M1 carrier, screenshot-inspected and finished by exact node ID. Paper readback now reports 62 pages (25 preserved original + 37 new) and five dividers.

| Page / frame | State | Behavior contract |
|---|---|---|
| p-1V-0 / YFV-0 | World: Edit comparison | Four selected chips, canonical market/instrument rows, search, explicit cap, clear/remove, Cancel and Apply |
| p-1W-0 / YQF-0 | World: Research workspaces | Searchable, grouped access to eleven deeper views; Overview and Compare remain direct page tabs |

### Comparison selection

The side panel is an explicit selection step from Overview or an editor from Compare. Its temporary draft selection is UI state within the existing controller, not another persisted store. Remove/clear affect the draft; Cancel, Escape or dismissal discard it and restore focus. Apply commits the validated pin set through the existing route-state owner and enters/retains Compare. Preserve market IDs, pin order, horizon and return basis.

At four selected markets, additional unchecked rows are visibly unavailable with the adjacent “Remove a market to add another” reason. No hidden replacement. Search filters the canonical available-market list without changing selected chips. The existing controller's empty-selection semantics must be retained; never fabricate default selections or data to fill an empty result. Controls have explicit 44px hit regions.

### Workspace navigation

This control exposes the retained World view grammar without putting eleven extra tabs across the page. Grouping is presentation only; it does not create another catalogue or source owner.

| Launcher item | Existing view key |
|---|---|
| Market scanner | scanner |
| Dislocations | dislocations |
| Country dossier | dossier |
| Macro & policy | macro |
| Risk | risk |
| Transmission | transmission |
| History | history |
| Scenarios | scenario |
| Replay | replay |
| Research library | library |
| Data coverage | coverage |

Overview maps to overview and Compare to compare in the visible page tabs. All thirteen view entrances now have a designed navigation disposition. This does **not** mean the eleven deep screens have all been redesigned natively or implemented. The pathname migration constraint remains unchanged.

Use existing accessible popover/search primitives. Focus the search on opening; preserve keyboard-readable groups and links; Escape/dismiss restores the Research tools trigger. Search is over these route labels, not a replacement global search index. Selecting a workspace retains compatible market/pin/horizon/basis state and uses the incumbent parser; absent data still reaches that view's explicit coverage state.

### Bounded contrast verification

Sampled source color pairs measured 6.18:1 for dark metadata (#949494 on #121212) and 5.15:1 for light metadata (#667066 on white). These exceed the normal-text 4.5:1 threshold in [W3C SC1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). The other seven sampled primary/secondary/positive/negative text pairs also exceeded that threshold. This is a palette sample, not a full accessibility audit; selected surfaces, focus, zoom, keyboard, screen reader and real interaction still need implementation proof. BUILD02 records the bounded sample.

The next design work remains substantive deep-view and full theme/language/responsive parity, followed by the already specified canonical World implementation slice. No new runtime, route, data adapter, access decision or production behavior was introduced by these two states.
