# Collapsed indicator pane content — browser evidence

This packet proves the chart-collapse repair requested for indicator sub-panes.

## Outcome

A collapsed indicator pane remains mounted as a thin restore strip, but its compressed native
indicator plot and user drawings are visually hidden. Restoring the pane removes the veil and
returns the same drawing; collapse does not mutate indicator-eye state or drawing persistence.

The implementation uses the existing `ChartOverlays` pane geometry and `collapsed` state. It
does not create a second drawing renderer, indicator visibility owner, pane store, or chart engine.

## Captures

- `desktop-expanded-en.png` — expanded indicator pane with a real user trendline.
- `desktop-collapsed-en.png` — the same pane collapsed; the 12 px strip remains, while its plot
  and drawing are covered. The drawing still exists in the document.
- `desktop-restored-en.png` — restore removes the veil and the same drawing is visible again.
- `desktop-collapsed-zh.png` — collapsed Chinese session with the localized restore affordance.

Terminal is dark-only, so there is no fabricated light-theme evidence. The capture viewport is
1440×900, matching the desktop responsive contract.

## Receipts

The browser capture recorded zero console errors, page errors, or HTTP errors in both EN and ZH.
`manifest.json` locks every PNG by SHA-256 and records the measured expanded/collapsed geometry.

The pixels were captured at semantic source head
`7e574284cb851058d0cd6627442d97de2a14776d`, then the branch was rebased onto current
protected Terminal master. At packaging head
`95a5bbbf8f806f929b15eed79e65c2c1b506b0f8`, the two source files are byte-identical to the
captured versions; `manifest.json` records their SHA-256 values so that equivalence is auditable.

The behavioral regression is
`e2e/drawing-system.spec.ts: collapsing an indicator pane hides its plot and drawings until restore`.
It asserts the pane remains collapsed, the opaque mask is the topmost visual at pane center, the
drawing remains persisted, and Restore removes the mask without deleting the drawing.
