# Nine-Bar Exhaustion — Snapshot Research Results

Status: reproducible descriptive receipt; **not** point-in-time causal validation and **not** a reversal-probability promotion.

## Receipt

- Canonical algorithm: `nine-bar-v1.0.0`
- Source Git head at execution: `46318a8f50b1c679959f268579743ef391767e22`
- Research engine SHA-256: `b246c13ab21eaed5e485e3804807ce384e2ef478af566ad5526cc7af18e891a2`
- Machine-readable receipt SHA-256: `12fa17bc064d56681c67e127ebc9026ac91b2fa9dbc01706d84fb17a63b97975`
- Admitted series: 34 (30 US equities/ETFs; 4 crypto)
- Date coverage: 2021-06-28 through 2026-06-26
- Bars: 39,919; primary first-cycle nines: 1078; repeat-cycle nines: 103; matched primary nines: 273

## What the snapshot says

The tables report returns in the hypothesized reversal direction: positive is favorable to fading the completed directional run; negative means continuation dominated. Entry is the next admitted daily open after confirmation. Same-bar 1-ATR favorable/adverse touches remain ambiguous.

### Is nine special versus neighboring streak lengths?

| Endpoint | N (5-bar available) | 5-bar signed return | 5-bar reversal rate | N (10-bar available) | 10-bar signed return | 10-bar reversal rate |
|---:|---:|---:|---:|---:|---:|---:|
| 6 | 2458 | 0.11% | 43.78% | 2421 | 0.06% | 49.90% |
| 7 | 1872 | -0.04% | 43.12% | 1846 | -0.18% | 50.00% |
| 8 | 1449 | -0.09% | 44.08% | 1426 | 0.07% | 50.25% |
| 9 | 1066 | -0.28% | 43.98% | 1049 | -0.38% | 50.48% |
| 10 | 784 | 0.02% | 41.63% | 777 | -0.47% | 48.20% |
| 11 | 612 | 0.15% | 46.56% | 608 | -0.30% | 50.33% |

### Primary nine by chronological split

| Split | N (5-bar available) | 5-bar signed return | 5-bar reversal rate | N (10-bar available) | 10-bar signed return | 10-bar reversal rate |
|---|---:|---:|---:|---:|---:|---:|
| development | 635 | -0.60% | 43.85% | 625 | -0.81% | 50.32% |
| validation | 217 | 0.23% | 41.94% | 215 | 1.18% | 48.37% |
| holdout | 214 | 0.16% | 46.48% | 209 | -0.73% | 53.14% |

### Matched event-minus-baseline effect

| Split | Horizon | Matched pairs | Symbols | Match rate | Return difference | Cluster-bootstrap 95% CI | Reversal-rate difference | 95% CI |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| all | 5 | 273 | 34 | 25.32% | -1.60% | -2.66% to -0.69% | -9.52% | -17.97% to 0.00% |
| all | 10 | 273 | 34 | 25.32% | -1.44% | -2.68% to -0.24% | -11.36% | -20.74% to -1.77% |
| holdout | 5 | 18 | 15 | 8.18% | -2.19% | -5.06% to 0.77% | -11.11% | -43.77% to 22.22% |
| holdout | 10 | 18 | 15 | 8.18% | 1.09% | -1.88% to 4.74% | -33.33% | -68.45% to 12.50% |

### Friction sensitivity for primary nines

| Split | Horizon | Per-side cost | N | Mean net signed return |
|---|---:|---:|---:|---:|
| all | 5 | 1 bps | 1066 | -0.30% |
| all | 5 | 5 bps | 1066 | -0.38% |
| all | 5 | 10 bps | 1066 | -0.48% |
| all | 5 | 25 bps | 1066 | -0.78% |
| all | 10 | 1 bps | 1049 | -0.40% |
| all | 10 | 5 bps | 1049 | -0.48% |
| all | 10 | 10 bps | 1049 | -0.58% |
| all | 10 | 25 bps | 1049 | -0.88% |
| holdout | 5 | 1 bps | 214 | 0.14% |
| holdout | 5 | 5 bps | 214 | 0.06% |
| holdout | 5 | 10 bps | 214 | -0.04% |
| holdout | 5 | 25 bps | 214 | -0.34% |
| holdout | 10 | 1 bps | 209 | -0.75% |
| holdout | 10 | 5 bps | 209 | -0.83% |
| holdout | 10 | 10 bps | 209 | -0.93% |
| holdout | 10 | 25 bps | 209 | -1.23% |

