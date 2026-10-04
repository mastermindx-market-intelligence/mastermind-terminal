# MTF momentum: frozen archived-data pilot and calendar guard

Status: **RESEARCH PILOT, NOT A VALIDATED ENTRY MODEL.** PR #779 remains draft, unmerged and not production accepted. This evidence is not a ranking or trading authorization.

## What was actually run

Twenty names were declared in PR #779 comment5964417352 before returns were examined: NVDA, AAPL, MSFT, AMZN, GOOGL, META, TSLA, AMD, AVGO, INTC, MU, JPM, XOM, UNH, SPY, QQQ, IWM, TLT, 0700.HK, 600519.SS. Seventeen corresponding files exist at Terminal `804ed6754591eef508f1a667000608a8ab9167f9`. Every available file was independently checked against the immutable Git tree/blob and the census SHA-256. The three missing files were not replaced with convenient alternatives.

All decision, training, feature and outcome inputs were cut strictly before **2026-01-01**. The 2026 period remains reserved, not consumed or optimized against. Full input-file hashes can include later bytes; that is a provenance identifier, not permission to use those prices.

The current six-rule recipe was reused without tuning: unconditional common coverage; daily momentum upper decile; multi-timeframe swing-score upper decile; trailing-bottom-position upper decile; daily reclaim with weekly support; synchronized oversold. Horizons were 5/21/63 sessions and assumed friction was 0/5/25 basis points **per side**. There are 54 reporting cells per ticker, not 54 independent discoveries. The same next-observed-open outcome owner supplied both ticker and SPY/QQQ benchmark returns.

## Data findings that change implementation

- Sixteen archives contain 1,134 pre-2026 sessions from June 28, 2021 through December 31, 2025, with no missing dates relative to the observed SPY archive over the same interval.
- META has **90 missing reference sessions**, January 31 through June 8, 2022. It was withheld before outcomes were evaluated. Ordered, duplicate-free OHLC is insufficient to prove a complete session grid.
- UNH, 0700.HK and 600519.SS are absent from this archived sample. This is not a statement about live production coverage.
- At the development cutoff, only **54 monthly observations are knowable** under the existing next-bucket availability convention. None of the available names meets the 78-bar monthly composite warmup. Full five-timeframe setup scores therefore remain absent; this does not prevent separately plotting a warmed raw stochastic series.
- Only **2025** qualifies as a test year after the frozen three-year training and common-coverage requirements. This pilot does not test multiple out-of-sample regimes or demonstrate cross-country effectiveness.

The initial MiniMax census was useful for file identities but was not accepted wholesale. Its governance-directory lookup used the wrong repository; its monthly count did not account for availability; and its integrity checks missed the META gap. Parent verification and the actual kernel supersede those conclusions.

## Matched-event benchmark diagnostic

The new `signal_layer/mtf_panel.py` attaches a benchmark return only when the decision session, next-open entry session and horizon-end session match exactly. It never forward-fills a missing benchmark date, drops an unresolved observation, or refits a signal. Equal-ticker summaries prevent a high-frequency name from dominating merely by event count. Different rules still select different dates: subtracting their means is descriptive, not a paired treatment-effect estimate or investable portfolio return.

### Five-basis-point-per-side slice (SPY benchmark)

Values are equal-ticker means of arithmetic event excess return, in **percentage points**, not annualized performance. Counts are matured paired events; cross-name events are correlated.

| Frozen rule | 5-session excess / events | 21-session excess / events | 63-session excess / events |
|---|---:|---:|---:|
| Unconditional common coverage | +0.4204 / 588 | +2.6009 / 132 | +10.3727 / 36 |
| Daily momentum upper decile | +0.0760 / 148 | +1.3032 / 78 | +10.2709 / 33 |
| Multi-timeframe swing-score upper decile | -0.0700 / 110 | +3.2586 / 54 | +10.3302 / 28 |
| Daily reclaim with weekly support | -0.1903 / 65 | +1.7955 / 40 | +7.4647 / 22 |
| Trailing-bottom-position upper decile | +1.8686 / 120 | +2.7733 / 39 | +9.7372 / 18 |
| Synchronized oversold | +3.5422 / 12 | +4.2799 / 7 | +14.8229 / 5 |

The first four rows have twelve contributing stocks. Bottom-position contributes eleven; synchronized oversold contributes only five. Rule-minus-baseline comparisons in `summary.json` use each rule's common ticker set, not a mismatched twelve-name baseline.

The MTF rule's difference from unconditional coverage is **-0.4904, +0.6577 and -0.0425 percentage points** at the three horizons. Only 4/12, 5/12 and 5/12 names improve respectively. Its 21-session difference shrinks to +0.2516 percentage points against QQQ. This is mixed evidence, not a broad timing advantage.

