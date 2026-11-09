# Terminal tooltip interaction polish

Chairman requested smoother, more polished Terminal interactions, continuing independent fixes while qualified work passes through existing protected auto-merge.

- Procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Terminal source base: `1377853d02fdb0295c0848d7127fdee4ca36714b`.
- Tip preimage: `201f0401fba9af2b5190839bf84110d3c5d70860`.
- Existing lifecycle-test preimage: `10805d0535ba3bc05a16b5215f11ec485eb0ba3f`.
- Source carrier: GitHub-native authoring with exact branch lease. Isolated validation copies do not publish source.

## Observed problem and change

The shared fixed-position tooltip remained open on Escape and viewport movement. Its initial hover timer could also open a label after the anchor's scroller moved.

Represent the existing interaction as idle, pending, or open. Install dismissal listeners only while pending/open. Escape observes without consuming the key or moving focus; ancestor scrolling and window/visual-viewport movement retire the label. Unrelated pane scrolls do not dismiss it. Preserve placement, styling, child handlers, warm-open, and the existing DrawingSidebar touch suppression. Canceling a pending delay does not warm another tooltip.

## Qualification and boundaries

38 mounted/placement regressions passed during implementation, including pending and open cancellation, warm behavior, child handlers, nested scroll scope, visual viewport, enter-frame cleanup, disabled transitions and StrictMode listener cleanup. Tip's two existing ref/immutability lint findings are present in the exact base; no new lint finding is introduced. Browser Escape/resize/focus and touch-boundary proof, full typecheck and final evidence are required before Ready.

This changes the existing Tip primitive only; canvas chart tooltips have separate owners and are not altered. No new global tooltip manager, observer, timer loop or idle listener set is introduced.

## Continuation

Loading #1373 is independently armed; search #1376 is in qualification. Prior chart-settings #1363 has entered the native merge queue; indicator #1367 and screener #1371 remain separately enrolled. Preserve protected checks and held lanes; production acceptance remains distinct from fixture proof and queue state.
