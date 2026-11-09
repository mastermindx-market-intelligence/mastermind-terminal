# Terminal search continuity polish

Chairman requested continued polish and smooth, predictable Terminal interactions, with qualified work entering protected auto-merge while independent fixes continue.

- Procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Branch source base: `1377853d02fdb0295c0848d7127fdee4ca36714b`.
- SearchModal preimage: `bab717fb91f29b3c168a3ebbdfa1572eea9b3c8a`.
- SharedSearchWorkspace preimage: `b6b82944d669ba1b5c9ac3a7accbe938415d3101`.
- Source carrier: GitHub-native authoring with exact branch lease; isolated validation copies only.

## Owned changes

Keyboard search selection can travel beyond the visible list, and query changes can leave the list scrolled away from its first result. Reveal explicit keyboard/restoration/query selections within their own scroller, preserving input focus and outer scroll. Pointer hover does not request scrolling. Attach-time handling covers MobileSheet's delayed portal. If a refreshed universe removes the selected index, reconcile it to a valid option without resetting valid selections.

Keep deferred results visible while typing, but prevent stale snapshot commits from keyboard and row actions. Retain IME guards and independent HOME navigation. Keep pending empty-state claims hidden without collapsing their geometry. A nonempty no-match Add query must not fall through to adding the current chart symbol; preserve the intentional blank-query shortcut.

Shared Companies uses the same bounded reveal geometry as its existing Tools behavior. No ranking, identity, publication or data owner changes.

## Boundaries and qualification

Held #1312 SearchModal differs from protected master only by lacking the already accepted zero-row ArrowDown guard. Preserve that guard; no held source was copied. Held startup #654 and watchlist #639 do not own these source files. New source uses existing search/focus owners.

Existing IME, keyboard-recovery and Shared Search regressions passed during implementation. New mounted cases cover no-match Add, stale snapshots, local scrolling, hover, restored companies, pending empty claims and result shrink. Real-route browser proof and final source receipts must be attached before Ready. The controlled stale-snapshot unit harness does not claim scheduler/performance measurements.

## Continuation

Previous #1363/#1367/#1371 and loading #1373 have separate auto-merge requests. Next independent slice is tooltip Escape/scroll/resize lifecycle. Do not claim merge, deployment or live acceptance from qualification alone.
