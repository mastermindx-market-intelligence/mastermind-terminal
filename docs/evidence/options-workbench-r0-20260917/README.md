# R0: reproducible defects, not a repaired release

Parent: Terminal #603. Carrier: `claude/options-workbench-r0-replay-20260917-sol-001`.
Base: `75c22083249e7a1529be3d6baf819b9ad5ea509f`.

## What became verified
The existing 80 renderer/replay tests pass while the added actual-renderer tests expose incorrect numeric price mapping. Mounted tests retain the real SurfaceView, SurfacePane, ReplayProvider, ReplayBar, reducer and HTTP cache; only canvas plumbing and unrelated leaves are mocked. The real Next `/options?tab=surface` browser route reproduces layout-induced time jumps and failure to discover new frames in EN/ZH at desktop/tablet/mobile sizes. All browser market inputs are synthetic. This is defect evidence, not fresh-market or pricing validation.

Final named Vitest run: 100 tests, 86 passed and 14 failed. Of the new helper failures, two specify the proposed additive awaited-refresh API rather than an already-existing cache contract; the current default stale-while-revalidate behavior is intentional. The mounted/browser failures separately prove its current consumer does not refresh the workspace. TypeScript exits 0. Six browser cases fail on their expected behavioral assertions, zero retries. The tests remain intentionally RED; no exclusion or weakening of CI is requested.

## Material correction to the first investigation
The source registry lists 16 views, but the actual browser already groups them into category and view rows. They are NOT 16 peer top-level buttons. The first report overstated that particular navigation defect. Retain the existing category/view structure and focus redesign on coherent panel composition, time identity and efficient controls rather than recreating grouping that already exists.

## What remains blocked
Two separate production-edit calls were refused by the tool platform: first the renderer correction, then the independent shared replay/cache correction. Neither returned a process receipt. Same-carrier source readback and a tracked diff confirm that the original application source remains unchanged. Do not retry these operations through another tool, worker, carrier or renamed implementation. No patch, deployment, live repair, worker START or completed parity is claimed. The failure reproductions and evidence writes were permitted and are preserved here.

## Reproduce
Run from `terminal/`:

```sh
node_modules/.bin/vitest run lib/__tests__/heatSeriesGeometry.test.ts lib/__tests__/surfaceReplayMounted.test.tsx lib/__tests__/flowClientCacheRefresh.test.ts lib/__tests__/replayIndexIdentity.test.ts lib/__tests__/heatSeries.test.ts lib/__tests__/replayEngine.test.ts --maxWorkers=1 --minWorkers=1 --no-file-parallelism
CI=1 TERMINAL_E2E_PORT=33763 node_modules/.bin/playwright test e2e/options-surface-replay.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0 --reporter=list
node_modules/.bin/tsc --noEmit
```

The first two commands currently exit 1 for the captured defects; the last exits 0. A final browser assertion waits for asynchronous render completion after advancing the virtual clock; it does not rely on an immediate pixel/DOM read. Logs from final and earlier discriminating runs are kept separately; ANSI colors, trailing whitespace and the absolute local workspace prefix are normalized for publication, without changing assertions or counts. Do not quote early harness errors as product failures. Traces are not committed; only synthetic screenshots and bounded logs are published.

## Continuation and do-not-redo
Recover this branch and #603 rather than rerunning the old competitor teardown. Preserve #591/#592, #598/#599 and Macro #6604. After an actual platform authorization/recovery signal, reconcile the held source operations on their original carrier before further modification. Keep production changes, independent review, release and real-session acceptance separate. Existing passing geometry controls and timestamp counterexamples must remain discriminating. Do not merge this reproduction branch while its behavioral tests are red.
