# Reversal & Reclaim A1 — confirmation-time contract and proof

**Owner:** Sol. **Carrier:** Terminal PR #602 / `CHART-RECLAIM-A1-20260917-SOL-001`.
**Approved mission:** repair chart-to-alert truth before delivering the Reversal & Reclaim workspace. This child does not complete the parent charting programme.

## What changed

The existing RSI reversal and RSI/Pulse/MACD divergence producers now carry their actual `confirmedAt` input-bar index without moving their chart anchors or changing detection math. The shared alert and sequence evaluators and the sidecar demonstration use one strict `suiteEventTiming` resolver. A divergence anchored at bar 100 but first knowable at 105 is fresh at 105, not rejected as five bars old.

The actual sidecar had another producer-to-consumer defect: it cast the metadata-only registry to the runtime type. The host skipped all modules without `compute`, silently producing an empty tape. It now awaits the existing `ensureSuiteRuntime` loader; a missing runtime raises a compute error rather than reporting a valid empty signal population. This reuses the existing implementation graph and keeps browser lazy loading unchanged.

## Clock meaning and compatibility

`i` is geometric/source anchor. `confirmedAt` is the first input-bar index containing all required confirmation evidence; absent means `i`. Explicit malformed, earlier-than-anchor, or out-of-range confirmations fail closed. Finite, coherently ordered source timestamps are required. These are source-bar identities, not knowledge-arrival timestamps and not evidence that a live exchange candle has closed. The input owner still owes completed-bar qualification.

Creation floors, freshness, sequence ordering, and expiry use confirmation. Existing unversioned `_se.lastFiredT` / `_sq.lastFiredT` keep their legacy anchor interpretation so repaired timestamps cannot re-deliver an already-fired anchor. A new successful fire writes `clockVersion: 2` and the confirmation watermark. No-fire arm/disarm persistence preserves the prior fire-clock interpretation. Unknown clock versions cannot trigger.

No new database, alert lifecycle, retry system, scorer, signal registry, or trading authority exists. Alert one-shot persistence stays with the current conditional PATCH owner. The original three-source-bar freshness window is unchanged.

## Discriminating proof

- Existing baseline: 346 tests passed before modification.
- Added first-availability regressions: 21 expected assertion failures and 4 passing guards before the repair, using the actual four producers over every prefix of a deterministic 240-bar series.
- Examples: RSI turn anchor 20 / confirmation 21; RSI divergence 100/105; Pulse divergence 134/139; MACD divergence 70/75.
- Two actual-sidecar integration tests initially failed after the pure-evaluator fix, exposing the metadata/runtime disconnect. They use real OHLCV files, real runtime loading, the real host/evaluator and real state serialization; only HTTP is mocked. They now prove no pre-confirmation delivery, one post-confirmation delivery, no resend on re-arm, and no false successful fire or watermark mutation after HTTP 500.
- Final full Vitest run: **334 files passed, 5,541 tests passed, 4 pre-existing TODOs**. No retries; maxWorkers=2/minWorkers=1. Duration 65.36 seconds.
- `npx tsc --noEmit`: passed, zero output.
- Existing production esbuild command: passed. The emitted standalone Node bundle finds the actual fixture RSI divergence at the confirmation date.
- `git diff --check`: passed.

## Read-only production-path input probe

At the probe, production served `a9b615f41fc44a6cc6a3588ef1aace26226b3eec`, the Terminal service was active, and the suite sidecar cron existed. The candidate bundle was executed locally against byte-identical copies of the production public bar files listed below. All data ended 2026-09-16; this is explicitly not a claim of a current intraday feed. No Supabase credentials were read, no customer alerts were sent, and no production file was changed.

| Symbol | Rows | Last source date | Source | Input SHA-256 |
|---|---:|---|---|---|
| AAPL | 11532 | 2026-09-16 | yahoo | `17a405a7caa1854d4a11436209a53f3fb03c6c89e8ea827f65a3992ba39cf1c9` |
| BTC-USD | 4383 | 2026-09-16 | yahoo | `59d9dd7fb124b9cd55627c0b1ada8c494603e8501048edd0a1080bc3aa977dfd` |
| INTC | 11720 | 2026-09-16 | yahoo | `c031917d3d6d0fee0bc489586862ccd06a85255e0dd7f2e97a30e836bf8381a5` |
| NVDA | 6955 | 2026-09-16 | yahoo | `6def843d622d54821f6173f26a957e55135114ad27eb20c98fd01b7109c9f372` |

All four bundled demonstrations exited zero. The real runtime generated nonempty historical tapes; fresh curated counts legitimately differed by symbol. Zero fresh events is accepted when computations actually ran; zero caused by metadata masquerading as runtime is not.

This is **local candidate / real production-input proof**, not deployed candidate or delivered live-alert proof. Release still requires the exact-head checks and review, coordinated canonical deployment, deployed-bundle identity and no-creds demo, and browser/product verification where owed. Existing alert data staleness and per-exchange source-close qualification are not silently solved by a source-index repair.

## Parent frontier and do-not-redo

A2: compose the existing chart modules into Reversal & Reclaim, link oscillator/price evidence, expose honest pending/confirmed states, and display original versus remaining reward/risk. A3: gap and structural lifecycle. A4: owner-native validated discovery and separately evaluated options expressions.

Do not reimplement existing RSI/Pulse/MACD, refresh the source audit from scratch, duplicate #601 intraday qualification, mutate #600 release preflight, replace #597 feed status, or claim this work completes TOI #7094. Keep profile snapshots distinct from causal historical events and retain autoOpt's explicit historical-restyling limitation.


## Independent review and repair
Native Codex review of 956013c3a6d17c1614fd581b55420800a7be6648 returned one P2: event endpoint checks did not reject duplicate/out-of-order timestamps elsewhere in the source clock. Reproduced with four failing regressions, including same-bar events that could otherwise complete a backward-time sequence. The repair adds one shared strict monotonic-clock validator at the real input loader and before both batch evaluators; it never sorts bars and silently changes event indices. Added an actual-sidecar malformed-file test: unreadable clock is unevaluable, not an empty valid population.

Post-review full suite: **334 files passed, 5,546 tests passed, 4 existing TODOs**. Typecheck, bundled real-production-input INTC demo and diff check passed. One intermediate full-suite run failed because an earlier captured test log inside terminal/test-results contained a literal matched by an existing all-extension source audit. Only this operation's logs were moved outside the application scan root; no product or audit test was weakened. The clean-root full run is the final receipt.

Organizational continuity remains owed to Macro Agent OS. Reading the remaining Macro guide was blocked by the tool safety layer; that read/records lane was frozen without retry through another carrier. No Macro record write or transfer is claimed. Terminal source/PR evidence remains durable here while independent Terminal work continues.
