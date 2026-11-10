# Seasonal year selection and Best months controls

## Reproduced problems and delivered behavior

The real chart-hosted seasonal view had an 18.5px year-picker trigger, 23px year actions, a popup extending from x164 to x438 on a 320px phone, and no focus return after Escape. On phones, the containing MegaPane capture handler closed the entire pane before the picker could handle Escape. Best months sorted from clickable table headings that were absent from the keyboard button order.

The year trigger, individual years, inline years and All/None actions now have 44px minimum targets and visible keyboard focus. The existing multiple-selection state remains owned by SeasonalsPage. The picker exposes a labelled group, pressed year buttons, disclosure state and its controlled popup ID. Escape closes the picker and returns focus to its trigger; an ordinary outside click preserves the clicked destination's focus. Tabbing out closes the disclosure without moving focus back into it. MegaPane defers only an Escape originating in an open seasonal picker; a subsequent Escape retains the original pane-close behavior.

The popup stays in its existing local owner. It is measured against the visual viewport, its real scroll clips and the mobile navigation bar. Fixed phone panes stop the clip walk before the unrelated chart slot behind them. Its width, height and both vertical bounds remain clamped after resize and parent scrolling; its own list scrolls to the last year. Resize/scroll listeners, animation frames and the observer are cleaned up on close/unmount.

Best months now uses native buttons for calendar, average return and win-rate ordering, reports the active direction through `aria-sort`, and shows its direction visually. Existing sorting calculations, year selection, chart data, uncertainty bars and sample counts are unchanged. Narrow tables keep their existing horizontal scroll owner.

## Source and design qualification

- Source-law pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`; compatible bootstrap-major-1 INDEX.
- Base: `1377853d02fdb0295c0848d7127fdee4ca36714b`. Protected master advanced through `f34b0deb0bb2a0b2f57ba82256b9e87886ad76e0` and `b387616013f38cce9e467cc7da7b87fd2672718c` through unrelated accepted UI changes; the two seasonal leaf blobs matched the qualified base.
- SeasonalsChart original blob: `d708e63be23eff5c00f4709c6d9f0f5c7e5b3344`. AdvancedSeasonality: `2ed690058d142c66f7c03f8b8f937bc1e679282c`.
- The bounded open-PR census and all capped-head comparisons found no edits to either seasonal leaf. The two-line MegaPane Escape deferral is separate from actual pending owners #1369/#814/#1032/#1041/#1043. Their navigation, private identity, snapshot, Returns and admission holds remain untouched.
- Paper file `01M6Y2GT8S3YP4TK052PPESZEC`, page `p-2-0`, [Shared Shell Integration Reference R1](https://app.paper.design/file/01M6Y2GT8S3YP4TK052PPESZEC/p-2-0): existing shared presentation, coherent controls and contained company research surface. No claim that an unaccepted candidate artboard became a new requirement.

## Verification

The committed `terminal/e2e/seasonal-controls.spec.ts` uses synthetic daily bars from 2010–2026 (and an 11-year variant), the actual mounted chart pane and `/analysis?symbol=NVDA&page=seasonals`, saved language/theme preferences and existing local fixture admission. Fixture returns are not market evidence.

- Genuine baseline: PID 12275 exited 1 with the reproduced keyboard/geometry failures. A prior overly broad SVG locator was corrected before accepting that baseline.
- Beta matrix: PID 98427 exited 0, **18/18** across desktop 1440×900, tablet 820×1180 and phone 320×568, English/dark and Chinese/light. Covers multiple selection, persistence, All/None empty recovery, inline legend scrolling, real row ordering, focus, 44px targets, horizontal containment, 568×320 rotation and parent scrolling with the trigger outside the clip.
- Additional final phone/Analysis consumer proof: PID 21622 exited 0, **2/2**, including actual hit-test reachability in the standalone Analysis picker and normal focus return.
- Final Tab-exit refinement: PID 57537 (beta) and PID 63789 (default) each exited 0, **6/6**. The real keyboard sequence leaves the final year for All, closes the disclosure and retains All focus; all prior year-picker/Analysis checks remain green.
- Existing seasonal math/identity tests: PID 11852 exited 0, **28/28** across seasonal, advancedSeasonalityIdentity and forwardSeasonalTooltip. Node v26.5.0's host Web Storage global initially prevented jsdom setup; the documented process-local `NODE_OPTIONS=--no-experimental-webstorage` restored jsdom's own storage. No test or product storage contract was changed.
- Focused ESLint passed. `next typegen && tsc --noEmit` passed (PID 33803); final post-refinement TypeScript and ESLint passed again (PID 74257). `git diff --check` passed.
- Default-shell matrix: PID 39778 exited 0, **18/18**, before the final Tab-exit refinement, with the shared-shell flag absent. It includes the same chart and standalone Analysis journeys; actual saved theme expectations follow the existing presentation owners.

Screenshots here preserve the original phone overflow, original table headings, final desktop/tablet/phone controls, final short-landscape last-year access, inline legend and sorted-table focus. The short-landscape screenshot deliberately keeps the picker open while its trigger has scrolled out of view, proving the remaining years still fit above navigation. Images were copied without modification from the actual browser runs and visually inspected.

A development-server startup returned 404 and hit the existing 120s readiness bound in one diagnostic run. The owned process completed, a fresh owned manual server returned 200, and the consumer proof then ran normally; no timeout, CI workflow or admission change was made. Native auto-merge and live release remain separate from these local proofs.

## Carrier continuity

Direct principal implementation reason: `LOWER_TOTAL_OVERHEAD` and `PRINCIPAL_JUDGMENT` for the bounded interaction/geometry repairs; native children supplied read-only ownership and adversarial reasoning. No labor child or duplicate writer was started.

Operation `beta-seasonal-year-picker-20261109-c4` remains on its originally acquired branch/workspace. The installed owner selected `/Volumes/Mastermind 2/agent-workspaces`; its status and typed publisher reconciled the adapter's primary-root qualification mismatch before edits. No storage policy, root, lock or host selector was changed. Studio Direct defaults to M2; do not select it again.

The sibling `beta-live-options-20261109` evidence folder carries the already accepted live proof for #1365 from this same authorized beta mission; this seasonal work did not deploy that release.
