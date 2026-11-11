# Workspace loading verification — 2026-11-09

## Source and scope

- Product commit: `2e543db9236c5a344ffeb223b7bca56485d34a2a`.
- Protected source base: `1377853d02fdb0295c0848d7127fdee4ca36714b`.
- Procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Source preimage: RouteSkeleton blob `9cb2ac0987c2549fb2d4ff4b62cf184d781d2882`.
- Read-only diagnosis found no stylesheet definitions for the emitted sk/skbody/skmain/skrow classes.
- Baseline actual navigation Options → Dislocations, with destination code held: fallback 1380 × 496, empty text, transparent block background. Its RouteSkeleton preimage matches this branch base.

## Exact product browser proof

Real Next application, independently launched Chromium fixture browser, existing local fixture gates only. No user session or live trading/account mutation. Source materialization restored the protected base runtime delta and hash-verified all changed product/test blobs before execution. The original archive, base restoration receipt, product source receipt and raw logs remain in the assigned evidence directory.

`TERMINAL_E2E_PORT=41864 node node_modules/playwright/cli.js test e2e/workspace-loading.spec.ts --config /Volumes/STORAGE/mmx-evidence/terminal-smooth-20261109-c1/loading-proof.config.ts`

Result: **9 passed, 47.2 seconds, process exit 0**, no retries.

| Viewport | English motion | English reduced motion | Chinese reduced motion |
| --- | --- | --- | --- |
| Desktop 1440 × 900 | passed | passed | passed |
| Tablet 820 × 1180, touch | passed | passed | passed |
| Phone 390 × 844, touch | passed | passed | passed |

Every case used real navigation from Options through the visible desktop rail or mobile menu; held the actual Dislocations JavaScript; checked one visible localized status, more than ten painted placeholder shapes, retained chrome, viewport containment and no horizontal overflow; released the module and observed the existing ready-state fixture replace the fallback. Reduced-motion cases had zero running placeholder animations.

Inspected desktop and tablet English captures and phone Chinese capture: status readable, rows aligned, no duplicated shell or clipping. Captures attached beside this report.

An initial qualification run exposed a client-only loading label that itself waited for destination JavaScript. The final product removes that dependency: the server-rendered bilingual status follows the existing root locale attribute. The regression test now covers that failure. A separate validation-copy setup error (missing unchanged ChartOverlays stylesheet) was restored from the exact base before the final run; no product workaround was introduced.

## Focused checks

- Existing admin status contract: **7 passed** on final source. No shell-level loading boundary added.
- ESLint RouteSkeleton, RouteLoadingStatus, and workspace-loading browser test: **0 errors, 0 warnings**.
- Full TypeScript check passed on the final loading source alongside the next independent Search candidate (integration validation copy). Exact product browser proof above used the loading branch alone.
- No backend latency, INP, frame-rate or production deployment improvement is asserted from these fixture checks.

## Delivery

Final evidence commit changes only documentation/captures relative to the tested product. Ready and native auto-merge are recorded separately in the PR. Existing queue controls, required checks and release holds remain authoritative. Latest observed master movement (`e33a4c3dd9f0965e7879fc5397175f6f49b0d751`, #1362) changes independent access/onboarding surfaces; no changed product file overlaps.

## Continuation

Search keyboard reveal/current-query commits and tooltip lifecycle are independent next slices. This checkpoint is not a claim that Terminal as a whole has reached final production acceptance.
