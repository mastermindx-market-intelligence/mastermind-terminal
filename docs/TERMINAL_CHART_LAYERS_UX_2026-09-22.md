# Terminal chart-layer management upgrade

## Mission, authority and boundary
Improve the Chairman's chart usability and premium visual quality without reducing chart capability or adding weight. This slice upgrades the existing Object Tree: find studies quickly, understand visibility, and safely operate hide/show/remove on desktop and touch.

Current Chairman instruction: continue the chart-upgrade programme. Protected Skillpack: Mastermind@ce18ed4f1eaa28e65a616a90aecca5c5ce1c5a2e, compatible v1.0.1. INDEX, COLD_START, ACTIVE_EXECUTION, WEB_CEO_DELEGATION, RECONCILE_STATE, REVIEW_RETURN and CLOSEOUT were fetched at that same pin. Base: Terminal@3b0340bf831f3112575129f3c2f649ced0e00e78. Native carrier: Remote Desktop Commander on the same authorized Mac Studio; isolated branch/worktree claude/terminal-chart-layers-ux-20260922. No overlapping Object Tree PR or named worktree was found.

Direct execution: LOWER_TOTAL_OVERHEAD and PRINCIPAL_JUDGMENT for a small, self-contained UI with existing consumers. No worker or watcher was commissioned. No settings/state owner, store, dependency, chart renderer, backend service or signal/indicator mathematics is introduced or replaced.

## Design and real consumer
Reference is the existing real Terminal panel, captured as terminal/docs/pr-crops/chart-layers-ux-20260922/desktop-before.png before source edits. Terminal remains dark-only. Reuse existing panel/text/line/brand tokens, deliberate compact typography, a quiet symbol card, counts, grouped study rows and persistent action buttons. Wrap long names rather than hiding their identity behind a truncation. On touch, use 44px controls and a bounded side sheet rather than squeezing the plotted chart into an unusable sliver. Reduced motion disables incidental transitions.

The same TerminalShell props still supply study identity, labels/tags, grouping, hidden state and protected noRemove entries; the same callbacks perform all actual mutations. Search is transient view state only, matching labels/tags, including hidden studies. It never edits studies or preferences. The main-series row remains non-removable. Existing LEX translations supply every new control label; no second translation system is added.

Actions identify their target by accessible name. Search receives focus on open. Escape clears a filter before closing, and removal restores focus inside the surviving controls/search rather than dropping it onto the document. No-match and no-indicator states remain distinct. A source-owned noRemove study never acquires a remove button.

## Qualification boundary
The baseline browser reached the actual Object Tree and failed the new search-focus contract because no search control existed; the screenshot records the original design. Seven component tests pass. TypeScript/lint and the desktop/tablet/mobile interaction matrix must conclude before Ready; their actual results are added below rather than inferred from running tools.

Parent mission is incomplete. #701 and #705 remain accepted live and DO_NOT_REDO. #707 is a separate warm-cache release under its own running protected CI; #702's stalled-tap failure is separately adjudicated from the original trace. This panel does not take over either marker-repair carrier.

Next: finish real chart hide/show/remove and keyboard/touch proof, review the resulting screenshots and baseline, retain source/crop digests, then publish through protected CI/merge and the existing exact-target deployment chain. Do not claim a screenshot, unit pass, open PR or source merge is production acceptance.

## Completed local qualification and discovered clipping defect

The final implementation passes7component contracts and the complete Terminal unit suite:379files,6,088tests passed,4existing TODO. Next route-type generation, TypeScript and scoped lint pass. An initial typecheck found malformed untracked `.next/dev/types/validator.ts`; no authored file was responsible. With no owned dev server active, that generated directory was retained outside the repo and regenerated through Next rather than hand-patched or excluded from TypeScript.

Real chart Object Tree and chart-view/reset browser matrix:14passed,10intentional viewport skips,0failures, one worker and retries disabled. The seven layer-specific browser cases cover actual hide/show/remove through persisted owner state, EN/ZH, visible target-specific controls, touch sizes, Escape/filter/focus behavior and a desktop→phone→desktop round trip preserving one filtered panel. Existing symbol-change, normal/logarithmic wheel zoom and chart-reset contracts remain green.

Visual review caught a defect that the initial visibility checks missed: a CSS-fixed phone panel was still clipped by the chart's ancestor, and fullscreen chrome could cover a control. A stronger viewport plus center-point hit test reproduced that failure. The repair uses the browser's native manual Popover top layer on the SAME existing panel element at narrow widths, with feature detection and media-change cleanup. It does not portal or remount a second component, add a dependency, increase global z-indices or replace chart state. The improved test passes and the final phone/tablet screenshots show the full panel with every study action reachable. Only currently tested Chromium behavior is claimed; a legacy-browser fallback was not separately proven.

The final desktop EN, tablet ZH and phone ZH crops were visually reviewed against the original panel. All six responsive language crops and the baseline are retained with source/crop digests. The native top-layer side sheet is non-modal and retains a Close control and Escape; it does not pretend to be an account dialog or an independent chart.

Current capability: BUILT_NOT_PROVEN. No production deployment has been started for this slice. Required protected CI, merge and exact-target live verification remain owed. The parent charting mission is incomplete.
