# Sector Central R12 — current-source representations and owner-auth repair

`BUILT_NOT_PROVEN / DRAFT / UNMERGED / NOT DEPLOYED`

Operation: `sector-intelligence-terminal-20260926-sol-001`

Parent: `macro#7646 / sector-central-redesign-20260921-sol-001`

Protected procedure: `Mastermind@3c35c5f8c4609c5bbaa4db424521facb6ad3757d`, INDEX blob `94d1af402598894372858793a5b1931019c5fa77`, Skillpack 1.0.1/bootstrap major 1.

R12 product predecessor: `6016f174366cd06807f9ee876bf54fbdcd4376dc`

Repair base reviewed this wave: `9a3f8560a817ff275afcd1604f86f15696ba70d9`

## Capability delta

Sector Central remains one Terminal product with Rotation, Discover, Market breadth and explicit selected-sector research depth. Discover carries three coordinated company-level representations over the same exact selected-sector owner population:

- **Table** — the complete company screener with independent search, source/performance/market-cap/ticker ordering, industry and market-cap filters, selected-company continuity and direct Company Intelligence links.
- **Heatmap** — the same companies grouped by owner industry, sized by owner market cap and coloured by the selected source performance window.
- **Matrix** — the same companies crossed by owner industry and deterministic market-cap bands, with exact cell membership.

The company Table replaces the earlier sector-summary interpretation of that label. Sector selection remains explicit, while the table serves the dense company-research job shown in the accepted Paper design. Sector search and company-table search remain separate URL-durable states.

All three representations preserve:

- canonical English source identity separately from localized EN/ZH labels;
- one selected sector, timeframe, industry, cap band and company identity;
- missing versus exact-zero performance;
- exact return to the prior outer workspace, scroll position and opening-action focus;
- contextual Sources rather than a second workspace;
- access-loss clearing, light/dark and responsive behavior.

The existing Heatmap already serves the deterministic industry/size cluster job from Paper. A separate circle-based Clusters mode would duplicate the same user decision capability. The one genuinely missing answer-first representation is a denominator-aware industry Summary.

No collector, publisher, taxonomy, history store, save/alert store, browser ranking authority or additional state plane was introduced.

## Exact current owner bundle

Every final browser qualification in this packet uses immutable files from Macro revision:

`f94256971e49b6372645af3d329080d6e3747ea9`

| Feed | Owner path | Date | SHA-256 |
|---|---|---:|---|
| sector | `site/sectordata/sector_central.json` | 2026-09-25 | `61a45950781430f66fe00a93f64325819d226f6f36b704f9f899dd106b0b2dc1` |
| confluence | `site/marketdata/subsector_confluence.json` | 2026-09-25 | `2dffa7eb83891a8dc7d12a6aecaf0669bb2cd66a7764667f2694a9c6c446bdde` |
| themes | `site/neuralwebdata/theme_state.json` | 2026-09-26 | `70018e4ba78680a6510e80e770873957295f1eccd07879cf101d3928d9124e32` |
| heatmap | `site/marketdata/sp500_heatmap.json` | 2026-09-25 | `beeadcf92f52b363ebed2ae458acf658702a8d0822e84ef3cc3531b278129961` |

The exact Technology population is 79 names with market-cap-band counts `24 / 26 / 29 / 0`. The separate `Information Technology` source label remains excluded rather than silently aliased.

These files were locally intercepted into the existing Terminal route for deterministic browser qualification. That proves exact-byte UI behavior, not authenticated production transport.

## Provenance correction retained

The original Company Heatmap runs `exact-owner-r1` through `exact-owner-r6` consumed Macro revision `79dbe3f2431b9e21cabf23071f02eab5add57eb4`, although the first R11 README/manifest projected the later `f942569...` identity. The snapshots retain the same 503 ticker identities, 79-name Technology population and `24 / 26 / 29 / 0` bands, but are not value-equivalent:

- 499 of 503 heatmap tiles changed `perf` and/or `size`;
- all 79 Technology tiles changed `perf` and `size`;
- all eleven Sector Central rows changed measured fields.

The old runs remain valid chronology for their immutable `79dbe3f...` input. Current-source acceptance binds only the final `f942569...` runs listed below.

## Authenticated owner-transport repair

The prior gateway validated the Terminal Supabase session, then sent `Authorization: Bearer <access token>` to Macro static JSON. Macro's static regwall/paywall reads the shared `sb-*-auth-token` cookie and ignores that bearer for these assets, so the positive production path could not satisfy the exact gate.

The first cookie repair still captured the raw request cookie before `@supabase/ssr` lazy session initialization. Because `/api/*` bypasses page middleware, `getUser()` / `getSession()` can refresh a session inside this route; forwarding the earlier snapshot could send Macro an expired cookie after Terminal had already validated the refreshed session.

