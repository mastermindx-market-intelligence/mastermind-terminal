# Large Trades and Absorption Intelligence

Status: implementation and verification in progress, 2026-10-11. This document does not assert a production release or a predictive trading signal.

## Mission and source custody

Operation: `terminal-large-trades-absorption-20261011-sol-001`.
Branch: `sol/web-terminal-large-trades-absorption-20261011-sol-001`.
Workspace acquired through the installed `mmx-workspace` owner for repository `terminal`, from protected master `fc76cf495781e5f53254aa3c457411de0cb64654`.

Protected Mastermind procedures were recovered at immutable master `8d62a8571d2a6ad9da9d50e5e4624de6eecaac4c`, including the Sol skillpack INDEX, active execution, review/return, closeout, delivery and native-worker hierarchy. The current user authorized source implementation, tests, integration and the ordinary release path.

The requested `MASTERMIND_LARGE_TRADES_PRO_HANDOFF.zip` and its two Skylit reference screenshots were not available through the attachment/Library search. Work proceeds from the explicit mission. Exact screenshot acceptance remains unverified. Official ATAS Big Trades and Bookmap Volume Bubbles images informed the functional marker/inspection design; no branded assets are copied into the product.

Existing Macro TP1 PR8660, R0 PR8659, Terminal EOD PR895 and IEX acquisition PR841 retain their source carriers. This implementation does not mutate their branches or reproduce the existing Macro trade-signing or response authority.

## User-facing contract

Large Trades is an optional Volume overlay in the existing indicator registry. Its settings, visibility, chart ownership and replay cutoff use the existing Terminal paths.

The numerical label is **executed quantity** in the instrument's explicit shares/contracts unit. A separate report count counts normalized execution reports. Order count is unavailable. Several reports can refer to one order, and one execution report can summarize multiple matches. The fixture label 1,301 is 500 + 501 + 300 executed shares from three synthetic reports; it establishes no order count.

Markers use transaction price, not a candle's volume or estimated buy/sell split. Unknown side remains unknown. Native exchange aggressor, passive-order-derived side and qualified quote-rule inference remain distinct. A circle's bounded area scales with quantity; the numerical label retains the exact uncapped quantity. Display thinning reports both the qualifying count and retained count.

The inspector exposes individual reports, quantities, prices, exact event/availability times, conditions, source identity and evidence clocks. Historical, delayed, fixture, stale and unavailable states remain visible. Historical IEX data carries the required attribution and terms link.

## One source contract, no second data plane

`terminal/lib/largeTrades/types.ts` defines `mastermind.large_trades.v1`.

- Prices are exact safe integers divided by explicit `priceScale`; quantities are positive exact integer shares or contracts.
- Nanosecond event, original availability, acquisition and replay clocks are decimal strings, preserving precision beyond JavaScript floating-point timestamps.
- Each execution/cancel has a stable native identity, source sequence, scoped session, conditions, eligibility and side method.
- Each envelope declares provider, dataset, venue/consolidated scope, mode, receipt basis, source reference/hash, coverage, gaps, attribution and source range.
- A qualified response midpoint is supplied by the admitted quote-response owner. Candles and execution prices cannot masquerade as quote-response evidence.
- Live provenance requires contemporaneous original-receive evidence and zero declared delay. Delayed evidence requires a positive declared delay. Historical replay requires archive acquisition, with source events no later than acquisition and record availability no earlier than acquisition.
- Publication cannot precede any included record's availability. Missing or malformed provenance refuses.

The read-only `/api/large-trades?sym=SYMBOL` route consumes `large_trades/SYMBOL.json` from the existing `MACRO_LIVE_DIR` published root (default `/var/lib/macro-live/public/live`). It authenticates through the existing server auth path, rate-limits requests, bounds reads, rejects final symlinks, validates the exact symbol/contract and returns a digest of the admitted bytes. Missing source data returns an explicit unavailable result. A non-production, explicitly enabled E2E fixture branch is separate from the real source.

This feature creates no provider socket, credential store, entitlement authority, vendor gateway, quote signer, background collector or alternate production publisher. The existing source owner must qualify and publish production artifacts. Continuous or adjusted futures chart aliases cannot silently stand in for an identified native expiry/price basis.

## Causal clustering and correction semantics

The pure engine requires both a market cutoff and a knowledge cutoff. It processes only records admitted by both. For equal original availability, session scope precedes the native sequence tie-break.

Groups form in source-availability order. Members must agree on session, side and side method; exchange event times must not decrease. Both event and receipt gaps, total event duration and price span are bounded. Without a qualified tick size, aggregation is limited to identical prices.

