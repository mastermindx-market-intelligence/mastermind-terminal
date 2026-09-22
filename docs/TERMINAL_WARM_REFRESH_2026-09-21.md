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
- The browser contract seeds the existing disk store, holds the single manifest refresh, navigates from the real Terminal to Analysis, opens the actual shared picker, and requires both the cached company before release and corrected company afterwards. This is a controlled test, not production data or a claimed measured production latency improvement.

## Delivery and continuity
Capability is BUILT_NOT_PROVEN. Parent mission remains incomplete. #701 is accepted live; #705's exact-target deployment is a separate operation with retained log/PID; #702/#688 marker repair remains with its incumbent owner.
Next: finish real-path browser/typecheck/full-suite proof, retain exact source/crop evidence, then use protected CI/merge and the existing exact-target release chain. Do not reuse a merged branch, overwrite marker work, weaken freshness/availability checks, or claim the whole chart programme is complete.
