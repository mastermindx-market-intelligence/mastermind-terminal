# Other Assets — design and build guide

**Status: authored design candidate; NOT_APPLIED_TO_PAPER.** No native Paper mutations, Terminal application changes, engine changes, production deployment or live financial-data qualification are claimed by this packet.

The commission is to redesign the eight Other Assets destinations, in menu order, within the Terminal shared shell. Complete and verify the native Paper designs before production implementation. This packet advances the design, interaction and architecture work while the original Paper connection is unavailable. It does not change that sequencing.

## What is in the packet

- A self-contained interactive HTML study with eight workspaces and 29 page/view combinations. All market values, price paths, model decisions and timestamps are illustrative.
- Twenty-eight separate vector compositions: eight desktop dark, eight desktop light, eight narrow, and four consequential interaction states. These are authored SVG compositions, not screenshots of the HTML and not exports from Paper.
- Sixteen source-level behavioral checks. The checks cover 29 page/view combinations, 48 primary data states, arithmetic, historical context, source gaps, drafts and URL state. They use a minimal DOM stub. They do not prove browser rendering, real keyboard behavior, responsive HTML layout or account persistence.
- This page-specific guide; the architecture plan; the state/acceptance matrix; and the exact Paper continuation plan.

Start with `Other_Assets_Design_Studio.html`. Its bottom review bar is tooling for this study and must not be copied into production. `compositions/Other_Assets_Design_Overview.png` gives an overview of the eight primary visual directions. The SVGs preserve text and vector elements for inspection and further design work.

## Product direction

**Make the page useful before asking the user to configure it.** Each destination starts with its subject, a stated window, one concise interpretation and one dominant analytical surface. The interpretation must be derived from qualified evidence in production; the examples here illustrate hierarchy and copy length.

The eight pages share interaction rules, not identical dashboards. Crypto explains participation. Bitcoin explains its model state. Track Record reconstructs outcomes. Commodities organizes a physical complex. Strategies tests a conditional thesis. Reserves distinguishes stock from policy intent. Forex preserves the meaning of a pair. Bonds connects a curve change to an exposure.

Use neutral container borders, restrained fills, a single primary analytical blue and semantic colors only when the data requires them. A border does not become a decorative colored rail. A selected row uses a neutral fill and explicit state. Positive and negative values retain signs and words so meaning does not depend on color or locale convention.

The application shell owns identity, navigation, settings, entitlements and the shared Brain surface. The shell drawn in these studies is context for reviewing content hierarchy. The eight-destination strip is study navigation; it is not authority to introduce another production navigation owner.

### Information depth

| Layer | User purpose | Belongs here | Kept elsewhere |
|---|---|---|---|
| First glance | Know the subject and the main observation | Subject, window, concise assessment, primary canvas, one useful next action | Engine names, methodology paragraphs, release notes, decorative badges |
| Investigation | Understand an observation or compare a hypothesis | Selection, matched windows, source-aware evidence, alternatives, linked records | Unrelated feature cards and generic macro explanations |
| Evidence | Check exactly what is being shown | Source, unit, convention, observation/publication time, vintage, availability, calculation | Marketing language and unqualified confidence scores |
| Builder | Implement without changing meaning | Source contracts, existing owners, state rules, test cases, migration notes | Customer-facing page frames |

Closing an inspector returns to the selected row, chart position, filters and scroll. Desktop uses a contextual drawer. Narrow screens use a full-height sheet. Source failure preserves the usable shell and unrelated observations. A retry operates on the failed source, not a new global reload loop.

## Capability vocabulary

**Preserve** means a source-established capability or owner that the migration must retain. **Advance** means a proposed consumer/UI capability using qualified existing data. **Conditional** means the design must remain unavailable until the required data, entitlement, point-in-time history or existing write owner is proven. A drawn control is never evidence that the backend already supports it.

This distinction is especially important for futures curves, saved comparisons, historical replay, portfolio exposure and monitoring. Do not replace the source contract with an attractive invented score or generate a new collector merely because a composition has room for a chart.

---

## OA1 — Crypto Intelligence

**User question:** Where is participation moving, and what actually supports the move?

### Primary composition

