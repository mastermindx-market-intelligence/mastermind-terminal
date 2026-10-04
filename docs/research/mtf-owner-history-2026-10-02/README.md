# Multi-timeframe momentum — existing-owner long-history evidence (2026-10-02)

**Research evidence only. No production ranking or trade authority.**

The preregistered long-history wave reused the six existing rules without retuning, the existing swing / position / full presets, horizons 5 / 21 / 63 sessions, and 0 / 5 / 25 bps per-side assumed friction. Feature, threshold and outcome inputs were cut before **2026-01-01**; the 2026 holdout remains unconsumed.

The same 20-name owner request was retained. Eighteen US instruments had owner-declared real OHLC and passed observed-SPY-session continuity checks. 0700.HK remained census-only pending an appropriate exchange calendar/benchmark contract. 600519.SS was ineligible for next-open execution research because its owner document declares `synthetic_open_deepstore`.

The run produced **2,916 reporting cells**: 18 instruments × 3 presets × 6 rules × 3 horizons × 3 costs. These are correlated reports, not independent strategies. Depending on warmup, yearly walk-forward tests extend from 1998 through 2025.

## Primary MTF comparison

At five bps per side, using matched-window SPY returns, the MTF upper-decile rule's equal-ticker difference from unconditional common coverage was:

| Preset | 5 sessions | 21 sessions | 63 sessions | 21d events | 21d stocks beating baseline |
|---|---:|---:|---:|---:|---:|
| Swing D/3D/W | +0.0597 pp | +0.2158 pp | +0.3853 pp | 1,418 | 7/14 |
| Position 3D/W/2W | +0.1322 pp | +0.1751 pp | +0.1795 pp | 1,000 | 8/14 |
| Full D/3D/W/2W/1M | +0.2224 pp | +0.8475 pp | +1.5666 pp | 961 | 9/14 |

Against the daily-only momentum rule at 21 sessions, the differences were +0.5080, +0.4936 and +1.1037 pp respectively.

These are descriptive event-return comparisons, not portfolio alpha or causal estimates. The sample is a current-survivor convenience set.

## Era warning

At 21 sessions / SPY / 5 bps, MTF minus unconditional coverage was:

| Era | Swing | Position | Full |
|---|---:|---:|---:|
| pre-2008 | -0.2826 pp | +0.1515 pp | +0.3887 pp |
| 2008-2009 | +0.6096 pp | -0.3045 pp | +0.3117 pp |
| 2010-2019 | +0.4670 pp | +0.5073 pp | +1.6621 pp |
| 2020-2022 | -0.0584 pp | +0.2700 pp | +0.9385 pp |
| 2023-2025 | +0.7776 pp | -0.5373 pp | +0.0154 pp |

The full composite is the most directionally consistent preset here, but its 2023–2025 advantage is nearly zero versus unconditional coverage. More timeframes are not assumed to be universally better.

## Delete-group sensitivity

For the primary 21-session / SPY / 5 bps cell, deleting any one ticker or any one calendar month overlapping selected outcome windows leaves the MTF-minus-baseline difference positive for all three presets.

For the full preset: full difference +0.8475 pp; leave-one-ticker-out range +0.5415 to +1.0073 pp (14/14 positive); leave-one-overlap-month-out range +0.7402 to +0.9943 pp (288/288 positive); 961 paired events across 797 decision dates and 259 decision months.

These are sensitivity diagnostics, not confidence intervals.

## Sparse extremes

The synchronized-oversold full-preset rule is not promoted despite large-looking means in some cells. At the primary 21-session cell it has only 38 events across 11 stocks.

## Reproducibility

The long-wave result manifest SHA-256 is `0527c9b8c45ad5bc765003c0d8f5ba610e2ac14d0e49a7dfdbc2fe245661eca3`.

All 59 declared result files were digest-verified against it. Full case evidence remains on M2 at `/Volumes/Mastermind/research/mtf779-804ed675-pilot/owner-longwave/results`.

The exact staged research candidate passed **192 scoped tests** covering point-in-time feature timing, executable outcomes, frozen experiments, screener/calendar contracts, benchmark panels, delete-group robustness, review regressions, and the single-ticker consumer.

`ingest/compare_mtf.py` runs the frozen six-rule study for exactly one explicit ticker using existing local data. It refuses unavailable/stale/incomplete/proxy inputs, requires a reserved holdout boundary, does not fetch data or overwrite source/public data, and exposes no production rank/trade authority.

## Remaining promotion gates

Before any production rank or stronger entry claim: validate point-in-time membership including historical exits/delistings; prove source/adjustment provenance; freeze the candidate and consume the reserved 2026 holdout once; run prospective shadow validation; complete current-head review/CI and product/browser proof.

The raw-pane UI lane remains separately held by its prior filesystem permission denial and is not changed here.
