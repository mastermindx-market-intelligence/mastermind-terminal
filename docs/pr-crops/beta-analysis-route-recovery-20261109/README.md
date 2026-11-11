# Unsupported Analysis route recovery — 2026-11-09

Independent UI leaf of `market-os-shared-shell-design-20260924-sol-001` / MARKET-OS.

- Terminal base: `1377853d02fdb0295c0848d7127fdee4ca36714b`.
- Governing Mastermind pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Paper reference: [Shared Shell · Integration reference · R1](https://app.paper.design/file/01M6Y2GT8S3YP4TK052PPESZEC/p-2-0), Company Analysis `2RK-0` and recovery pattern SS12 `2L8-0`. This adapts that recovery-action pattern; no separate accepted mockup of this exact unsupported-view message is claimed.

## Reproduced issue and change

On the real `/analysis?view=nope` route, **Company research** was an unstyled inline link with a **16px-high** hit target at 1440×900, 320×568 and 568×320. The existing semantic-main skip behavior worked, and those baseline viewports did not overflow.

The recovery link now has a visible primary-action treatment, a 44px minimum height and a clear focus outline. It remains an anchor to `/analysis`, rendered through the installed Next Link component with prefetch disabled. On phones the action fills the card width.

A leaf CSS module retains the existing shell sizing and 560px card limit. A nonshrinking card with auto margins remains centered when it fits and can scroll from its top on shorter screens. No inner viewport height is introduced. Existing tokens provide light/dark presentation.

The unsupported-route decision, hidden diagnostic reason, bilingual copy, authentication gates, route parser and Analysis data are unchanged. No shared stylesheet, AppShell or alternate layout was modified.

## Verification

- **6 new beta browser cases passed**: EN/dark and ZH/light across desktop, tablet and 320×568 phone.
- **3 existing AI-context cases passed**: unsupported view still reports Analysis with no panel.
- **6 default-shell browser cases passed**: the same real recovery journey in both languages, dark presentation, all three projects.
- Every recovery action meets the 44px target, stays in viewport bounds, shows keyboard focus and passes hit-testing at three vertical points.
- The phone cases rotate to 568×320, reach the heading and action, and then activate the native link with Enter. In beta the content scroll does not displace the header or document.
- Every case reaches the real Analysis workspace with the unsupported `view` parameter removed.
- TypeScript, focused ESLint and `git diff --check` passed on the final source.
- The browser tests use the existing development-only Analysis preview and committed local market fixtures. No production login, account writes or market-data modification is claimed.

Beta command, against the operation's verified owned server explicitly started with `MMX_SHARED_SHELL=1` and the standard local fixture environment:

```sh
MMX_SHARED_SHELL=1 TERMINAL_E2E_PORT=3303 npx playwright test \
  e2e/analysis-route-recovery.spec.ts e2e/analysis-ai-context.spec.ts \
  --project=desktop --project=tablet --project=mobile \
  --workers=1 --retries=0 --grep unsupported \
  --output=test-results/analysis-route-final
```

Default-shell command after the owned beta server completed, using a fresh harness-owned dev server:

```sh
env -u MMX_SHARED_SHELL CI=1 TERMINAL_E2E_PORT=3303 npx playwright test \
  e2e/analysis-route-recovery.spec.ts \
  --project=desktop --project=tablet --project=mobile \
  --workers=1 --retries=0 --reporter=list \
  --output=test-results/analysis-route-legacy
```

The new spec follows the actual server mode, so ordinary CI keeps its recovery coverage without requiring beta-only toolbar controls.

## Captures

- [Before: 320px English](before-mobile-en.png)
- [Before: short Chinese landscape](before-landscape-zh.png)
- [After: desktop English](after-desktop-en.png)
- [After: tablet Chinese](after-tablet-zh.png)
- [After: 320px English](after-mobile-en.png)
- [After: 320px Chinese](after-mobile-zh.png)
- [After: short English landscape](after-landscape-en.png)
- [After: short Chinese landscape](after-landscape-zh.png)

These are unedited local development captures. Deployment evidence for the earlier access fix is separately recorded in [beta-live-access-20261109](../beta-live-access-20261109/README.md); this new leaf is not represented as deployed.

## Original workspace reconciliation

The existing workspace owner placed this operation in its enrolled secondary storage pool. The adapter's acquire response was initially unqualified because its primary-root equality check disagreed with that owner-selected pool. The original operation was not replayed or rehomed.

Before source edits, the installed owner independently read back the original operation, exact branch/base and clean worktree, and its storage admission returned READY/admission_allowed for the enrolled secondary pool. Typed publication status corroborated the same binding. No adapter, policy, mount, identity, lock or writer was changed. The historical failed predicate was not retained; the subsequent owner/storage readback qualifies the original target without claiming a missing historical receipt.

Studio Direct uses default local M2; no host selection is needed, as directed by the Chairman and the [same-pinned canonical routing documentation](https://github.com/mastermindx-market-intelligence/Mastermind/blob/ff6d5ab67c3535056d69f603fac0d95c058baad8/integrations/studio_direct_mcp/README.md#local-m2-versus-remote-routes).
