# Workspace and study control refinement — 9 November 2026

Parent: [Terminal Experience Excellence](TERMINAL_EXPERIENCE_MASTERPLAN_2026-10-22.md), EX-06/EX-16/EX-20/EX-45. Operation: `terminal-experience-refinement-20261109-sol-01`.

## Outcome and source

Make saved-workspace management and chart-study controls predictable with keyboard, pointer and touch. Preserve analytical depth, existing persistence callbacks, unreadable-data boundaries, account/team permissions and responsive owners.

Procedure: Mastermind `5257967eb23d10418dc2326bb7a7b31f7e6a5915`, skillpack 1.0.1, bootstrap major 1. Terminal base: `57ab4281d87ccb9e01e3bafcd42350034de1b222`. Macro doctrine/design system: `bf91cd8964c0fc3ea4ea2e987a21d7759b380032`. Original managed source branch: `sol/web-terminal-experience-refinement-20261109-sol-01`.

The existing masterplan remains the task tree. Its older release notes are historical evidence, not current release state. This scoped continuation does not reopen earlier accepted search, settings, tooltip, watchlist or chart-shortcut work. Seven current polish PRs were inspected for overlap. Root owns implementation directly: PRINCIPAL_JUDGMENT and LOWER_TOTAL_OVERHEAD for a small coupled interaction slice. A read-only native design critic supplied source findings; no technical approval or production proof is implied.

## Ordered implementation and reading contract

1. **Saved workspaces.** Retain CREATE → library → Import. Split the workspace Open control and Actions expander into sibling native buttons. Only Open is disabled for newer/unreadable entries; Export and permitted Delete remain reachable. Keep badges and truthful reasons. Preserve accordion focus, staged Escape, inline rename, conflict handling, team permissions and existing callbacks. Use quiet neutral row surfaces, clear focus and generous touch targets.
2. **Study library.** Protect script renaming from IME Enter/Escape/229. Explicit save/cancel returns focus to that script's Rename button; natural focus departure keeps its existing commit behavior without stealing focus. Increase narrow/coarse-pointer secondary targets to 44px, allow long EN/ZH names to wrap, preserve compact desktop density and sole results scrolling.
3. **Chart layers.** On touch, open ready to browse without requesting the text keyboard; desktop stays search-first. Composition Escape neither clears nor dismisses. Preserve clear-then-close, visibility/removal state and the native responsive popover.

## Acceptance and boundaries

Reproduce meaningful failures before repair. Run focused mounted interaction tests, affected type/lint checks and actual-component browser journeys at 1440x900, 820x1180 and 390x844; inspect changed EN/ZH captures and supported theme treatment. Verify retained workspace rename and study state. No new store, dialog framework, engine, endpoint, trade signal or dependency.

Then publish exact source and proof, qualify mandatory hosted CI, request normal protected automatic release when eligible, read back the actual merge, and perform the authorized git-gated rollout and live journey proof when available. Source/local tests, CI, merge, deployment and production acceptance stay separate. Parent programme completeness still requires the existing masterplan's remaining rows.

Current browser limitation: the connected Chrome reports another extension UI blocking automation. No production browser proof is claimed. The selected browser is retained; no alternate browser or login workaround is authorized by that error.

## Implemented result

- Workspace names and truthful status badges have a clear reading hierarchy. Open and Actions are sibling native buttons with instance-specific accessible relationships. Disabling Open no longer disables Export or permitted row management. Existing workspace rename, team restrictions, accordion focus and staged Escape remain owned by the existing component.
- Script rename has one synchronous session guard. Enter commits once; Escape cancels locally; composition events remain owned by the input method. Explicit completion restores Rename, while natural blur retains the actual next focus destination. A focused Rename action removed by an asynchronous filtered result returns focus to search.
- Secondary study controls use 44px targets on touch/narrow layouts. Phone actions occupy their own row, and touch layouts wrap long names. Available Guide/Settings controls use normal readable text and subtle neutral button surfaces even when adding a study is restricted. Entitlement logic is unchanged.
- Chart Layers opens on Close for coarse pointers and on Search for fine pointers. Composition Escape does not clear or dismiss it. Existing visibility, removal, responsive top-layer behavior and focus return are preserved.

## Verification at source checkpoint

The six focused Vitest files pass **128 tests**: workspace creation/rename/actions, team-read restrictions, operation contracts, localization, script rename and Chart Layers. Command: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run lib/__tests__/{layoutRenameFocus,chartObjectTree,indicatorsScriptRename}.test.tsx lib/__tests__/{layoutMenuTeamRead,workspaceMenuOps,workspaceMenuLex}.test.ts --maxWorkers=1 --minWorkers=1`. The flag disables the host Node 26 experimental server-side Web Storage so jsdom owns browser storage; it changes no product runtime.

TypeScript passed on the implemented component changes. Focused lint has one pre-existing `react-hooks/set-state-in-effect` error in the workspace team-selection effect, reproduced from protected base through ESLint stdin; no new lint finding remains. Final static verification after test-only changes is running.

The responsive suite exercised 1440x900, 820x1180 and 390x844, EN/ZH, touch target measurements, reduced motion, keyboard focus, workspace save/cancel/reload, layer hide/show/remove and script rename/reload. First complete matrix: **34 passed, six intentionally inapplicable cases skipped, two test-expectation failures**. Those two expected a desktop/tablet popover to remain open after a programmatic export download. The export succeeded; the corrected check now reopens through the existing menu owner and compares the downloaded JSON with the exact stored unreadable payload. A focused final matrix also covers the final touch-name wrapping and enabled-action treatment. Its result remains pending at this checkpoint.

The account-script fixture deliberately implements reads only. Rename browser proof therefore uses the existing real guest script store, including a fresh reload; it does not claim an authenticated Supabase write. Composition checks exercise browser event signals, not an operating-system IME. Touch checks exercise coarse-pointer browser contexts, not a physical phone keyboard.

Actual dark-theme desktop/tablet/phone captures were inspected. The read-only design critic accepted the tablet composition and identified subdued enabled study actions; the source now addresses that finding. Final captures include the existing light-theme token contract. No human usability study or production browser acceptance is claimed.

## Release frontier

The source remains on its original managed branch and operation. Current protected master advanced to `1442a9431ed01bbda4762864e05d6e278f4a5a6b` through a disjoint News selector theme change; no owned component, governing instruction or imported dependency overlaps. No ancestry-only merge is needed.

Public branch metadata confirms the three protected check contexts, and ruleset `24411653` confirms the active merge queue with no bypass actors. The GitHub integration's administration-only branch-protection detail read returned 403; approval-rule detail remains unknown and must not be inferred from an empty review request list. No denied read is replayed through another account or tool.

Next: finish the focused final matrix and static readback; publish final captures and evidence; qualify the original PR/head, effective native review decision, explicit holds and required CI; request only the permitted protected release path when qualified. Read back actual merge and the existing git-gated deployment result before any deployment claim. Connected Chrome remains blocked by another extension UI, so the live browser lane needs that UI obstruction cleared. Parent EX-06/EX-16/EX-20/EX-45 and the wider programme remain open until their actual acceptance obligations are met.