The single existing gateway now:

1. fails closed before auth work when the request carries no exact shared auth cookie;
2. preserves local `getUser()` and same-user `getSession()` admission;
3. after session initialization, re-reads the current request-scoped server cookie store;
4. filters that current store to numeric Supabase session-cookie chunks only;
5. performs no owner request when the current filtered credential is absent;
6. sends only that current `Cookie` header to the fixed HTTPS Macro host;
7. sends no Authorization header and keeps redirects manual;
8. preserves timeout, response-size, content-type, owner-envelope, source-clock, digest and no-store checks.

A discriminating test first failed red because the owner fetch received a stale incoming cookie instead of the refreshed value. It now receives only the refreshed current chunks. This remains `BUILT_NOT_PROVEN` until an entitled signed-in production session proves all four feeds through the real Terminal route and Macro gates.

## Empty-scope state repair

The Heatmap's ordinary clear control used one atomic callback, but the honest-empty recovery button performed two closure-based state writes. The second stale write could restore the first filter and strand the user in an empty industry/cap scope.

The repaired empty state uses the same atomic `onClearScope` callback. Unit proof first failed red, then passed. Current-owner browser proof selects an actually empty industry/cap combination, observes zero tiles, clears it and verifies all 79 names return with both URL parameters removed.

## Final current-source proof

| Surface | Final receipt | Result |
|---|---|---:|
| Company Table | `sector-company-table-20260927/exact-owner-r8-current-atomic-final/qualification.json` | 101/101, 5 captures, 0 page errors |
| Company Heatmap | `sector-heatmap-20260927/exact-owner-r17-current-empty-atomic-final/qualification.json` | 108/108, 5 captures, 0 page errors |
| Industry × Market Cap Matrix | `sector-matrix-20260927/exact-owner-r14-current-atomic-final/qualification.json` | 81/81, 5 captures, 0 page errors |
| Discover / Market breadth journey | `sector-discovery-20260926/journey-r16-current-atomic-final/qualification.json` | 86/86, 10 captures, 0 page errors |

The browser batch covers Chromium desktop/tablet/mobile and WebKit desktop/mobile, EN/ZH, light/dark, exact population/date/identity, filters, sorting, selected company/cell, representation continuity, explicit detail entry and return, Sources, access loss and horizontal-overflow checks.

Validation on the final repaired bytes:

- route + Heatmap repair slice: **2 files / 36 passed**;
- complete Sector unit surface: **11 files / 208 passed**;
- complete Terminal unit suite: **401 files / 6,479 passed / 4 todo**;
- route generation and TypeScript: **PASS**;
- scoped TypeScript/TSX ESLint: **PASS**;
- diff hygiene: **PASS**.

## Failure chronology retained

Qualification-only receipts preserve useful chronology without repeated failed-run screenshots:

- the first final-run attempt lacked the required fixture Supabase environment and failed before product checks;
- the next run reached 96 checks before a proof-only Chinese-copy assumption failed;
- the final run passed 108/108 on the repaired bytes;
- the source tests preserve RED-before-GREEN receipts for stale-cookie forwarding and empty-scope atomic clearing.

## Product and authority boundaries

- Table, Heatmap and Matrix describe exact current owner observations. They do not rank, forecast, gate entries, size positions or authorize trades.
- The Heatmap's tiny-industry visibility floor is presentation-only; owner values, answer math and filters remain unmodified.
- Bubbles, full theme families, nested theme heatmaps, overlap, dated evidence and membership history remain canonical-producer and rights gated. Paper boards are implementation contracts, not permission to synthesize those feeds locally.
- Saves and alerts remain with their canonical product owners; this work creates no local store.
- Existing Paper file/page and Terminal PR #754 remain the same product and source carriers.
- No merge, deployment, Vercel release or production acceptance is claimed.

## Exact continuation

1. publish one immutable repaired candidate on the existing PR #754 branch and consume fresh exact-head CI;
2. refresh current-base integration after the separate protected-base heal lands; do not copy that unrelated pointer repair into this branch;
3. merge only through the normal protected GitHub path when its release gates permit;
4. deploy through the canonical non-Vercel VPS `origin/master` build;
5. prove all four feeds through one real entitled signed-in Terminal session with no interception;
6. after real transport is established, add the Paper-approved denominator-aware industry Summary as Discover's default/first read over the same population;
7. preserve Table for dense screening, Heatmap for deterministic industry/size clustering and Matrix for Industry × Market Cap cells; do not create a duplicate Clusters mode without a new accepted user job.
