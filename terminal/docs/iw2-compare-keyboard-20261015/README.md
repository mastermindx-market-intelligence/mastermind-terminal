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
