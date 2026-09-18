# Snapshot renderer parity — visual verification

These artifacts exercise the real Terminal chart and the real `mm:snapshot` download compositor from the same settled browser state. Each viewport has a live screenshot and the PNG produced by **Download image**, so the exported chart can be compared directly with the surface it came from.

## What the pairs prove

- The exported chart body uses the live grey-blue chart surface rather than the page's near-black `--bg` chrome.
- Indicator titles inherit the live legend's computed neutral text color, type, spacing, shadow, scrim and hidden-state styling instead of the retired export-only blue title treatment.
- The branded metadata header is a coordinated extension of the chart surface with a quiet separator, not a detached pitch-black band.
- Candles, volume, pane geometry, indicator plots, price labels and time-axis labels remain present in the exported raster.
- Desktop (1440×900), tablet (820×1180) and mobile (390×844) each run in isolated EN and ZH browser contexts. Export dimensions are recorded in `receipt.json`.

## Files

For every `{viewport}-dark-{language}` stem:

- `*-live.png` is the actual Terminal viewport immediately before export.
- `*-export.png` is the PNG downloaded by the product compositor from that exact chart state.

## Theme note

Terminal is currently a dark-only product surface. A forced light palette would not represent a user-reachable state, so this evidence covers the supported dark theme in both EN and ZH rather than fabricating light-mode proof.

## Capture command

```bash
TERMINAL_E2E_FIXTURE=1 npm run dev -- --hostname 127.0.0.1 --port 42195
PROOF_BASE_URL=http://127.0.0.1:42195 node e2e/tools/capture-snapshot-renderer-parity.mjs
```

`SHA256SUMS` binds the committed artifacts. `receipt.json` records the source head, dimensions, locale and visible indicator title for every case.