The market interpretation sits above a large selected-asset comparison. Beside it, three short observations separate participation, spot/fund demand and derivatives. The market board follows the primary canvas and remains directly selectable. Its columns use defined measures: asset, return, relative performance, market state and leverage availability.

The chart title must describe what is plotted. A BTC-versus-market rebased price chart is not a participation chart. Breadth belongs in its own defined measure, with its eligible universe and coverage visible in evidence.

### Investigations

1. **Select an asset.** Update the selected series, quote, source context and continuation action together. Preserve the observation window. Asset identity travels into the existing asset evidence and shared Brain context.
2. **Inspect flows.** Show net subscriptions/redemptions with the publication window and eligible funds. Keep ETF/fund flows, exchange flows and trading volume separate; they are not interchangeable or conserved flows.
3. **Inspect leverage.** Keep funding, open interest and liquidation evidence distinguishable. A delayed input cannot be hidden behind an apparently current aggregate. Withhold or qualify the affected series while retaining price and independent fund-flow history.
4. **Compare a small selection.** Use a common start date and return convention. Limit the visible set to four series. Preserve a way to inspect excluded or insufficient-history assets rather than silently shortening one series.
5. **Explain a disagreement.** Open the exact observation that conflicts with the main read. Do not suppress it behind an overall bullish/bearish label.

### Preserve and extend

Preserve the accepted class → market board → asset evidence → Vector/model-budget → Ask Mastermind journey, including listed equities, per-source caps and insufficient-history behavior. `scripts/build_crypto.py` and the existing crypto market-state, universe, ETH and options producers remain the producers. The native consumer should adapt `crypto_cockpit.json`, `crypto_asset_states.json` and `crypto_class_state.json` rather than invent another market-state engine.

Advance synchronized selections, comparison windows, source coverage inspection and an explanation-first market board. Cross-venue microstructure, a consolidated order book or a flow network are conditional on existing qualified inputs and licensing. They are not implied by this design.

### Build and acceptance notes

- Relative performance must be mathematically defined. For comparable simple returns, use `(1 + asset_return) / (1 + benchmark_return) - 1`; a percentage-point difference is a separately named measure.
- Breadth records need numerator, denominator, eligibility rule and effective observation time. The study’s 34/50 is an illustration, not a computed production breadth statistic.
- A missing derivatives source removes the aggregate and its value-derived color; it does not produce a zero.
- The customer sees a brief source condition only when it affects interpretation. Venue lists, licensing, exclusions and calculations stay in evidence.
- Production proof: select a non-default asset, inspect its independent sources, open its accepted continuation, return, reload, and confirm the original selection/window. Preserve the November 2 accepted Crypto programme; do not reopen waves 1–4 or P0B without a new defect.

## OA2 — Bitcoin Vector

**User question:** What supports the current Bitcoin state, and what would change it?

### Primary composition

Price is the main canvas. Driver evidence is aligned beneath it so the user can relate trend, demand and leverage without three unrelated charts. Model allocation has a small explicit card. Its label says model target, and its meaning remains separate from the user’s account holdings. A concise “what changes the read” section exposes the relevant conditions.

The price view, derivatives view, cycle context and history are related investigations. In the prototype, Cycle and Derivatives are early view candidates; their complete producer-backed subpanels still need native design and data qualification. Do not infer production parity from the tab count.

### Investigations

1. **Replay an original snapshot.** Move price, model allocation, drivers, timestamps and decision context together. Display the selected historical date and a clear return-to-latest action. If historical coverage is incomplete, withhold the unsupported panel instead of retaining current values.
2. **Trace an allocation change.** Open its original version, prior/new target, inputs available at that time and the reason recorded by the owner. Later revisions remain separate.
3. **Inspect contradictory evidence.** A trend and a leverage warning may coexist. Show both; avoid turning correlated inputs into multiple independent votes.
4. **Continue to Track Record.** Preserve model identity, selected window and historical context. The chart history and record comparison must refer to the same underlying observation basis.

### Preserve and extend

`engine/btc_decision.py` and `btc.decision/v1` remain the allocation authority. Reuse `scripts/build_vector.py`, `vector_timeline.json`, the existing chart adapter and existing model/alert owners. The native view must never infer a replacement target from its displayed drivers.

