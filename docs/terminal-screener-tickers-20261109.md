# Remaining Options Screener ticker actions — 9 November 2026

Parent mission: ongoing Terminal UI improvements, [#1363](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1363) and [#1367](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1367). The Chairman authorized implementation and normal protected auto-release while independent work continues.

## Source and ownership

Mastermind law: ff6d5ab67c3535056d69f603fac0d95c058baad8. Terminal branch base: 8390cc4ad41b1c0773e979198c80e742852c01dc. OptionsHubView base blob: 2a22a6be3a1612d6e7614ca95c85e460d5df7400. Macro design doctrine: 536ab7d78c2fbcab8a7c8a3cdc8d09fbe2bff136.

Observed master subsequently advanced to 1377853d02fdb0295c0848d7127fdee4ca36714b through #801. Its changes concern Investigation evidence review and CI capacity; none changes the Options source paths in this patch. Keep protected integration qualification.

GitHub-native branch sol/web-terminal-screener-tickers-20261109-c1 owns this bounded diff. Scratch and remote copies are validation artifacts only. No shared source checkout, live writer, Paper document or existing PR was changed.

Open #1248 already owns broad Options header/Tape/Tickers work and ticker buttons in Top Premium/Unusual Activity. Those are not repeated. This patch fills only the four residual Screener cells: Volume > OI, delta-OI Builds, 0DTE Heavy and Hot Contracts. The new focus ref touches the existing ticker search input; #1248's future input labeling/layout remains its lane.

## Resulting behavior

Native named ticker buttons retain table semantics and call the existing switchTab/setSelectedTicker path. Keyboard activation moves focus to the existing ticker search field; pointer activation retains its existing focus behavior. Pin controls are siblings, stopPropagation prevents the ticker click from also firing its row, and row pointer navigation remains available. The scoped style adds visible focus and at least 44 by 44 pixel touch targets.

No selection, navigation, shortlist, persistence, feed or retry owner is added. Display order, filters, CSV data, columns, contract eligibility and source semantics are unchanged.

## Qualification plan

Focused selector/shortlist/CSV tests, baseline lint comparison and full TypeScript check. Real /options journeys exercise all four presets with actual Tab plus Enter/Space, exact selected-root request, useful destination focus, URL parameter retention, preset/filter/order retention on return, independent pin state, existing pointer row navigation, focus/touch geometry and EN/ZH names. The existing shortlist journey remains separate from navigation because ticker navigation intentionally reads detail data.

Use the real fixture route for feed data and the existing OI/Hot fixtures. An explicit honest-empty ticker response verifies the selected-root no-data destination without manufacturing market data. Restore omitted scratch fixtures from the pinned GitHub source if necessary; that is a validation materialization issue, not a product change.

## Continuity

PR #1363 native auto-merge enabled at 2026-11-09T08:42:23Z, head 418caa6570717942af8255dbac3dfbe108de8217.
PR #1367 native auto-merge enabled at 2026-11-09T09:11:01Z, head 282dac13a591c0e35a970708e3d43265c4bcfc19.
Both were open at their latest readbacks; neither is claimed merged or deployed. Do not re-arm either.

Qualified product head: 362199e327a37c1146e464726f23dc795a177fed. All 37 unit checks, the full TypeScript check and 16 native browser checks passed (2 intentional duplicate-locale skips). Baseline-normalized lint adds zero messages. Desktop, tablet and phone captures were visually inspected. [Full proof](./pr-crops/terminal-screener-20261109/verification.md).

Next: make #1371 Ready and enroll it once through native exact-head auto-merge after this evidence-only commit. Continue to rely on actual protected checks and the existing release process. User Chrome remains occupied; isolated fixture proof does not establish production browser acceptance.
