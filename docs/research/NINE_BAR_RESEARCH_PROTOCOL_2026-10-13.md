# Nine-Bar Exhaustion — Preregistered Evaluation Protocol

Status: frozen before outcome analysis. Formula implementation may ship independently of statistical results.

## Hypotheses

H1: A finalized rising nine has greater subsequent downside reversal incidence than matched non-event bars; a finalized falling nine has greater subsequent upside reversal incidence.
H2: any effect differs by pre-event trend strength, volatility, relative strength, volume participation, and timeframe.
H3: nine is not assumed special; streak endpoints 6, 7, 8, 10, and 11 are explicit comparators.
H4: strong trends may show continuation rather than reversal; repeated nine cycles are an explicit failure/continuation subgroup.

## Unit and timestamp

The unit is a finalized source bar on a chronological, point-in-time series. Signal time is the completion bar’s availability time, never a retrospectively displayed annotation time. Forming bars are excluded. Corrected data produces a new research dataset version rather than silently rewriting a receipt.

## Outcomes fixed before analysis

For each direction and horizon 1, 3, 5, 10, and 20 bars:
- close-to-close signed return;
- maximum favorable excursion and maximum adverse excursion;
- meaningful reversal: favorable excursion >= 1 ATR(14) before adverse excursion >= 1 ATR(14);
- time to first 1 ATR favorable move;
- continuation: adverse-direction extension >= 1 ATR before favorable 1 ATR;
- local reversal versus durable reversal (price remains favorable at horizon 10/20);
- event rate and false-positive burden.

ATR is calculated only from information available through the event bar. Where ATR is unavailable, that event is missing for ATR outcomes rather than imputed.

## Baselines and overlap

Primary baseline: same symbol/timeframe bars matched on calendar era, trailing 20-bar return decile, ATR/price decile, and broad regime, excluding any 6–11 streak endpoint in the prior four bars. Secondary baseline: all eligible non-events with inverse-probability weighting using only pre-event features.

Overlapping completions from one uninterrupted run are clustered as one episode for inference. Repeat-cycle events remain a prespecified subgroup. Standard errors are clustered by symbol and calendar month; block bootstrap is the robustness estimator.

## Splits and multiplicity

Chronological development/holdout split: earliest 60% / next 20% / final 20% by market-time within each admitted dataset, with the final 20% untouched until rules and subgroup definitions are frozen. No threshold is selected on holdout. Report raw and Benjamini–Hochberg adjusted p-values for the prespecified family; emphasize effect sizes and confidence intervals.

## Subgroups fixed before analysis

- timeframe: 1m, 5m, 15m, 30m, 1h, 4h, daily where data is adequate;
- market: US equities, CN equities, HK equities, crypto;
- trend strength and direction;
- relative-strength leader/laggard state;
- ATR/price and realized-volatility regimes;
- volume and relative-volume state;
- VWAP displacement/reclaim where point-in-time inputs exist;
- momentum divergence and multi-timeframe agreement where independently computed;
- first nine versus repeat-cycle nine;
- session segment and extended-hours inclusion.

## Execution realism

Entry is no earlier than the next executable observation after signal availability. Report zero-friction descriptive outcomes and sensitivity at 1, 5, 10, and 25 bps each side plus one-bar delay. No selection on future liquidity. Symbols/timeframes with inadequate source history, stale feeds, unresolved adjustment lineage, or missing availability stamps are reported as unavailable.

## Decision rule

The descriptive indicator ships if formula and UX acceptance pass. Contextual ranking is exposed only if the final holdout shows a stable, economically material effect with uncertainty bounds that survive delay/friction and directionally replicate across at least two markets or two non-overlapping eras. Otherwise Terminal retains the count plus descriptive context and explicitly withholds reversal probability and Buy/Sell claims.
