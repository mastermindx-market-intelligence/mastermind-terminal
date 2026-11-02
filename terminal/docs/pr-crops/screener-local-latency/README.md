# Screener local scan latency — 2026-10-15

A CSS Modules pure-selector error prevented the existing Webpack comparison from compiling. The five-line global masthead rule now lives beside its existing base rule in `app/observatory.css`; selector specificity and declarations are unchanged. The original CSS compiler failed, the candidate compiles, and four affected desktop/tablet/mobile cohort checks passed (two desktop-only cases skipped at narrow widths). Keyboard, focus and popover stacking remain covered.

This enabled a clean **local scan-data baseline**, not production or whole-page readiness. Next 16.2.9 Webpack development server; Chromium 149.0.7827.55; 1440×900 and 390×844; serial isolated contexts; EN routed fixed 9,500-symbol manifest; blocked service workers. Routing disables HTTP cache. The server document route was prewarmed, but browser compilation, navigation, assertions and two animation frames remain in the timings. Account-screen reads can still be pending at the scan endpoint.

Each device has ten empty-client samples and ten same-context, new-document native IndexedDB reopens. Times are milliseconds:

| Device | State | n | Median scan visible | Median data endpoint | Observed endpoint range |
|---|---|---:|---:|---:|---:|
| desktop | empty-client-storage | 10 | 1070.9 | 1094.1 | 1037.8–1682.1 |
| desktop | native-idb-new-document | 10 | 1030.0 | 1055.6 | 1042.6–2308.4 |
| mobile | empty-client-storage | 10 | 1050.6 | 1061.0 | 1034.4–1098.9 |
| mobile | native-idb-new-document | 10 | 1013.8 | 1033.0 | 937.8–1058.7 |

The data endpoint requires visible 9,500-result status, expected source date, first row, completed manifest/flow requests and two animation frames. All 44 navigations (40 samples plus four controls) had zero failed JS requests and page exceptions at that endpoint. Twenty reopens retained the exact IndexedDB record and made no manifest request. Owner writes were zero; expected analytics POSTs are separate. A 750ms response-delay control was detected on each device; an explicit 503 control showed Retry and zero rows.

These are ten-sample pilot distributions: the maximum is not a reliable tail estimate or SLO. There is no cold-server, OS-cache, physical-memory, real-network, principal or production claim. Original Turbopack 404 measurements remain unaccepted; this does not prove that preload issue fixed. No bundler default or dependency changed. The fixture-only null-DOM init issue is corrected in this external measurement harness, without a product change.

`results.json` binds the CSS sources, exact fixture, compact statistics and four reviewed images. The full event logs and reproducible runner remain in the original external evidence directory `fable-commission-20261013/screener-client-latency/css-module-compatibility-20261015`. Previous functional, resource and 403-image evidence is reused.
