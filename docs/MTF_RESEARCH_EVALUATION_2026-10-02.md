# MTF entry research: executable-price evaluation and screener contract

Status: **built and locally tested, not a validated trading model or production screener**.
Parent: Terminal PR #779. Inherited feature source: `8000b16b1b035be93bae2f2bcbce889e797106c6`, `terminal-mtf-momentum/v2`.
This document records a research recipe and implementation evidence, not protected procedure or permission.

## The decision we are testing

The useful question is not whether five correlated oscillators can simultaneously look attractive. It is whether information from slower horizons improves a ticker's next-session entry distribution relative to an explicit daily-only or unconditioned baseline, after accounting for costs, coverage, selection, and adverse excursion.

A stronger long-horizon trend with a short-horizon pullback is a different setup from a multi-horizon washout. A washed-out price can keep falling. The interface must separate slow context, intermediate setup, fast trigger, and invalidation rather than presenting agreement as certainty. Likewise, an entry score is not an exit rule: exits need separate comparisons with holding, fixed horizons and explicit risk rules.

The current composite is a descriptive prior. Its larger values reward established momentum as well as some reclaim events. It must not be relabeled a probability of finding a bottom. In particular, `established_momentum` and `oversold_without_entry_confirmation` remain distinct descriptions.

## What is implemented

- `signal_layer/mtf_evaluation.py`: next-observed-session-open outcomes, transaction-cost assumptions, MAE/MFE, conservative barrier diagnostics, chronological episode separation, purged walk-forward events, and strictly matured historical analogs.
- `signal_layer/mtf_screener.py`: explicit source/coverage/finality validation and a per-ticker research projection over the existing MTF kernel. Every requested ticker is accounted for.
- `signal_layer/mtf_experiments.py`: six frozen comparison rules, all reported rather than selecting the best result, with separate horizons and friction assumptions.
- `ingest/research_mtf.py`: a local, network-free scanner over existing Terminal JSON documents. It creates an explicit research artifact, not a production publication. It will not overwrite the input directory, the request, an existing artifact, or a public/production output.

The established Golden Oracle, its signal era, price resampling and its trading simulations are unchanged. These modules neither execute trades nor create a scheduler, credential owner, experiment registry, production publisher or promotion controller.

## Point-in-time and executable-price contract

A decision at session `t` is made after the settled close. Entry is the next observed session's open, never the signal's already-known close. A one-session horizon exits that next session at its close; a 21-session horizon exits at `t+21`. The next observed session is not a promise of next-day tradability: exchange calendars, suspensions and missing bars remain the existing data owner's responsibility.

Prices must be real OHLC with finite positive values and valid ranges. Proxy closes do not become synthetic opens. Session indices are unique, ordered, timezone-naive dates. The supplied market `expected_session`, `closed_through` and historical `as_of` are explicit; the scanner does not infer completion from the wall clock or relabel a stale source as current.

Forward labels live outside the feature frame. Labels carry their horizon-end date, and evaluation validates that date against the daily session index. Training labels must mature strictly before a test fold. Historical analog labels must mature strictly before the query session. Future feature availability, immature returns, nonfinite scores and backdated maturity fail validation.

For calendar indicators, the inherited kernel admits W/2W/1M values only at the documented next-observed-session boundary. Its anchored 3D grid is retained. The product label currently called Stochastic RSI is the existing H/L/C price stochastic; it is not silently replaced by stochastic-of-RSI.

## Friction and intrabar ambiguity

Entry and exit costs are separate per-side basis-point assumptions. Net return uses the actual ratio of after-cost proceeds to entry cost, not an approximate subtraction from gross return. They are not measured spread, impact, commissions or guaranteed broker fills.

A gap below a stop fills at the worse opening price. If daily OHLC hits both stop and target with the open between them, the diagnostic assumes stop first and records ambiguity. A gap above the target uses the target price conservatively. Barrier observations are diagnostics alongside fixed-horizon outcomes, not a new live execution strategy. Their maturity remains the full evaluation horizon, avoiding preferential inclusion of quickly resolved winners or losers.

MAE/MFE describe the whole forward window. They are not excursions only until an early barrier exit. This distinction must survive any future chart tooltip or success-rate label.

## Frozen comparison matrix

The implemented rules are:

1. Unconditional entries in the common eligible coverage population.
2. Upper-decile daily momentum.
3. Upper-decile selected multi-timeframe momentum.
4. Upper-decile trailing bottom proximity.
5. A daily reclaim with weekly momentum support.
6. Simultaneous oversold readings across the selected horizons.

The same common coverage population is used across rules. Thresholds use prior training observations only. Sparse fixed triggers restrict test decisions rather than shrinking the threshold-training population. Each rule/horizon selects nonoverlapping episodes chronologically across year boundaries. Costs change returns, not signal dates.

Defaults are horizons 5/21/63 sessions and 0/5/25 bps per side: **54 declared matrix cells**, not 54 independent strategies. All folds, rejected folds, selected episodes and unresolved tail events are retained. A separately supplied final holdout is removed before feature and outcome construction; labels that would use reserved data remain unresolved.

This is not a nested optimizer: no learned weights or parameter search are performed. Adding such a search requires an inner training/validation loop and fresh outer evaluation. The reported cell count is not an estimate of the number of statistically independent trials.

## Historical analogs

