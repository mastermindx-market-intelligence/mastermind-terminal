# Bounded status revalidation - incremental qualification

Four defects reproduced on the previous exact candidate: non-2xx status falsely requested a version refresh; an older visibility response could hide a newer confirmed page; a hanging status body had no deadline; and initial admission timeout did not cancel its request.

The existing frame owner now cancels superseded reads, bounds response and body to the original 15-second deadline, ignores late responses, and distinguishes retryable availability from an actual protocol/build/catalog change. Hidden-tab and navigation cleanup abort only the owned request. Genuine mismatches remain fail-closed; late frame messages cannot revive a retired attempt. Original focus behavior, source admission, chart-company handoff and CSS are retained.

## Qualification

- Before: 4/4 additional defects reproduced against the exact component from `a5a7c9ccdeb1efa928ca6f79083dbb564c607799`.
- After: 118/118 tests across seven existing suites, including 13 new cases.
- Real Next/browser: 24 passed, six unchanged viewport-specific skips, zero retries. The new 503 -> retry -> same URL/document/new frame generation case passes at 1440x900, 820x1180 and 390x844.
- TypeScript and diff whitespace: pass.
- ESLint: changed tests pass; LegacyPageHost has exactly the original two hook errors and one dependency warning, no additional diagnostic.
- Node 26 uses the already documented `NODE_OPTIONS=--no-experimental-webstorage` compatibility setting. No source or fixture storage check was weakened.

`manifest.json` binds changed source and all six new screenshots. The parent manifest and its screenshots remain historical evidence for the prior candidate, not newly stamped evidence. Recovery images show a controlled cross-origin child; no live data or authenticated acceptance is claimed.

## Commands

Unit suites: sharedShellNavigationCommit, sharedShellRecovery, sharedShellCompanyHandoff, sharedShellContracts, sharedShellPublicPresentation, analysisWorkspaceNavigation and sharedShellRouteIdentity using the incumbent Vitest command.

Browser: `MMX_SHARED_SHELL=1 TERMINAL_E2E_CLOSED_CANONICAL_TRANSPORT=intl-fixture-v1 TERMINAL_E2E_PORT=3196 CI=1 npx playwright test e2e/shared-shell-refinement.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0 --output=test-results/status-revalidation-20261109 --reporter=line`, with the Node option above.

Source is qualified locally on the original carrier. Exact-head hosted CI, protected merge, beta transaction and live proof remain separate obligations.
