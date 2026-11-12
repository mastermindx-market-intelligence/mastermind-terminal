# Tooltip lifecycle verification

## Exact source and ownership

- Product commit: `5c6db876bc5e0e709d9f69f9dbf421a237e7d235`.
- Base: `1377853d02fdb0295c0848d7127fdee4ca36714b`.
- Procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Runtime Tip blob: `c3c862bdd5691ab02b39caea05fae5041ba025a4`.
- Mounted regression blob: `6a14db063cc06dbe2cb5efb518cf669333a89eba`.
- Browser spec blob: `e002ff3ba00847726761a1e983eaf8fe31236851`.

GitHub-native source publication uses an owned branch and exact-head lease. The isolated, no-git validation tree was restored to base for other product slices; all files above and both restored Search components were checked against Git blob hashes before browser execution. No held branch or production session was mutated.

## Results

| Check | Result |
| --- | --- |
| Mounted lifecycle, DrawingSidebar, and placement/warm regressions | 38 passed |
| Changed-file lint | No new finding; the same 2 existing Tip ref/immutability errors reproduced on its exact base; tests clean |
| Full TypeScript | Exit 0 in the combined local integration snapshot containing these unchanged runtime/test blobs |
| Browser, no retries, one worker | 4 passed; 2 intentional skips for the desktop-only navigation rail in tablet/phone projects; 45.5 seconds |

The real desktop drawing control opens an associated tooltip, Escape removes it while retaining trigger focus and pressed state, a new focus interaction reopens it, and a same-breakpoint resize dismisses it without losing focus. Enter still activates the drawing control. Tablet/phone projects cross the existing touch-suppression boundary and return without resurrecting the tooltip. The desktop navigation rail independently proves Escape leaves its link focused and Enter still navigates to Dislocations.

Mounted cases additionally cover delayed-hover cancellation, open cancellation on relevant ancestor scrolling, unrelated-pane scrolling, visual viewport events, disabled changes, warm-open timing, child handlers, frame cleanup and StrictMode listener cleanup. Browser proof does not claim a live-market data validation: its Dislocations destination legitimately reports source unavailable in this fixture.

Screenshots were visually inspected for the existing dock, focus ring and tooltip placement. No tooltip styling or new global manager is introduced.

## Delivery boundary

This is consumer-path fixture proof, not a measured INP/frame-rate improvement or production acceptance. Final evidence-only commits leave the qualified runtime unchanged. Ready/auto-merge enrollment is recorded separately in PR #1378 after exact-head readback; protected checks and the existing merge queue remain authoritative. No self-approval, direct protected merge or hold override.
