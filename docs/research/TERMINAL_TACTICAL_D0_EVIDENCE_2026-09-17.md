# Terminal Tactical D0 — real-input qualification evidence

Operation: `terminal-tactical-intelligence-d0-20260917-sol-002`. Parent: Terminal #598. Chairman approved the price-first design and this milestone on 2026-09-17. This report does not claim the parent product is complete.

## Implemented capability

The offline consumer now reads existing Terminal intraday files, fingerprints the bytes, verifies store identity and bar structure, uses the existing Macro-derived calendar, separates observed intervals by session, and emits a machine report plus a human-readable projection. Its pure cutoff view rejects unfinished bars and bars unavailable at the decision time. It adds no live evaluator, store, provider fetch, calendar, signal, or order path.

## Real input result

Inspected the published static history files for eleven pilot symbols at 1m/5m/1h. The 1m static paths returned HTTP 404 for all eleven; all eleven 5m and all eleven 1h documents were retrieved and structurally parsed. INTC was deliberately not queried: its three pilot cells remain held, preserving the earlier blocked live-target operation. A static-path 404 is not proof that Massive lacks the data or that the account lacks entitlement.

The local report contains 22 available and 14 missing cells. Those 14 consist of eleven unmaterialized 1m cells and three deliberately unrequested INTC cells. They are not fourteen vendor coverage failures. The capture inventory preserves that distinction.

Requested evidence window: 2026-08-17 through 2026-09-16, cutoff 2026-09-16T20:00:00Z. Every one of the 22 readable files ends its observed regular sessions on **2026-09-11**, with no regular observations on **September 14, 15 or 16**. This establishes a static-history gap, not a live-quote or whole-provider outage.

| Symbol | 5m observed window bars | 1h observed window bars | 1h boundary-straddling bars | Latest regular date |
|---|---:|---:|---:|---|
| AMD | 3504 | 304 | 19 | 2026-09-11 |
| NVDA | 3648 | 304 | 19 | 2026-09-11 |
| MU | 3648 | 304 | 19 | 2026-09-11 |
| AVGO | 3634 | 304 | 19 | 2026-09-11 |
| QCOM | 2772 | 303 | 19 | 2026-09-11 |
| SMH | 3252 | 304 | 19 | 2026-09-11 |
| QQQ | 3645 | 304 | 19 | 2026-09-11 |
| SPY | 3637 | 304 | 19 | 2026-09-11 |
| AAPL | 3640 | 304 | 19 | 2026-09-11 |
| JPM | 2413 | 299 | 19 | 2026-09-11 |
| XOM | 2629 | 301 | 19 | 2026-09-11 |

For SPY and NVDA specifically, the window contains 1,482 regular five-minute starts against 1,716 nominal slots: 19 observed sessions versus 22 expected. Grid occupancy is not feed completeness. Differences in extended-hours occupancy across names do not establish an outage or a trading signal.

Every readable store lacks a per-observation availability receipt. Consequently the as-observed consumer returns **zero** legacy observations; corrected-history mode returns eligible closed observations but remains explicitly non-PIT. A fresh fetch, file timestamp, source `asof`, or current digest does not repair historical knowledge time.

The selected local fixtures found during recovery contain only 277 bars each and no ticker/grain/source metadata. The real CLI rejects all five as invalid identities rather than promoting them to full research histories.

## Verification actually run

- Initial clock/cutoff test failed because the module did not exist; the first CLI subprocess test failed because the entrypoint did not exist.
- Adversarial tests failed on inspecting future/unavailable corrupt prices, mutable OHLCV, extreme integers and inconsistent error types; each was fixed and re-tested.
- Focused suite: **46 passed**, including six pre-existing ingest-guard tests; no new-suite skips.
- Full Python suite: **1,125 passed, 8 skipped, 1 warning**. Seven skips are existing golden-contract/deep-store inputs absent locally; the eighth is an existing migration-ledger shape not present. The warning is the existing synthetic duplicate-prefix proof. These are not represented as a zero-skip integration pass.
- `compileall` succeeded for both new source modules. Hosted CI, independent review, merge and deployed execution are not established by these local tests.

## Evidence identities

Raw licensed inputs remain private in the existing agent-evidence area; none is committed. Reports carry counts, missingness and hashes, not price histories.
- `pilot-static-inventory.json`: `59c50ed405bd76c083a1d2beb20cf25edd6f4bd892c3e55fd38d21a66bef642b`.
- `pilot-qualification-corrected.json`: `5350f6df0f770b9ef156822f883d2ed4dc112bfb79a769c45eceac1e9f6fdc6e`.
- `pilot-qualification-as-observed.json`: `ff99a1b5e1d24d079bb583d377273296cf79074b63d9d302f5b705b8a4a0462e`.
- `curated-fixture-rejection.json`: `fc2bde14a5e95c1df6ce38d9151dea79d01aec9d259c4a3ff91d3b90e1f4b573`.

Calendar projection: `d803dc85fcf3318bc78392e1d645b7063881b86eec95cf06f51192e1d836de98` from Macro `112eba2036fd1186e67b914e194f4fa541cfc4df`.

## Integration and next dependency

Terminal #595 remains the refresh repair owner, unchanged at the independently observed head ba7c48cf58b2a04deb5b566655e8e61721caca3b. Initial SPY/NVDA evidence was posted there as comment 5720223535; it is an evidence return, not approval or execution. Its existing-only mode does not by itself create missing one-minute histories.

The next product dependency is qualified, current input coverage and a registered price-first experiment inside existing Radar/Setup Species/Evaluation ownership. Extend the existing data producer only after reconciling its writer and release state; do not add another updater or route around the held INTC operation. Recorded after-hours/premarket bars are not proof of 20:00–04:00 overnight coverage.

D0 capability state: **BUILT_NOT_PROVEN for release**, with real archival-input machine proof locally. No live signal, strategy accuracy, P&L, active worker, or production scanner has been claimed.