Analogs use the ticker's own matured past indicator state and trailing bottom context. Distance is fixed-scale and equally grouped by timeframe, plus a price-context group. No forward profit, whole-history fitted scaler or hindsight bottom enters the distance. Nearby overlapping outcome windows are excluded after distance ordering.

The output carries dated analog decisions, maturity dates, distance, net return, MAE/MFE and the nonoverlapping sample count. Nonoverlap does not establish statistical independence. Ten or twenty examples are not sufficient by themselves to claim calibrated probabilities; outputs are explicitly `unvalidated_historical_comparison` or `sparse_analogs`. No predictive confidence interval is fabricated.

## Screener behavior and integration boundary

The offline projection exposes all five timeframe components, first-available session, source bar identity, evidence age, warmup coverage, selected preset and missing required lanes. The full preset requires all five scores; the swing preset requires D/3D/W; the position preset requires 3D/W/2W. A selected preset is never silently downgraded. Monthly composite readiness requires 78 completed monthly observations, so many truncated feeds honestly lack full coverage.

Research inspection order uses the descriptive setup score, never the best historical forward returns. `production_rank` is null and production-rank/trade authority are false. Missing, unreadable, invalid, short-history and stale names remain visible rather than disappearing from a success-rate denominator.

The next consumer is the existing Terminal screener and chart drill-down, using existing authentication, data publication and source cache owners. Raw indicator panes must expose actual oscillator values separately from the combined prior. Warmup for a raw stochastic need not wait for the slower RSI-MACD composite. User-selectable timeframes, raw-pane rendering, intraday triggers, exits, current-market ranking, and production API/UI delivery are not supplied by this offline slice.

## Running a research snapshot

Example request (dates must be the actual existing market/data owner's assertions):

```json
{
  "schema": "terminal-mtf-screen-request/v1",
  "as_of": "2026-10-01",
  "policy": {"preset": "swing", "entry_bps": 5, "exit_bps": 5},
  "tickers": [
    {"symbol": "NVDA", "market": "us", "closed_through": "2026-10-01", "expected_session": "2026-10-01"}
  ]
}
```

```sh
python ingest/research_mtf.py --data-dir /authorized/terminal/data --request study.json --output /research/mtf-snapshot.json
python -m pytest tests/test_mtf_evaluation.py tests/test_mtf_screener.py tests/test_mtf_experiments.py tests/test_mtf_research_cli.py -q
```

The request references the existing `<SYMBOL>.json` daily document and its source-quality/session-anchor contract. JSON duplicate keys, nonfinite values and symlink inputs are rejected. The artifact records the full input-file digest separately from the decision-prefix digest. A full file may change when later history arrives; that does not mean a decision-prefix calculation changed.

## Local evidence and what it does not prove

The four new test files passed **81 tests**. Discriminating tests cover future-information rejection, next-open gaps, costs, same-bar ambiguity, horizon maturity, purged train/test boundaries, historical-only analog choice, prefix invariance, coverage, actual monthly readiness, source identity, direct script execution outside the repository, bounded reads and output/source protection.

A positive CLI exercise processed five synthetic ticker cases and correctly retained one research-ready, one short-history, one stale, one invalid and one missing name. A separate synthetic study exercised 24 explicit matrix cells (six rules x two horizons x two costs); all 24 selected events and the final holdout remained unconsumed. These are mechanical correctness demonstrations, **not market-performance evidence**.

No real-market comparative backtest or prospective performance has been established by these tests. The sandbox's direct historical-file download failed because its network was unreachable; it was not replaced with invented data. The permitted next empirical step is to run this recipe against existing authorized historical documents with lawful raw-file access and point-in-time universe membership.

## Empirical promotion requirements

Before any return-based ranking or stronger entry claim: use point-in-time universe membership, include delistings and failures, verify corporate-action-adjusted OHLC conventions, preserve availability/vintages, and measure costs by liquidity. Slice outcomes by existing regime/theme owners using information known at the decision time, not revised macro labels.

Judge incremental utility against daily-only and unconditional baselines, not raw win rate in an upward-drifting market. Include adverse excursion, tail loss, opportunity cost, coverage, turnover and benchmark-relative outcomes. Compare fixed holding horizons separately from learned exits. Cluster uncertainty by calendar period/ticker/theme where shared exposures create dependence. A threshold discovered on the holdout consumes that holdout.

PBO/CSCV and DSR are intentionally null here. They require the correct synchronized strategy/portfolio-return trial evidence and assumptions, not an arbitrary array of overlapping event returns. A selection-adjusted statistic is an additional diagnostic, not proof of causality, stationarity or future profitability. Only independent review plus historical held-out evidence and prospective shadow behavior can support a later promotion decision through the existing owner.

## Primary sources consulted

- TradingView, Other timeframes and data: https://www.tradingview.com/pine-script-docs/concepts/other-timeframes-and-data/
- TradingView, Strategies (order timing, broker-emulator assumptions, commissions and slippage): https://www.tradingview.com/pine-script-docs/concepts/strategies/
- Bailey, Borwein, Lopez de Prado and Zhu, The Probability of Backtest Overfitting: https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf
- Bailey and Lopez de Prado, The Deflated Sharpe Ratio: https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf
- scikit-learn, TimeSeriesSplit: https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html

These sources motivate availability, execution and selection controls; they do not establish the effectiveness of this particular MTF strategy.