Advance synchronized replay, selected-decision evidence and explicit contradiction inspection. Cycle models, forecasts and scenario controls are conditional on their accepted contracts; they do not authorize position sizing or account actions.

### Build and acceptance notes

- Valid `0%` allocation is a real value. `null`, unavailable, stale and zero need separate rendering.
- Distinguish observation time, publication time, decision time and the time that data became knowable. An old chart with current model values is not a replay.
- Historical records retain producer/version/parameter identity and the source vintage. “As known then” requires evidence of the actual historical input set, not just an earlier timestamp.
- Model-capital percentages must sum consistently with the stated cash or other allocation. Never label them as the user’s real exposure.
- Production proof includes latest → original change → historical replay → current return; zero target; missing decision; revised input; and a model version boundary.

## OA3 — Strategy Track Record

**User question:** What happened, how difficult was the path, and can I reconstruct the decisions?

### Primary composition

Four useful quantities frame the record: net model return, worst drawdown, relative result and the matched benchmark. Growth of 100 is the dominant chart. Drawdown and a selected-period control share its dates. The decision ledger is directly below the result, not hidden in a disconnected archive.

Observed, simulated and backtested records have distinct identities and headings. A result is always attached to one version, sample, benchmark and cost convention. The composition uses a simulated fixture; it does not represent an accepted backtest or live performance.

### Investigations

1. **Select a decline or recovery.** Rebase model and benchmark at the same selected start. Recalculate return and drawdown and filter the decision ledger to the same dates.
2. **Open an original decision.** Show the actual selected row’s identifier and date. Three different ledger buttons must not open one generic method explanation.
3. **Inspect costs and exposure.** Show fees, slippage, financing, roll and cash treatment where applicable. Reveal what is excluded and why. Incomplete costs withhold a comparable net headline.
4. **Compare versions.** Keep the original record immutable. Parameter experiments become separately named evaluations; no retrospective replacement of the published record.

### Preserve and extend

Preserve the Vector study shelf, existing strategy context, `vector.html#strategy-track-record` and the `btc_strategy.html` redirect. Native implementation may give the content a distinct component without breaking either entry point or changing the model’s identity.

Advance linked result-to-decision navigation, matched-period comparisons and inspectable experiment lineage. Trade execution, portfolio reconciliation or an independent performance store are not part of this design commission.

### Build and acceptance notes

- Derive narrative and color from the selected period. The full record may underperform while a selected period outperforms. The language must change with the calculation.
- Distinguish percentage return, percentage-point difference, relative compounded return and basis points.
- Drawdown uses the running peak within the stated sample. Drawdown duration, recovery time and open drawdowns must not be conflated.
- No-decision-in-window is a valid state. Show it without implying missing history or inventing an action.
- Production proof: reproduce an accepted record from its inputs, select a period that changes the relative-performance sign, inspect the corresponding ledger, and return without losing context.

## OA4 — Commodity Dashboard

**User question:** Which physical markets deserve closer research, and what evidence could explain the price move?

### Primary composition

The seventeen-market map groups six families and uses one zero and one return scale. It is readable without a rainbow heatmap. Selecting a market opens price, unit, trend and the next physical-evidence action in the adjacent panel. Narrow layout puts the map and selected investigation in sequence, with all seventeen markets still reachable.

Keep the five established tasks: Overview, Explore, Relationships, Compare and Research note. Their content should deepen the same investigation, not repeat the overview introduction above every panel.

### Investigations

1. **Explore a market.** The chart names the exact spot, contract or continuous-series convention. Price unit and currency remain attached through comparisons, exports and evidence.
2. **Test an explanation.** Follow observation → proposed mechanism → exposure. Physical stocks, production, demand and positioning keep separate release clocks. A causal arrow is a hypothesis unless the source supports it.
3. **Compare up to four markets.** Use a defined common return/window basis, with a visible way to inspect roll and currency assumptions. Preserve missing or non-comparable observations rather than replacing them.
4. **Continue to a company.** Use only identity-qualified producing/consuming exposure from the existing transmission adapter. Listing geography alone does not establish economic exposure.
5. **Keep a research condition.** Capture the explanation, metric, threshold, unit, source identity, comparison operator, window and countercase. Export/save remains inactive; monitoring activation belongs to its existing admitted workflow.

