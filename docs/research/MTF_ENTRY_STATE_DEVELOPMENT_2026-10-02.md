# MTF entry-state development study — context rank vs trigger readiness (2026-10-02)

Status: **development research, not validated trading logic and not production ranking authority.**

Protocol was frozen in PR #779 comment 5965082123 before outcomes were inspected. All features and outcomes stop before 2026-01-01; the reserved 2026 holdout remains unopened.

## Question

The chart/screener should not assume that the same statistic must both rank context and time an entry. The hypothesis tested here was that W/2W/1M define slow support while D/3D provide a pullback/reclaim trigger.

The existing full D/3D/W/2W/1M upper-decile composite is retained as the current context comparator. Seven fixed development states were evaluated without threshold search.

## Primary 21-session result

Matched-window SPY excess return, 5 bps per side, equal-ticker descriptive event means across the same 14 long-history stocks:

| Rule | Difference vs full common coverage | Difference vs current full-MTF comparator | Events | Tickers |
|---|---:|---:|---:|---:|
| Current full-MTF upper decile | +0.847 pp | 0.000 pp | 961 | 14 |
| Slow-supported reclaim | +0.708 pp | -0.139 pp | 564 | 14 |
| Slow-supported pullback + reclaim | +1.471 pp | +0.651 pp | 52 | 11 |
| Slow-supported deep reclaim | +0.289 pp | +0.110 pp | 9 | 5 |
| Non-degrading slow context + reclaim | -0.360 pp | -1.208 pp | 953 | 14 |
| Slow-supported fast oversold | -2.649 pp | -3.325 pp | 1 | 1 |
| Slow-supported oversold + reclaim | no observations | no observations | 0 | 0 |

The larger mean on the pullback/reclaim rule is not enough for promotion: it has only 52 events and materially unstable era behavior.

## Era behavior at 21 sessions

Slow-supported reclaim vs common coverage: pre-2008 +1.877 pp; 2008-2009 -1.058 pp; 2010-2019 +1.744 pp; 2020-2022 +2.089 pp; 2023-2025 -0.539 pp.

Slow-supported pullback + reclaim: pre-2008 -1.453 pp; 2008-2009 -0.045 pp; 2010-2019 -1.146 pp; 2020-2022 +1.602 pp; 2023-2025 +6.578 pp on only six events.

Current full-MTF upper decile stayed positive versus common coverage in all five predefined bins in the earlier frozen long-history study, although its 2023-2025 advantage was only +0.015 pp.

## Risk diagnostics

At 21 sessions: full common coverage equal-ticker mean p10 return -10.60% and median MAE -5.24%; slow-supported reclaim p10 -7.94% and median MAE -5.14%; current full-MTF upper decile p10 -8.87% and median MAE -4.57%; pullback/reclaim p10 -3.71%, but its 52-event sample is too sparse for a stronger inference and its median MAE is worse at -7.74%.

These are descriptive event diagnostics, not independent observations or confidence intervals.

## Product consequence

The evidence supports a **two-role interface**:

1. **Context quality** remains the descriptive multi-timeframe score used for research inspection order.
2. **Entry readiness** is a separate categorical state explaining whether D/3D are pulling back or reclaiming while W/2W/1M are supportive.

The trigger state is not a replacement rank, probability, or trade command. This separation also lets the pane show useful setups such as “strong slow context, pullback waiting for reclaim” without mislabeling them as completed entry signals.

`signal_layer/mtf_screener.py::context_trigger_snapshot` implements that view-model seam while preserving the existing score and `production_rank=None`.

## Evidence

Research artifact manifest SHA-256: `830cd6f50c7e2792a95eef1c8da87a8d4f8f5a8b7a8c4ac9b31190f2b4bb9a77`.

All six files declared by that manifest were independently digest-verified. Full development artifacts remain under `/Volumes/Mastermind/research/mtf779-entry-state-7c08ab3`.

The exact screener view-model candidate plus existing screener tests passed **27 tests** locally. This does not replace hosted CI or browser proof.

## Remaining scientific gates

- finish the preregistered 2025 S&P1500 point-in-time swing validation;
- keep adjustment-basis and feed-anchor limitations explicit;
- do not open the 2026 holdout until one candidate/protocol is frozen;
- prospective shadow behavior remains required before stronger authority.