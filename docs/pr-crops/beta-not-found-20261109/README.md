# 404 recovery actions and saved language — 2026-11-09

Independent beta UI leaf of market-os-shared-shell-design-20260924-sol-001 / MARKET-OS.

- Terminal base: `8390cc4ad41b1c0773e979198c80e742852c01dc`.
- Governing Mastermind pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Current Paper reference: [Shared Shell · Integration reference · R1](https://app.paper.design/file/01M6Y2GT8S3YP4TK052PPESZEC/p-2-0), SS12 `2L8-0`, action container `2LV-0`.

## Reproduced gaps

The existing 404 offered only a 38px Go to chart link. The real missing-route browser regression failed because Go to Today did not exist.

A direct 404 also left html without data-lang even with a saved Chinese preference. The provider remained in English. The dev server records the incumbent root-script warning on this path: React does not execute the script when rendering it on the client. The new leaf restores a validated saved language through the existing applyLang owner only when the document has no active language.

## Change

- A primary Go to Today link to /today, secondary Browse tools link to /discover, and retained chart link to /terminal.
- 48px minimum actions, visible keyboard focus, contained scrolling inside the shell's content row and a phone layout starting below the existing header.
- Hide the duplicate interior brand mark when shell branding is present.
- Keep the existing language provider, heading lexicon, shell chrome and real destinations. The 404 response remains 404.
- Restore only a valid saved en/zh language when data-lang is absent; existing active language and subsequent account-owner updates retain priority. No new preference store, listener or theme owner.

This implements the SS12 recovery-action pattern on existing routes. It does not claim the separate company-search card or every mockup detail is newly implemented.

## Verification

- **8 browser cases passed in each of two shell modes**, plus 4 intentional duplicate viewport-loop skips per mode.
- Desktop/tablet/320px phone; default shell EN/ZH in dark, beta English/dark and Chinese/light; explicit 568×320, 320×568 and reference-sized 320×844 views.
- Actual keyboard navigation follows all three links. Today reaches its existing signed-out gate; Discover mounts its workspace; the chart mounts its actual chart body. No account gate is bypassed.
- Every missing-route response is still HTTP 404.
- Direct saved-language tests prime only mm.lang in storage, then require the matching actual document language and page content before a manual toggle.
- Each short-screen language case starts from the saved language; beta retains the actual theme-button interaction and checks its pressed state.
- Actions stay within viewport bounds, are at least 44px high, have a visible 2px focus outline and pass real hit-testing. Beta header position and document scroll remain stable; legacy mobile retains its existing page-scrolling layout.
- **4 focused component tests passed** against the actual LangProvider: saved preference recovery, active-language precedence, invalid preference and unavailable storage.
- TypeScript, focused ESLint and diff whitespace checks passed.

```sh
env -u MMX_SHARED_SHELL CI=1 TERMINAL_E2E_PORT=3305 npx playwright test e2e/not-found-recovery.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0 --reporter=list --output=test-results/not-found-legacy-final
MMX_SHARED_SHELL=1 CI=1 TERMINAL_E2E_PORT=3305 npx playwright test e2e/not-found-recovery.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0 --reporter=list --output=test-results/not-found-beta-final
```

## Captures

- [Before: chart-only recovery](before-desktop.png)
- [After: desktop English](after-desktop-en.png)
- [After: 320px English](after-mobile-en.png)
- [After: Paper-sized 320×844 Chinese/light](after-zh-320x844.png)
- [After: 320×568 Chinese/light](after-zh-320x568.png)
- [After: short landscape, scrolled to recovery actions](after-en-568x320.png)

The red development issue badge is present in both baseline and candidate captures and comes from the existing root-script warning above. It is not a new product control; it has not been hidden or edited out. Root layout and framework configuration are outside this leaf. These are local development-path captures, not beta deployment proof.


## CI mode correction on the original PR

Run 42591635037, desktop-3 job 129075433974 and tablet-2 job 129075434249 failed at the test's unconditional beta toolbar lookup. The original hosted artifact shows rendered 404 links and correctly restored Chinese content in the default shell. The original bfa86b812ce5a7b74deb8a349de3209de47cdd70 test reproduced the same missing-control failure locally on an explicitly default-shell server.

The initial proof used an explicitly enabled beta server; its earlier abbreviated command omitted that server-mode context. The repaired spec now reads the actual mode, retains all recovery destinations and interaction checks in ordinary CI, and exercises beta toolbar/light presentation only when enabled. Discover's actual legacy tablist and normal mobile document scrolling are checked according to the existing shell contract. No spec-wide skip, timeout increase, workflow change or production code change was made.

Both final modes passed 8 cases with 4 duplicate short-screen skips. Fresh harness-owned servers were used sequentially on the original operation; verified owned development caches were preserved separately between modes. TypeScript, affected ESLint and diff checks passed. The preceding 4 component tests and source crops remain valid because this follow-up changes only the browser spec and this proof.
