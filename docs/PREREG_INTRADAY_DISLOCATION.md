# PREREG — Intraday Dislocation + Reclaim R0 (2026-10-02)

This document freezes the first research implementation before any outcome sweep.
R0 is a **shadow research lane**. It may describe abnormal downside events; it may not
emit scored BUY/SELL authority, alter Prophet or portfolio decisions, size positions,
or drive production execution.

## 1. Mission and ownership

The research question is whether point-in-time abnormal downside dislocations followed
by explicit exhaustion/reclaim evidence improve entry basis and reduce immediate adverse
excursion enough to compensate for missed-move and execution costs.

Ownership stays with existing systems:

- Terminal owns intraday observations, market-data provenance, technical state, and UI.
- Mastermind/Prophet owns thesis quality, portfolio desirability, and portfolio constraints.
- This R0 module owns only deterministic shadow classification and replay evidence.
- No second quote daemon, data store, scheduler, retry plane, or execution plane is created.

The engine is deliberately not an "oversold = buy" scanner. Its state grammar is:

`NORMAL -> DISLOCATED -> EXHAUSTING -> RECLAIM_CONFIRMED`

with `BLOCKED`, `INVALIDATED`, and `EXPIRED` as explicit side states.

## 2. Point-in-time and data-admission law

All research must preserve what was knowable at the decision timestamp.

- `detected_at` = first completed observation where the shock rule became knowable.
- `anchor_at` = observed event-low/shock anchor; it may occur after detection.
- `confirmed_at` = first completed observation where reclaim confirmation became knowable.
- `entry_eligible_at >= confirmed_at`; replay may never fill at the eventual event low.
- Current-session observations may not enter their own historical baseline.
- Beta/factor parameters used intraday must have an `asof` before the session being tested.
- Missing, malformed, stale, partial, delayed, or unverified data is not an empty/healthy result.

Existing Terminal source evidence is descriptive only. Before historical results are
promoted beyond exploratory replay, the actual 5-minute store must be inventoried for
symbol count, first/last bar, missing sessions, point-in-time universe coverage, instrument
identity, corporate-action adjustment, and source hashes.

Historical 1-minute performance is **NOT** inferred by interpolating 5-minute bars.
R0 historical replay starts at genuine stored 5-minute resolution. True 1-minute research
waits for durable 1-minute history or a licensed historical source.

## 3. Frozen detector hypotheses

The initial detector uses market/sector-residual returns rather than raw percentage drops.
For a horizon H:

`U_i,H = R_i,H - beta_market * R_market,H - beta_sector * R_sector_residual,H`

The sector leg supplied to the core is already market-orthogonalized. Betas are frozen
before the tested session; R0 does not update them using the shock it is trying to judge.

For each symbol × horizon × time-of-day slot, normalize residual returns using the prior
session distribution:

`location = median(history)`

`scale = 1.4826 * median(abs(history - location))`

`Z_idio = (current - location) / scale`

R0 requires at least **40** valid historical observations for a robust Z. A flat or
near-flat MAD returns unavailable; it is not rescued with a tiny epsilon denominator.
Neighbouring-slot shrinkage is a possible later preregistered arm, not an R0 silent fallback.

Historical downside severity uses an empirical same-slot rank with finite-sample humility;
a finite sample may not claim literal 100% extremeness.

The frozen broad trigger is:

- core: `Z_idio <= -3.0` **and** empirical downside severity `>= 98`, **or**
- severe: `Z_idio <= -4.0`,
- plus at least **two** corroborators from:
  - session-VWAP stretch `VWAP_z <= -1.75`,
  - time-of-day slot RVOL `>= 1.75x`,
  - cumulative time-of-day RVOL `>= 1.25x`,
  - normalized downside velocity `<= -2.5`.

These are research hypotheses, not asserted optima. They remain frozen through the first
outcome sweep. Multiple horizons are event-level correlated tests; replay evaluates the
event-level false-positive rate instead of pretending each threshold is independent.

Opening-period behavior will be reported as its own cohort. R0 does not secretly tighten
or loosen thresholds after seeing opening results.

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

## 5. Exhaustion and reclaim grammar

