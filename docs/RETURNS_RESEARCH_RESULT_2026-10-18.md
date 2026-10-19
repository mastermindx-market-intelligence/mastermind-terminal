# Returns Intelligence — frozen exploratory result

**Decision: keep directional probabilities withheld.** The first fixed price-only
candidate did not improve on the historical class-prior baseline at any of the
three tested horizons. This is a useful negative result from one instrument and
one current data vintage; it is not a finding that market prediction is impossible.

This report accompanies Terminal PR #1043. It is research evidence, not model
admission, a trading strategy, or a live forecast. The descriptive Returns workspace
and its price-basis qualification are separate from this experiment.

## What was actually evaluated

The input was the existing public Terminal NVDA daily document, read from
`https://app.mastermind-x.com/data/NVDA.json`. It contained 6,977 bars through
2026-10-16, identified the provider as Yahoo, and contained no Data OS `view` block.
The evaluator uses Terminal's existing NYSE session projection, whose coverage
starts in 2016. Older source rows do not extend that calendar or the evaluated
sample. No fresh market-data collector was added.

The input is a current-vintage history. Its historical availability and adjustment
provenance are unqualified. The CLI therefore requires `--exploratory` for this
numerical run; strict evaluation remains blocked. A favorable exploratory score
would still have been insufficient to admit a forecast.

The three targets are the arithmetic close-to-close return after exactly 5, 21,
or 63 exchange sessions. At each decision close, the symmetric neutral band is
fixed as the larger of 0.5% and half the trailing 63-session daily log-return
standard deviation multiplied by the square root of the target horizon. Returns
above the band are up, below its negative are down, and the rest are flat.

The candidate uses eight fixed price features: volatility-scaled returns over
5/21/63 sessions, change in fitted pace over 5/21 sessions, 21-session movement
efficiency, the ratio of 21-session to 63-session volatility, and a scaled
63-session drawdown. It is a ridge-regularized multinomial model. It does not use
seasonal win rates, option-volume polarity, GEX signs, or independent-vote claims
for correlated indicators.

## Evaluation procedure

The frozen implementation is `signal_layer/returns_research.py`, version
`returns.research.v1`. Its procedure digest, input digest and session-projection
digest are included in the retained JSON report.

- Initial training requires 756 observations. Calibration spans 252 sessions and
  refitting occurs every 126 sessions.
- Training labels must mature before calibration decisions begin. Calibration
  labels must mature before the test period begins. Incomplete session paths are
  excluded without compressing the exchange-session axis.
- Scaling is fitted on training observations only. The model clips standardized
  feature values at eight standard deviations and uses a fixed ridge penalty of
  0.05. A failed optimizer convergence check excludes that fold.
- Temperature calibration selects one of 41 fixed values using calibration
  observations only. This tuning step is disclosed; it is not a test-period choice.
- Baselines are the past training class prior with Laplace smoothing, and a
  one-feature momentum model with the same fitting and calibration procedure.
- Training requires at least 20 examples of each class and calibration at least
  10. Excluded folds and their reasons remain in the report.
- Uncertainty uses paired moving-block bootstrap comparisons at block lengths of
  one and two target horizons, with 500 draws and a fixed seed. Blocks do not cross
  gaps in scored decision dates. Fewer than eight nonoverlapping temporal blocks
  yields no interval. The block count is not advertised as an effective sample size.

