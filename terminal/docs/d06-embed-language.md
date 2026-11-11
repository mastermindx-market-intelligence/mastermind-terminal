# D06 embed content language

The compact chart and its invalid-symbol view now declare the language of their own rendered content. An embed requested with `lang=zh` exposes `zh-CN`; an English embed exposes `en`. This declaration is scoped to the existing `.embed-root` in both `EmbedChart` and `EmbedError`.

The widget already chose translated labels from its query parameter, while the root document chose a language from the saved application preference or browser language. With opposite preferences, Chinese content inherited English semantics and English content inherited Chinese semantics. This violated the existing [D06 content-language requirement](https://github.com/mastermindx-market-intelligence/macro/blob/53af5e535a15e618e0f73ec2b5deffc88df430b9/research/design_candidates/production_design_20261102/d06/PRODUCT_UX_SPEC.md).

## Scope and retained behavior

Only the two existing root elements change. The correction does not call the global language setter or change `mm.lang`, document `lang`, application `data-lang`, canonical symbol parsing, range ownership, chart rendering, palette, analytics, auth or host integration. Loading, ready and empty content inherit from the chart root; missing and malformed symbols inherit from the error root.

The source file was identical in the published D06 parent and observed master `3930ce93bb1ed6f3d66ba1ae4cac7e441995ba78`: blob `2b98bc0ef392eddb4cf772a88b1d99d512480b98`. No intervening source collision was observed in this file. This is not a whole-branch mergeability claim.

## Verification

| Check | Actual result |
| --- | --- |
| Unchanged-source browser baseline | **Six failures**: EN/ZH loading, empty and missing-symbol entry inherited the opposite document language |
| Final browser cases | **18 passed**, zero failed/skipped/flaky, no retries |
| State observations | **30** content/document/application/storage language observations across loading, ready, empty, missing and malformed symbol states |
| Viewports | Desktop 1440×900, tablet 820×1180, phone 390×844 |
| Retained chart journey | `nvda` canonicalizes to NVDA; initial 3M remains selected; SMA50 toggles; 1M selects; existing Terminal CTA remains exact |
| Geometry | No document horizontal overflow in all observed states |
| TypeScript | `tsc --noEmit --incremental false` exit 0, after the browser server ended |
| ESLint | New browser spec: zero findings. Existing component: the same five pre-existing errors as the published parent, with byte-equal diagnostic messages |
| Source review | Two root-language declarations only; changed source/test hashes stable and diff check passed |
| Visual samples | Six of the 18 captured PNGs inspected, spanning EN/ZH, desktop/tablet/phone, ready/empty/error and the incumbent light/dark variants |

The five existing lint findings are one `react-hooks/set-state-in-effect` and four `@typescript-eslint/no-explicit-any` errors. The component does not have a clean full-file lint result. The correction introduces no new finding, and no suppression or unrelated lifecycle rewrite was used.

The browser tests use the real local `/embed/chart` route and intercepted deterministic same-origin daily-bar responses. They deliberately set the saved application language to the opposite of the embed language. Effective content language is read from the nearest actual language-bearing ancestor; preference and document state are checked separately. The loading response is held and then released to verify the same declaration before and after data arrives.

[Verification receipt](pr-crops/d06-embed-language/verification.json) · [Baseline report](pr-crops/d06-embed-language/baseline-report.json) · [Final browser report](pr-crops/d06-embed-language/browser-report.json) · [State observations](pr-crops/d06-embed-language/language-observations.json) · [Baseline lint](pr-crops/d06-embed-language/lint-baseline.json) · [Current lint](pr-crops/d06-embed-language/lint-final.json).

### Inspected visual samples

- [Desktop Chinese, ready/light](pr-crops/d06-embed-language/embed-desktop-zh-ready.png)
- [Phone English, ready/dark](pr-crops/d06-embed-language/embed-mobile-en-ready.png)
- [Tablet English, empty/light](pr-crops/d06-embed-language/embed-tablet-en-empty.png)
- [Phone Chinese, empty/dark](pr-crops/d06-embed-language/embed-mobile-zh-empty.png)
- [Desktop English, invalid symbol](pr-crops/d06-embed-language/embed-desktop-en-invalid.png)
- [Tablet Chinese, invalid symbol](pr-crops/d06-embed-language/embed-tablet-zh-invalid.png)

These establish the language correction and unchanged visible state behavior, not a new embed visual design. Existing attribution/time-axis overlap, small targets, zoom policy, upstream failure classification, daily as-of and native-host behavior remain separate D06 acceptance work. Actual screen-reader pronunciation, physical devices, every theme/state combination and hosted/production behavior were not qualified.

## Reproduction and custody

```sh
TERMINAL_E2E_PORT=50354 TERMINAL_VISUAL_EVIDENCE_OPERATION=d06-embed-language-final-20261104 npm run test:e2e:responsive -- e2e/embed-content-language.spec.ts --project=desktop --project=tablet --project=mobile --workers=2 --retries=0
npx tsc --noEmit --incremental false
npx eslint app/embed/chart/EmbedChart.tsx e2e/embed-content-language.spec.ts --format json
```

Run the typecheck after the browser server exits. The ESLint command intentionally reports the existing five component findings; compare the retained baseline rather than treating this as a clean lint pass.

This continues the original operation `d06-terminal-reader-resilience-20261103-c4` and branch, after published feedback commit `fed19d1ac3aa8a716f528c8205651ff60b7b413d`. Its 28 changed published GitHub blobs were compared with the local commit: zero mismatches. The feedback source/test hashes remain unchanged.

This adds partial A11Y02 language evidence. The full 75-case migration requirements, final F01/F02 composition, exact Paper write admission, current-head hosted CI and production acceptance remain separate. Both D06 PRs remain Draft; Ready, enqueue, merge, held relabel and deployment remain held.
