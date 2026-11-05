# Futures capture publication → Terminal consumer

This is the integration contract for the EXISTING capture/publication owner and Quote Hub. It does not create a scheduler, archive, licensing registry, user entitlement, or another feed process. No configuration, live subscription, or market-data permission is installed by the code in PR #964.

## End-to-end code path

Admitted provider records → `FuturesEventAssembler` → existing book/trade reducers → `buildFuturesWorkspacePublication` → incumbent publisher's atomic file publication → existing Quote Hub `/futures` → authenticated Terminal `/api/futures` → strict source/gamma join → existing Options shell `/options/futures` → reusable Depth/Footprint renderer.

The capture owner remains responsible for real provider admission, contract/status records, channel continuity, archival/correction identity, retained history and the actual distribution decision. The projection helper is pure: it opens no socket, writes no file and supplies no permission or clock of its own. A hash proves byte correspondence, not a license or provider attestation.

## Producer inputs

`hub/lib/futuresWorkspaceProjection.js` exports `buildFuturesWorkspacePublication(capture, selection)`.

`capture.binding` is the concrete output of the existing `bindFuturesDefinition` path: named ES/NQ quarterly contract, publisher/instrument identity, session, definition reference, exact nanosecond validity interval and definition availability. The window must not predate its admitted definition or activation, and cutoffs cannot exceed expiration.

`capture.trades` and `capture.depthSamples` are the normalized outputs already understood by `aggregateFootprint` and `buildLiquidityTiles`. Input capacities are bounded. `tradeCoverage` is required (`complete`, `partial`, or `gap`); absence never silently becomes complete. A source adapter's partial execution coverage must not be promoted merely because the renderer has a candle.

Input limits are independent: at most 100,000 trade records and 100,000 depth samples, with separate output-cell and byte budgets. Historical publication may occur after source freshness has ended; it remains labeled historical and cannot pass as a current real-time source.

`capture.sourceId`, `availabilityBasis` (`recorded_receipt` or `vendor_capture_retrospective`), `windowStartMs`, and `publication` clocks are supplied by the incumbent owner. Publication includes source-as-of, publication time, freshness expiration and historical/delayed/realtime basis. Retrospective vendor timestamps cannot be promoted to a real-time source. Realtime freshness is bounded to 15 seconds beyond observed source time in this first consumer; delayed/historical envelope limits are separately bounded. These are conservative implementation policies, not measured vendor SLA claims; actual feed cadence and heartbeat behavior must be qualified before activation.

`capture.distribution` is optional and defaults to `internal_only`. A supplied `subscriber_display` decision must retain its existing `evidenceRef`. That field is not independently authenticated by the pure helper; the trusted capture/publication owner must already have the actual grant. Neither a random reference nor a generated test example establishes market-data rights.

`selection` is one bounded variant: interval 1/5 minutes, price rows 1/4/8 ticks, retained price range, explicit book-age limit, and at most 32 ordered decision cutoffs inside a four-hour window. The builder refuses capacity excess rather than silently dropping observations. It retains executed volume, ungrouped-price OHLC and unknown-side volume, and reconstructs quality-masked time-weighted depth with the incumbent functions.

## Files and read boundary

The function returns a closed leaf name, its source object, and an envelope; it never publishes them itself. There are twelve possible leaves, such as `ES-1-1.json`, `ES-5-4.json`, and `NQ-5-8.json`. Variant-specific leaves prevent every client read from carrying all interval/row representations.

The envelope is `hub.futures_publication/v1`, with exact UTF-8 `payloadJson` and its `payloadSha256`. The incumbent publisher must use its existing atomic replace/receipt workflow. The Quote Hub reads only fixed variant leaves under an explicitly configured `HUB_FUTURES_PUBLICATION_DIR`. That variable remains UNCONFIGURED by this work. It refuses symlinked leaves, overlarge/changing files, mismatched digests, wrong pair/schema, future publication, and sources not marked for subscriber display by their existing owner.

