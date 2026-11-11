# Native route-error return recovery (P12.T21.S1)

A native Shared Shell Portfolio holding already sends its exact presentation URL in `ret` when opening the current chart. If the chart route throws before its own chrome mounts, the root error boundary previously exposed only Retry and a bare `/terminal` link. The current validated Portfolio return was still in the URL but had no usable control.

The incumbent boundary now composes the existing `DashboardBackButton` and `backToMacro` handler around the existing `safeMacroHref` validator. It reads only this load’s explicit `ret`/`return`, not a remembered session/referrer. An empty server snapshot hydrates consistently; location events update the target, and activation rechecks the fresh target before navigation. A scoped 44px stationary target receives focus with `preventScroll`. Existing retry, chart fallback and chunk-reload behavior remain unchanged.

## Evidence and limits

- Actual Next AppShell + actual PortfolioWorkspace + actual root ErrorPage; a fixture Terminal route deliberately throws before any chart/auth/provider work. SDK/onboarding/closed SettingsPanel are explicit fixture seams. No holding callbacks or API/provider writes are allowed. Next’s local original-stack-frame diagnostic POST is classified separately.
- 12 functional cells:1440/820/390 × origin dark/light preference × EN/ZH. Keyboard Enter and touch tap reach the error Back and return the exact query/hash with AAPL quantity unchanged. 11 focused Vitest cases and full TypeScript check pass.
- Native `/terminal` and its root error retain the incumbent **dark-only** contract. SharedShellPresentation deliberately resets the root to dark on unmount; a light origin preference is restored when Portfolio remounts. These captures do not establish a light native-error art direction.
- The error-page Back control is focused; the incumbent hard navigation lands with body focus. This does **not** restore the previous holding’s local selection/focus and is not the Funds iframe’s parent-DOM restoration.
- This is isolated route-error proof, not full-host 503, deployed/authenticated acceptance or paid-data proof. No alternate account/browser effect or held original Chrome action was used.
- The targeted ESLint command finds the same pre-existing `no-html-link-for-pages` issue on the retained hard-reload `/terminal` anchor (baseline line 77/current line 111). No rule suppression, NextLink substitution or fallback behavior change was introduced.

`result.json` binds the tested source bytes and captures. The complete retained fixture, negative captures and runnable scripts are at `/Volumes/Mastermind/evidence/native-holding-return-p12-20261103/` (`capture-stable.mjs`, `capture-theme-contract.mjs`, `next-fixture`). The baseline two-cell report records the missing Back. Earlier selector/quantity/framework-diagnostic fixture failures and the moving borrowed-control touch failure remain preserved. The final source makes that recovery control stationary rather than forcing the tap.
