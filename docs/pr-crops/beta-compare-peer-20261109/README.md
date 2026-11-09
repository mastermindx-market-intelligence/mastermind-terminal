# Comparison peer controls — beta UI proof

## Observed problem

On protected base `1377853d02fdb0295c0848d7127fdee4ca36714b`, keyboard removal of a focused peer left focus on the document. The remove control measured 20 × 20 px on desktop and 32 × 32 px on a coarse-pointer phone. At 320 × 568, native focus scrolling could leave a peer behind the fixed Financials navigation.

The baseline browser journeys failed on missing successor focus and the undersized removal target. `before-focus-loss-320.png` and `before-target-320.png` preserve those original captures.

## Result

Removing a focused peer now moves focus to the following peer, then the preceding peer, or the Add peer field when the final peer is removed. A component-local ref map preserves the existing peer/data flow. Remove controls are 44 × 44 px, the Add field and button have a 44 px minimum height, and a visible focus ring identifies the keyboard destination. Local scroll margins keep native focus scrolling clear of the fixed bottom navigation. The real phone journey checks top, center and bottom hit targets after focus settles.

## Verification

- Final new Playwright journeys: **6 passed**, desktop/tablet/mobile. Mobile explicitly uses **320 × 568**. Enter removes the middle peer, Space removes the last peer, Enter removes the remaining peer, and typing then Enter adds a new peer. Every focus destination is hit-tested against the actual page layers.
- Existing comparison consumer journeys: **4 desktop tests passed** for comparability/currency/period refusal, exact Statements drillback, missing/failed peer retry, and restated source versions.
- Focused unit tests: **40 passed** (`finCompare` 35; `finCompareLex` 5).
- Final TypeScript, ESLint on the modified component/spec, and `git diff --check` passed.
- The new journey verifies that adding JPM still refuses incompatible industrial revenue comparison; it does not manufacture a comparable financial number.

Commands, run inside `terminal/`:

```sh
TERMINAL_E2E_PORT=3297 npm run test:e2e:responsive -- e2e/fin-compare.spec.ts --grep 'removing comparison|comparison peer removal' --workers=1
npx tsc --noEmit
npx eslint components/fin/FinComparePage.tsx e2e/fin-compare.spec.ts
```

## Captures and reference

`after-remove-{desktop,tablet,mobile}.png` shows the focused successor after removal. `remove-target-mobile.png` shows a wrapped 0700.HK peer, the full removal target, and clearance above bottom navigation. Images come from the actual local Analysis route with the repository's synthetic fund fixtures; no live financial claim is made from those fixtures.

Paper reference: SharedShell Integration Reference R1, file `01M6Y2GT8S3YP4TK052PPESZEC`, page `p-2-0`, company Analysis artboard `2RK-0`. This fix supports the existing company research workflow and reuses its shell/theme/language context. It does not claim a new Paper design was approved.

Source ownership was checked against the active PR census. Shared `fin.css`, chart, shell navigation, and unrelated open work remain outside this diff.

## Delivery state

This is local consumer proof for the PR. Native CI, merge-queue acceptance, merge, deployment and live beta acceptance remain distinct states; local screenshots do not establish a deployed beta result.
