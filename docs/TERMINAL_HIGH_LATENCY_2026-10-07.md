# Terminal loading on high-latency connections — 2026-10-07

## Outcome and boundary

The existing overseas Tencent EdgeOne deployment is caching Terminal assets and public market data. That does not make Terminal equivalent to the static Macro Dashboard: Terminal still needs session-aware HTML, a substantial client bundle, chart data, and additional live requests.

This change removes one sequential server-to-Supabase read from healthy signed-in startup. It does not establish that cruise-ship or mainland-China loading is now fast. Guest loading, browser transfer volume, optional chart dependency stalls, polling, and cross-border routing remain outside this patch.

Assessment baseline and observed production release: `ad36a332cd4b53af1d917a94f6fb3a10e27dad84` in `mastermindx-market-intelligence/mastermind-terminal`. Observations below were collected on 2026-10-07 around 06:00–06:16 UTC. Neither observation environment was the user's ship or a mainland-China probe.

## Live delivery evidence

DNS returned an EdgeOne CNAME for `app.mastermind-x.com`; responses identified TencentEdgeOne and Caddy. HTTP/2 worked and HTTP/3 was advertised. The serving POP location and the account's acceleration-region configuration were not established.

The following are individual diagnostic samples from the connected development host, not medians or a user-experience benchmark. Bytes are compressed wire bytes where stated.

| Resource | Observed delivery/cache | Body bytes | Example TTFB / total |
| --- | --- | ---: | ---: |
| `/terminal` guest HTML | gzip; private, no-store; edge MISS | 17,254 | 680 / 758 ms |
| 35 distinct JS/CSS URLs linked from the HTML | gzip-request census; 34/35 edge HIT; immutable, one-year static cache | 1,031,424 total | Not an aggregate page timing |
| `/data/NVDA.json` | gzip; edge HIT; five-minute shared TTL | 127,937 | 400 / 477 ms |
| `/data/NVDA.slice.json` | gzip; edge HIT; five-minute shared TTL | 14,491 | 296 / 302 ms |
| `/data/manifest.json` | gzip; edge HIT; one-minute shared TTL | 613,625 | 301 / 466 ms |
| Macro `https://www.mastermind-x.com/china.html` | gzip; public 60-second cache policy; sampled MISS | 64,884 | 606 / 751 ms |

The JS/CSS census comprises 919,096 bytes of JavaScript and 112,328 bytes of CSS. It excludes later dynamic chunks, fonts, Brain, and subsequent API/data requests. It is not a complete browser HAR.

Brotli is already available: an explicit Brotli request for the largest sampled chunk returned `content-encoding: br`. A later `br,gzip` census observed mixed compressed variants and 1,027,780 total JS/CSS bytes. A further Brotli-only census of the same 35 assets at the same release returned 1,012,061 bytes, about 1.9% below the gzip census. Enabling compression is therefore not an established missing fix, and compression choice alone does not explain the loading problem.

The root URL also incurs a cached-capable 307 redirect to `/terminal`. Starting directly at `/terminal` avoids that navigation hop.

A warm guest browser observation using the existing `?boottrace=1` diagnostic recorded NVDA data-fetch start/done at component-relative 90.6/340.2 ms and chart paint at 369.8 ms. The manifest started after chart paint and took about 640.5 ms. These offsets are not navigation timing, cold-load performance, or a China measurement. No application error was recorded in that sampled load; browser-extension metadata errors were unrelated.

### Interpretation

A cache hit avoids an origin fetch; it still requires a network round trip and transfer to the browser. The sampled initial JS/CSS plus two chart resources total about 1.17 MB compressed. At a hypothetical sustained 1 Mbit/s, those bytes alone require about 9.4 seconds of wire time before accounting for protocol overhead, shared bandwidth, parsing, and request scheduling. This is a calculation, not a measured user connection.

The manifest is already normally deferred until the existing visual-ready signal; its 3.5-second fallback can still start while a slow chart is loading. The sample above confirms it did not block that particular warm chart.

Private Terminal HTML must remain private. Making personalized HTML publicly cacheable would risk sharing session-dependent content. Next's documented static-asset caching and RSC variant requirements must be retained.