The reported Brier score sums squared probability errors across all three classes;
lower is better. Uniform three-way probabilities score 2/3 under this convention.
Log loss is also lower-is-better. These definitions follow the proper-scoring-rule
framework of [Gneiting and Raftery](https://doi.org/10.1198/016214506000001437).
Temperature scaling is a calibration method, not evidence of financial forecasting
skill; see [Guo et al.](https://proceedings.mlr.press/v70/guo17a.html).

## Results

| Horizon | Scored observations | Eligible folds | Candidate Brier | Past-prior Brier | Momentum Brier | Candidate log loss | Past-prior log loss | Momentum log loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 sessions | 1,564 | 13 | 0.666593 | 0.657001 | 0.665092 | 1.099072 | 1.083797 | 1.095451 |
| 21 sessions | 1,516 | 13 | 0.656653 | 0.646651 | 0.652910 | 1.085121 | 1.065566 | 1.078268 |
| 63 sessions | 630 | 5 | 0.589829 | 0.551323 | 0.594051 | 0.970053 | 0.889674 | 0.977195 |

The candidate loses to the historical-prior baseline on both scores at every
horizon. The 63-session candidate's lower absolute score does not mean it is a
better forecasting horizon: its class prevalence and eligible sample differ.

Paired Brier improvement below means **baseline loss minus candidate loss**.
Positive values favor the candidate. Intervals are 90% moving-block intervals;
they are descriptive uncertainty estimates for this retrospective sample, not
promotion gates or independent repeated confirmations.

| Horizon | Improvement vs past prior | Interval with h-session blocks | Interval with 2h-session blocks |
| --- | ---: | --- | --- |
| 5 | −0.009591 | [−0.016519, −0.002608] | [−0.017799, −0.002704] |
| 21 | −0.010002 | [−0.032674, +0.010956] | [−0.034033, +0.012158] |
| 63 | −0.038505 | [−0.143857, +0.020251] | Withheld: only five nonoverlapping 126-session blocks |

The five-session result is unfavorable under both reported block choices. The
longer-horizon intervals are wider and do not demonstrate incremental skill.
For 63 sessions, seven candidate folds were excluded for sparse calibration-class
support; only 34 scored outcomes were in the down class. That limitation must stay
visible instead of pooling in ineligible folds or suggesting precise down odds.

The complete artifact retains fold boundaries, training-only transformations,
model weights, calibration temperatures, each experimental prediction and outcome,
class counts, reliability bins, exclusions, and dependence-aware comparisons.

## Product consequence

Every consumer envelope in this report has null probabilities, null quantiles,
and no admission reference. No output is written to `terminal/public`. Terminal's
forecast consumer independently withholds probabilities when the canonical
admission binding is missing. Producer metrics, a model hash, or an `approved`
Boolean cannot grant that authority.

Continuous paths, benchmark-relative performance, measured pace and pace change,
drawdowns and group participation remain useful descriptive tools. They answer
how a move developed, including a rise that is slowing or a decline becoming less
steep. Their output still depends on adequate price provenance and session coverage;
this negative model result does not waive those independent requirements.

## Existing authority and the next experiment

Macro's existing [Eval OS architecture freeze](https://github.com/mastermindx-market-intelligence/macro/blob/7c046cf3f073a8ba5671b3b3dc3378278726cc10/agentos/decisions/DEC-EVAL-OS-RECOVERY-ARCHITECTURE-FREEZE.md)
retains T1 as the engine registry, qledger and owner-native ledgers as scored-record
substrates, and existing gauntlet/species/qual-ladder owners as promotion authority.
The [measurement-law workstream](https://github.com/mastermindx-market-intelligence/macro/blob/7c046cf3f073a8ba5671b3b3dc3378278726cc10/agentos/workstreams/WS-EVAL-OS-MEASUREMENT-LAW.md)
governs declared horizon units, exchange clocks and prospective accrual. This
research JSON is a quarantined numerical artifact; it creates no competing
evaluation database, registry, clock, or promotion service.

A future live admission must bind the model artifact or admitted refitting
procedure, target and neutral-band version, horizon, feature transformations,
session calendar, return basis, supported instruments, evaluation report, qualified
inputs, permitted consumer use, and validity/revocation. The consumer must verify
that the forecast matches the independent owner's record. An admission string
that is merely present is insufficient. The current seasonal display-only LOYO
artifact is not that owner and is never a probability fallback.

The justified next steps are to repair provenance at its current producer and
Data OS seam, predeclare a representative instrument cohort and untouched temporal
or prospective evaluation, and test one falsifiable incremental options/flow
hypothesis on source-time-qualified history. Direction and future volatility are
different targets and need separate evaluation. The inspected NVDA period cannot
be relabeled as an untouched test after feature changes. No retuning or symbol
selection was performed to turn this negative result into a favorable one.

## Reproduction and retained identity

Run from the repository root with its existing NumPy dependency:

```sh
python3 research/evaluate_returns.py \
  --source docs/research/inputs/NVDA-current-20261018.json \
  --symbol NVDA --through 2026-10-16 --exploratory \
  --output /tmp/returns-nvda-reproduction.json
```

The output path must be new. The original result is retained without rewriting
its original input path or uncommitted-source provenance. The copied input below
must match the original bytes, not today's mutable URL.

| Artifact | Identity |
| --- | --- |
| Original input SHA-256 | `1edd2fa0cbece674142c3b38b992ad99a9c3a8b908d06a2d43ed87fbe8615d15` |
| Procedure SHA-256 | `87d992f70affc9cd4d636a063ddf09195fba481d09bc6503268f070799bfdd7d` |
| Result SHA-256 | `89da5b69712af8064a79d51729efc9ecba91d03bc642446b6e0433e04742903d` |
| Original numerical runtime | NumPy 2.5.2 on the owned M2 workspace |
| Full result | `docs/research/returns-nvda-exploratory-20261018.json` |
| Evaluator tests | `tests/test_returns_research.py`: 9 passed |

Tests cover future-price perturbation, exact label maturity, missing-session holes,
scoring units, train-only scaling, optimizer convergence, bootstrap gap boundaries,
strict source refusals and the always-abstaining consumer envelope. Passing tests
establish these implementation properties; they do not establish predictive skill.
