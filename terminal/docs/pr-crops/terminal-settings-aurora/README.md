# Terminal R3 — Refraction

[Open Paper R3](https://app.paper.design/file/01M2WGNCX9475G79JRKJTCM08P/p-1G-0).
Desktop `6271-0`, mobile `627F-0`, material/motion detail `627M-0`.
The floating neon crown and the rejected R2 grey wave are both superseded.

## What changed

The top accent now behaves like light caught in the original panel's bevel: a crisp ice-blue/lilac rim follows the existing rounded corners, with a shallow inward reflection. Color drifts over 16 seconds; geometry and opacity stay still. No waving, bouncing or flashing. Desktop decoration is limited to the top 32px; the inner reflection ends within 26px. The original mobile sheet gets its square-edged equivalent. Reduced motion freezes the same material, and closing the panel pauses the CSS animation.

**The rest of the pane is untouched.** `SettingsPanel.tsx`, `SectionTerminal.tsx`, original labels/icons/order, all thirteen navigation rows, original controls, dimensions, stores, auth and account behavior have no new changes. No generated imagery was used. In Paper, the existing pane is an actual browser screenshot reference and the revised rim/reflection are editable vectors; it is not a claim that the entire settings UI was recreated as editable layers.

## Actual native evidence

`desktop-original-settings.png`, `tablet-original-settings.png`, `mobile-original-settings.png` and `mobile-zh-refraction.png` show the actual `/terminal?symbol=NVDA` consumer opening its real settings pane under the established local fixture identity. `header-refraction.png` isolates the material. **[Play the real-time animation](refraction-motion.mp4)**: a 16-second native browser recording, not a rendered concept or accelerated animation.

`r3-visual-proof.json` records image hashes, original navigation labels, dimensions and the pixel comparison. In desktop, tablet, mobile and Chinese mobile, every pixel below the top 40px was byte-identical with the decorative pseudo-elements on versus off. This is a same-page preservation proof, not a screenshot comparison across unrelated market-data frames. All data/account identity in these images is local fixture context, not production proof.

The focused browser suite exercises unchanged navigation and dimensions, rim geometry, actual animation sampling, reduced motion and original close-button access across all three canonical viewports. Existing source-bound settings evidence packs are recaptured by their incumbent tools; no hash-only visual acceptance.

## Review / release

Prior Paper R1 and R2 artboards are labeled REJECTED. This page is the current candidate, not presumed Chairman aesthetic acceptance. PR #943 remains Draft + hold with no auto-merge. No production deployment occurred.
