# Research Lab appearance

The existing account Appearance preference now reaches the actual document root while the Lab is mounted. The account preference owner, Settings controls and persistence remain shared. The Lab applies Light, Dark or the Dashboard's Auto hours (07:00 inclusive to 19:00 exclusive, local time), then restores the host route's prior appearance on exit. Account-owner mismatch uses dark instead of another account's preference. This is a scoped Lab capability; other Terminal views remain dark.

## Dark treatment

The existing command-center treatment retains luminance depth, calm instrument panels and restrained ambient glow. Source values, selected coordinates and sign/side encodings retain their meaning. Selected rows and point rings provide an additional shape/position cue. No new market semantics are assigned to color.

## Light treatment

Reference: original Terminal Paper file `01M3NSZGE8JWN2EZCSF0DT05RM`, page `p-H-0`, light Sources board `199N-0`, read without edits. The canvas is cool near-white `#f7f8fa`, material is white, primary ink is `#1c2430`, secondary ink is `#5d6b7e`, and the research accent is `#285fff`. These values extend the existing canonical CSS tokens only while the Lab owns the light root.

Material mechanisms intentionally differ: ambient glow and Settings aurora disappear; the shell and Settings use opaque white material, hairlines and shallow shadows. The summary uses a left accent rule, the toolbar a pale work surface, selected rows a pale fill plus a left rule, and unavailable panels a top hairline. The caution panel uses a light tint with dark ochre ink. Shared popup blur is removed. This creates a research workspace without changing hierarchy, density, source semantics, controls, ordering or responsive breakpoints.

The real WebGL shader now converts linear theme colors to the renderer's output color space. GridHelper's default gray vertex colors no longer multiply the grid token. The canvas geometry, selection, camera framing and source scales remain the existing implementation. A separate flex-width repair keeps the Lab full-width when language or lens content changes.

## Degraded states and proof

Missing replay inputs remain an explicit unavailable panel in both themes, with the selection and exact table retained. Save remains disabled with its existing admission explanation. Permission withdrawal removes cached values in either appearance. The local fixture's account sync is unavailable and Settings reports it; this proof does not claim persisted account-preference recovery.

`evidence/appearance-qualification.json` binds source hashes, ten inspected native Chrome screenshots and logs. The required dark/light × EN/ZH × desktop/mobile matrix covers CSS1440×1100 and390×844, at the user's existing150% Chrome zoom. These are desktop viewport overrides, not physical phones or pinch gestures. Additional dark-English and light-Chinese desktop images cover unavailable Replay. The 13/76/267 selection values survive theme/language/lens changes with no horizontal document overflow. Actual Auto at local16:00 renders light; 07:00/19:00 boundaries, account mismatch, permission withdrawal, exact root restoration and StrictMode cleanup are component-test evidence.

Parent visual inspection qualifies the implemented matrix. Independent design/source review, authenticated account persistence, all-control/device coverage and production acceptance remain open. Earlier graphics/resource measurements keep their original source identity. This document is not full-project acceptance.

## Legend composition follow-up

The call/put, metric, sign and area-law legend now precedes the canvas. The text,
colors and marker meaning are unchanged. This makes the encoding readable before
the landscape at desktop entry, while retaining the same reading order when the
layout stacks on narrow screens. The inspector continues to use the Lab's single
scroll container; Compare, Dismiss and the disabled Save explanation remain
reachable below the fold.

`evidence/legend-composition-qualification.json` records 16 local Chromium layout
and control cases: dark/light × EN/ZH × CSS1440×1100,1440×900,820×1180,390×844.
The smaller viewports were reached by resizing after setting the existing shared
appearance control. These headless fixture captures are separate from the prior
native Chrome150% appearance matrix; they do not replace its source identity or
establish physical-mobile, account-sync, performance or production acceptance.
