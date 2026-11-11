# Chart keyboard ownership and Go to date — verification

## Result
Keyboard pan, zoom, and Alt settings act on the active chart only. Focused controls, composition, handled keys, and actual modal dialogs retain their input. The existing symbol-search and command-palette owners now honor the same handled/native-modal boundary; a wide modeless Intelligence Workspace still permits background chart interaction.

Go to date now focuses immediately after mounting, closes consistently with Escape, outside pointer and focus departure, and returns focus to the calendar on explicit dismissal or Go. Trigger clicks do not reopen the popup after blur. The native date control follows light/dark color scheme; coarse-pointer controls provide 44px touch targets. The existing phone availability and date-range calculation are preserved.

## Proven source and authority
- Protected source base: `1c0bf028cf72539a4d3fcb17fa137ee474d764f9`.
- Product/test head: `a35beb58edeb502b7dab346e3447a4b766ca1bf6`.
- Procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`; design doctrine: `536ab7d78c2fbcab8a7c8a3cdc8d09fbe2bff136`.
- Source materialization independently checked 3,380 files against canonical Git blob hashes with zero mismatches. No Git metadata or source push credentials in the validation copy.
- Existing Paper D06 R2 reference informed the compact presentation. This is an interaction slice, not a claim of complete Paper parity.
- Existing active PR paths and relevant overlapping TerminalShell/ChartPane/ChartFrameBar hunks were inspected. No edits to held pane sync, boot, group drag, chart AI or engine migration work.

## Verification
- Focused mounted/pure tests: **51 passed** (30 command catalog, 5 existing quick settings, 10 shortcut ownership, 6 Go-to-date disclosure).
- Discriminating unchanged-source checks: shortcut suite had **9 failures / 1 pass**; date disclosure suite had **6 failures**. These establish the old behavior did not satisfy the new assertions.
- Full TypeScript: `node --max-old-space-size=6144 node_modules/typescript/bin/tsc --noEmit --incremental false` exited 0. Latest run included these runtime sources and the independent preference slice. The final subsequent adjustment was CSS color-scheme plus two straightforward browser assertions, followed by six passing real-browser cases.
- Changed/new test and catalog lint: no findings. Existing FrameBar (6 errors), ChartPane (4 errors), and TerminalShell (53 errors, 18 warnings) retain identical baseline totals; no claim of repository-wide lint cleanliness.
- Real /terminal browser: **6 passed, zero retries**, EN/ZH desktop keyboard + Go-to-date and EN/ZH tablet Go-to-date.
- Browser proof uses the incumbent owned synthetic fixture. No live user account writes or production deployment proof.
- Multi-pane proof observes real chart ranges and pane settings, active-pane changes, actual account/chart settings dialogs, native modal versus modeless behavior, composition/handled events, and actual symbol search.
- Date proof exercises actual palette handoff, immediate focus, empty action state, Escape from Go, trigger close, outside focus, viewport fit, coarse targets, both theme schemes and applied date focus return.

## Visual review
The desktop multi-pane capture, desktop date popup and Chinese tablet date popup were inspected. Input focus is visible, the native calendar glyph is readable on the dark field, and the tablet date field/action remain inside the viewport with larger targets. Captures and final logs accompany this record.

## Delivery and continuation
Ready PR with deliberate merge-on-green opt-in; original native auto-merge enrollment follows exact-head preflight. Required checks, queue admission, CODEOWNERS and release controls remain binding. This evidence records local/browser qualification, not merge, release or production acceptance. Next independent work is preference-section continuity and watchlist display controls; previously accepted comparison and screener slices are not repeated.