## Product decision

The static holdout does not establish a stable positive matched effect whose uncertainty excludes a trivial or negative result. Ship the mathematically correct descriptive study, but withhold reversal probability, calibrated ranking, and Buy/Sell language.

For reference, all-sample matched return differences are -1.60% at 5 bars and -1.44% at 10 bars; holdout differences are -2.19% and 1.09%. These are snapshot associations, not causal performance.

## Coverage and limitations

- The repository panel is a current corrected snapshot, not a point-in-time availability receipt.
- The current universe omits delisted constituents and historical membership, so survivorship and selection bias remain.
- Per-bar corporate-action provenance is not independently certified; >30% gaps split segments but do not prove adjustment correctness.
- Daily OHLC cannot order favorable and adverse intrabar threshold touches; same-bar ties are reported as ambiguous.
- Matched estimates use prespecified observable price/volatility buckets but cannot remove unmeasured confounding.
- CN/HK and broad intraday panels are absent from the admitted snapshot, so cross-market and intraday generalization is unproven.
- No result from this module is a live score, probability, alert, trade instruction, or scientific promotion receipt.
- Current repository inputs contain no admitted CN/HK panel and no committed broad intraday corpus; those claims remain unavailable.
- Input files and hashes are preserved in the machine-readable receipt; no vendor marketing hit rate is treated as Mastermind evidence.

## Reproduction

From `terminal/` with dependencies installed:

```bash
node_modules/.bin/vite-node scripts/run-nine-bar-research.ts
```

The command rewrites this report and `NINE_BAR_RESEARCH_RESULTS_2026-10-13.json` from the admitted JSON panel and the canonical TypeScript kernel.

## Input manifest summary

| Symbol | Market | Bars | First | Last | Source | SHA-256 (prefix) |
|---|---|---:|---|---|---|---|
| AAPL | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `e8d82ed9fbca3e83…` |
| AMD | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `c2d36d1ae112e1ec…` |
| AMZN | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `fc00fec58299d158…` |
| ARM | us | 698 | 2023-09-14 | 2026-06-26 | polygon:real_ohlc | `1cc4a48f3bca230e…` |
| AVGO | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `afa5f1cb330b77b6…` |
| BTC-USD | crypto | 730 | 2024-06-27 | 2026-06-26 | polygon:real_ohlc | `3433983e9c1ed1d7…` |
| COIN | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `f5115425e94bd024…` |
| COST | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `459a508321ca8240…` |
| CRM | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `a47d2af96862e6b5…` |
| DIA | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `4be23756abc9c2d9…` |
| ETH-USD | crypto | 730 | 2024-06-27 | 2026-06-26 | polygon:real_ohlc | `bd420034c6b59ea3…` |
| GLD | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `4eea2de16cc7dc34…` |
| GOOGL | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `94a2f9c9342fe407…` |
| INTC | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `5c0b6ad48fc6fd76…` |
| IWM | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `a20ce729c941e17a…` |
| JPM | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `0c87d1c5fc48d708…` |
| LLY | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `426efa486e943c97…` |
| META | us | 1163 | 2021-06-30 | 2026-06-26 | polygon:real_ohlc | `e90cd58578a7ad45…` |
| MSFT | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `0689bb3965059c14…` |
| MSTR | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `7ea3f2efab0faf0b…` |
| MU | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `5e7a301534c962d4…` |
| NFLX | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `b84fa89c4c5195be…` |
| NVDA | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `9958c189fa1e967c…` |
| PLTR | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `4d6ac04e944ee800…` |
| QQQ | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `acf6154224152f56…` |
| SMCI | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `f1cfde443ad19e62…` |
| SOL-USD | crypto | 729 | 2024-06-27 | 2026-06-26 | polygon:real_ohlc | `59d385a771c638ba…` |
| SOXL | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `4efb1160f591080f…` |
| SPY | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `56f5f58ce2b309ad…` |
| TLT | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `c65a72ae6b0eca87…` |
| TSLA | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `cd7b08d5a4abac15…` |
| V | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `d017b62ae0c40d7d…` |
| XOM | us | 1255 | 2021-06-28 | 2026-06-26 | polygon:real_ohlc | `2e93a17e3f00b796…` |
| XRP-USD | crypto | 729 | 2024-06-27 | 2026-06-26 | polygon:real_ohlc | `e64941716ec66fd0…` |