A late earlier-event report cannot reopen a closed group. This preserves the feature information that was actually available at a later decision. Historical archive availability is acquisition time, so its receipt-gap behavior is historical reconstruction, not a claim about original arrival latency.

Adaptive calibration uses at most the configured count of prior, completed, same-session groups whose event end precedes the new group. The percentile is computed from their currently known positive quantities and **frozen when the new group opens**. The current group never calibrates itself. Insufficient history abstains.

Duplicate economic reports count once. Conflicting stable identities are quarantined. Full breaks must match the original identity, session, price, quantity and event ordering. Unknown or mismatched breaks do not subtract volume. A pending break is resolved before a late original enters a group or baseline. Repeated breaks cannot subtract twice.

A correction changes its directly affected group's remaining quantity and revision knowledge time. It changes future calibration, while preserving already frozen thresholds. Stable group identity and original response-window boundaries survive removal of first/last members. Exact active report times remain separately available. These semantics were added after independent review reproduced a backdated adaptive-marker defect.

The engine conserves eligible source quantity before any display limit. It refuses numeric overflow. Its price-times-quantity numerator is exact integer arithmetic; for futures it is not a currency notional because no contract multiplier is implied.

## Response and absorption evidence

This is descriptive research, with `predictiveSignal: false`.

A response is pending until the group has causally closed and its fixed market-time window has matured. The close horizon respects both event-time grouping limits and original availability. Knowledge time includes closure, corrections and every quote observation that affects the result.

Inference requires complete transaction coverage, resolved source integrity, a known execution side, qualified tick size and complete qualified quote-response coverage. The anchor is strictly before the original group start. The endpoint is the latest observation at or before the fixed deadline; an invalid latest quote never falls back to a convenient older quote. Ties abstain. Effective quote age includes both the quote's age at observation and elapsed time to the measurement.

The output distinguishes:

| State | Meaning |
|---|---|
| Pending | Cluster or response evidence has not matured or arrived |
| Unobservable | Required source, side, tick or quote evidence is absent or unqualified |
| Continued | Fixed-window price change continued with observed execution-side pressure |
| Failed continuation | Fixed-window price change reversed against that pressure |
| Limited response | The fixed-window net midpoint change was within the configured bound |
| No pattern | Qualified observations did not meet the declared response conditions |

An **absorption candidate** additionally requires a qualified full path whose maximum absolute midpoint excursion stays within the limit. A strong continuation followed by a large round trip can have a small net endpoint change and still fails candidacy. A candidate is not evidence of a trapped participant, iceberg, replenishment, unexecuted order count, causal trading edge or recommended trade. No ranking, alert, sizing, entry or Prophet authority is created.

## Real IEX historical lane

The offline adapter and native-field details are documented in [IEX_LARGE_TRADES_DECODER.md](IEX_LARGE_TRADES_DECODER.md).

The official October 5 DPLS HIST archive was already acquired on October 7. The bounded decoder reads PCAPNG → Ethernet/IP/UDP → IEX-TP v1 → DEEP+ protocol 0x8005. Both L displayed-order executions and T nondisplayed-vs-nondisplayed executions count. B breaks target either type. Order-book changes are never themselves executed quantity.

Initial qualified scan:

| Measurement | Result |
|---|---:|
| Packets / unique transport messages | 2,000,000 / 2,321,530 |
| Decompressed prefix bytes | 312,182,060 |
| L / T execution reports | 275 / 1,410 |
| Selected executed shares | 141,057 |
| Observed gaps / unknown message types / breaks | 0 / 0 / 0 |
| Coverage | Explicit partial premarket/opening prefix; packet-limited |

Symbols: SPY, QQQ, NVDA, AMD, INTC, MU and ARM. This is IEX-only equities in shares. It is neither consolidated US market volume nor MNQ contracts. The selected observations span roughly 12:01:29–13:30:38 UTC, with symbol-specific starts. Later session breaks have not been examined. Break correctness is presently fixture-proven.

Decompressed-prefix SHA256: `3b173fd73113318e5db6ac0d232c19f7a7aaa25b55bd92228b66b17406a9fe5d`.
Decoder receipt SHA256: `c372d5b41afba4aa8282a2fe13e4e24cd5e936f105963ec4d7047d292f43ac28`.
The acquisition receipt records full-archive SHA256 `2e41ba84c2a24ccd541d079c2bb05a6da38e988790d8e97a19c1527b1195b0dd`; this operation did not independently rehash all 9.9GB or reach the final gzip checksum.

