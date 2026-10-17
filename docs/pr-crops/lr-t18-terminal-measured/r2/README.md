# LR-T18-TERM-EV2 — r2 recapture, tall viewport for 1440 desktop crops (LOCAL browser evidence)

LOCAL intercepted evidence only (route-intercepted owner payloads against a local `next dev`).
NOT a production proof; `productionProof: false` in `qualification.json`.
Class: `actual-runtime (LOCAL, intercepted owner payloads)`.

This r2 supersedes r1. The harness now accepts `--capture tall` (LR-T18-TERM-EV2):
for every 1440 cell, before screenshotting, the harness finds every `overflow-y:auto|scroll`
element whose `scrollHeight > clientHeight + 2`, grows the viewport to the max bottom of
those (capped at 4200, +24 padding), waits 500 ms, re-runs the overflow scan, and screenshots
with `fullPage:false`. The default capture (no flag) preserves r1 behaviour. The 390 cells
stay on r1's capture because the page itself scrolls at that width.

Bug fixed in r2: r1's 1440 PNGs only showed the top ~760 px of the Rotation view because the
TerminalShell's workspace root (`<main data-testid="sector-intelligence">`, `flex:1; overflow:auto`)
sits inside a fixed-height shell. `fullPage:true` grew the page canvas without painting the
container's overflow; the bottom half of every 1440 PNG was the root background (near-black
even in light theme). The A42 desktop crops therefore never showed the history pane.

## Inputs (frozen, sha256-verified by the harness before any cell ran)
- `sector_base.json` ← macro `1c8ff99ff7c06dda6482b8ba3a81b4e615a63c52:site/sectordata/sector_central.json` (145069 B, `2f89eee8…`)
- `history.json` ← same ref `site/sectordata/sector_cycles.json` (2119318 B, `462201aa…`)
- `events.json` ← same ref `site/marketdata/rotation_events.json` (117246 B, `9eb9993b…`)
- `measured_read_v1.json` ← worktree fixture `terminal/lib/__tests__/fixtures/measured_read_v1.json` (9430 B, `3c941630…`)

History-unpublished state, as observed: the owner `sector_cycles.json` payload carries NO
`meta.rs_history` (the reconstructed trail is unpublished at this ref), so the rotation view
renders the honest "Historical trail unavailable" state next to a fully plotted current map.
No trail was fabricated anywhere in this run.

## Tall capture results (per cell, 1440 only)

The overflow scan found exactly one overflowing container per 1440 cell — the workspace root
`<main data-testid="sector-intelligence">` with `scrollHeight ≈ 1500–1527 px` inside a
`clientHeight = 764 px` flex-1 shell. Viewport expansion removed the overflow and placed
`bottom(sector-rotation)` ≤ `window.innerHeight` on every 1440 cell. The A42 history pane
(`<section data-testid="rotation-history">`) prints at `{top: 1191.21875, bottom: 1294.265625,
left: 88, right: 1412}` — inside the viewport on every A42 cell (4/4).

| Cell                                         | Viewport (px) | Overflow after resize | History pane rect                       |
|----------------------------------------------|---------------|------------------------|--------------------------------------|
| A/chromium-1440-en-dark-aligned             | 1440×1659     | none                   | n/a                                  |
| A/chromium-1440-en-light-aligned            | 1440×1659     | none                   | n/a                                  |
| A/chromium-1440-zh-dark-aligned             | 1440×1632     | none                   | n/a                                  |
| A/chromium-1440-zh-light-aligned            | 1440×1632     | none                   | n/a                                  |
| B/state-stale/outage/invalid/absent-en-dark  | 1440×1659     | none                   | n/a                                  |
| B/state-stale/outage/invalid/absent-en-light | 1440×1659     | none                   | n/a                                  |
| B/state-stale/outage-1440-zh-dark           | 1440×1632     | none                   | n/a                                  |
| B/state-aligned-1440-en-{dark,light}         | 1440×1659     | none                   | n/a                                  |
| C/a42-history-error-1440-en-{dark,light}    | 1440×1659     | none                   | `{top:1191, bottom:1294, left:88, right:1412}` |
| C/a42-history-unavailable-1440-en-{dark,light} | 1440×1659  | none                   | `{top:1191, bottom:1294, left:88, right:1412}` |
| D/access-1440-en-dark                       | 1440×1659     | none                   | n/a                                  |

390 cells (4 chromium fullPage) keep r1 capture.

## Pixel sanity (light-theme 1440 chromium fullPage)

The harness computes, per PNG, the fraction of bottom-25% rows whose pixels are ≥98% one
colour (read via `Image`+`canvas` in a blank page — no `pngjs` dependency added; `pngjs` was
not present in node_modules). For the regression this lane exists to fix (chromium 1440
desktop fullPage light theme), the fraction must be `< 0.5`:

| File                                | Width | Height | Bottom-25% uniform-row fraction |
|-------------------------------------|-------|--------|---------------------------------|
| chromium-1440-en-light-aligned.png  | 1440  | 1659   | **0.0675** (PASS, < 0.5)        |
| chromium-1440-zh-light-aligned.png   | 1440  | 1632   | **0.0686** (PASS, < 0.5)        |

Dark-theme 1440 fractions are 0.3108 / 0.3162 — well below 0.5 — because the dark root
background shares the dark `var(--bg)`, but those weren't the regression. The r1 PNG
`chromium-1440-en-light-aligned.png` was 134856 B; r2 is 181157 B (+34%) — the extra bytes
are the history pane and the rest of the rotation root now visible below the fold.

Element screenshots (`rotation.screenshot()`) carry a high bottom-25% uniform-row fraction
(0.73–0.90) because the rotation element extends below its last content section (its native
padding). Those are not the regression — the regression was the fullPage shots where the
bottom half was the parent workspace bg, not the rotation element's own padding.

## GAPS
- webkit cells (F) skipped: no cached webkit build matching playwright-core revision 2311 in
  `~/.cache/ms-playwright`; chromium 1228 cells all ran.
- Distinctness is asserted on full line text; the printed table's first-80-char heads are
  identical for aligned vs stale because the stale clause begins after 80 chars.

## Findings (reported, not failures)
- Touch 390 — 0/11 rotation points are < 44 px in both dimensions.
- Keyboard — 30 Tab presses from page load reached rotation point XLP (BUTTON); Enter selected
  it (URL `sector=xle`→`xlp`); Space re-selected the same point.