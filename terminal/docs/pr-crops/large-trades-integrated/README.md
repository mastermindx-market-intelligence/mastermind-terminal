# Large Trades — integrated browser evidence

This packet records the repaired Large Trades chart overlay and native PNG exporter. Local source and responsive browser acceptance passed. Production deployment, feed publication, and the authenticated production journey remain unproven.

## Source and execution identity

The complete feature matrix ran from **2026-10-11 12:18:30 to 12:25:14 UTC** against reviewed working-tree bytes on base `0c87bb10f237ecb18d074298299f027eb8b46783`. Those ten files were subsequently committed, without byte changes, as `95a7cac298a99671eb392ff0050fb7b9223ead4e`. The [manifest](manifest.json) preserves both identities, source hashes, exact run-receipt identities, 60 project/test results, 77 original PNGs, and 18 proof JSONs. The [independent review](review.json) closes the seven commissioned findings within the recorded local scope.

| Project | Passed | Intentional skips | Failed |
| --- | ---: | ---: | ---: |
| Desktop 1440×900 | 20 | 0 | 0 |
| Tablet 820×1180 | 13 | 7 | 0 |
| Mobile 390×844 | 13 | 7 | 0 |
| Total | 46 | 14 | 0 |

There were no retries, flaky results, or report errors. Seven dedicated desktop cases cover minimum-pane geometry, compact controls, asynchronous freezing, pending source ownership, independent RSI instances, linked charts, and a pending native-layout capture. The general responsive journeys and real historical IEX export ran on all three projects.

## What the evidence establishes

Markers and controls follow their current price pane through maximize, collapse, restore, pane reorder, and chart-link changes. Left-axis positioning uses the native plot origin. The minimum admitted controls retain full 44×44 actions, exact long quantities, and scrollable provenance. The measured browser boundary is 198×89 CSS pixels at 261×900; the 198×88 admission threshold also has unit coverage.

Native PNG export includes the visible quantity labels, current owning price plot, study labels, units, source mode, venue, partial-coverage caveat, attribution, and terms. It excludes interactive controls and inspection panels. A fixed-clock export remains byte-identical after symbol, replay, label, and pane changes while SVG decoding is held. A separate held-animation-frame experiment reproduced stale pane geometry before the repair and proved correct 220px placement and 100px exclusion afterward.

Phone maximize/restore uses trusted browser-native emulated touch input without supplied timestamps. The recorded outcomes establish the emulated browser path. They do not establish physical-device behavior or human tap cadence. Classic scrollbar allowance is a reviewed layout budget rather than an additional measured operating-system configuration.

## Real IEX historical execution proof

The native historical exports use the reviewed NVDA envelope with SHA256 `015eab741c6bc40ef9931a4683584cdafee9eedfffc299e75824b1560cccd2b9`. Its 408 native execution reports are a partial IEX venue cohort. The displayed 1,200 / 1,100 / 1,200 share clusters contain 4 / 5 / 6 execution reports. Distinct-order counts remain unavailable.

The test supplies those exact historical bytes through explicit same-origin interception on a local fixture server. Native IEX export coordinate bars are OHLC derived from the same partial executions; marker quantities come directly from the transaction envelope. Other application chrome and source cases use deterministic fixtures. The 1,000-share demonstration threshold is a manual visibility setting, with no calibration or efficacy claim.

All three exports preserve Historical, IEX venue-only scope, shares, partial coverage, the later-acquired archive caveat, required attribution, and the complete HIST terms URL. Real-data conservation, availability and research limits remain in the [frozen real-data receipt](../../../../docs/evidence/large-trades/real-data-verification.json) and [reproduction guide](../../../../docs/evidence/large-trades/README.md). Out-of-sample efficacy remains `NOT_ESTIMABLE`.

- [Desktop historical native PNG](images/desktop-large-trades-native-export-real-iex.png)
- [Tablet historical native PNG](images/tablet-large-trades-native-export-real-iex.png)
- [Mobile historical native PNG](images/mobile-large-trades-native-export-real-iex.png)
- [Minimum control footprint](proofs/desktop-narrow-width-and-height-boundary-hit-footprints.json)
- [Asynchronous frame equality](proofs/desktop-async-capture-frame-equality.json)
- [Pending native geometry](proofs/desktop-pending-native-geometry-proof.json)

## Existing study and chart-link compatibility

A separate run on source `95a7cac298a99671eb392ff0050fb7b9223ead4e` passed **32 project/test instances**, with four planned skips, zero failures and zero retries. Study instances contributed 12 passes; chart-link groups contributed 20 passes and four skips. These counts are separate from the feature matrix above.

The [compatibility manifest](compatibility-e09/manifest.json) binds the actual run times, unchanged source bundle, results, and seven fresh images. Those images are retained in this packet. Only their seven original historical-path counterparts were restored, byte for byte, to preserve the earlier E09 packet's provenance.

## Reproduction and remaining release gates

Run `e2e/large-trades.spec.ts` through the repository Playwright configuration on the desktop, tablet and mobile projects with one worker and zero retries. Provide the licensed reviewed envelope through `MMX_LARGE_TRADES_RESEARCH_ARTIFACT`; without it the historical-specific case explicitly skips. The manifest records the actual source and input hashes, so a fixture substitution cannot reproduce this historical receipt.

The earlier [original-candidate packet](../large-trades/manifest.json) remains historical. This packet does not certify hosted CI, current-base merge, deployment, live CME/MNQ rights, production authentication, source publication, screenshot-specific Skylit parity, or out-of-sample efficacy. The [release handoff](../../../../docs/evidence/large-trades/release-handoff.md) identifies their owners and required evidence.
