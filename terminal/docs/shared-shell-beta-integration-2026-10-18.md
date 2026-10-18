# Shared Shell beta integration — 2026-10-18

This is the native implementation checkpoint for the Chairman's Shared Shell programme. The programme master plan and Paper reference census remain in Macro's research/market_os/SHARED_SHELL_WEBAPP_PRODUCTION_PLAN_2026-10-18.md and the existing WS:MARKET-OS record. The supplied Paper boards are partial design evidence; they are not a complete feature specification.

## Integration decisions

- The persistent route-group shell owns the legacy browsing context. A generated finite route catalogue admits existing HTML destinations; HTML internals can graduate independently to native components.
- Existing identity, onboarding, settings, locale and symbol owners remain authoritative. Shared Shell copy consumes useLang and useT from the incumbent locale provider.
- Beta-only root theme variables live in the feature stylesheet. The task's changes to app/globals.css and lib/i18n.tsx were removed and their protected-base bytes restored. Historical visual evidence was not rewritten to match unrelated Shared Shell additions.
- The legacy catch-all is an admission gate, like /admin: an unknown path or a disabled shell must raise a real 404 before a response streams. It therefore has no loading.tsx. The existing workspace-skeleton test now names this gate explicitly, and a separate test executes its flag/catalogue/metadata decisions and checks the ancestor boundary chain. The persistent host supplies loading, failure, refresh and retry feedback and exposes aria-busy.
- The chart document at /embed/chart admits the exact beta ancestor in both application profiles. Its effective CSP replaces the embed default in the existing Next header owner. Native /terminal framing and the direct-parent chart message allowlist are unchanged.
- Legacy Terminal launches hand off to the admitted native /terminal route before constructing an overlay or an iframe. Symbol, AI and first-party return state remain in the existing handoff.
- The ordinary mobile drawer now closes on Escape and restores focus to its opener. The beta drawer continues through its existing dialog owner.
- Beta email signup explicitly returns through https://beta.mastermind-x.com/auth/callback with the incumbent onboarding resume parameter. The callback validates same-origin return paths, including browser-normalized backslash/control-character cases, while retaining password recovery proof and the ordinary application's default destination.

## Verification at this checkpoint

Owned local tests passed: 160 focused native tests across 15 files, including the previously failing visual-evidence suites, route admission, auth recovery and new redirect cases. After correcting the new header test's environment fixture, its 49 assertions and tsc --noEmit passed. The Macro integration's navigation/account/Terminal handoff tests passed together (111 tests). These are source-level results, not browser or deployed-beta acceptance.

The protected Terminal base advanced by three changes during the work: Lab active setups, chart context-menu cleanup and the chart research pane's mobile exit. This checkpoint is being joined with that protected source before publication. Current-head CI, the final production build and real browser checks remain the release gates.

## Installation state

Supabase's existing project now allows the beta callback and its next query form. No signup, password-reset email or account mutation was performed as verification. DNS currently targets EdgeOne and that endpoint fails beta hostname validation; no DNS cutover has been saved. The beta systemd service and deployment-owner bootstrap candidate are not installed or accepted at this checkpoint. Installation must use the incumbent protected release owner with its shared build lock, real source/data preflight, dedicated beta identity, read-only production-data bind, exact runtime tuple and truthful first-release/rollback semantics.

The first beta must still be verified in the actual browser at desktop, tablet and mobile sizes, including legacy/native/history navigation, theme and language ownership, chart nesting, authentication return paths, failure/retry behavior, isolation and rollback.
