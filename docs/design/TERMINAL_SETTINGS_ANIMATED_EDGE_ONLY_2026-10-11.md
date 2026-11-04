# Terminal Settings — R3 Refraction / Top edge only

## Current commission

The Chairman rejected the full-pane redesign and then the weak grey-wave treatment. The commission remains the **animated top strip only**. Preserve the original settings pane, thirteen navigation rows and icons/order, copy, controls, dimensions, mobile pill navigation, ownership and persistence. Do not generate an image in place of Paper design work.

## Design resolution

The earlier treatments failed because they treated the accent as a line floating above the product. R3 treats it as an optical edge of the existing panel: a precise 1.25px prismatic bevel, ice-blue to lilac, with inward light that dissolves before the title and identity. The 22px original corner geometry remains fixed. The light drifts slowly over 16 seconds rather than changing the shape or flashing. This is a new material treatment, not another lower-opacity waveform.

Paper: [Terminal · R3 Refraction · Top-edge only](https://app.paper.design/file/01M2WGNCX9475G79JRKJTCM08P/p-1G-0). Desktop `6271-0`, mobile `627F-0`, detail/specification `627M-0`. The original native UI is a screenshot reference; the changed material is editable Paper vector/gradient content. All three boards were screenshot-reviewed, exact edge JSX inspected, and working indicators released. R2 boards `61WU-0`, `622X-0`, `625U-0` were renamed REJECTED; R1 remains rejected.

## Native implementation

Only production source `terminal/app/settings.css` changes. It hides the old `.acs-aurora` SVG without touching its component/DOM, adds two pointer-transparent pseudo-elements to the existing `.acs-card-surface`, and masks the rim to the original corner shape. The top-32px geometry and inward-26px reflection fade before text. Desktop corners fade vertically; mobile uses the original square top edge. Both 16-second CSS animations pause when the modal closes; reduced motion holds the same static material. Forced colors omit decorative effects. Engines without composite masks receive a bounded flat-edge fallback rather than an opaque banner. No JavaScript timer, new state, dependencies, framework or second pane.

## Proof and scope boundary

Five browser contracts at each of desktop/tablet/mobile: original structure, fixed geometry, genuine background-position drift with constant size/opacity, reduced motion, and original close-button operation/animation pause. The actual native consumer is captured in EN desktop/tablet/mobile and ZH mobile. All pixels below the top 40px are byte-identical with the decoration enabled versus disabled in each context. Exact evidence, hashes and a real-time MP4 are in `terminal/docs/pr-crops/terminal-settings-aurora/`.

The prior 59b824fe44181ff9cb8182d5143c5bc0d5935842 source head is the recovery preimage, not current aesthetic acceptance. Historical test totals are not recycled for R3. Source-bound evidence is refreshed using the same five incumbent capture tools before final unit verification.

## Publication and release

One existing branch and PR #943; Draft + hold, auto-merge off. Preserve the existing protected procedure pin d844b51586ffd061a97b9789028201852379c6a6 and exact source/effect state. The user requested Pro; no runtime switch is claimed. Paper and local implementation do not prove hosted CI, merge, deployment or live acceptance. Do not reroute the previously refused production preflight. No new workers or Codex credits were used.