### Preserve and extend

Preserve `engine/commodity_decision_workspace.py`, the rev6 `mmx.commodities.workspace.v1` projection, `mmx.commodities.research_condition.v1`, and `commodity_workspace_adapter.py`. The workspace is a pure projection; it does not become another collector, forecaster, score, correlation engine or alert service.

Advance a common-scale market map, context-preserving evidence and more deliberate comparison/research interaction. Futures term structure, positioning, live monitoring and unsupported quotes remain conditional. The previous Paper north-star study did not establish those as supported build inputs.

### Build and acceptance notes

- Retain all seventeen instruments across six families and existing accepted view behavior. A focused first viewport is not permission to remove less prominent markets.
- Keep publisher-month changes distinct from twenty-session lookbacks. Include the actual start/end observations in evidence.
- A price in USD/lb cannot inherit a warehouse-stock unit of tonnes. Every threshold needs its own unit and source.
- A negative/zero/missing contract price must follow that instrument’s valid domain; avoid generic positive-price validation across the whole complex.
- Preserve drafts across theme, evidence and relevant navigation changes; bind them to the instrument so a Copper draft never silently becomes a Gold draft.
- Production proof: select a non-default market → explore → compare → company continuation → inactive note → return/reload. Prove isolation of account-owned notes through the incumbent owner.

## OA5 — Commodity Strategies

**User question:** Which conditions support this thesis, what invalidates it, and what does its actual evaluation show?

### Primary composition

A compact strategy shortlist selects one detailed workspace. The evaluation is the main canvas; explicit thesis conditions sit beside it. The return is marked by record type, and the model is compared with an appropriately defined underlying/benchmark. The cost/roll experiment is physically separated and labeled hypothetical.

The narrow view puts the selected strategy and record first. Conditions follow the chart, and sensitivity opens as its own task. The desktop three-column composition must not survive as three compressed columns on a phone.

### Investigations

1. **Inspect the conditions.** Each supports, contradicts or cannot currently qualify the thesis. A failed condition opens the exact observation and original evaluation.
2. **Compare models fairly.** Keep instruments, dates, parameters, rebalance rules, costs and benchmark assumptions explicit. Do not sort unlike samples into a single “best strategy” ranking.
3. **Test assumptions.** The design study provides a simple, declared cost/roll sensitivity. Production must use an existing qualified evaluator or clearly limited approximation; moving a slider must not silently rewrite the historical record.
4. **Return to market context.** Preserve the selected commodity and model. A commodity’s market state and a strategy’s thesis state may disagree.

### Preserve and extend

Preserve `scripts/build_commodity_strategies.py`, `engine/commodity_strategies.py`, `engine/active_commodity.py`, shared evaluator/detail helpers, `commodity_strategies_latest.json` and `strategy_<key>.html` continuations. Retain trend-swap and multifactor distinctions.

Advance explicit conditional theses, coherent selection and inspectable evaluation history. Financing, roll implementation, parameter experiments and saved scenarios remain subject to their existing producer/experiment contracts. Do not introduce a second backtesting engine or trade-size recommendation.

### Build and acceptance notes

- In the study, `net sensitivity = fixed base return − cost_bp/100 × 12 + roll_pp`. This is an illustrative additive calculation, not a reconstructed strategy backtest. Keep that limitation in the assumptions panel.
- The original record remains unchanged while the hypothetical result updates. A saved parameter change, if supported, gets a new experiment identity.
- Missing settlement withholds the affected result; other strategies remain inspectable. Do not substitute zero P&L.
- The selected model’s return, drawdown and curve must come from the same evaluation. Metrics cannot be copied from another model’s sample.
- Production proof: strategy selection → condition evidence → hypothetical sensitivity → original record return → detail continuation → reload, including a missing-settlement case.

## OA6 — Strategic Reserves

**User question:** How much buffer is actually available, and what changed versus what was only announced?

### Primary composition

