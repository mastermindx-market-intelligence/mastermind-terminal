# Indicator settings modal repair — 9 November 2026

Parent mission: docs/terminal-ui-improvements-20261109.md in PR #1363. Chairman authorized ongoing Terminal UI fixes and normal protected automatic release while independent work continues.

Pins: Mastermind ff6d5ab67c3535056d69f603fac0d95c058baad8; Terminal base 8390cc4ad41b1c0773e979198c80e742852c01dc; Macro design doctrine 536ab7d78c2fbcab8a7c8a3cdc8d09fbe2bff136. The relevant IndicatorSettings blob is unchanged from the initial e4329a7 base. No open IndicatorSettings PR was found in the bounded overlap search.

## Defects and correction

IndicatorSettings declared aria-modal on a div but did not make the rest of Terminal inert or contain keyboard navigation. Visibility, suite and Pine controls lacked usable names. The candidate uses native dialog and the existing activateSettingsDialog lifecycle, preserves the desktop panel and phone bottom sheet, names the controls, exposes the selected section, and keeps Cancel's opening snapshot distinct from the existing live-save Escape/OK behavior. Existing deferred focus return to persistent legend openers is preserved. Touch legend opener buttons remain transient; their pre-existing dismissal behavior is not claimed fixed.

No chart calculation, parameter ownership, entitlement, source, guide routing, persistence or global stylesheet is changed. Rejected Paper account/settings redesigns are not copied.

## Verification status

The product TypeScript check passes; candidate lint has the same 19 pre-existing no-explicit-any findings as the immutable IndicatorSettings baseline, with no findings in the changed tests. Focused unit coverage passes for modal lifecycle, named controls, keyboard actions, delayed focus return, Cancel and module-scoped settings. Browser regression covers the real Terminal route on desktop/tablet/phone, native focus containment and background inertness, bounds, live editing, Escape, Cancel and named Visibility controls; execution is next. No browser, merge, deployment or production pass is claimed yet.

## Delivery and continuity

Source carrier: GitHub-native APIs, exact-parent branch sol/web-terminal-indicator-dialog-20261109-c1. Local and remote source materializations are isolated validation artifacts, not publication worktrees. No live writer or existing checkout is modified. SELF_REVIEWED; actual GitHub gates remain. PR #1363 is already armed for native automatic merge at 418caa6570717942af8255dbac3dfbe108de8217, enabledAt 2026-11-09T08:42:23Z, queue entry null at immediate readback. Do not re-arm or duplicate it.

Next: obtain and inspect real-route browser proof; publish/qualify this PR and enroll it once through the same protected flow. Then take the remaining four Options Screener ticker actions, preserving PR #1248's active overlapping header/top-premium/unusual work. Live user Chrome remains held by an open extension UI; fixture proof is not production proof.
