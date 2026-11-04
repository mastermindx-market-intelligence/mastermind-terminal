# Exposure workspace — design and implementation evidence

## Current qualification

See the [final November 4 Lab integration and source-state qualification](integration-20261104/lab-source-gate-20261104/README.md) and its [preceding combined implementation record](integration-20261104/README.md). The records below are earlier increments and retain their original scope and results.

# Exposure workspace — archived source correction compatibility

## Why this increment exists

The current protected Terminal implementation performs a fresh read when a user selects an archived Exposure session. This existing PR used the standard stale-while-revalidate cache path, so reopening the same date could instantly show an older book while a corrected source was loaded only in the background. The fix keeps the same cache owner and request counter, but passes `{ refresh: true }` for a deliberate archived-session selection. Ordinary live, market-state and matrix reads retain their previous caching contract. Stale responses from an earlier selection still cannot overwrite a later choice, and the current-session Market State remains hidden in archived replay.

## Falsifiable browser proof

`e2e/exposure-workspace.spec.ts` includes a specific double-visit scenario: it serves strike 756 for the first 2026-07-02 read, returns to live, then serves corrected strike 757 on reopening the same session. Both English and Chinese cases **failed on the old code** because the second request was not made. With the focused source fix, all **12 tests passed** across desktop 1440 × 900, tablet 820 × 1180 and phone 390 × 844. The existing GOOGL sparse-book and Market State/expiry journeys also passed. The `flowClientCacheOutcome` and `flowClientCacheRefresh` unit suites passed **21/21 tests**. These are fixture tests, not real-time market-source or production acceptance.

## Recaptured state evidence

The source edit changes the GEX desk's source hash, so the existing evidence locks cannot simply be updated without new captures. The repository's own failure-state harnesses were run with actual 503/404, retry, failed-refresh and partly unavailable reads, all in EN and ZH at 1440, 820 and 390px:

- [GEX failure-state recapture](../../pr-crops/gex-levels-heatmap-load-failure/operations/exposure-1243-archive-refresh-20261104/) — **54/54** passing images
- [EOD structure and Dark Pool recapture](../../pr-crops/eod-heatmap-flowdesk-load-failure/operations/exposure-1243-archive-refresh-20261104/) — **42/42** passing images; all regenerated root captures were byte-identical to their existing packet

Both original packet-root screenshot sets remain intact. The existing EVIDENCE.yml owners now carry a new `exposureArchivedRefreshRecapture` record with current source hash and each operation-specific image SHA-256. The existing Vitest evidence suites validate that source/image binding. This does not overwrite the newer protected-master evidence qualification and is **not** conflict-free integration on protected master.

## Non-merge protected-sector return compatibility

Current protected Terminal `master@2ded360882b9c721e690907ff363b553781fb920` extends the origin envelope so a user entering Exposure from Sector Intelligence can keep the original **sector workspace, sector, theme and return snapshot** while stepping through options names. The older Exposure branch used `exposureOriginForCompany` directly: when an entire next envelope could not fit its size budget it could retain the *old origin* while still changing the displayed ticker. That is an identity mismatch, not merely presentation.

This one bounded integration slice restores the exact protected Git blobs for `lib/exposureOrigin.ts`, `lib/sectorDepthReturn.ts` and the 22-case `sectorDepthReturn` test. The Exposure desk now invokes `exposureOriginForStep`, which rejects an unrepresentable next selection atomically: **no ticker change without the matching return context**. A new unit test verifies the outer Sector Breadth/light-theme snapshot survives the MU→NXPI step and rejects invalid index/ticker requests.

**Local source verification:** 36/36 origin/depth unit tests passed, 18/18 Sector → Exposure → return browser journeys passed across desktop/tablet/phone, and an isolated TypeScript check (excluding stale `.next/dev/types` development-generated validator artifacts) passed. The ordinary `tsc --noEmit` run encountered only the Next generated route validator mismatch from a concurrently running fixture server; that is not a clean default TypeScript result and requires fresh CI confirmation.

