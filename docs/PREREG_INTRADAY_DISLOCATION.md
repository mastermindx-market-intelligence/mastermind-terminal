# PREREG — Intraday Dislocation + Reclaim R0 (2026-10-02)

This document freezes the first research implementation before any outcome sweep.
R0 is a **shadow research lane**. It may describe abnormal downside events; it may not
emit scored BUY/SELL authority, alter Prophet or portfolio decisions, size positions,
or drive production execution.

## 1. Mission and ownership

The research question is whether point-in-time abnormal downside dislocations followed
by explicit exhaustion/reclaim evidence improve entry basis and reduce immediate adverse
excursion enough to compensate for missed-move and execution costs.

Ownership stays with existing systems and the already-approved Terminal Tactical Intelligence (#598) boundary:

- Macro `WS:LIVE-ENTRY-RADAR` remains the tactical 5-minute entry-event/evaluator owner.
- Macro `WS:TECHNICAL-OPPORTUNITY-INTELLIGENCE` remains the setup/trigger/path/remaining-opportunity owner.
- Setup Species and Evaluation OS remain the scientific registration/evaluation owners.
- Terminal owns the product consumer, intraday presentation, and source-provenance surfaces.
- Mastermind/Prophet owns thesis quality, portfolio desirability, and portfolio constraints.
- This Terminal preregistration freezes the dislocation/reclaim product-research contract; it does not create a second detector runtime, radar, replay store, or market-data owner.
- No second quote daemon, data store, scheduler, retry plane, event ledger, or execution plane is created.

The product is deliberately not an "oversold = buy" scanner. It also does **not** mint
a second runtime lifecycle. Macro Live Entry Radar already owns tactical lifecycle/event
semantics, and pending TTI R1-B v4 already owns the causal fresh-low -> exhaustion/reclaim
construction. Terminal may project plain-language presentation labels such as
`DISLOCATED`, `EXHAUSTING`, `RECLAIM_CONFIRMED`, `BLOCKED`, `INVALIDATED`, and
`EXPIRED` from accepted owner evidence, but those labels are a UI projection, not a
parallel state machine or event store.

## 2. Point-in-time and data-admission law

All research must preserve what was knowable at the decision timestamp.

- `detected_at` = first completed observation where the shock rule became knowable.
- `anchor_at` = observed event-low/shock anchor; it may occur after detection.
- `confirmed_at` = first completed observation where reclaim confirmation became knowable.
- `entry_eligible_at >= confirmed_at`; replay may never fill at the eventual event low.
- Current-session observations may not enter their own historical baseline.
- Beta/factor parameters used intraday must have an `asof` before the session being tested.
- Missing, malformed, stale, partial, delayed, or unverified data is not an empty/healthy result.

Existing Terminal source evidence is descriptive only. The canonical qualification path is
the already-built `ingest/intraday_qualification.py` plus
`scripts/qualify_intraday_research.py`; this program reuses that owner rather than
building another qualifier. Before historical results are promoted beyond exploratory replay,
the actual 5-minute store must be inventoried for symbol count, first/last bar, missing
sessions, point-in-time universe coverage, instrument identity, corporate-action adjustment,
source hashes, and historical availability receipts.

Historical 1-minute performance is **NOT** inferred by interpolating 5-minute bars.
R0 historical replay starts at genuine stored 5-minute resolution. True 1-minute research
waits for durable 1-minute history or a licensed historical source.

## 3. Frozen owner-reuse and dislocation-context law

R0 does **not** create a new residual-shock entry trigger.

Current Macro law already killed two tempting shortcuts that the deep-research design must
explicitly confront rather than rediscover:

- `DNR:KILL-PSS-F3-RESIDUAL`: beta/sector-stripped residual reset failed as a standalone
  entry-timing construction. Residualization may describe *where* a move lived; it may not
  become a timer, gate, or ranker without a separately registered falsifier that overturns
  that kill.
- `DNR:KILL-LIQUIDITY-SHOCK-REVERSAL-CLASSIFIER`: the prior 1–5 day no-news shock-reversal
  classifier did not earn promotion. The existing DRL therefore publishes residual shock and
  recovery as display/context with all authority false.

Accordingly, R0 reuses the existing owners instead of adding a third shock engine:

1. **Tactical candidate/turn:** consume accepted Live Entry Radar / TTI causal price evidence.
   Pending R1-B v4 already preregisters fresh-low displacement, forming exhaustion,
   continuation invalidation, causal reclaim, processing latency, matched controls and honest
   confirmation clocks. R0 may not copy it into Terminal or silently change its frozen cells.
2. **Residual dislocation descriptor:** when needed, read the existing DRL
   (`engine/price_pressure/`) or other named incumbent residual owner and preserve its basis.
   Residual magnitude is descriptive/cohort context only in this program.
3. **VWAP/RVOL/MTF context:** may be shown as inspectable evidence where the incumbent producer
   supplies it with a lawful clock. It is not permitted to rescue a failed price construction
   post hoc or become a hidden composite score.
4. **Market/sector relationship:** raw market and sector state may be displayed and used in a
   separately preregistered interaction study. R0 does not invent a new market/sector residual
   engine or treat co-movement as economic cause.

Any future same-time-of-day robust residual study must be its own registered experiment,
must preserve prior-only estimation and finite-sample honesty, and must confront the killed
residual-timing construction by name before it is allowed to influence eligibility, sorting,
alerts, or promotion. Until then there is no `Z_idio` gate in this product contract.

## 4. Catalyst and market-data safety gates

The catalyst contract has two independent axes:

- coverage: `HEALTHY | DEGRADED | OUTAGE`
- status: `MATERIAL_EVENT | SOFT_EVENT | NONE_OBSERVED | UNKNOWN`

Invariant: coverage other than HEALTHY forces effective catalyst status to `UNKNOWN`.
An outage can never be interpreted as "no news".

Initial treatment:

- `MATERIAL_EVENT`: block normal mean-reversion promotion.
- `UNKNOWN`: block normal mean-reversion promotion.
- halt/LULD: block and require a fresh post-resumption episode.
- `SOFT_EVENT`: may remain a shadow candidate but must be analyzed as its own cohort.
- `NONE_OBSERVED`: means no material direct event observed in covered healthy sources;
  it does not claim that the world contains no information.

Market-data basis is also explicit: `REALTIME | DELAYED_15M | STALE | EOD | UNKNOWN`.
A non-REALTIME or stale observation may be displayed/replayed but is never `eligible_live`.
R0 itself never executes, so `eligible_live` is only a provenance/safety field for later
integration testing.

## 5. Exhaustion and reclaim owner mapping

Terminal does not implement another exhaustion/reclaim grammar. The current scientific owner
is the Live Entry Radar / TTI R1-B construction.

For product integration, presentation labels map to owner evidence as follows:

- `DISLOCATED`: an admitted owner-side tactical candidate exists; this means "look", never
  "buy".
- `EXHAUSTING`: owner evidence shows the preregistered forming-exhaustion condition; this
  remains unconfirmed.
- `RECLAIM_CONFIRMED`: the owner-side causal reclaim/confirmation clock has fired with its
  processing latency preserved. Terminal may never move this label back to the candidate low.
- `INVALIDATED`: continuation/downside invalidation won the owner-side race.
- `BLOCKED`: catalyst, halt/LULD, source freshness, basis, entitlement, or other admission
  evidence refuses promotion even if price structure looks attractive.
- `EXPIRED`: the owner-side candidate window expired without a lawful confirmation.

MTF momentum, VWAP, RSI/MACD/Pulse, divergence, CVD proxies and similar studies remain
secondary evidence. They may explain or stratify an owner event, but none may independently
advance a Terminal lifecycle because Terminal owns no such lifecycle.

The existing R1-B construction remains frozen on its own carrier. This R0 does not amend its
fresh-low geometry, confirmation race, latency, control law or promotion gate. Any requested
change to that construction is a new scientific registration, not a product implementation
shortcut.

## 6. Scientific evaluation — reuse, never fork

R0 creates **no new replay/event ledger**. Setup Species / Evaluation OS and the existing
`entry_radar` TrialLedger remain the scientific accounting owners. One price episode must not
be copied into a second Terminal outcome ledger.

The incumbent R1-B preregistration already defines causal candidate/confirmation clocks,
matched controls, execution-latency treatment, MFE/MAE-style path diagnostics and a complete
negative/empty/censored denominator. R0 consumes those results if and when that study is
accepted; it does not rerun or reinterpret the frozen R1-B cells inside Terminal.

This project's genuinely new empirical questions are additive and must be separately
registered before outcomes are opened, for example:

- whether a **source-grounded catalyst safety overlay** reduces post-confirmation adverse
  selection versus the same accepted reclaim events;
- whether Mastermind-approved "My Dislocations" has different timing utility from broad-market
  discovery without changing the underlying detector;
- whether VWAP/RVOL/MTF or market/sector descriptors add incremental information after the
  price-first owner event, rather than merely restating it;
- whether waiting for accepted reclaim evidence improves entry basis/MAE versus an existing
  point-in-time Mastermind entry baseline.

Where a legitimate point-in-time baseline exists, the decision utility remains:

`TimingBenefit = PriceImprovement - MissedMoveCost - AdverseSelectionCost - ExecutionCost`

No claim of improved safety or profitability is allowed without net-of-cost evidence. No
historical availability receipt may be invented from corrected static bars, and no catalyst
timestamp may be backfilled as if it were known live. Same-day correlated events are evaluated
with clustered/date-aware uncertainty; thresholds are not retuned on the final/forward period.

## 7. Promotion law

R0 outputs remain explicitly non-authoritative. A UI or downstream adapter built on R0 must
preserve `scored:false` / shadow semantics until a separate promotion decision is evidenced.

Promotion requires at minimum:

- deterministic replay and point-in-time tests green;
- adequate sample size in the intended liquid-universe cohorts;
- positive net TimingBenefit after realistic costs on untouched evidence;
- less-negative post-confirmation MAE and lower new-low rate versus raw-shock entry;
- no unacceptable missed-move deterioration;
- catalyst false-clear rate near zero under fault-injection;
- forward shadow results consistent with the historical thesis.

No single overall score may hide these components before calibration. The product should expose
separate shock severity, catalyst/adverse-selection status, exhaustion/reclaim state, liquidity/
execution quality, and Mastermind thesis priority.

## 8. R0 implementation artifacts and acceptance

Terminal-side R0 artifacts are deliberately contract/evidence only:

- this preregistration — frozen before historical outcome replay;
- `docs/research/INTRADAY_DISLOCATION_R0_DATA_CENSUS_2026-10-02.md` — bounded read-only current-store evidence;
- the existing D0 qualifier/consumer named above — reused, not copied.

The tactical detector/state implementation already belongs under the incumbent Macro
`WS:LIVE-ENTRY-RADAR` research owner; R0 does not commission another one. The incremental
implementation target is the fail-closed catalyst/context attachment and later Terminal
projection, both subject to Setup Species/Evaluation OS registration before any authority claim.
Terminal must consume typed owner evidence rather than becoming a second detector runtime.

R0 acceptance requires the following integration invariants:

- no Terminal-side duplicate detector, lifecycle, event ledger, replay engine, quote owner or
  residual engine;
- `DNR:KILL-PSS-F3-RESIDUAL`, `DNR:KILL-LIQUIDITY-SHOCK-REVERSAL-CLASSIFIER` and
  `DNR:KILL-WASHOUT-TURN` are explicit fences, not forgotten historical notes;
- degraded/outage catalyst coverage becomes UNKNOWN and cannot be relabeled "no news";
- delayed/stale basis can be observed but cannot become live-actionable;
- material catalysts and halts block any future mean-reversion promotion;
- candidate, confirmation and entry-reference clocks remain distinct and never backdate;
- owner-side continuation/invalidation wins over a prettier Terminal presentation;
- residual/VWAP/RVOL/MTF context is separately inspectable and cannot hide inside one opaque
  score;
- every downstream event carries exact owner/version/provenance so Terminal cannot silently
  reinterpret a frozen scientific construction.

The read-only census is complete. The next implementation dependency is now narrower:
**extend the incumbent Macro research owner with a fail-closed catalyst/context contract that
can attach to accepted Radar tactical episodes without changing their detector or TrialLedger
identity.** Historical outcome work remains blocked until that overlay is independently
preregistered and supplied with lawful point-in-time catalyst evidence.

## 9. DO-NOTs

- Do not revive residual-shock magnitude as a timing gate, ranker or buy permission under a
  new name.
- Do not rebuild the killed no-news shock-reversal classifier.
- Do not copy R1-B exhaustion/reclaim into Terminal or create a second tactical lifecycle.
- Do not tune thresholds on a replay and then call the result preregistered.
- Do not synthesize 1-minute history from 5-minute bars.
- Do not equate `UNKNOWN` catalyst coverage with no catalyst.
- Do not make delayed data actionable.
- Do not let an LLM originate deterministic trade permission.
- Do not change Prophet thesis/portfolio authority from this research lane.
- Do not deploy R0 as a live trading feature.
