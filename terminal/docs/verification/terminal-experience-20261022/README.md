# Terminal workspace design refinement — 2026-10-22

## Outcome and design decisions

This change improves the analytical reading order across Charts, Options, Company Intelligence and Portfolio. It keeps the existing data owners, calculations, provenance, renderer selection, routing and workspace state.

The live assessment found four concrete problems:

- Chart controls competed at the same visual weight, and OHLC labels ran into their values.
- Options used two enclosed navigation rows; on phones, wrapping market-context rows pushed the tape below the initial viewport.
- Intelligence used a decorative company orb beside the brief, repeated facts below it, and labelled general retained remarks as risks.
- Portfolio gave unavailable totals prominent empty cards while the actions and currency explanation were farther away.

The implementation gives chart timeframe controls a distinct group and spaces OHLC label/value pairs. Metadata wraps inside the chart pane before the price scale, and the existing measured header height keeps the indicator legend clear. Options categories use a flat selected indicator, child views use a quieter treatment, and phone market-context rows scroll within their own bounds. The actual filter controls and source timing remain available.

The Intelligence brief pairs its headline with the existing source-linked event facts. Duplicate takeaways already represented in the displayed facts or insight panels are omitted from the hero; distinct takeaways retain their evidence actions. “Watchpoints” accurately describes the existing source field. Empty implications and comparisons remain explicitly unavailable.

Portfolio uses a compact header and a unified metric band. Missing values remain dashes. The common-currency explanation appears beside an affected total, and existing Holdings filters are available directly from each incomplete metric. Keyboard activation moves focus to the Holdings tab. Other panels stay mounted so changing sections cannot discard a target draft.

## References and ownership boundaries

- Terminal source baseline: `4615f80dc8a6855041103c404e4457a6597445f0`.
- Integrated protected head before publication: `f27c4004d57d256ba867e2c94401d611c2b7a2e8` (includes Portfolio #1114 and the Options R2 acceptance receipt).
- Protected Mastermind Skillpack pin: `230e9a301ed774e79410829f1b5c049226fa59f1`.
- Paper reference: MASTERMIND PAGES, file `01M2WGNCX9475G79JRKJTCM08P`, Chart Context page `p-21-0`, desktop artboard `6I32-0`.
- Paper was read only. Its current owner warned that the shared file was too large and that further edits could cause data loss.
- Principal retained the cohesive design and implementation for lower total overhead and direct visual judgment, consistent with the user's requested working mode.
- ChartPanel, TerminalShell, the options calculations, PortfolioView, and CompanyIntelligenceV2Current are unchanged by this design slice.
- Existing Portfolio hardening from PR #1114 is integrated before publication; its data and target-save behavior remains authoritative.

## Evidence

Screenshots use deterministic local fixtures, not the signed-in production portfolio. They are rendered application captures, not generated mockups.

| Surface | Desktop | Tablet | Mobile |
|---|---|---|---|
| Chart readout | [Desktop](chart-desktop-readout.png) | [Tablet](chart-tablet-readout.png) | [Mobile](chart-mobile-readout.png) |
| Intelligence brief | [Desktop](intelligence-desktop-aapl-brief.png) | [Tablet](intelligence-tablet-aapl-brief.png) | [Mobile](intelligence-mobile-aapl-brief.png) |
| Options tape | [Desktop](options-desktop.png) | [Tablet](options-tablet.png) | [Mobile](options-mobile.png) |
| Incomplete Portfolio | [Desktop](portfolio-incomplete-en-desktop.png) | [Tablet](portfolio-incomplete-en-tablet.png) | [Mobile](portfolio-incomplete-en-mobile.png) |

Additional captures: [chart toolbar](chart-en-1180-terminal-chrome.png), [populated Portfolio dark](portfolio-populated-desktop-en-dark-overview.png), [populated Portfolio light](portfolio-populated-desktop-en-light-overview.png), and [Chinese mobile Portfolio](portfolio-populated-mobile-zh-dark-overview.png).

The review also covers populated Portfolio in English/Chinese and dark/light, and the chart toolbar at intermediate widths. The [validation record](validation.json) lists exact commands, source/artifact hashes, results and unresolved delivery gates. New behavior checks cover:

1. Unavailable Portfolio totals remain unavailable after navigating to coverage or entry details.
2. Recovery actions open the correct Holdings filter and return keyboard focus to the corresponding tab.
3. The first Options tape row fits the phone viewport, while the last market-context filter remains keyboard reachable.
4. Intelligence retains distinct evidence actions, including when no event facts are available.
5. Existing receipt selection, event identity, language, inspector and workspace navigation continue to work.

## Independent review and limitations

An independent native adviser reviewed the actual rendered Intelligence, Options and Portfolio screenshots for product hierarchy and usability. The visual slice passed. A subsequent independent review of Charts and populated light-theme Portfolio found numeric clipping at the 1024px chart width; the principal corrected wrapping and legend clearance, added numeric-bounds checks, and the adviser re-reviewed both intermediate chart widths with no remaining visual blocker. The subsequent polish addresses its empty-state wording, missing-currency explanation, singular labels and category-browsing cue.

That judgment is screenshot-based product review, not an independent technical code review or production acceptance. A separate paid Fabric source-review request (`terminal-design-review-01`, original root `terminal-experience-upgrade-20261022`) was rejected with `INVALID_ARGUMENT` on `parent_id`. The exact status read returned `NOT_FOUND`, `root_verified: false`, `execution_absence_proven: false` and `retry_allowed: false`. It was not retried or represented as a completed review. The requested original source snapshot was retained at `/tmp/terminal-design-review-01-candidate` on the implementation host.

The source-backed watchpoints can still be terse quotation fragments; this change does not manufacture analytical interpretations. The served release and real signed-in path require the repository's normal CI, merge and deployment gates. Those delivery receipts belong in the PR and final acceptance report.

## Verification status before publication

- Type checking and scoped lint pass.
- The 31-case visual matrix, the final 13-case chart/recovery matrix, and the three standard chart viewport checks pass.
- The full unit run passed 15,974 tests and hit one existing I/O-bound test's 5-second timeout under concurrent load. That exact test passed in 1.529 seconds in isolation with no source or timeout change. The full CI unit result remains the release gate.
- The broad local browser run was stopped after 93 passes and 10 skips so the complete 3,556-case suite can run on the repository's parallel CI matrix. It is explicitly not recorded as a full local pass.
- Production acceptance is pending CI, merge and git-gated deployment. No fixture screenshot is represented as a live production result.

CI found that the last localization addition invalidated twelve historical evidence checks through the shared global lexicon. The corrected candidate restores that file byte-for-byte and keeps the hint in an Options-owned bilingual copy module. All eleven affected files / 73 tests now pass, with the evidence locks unchanged.


## CI follow-up

The required CI unit/typecheck job passed on `e5e7e99` with 947 files and 15,975 tests passing (four todo), including the language gates. Its serial browser job caught one stale comparison-copy assertion. That expectation now matches the approved plain-language wording while retaining its absence-of-action and provenance checks.

Running the complete Intelligence family then exposed a Chinese interaction regression: deduplicating the Revenue takeaway removed its localized label. The promoted fact now keeps that existing Chinese label while passing the original metric item to its evidence action. A dedicated regression test covers the label, deduplication and source selection. The unchanged Chinese receipt journey now passes.

The final full local Intelligence/intermediate-chart group reports **52 passed, 33 existing viewport-specific skips**. The three brief-layout unit cases, scoped lint and fresh TypeScript compilation pass. Exact logs and source hashes are recorded in `validation.json`. These are pre-release receipts; the corrected head still requires protected CI and deployment.
