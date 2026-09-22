# Terminal warm manifest refresh — 2026-09-21

## Mission and authority
Continue the Chairman's Terminal chart usability, reliability and performance programme. Let correction-aware symbol/manifest consumers use existing cached data while one refresh is already running, and deliver the fresh result to every such consumer. Do not trade freshness for perceived speed.

Protected Skillpack: `Mastermind@4ca1b97e65de9d4ba8c868b9d708fb7620a8a76f`, compatible v1.0.1; INDEX, COLD_START, ACTIVE_EXECUTION, WEB_CEO_DELEGATION, RECONCILE_STATE and CLOSEOUT loaded at that exact pin.
Base: `mastermind-terminal@5fee4ab7517095c04a1fbab17c6b273826fd6446` (merged cache request-ownership repair #705). Branch/worktree: `claude/terminal-warm-manifest-refresh-20260921` in the canonical Terminal repository on the authorized Mac Studio. Native carrier: Remote Desktop Commander. Direct rationale: LOWER_TOTAL_OVERHEAD for a bounded existing-cache correction. No overlapping open dataCache writer or worktree was found.

## Existing defect and bounded repair
The first stale read can render cached data, but a second reader finding `entry.inflight` must await the network. Even a consumer with `onRevalidate` cannot use the existing cached answer. A slow background refresh therefore becomes a foreground loading delay when moving between Terminal and the shared symbol picker.

A request-local callback list now belongs to the existing cache Entry. Joining readers receive cached data early ONLY when SWR is enabled, cached data is present, and the consumer supplies a correction callback. The same successful, current inflight commit corrects all cached readers. A throwing callback cannot block the others; invalidation during delivery stops further delivery from that generation. Every list is cleared on settlement and is not retained on the committed cache entry.

One-shot OHLC readers, explicit `swr:false`, cold misses, true absence, transient failure, existing IndexedDB ownership, request deduplication and the #705 stale-negative fence retain their existing behavior. No added request, timeout, retry, storage owner, dependency, backend service, chart renderer or indicator math.

## Verification at the initial source checkpoint
- Before repair: 7 failures and 6 passes in the 13 new warm-refresh contracts.
- After repair: 78/78 across warm refresh, request ownership, availability, persistence and bounded absence tests.
- The tests cover prefetch/reader owners, current/failed/invalidated refreshes, strict and one-shot readers, false/zero/empty cached values, and simultaneous IndexedDB read-back.
- Full-unit, TypeScript and real browser qualification are pending at this checkpoint; do not infer completion from a running process.
- The browser contract warms the existing cache through HTTP, expires wall-clock freshness without pausing timers, and holds the single refresh during real Terminal → Portfolio → Analysis navigation, opens the actual shared picker, and requires both the cached company before release and corrected company afterwards. This is a controlled test, not production data or a claimed measured production latency improvement.

## Delivery and continuity
Capability is BUILT_NOT_PROVEN. Parent mission remains incomplete. #701 is accepted live; #705's exact-target deployment is a separate operation with retained log/PID; #702/#688 marker repair remains with its incumbent owner.
Next: finish real-path browser/typecheck/full-suite proof, retain exact source/crop evidence, then use protected CI/merge and the existing exact-target release chain. Do not reuse a merged branch, overwrite marker work, weaken freshness/availability checks, or claim the whole chart programme is complete.

## Completed local qualification

Semantic implementation: `028e51ab87d87d1987e6585b915efd609abbb855`; the later changes are browser-harness corrections and evidence, not production-code changes.

- New cache unit discriminators: **7 failures / 6 passes before; 13/13 after**. All five related cache suites: **78/78 passed**.
- Full Terminal unit suite: **379 files / 6,094 tests passed / 4 existing TODO**. The retained log is `/Volumes/Mastermind/evidence/terminal-warm-manifest-refresh-20260921/unit.log`.
- TypeScript and focused test/browser-harness ESLint: **PASS**, zero lint warnings.
- Final real-browser matrix (warm picker + existing chart settings + chart view/reset, desktop/tablet/mobile, one worker, no retries): **24 passed / 12 intentional viewport skips / zero failures**. The warm picker journey runs once on desktop; existing responsive regressions exercise all three sizes, including EN/ZH settings.
- The actual shared symbol picker rendered cached company data while the refresh was held, then replaced it with the corrected data after release, with exactly **one initial request and one shared refresh**. Both screenshots were visually reviewed. No new UI styling or product copy was introduced.

Earlier harness failures are not claimed as product regressions or valid browser mutation kills: the initial broad navigation selector selected an offscreen drawer link, then the input selector used textbox rather than the real combobox role. A baseline-source experiment later stopped at an uncommitted navigation before reaching the cache assertion; its result is nondiscriminating. The final harness binds navigation to the existing visual-ready event, visible primary navigation and actual input role. Unit RED/GREEN remains the discriminating repair proof. No production failure, extra sleep, force click, timeout expansion, or weakened expected data was used to manufacture success.

The two state screenshots and exact file digests are committed under `terminal/docs/pr-crops/warm-symbol-picker-20260921/`. They use controlled fixture company names to witness cache correction, not real market observations. #705 has now been independently deployed and accepted at `5fee4ab7517095c04a1fbab17c6b273826fd6446` (receipt: PR 705 comment 5769817029); this warm-cache change remains **BUILT_NOT_PROVEN** until its own protected merge, exact-target deployment and production proof.