**Versioned visual evidence:** the source edit changed the GEX desk's source hash from `9e6d3363…` to the current `66d82e8c…`. Rather than mutate the earlier archive-refresh screenshots, actual repository capture harnesses produced **54/54 GEX** and **42/42 settled-close/Dark Pool** failure-state frames in EN/ZH at 1440/820/390px, zero failures. Both operation-specific sets are retained under [GEX](../../pr-crops/gex-levels-heatmap-load-failure/operations/exposure-1243-sector-origin-20261104/) and [EOD](../../pr-crops/eod-heatmap-flowdesk-load-failure/operations/exposure-1243-sector-origin-20261104/) with SHA-256 image and source receipts under `exposureSectorOriginRecapture` in the existing EVIDENCE.yml files. Historical root screenshots and previous `exposureArchivedRefreshRecapture` digests remain intact, linked through the previous/current hash chain. Both combined evidence integrity suites passed **15/15**.

This is a **single-parent, same-branch compatibility source edit**, not a merge with protected master. It does not assert that the remaining protected evidence-manifest conflicts are resolved or that the sector-origin caller on the protected branch has been functionally integrated with this candidate.

## Non-merge integration regression: cohort navigation + archived replay

The existing source fixes are now exercised **together**, not merely as two separate passing journeys. The fixture test in [`sector-exposure-journey.spec.ts`](../../../e2e/sector-exposure-journey.spec.ts) starts from a Sector Central MU holding, selects its 2026-10-16 archived Exposure book (visible strike **1070**), steps to NXPI while confirming the archive is cleared and the sector return URL still identifies NXPI, then goes Back to MU and deliberately reopens the same date. The second archive response is a source correction to visible strike **1080**; the old 1070 row must disappear, the fetch count must advance to two, and Return to Sector must restore the MU holding. The test reads the shared **Exact values** view on desktop and phone; it does not assume the desktop-ranked inspector exists on mobile.

The final full regression run passed **24/24** across desktop/tablet/phone with both English and Chinese for this composed flow and the original Sector → Exposure journeys. The isolated TypeScript source check passed. This slice changes only the end-to-end regression and its verification documentation; production code, source-hash locks and screenshot crops were not modified. Results use synthetic controlled market books and are **not** a live-feed, production-deployment or current-protected-base merge proof.

## Protected-root evidence coexistence — non-merge preparation

The existing `exposureWorkspaceRecapture` and `exposureFilterRecapture` sections in both legacy GEX and EOD manifests record the **same** packet-root PNG bytes: 54 GEX and 42 settled-close/Dark Pool images (96 distinct images). All 96 digests match their original PR source, but **none** match the current protected master packet-root images. Copying the old manifest over protected master would silently replace accepted later evidence, while retaining the old hashes against protected packet-root files would be false-green.

This scoped non-merge step therefore copied all **96 historical PNGs byte-for-byte** into [GEX portable history](../../pr-crops/gex-levels-heatmap-load-failure/operations/exposure-1243-root-history-20261104/) and [EOD portable history](../../pr-crops/eod-heatmap-flowdesk-load-failure/operations/exposure-1243-root-history-20261104/). The previously recorded root sections and every packet-root PNG remain unchanged. New `exposureLegacyPacketRootPreservation` receipts map both original sections to the portable folders and record all image SHA-256 hashes. Both existing evidence test suites now assert that every retained file matches **both** historical receipt blocks. This prepares a truthful current-base resolution without executing any branch merge or overwriting protected `scopedRecaptures`, `currentCacheQualification`, `composedSectorReturnQualification`, `archiveSelectionQualification1254` or `sectorArchiveComposition1254`.

**Not yet integrated:** The active `layoutFiles` source lock must be requalified after the final protected-base source composition; the retained historical images are *history*, not proof of the integrated UI. The two manifests and GexDesk source still require a lawful integrated-source carrier and fresh exact-head hosted checks.

## Remaining gates

Original PR: #1243, same protected source custody and managed publisher. Protected Terminal main has advanced and still conflicts in shared evidence manifests; the newer protected contracts must be retained when composing the final candidate. Fresh exact-head hosted CI, a genuinely independent GitHub review and signed-in production verification are separate release requirements. No merge, queue, Ready/un-draft, SQL or deployment effect is part of this validation.