Official HIST terms require attribution and a link. September 2026 IEX policies §15 exempt compliant HIST recipients/users/distributors from a Data Subscriber Agreement. This applies to official HIST releases; old privately retained live data does not acquire those rights merely through age.

- [IEX HIST terms](https://www.iex.io/legal/hist-data-terms)
- [IEX market data policies](https://www.iex.io/documents/iex-market-data-policies)
- [DEEP+ specification](https://www.iex.io/documents/iex-deep-plus-specification)
- [IEX-TP specification](https://www.iex.io/documents/iex-tp-v1)

Private normalized/native payloads and working evidence remain outside Git. Only reviewed code, synthetic fixtures, sanitized receipts, documentation and appropriate verification images belong in the source return.

## Validation and out-of-sample research

Deterministic tests cover execution/quantity separation, input rejection, idempotency, corrections, late arrivals, price/session/side boundaries, adaptive warmup and frozen thresholds, two-clock replay, source quality, additive quote age, pending maturity, path excursions and adverse continuation. Original regressions and independent-review counterexamples remain in the suite.

The first real-data consumer check conserved all 141,057 shares, showed zero prints before archive acquisition and granted no absorption evidence. It must be rerun on the integrated final engine hash; earlier receipts identify their exact reviewed code.

Out-of-sample predictive validation is **not estimable** from the current partial, single-session, quote-unqualified slice. No success rate or alpha claim is made. Before obtaining outcomes, freeze:

1. Native contract/venue/session cohort, data-quality exclusions and independent source-volume reconciliation.
2. Detection settings, response origins/windows, correction policy and minimum baseline.
3. Chronological training, untouched validation and held-out sessions with no overlapping response windows across boundaries.
4. Report-level prefix invariance, as-seen availability, late-correction controls and repeated-query limits.
5. Baseline comparisons to matched activity/volatility/time-of-day controls, trend continuations and round trips.
6. Coverage/abstention rates, session-clustered uncertainty and the full trial count. Transaction costs and multiplicity must be included before any predictive use.

The current manual defaults are implementation settings, not parameters optimized against the IEX outcomes. The genuine IEX slice proves decoding and rendering mechanics; missing quote-response evidence is an explicit negative control.

## CME/MNQ approval and cost boundary

No CME/MNQ execution entitlement or spend was established in this session. Existing candle/reference feeds and statistically derived Tiingo price/liquidity thresholds are ineligible substitutes.

Current published Databento CME pricing shows a personal Standard plan at USD199/month, with license fees included for up to two personal devices. It is not the proposed multiuser Terminal distribution contract. Plus lists USD1,750/month plus license fees, requires an annual contract, and supports external distribution; the base annual commitment is USD21,000 before applicable exchange charges.

CME's June 2026 fee schedule has separate distribution, feed, display and non-display categories. Examples include real-time distribution USD29,280/year, real-time data-feed access USD610/month and Category C basic non-display USD363/month. These are category rates, **not an additive quote** or an established charge for Mastermind.

The exact procurement action is an approved written quote and entitlement for GLBX.MDP3 native MNQ trades and qualified quotes, with exact expiry/symbology, commercial web distribution, user/device counts and server-side analytical use. MBO/replenishment research is a separate scope. Vendor/exchange applicability and user classification must be settled before approving a final amount or connection. No purchase or sales outreach was performed.

- [Current Databento pricing](https://databento.com/pricing/)
- [CME June 2026 fee schedule](https://www.cmegroup.com/market-data/files/june-2026-market-data-fee-list.pdf)

## Integration and release acceptance

Existing Terminal CI and source-fingerprint requirements apply. A ChartPanel change requires actual visual-intelligence and options-axis recaptures before their source hashes are refreshed. The protected terminal/public/data tree is unchanged by this design.

Production deployment must use the incumbent `/opt/terminal/terminal-build.sh --target-sha <full accepted SHA>` owner after the ordinary source/CI/review gates. The obsolete local rsync deployer and Vercel are not release paths for this operation.

The earlier canonical VPS/Quote Hub root SSH attempt was refused with publickey denial, and the Massive real-time socket's incumbent custody remains unproven. No alternative user, key, host, second socket or CI-manifest workaround is authorized by this source return. The separate denied Macro TP1 CI enrollment remains on its original carrier.

Completion requires an accepted source commit, actual deployment receipt, authenticated published-source read, correct historical/live provenance and responsive browser proof on the user-facing capability. A local fixture screenshot, real-payload browser interception, passing suite or draft PR alone does not satisfy that acceptance.