## Implemented server startup change

Before, signed-in startup awaited verified authentication, then fetched watchlist inventory, then fetched membership of the first list. The page relied on RLS alone for the inventory read even though shared-readable lists can pass RLS.

After, the same verified `getUser()` path calls the canonical watchlists service for the first owned list and its embedded membership in one request:

- Explicit `user_id` filter and returned-owner validation.
- Parent `limit(1)`, parent order by `position`, and separate embedded membership order by `position`.
- Ordinary LEFT embedding preserves an empty first list.
- Raw symbols and nullable/legacy sections retain their previous projection.
- Final chart symbol and data preload still use the existing canonical resolver.
- Unsupported, failed, or malformed embedding falls back to an owner-filtered inventory/member read.
- Failed inventory or membership remains unavailable; it cannot authorize account provisioning.
- New-account seeding requires a successful exact count of zero. A missing count is unknown.
- Existing idempotent provisioning, bounded rereads, fixture path, and recovery component remain the owners of those behaviors.

There is no new cache, service-role credential, retry policy, readiness event, or client-side account-data store.

### Demonstrated performance delta

The actual asynchronous page and installed Supabase query builder were exercised with deferred mocked HTTP. With 800 ms per owner-data request, the original two-read shape took 1,600 ms and the candidate one-read shape took 800 ms, returning the same rows. This demonstrates removal of one serial wait in a synthetic transport model. The saved wait is server-to-Supabase latency, not automatically the user's browser RTT.

Guest startup is unchanged. An embedding failure can add an attempted request before the legacy fallback, and SDK transport retries retain their existing behavior.

## Remaining performance work and existing ownership

| Priority | Source finding | Continuation and acceptance evidence |
| --- | --- | --- |
| High | Viewport navigation prefetch and eager noncritical components add startup work. | Existing PR #654 owns intent-based navigation warming, lazy panels, layout loading, and CSS changes. Preserve that carrier; resolve its current review findings/integration state and prove cold/warm first-chart behavior on current master. Its older reported bundle gains are not current-production or China measurements. |
| High | `getSliceAndOhlc()` awaits OHLC and slice together; a stalled optional slice can delay usable bars. Fetch/body reads have no overall deadline. | Coordinate with the current `dataCache` and ChartPanel owners. Prove usable OHLC can paint while optional data is delayed, late responses cannot cross symbols, and unknown transport failure is not labeled absent history. No parallel replacement cache. |
| High | Warm data can wait behind an in-flight revalidation promise. | Existing PR #707 owns the SWR correction contract and is under an explicit hold. Keep the hold and callback semantics; resolve its named predecessor/review gates before integration. Do not copy the held implementation elsewhere. |
| Medium | CPU-idle scheduling can begin intel/fundamental/options requests while a slow connection is still transferring chart resources. | Use the existing visual-ready owner to gate optional traffic; test slow chart plus fast optional and fast chart plus stalled optional scenarios. Preserve functionality when a panel is opened deliberately. |
| Medium | Wide and extended quote polling lack the in-flight guard already present in the one-second chart lane. | Apply the established single-flight pattern within the owning component after custody coordination. Verify bounded concurrent requests, reconnect behavior, freshness labels, and symbol changes. |
| Medium | A roughly 614 KB compressed manifest is expensive on constrained bandwidth. | First verify whether it actually competes before chart readiness in a throttled cold run. Then reduce first-view consumption or payload through the existing manifest owner, preserving coverage truth and later symbol selection. |

At assessment time #654 was open and merge-blocked; #707 was open with `hold` and `merge-blocked`, auto-merge disabled. Neither was changed by this work.

## Overseas-only China strategy

Keeping the current overseas origin and CDN is compatible with application-level improvements: fewer startup bytes, fewer serial dependencies, cached public resources, prompt visible chart data, and bounded background work.

Tencent documents a separate Cross-regional Secure Acceleration option for overseas sites serving mainland visitors. Its documented path uses Hong Kong access nodes without requiring a mainland origin. Availability depends on the Enterprise plan and incurs additional traffic fees; it is not evidence that the current account has this option enabled. No plan, billing, acceleration region, DNS, or CDN setting was changed.

