# Preference section continuity — verification

## User-visible result
Selecting a trade type immediately enters the existing account PreferencePump. Switching settings sections no longer cancels a component-owned 500ms debounce and silently loses the change. The same pump owns serialization, coalescing, retry and acknowledgement after the section unmounts. Saving feedback reflects that real pump; a successful acknowledgement is required for Saved.

The rendered account owner/generation is checked before any accepted account intent, including identity/store mismatch before the load effect. Guest selections retain their existing local-only behavior.

## Source and authority
- Protected source base: `1c0bf028cf72539a4d3fcb17fa137ee474d764f9`.
- Product/test head: `05f2d53eb34358840e4a5284cd5f3aec294229ed`.
- Procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Three changed files: SectionPreferences, its mounted continuity suite, and one real /terminal browser spec. SettingsProvider, account identity, account write fence and PreferencePump remain the incumbent owners.
- Isolated browser materialization verified **3,377** canonical source/config/test files by Git blob hash, **zero mismatches**. Other candidate chart, comparison and screener runtime changes were absent from this browser copy.
- Active PR paths inspected; this avoids held SettingsPanelBoundary/SettingsProvider work.

## Verification
- **61 affected tests passed**: 8 new mounted continuity cases, 32 existing owner/pump cases, 21 existing account write-scope cases.
- **5 new cases failed / 3 passed on unchanged source**. The new tests mount the real section, real store and real pump; only Supabase transport and unrelated optional presentation context are mocked.
- Cases cover immediate queue ownership; unmount before the old debounce; truthful pending/saved states; one in-flight request with latest complete array coalescing; stale different-owner and same-owner generation callbacks; identity/store mismatch; guest behavior; failed write and real Retry.
- Full TypeScript with these runtime and browser sources exited 0. The final subsequent change only adds settled-transition screenshot qualification; final browser run below passes it.
- New test/browser files lint clean. Removing the component timer reduces SectionPreferences baseline refs-during-render findings from 5 to 2; the two unrelated existing findings remain.
- **6 real /terminal browser journeys passed, zero retries**: English/Chinese at desktop, tablet and phone.
- Browser account reads/writes are bound to the exact loopback fixture endpoint and a synthetic principal matching the incumbent server fixture. Only trade_types writes are accepted. The first acknowledgement is deliberately held; requested=1/acknowledged=0 is proved before leaving the section. Return to Preferences retains Crypto; after acknowledgement, full document reload retains all three choices with no duplicate write.
- Server-side loopback-auth availability warnings are retained in the fixture log. They do not represent production backend qualification. No live account or external account mutation is performed.

## Visual proof
Desktop English and phone Chinese captures were inspected after the section's existing entry animation settled. The selected trade types remain visible on return while the request is held. A first capture pass caught the entry animation; the final spec now waits for computed opacity 1 and disables animations only during screenshot capture. All six final journeys were rerun against the published test source.

## Delivery and continuation
Ready PR and deliberate merge-on-green enrollment use the existing native path. CI, required reviews, queue and release controls remain binding. Source/browser qualification is not a claim of merge, release or production acceptance. The independent next slice improves watchlist display controls and the ignored Last-column setting.