The main instrument pairs a reported stock with its explicitly named capacity. Historical stock follows. Coverage is adjacent and requires the user to choose the denominator. An event ledger separates announced, delivered, reported and revised quantities.

A country without a qualified comparable capacity receives a stock amount and an unavailable capacity statement. It does not receive an empty tank, zero percent or a borrowed denominator from another country.

### Investigations

1. **Change coverage basis.** Net imports and consumption answer different questions. Show the actual denominator, unit and observation window in evidence.
2. **Open an event.** Bind country, event identity, date, classification and original/revised quantity. An announced purchase does not add to stored oil until the relevant stock observation records it.
3. **Inspect vintages.** Put the first published value and revision together, including publication and observation times. A correction is inspectable and does not erase the historical record.
4. **Compare country context.** Reported strategic reserves, government stocks, commercial inventories and estimates cannot be silently ranked as the same measure.

### Preserve and extend

Preserve `scripts/build_spr.py`, `engine/strategic_reserves.py` and `data/spr/latest.json` as the display/producer boundary. Advance the stock instrument, qualified coverage and event/vintage investigation. Native event and revision views remain conditional wherever the incumbent snapshot lacks those records; the synthetic study is not evidence that an event feed exists.

### Build and acceptance notes

- `coverage_days = stock / matching_daily_denominator` only when units, definitions and periods are compatible. A zero, negative or unavailable denominator yields a specific inapplicable/unavailable state, not infinity or misleading negative “days.”
- Authorized capacity, usable capacity, deliverable volume and actual stock are different measures. Do not infer one from another.
- Estimated figures retain their uncertainty and source classification. A China estimate cannot acquire a “reported” badge because the US view uses one.
- Each event selection uses that country’s record. The study includes distinct US, Japan and China fixtures to catch cross-country leakage.
- Production proof: select country → switch denominator → open event → inspect revision → return/reload, plus unavailable capacity and incompatible denominator.

## OA7 — Forex

**User question:** What is moving the pair, and how much belongs to the dollar versus the other currency?

### Primary composition

The selected pair is prominent and always states quote currency per one base unit. A compact currency comparison supports selection. Rate differential, carry and exposure stay separate from the spot result. The cross-currency matrix is a deeper comparison task, not an obligatory wall of values on arrival.

Narrow layout shows the pair and its meaning before the broader currency comparison. All inversion and matrix interactions preserve the return convention and window.

### Investigations

1. **Invert a pair.** Invert every price point, the quote, return and base-minus-quote differential. Changing the label alone is wrong. For a return `r`, the inverse return is `1/(1+r)−1`, not `−r`.
2. **Inspect a cross.** Align currencies to the same reference window. The matrix uses base in rows and quote in columns. If either leg is delayed, its cell has no current value or value-derived color.
3. **Separate carry from payoff.** Explain rate accrual, spot, funding, costs and any hedge. A forward is a dated exchange price, not a forecast.
4. **Follow economic exposure.** Use verified invoicing, revenues, costs, debt and hedges where available. A company’s listing country is not its net currency exposure.
5. **Keep a research condition.** Retain the R26 inactive save/edit/delete/reload behavior and account ownership. A draft is distinct from monitoring activation.

### Preserve and extend

Preserve `scripts/build_forex.py`, the existing `forex_*` input/signal/conviction/MTF/dollar/transmission/regime/scorecard owners, `data/forex/latest.json`, its `r26_consumer`/history and migration 0038. The native shell consumer must not create a parallel account, notes or monitoring system.

Advance pair selection, correct inversions, cross-currency inspection, source-gap containment and research context. Portfolio hedging, verified company exposure and saved comparisons are conditional on existing qualified inputs and write owners.

### Build and acceptance notes

- Spot, fixing, onshore/offshore and dated forward series must remain distinguishable. Do not merge different cutoffs into one matrix without a qualified common window.
- Very small quotes such as JPY/USD require appropriate precision; repeated `0.01` axis labels are not acceptable.
- The worked carry fixture has a 3-month rate accrual of 0.75%. For a JPY-funded USD deposit, a 2% adverse spot move gives `(1 + 0.045×0.25)×0.98 − (1 + 0.015×0.25) = −1.2725%` of the initial funding principal, displayed as −1.27% before unmodeled costs. It does not predict a realized trade return.
- Source-gap behavior must hold in the matrix, its colors, the selected pair and any drilldown. Hiding a number while a click still reveals it is insufficient.
- Production proof: pair → invert → cross → delayed leg → source → inactive note → reload; verify the same account and the original R26 monitoring boundary.

