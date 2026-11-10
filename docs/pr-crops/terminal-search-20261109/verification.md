# Search continuity verification

## Exact source

- Product commit: `0cd9cef3ba90de84977e27d1f817f7255ac2e799`.
- Source base: `1377853d02fdb0295c0848d7127fdee4ca36714b`.
- Procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.

| Product file | Git blob |
| --- | --- |
| terminal/components/SearchModal.tsx | `d72fe57effda9b0b9157bba28baea11e8af378fb` |
| terminal/components/SharedSearchWorkspace.tsx | `e2edd7a58db894a0d152952be1475676c20a62bc` |
| terminal/lib/revealListOption.ts | `b857c79f9a7efb08317b81dcec1ec520343cd4d7` |
| terminal/lib/__tests__/searchSelectionContinuity.test.tsx | `882b5bbe9773009cea6ede42501b2ab5407fd0cc` |
| terminal/e2e/search-selection-continuity.spec.ts | `2ffd54a9a230a0c0ba4706724ab294053cef1d8a` |

The isolated no-git browser source restored RouteSkeleton, AppNav, MobileNav, Tip and the existing navigation suite to their exact base blobs before testing this candidate. All changed files and those runtime boundaries were hash-checked before execution. GitHub-native source publication uses an owned branch and exact-head leases.

## Results

| Check | Result |
| --- | --- |
| Mounted composition/IME, keyboard recovery, Shared Search and new continuity cases | 156 passed on the final product |
| Changed source, unit and browser lint | 0 errors, 0 warnings |
| Full TypeScript | Exit 0 in the combined local integration snapshot containing these exact runtime/test blobs |
| Real-route browser cases | 10 passed, 2 intentional duplicate breakpoint-case skips, zero retries; ordinary 1.2 minutes plus Shared Companies 23.2 seconds |

Desktop 1440×900, tablet 820×1180 and phone 390×844 each verify long keyboard navigation, selected full-row visibility, query-reset scroll recovery, no pointer-hover scrolling, unchanged input/page position and ordinary dismissal focus return. Shared Companies repeats the local-scroll/focus journey under its existing beta opt-in. Add mode verifies that a nonempty no-match query cannot add the chart's active symbol, while an intentional valid symbol is saved once to the existing isolated watchlist owner.

One explicit desktop → phone → desktop journey verifies the same query and selected option survive presentation changes. This case is skipped as a duplicate in the other two projects. It does not claim cross-presentation opener restoration; that distinct incumbent focus-owner issue is recorded below.

Mounted cases additionally hold a deferred result snapshot to verify stale keyboard and pointer actions cannot commit it; preserve IME composition, HOME navigation and the blank Add shortcut; hide pending empty-state claims without layout collapse; reconcile removed selections; and reveal restored companies after their universe arrives. This controlled harness is not an INP/scheduler benchmark.

## Visual and ownership corrections

The phone sheet deliberately owns scrolling at `.msheet-body`, while its inner result list has visible overflow. Keyboard reveal now respects that owner and its sticky-input scroll padding. Search passes the complete visual result row to the geometry helper, including its padding and sibling actions, while retaining the existing accessible option anatomy. A strengthened padded-row regression failed three cases before this correction and passed afterward. Desktop, phone and Shared Companies phone captures were inspected.

A source-transfer truncation was detected while the PR was still Draft. The complete local source was recovered in bounded chunks and checked against its Git blob before publication; the final browser run verifies the restored exact product. No failed draft candidate was marked Ready or enrolled.

## Known follow-up

Resizing one open Search desktop → phone → desktop can still lose its original opener on final dismissal. Existing per-presentation focus owners capture separate references. A separate consumer-backed repair can pass one optional logical-session return-focus reference through the existing owners. #1307's exact MobileSheet eligibility hunks and source-custody hold were reconciled: this is a distinct proposed change; do not copy its held patch or alter its release state. Ordinary single-presentation dismissal is proved here.

## Delivery and continuation

The evidence commit does not change the qualified runtime. PR #1376 records Ready/native exact-head auto-merge enrollment separately. Loading #1373, tooltip #1378 and navigation #1380 proceed independently. Fixture qualification is not measured performance improvement, merge, deployment or live acceptance.

[Desktop](desktop.png) · [Phone](phone.png) · [Shared Companies on phone](shared-phone.png).
