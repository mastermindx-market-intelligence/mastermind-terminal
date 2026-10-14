# Screener cached refresh recovery

The Screener previously kept cached rows after a failed background refresh without showing that the refresh failed. A successful JSON response with an invalid manifest was also silently ignored. The consumer now retains its last usable scan and date, shows the existing translated refresh-failure message, and offers the existing explicit Retry action. Valid refreshed rows replace the cached scan while the selected filter stays unchanged.

The development StrictMode discarded setup could start the shared refresh before the surviving setup read the cached manifest. The surviving setup then waited for that in-flight request. Starting the read in a guarded microtask leaves ownership with the surviving setup. Cache policy, TTL, schema, fetch API, filter math, and account write paths are unchanged.

## Proof and limits

- Original native IndexedDB browser case: missing failed-refresh disclosure, 1 failure. Original mounted controls: 3 failures / 3 passes. Separate instrumented StrictMode browser case failed before refresh release; the same instrumentation passed after the lifetime correction. Its mounted negative control observed two reads before the fix, one after.
- Clean repair: 18 browser cases, English and Chinese at 1440x900, 820x1180 and 390x844, one worker and no retries. Covers held refresh -> HTTP 503, invalid manifest JSON, and valid fresh manifest; exact cached/fresh values, source dates, Up >=3% filter, and exact request counts are asserted. Failed refreshes recover through explicit Retry.
- Seven mounted controls cover disclosure, valid/invalid refresh, completion ordering, supersession, unmount isolation and StrictMode. Existing cold-cache failure states pass all nine desktop/tablet/mobile cases. Existing cache availability, stale serving and invalidation checks: 51 passes.
- Thirty fresh screenshots yielded 17 distinct byte hashes, each directly reviewed; the other 13 reuse those identical pixels. The mapping and original case measurements are in `measurements.json`. The existing 403-image corpus is preserved unchanged.
- Every clean matrix case observed zero owner API mutations and zero telemetry requests. Telemetry is recorded separately from owner mutations. These are local routed-data fixtures, not real-principal, live-data, full accessibility, full V3 or production proof. Mobile retains the pre-existing four visible table columns.

The source hashes bind the tested component and regression files before the evidence commit. Original failures, the disproved market-preference hypothesis, generated-type failure, diagnostic traces and corrected results remain in the original evidence directory named in `measurements.json`.

## Native text-only enlargement and keyboard

One additional English 320x844 case passes in the pinned external Firefox 151 runtime: native textZoom=2, fullZoom=1, unchanged viewport/DPR, CSS zoom=1, and a measured 10.5px -> 21px font. Native Tab reaches Retry and Enter recovers the fresh scan with the same filter. The entire warning fits its 320px container with no local overflow. Both new screenshots were directly reviewed. No owner mutations occurred; one analytics POST to `/api/collect` was observed separately. This accepts the new warning and Retry only: existing truncated filter labels and table reach at enlarged text are not full-control/accessibility acceptance. Chinese native enlargement is not claimed.
