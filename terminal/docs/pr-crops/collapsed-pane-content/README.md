# Collapsed indicator pane content — browser evidence

This packet proves the chart-collapse repair requested for indicator sub-panes across the responsive Terminal.

## Outcome

A collapsed indicator pane remains mounted as a thin restore strip, but its compressed native
indicator plot and user drawings are visually hidden. Restoring the pane removes the veil and returns
the same drawing; collapse does not mutate indicator-eye state or drawing persistence.

The implementation reuses the existing `ChartOverlays` pane geometry and canonical `collapsed`
state. It does not create a second drawing renderer, indicator visibility owner, pane store, or chart engine.

The responsive follow-up also preserves recovery on coarse input: tablet/mobile use the existing
legend More → Collapse path, and a phone exposes exactly one pane-op while collapsed — Restore.
## Captures

- `desktop-expanded-en.png` — expanded indicator pane with a real user trendline.
- `desktop-collapsed-en.png` — the same pane collapsed to 12 px; plot/drawing paint is covered while the drawing remains persisted.
- `desktop-restored-en.png` — Restore removes the veil and the same drawing is visible again.
- `tablet-collapsed-en.png` — 820×1180 coarse-input collapse; mask paints above LWC canvases and Restore remains visible.
- `mobile-collapsed-en.png` — 390×844 collapse; the retired ordinary phone pane-op strip stays retired except for the required Restore action.
- `mobile-restored-en.png` — phone Restore returns the pane.
- `desktop-collapsed-zh.png` — localized Chinese collapsed state.
- `mobile-collapsed-zh.png` — localized Chinese phone collapsed state.

Terminal is dark-only, so no fabricated light-theme evidence is included.
## Receipts

`manifest.json` is `mastermind.collapsed_pane_evidence/v2`. It locks every PNG by SHA-256,
records exact viewport/language/state geometry, and records SHA-256 for the three implementation/proof
files consumed by this repair.

The deterministic browser capture at semantic source head
`060445a253c57836178b0d8ea9a4e198e2fc7236` produced eight captures with zero console errors,
zero page errors, and zero HTTP errors for desktop/tablet/mobile EN plus desktop/mobile ZH.

Focused responsive regression proof on the same integrated source:
- desktop collapse/drawing/restore — PASS;
- tablet coarse collapse/restore — PASS;
- mobile coarse collapse/restore — PASS;
- typecheck — PASS;
- ChartOverlays + ChartObjectTree focused unit tests — 10/10 PASS.

The desktop regression proves drawings remain persisted through collapse. The coarse regression proves
the mask paints above pane canvases, the collapse route remains tappable, and Restore remains reachable
on tablet and phone.
## Integration note

After protected-master movement, the carrier was reconciled with the incumbent PR branch rather than
re-homed. Concurrent #711 drawing-coordinate and #713 chart-layer work were preserved. Current master
movement after #711 changes one unrelated workspace touch-floor line in `globals.css`; the collapse
selectors and captured implementation blobs are unaffected.

Production proof is intentionally separate from this packet. These captures are local deterministic
browser evidence, not production market-data evidence; the final release still requires the merged
protected-master SHA to be deployed through the canonical VPS owner and then proved on
`https://app.mastermind-x.com`.
