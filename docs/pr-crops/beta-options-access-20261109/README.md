# Options access UI proof — 2026-11-09

Implementation leaf of `market-os-shared-shell-design-20260924-sol-001` (MARKET-OS), continuing the Chairman's beta UI assignment while PR #1362 runs through protected checks.

## Source and reference

- Independent Terminal source base: `8390cc4ad41b1c0773e979198c80e742852c01dc`.
- Governing Mastermind pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- [Paper Shared Shell · Integration reference · R1](https://app.paper.design/file/01M6Y2GT8S3YP4TK052PPESZEC/p-2-0), including plan-required and unavailable states.
- Scoped Options styles use existing application tokens and retain the incumbent bilingual copy, entitlement decisions and session-recovery behavior.

## Reproduced problems

The /options paywall had no main landmark. Activating the shell's Skip to content link could not focus its content. Its primary action measured 41.56px high. At 568×320, the centered card's heading and action extended beyond the available content viewport.

The entitlement-outage screen placed role=status on main, which excluded it from the shell's main-landmark target. Its 100vh container measured 320px high starting at y=56 in a 320px viewport, extending to y=376. Retry and chart-return actions measured 38px high.

## Changes and proof

Both states now have a focusable main landmark, scrolling contained within the shell, neutral theme-aware cards, and actions at least 44px tall. Outage announcements remain in an inner status region. Chart return retains /terminal through Next Link without prefetch. Retry still reloads; the paywall still opens signup with the Essential plan.

The dedicated `playwright.options-access.config.ts` extends the incumbent test server and responsive projects, setting FLOW_FIXTURE=0 to exercise the actual access gate. The ordinary suite intentionally uses FLOW_FIXTURE=1 to preview paid workspace data, so its paid-feed warmup does not apply to these access-state tests. Auth is loopback-only; the outage case uses the existing development shell identity fixture while the real Options auth reader fails against the loopback provider. No production bypass or auth/data rule was added.

Validation:

- Responsive browser run: **10 passed, 2 intentional duplicate viewport-loop skips**.
- Checks include actual skip-focus, dark/English and light/Chinese, Essential entry, short/narrow contained scrolling, recovery retry, outage retry/reload and chart return.
- After converting chart return to Next Link, the real outage → chart path passed again at 568×320.
- **12 focused unit tests passed** for unavailable copy/recovery and session behavior.
- TypeScript, focused ESLint and diff whitespace checks passed.

Run the focused browser matrix with an owned free port:

```sh
TERMINAL_E2E_PORT=3288 npx playwright test --config=playwright.options-access.config.ts --workers=1
```

## Captures

- [Desktop dark paywall](paywall-desktop-dark.png)
- [Mobile light/Chinese paywall](paywall-mobile-light-zh.png)
- [Short viewport, focused action](paywall-short-scrolled.png)
- [Outage actions beneath the fixed header](outage-short-actions.png)

These are local candidate captures. Protected merge/queue state and a beta release receipt remain separate from this UI proof.
