# PR #615 visual verification

Source state captured from the current PR integration head after the strict-base refresh. These images are verification artifacts only; they are not runtime assets.

## Product states

- desktop-intelligence-dark-en.png — 1440x900 Analysis / Intelligence with the full app chrome, non-floating lens rail, and padded Structured Event Context card.
- desktop-intelligence-dark-zh.png — the same real route in Chinese mode, proving language isolation on the corrected workspace.
- mobile-intelligence-dark-en.png — 390x844 responsive Analysis / Intelligence route.
- desktop-earnings-tooltip-dark-en.png — earnings chart with the extreme +3162.41% surprise tooltip visible and contained.
- mobile-earnings-tooltip-dark-zh.png — the same overflow discriminator at phone width in Chinese mode.

## Theme note

The Terminal root is currently a dark-only product surface: app/layout.tsx emits data-theme="dark", and the Terminal CSS has no supported html[data-theme="light"] palette. A forced-light screenshot would exercise an unsupported DOM mutation rather than a user-reachable product state, so this proof records the supported dark EN/ZH states instead of fabricating a light mode.

The responsive contract is separately exercised by Playwright at 1440x900, 820x1180, and 390x844.

## Integrity

SHA256SUMS binds the exact PNG bytes committed with this evidence.
