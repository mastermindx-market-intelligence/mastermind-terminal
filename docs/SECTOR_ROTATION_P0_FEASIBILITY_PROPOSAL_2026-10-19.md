# Rotation intelligence — proposed P0 feasibility packet

Status: **design proposal only**. No V3 registration, study execution, market-data read, trial-ledger write or predictive qualification is claimed.

This packet supports the Sector Central integration plan. The scientific owner and progress carrier remain [Mastermind #1194](https://github.com/mastermindx-market-intelligence/Mastermind/issues/1194), with the existing Leadership Rotation workstream. It does not create a second research lifecycle in Terminal.

## Source boundary

Read basis: Macro `b912fd97827cca925a7123aa2012e9765077f3f7`:

- [V1 preregistration](https://github.com/mastermindx-market-intelligence/macro/blob/b912fd97827cca925a7123aa2012e9765077f3f7/research/LEADERSHIP_ROTATION_PREREG_V1.md), especially §§3–8.
- [T26 closeout](https://github.com/mastermindx-market-intelligence/macro/blob/b912fd97827cca925a7123aa2012e9765077f3f7/research/LEADERSHIP_ROTATION_T26_CLOSEOUT_2026_10_14.md).

T26's later decision controls the read frontier: P1/P2/P3 remain withheld pending dated V3 statistics and fresh P0 qualification. The earlier V1 description of P1 development is not a current permission to read it. Preserve the completed T12R/T13R records and their dispositions.

The point of the next unit is to determine whether a proposed test can measure a meaningful incremental contrast, and whether its synthetic alternative actually contains that contrast.

## 1. Separate estimator feasibility from detector feasibility

**Estimator check:** provide synthetic alarm/outcome records with an analytically known answer. Test denominators, censoring, missing states, dependence accounting and the calculation of the contrast.

**Detector check:** pass a finite set of synthetic price histories through the existing fixed arms. Determine whether the detector and generator jointly create the intended contrast.

A working estimator can correctly find no advantage. An estimator-only positive control does not demonstrate that the actual detector can extract that advantage from prices. A low-power result is not diagnostic until the generator's target contrast is established.

The bounded implementation return should label each result as one of:

| Result | Meaning |
|---|---|
| Estimator/accounting defect | The method fails an analytic witness or violates a denominator/cutoff rule |
| Generator lacks the intended alternative | Its oracle incremental contrast is smaller than the declared practical margin |
| Detector limitation | The alternative exists, but the fixed detector does not exploit it |
| Synthetic feasibility demonstrated | The finite declared controls behave as intended; no market claim follows |
| Not executable | Required accounting, source, protocol or qualification is missing |

## 2. H1 proposal: capped delay against the independently defined incumbent

Use the existing A0 suppressed-onset incumbent and A1 challenger on the same synthetic paths. Independent definition does not imply statistical independence: their outcomes remain paired.

For a fully observable reference onset T and the existing 40-session matching horizon, let D be the first qualifying matched-alarm delay; if no qualifying alarm occurs, D is 40. The proposed contrast is:

`Delta_D = mean(D_A0 - D_A1)`.

Positive values mean lower capped delay for A1. All eligible reference episodes, including misses, remain in the denominator. An alarm exactly at session 40 and a miss share a delay value, so detection/miss status must also be reported.

Do not compress the result into a weighted utility score. Return the delay contrast, each detection rate, unmatched alarms per eligible pair-year, quiet-period burden, repeated/late alarms and immature reference episodes.

### Analytic witness

The following is an invented accounting example, not a completed test or market result:

| Reference episode | A0 delay | A1 delay |
|---|---:|---:|
| 1 | 12 | 4 |
| 2 | 16 | 8 |
| 3 | 40 — miss | 20 |
| 4 | 24 | 40 — miss |

The capped means are 23 and 18 sessions, giving a five-session contrast. Both detection rates are 3/4. Dropping missed episodes changes the comparison and hides an important part of the detector behavior. False-alarm burden still needs its own declared exposure and cannot be inferred from this table.

A2 is a descriptive confirmation-cost comparison. The accepted H1 defect was that an A2 defined as A1 plus five sessions made the tested delay advantage structural. Keep this trap as a falsifier; do not call deterministic confirmation delay evidence of new information.

Latent synthetic onset and retrospectively constructed evaluation labels must remain distinct. Neither can enter a detector's past-only inputs. Their disagreement is a labeling diagnostic, not a reason to select the more favorable label.

A new H1 decision rule and practical margin require the dated V3 owner decision. This proposal does not reuse the old five-session criterion as an automatically valid margin for a different statistic.

## 3. H2: continuation beyond the better registered baseline

Keep the existing future-only target, first permitted origin o=t+1 after a close-t signal, primary 20-session horizon and separate descriptive horizon.

`Y20 = log(P_receiver[o+20] / P_receiver[o]) - log(P_donor[o+20] / P_donor[o])`

`Delta_2 = mean(Y20 | A1 entries) - max(mean(Y20 | B1 formation set), mean(Y20 | B2 entries))`

B1 and B2 retain their registered opportunity sets. This is an arm-conditioned outcome contrast, not a causal treatment effect on the same dates. Means use matured observations; immature, unpriceable and invalid counts stay beside every mean and in the appropriate coverage denominator.

Recompute the baseline maximum inside every resampling replicate. Do not select a weaker baseline from the observed results.

An analytic witness with means A1=0.026, B1=0.012 and B2=0.016 has a contrast of 0.010 log units. Choosing B1 alone would overstate it as 0.014. Adding an identical constant drift to all three arm-conditioned means must leave the contrast unchanged. A common-improvement null with equal means must remain a zero incremental contrast.

The retained V1 H2 practical-margin scale is 0.0050 log units. This is a reference to the frozen protocol, not a new margin or a passing inferential result.

## 4. H3: paired information beyond the receiver-only arm

Keep the past-fitted beta residual:

`Y20_res = Y20 - (beta_receiver - beta_donor) * log(P_SPY[o+20] / P_SPY[o])`

`Delta_3 = mean(Y20_res | A1 entries) - mean(Y20_res | B3 entries)`

Estimate betas only from the permitted past at formation. Report the same source/maturity accounting as H2. Keep defensive-sector and broadening-proxy groups separate and preserve shared-leg and temporal-overlap dependence.

A common-factor witness with Y20=0.020, beta difference=1 and market log return=0.020 has residual zero. A raw pair move in that example supplies no residual advantage. Compare the estimated residual with the known synthetic-factor diagnostic to expose estimation error; the known factor cannot become a production input.

The retained V1 H3 practical-margin scale is 0.0025 log units. Sector identity, an alternative donor label or duplicate transformations cannot establish incremental paired information.

## 5. Positive-control construction

Start with a finite, frozen generator-to-estimand table. Specify latent regime, pre-onset observations, subsequent continuation, covariance, missingness, shared legs and eligible exposure separately.

Do not award a favorable future return merely because A1 fired. That generator would encode the desired result in the arm identity. Jointly generate receiver, donor and market paths from exogenous latent states; let the unchanged arms decide from their past.

For each proposed alternative, compute the oracle target contrast analytically where possible. Otherwise use a separate Monte Carlo characterization with explicit uncertainty, separate development/validation seeds and sufficient precision to determine whether the generator actually reaches the relevant retained margin.

Report “generator does not instantiate the intended alternative” when that condition is not established. Do not repair it by lowering the margin, changing alpha, discarding an unsuccessful family or calling common drift a paired advantage.

## 6. Required finite falsifiers

| Case | Required behavior |
|---|---|
| Fixed-offset comparator | Reveals a deterministic policy delay; no information-discovery claim |
| Miss removal | Cannot improve the reported capped delay by silently shrinking its denominator |
| No reference events / no entries | Relevant contrast is unavailable, not zero; burden may still be measurable |
| Rolling carry with zero new return | Expiry-driven crossing remains identified; no fresh impulse is invented |
| Both legs decline while ratio rises | Relative resilience remains distinct from absolute recovery, inflow and entry |
| Common market improvement | Incremental contrast remains null when all arms benefit equally |
| Shared factor with estimation error | Known-factor diagnostic separates model error from paired information |
| Duplicate aliases / shared constituents | Cannot increase independent support |
| Future-only perturbation | Earlier issued detector states remain byte-identical at their cutoff |
| Missing leg, membership cut or instrument break | Observation stays unmeasured/invalid; source identity is not guessed |
| Immature or later-corrected observation | Availability is not projected backward; outcome states stay distinct |

## 7. Bounded execution return and stopping point

The eventual admitted worker should return the proposed estimand definitions, analytic witnesses, finite generator table, oracle contrasts with uncertainty, synthetic diagnostics, missingness/dependence accounting and a list of exact decisions still required for V3.

It must not modify production signal/ranking/entry/sizing code, read P1/P2/P3, reopen the sealed entry-confluence or trend-persistence studies, rerun the unchanged old grid, create another trial ledger or self-certify T25 human readback.

Synthetic feasibility is only a prerequisite. Dated protocol registration, accepted size/power qualification, authorized custody acts and real prospective evidence remain separate steps.
