# Discover chooser focus verification

## Exact source

- Product commit: `e434de68834c78f370eb0ea4ffdcdc76061d2fb7`.
- Base: `e33a4c3dd9f0965e7879fc5397175f6f49b0d751`.
- Procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.

| File | Git blob |
| --- | --- |
| terminal/components/workspaces/DiscoverWorkspace.tsx | `e61aa1d08d675d9622e1c8a9f682ecf2cec5044f` |
| terminal/components/workspaces/DiscoverLanding.tsx | `5885b9f5089637d5188c605bfd34af8ae5d619c7` |
| terminal/components/workspaces/DiscoverLanding.module.css | `ad94ad0a2208551bd3ae8d8c28527424d83507eb` |
| terminal/lib/__tests__/discoverChooserFocus.test.tsx | `f560fb68101b9b9520c134776feea3984e76fe37` |
| terminal/e2e/discover-focus-continuity.spec.ts | `40e5a7ba6929010941bc22e903b3f8e4f9809a29` |

The isolated no-git browser tree restored Search, Tip and navigation to base and materialized the accepted #1362 base delta, including gates/onboarding and chooser CSS. Runtime/test source hashes were verified before the browser run. Publication uses the independently owned GitHub branch and exact-head leases.

## Results

| Check | Result |
| --- | --- |
| Mounted real chooser/composer and tab-strip cases | 10 passed |
| Changed source/unit/browser lint | 0 errors, 0 warnings |
| Full combined TypeScript | Exit 0 with the exact product source/test blobs |
| Real-route browser matrix | 6 passed, no skips, no retries, 33.1 seconds |

Each desktop (1440×900), tablet (820×1180) and phone (390×844) case runs in English and Chinese. Keyboard activation of both Open Heatmap and Open study focuses the actual selected workspace tab. The tab is fully visible inside the existing horizontal rail, and the document does not scroll. Activating Discover's return control focuses the restored heading; the next Tab continues to the chooser's Search companies action.

Mounted cases separately verify that direct loads/external URL changes do not move focus, ordinary arrow-key tab navigation remains owned by WorkspaceTabs, newer external focus is preserved and superseded intents cannot replay. A canceled return to the same tool reproduced a stale-intent failure before the correction. A separate focus revision now guarantees cancellation without incrementing the hub remount nonce.

Desktop English Heatmap and phone Chinese study captures were inspected. Heatmap can still be fetching its data when its selected tab receives focus; this proof does not claim market-data readiness or alter tool loading/data owners.

## Boundaries

The composer owns the one-shot request. No extra listener, deferred focus callback, global manager or tool engine is introduced. The existing tab strip owns arrow-key movement and horizontal visibility. The landing heading uses the existing focus-ring style. Known held branches #654/#1244/#1249/#1312/#1276/#1188 do not own the changed composer/landing pair; accepted #1362 styling remains intact.

## Delivery

Evidence-only commits leave the qualified runtime unchanged. PR #1382 records Ready and native exact-head auto-merge enrollment separately. Fixture proof is not merge, deployment, measured latency improvement or live acceptance.

[Desktop Heatmap focus](desktop.png) · [Chinese phone study focus](phone-zh.png).
