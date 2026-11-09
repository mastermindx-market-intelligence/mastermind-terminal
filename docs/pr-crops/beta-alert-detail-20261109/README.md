# Alert detail focus and viewport proof — 2026-11-09

Independent beta UI leaf of market-os-shared-shell-design-20260924-sol-001 / MARKET-OS.

- Terminal source base: `8390cc4ad41b1c0773e979198c80e742852c01dc`.
- Governing Mastermind pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Current Paper integration reference: https://app.paper.design/file/01M6Y2GT8S3YP4TK052PPESZEC/p-2-0
- Companion #1366 fixes activity-row activation independently; this branch works with the existing Enter handler and does not modify its files.

## Reproduced defects

Before the change, opening Alert detail by keyboard left focus behind the modal. The new actual-route browser case failed at the initial focus assertion. At 568×320, the dialog extended to y=438.47 and the receipt was below the viewport.

Visual inspection also found that the shell header painted above the dialog. A document-body portal now escapes the workspace stacking context; hit tests sample the controls' top, center, and bottom so numerical viewport bounds alone cannot mask an obstruction.

## Changes

- Reuse the existing `useDialogFocus` helper without modifying it: focus enters the visible heading, Tab/Shift+Tab stay in the modal, Escape closes, and focus returns to the activity opener.
- The static heading receives initial focus, keeping long content readable and avoiding an opening Enter key activating Close. Close remains the first Tab control.
- Receipt's native summary has explicit tabIndex=0 so the existing helper includes it. Evidence-present and evidence-absent cases both cycle correctly.
- Component-scoped CSS contains the full receipt in the viewport, wraps long source errors, stacks facts on 320px screens, and gives Close/Receipt at least 44px targets.
- Preserve current detail data, delivery semantics and destinations. The portfolio link uses Next Link with prefetch disabled.
- The shared alerts.module.css, global overlay infrastructure and shell chrome are untouched. Existing semantic unit assertions now query the real document-body portal.

## Validation

- Baseline: 2 focused browser failures reproduce initial focus and short-viewport clipping.
- Candidate: **7 browser cases passed**; 2 duplicate viewport-loop executions intentionally skipped.
- Desktop, tablet, and 320px phone; English/dark and Chinese/light; explicit 568×320, 320×568 and 844×390 viewport loop.
- Initial heading focus, Close as first Tab target, forward/reverse wrapping including Receipt, Escape and pointer-close focus return.
- Real top/center/bottom hit testing and full expanded receipt reachability without horizontal overflow.
- Zero alert mutation requests while reading and closing detail.
- **119 existing unit cases passed** across alert data semantics, thesis/ordinary-alert detail and nested dialog focus ownership.
- Focused ESLint, TypeScript and diff whitespace checks passed.

```sh
TERMINAL_E2E_PORT=3291 npm run test:e2e:responsive -- e2e/alert-detail-keyboard.spec.ts --project=desktop --project=tablet --project=mobile --workers=1
```

## Captures

- [Before: keyboard focus remains behind the dialog](before-focus-desktop.png)
- [Before: 568×320 clipping](before-short-568x320.png)
- [After: desktop English](after-desktop-en.png)
- [After: 320px Chinese/light](after-mobile-zh.png)
- [After: short viewport top and Close](after-top-568x320.png)
- [After: full expanded receipt in the same short viewport](after-receipt-568x320.png)

Deterministic local data, not a live alert, protected merge or beta deployment.

## Composed-consumer CI repair

The Terminal unit job [129070542484](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/42590127401/job/129070542484) at `f2c2a861d2ac8a1144aab4c50f20559480fa3dd3` found ten failures in three existing composed-consumer suites. Each queried the old page-container location and returned null after the modal moved to the document-body portal. The same ten failures reproduced locally (15 other cases passed).

The repair updates nine modal lookups in `alertsCockpitThesisSummary.test.tsx`, `alertsCockpitZhParity.test.ts`, and `heldMaterialConsumer.test.tsx`. All content, localization, numeric-value, evidence-link and no-invented-price assertions remain intact. Existing teardown unmounts each root and therefore removes its portal.

The three composed suites plus the original alert-data, detail and nested-focus suites now pass **144 tests across six files**. TypeScript and diff whitespace checks pass. The three-file ESLint run reports only the pre-existing `no-explicit-any` at `heldMaterialConsumer.test.tsx:8`; running ESLint against that file's unchanged HEAD bytes confirms the identical finding. No production code changes in this repair, so the existing seven browser cases and images still qualify the unchanged UI.

```sh
npx vitest run lib/__tests__/alertsCockpitThesisSummary.test.tsx lib/__tests__/alertsCockpitZhParity.test.ts lib/__tests__/heldMaterialConsumer.test.tsx lib/__tests__/thesisDetailSurface.test.ts lib/__tests__/alertsView.test.ts lib/__tests__/dialogFocusNestedOwnership.test.tsx --reporter=dot
npx tsc --noEmit --pretty false
```
