# Compare keyboard action states

On the previous head `61dd0c9bf`, native Tab could focus the opacity-zero Price button and Space could add a price comparison before the chooser was visible. Chromium desktop and pinned Firefox 151 at real 200% text enlargement each reproduced the defect.

Inactive action branches now use `inert` and `aria-hidden`. An explicit add, mode selection, removal, or chip removal hands focus to the visible replacement after its state renders. Pending focus respects a user move to another control. The Price/Percent focus ring is inset inside the segmented control's clipping boundary. The existing intrinsic layout and comparison semantics remain intact.

Validation: six English/Chinese cases at 1440x900, 820x1180 and 390x844, plus English Firefox 151 at 390x844 with native `textZoom=2`, `fullZoom=1` and doubled computed text size, all passed with one worker and no retries. They exercise native Tab/Shift-Tab/Enter/Space, active button counts, Price and Percent storage, chip removal, visible focus and zero owner/authentication writes or model commands. A native control restoring the old focus-ring offset detects clipping. TypeScript passes; the new permanent Playwright test has zero lint findings. SearchModal retains six pre-existing errors and two warnings with none added.

The permanent regression is `e2e/search-compare-keyboard.spec.ts`. Nine selected screenshots below were visually reviewed; the external run retains all 21 final screenshots and JSON assertions. Original failing runs and intermediate harness/candidate failures remain retained. The original Fabric proposal was consumed but not accepted or applied; the corrected parent implementation is what these results validate.

These are local fixture/browser results. The unchanged retained-layout and investigation objects are checked byte-for-byte; the chart-state mirror is an isolated mock transport. This is not native Chinese text-enlargement, complete modal focus containment, full-page accessibility, hosted CI, deployment or live-account acceptance. Existing release holds remain.

- [en-desktop-price-choice.png](en-desktop-price-choice.png)
- [en-tablet-percent-added.png](en-tablet-percent-added.png)
- [en-mobile-removed-idle.png](en-mobile-removed-idle.png)
- [zh-desktop-price-choice.png](zh-desktop-price-choice.png)
- [zh-tablet-percent-added.png](zh-tablet-percent-added.png)
- [zh-mobile-removed-idle.png](zh-mobile-removed-idle.png)
- [en-native200-mobile-price-choice.png](en-native200-mobile-price-choice.png)
- [en-native200-mobile-percent-added.png](en-native200-mobile-percent-added.png)
- [en-native200-mobile-removed-idle.png](en-native200-mobile-removed-idle.png)

## Escape from action controls

An additional actual-browser check on published `2fd1cc55f` failed: Escape from the focused Price button left the modal open. Compare now handles Escape at the modal boundary, including the chooser, added and idle controls, without affecting other search modes. Six English/Chinese desktop/tablet/mobile cases and one real Firefox 151 English mobile text-200 case pass. Each opens and dismisses all three states and checks that closing preserves the exact comparison configuration and unchanged owner objects, with no owner/authentication writes or model commands. The extended permanent regression passed its composed English desktop flow once; prior keyboard and pixel proof is reused. TypeScript passes; the new test has no lint findings; the component's six errors/two warnings are inherited.

The external `escape-return` directory retains the original one failure, all passing outputs, seven dismissal screenshots (three representative views inspected), and the exact assertions. This remains scoped local fixture proof, not whole-page/native-Chinese or live acceptance.

## Compare dialog focus boundary

On `4d8312316`, an actual browser case failed all three focus checks: forward and backward Tab left the open Compare overlay, and Escape left focus on the document body. Compare now exposes a named modal dialog, cycles Tab across its current visible, enabled controls, and restores the entry control on dismissal. Tablet More hands off its persistent trigger before closing its menu, matching the existing mobile hub handoff. Other search modes keep their existing behavior.

Six English/Chinese desktop/tablet/mobile boundary cases and three English native Firefox 151 text-only 200% cases pass. Each verifies unchanged comparison state and complete saved owner objects with zero owner/authentication writes or model commands. Native runs attest textZoom=2, fullZoom=1 and doubled font size. Six representative screenshots are in `modal-boundary/`. These are scoped local fixtures, not native Chinese, whole-page accessibility or live acceptance.

The initial local dev startup returned 404 before tests began; its generated cache and canceled runner are retained externally. The unchanged red test ran against a fresh generated cache and exposed the focus failures above; the startup cause remains unproved.

The six existing composed Compare action flows also pass with the boundary and exact opener assertions added. TypeScript passes; the browser test has zero lint findings. Component lint remains inherited (SearchModal: 6 errors/2 warnings; TerminalShell: 53 errors/14 warnings), with no additions.
