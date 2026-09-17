# Stock Intelligence — implementation and release evidence

**Feature acceptance remains open in Terminal #612. This is not a production deployment receipt.**

## User-visible change
One responsive Stock Intelligence workspace replaces the linked Research Desk / Golden Oracle popups. Overview compares the two source assessments without inventing agreement; Research preserves full cautions and context; Signals preserves classifications, dates and chart-return actions; Performance keeps historical figures, sample size and equity provenance separate from today's research.

The launcher is one ordinary action with both source states and dates. On phones it uses a compact two-column arrangement so the source summary still clears the chart fold. Inside the panel, long source prose wraps, all four views share one vertical scroller, and native dialog dismissal/focus return and keyboard tab navigation remain available.

## Source and identity
- Operation: `terminal-stock-intelligence-20260917-sol-001`.
- Repository: `mastermindx-market-intelligence/mastermind-terminal`.
- Branch: `claude/stock-intelligence-20260917-sol-001`.
- Protected baseline: `75c22083249e7a1529be3d6baf819b9ad5ea509f`.
- Execution Skillpack: protected Mastermind `7a191cc11039199843d4734c7df8d5523280e09c`.
- Acceptance carrier: #612. Production-release dependency: #483; do not independently deploy the held W2B-A #605 implementation.

## Real-source proof method
The actual `/terminal?symbol=INTC` route runs from this worktree with the repository's existing isolated fixture-auth seam. Its normal static-data requests are fulfilled using the publicly published production payloads. Source HTTP statuses, lengths and SHA-256 hashes are retained in the adjacent screenshot receipt. This verifies real producer input through the changed consumer and real browser, but does not claim that the changed branch is deployed.

No signal, backtest or sizing formula was recalculated. The existing backtest feed's `equity.t` / `equity.v` columns are paired directly; malformed pairs, invalid dates and explicit failure status are refused. The old row-oriented format remains supported. Curve dates/window and missing statistical-validation evidence are displayed separately from the headline metrics. Source methodology is a disclosure, not a new claim of validation.

## Review and regression scope
Responsive English and Chinese coverage uses 1440×900, 820×1180 and 390×844. Tests cover one-dialog entry, four views, wrapping/overflow, the phone fold, keyboard navigation, focus return, history expansion, chart return, existing full-analysis handoff, absent research/backtests and real/legacy equity formats. Existing starter/refused/retro/stop/reclaim truth-label suites remain in scope.

The #612 read-only review's inactive-tab `aria-controls` finding is repaired using one stable panel ID and an active aria-labelledby reference. The discriminating unit test failed before the two-string repair and now passes across all four selected views; the real-route browser tests also assert that every tab target exists. The review independently exercised the existing full-analysis journey and inspected the published columnar curve contract; its findings do not imply deployment approval.

## Release boundary
No production files, services, runtime data, credentials, model routing or trade authority were modified. Do not use raw source synchronization, an implicit moving branch tip, or an independent deploy script to bypass the existing release owner. Keep #612 open after source merge until the admitted exact release is live and the real-user browser journey is verified on that release.

## Final local verification
- TypeScript `--noEmit --incremental false`: PASS.
- Full unit run before the final two-ID ARIA repair: 333 suites / 5,526 tests PASS, four existing TODO.
- Final component + unchanged signal-verdict run: 124 PASS (17 new workspace cases, 107 existing verdict cases), including the ARIA repair.
- Responsive browser regressions on final source: 10 PASS; two expected skips are the phone-only fold test on desktop/tablet. Includes full-analysis navigation and unavailable detail feeds while retaining legitimate manifest facts.
- Real published-source browser matrix on final source: 6/6 PASS, 24 settled view captures, six settled equity captures and six launcher captures; zero page errors. The phone launcher bottom is 841.77px in an 844px viewport in both languages.
- Existing Python notch parity / Oracle truth labeling / known-date tests: 27 PASS.
- `git diff --check`: PASS.

The exact five source/test blob IDs, real-input hashes, capture time and all 36 screenshot hashes are in `pr-crops/stock-intelligence-20260917/live-proof.json`. This receipt replaces the incomplete pre-repair curve run. The screenshots show local final source consuming real published inputs; they do not claim production adoption.

Reviewed findings are resolved; no engine math, provider, source writer or deployment path was changed. Canonical source CI and protected merge remain separate from these local results. Production acceptance stays open under #612 until #483 admits the complete release and the deployed exact SHA passes the same journey.