`DISLOCATED` earns attention only. It does not authorize entry.

`DISLOCATED -> EXHAUSTING` requires all of:

1. the event low is holding on completed observations;
2. downside velocity is improving;
3. at least one independent supporting sign: improving close location, post-climax volume
   contraction, spread normalization, momentum divergence, or a higher low.

At least price/velocity evidence is mandatory. RSI/MACD/Pulse divergence alone cannot advance
the state.

`EXHAUSTING -> RECLAIM_CONFIRMED` requires both:

1. a completed structural reclaim; and
2. a subsequent completed hold/retest confirmation.

Session VWAP reclaim is stronger evidence but is not a universal prerequisite in R0.
A fresh second downside impulse invalidates an active episode rather than encouraging
automatic averaging down.

The exact intraday bar geometry for R1/R2 reclaim levels will be frozen in the replay adapter
before historical outcomes are swept. This core intentionally separates state semantics from
bar-construction details so no future UI implementation can backdate confirmation.

## 6. Replay design

The first replay must be immutable/event-ledger based. One shock episode must not produce
dozens of overlapping pseudo-independent events. Event identity includes symbol, session,
shock start, trigger horizon, and detector version.

Primary outcomes by 5/15/30/60 minutes (plus close/next session where data permits):

- implementation-cost-adjusted return;
- MFE and MAE;
- probability of a new event low;
- invalidation/stop-hit rate;
- time to exhaustion and reclaim;
- VWAP-reclaim rate;
- missed-move rate;
- entry-basis improvement versus the applicable baseline.

Where an existing point-in-time Mastermind entry baseline exists, compare:

- A: ordinary approved entry timing;
- B: first qualified dislocation observation;
- C: dislocation plus reclaim confirmation;
- D: preregistered staged entry arm, only if its exact rule is frozen before outcomes.

Primary decision utility is:

`TimingBenefit = PriceImprovement - MissedMoveCost - AdverseSelectionCost - ExecutionCost`

No claim of improved safety or profitability is allowed without net-of-cost evidence.
Without historical NBBO, replay must publish a conservative slippage sensitivity grid rather
than treating midpoint/close fills as free. A completed five-minute signal defaults to a
next-observation fill assumption unless a stricter causal fill can be reconstructed.

Required cohorts include catalyst class, liquidity, shock severity, trigger horizon, time of
day, market direction/regime, sector behavior, prior extension/trend, VWAP stretch, RVOL, and
reclaim speed. Results are clustered by session/date where same-day events are dependent.

Chronological walk-forward validation plus an untouched final/forward period is required.
Threshold selection on the final period is forbidden.

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

R0 source artifacts:

- `signal_layer/intraday_dislocation.py` — pure deterministic statistics, gates, state machine.
- `tests/test_intraday_dislocation.py` — negative/fail-closed and point-in-time contract tests.
- this preregistration — frozen before historical outcome replay.

R0 core acceptance:

- no filesystem/network/model calls in the core;
- insufficient or zero-MAD baselines cannot manufacture extreme Z;
- degraded/outage catalyst coverage becomes UNKNOWN and blocks promotion;
- delayed/stale basis can be observed but cannot become live-eligible;
- material catalysts and halts block promotion;
- DISLOCATED cannot jump directly to RECLAIM_CONFIRMED;
- divergence alone cannot advance exhaustion;
- a second downside impulse invalidates;
- confirmation/entry timestamps cannot be backdated;
- deterministic versioned event identity.

After the core is green, the next implementation dependency is a **read-only 5-minute data census**
followed by a replay adapter that freezes bar geometry, beta construction, same-slot baselines,
event de-duplication, and ledger schema before any outcome table is generated.

## 9. DO-NOTs

- Do not tune thresholds on the first replay and then call the result preregistered.
- Do not synthesize 1-minute history from 5-minute bars.
- Do not equate `UNKNOWN` catalyst coverage with no catalyst.
- Do not make delayed data actionable.
- Do not let an LLM originate deterministic trade permission.
- Do not change Prophet thesis/portfolio authority from this research lane.
- Do not deploy this R0 core as a live trading feature.