The existing Hub remains loopback-only. The new read route has a closed vocabulary: `pair`, `interval`, and `rows`; it accepts no caller URL, path, provider, key or arbitrary contract. It returns the exact payload bytes plus the SHA-256 header and private/no-store headers. There is no fallback to `.local-futures`, generated development data, a web scraper, or a different vendor.

The Terminal API validates user access with the existing `hasLiveOptions` authority BEFORE reading the Hub. It does not bypass access for development, fixtures, cookies, or query flags. Customer access and source distribution rights remain independent. Authentication denial, rate-limit, missing source and validation errors are also private/no-store.

## Gamma binding without duplicate source data

Optional `gammaByEndMs` entries are immutable source/quote attachments already obtained by the options and quote owners. The builder deduplicates these by exact content hash in `gammaAttachments`; frames retain a `gammaAttachmentRef`. This prevents repeated expiry/greek payloads at each replay representation. Embedded attachments remain a compatibility input to the server consumer; no second gamma calculator is introduced.

Each attachment carries its raw options payload as exact JSON plus SHA-256 and the corresponding source receipt's payload digest. The selected expiry matrix has its own exact bytes, digest and receipt. The existing `buildFuturesGexFrame` then checks root, units, source session, contract, availability, age and quote synchronization at each chart decision time. Source fields, URLs and raw rows are not forwarded to the browser; the response is whitelisted and size-bounded.

Cash-closed state withholds gamma conversion. The first production consumer does not compute a live-looking ratio against an unchanged cash close, infer a forward index, substitute ETF gamma, or synthesize missing exposures. Current quote-age, exposure-age and skew limits are fixed and conservative. A later alternate policy needs actual source-cadence evidence and the corresponding visible basis, not an undocumented widening to make stale data look current.

## Replay, coverage and browser state

Published cutoffs are selected at or before the requested decision, never after it. The API checks integer nanoseconds against the cutoff without millisecond truncation. Publication, observed-source and definition clocks must be compatible. A fresh source heartbeat cannot disguise an arbitrarily old latest chart cutoff. Typed contract validity and execution coverage survive the API boundary.

Quantity closure, price-row uniqueness, raw-price OHLC, cumulative known-side delta, unknown-side volume and depth masks are checked before rendering. The UI labels partial/gap execution coverage and treats cumulative delta as captured trades only. Missing source data is not zero activity. Missing gamma withholds that layer without deleting independently valid futures activity.

The client has no cross-account cache. Changing instrument/request or owner invalidates the rendered state immediately; an older asynchronous response cannot replace the selected instrument. Denial on refresh clears prior prices/levels. Current views have a visible freshness boundary, pause polling while hidden, and recheck on visibility return. Access revocation follows the existing canonical entitlement/cache semantics; this is not a claim of zero-latency revocation.

## Operational gap: implementation is not installation

This branch supplies event-domain adapters, the pure publication composer, an existing-Hub read route and the authenticated consumer. It does not install or prove a continuously running CME MBO capture/publication process. The next activation must identify and reuse the actual capture owner, or add the missing provider adapter inside the existing Quote Hub lifecycle, and bind its real approved inputs. No independent queue, scheduler, data-rights registry or source clock may be fabricated to fill that gap. A publication-shaped JSON file is not evidence that a live feed is installed.

The current client refreshes published snapshots at a five-second cadence. Minute-grouped snapshot/replay qualification is not a claim of tick-by-tick streaming, complete full-session retention, measured burst capacity or instantaneous access revocation. Those production behaviors need admitted source and end-to-end measurements before being advertised.

## Verification versus activation

Local tests cover native-shaped generated records through actual source reducers, projection/envelope, the real loopback Hub HTTP handler, server fetch/digest verification, canonical-access API and rendered production-route component. Permission results and source data are deliberately generated fixtures in those tests. The actual historical ES canary remains separate: real source math was qualified, but its sample has neither subscriber rights nor contemporaneous real gamma and is not promoted into this subscriber path.

Activation still requires the real capture owner's existing grant, actual contract/status/continuity receipts and options/quote availability to be connected, then independent release review, exact-head CI, ordinary deployment and live-browser qualification. No new daemon, scheduled wake, purchase or all-account adoption is implied by this contract or by a green local test.
