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

## Remaining gates

Original PR: #1243, same protected source custody and managed publisher. Protected Terminal main has advanced and still conflicts in shared evidence manifests; the newer protected contracts must be retained when composing the final candidate. Fresh exact-head hosted CI, a genuinely independent GitHub review and signed-in production verification are separate release requirements. No merge, queue, Ready/un-draft, SQL or deployment effect is part of this validation.
