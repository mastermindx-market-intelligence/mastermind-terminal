# F01: four-identity Options & futures directory facet

Status: locally verified implementation and evidence prepared for the existing **draft PR #1276**. This commit is not a merge, deployment, production acceptance or candidate.5 adoption.

## Why and what changed

F03 gave scoped concurrence for a presentation facet containing four existing directory identities. The previous directory exposed these destinations through broader sections but had no explicit Options & futures control. This change adds that control in English and Chinese, displays exact paths beneath its source-owned titles, and uses the inspected Paper phone list composition at widths up to 600px.

The matcher collects the incumbent **All** results first and then filters those ordered entries by the four IDs:

| ID | Existing route |
| --- | --- |
| terminal:options_futures | /options/futures |
| terminal:options | /options |
| macro:options | /options.html |
| macro:options_screener | /options_screener.html |

Show all clears only the category, retains the typed query and incumbent order, and resets the visible batch to 48. The original seven categories keep their prior fallback behavior. Finite-path fallback entries without a reviewed directory identity cannot enter this facet. Matching lessons and calculators remain reachable in All and their existing categories.

The generated 290-record catalog, source titles/search aliases, access metadata, routes and authentication ownership are unchanged. The real English options corpus currently produces 12 All matches and 4 facet matches; the real fund corpus produces 104 All matches and 0 facet matches. The real Chinese 期权 query produces 2 matching incumbent destinations, and that query's facet retains those same 2. None of these counts is a product constant.

## Qualification and falsifiers

- Before implementation, the five new component cases failed while the existing 24 directory cases passed.
- Final component and neighbor suites: **92 passed, 0 failed**.
- Full Chromium run across 1440 desktop, 820 touch tablet and 390 touch phone: **34 passed, 2 intentional desktop-only new-tab skips, 0 failed, 0 flaky**.
- After visual QA led to the facet-only phone list refinement, all **12 affected browser cases passed** on final source. This includes keyboard/touch recovery, real corpus order, 104-result batch recovery, actual theme/language controls, short-height scrolling to the last destination, and legacy focus-outline visibility.
- Scoped ESLint passed with zero warnings; tsc --noEmit --incremental false passed.
- One-file virtual composition with the unchanged #1244 head retained its intelligence title mapping and F01 focus/facet behavior. This is not whole-PR integration proof.
- Actual Paper board 6ZZV-0 was inspected read-only and grounded the phone list. No new Paper writes were attempted. The original uncertain Paper operation remains held.

RESULTS.json distinguishes the full run from the final affected-case rerun. BROWSER_CASES.json carries case receipts and inline observations. SOURCE_INPUTS.json binds exact final input hashes. SOURCE_CHECKS.json records commands and exit codes. raw-reports.zip and its manifest preserve the original reports. Five PNGs show the actual final browser output.

The browser uses the incumbent development identity seam and a controlled AAPL manifest. This does not prove production identity, premium access, remote data quality, or the separate 86-case full-programme conformance suite. The known development chunk 404/ERR_ABORTED is preserved in observations; there were no new uncaught page errors.

## Authority and owner boundaries

- Protected source law: Mastermind@690e5316629815ae3e78f65ebdec2eb87f0cad16.
- Original assignment/common/index: macro@6e1862867193ec6486a22001a0e4fb515da20448.
- F03 concurrence: [exact response](https://github.com/mastermindx-market-intelligence/macro/blob/e1ac30e1405d5fed4fa1a79d623a066505d47c52/research/design_candidates/production_design_20261102/f03/F01_OPTIONS_TAXONOMY_RESPONSE.md), blob e01dfc667c1b288635be7b2179c7993d1474dcf4.
- Current F01 source carrier: [Macro #10645](https://github.com/mastermindx-market-intelligence/macro/pull/10645), draft. Candidate.4 remains operative; candidate.5 remains proposed.
- Original implementation carrier [Terminal #1264](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1264) was externally merged; its historical hold mismatch is not ratified by this change.
- Corrective and continued implementation carrier: [Terminal #1276](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1276), draft, parent 1364256763ba505399399afe7a6b54021f141953.
- Adjacent owner: [Terminal #1244](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1244), draft at 624dbc0ac22ecdaa6d1bd580d5221da939c5e5a9; no relabeling or takeover.

The broader 290-record taxonomy, candidate.5 resize adoption, original Paper effect reconciliation, and merge/release authorization remain separate gates.
