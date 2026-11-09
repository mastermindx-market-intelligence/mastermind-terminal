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

- **7 browser cases passed**, plus 2 intentional duplicate viewport-loop skips.
- Desktop/tablet/320px phone; English/dark and Chinese/light; explicit 568×320, 320×568 and reference-sized 320×844 views.
- Actual keyboard navigation follows all three links. Today reaches its existing signed-out gate; Discover mounts its workspace; the chart mounts its actual chart body. No account gate is bypassed.
- Every missing-route response is still HTTP 404.
- Direct saved-language tests prime only mm.lang in storage, then require the matching actual document language and page content before a manual toggle.
- Short-screen checks use the existing language/theme buttons and their actual pressed state.
- Actions stay within viewport bounds, are at least 44px high, have a visible 2px focus outline and pass real hit-testing. Header position and document scroll remain stable.
- **4 focused component tests passed** against the actual LangProvider: saved preference recovery, active-language precedence, invalid preference and unavailable storage.
- TypeScript, focused ESLint and diff whitespace checks passed.

```sh
TERMINAL_E2E_PORT=3293 npm run test:e2e:responsive -- e2e/not-found-recovery.spec.ts --project=desktop --project=tablet --project=mobile --workers=1
```

## Captures

- [Before: chart-only recovery](before-desktop.png)
- [After: desktop English](after-desktop-en.png)
- [After: 320px English](after-mobile-en.png)
- [After: Paper-sized 320×844 Chinese/light](after-zh-320x844.png)
- [After: 320×568 Chinese/light](after-zh-320x568.png)
- [After: short landscape, scrolled to recovery actions](after-en-568x320.png)

The red development issue badge is present in both baseline and candidate captures and comes from the existing root-script warning above. It is not a new product control; it has not been hidden or edited out. Root layout and framework configuration are outside this leaf. These are local development-path captures, not beta deployment proof.
