# D06 chart time — publisher recovery and reader correction

## Current scope and source

The original reader candidate is published in [Terminal Draft #1270](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1270) at `2d29878cf52b6a8ac950b93ea9a78ec0fae60aff`. D06 recovered that existing PR and verified all 26 published file blobs against its retained snapshot; no duplicate branch, workspace or PR was created.

The original operation remains `d06-terminal-reader-resilience-20261103-c4`, branch `sol/web-d06-terminal-reader-resilience-20261103-c4`. The repository-qualified typed publisher reports APPLIED with matching local and remote heads. The earlier preflight refusal is resolved for this carrier. Current protected Mastermind procedure: `576b59341edc9c871cb9d950833678fcf65078e4`; unchanged required companions were verified against the prior valid pin, and material delivery/account instruction changes were read.

The Chairman authorized implementation before F01 completion and waived extra Web-session independent-review ceremony. Self-QA continues directly. Binding native CI, formal non-author approval where required, current source law and explicit Ready/merge/enqueue/relabel/deploy holds remain. Final shell composition and Paper write admission are separate.

## Problem and implemented behavior

The reader appended “UTC” whenever a bar's time was numeric. The native intraday producer explicitly uses market-local wall-clock coordinates encoded as display epochs for several markets. Numeric type alone cannot certify a UTC instant. VisualFrame and VisualSeries do not supply a verified timezone field; the existing `basis` describes quote transport, not bar time.

The same formatter also discarded seconds for all numeric values, so different bars on supported second-based charts displayed the same minute.

| Case | Result |
| --- | --- |
| Numeric bar coordinate | Preserve the plotted date and clock components; show localized “Chart time” / “图表时间” |
| 1s, 5s, 15s or 30s interval | Show seconds in the reader and existing prior-range tooltip |
| Minute/hour intervals and legacy formatter callers | Retain minute precision |
| Daily date | Retain the date-only presentation without an intraday qualifier |
| Invalid numeric date | Preserve the formatter's unavailable result; the reader shows its existing localized “Not stated” copy |
| Historical Previous/Next/Latest | Keep exact source coordinates and the incumbent selected-bar identity |
| Accessible description | Associate the time element with the visible localized chart-time qualifier; add no false UTC/Z machine-readable instant |
| Expanded help | Explain that this view does not specify timezone and bar time does not establish data freshness |

This uses the existing `isSecondTf` registry. No timestamp conversion, symbol/venue/currency heuristic, browser timezone, source cache, quote lane, auth change, preference store or new API field is introduced. A crypto-shaped coordinate receives the same neutral label when this reader has no verified time-basis metadata.

## Runtime and ownership boundary

Changed runtime files are [VisualIntelligencePanel](../components/VisualIntelligencePanel.tsx), [visualIntelligence](../lib/visualIntelligence.ts) and [visualIntelligenceCopy](../lib/visualIntelligenceCopy.ts). The previous disclosure/scroll/focus helper and 44px CSS remain unchanged.

The current master comparison was path-disjoint from these files. The active Chart AI PR #1048's complete 283-path census did not overlap the two added library paths. ChartPanel, ChartPane, TerminalShell, Brain, source producers, Options and Intelligence workspaces remain with their existing writers.

The earlier [reader resilience proof](d06-reader-resilience.md) remains historical evidence for its exact bytes. New chart-time proof supplements it; it does not relabel those older captures as this candidate.

## Verification

Before the runtime edits, the new focused suite reproduced five failures: four supported second intervals and the prior-range tooltip lost seconds. Eleven other coordinate/date/invalid-input cases passed.

After the change:

- 57 focused tests passed: 16 chart-time cases, 19 incumbent visual-intelligence cases and 22 reader-presentation DOM cases.
- Scoped ESLint passed.
- TypeScript `npx tsc --noEmit --incremental false` passed.
- Diff review and `git diff --check` passed.
- The combined local browser run passed 77 executions, with 16 intentional viewport skips, zero failures and zero flaky results. This includes 20 new chart-time executions and 57 incumbent reader regressions across desktop, tablet and mobile projects. The run began at 2026-11-04T04:50:10.105Z and completed in 313.732 seconds.
- All eight raw EN/ZH captures were visually inspected: the seconds and visible qualifier are readable, date/time wrapping remains usable at 320px, and the expanded explanation fits tablet/mobile without clipping. Desktop crops show the reader's viewport, not the entire scrollable body. This is scoped visual self-QA, not a full accessibility or contrast audit.

The [verification receipt](pr-crops/d06-chart-time/verification.json) records exact tested file hashes, baseline failures, commands, all case outcomes and capture hashes. The [complete browser report](pr-crops/d06-chart-time/browser-report.json) preserves every case from the actual run.

| Capture | English | Chinese |
| --- | --- | --- |
| Desktop reader | [EN](pr-crops/d06-chart-time/chart-time-desktop-en.png) | [ZH](pr-crops/d06-chart-time/chart-time-desktop-zh.png) |
| Tablet reader | [EN](pr-crops/d06-chart-time/chart-time-tablet-en.png) | [ZH](pr-crops/d06-chart-time/chart-time-tablet-zh.png) |
| Mobile reader | [EN](pr-crops/d06-chart-time/chart-time-mobile-en.png) | [ZH](pr-crops/d06-chart-time/chart-time-mobile-zh.png) |
| 320px fine pointer | [EN](pr-crops/d06-chart-time/chart-time-320-en.png) | [ZH](pr-crops/d06-chart-time/chart-time-320-zh.png) |

The coordinate tests cover US summer/winter, CN/HK and crypto-shaped values without applying another timezone conversion. They are source-shaped fixtures, not a new provider or exchange-timezone admission test. Browser tests use real local Terminal routes with deterministic bars.

The incumbent hosted unit job recaptures and validates its immutable visual evidence before running the full unit suite. D06 leaves the shared historical EVIDENCE.yml and legacy image paths with their original owners rather than rewriting old hash records. Actual new current-head CI is a separate obligation.

## Acceptance and remaining work

This completes the bounded correction “do not universally assert UTC, and retain supported seconds.” It is partial evidence for HIST02 in the existing 75-case migration plan. Explicit producer-to-reader timezone provenance, true instant reconstruction, freshness/PIT availability and full source-clock contracts remain unqualified.

The reader still uses Terminal's intentional dark theme. EN/ZH, responsive browser geometry and semantics are checked within this slice; physical-device touch, screen-reader operation, full contrast and 400% zoom are separate remaining proofs.

Keep Draft #1270 and [Macro D06 #10655](https://github.com/mastermindx-market-intelligence/macro/pull/10655) as the existing carriers. Publication, hosted CI, formal approval, final shared-shell composition and deployment remain distinct. No release hold is removed here.