## OA8 — Bonds

**User question:** What changed in rates and credit, and through which mechanism does it affect an exposure?

### Primary composition

The yield curve is the dominant canvas. Two dates are explicitly identified. A matching basis-point change strip shows where the move occurred. A selected maturity provides context. A separate sample-exposure panel demonstrates a hypothetical shock without pretending to be the user’s portfolio.

The curve’s horizontal axis uses maturity tenors. Calendar dates belong in the series identity. Credit and transmission are deeper tasks that retain the existing R33 research depth.

### Investigations

1. **Compare two curves.** Align curve type, source, observation date and maturity convention. Preserve missing tenors and avoid silent interpolation unless the contract explicitly qualifies it.
2. **Apply a hypothetical shock.** Compare the shifted curve with the actual selected base curve. Keep observed prior-date changes separate and labeled by their dates.
3. **Inspect a sample exposure.** State position size, modified duration, convexity, shock and assumptions. Selecting a 30Y yield does not magically change the sample instrument’s duration.
4. **Inspect credit.** Separate spread pricing, market functioning and borrower/refinancing capacity. IG/HY OAS are named as such and retain their units and index definitions.
5. **Test a transmission mechanism.** Rates, inflation, term premium, funding and growth can offer competing explanations. Show alternatives and source lineage; do not count alternative decompositions as independent confirmations.

### Preserve and extend

Preserve `scripts/build_bonds.py`, the existing bonds, alerts, Fed-path, credit-cycle, Treasury-supply, international, compass and cross-asset producers, `data/bonds/latest.json` and `bond_health.json`. Preserve R33’s accepted eight-route/fifteen-family research and offline journeys; the compact overview is a reading order, not a scope reduction.

Advance curve comparison, matched changes, explicit scenario mode and exposure-aware continuation. Curve construction, term-premium estimation, pricing, portfolio exposure and new probability forecasts remain with their accepted producers or stay conditional.

### Build and acceptance notes

- Yield is a level in percent; yield change is in basis points. Price return, total return, carry and yield are separate quantities.
- Identify par versus zero/spot, nominal versus real, government versus OIS and spread conventions in evidence.
- The study’s approximation is `ΔP/P ≈ −Dmod×Δy + ½×C×Δy²`. With $10,000, modified duration 5.8, convexity 42 and a +50 bp shock, the price estimate is −$284.75. This omits carry, roll, spread changes, nonparallel shocks, path effects and instrument-specific repricing.
- The scenario’s baseline is 30 June; the observed change strip remains 23–30 June. Those are different comparisons and must look different.
- Production proof: two-date curve → maturity → evidence → scenario → observed return → credit/transmission continuation, including missing functioning data and a source revision.

---

## Implementation order after Paper completion

1. Qualify the exact native Paper target and source map. Preserve existing accepted boards and current writers. Finish each page’s primary, meaningful interaction, degraded state and narrow composition before implementation.
2. Establish one native content adapter for OA1 using the incumbent shell/data owners. Prove the authenticated journey and route compatibility.
3. Continue OA2 and OA3 as related consumers of the same model/decision records, preserving legacy anchors and redirects.
4. Migrate OA4 and OA5 through the existing commodity projection/evaluator boundaries; prove research conditions remain inactive unless the existing activation workflow qualifies them.
5. Migrate OA6, then OA7 with its account-owned R26 actions, then OA8 with its R33 continuations.
6. For each page, keep the existing route usable until the new consumer has exact-source, account, failure-state and production proof. A route wrapper, iframe, passing CI, merge or deploy is not native migration acceptance.

Use `ARCHITECTURE.md` for adapter and route boundaries and `STATE_AND_ACCEPTANCE_MATRIX.md` for the required evidence. Source references and native Paper continuation details are in `PAPER_TRANSFER_PLAN.md` and `SOURCE_MAP.md`.
