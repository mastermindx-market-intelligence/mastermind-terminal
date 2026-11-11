# Workspace and study control refinement — 9–10 November 2026

Parent: [Terminal Experience Excellence](TERMINAL_EXPERIENCE_MASTERPLAN_2026-10-22.md), EX-06/EX-16/EX-20/EX-45. Operation: `terminal-experience-refinement-20261109-sol-01`. Original [PR #1407](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1407).

## Outcome and source

Make saved-workspace management and chart-study controls predictable with keyboard, pointer and touch. Preserve analytical depth, existing persistence callbacks, unreadable-data boundaries, account/team permissions and responsive owners.

Procedure: Mastermind `5257967eb23d10418dc2326bb7a7b31f7e6a5915`, skillpack 1.0.1, bootstrap major 1. Terminal base: `57ab4281d87ccb9e01e3bafcd42350034de1b222`. Macro doctrine/design system: `bf91cd8964c0fc3ea4ea2e987a21d7759b380032`. Original branch: `sol/web-terminal-experience-refinement-20261109-sol-01`. Published product checkpoint: `f4e2e08d3fd00de9b6d5a79b16d8d743a6b74a0e`; the [evidence receipt](../terminal/docs/pr-crops/workspace-study-20261109/receipt.json) binds the final source snapshot by file hashes.

The existing masterplan remains the task tree. Older release notes are historical evidence, not current release state. This scoped continuation does not reopen accepted search, settings, tooltip, watchlist or chart-shortcut work. Current polish PRs were inspected for overlap. Root owns implementation directly: PRINCIPAL_JUDGMENT and LOWER_TOTAL_OVERHEAD for a small coupled interaction slice. A read-only native design critic supplied source and visual findings; no formal GitHub approval or production proof is implied.

## Implemented result and design reasoning

1. **Saved workspaces.** Open and Actions are separate native sibling buttons with instance-specific accessible relationships. Only Open is disabled for newer/unreadable data; Export and permitted Delete remain reachable by keyboard and touch. Names and status badges have a clearer hierarchy, recovery surfaces are neutral, and blocked workspace names remain readable. Existing rename, stale/conflict handling, accordion focus, staged Escape, team permissions and persistence callbacks remain intact.
2. **Script rename.** A synchronous session token consumes each completion once. IME Enter/Escape/229 remains with the input method. Explicit Enter/Escape returns focus to Rename; natural blur saves without stealing the next focus destination. If an asynchronous rename removes the focused row from filtered results, focus recovers to search, unless the user has already moved elsewhere.
3. **Touch study controls.** Secondary controls and navigation have 44px targets on narrow/coarse-pointer layouts. Long EN/ZH names wrap on touch layouts; phone actions occupy a separate row. Enabled Guide/Settings have a clear neutral button surface and normal foreground contrast, with visible labels on phones. The locked main action remains visibly restricted. Desktop density and entitlement behavior are preserved.
4. **Chart Layers.** Coarse pointers open on Close so browsing does not immediately request a text keyboard. Fine pointers stay search-first. Composition Escape does not clear or dismiss; ordinary clear-then-close behavior, visibility/removal state and focus return remain intact.
5. **Light-theme material.** Screenshot review exposed dark modal material behind light-theme text. The library and phone workspace sheet now use the incumbent presentation owner's light palette, scoped to these surfaces. The actual guest theme owner is exercised through storage and reload; no new theme applier or setting was introduced.

No new store, dialog framework, endpoint, engine, trade signal or dependency. These changes follow the existing Terminal tokens and component owners.

## Verification

| Evidence | Result and scope |
| --- | --- |
| Focused unit suite | 6 files, **128 tests passed** for workspace creation/rename/actions, team restrictions, operation/localization contracts, script rename and Chart Layers. This is the product-logic checkpoint; later changes are CSS, one localized Settings span and browser-proof strengthening. |
| Final TypeScript | **Passed**, exit 0 after the final visual delta. |
| Focused ESLint | One pre-existing `react-hooks/set-state-in-effect` finding in LayoutMenu's team-selection effect, reproduced from protected base using ESLint stdin. **No new finding**. Lint is not represented as a clean pass. |
| First complete responsive matrix | 34 passed, 6 intentionally inapplicable cases skipped, 2 incorrect test expectations. Desktop/tablet Export succeeded, but the test assumed its popover would remain open. |
| Corrected final workspace/library/search matrix | **13 passed, 2 intentional skips, zero failures or retries**. The export check now reopens through the existing owner and compares the exact downloaded unreadable payload. |
| Final enabled-action visual delta | **6 passed, zero failures or retries**, covering EN/ZH across desktop, tablet and phone after the labelled action treatment. |
| Cumulative responsive coverage | **36 unique executable cases passed**; 6 cases are intentionally inapplicable to tablet/phone. Repeated focused runs are not added together as unique coverage. |
| Visual review | Final desktop/tablet/phone captures inspected; readable light surfaces, wrapped names, visible focus and enabled study actions verified. Ten selected captures are retained with hashes. |

Viewports: 1440×900, 820×1180 and 390×844. Browser journeys cover workspace save/cancel/reload, native Enter/Space Actions, exact raw Export, script rename/cancel/reload, asynchronous filtered-result focus, search, layer hide/show/remove, touch geometry and reduced motion where applicable.

Unit command: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run lib/__tests__/{layoutRenameFocus,chartObjectTree,indicatorsScriptRename}.test.tsx lib/__tests__/{layoutMenuTeamRead,workspaceMenuOps,workspaceMenuLex}.test.ts --maxWorkers=1 --minWorkers=1`. The flag disables host Node 26 experimental server-side Web Storage so jsdom owns browser storage; it changes no product runtime.

[Capture index and logs](../terminal/docs/pr-crops/workspace-study-20261109/README.md) · [Machine-readable receipt](../terminal/docs/pr-crops/workspace-study-20261109/receipt.json)

### Practical limits of the proof

The account-script fixture implements reads only. Rename persistence proof therefore uses the existing real guest script store and a fresh reload; it does not claim an authenticated Supabase write. Composition checks exercise browser event signals, not an operating-system IME. Touch checks use coarse-pointer browser contexts, not a physical phone keyboard. The workspace light capture verifies the existing token contract; the script journey additionally verifies actual guest presentation-owner reload.

These are local development fixture journeys. Connected Chrome reports another extension UI blocking automation, so no production browser acceptance is claimed. No alternate browser, account or login workaround has been used.

## Source compatibility and release frontier

Protected master advanced to `b3b8e061d1510be46c62ad8c41da328257907305`. The News selector, tooltip lifecycle, transcript focus and dividend-history changes are disjoint from this owned source. The existing deployment workflow also changed: after verified production rollout it refreshes beta only if the incumbent beta service is already active and enabled, using the existing accepted-runtime receipt and health/build readback. This operation does not create another deployer or start inactive beta. No ancestry-only source integration is needed.

Public branch metadata confirms the three protected check contexts: Quote Hub tests, Terminal typecheck + tests, and Ingest + signal-layer tests. Active ruleset `24411653` confirms the native SQUASH/ALLGREEN merge queue and no bypass actors. The GitHub integration's administration-only branch-protection detail read returned 403. Approval-rule detail remains unresolved; empty review requests or a null review decision do not establish either a required approval or its waiver. That denied read remains fenced.

The source and local proof are qualified for the original PR to be Ready. Native PR/head, checks, reviews, explicit holds and queue state remain the current release authority; this frozen evidence document is not a merge or deployment receipt. Next: publish this exact source/evidence, read back the original remote head, mark the original PR Ready, and inspect the allowed effective native release projection. Arm only when actual applicable enforcement and any required approval are established. No self-approval, direct self-merge, admin bypass or duplicate PR.

After a permitted protected merge, consume the existing production/beta workflow and read its actual receipt before claiming deployment. Live browser proof still needs the connected Chrome extension UI obstruction cleared. Parent EX-06/EX-16/EX-20/EX-45 and the wider programme remain open until their actual acceptance obligations are met.
