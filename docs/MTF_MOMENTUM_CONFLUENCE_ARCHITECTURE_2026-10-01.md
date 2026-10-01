# Multi-timeframe momentum confluence — architecture freeze (2026-10-01)

## North Star
Turn the chart's momentum panes into a point-in-time, multi-timeframe decision surface and a universe screener that answers **where is momentum in its bottom/reclaim cycle, how many independent horizons agree, and how unusual is this setup for this ticker?** It is decision support, not autonomous trade authority.

## Research conclusions
1. **Do not require every timeframe to be oversold simultaneously.** Stoch RSI is intentionally fast and can emit many false signals; TradingView explicitly recommends combining it with trend context. Higher timeframes are slow state, lower timeframes are triggers.
2. **Use closed bars only.** A higher-timeframe value is not knowable until that bar closes. The UI may optionally preview a forming bar, but previews are visually distinct and excluded from backtests/screener ranks.
3. **Confluence is a score, not a hard gate.** Existing Mastermind studies repeatedly found that hard confirmation gates improve apparent quality while arriving late or failing in bear regimes. Score the evidence and preserve the components.
4. **Bottom proximity is context, not a label.** Use trailing-low distance / ATR-normalized extension / drawdown percentile and historical forward outcomes. Never define a “bottom” using future data at signal time.
5. **Ticker-specific calibration must be nested/OOS.** Searching many thresholds and reporting the winner creates backtest overfitting. Record every tried configuration; use walk-forward outer folds, purged/embargoed boundaries for overlapping forward labels, and report PBO/DSR or equivalent multiple-testing diagnostics.
6. **Universe screening needs cross-sectional validation.** A ticker-specific score can overfit a single history. Promote only features whose direction is stable across names, eras, and regimes.

## V1 product
### Chart
Two related panes are the first-class target:
- **MTF Stoch RSI:** D / 3D / W / 2W / 1M %K-%D state, with oversold/reclaim/neutral/rollover phase.
- **MTF MACD-RSI:** same horizons, using the Terminal's TH_RSIMACD+ convention.
- A compact **Confluence strip** summarizes each timeframe: washout → reclaim → bull → rollover → bear.
- Current score is decomposable; hovering shows exact inputs, bar-close timestamp, and whether a value is closed or preview.

### Screener
Rank by a calibrated **setup-quality score**, never raw oscillator agreement:
- 35% multi-timeframe phase alignment;
- 25% reclaim/inflection evidence;
- 20% ticker-relative bottom proximity;
- 10% anti-chase;
- 10% historical calibration confidence.
Weights are V1 priors, not “optimized truth”; the research harness may replace them only after OOS promotion.

Rows expose score, strongest/weakest timeframe, bottom percentile, historical analog count, median 21d/63d forward return, adverse excursion, and confidence. Sparse-history names are explicitly low-confidence rather than silently imputed.

## Backtest contract
For every signal timestamp t, features use only data with close_time <= t. Forward labels are separate evaluation columns. Minimum outputs:
- forward 5/21/63-session return and excess return;
- MFE/MAE and stop-hit rates;
- clean-liftoff / dead-money / stopped outcomes compatible with Entry Intelligence;
- hit rate, expectancy, median return, tail loss, sample size;
- era/regime/name slices;
- calibration curve by score decile;
- trial count + selection-adjusted statistic;
- walk-forward outer holdout and untouched final shadow period.

### Promotion gates
No production ranking authority from an in-sample winner. Require directionally consistent holdouts, useful sample size, no catastrophic regime inversion, acceptable degradation from train→test, and no evidence that one ticker/era supplies most of the effect.

## Architecture boundaries
- Canonical daily-multiple session phasing stays in `sessionBars.ts` / `ChartPanel.resampleTf`; this feature must not create another 3D grid.
- Pure indicator math lives in `terminal/lib/mtfMomentum.ts`.
- Historical research should reuse the existing Entry Intelligence / signal-layer replay data rather than invent a parallel truth store.
- UI projections are descriptive until the validated screener producer exists.
- Forming HTF bars are display-only.

## V1 scoring semantics
`mtfMomentum.ts` deliberately exposes component states and a bounded prior score. The prior rewards reclaiming momentum and near-bottom context, penalizes broad falling-knife states, and never hides the underlying oscillator values. This score is a product prior pending OOS calibration, not a claim of predictive edge.

## Next vertical waves
1. Native chart MTF panes + confluence strip using canonical resampling and closed-bar alignment.
2. Offline replay producer across the full eligible universe; emit per-name/per-date feature parquet.
3. Walk-forward evaluator + PBO/DSR/multiple-testing report.
4. Screener artifact and UI with historical analog drill-down.
5. Forward shadow logging; only then consider score-weight promotion or additional indicators.
