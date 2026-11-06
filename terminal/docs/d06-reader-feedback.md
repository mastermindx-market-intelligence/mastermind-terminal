# D06 reader feedback: focus, single acknowledgement and visible confirmation

The chart reader now keeps the activated feedback button in place, announces a localized acknowledgement, and accepts only the first choice for the existing component lifetime. Keyboard users can continue to Hide, return to the acknowledgement, and press Escape to return to the incumbent chart launcher. An 8px scroll margin keeps the complete focus outline visible at the phone viewport edge.

This is a bounded continuation of [D06 Terminal Draft #1270](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1270) and [Macro D06 #10655](https://github.com/mastermindx-market-intelligence/macro/pull/10655). It preserves the earlier [reader presentation](d06-reader-resilience.md) and [chart-time correction](d06-chart-time.md). Overall D06 remains partial; this record does not release the programme.

## Behavior and source

The old success branch removed the focused button and replaced both choices with text. The recovered browser baseline shows focus on BODY immediately after acknowledgement. The repaired control remains mounted and focusable with `aria-disabled="true"`; the other choice is hidden. A status region is mounted before its localized text changes.

A synchronous ref locks both choices before telemetry runs. A state-only guard allowed three events when Useful, Unclear and Useful were activated before React committed the update. Eight EN/ZH and owned/outside-focus regressions reproduced this; the final implementation emits one event containing the first choice. Repeated activation of the acknowledged control or a stale reference to the hidden choice is inert.

The acknowledgement remains local UI feedback. It does not certify server persistence. The existing analytics transport remains responsible for delivery. Component-lifetime feedback behavior is preserved: no new per-symbol, per-bar, per-language, retry, persistence or reset contract is introduced. Focus outside the reader is not taken.

Runtime changes are limited to `components/VisualIntelligencePanel.tsx` and its existing CSS module. The source adds no route, API, preference store, renderer, chart-data conversion, global language change or shared-shell owner.

## Verified evidence

| Check | Observed result |
| --- | --- |
| Recovered browser baseline | One failure; acknowledgement left focus on BODY |
| Synchronous duplicate baseline | Eight failures; three feedback events where one was required |
| Focus-outline baseline | One mobile Chinese failure; the complete outline was outside the viewport |
| Final unit/DOM | **65 passed**, zero failed: eight feedback, 22 presentation, 16 clock, 19 incumbent visual-intelligence |
| Combined browser regression | **46 passed, 14 intentional skips**, zero failures/flaky, before the final feedback-only scroll-margin refinement |
| Final feedback browser matrix | **12 passed**, zero skipped/failed/flaky; EN/ZH × Useful/Unclear × desktop/tablet/mobile after the margin refinement |
| Static | Scoped ESLint exit 0; final `tsc --noEmit --incremental false` exit 0 |
| Source and diff | Four changed source/test SHA-256 values unchanged after verification; diff check and source review passed |
| Visual self-QA | All 12 final raw screenshots inspected; acknowledgement, focus outline and wrapping are readable |
| Geometry | No document horizontal overflow in all 12 captures; phone controls are 44px high and leave at least 8.20px below the button box |

The combined run contains 12 feedback, 14 host-resilience and 20 chart-time passes, with ten host-resilience and four chart-time viewport skips. The final twelve-case run replaces the feedback portion for final CSS qualification; these runs are not added together as distinct coverage. The final margin rule changes only feedback-button focus scrolling. Existing host and clock runtime behavior was unchanged after the combined run.

The new browser cases exercise the real local `/terminal?symbol=NVDA` route with deterministic fixture bars at 1440×900, 820×1180 and 390×844. They check Enter, Space, Tab, Shift+Tab and Escape; first-choice acknowledgement; selected historical bar preservation; historical calendar withholding; help disclosure; and return focus. DOM tests additionally check outside-focus ownership and batched duplicate events. Existing component lifetime is retained by code inspection; the new tests do not separately qualify feedback across every source or host transition.

The first recovered DOM attempt used a stale reader selector; it was corrected before the product regression. An early concurrent typecheck encountered partially generated Next route declarations and one un-narrowed test metadata access. The test type was corrected, and the final typecheck ran after the browser server ended. These intermediate failures are not presented as accepted product evidence.

## Reproduction

From `terminal/` in the existing workspace:

```sh
npx vitest run lib/__tests__/chartContextFeedback.test.tsx lib/__tests__/chartContextPresentation.test.tsx lib/__tests__/chartContextTime.test.ts lib/__tests__/visualIntelligence.test.ts
npx eslint components/VisualIntelligencePanel.tsx lib/__tests__/chartContextFeedback.test.tsx e2e/chart-context-feedback.spec.ts
npx tsc --noEmit --incremental false
TERMINAL_E2E_PORT=50354 TERMINAL_VISUAL_EVIDENCE_OPERATION=d06-reader-feedback-final-20261104 npm run test:e2e:responsive -- e2e/chart-context-feedback.spec.ts --project=desktop --project=tablet --project=mobile --workers=2 --retries=0
```

Run TypeScript after Playwright's dedicated development server ends, so generated route declarations have a stable owner.

[Verification receipt](pr-crops/d06-reader-feedback/verification.json) · [Final unit report](pr-crops/d06-reader-feedback/unit-report-final.json) · [Combined browser report](pr-crops/d06-reader-feedback/browser-report.json) · [Final feedback browser report](pr-crops/d06-reader-feedback/browser-final-report.json) · [Focus and geometry observations](pr-crops/d06-reader-feedback/focus-observations.json).

| Final captures | English | Chinese |
| --- | --- | --- |
| Desktop, Useful | [EN](pr-crops/d06-reader-feedback/feedback-desktop-en-useful.png) | [ZH](pr-crops/d06-reader-feedback/feedback-desktop-zh-useful.png) |
| Desktop, Unclear | [EN](pr-crops/d06-reader-feedback/feedback-desktop-en-unclear.png) | [ZH](pr-crops/d06-reader-feedback/feedback-desktop-zh-unclear.png) |
| Tablet, Useful | [EN](pr-crops/d06-reader-feedback/feedback-tablet-en-useful.png) | [ZH](pr-crops/d06-reader-feedback/feedback-tablet-zh-useful.png) |
| Tablet, Unclear | [EN](pr-crops/d06-reader-feedback/feedback-tablet-en-unclear.png) | [ZH](pr-crops/d06-reader-feedback/feedback-tablet-zh-unclear.png) |
| Phone, Useful | [EN](pr-crops/d06-reader-feedback/feedback-mobile-en-useful.png) | [ZH](pr-crops/d06-reader-feedback/feedback-mobile-zh-useful.png) |
| Phone, Unclear | [EN](pr-crops/d06-reader-feedback/feedback-mobile-en-unclear.png) | [ZH](pr-crops/d06-reader-feedback/feedback-mobile-zh-unclear.png) |

## Custody and acceptance limits

The original managed workspace, operation `d06-terminal-reader-resilience-20261103-c4`, branch `sol/web-d06-terminal-reader-resilience-20261103-c4`, and published parent `0cf50dc0c7db259b284b48632df3f05fcb0fb7b7` were recovered without a competing active workspace process or uncertain mutation. The uncommitted predecessor feedback work was completed in place. Protected procedure was pinned at `75a6540519cf519edfef7633e74f57b68aef9329`, compatible with bootstrap major 1.

The twelve captures establish local dark-route behavior. They are not physical-device, assistive-technology, light-theme, hosted-beta or production acceptance. The full 75-case D06 migration matrix is not reclassified as passed. This adds partial keyboard/success-state evidence only.

Both PRs remain Draft. Ready/un-draft, enqueue, merge, held relabel and deployment remain held. Final shared-shell composition still requires the released joint F01/F02 contract. Exact C4 Paper write acceptance has not been established; the original D06 desktop board was read and visually inspected without a canvas mutation. Rejected full-pane Refraction remains excluded. Required current-head CI and actual non-author approvals where binding remain separate from this self-QA.
