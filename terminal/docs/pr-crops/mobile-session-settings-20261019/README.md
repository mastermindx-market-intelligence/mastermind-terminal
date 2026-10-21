# Phone chart session settings

A touch user can open More → Chart Settings → Symbol → Session in both the normal and fullscreen chart. The existing pane-owned dialog, settings persistence, Cancel/OK behavior, language strings and session eligibility are reused. Only the active pane with the exact requested symbol may open; stale or misaddressed requests do nothing.

The 24-hour US choice is available at 12h and eligible shorter intraday intervals. Daily charts omit that choice while preserving the saved overnight preference. This repair adds one existing-style tool tile and no new CSS, settings store, data route, credential or publisher.

The Terminal remains dark-only under its existing product contract. Screenshots here show the real responsive renderer with deterministic fixture feeds, not live BOATS data or production acceptance. EN/ZH captures cover daily and 12h settings, plus fullscreen 12h settings at390×844. The fullscreen capture waits for the entire dialog header to enter the viewport before retaining the image.

Source composition:16c360dd1552ac7670642d3d985b5dca4bb587e7 (protected master ea2a37b22 plus #1076 head35289d8e and phone repair4544dae86). The source regression failed before the repair; the browser could not find Chart Settings in the phone hub. Fifty settings unit tests and four phone journeys passed after wiring. The integrated candidate passes156 focused tests, TypeScript and16 browser cases at desktop/tablet/mobile; eight phone-only project instances are intentionally skipped. Required source-bound visual and hub evidence is retained separately in the existing evidence locations.
