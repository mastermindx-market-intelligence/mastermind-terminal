# Nine-Bar Exhaustion — Evaluation Methods v1

Status: locked before reading outcome results. This operationalizes `NINE_BAR_RESEARCH_PROTOCOL_2026-10-13.md` for the currently admitted daily snapshot.

## Eligible series

A series must contain strictly increasing daily OHLCV observations with finite positive OHLC, nonnegative volume, and at least 120 bars. The runner records the source metadata but does not infer missing point-in-time or corporate-action receipts. Large open-to-prior-close discontinuities above 30% are reported and split the research segment; no event outcome may bridge such a boundary.

## Signal and comparators

The canonical `nine-bar-v1.0.0` kernel is run with:

- direct start (no price-flip prerequisite);
- repeated-cycle materialization so absolute directional streak lengths remain observable;
- progressive internal display (display itself is irrelevant to research);
- only finalized bars.

The primary event is the first absolute streak length 9 in an uninterrupted rising or falling episode. Comparator endpoints are absolute streak lengths 6, 7, 8, 10, and 11. At most one observation of a given endpoint exists per episode. A later 18th qualifying bar is a repeat-cycle nine and is reported separately rather than mixed into the primary first-nine estimate.

## Chronological partitions

Within each symbol, bars are divided by index into earliest 60% development, next 20% validation, and final 20% holdout. Events and baselines cannot cross a partition boundary for outcome measurement. The final 20% is summarized only after all rules in this file and the parent protocol are frozen.

## Features available at the signal close

- ATR(14): Wilder recursive true range using observations through the event bar.
- trailing 20-bar return: event close divided by the close 20 bars earlier minus one.
- ATR percentage: ATR(14) divided by event close.
- relative volume: event volume divided by the trailing 20-bar mean volume, including the event bar.
- 60-bar relative strength: symbol trailing 60-bar log return minus the admitted benchmark's aligned trailing 60-bar log return. SPY is the US benchmark; BTC-USD is the crypto benchmark. Missing benchmark alignment produces `unknown`, never an imputed value.

Prespecified context labels:

- leader: 60-bar excess return > 0; laggard: <= 0;
- high relative volume: >= 1.20; normal/low: < 1.20;
- strong directional trend: absolute trailing 20-bar return >= 2 × ATR percentage; otherwise moderate/sideways;
- volatility: per-symbol, per-partition ATR-percentage terciles.

Return deciles, ATR-percentage deciles, and volatility terciles are assigned **causally within each chronological partition**. At bar `i`, the empirical rank uses only eligible observations in that partition through `i`, including the event bar's already-observed trailing feature. A later bar cannot move an earlier event or baseline into another bucket. Equal values are ordered chronologically for deterministic receipts. This is a lookahead-prevention rule for feature construction; it does not make the underlying static repository snapshot a point-in-time vendor receipt.

These labels are descriptive subgroup cuts, not optimized thresholds.

## Outcome clock and thresholds

The event is known after its source bar closes. A tradable measurement begins at the next admitted bar's open. Horizons are 1, 3, 5, 10, and 20 bars after that entry. A horizon is unavailable when the series/partition ends first or a discontinuity intervenes.

For falling nines, favorable direction is up; for rising nines, favorable direction is down. For each horizon the runner records:

- signed close return in the hypothesized reversal direction;
- maximum favorable and adverse excursion from next-open entry;
- whether a 1 × event-bar ATR favorable threshold was reached before a 1 × ATR adverse threshold;
- whether the adverse threshold was reached first (continuation/invalidation);
- time to first favorable ATR threshold;
- ambiguous same-bar touches, where daily OHLC cannot establish order.

Same-bar favorable/adverse threshold touches are excluded from binary reversal/continuation rates and reported as ambiguity. They are never resolved in the favorable direction by assumption.

Friction sensitivity subtracts round-trip cost for 1, 5, 10, and 25 basis points **per side**. A one-bar delayed-entry sensitivity begins at the second bar after confirmation and is reported separately.

## Matched non-event baseline

Each primary nine is matched within the same symbol, direction, partition, trailing-20-return decile, and ATR-percentage decile. A candidate baseline must:

- have the same current close-versus-four-bars-back direction;
- have no absolute streak endpoint 6–11 in the candidate bar or prior four bars;
- be at least 20 bars from any matched primary event in the same episode neighborhood;
- have enough forward observations for the requested horizon;
- be unused by an earlier match.

Among eligible candidates, choose the smallest absolute bar-index distance, breaking ties by the earlier index. Unmatched events remain in event summaries but are excluded from paired effect estimates. No bucket widening occurs in the primary result.

## Inference and reporting

Primary effect estimates are paired event-minus-baseline differences. Confidence intervals use a deterministic 1,000-replicate cluster bootstrap by symbol with seed `0x9E3779B9`. The runner reports sample counts, match rates, ambiguous outcomes, and 2.5%/97.5% quantiles. No p-value or confidence interval upgrades snapshot evidence into point-in-time causal evidence.

Multiple endpoint/horizon comparisons are exploratory unless explicitly marked as the primary nine/5-bar and nine/10-bar holdout estimates. The report shows raw effects and does not select a winning horizon after inspection.

## Promotion rule

The indicator remains descriptive unless the final chronological holdout shows an economically material, friction-resilient effect whose uncertainty excludes a trivial result and whose direction replicates across at least two markets or two non-overlapping eras. The current admitted snapshot cannot satisfy the two-market requirement because CN/HK panels are absent and the crypto history is short. Null, negative, or unstable results do not block the descriptive feature.