The next network evaluation should compare the actual current configuration with that optional service only after confirming account eligibility and cost. A mainland probe is still required to establish ISP/region-specific performance. CDN branding or a Hong Kong/Singapore assumption cannot establish that result.

## Verification and release record

- Focused tests: 92/92 passed across the new server-startup suite (30), canonical watchlists (30), grant reads (13), and boot contracts (19).
- Complete unit suite under Node 20.20.2: 469/469 suites passed; 7,727 tests passed and four existing TODOs remained (7,731 total).
- TypeScript passed under both the normal host runtime and Node 20.
- Production build: `npm run build` passed.
- Independent read-only review: PASS on the production page/helper and initial transport suite. Parent review accepted the subsequent test-only CI repair; final reviewed hashes are below.
- First hosted CI exposed a test harness portability error: Supabase resolves a realtime constructor even for REST-only clients, while Node 20 lacks native WebSocket. The harness now supplies a test-only transport that fails on any attempted socket; real REST serialization and actual page execution remain. The obsolete count source-string assertion was replaced by the existing actual-transport coverage. The failure was reproduced, both focused runtime runs passed 45/45, and the full Node 20 suite then passed.
- Deployed anonymous PostgREST preflight: HTTP 200 and an empty array for a nonexistent owner using the embedded query shape. This proves deployed syntax/FK acceptance, not authenticated nonempty membership order or completeness.
- Responsive preload checks: 18/18 passed at desktop 1440×900, tablet 820×1180, and mobile 390×844, covering actual preload reuse, canonical and malformed deep links, and the unknown-symbol state. These use the existing fixture mode and do not execute a private production account read.
- This document records local acceptance and the baseline assessment. Required hosted CI, merge SHA, deployment identity, and live verification belong to the associated PR/release receipt; these local results alone do not claim release acceptance.

| Reviewed file | SHA256 |
| --- | --- |
| `terminal/app/terminal/page.tsx` | `7dca3460aaa24eaa51d25396e029f114831735d74ff37e8135b0318bd1076bbb` |
| `terminal/lib/watchlists.ts` | `7ffa9055bc4f2ebb9f05b73e08b42907033b5cb0f547e7d94cb9a28c501dbabd` |
| `terminal/lib/__tests__/terminalServerStartup.test.tsx` | `e00cf26bd9e93e68ce0cfe8b11818c2820d7e09d53bd5895c2c749a6bcb0dfbb` |
| `terminal/lib/__tests__/watchlistOwner.test.ts` | `7b11eb9169f0c6f703d101b8aa737c905cdd340520588ddfc6c7e8be4fa36a07` |

### Proof still owed for the broader mission

Measure first usable chart, time until core controls respond, transferred bytes before readiness, concurrent requests, long tasks, and failure/recovery behavior. Separate cold and warm cache, guest and signed-in, desktop and mobile. Use controlled RTT/bandwidth/loss profiles and actual mainland routes; label synthetic results separately. Include interrupted connections, delayed slice/manifest, symbol changes during pending responses, and repeated visits.

A live authenticated nonempty owner read is still needed before claiming that private-account startup is production-verified. The current transport suite, schema preflight, and fixture browser checks cover different layers and must not be conflated.

The primary continuation is to finish the isolated server-read carrier's normal integration/release gates, then take the larger client-loading work through #654 and the held cache work through #707's existing gates. The broader high-latency user-experience outcome remains unproven until controlled and regional measurements show it.

## Sources

- Terminal baseline: [ad36a332](https://github.com/mastermindx-market-intelligence/mastermind-terminal/tree/ad36a332cd4b53af1d917a94f6fb3a10e27dad84).
- Existing carriers: [#654](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/654), [#707](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/707).
- [Next.js CDN caching](https://nextjs.org/docs/app/guides/cdn-caching) and [prefetching](https://nextjs.org/docs/app/guides/prefetching). Installed Next 16.2.9 documentation governed implementation; online documentation may describe a newer version.
- [Tencent Cross-regional Secure Acceleration for overseas sites](https://edgeone.ai/document/56448) and [EdgeOne quick start](https://edgeone.ai/document/54208).