The seemingly attractive synchronized-oversold row has just seven 21-session events across five stocks. Three decisions occur on April 7-8, 2025, and all seven are in January-April 2025. Five 63-session observations cannot substantiate a dependable bottom-entry rule. No rule was declared the winner, no weights changed and no final holdout was opened.

## Delivered calendar protection

The offline request may supply a bounded `session_calendars` map and optional per-ticker `calendar_id`. These are explicit **caller-supplied owner observations**, not a newly invented exchange calendar. Missing references, malformed dates and incomplete/gapped history cannot silently become research-ready. The guard runs before indicator aggregation and historical analog selection; bad history gets `incomplete_history`, no score and no analogs. Without a supplied calendar, the output explicitly says `not_provided`, not verified.

The actual CLI was run on all twenty archived names at December 31, 2025. Swing: **16 research-ready, 1 incomplete-history, 3 missing-data**. Full: **16 insufficient-history, 1 incomplete-history, 3 missing-data**. Both retain `production_rank_authority=false`. The SPY date reference is explicitly labeled observational and does not certify listing suspensions, every exchange holiday, corporate actions or upstream data completeness.

Actual CLI artifact SHA-256s: swing `ecd30390aa20872324a0b55012095bb517685da5c21b4df96efa900a9682dd84`; full `400283065896a7371d16c16b4784e02b9c5f385f79a58e555d6fbfefc78f008a`.

## Verification and reproducibility

- Existing kernel at `804ed675` plus the new panel first produced 123 passes and four failures on pandas 3.0.5: unknown phase values became NaN instead of the explicit None required by product goldens. Commit `3b0e3784e0ca3d6ed7471c4573758e6be47f9a8e` fixes only the phase column's object dtype. The corrected kernel/panel then passed **127 tests**; no numerical formula or threshold was changed.
- The calendar extension and existing CLI regressions passed **156 tests** on the same M2 runtime. The explicit-null calendar-reference regression was observed red before the fix. The initial CLI calendar test failed because the old strict request schema did not support calendars; it is not evidence of silent field acceptance.
- The real pilot completed **864 ticker/configuration cells**, sixteen eligible names times six rules times three horizons times three cost assumptions. Its eighteen benchmark/horizon/cost summaries retain all six rules and per-ticker contributions.
- All 35 referenced full-result files were independently digest-checked against `pilot-output/manifest.json`; that manifest's SHA-256 is `f316925607c5ca97981c25b5ea045ec1c2a143e712d7dd520104d55f7249c371`.

`summary.json` contains every aggregate cell, per-ticker contribution, data-quality state, rare-event decision date and full-result digest. `data-verification.json` binds the exact archived price files. `source-manifest.json` and `panel-source-manifest.json` bind inputs; the later null-dtype repair is identified in the embedded pilot manifest. `original-runner.py` preserves the executed frozen recipe and its original research-host paths, not a portable installation command. `validation.json` retains the actual bounded validation outputs. The two request files reproduce the CLI consumer cases against the same archived input files.

Full research artifacts remain under `/Volumes/Mastermind/research/mtf779-804ed675-pilot/pilot-output` on M2. They are evidence, not a second price-data owner or production publication. No claim of fresh market data follows from this snapshot.

## Next research boundary

The GLM Flash source census identified the existing Macro `data/stocks/<SYM>.parquet` loader and Terminal nightly deepening paths; these should be reused rather than inventing a parallel data pipeline. Parent source verification confirms that Terminal's deep-store chart emitter reconstructs the opening price from the prior close and labels it `synthetic_open_deepstore`. Such bars are **not eligible for next-open execution backtests**. The worker's statements about complete IPO calendars, all delistings and rights are not adopted as proven facts; these require inspection of their actual data owners. M2's default Macro stocks directory currently contains only SATS, so that default does not establish availability of this sample's deep history.

The next admissible empirical increment requires longer true-OHLC history, explicit adjustment/source provenance, session continuity and point-in-time membership. Keep the original indicator families and frozen pilot as baselines. Use separate development and evaluation intervals, test across distinct historical environments, and evaluate false positives, adverse excursion, opportunity rate and practical execution alongside forward returns. Do not solve the short-data problem by silently reducing monthly warmup or selecting the best-looking current pilot rule.

## Unfinished product and release obligations

The same-PR raw indicator panes, ordinary post-load add/remove lifecycle, current-data consumer and multi-timeframe screener UI still require full user-path proof. The M1 raw-pane filesystem grant remains held; neither these research changes nor worker completion clears it. Production release requires the existing independent review, current-head CI, protected-master merge, git-gated deployment and actual desktop/tablet/mobile verification. No new scheduler, provider account, entitlement, trade-sizing authority or automatic promotion was created.
