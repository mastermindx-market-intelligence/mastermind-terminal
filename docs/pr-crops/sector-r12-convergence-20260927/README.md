# Sector Central R12 — current-source representations and owner-auth repair

`BUILT_NOT_PROVEN / DRAFT / UNMERGED / NOT DEPLOYED`

Operation: `sector-intelligence-terminal-20260926-sol-001`

Parent: `macro#7646 / sector-central-redesign-20260921-sol-001`

Protected procedure: `Mastermind@3c35c5f8c4609c5bbaa4db424521facb6ad3757d`, INDEX blob `94d1af402598894372858793a5b1931019c5fa77`, Skillpack 1.0.1/bootstrap major 1.

Predecessor head: `6016f174366cd06807f9ee876bf54fbdcd4376dc`

## Capability delta

Sector Central remains one Terminal product with Rotation, Discover, Market breadth and explicit selected-sector research depth. Discover now carries three coordinated company-level representations over the same exact selected-sector owner population:

- **Table** — a complete company screener with independent search, source/performance/market-cap/ticker ordering, industry and market-cap filters, selected-company continuity and direct Company Intelligence links.
- **Heatmap** — the same companies grouped by owner industry, sized by owner market cap and coloured by the selected source performance window.
- **Matrix** — the same companies crossed by owner industry and deterministic market-cap bands, with exact cell membership.

The company table replaces the earlier sector-summary interpretation of the `Table` label. Sector selection remains explicit, while the table now serves the dense company-research job shown in the accepted Paper design. The sector search state and company-table search state are separate and URL-durable; changing one cannot silently rewrite the other.

All three representations preserve:

- canonical English source identity separately from localized EN/ZH labels;
- one selected sector, timeframe, industry, cap band and company identity;
- missing versus exact-zero performance;
- exact return to the prior outer workspace, scroll position and opening-action focus;
- contextual Sources rather than a second workspace;
- access-loss clearing, light/dark and responsive behavior.

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

## Provenance correction to R11

The original Company Heatmap runs `exact-owner-r1` through `exact-owner-r6` consumed Macro revision `79dbe3f2431b9e21cabf23071f02eab5add57eb4`, although the first R11 README/manifest projected the later `f942569...` identity. The two snapshots keep the same 503 ticker identities, the same 79-name Technology population and the same `24 / 26 / 29 / 0` bands, but they are not byte- or value-equivalent:

- 499 of 503 heatmap tiles changed `perf` and/or `size`;
- all 79 Technology tiles changed `perf` and `size`;
- all eleven Sector Central rows changed `heat`, `reasoning` and `rotation` fields.

The old runs remain valid chronology for their immutable `79dbe3f...` input. They are not current-source proof. Current-source acceptance binds only the final `f942569...` runs listed below.

## Authenticated owner-transport repair

The prior gateway validated the Terminal Supabase session, then sent `Authorization: Bearer <access token>` to Macro static JSON. Macro's static regwall/paywall reads the shared `sb-*-auth-token` cookie and ignores that bearer for these assets, so the positive production path could not satisfy the exact gate.

R12 repairs the existing gateway without adding another endpoint or auth authority:

1. require the existing local `getUser()` and same-user session check;
2. filter the incoming jar to Supabase auth-cookie chunks only;
3. perform no owner request when that filtered credential is absent;
4. send only the filtered `Cookie` header to the fixed HTTPS Macro host;
5. keep redirects manual, so the cookie cannot follow a `3xx`;
6. preserve timeout, response-size, content-type, owner-envelope, source-clock, digest and no-store checks.

Unrelated cookies, the full browser jar, service credentials and user-supplied URLs are never forwarded. The local access token remains only a same-user session-consistency check; it is not represented as the Macro static credential.

This repair remains `BUILT_NOT_PROVEN` until an entitled signed-in production session proves all four feeds through the real Terminal route and real Macro regwall/paywall.

## Final current-source proof

| Surface | Final receipt | Result |
|---|---|---:|
| Company Table | `sector-company-table-20260927/exact-owner-r8-current-atomic-final/qualification.json` | 101/101, 5 captures, 0 page errors |
| Company Heatmap | `sector-heatmap-20260927/exact-owner-r14-current-atomic-final/qualification.json` | 98/98, 5 captures, 0 page errors |
| Industry × Market Cap Matrix | `sector-matrix-20260927/exact-owner-r14-current-atomic-final/qualification.json` | 81/81, 5 captures, 0 page errors |
| Discover / Market breadth journey | `sector-discovery-20260926/journey-r16-current-atomic-final/qualification.json` | 86/86, 10 captures, 0 page errors |

The final browser batch covers Chromium desktop/tablet/mobile and WebKit desktop/mobile, EN/ZH, light/dark, exact population/date/identity, filters, sorting, selected company/cell, representation continuity, explicit detail entry and return, Sources, access loss and horizontal-overflow checks.

Current source validation:

- complete Terminal unit suite: **401 files / 6,476 passed / 4 todo**;
- complete Sector unit surface: **205/205 passed**;
- route generation: PASS;
- TypeScript: PASS;
- scoped ESLint: PASS;
- plain-language self-check and forward-only added-lines guard: PASS;
- diff hygiene: PASS.

## Failure chronology retained

Small qualification-only receipts preserve the useful chronology without committing repeated screenshot sets:

- Company Table old-owner runs record the initial filter expectation defect, a transient WebKit control measurement, the repaired final old-source proof and the first current-source proof.
- Heatmap current-source history records two stale `.next` route-startup failures followed by a passing current-source run.
- Discover current-source history records one concurrent-startup failure and one transient WebKit measurement before the stable run.
- The post-proof atomic-clear repair initially left required Table/Heatmap callbacks unwired. Targeted tests and TypeScript failed closed; one atomic state patch plus discriminating regressions repaired it, and all four browser qualifications were rerun against the final bytes.

The final proof directories above are the only screenshot sets admitted as current-source acceptance evidence.

## Product and authority boundaries

- Table, Heatmap and Matrix describe exact current owner observations. They do not rank, forecast, gate entries, size positions or authorize trades.
- The Heatmap's tiny-industry visibility floor is presentation-only; owner values, answer math and filters remain unmodified.
- Bubbles, full theme families, nested theme heatmaps, overlap, dated evidence and membership history remain canonical-producer and rights gated. Paper boards are implementation contracts, not permission to synthesize those feeds locally.
- Saves and alerts remain with their canonical product owners; this work creates no local store.
- Existing Paper file/page and Terminal PR #754 remain the same product and source carriers.
- No merge, deployment, Vercel release or production acceptance is claimed.

## Exact continuation

1. publish one immutable R12 candidate on the existing PR #754 branch and consume fresh exact-head CI;
2. merge only through the normal protected GitHub path when its release gates permit;
3. deploy through the canonical non-Vercel VPS `origin/master` build;
4. prove all four feeds through one real entitled signed-in Terminal session with no interception;
5. after real transport is established, add the Paper-approved denominator-aware Matrix Summary as the responsive/default first read, then deterministic Clusters as an expert continuation over the same population.
