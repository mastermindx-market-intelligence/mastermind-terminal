# Portfolio brief canonical-context consumer

Owner: Sol / WS:MARKET-OS. Date: 2026-11-02.
Application base: ff7d28228aa13e9ee9dc6248bba685c678f1edcc.
Branch: sol/web-portfolio-brief-context-20261102.
Status: ACCEPTED DESIGN; implementation commission follows the concrete Macro10551 producer contract. Draft/unarmed until independent review, custody, CI and Sol release.

## Outcome and dependencies

A brief may render its facts only for the authenticated owner and canonical portfolio book that produced them. Same-count edits, owner changes, failed reads and out-of-order responses must retire old facts before they can be presented under a new accepted book.

Terminal1214 (cache removal) merged as38031c9ee4f71d59fad5e04d45d0c963fdb70a34. Its source writer is accepted and stopped; do not restore the token cache. Terminal1212 (chart owner guard) merged asff7d28228aa13e9ee9dc6248bba685c678f1edcc. Preserve both. Macro10551 supplies a same-read raw snapshot witness; bind to its exact independently reviewed final contract, not a guessed wire shape.

The event repair in Terminal1213 owns EventImpactPanel and its tests. Do not edit those paths. Foreign Terminal866 owns pending money/currency UI work; preserve its unresolved hunks and custody. Its old timestamp is not abandonment.

## Server boundary

Keep the existing /api/portfolio-brief proxy. The Portfolio panel explicitly requests the fixed header X-Mastermind-Portfolio-Context: snapshot-v1; only this bounded mode requests the corresponding Macro producer contract. Ordinary callers, especially components/workspaces/TodaySinceLastVisit.tsx, retain their current endpoint/status/population/cursor behavior. No new route, client-supplied owner/key/holdings, authentication path, provider token or store is added.

For bound requests, use the existing server-verified user and session. Do not accept client Authorization. Match the producer witness owner to that verified UUID. Require the supported witness version, complete bounded raw row set, unique IDs, exact count/range and matching explicit population. The raw rows include open and closed positions. Respect MAX_POSITIONS from the existing owner.

Apply existing rowToPosition and portfolioBookKey unchanged in the server context helper. Never recreate the hash/normalizer in the browser or Python. Derive the canonical open-position selection from those normalized positions and compare with the witnessed selected IDs and actual producer composition inputs. Selected-ID equality alone is insufficient where Python float and JavaScript Number differ. Use the producer's exact conservative compatibility contract and shared adversarial fixtures; ambiguous or unsupported cases are unavailable.

A watchlist_union brief cannot qualify as a positions brief. Market state_digest and the brief's asof/stale fields remain independent market-context facts, not book identity. Do not infer completeness, population or identity from count, ticker set, timestamps or a merely echoed requested key.

Strip the entire private witness before any browser response. Return only a minimal validated context alongside the existing public brief, with version, authenticated owner, canonical bookKey and population. No raw positions, currency basis receipts, notes or private witness fields may reach browser responses, logs or URLs. Even unsupported/malformed producer responses must not leak a witness. Preserve rate limiting, abort propagation, private/no-store and truthful 401/403/503 behavior. Bound-mode missing/old/invalid producer data is unavailable, never accepted through legacy size-only fallback.

## Accepted canonical binding in PortfolioView

Expose a reactive read binding alongside the positions currently accepted from GET /api/portfolio?view=positions. Use its decoded bookKey and the same owner/seed/sequence acceptance boundary that governs setPositions. Initial SSR positions have no key; the panel remains checking until a canonical read qualifies them. Do not synthesize a key from SSR data.

Retire the binding when the owner or seed changes, when a new canonical verification invalidates it, or when the private read is unavailable/stale. Failed rereads may keep the existing positions table under its current policy, while the brief must not retain qualified facts. Superseded reads may return to their mutation caller but cannot paint a new binding. Do not change mutation serialization, receipt postconditions, quote demand, risk/history/target computation or write authority.

Pass the accepted owner/book/population binding to PortfolioBriefPanel. Same-owner email/language changes do not create a new owner. Committed owner/book A→B→A transitions cannot revive the original request.

## Panel lifetime and presentation

Gate rendering against the current accepted binding in the committing render, not only a later passive effect. Start a fresh bound read when its identity changes. Guard fetch, body parsing, success, error, finally, retries and cleanup with the actual committed request lifetime. Abort is useful but is not the only identity check. No ref mutation during speculative render. StrictMode cleanup may not release or revive a replacement request.

Keep the current compact design, bilingual copy and descriptive desk text. Preserve guest hiding, entitlement teaser, market-stale caution, unavailable/retry state and population disclosure. Checking/unavailable should be clear without exposing implementation internals. Do not show an empty-book claim when the book or witness is unknown.

## Owned paths

- terminal/app/api/portfolio-brief/route.ts: explicit bound mode, verified owner, sanitized context.
- terminal/lib/portfolioBriefContext.server.ts: new server-only witness decoder/compatibility/key binding.
- terminal/lib/portfolioBrief.ts: additive validated public context types/selection.
- terminal/components/PortfolioView.tsx: narrow accepted-book binding lifecycle and panel props.
- terminal/components/PortfolioBriefPanel.tsx: request/render lifetime against binding.
- terminal/lib/__tests__/portfolioBriefProxy.test.ts and portfolioBriefPanelRetry.test.tsx, plus new portfolioBriefContext.test.ts and portfolioBriefSnapshotLifecycle.test.tsx.
- terminal/e2e/portfolio-brief-context.spec.ts.
- terminal/lib/__tests__/fixtures/portfolio-brief-context/** for exact synthetic producer fixtures.
- terminal/docs/verification/portfolio-brief-context-20261102/**.

Keep portfolio.ts, portfolioSnapshot.server.ts, portfolio routes/mutations, EventImpactPanel, TodaySinceLastVisit, shared shell/style owners, auth/DDL/dependencies and foreign work unchanged. Additional production paths need a concrete parent ruling before editing. Fresh open-PR/file/hunk and actual lease census is required; file overlap must be adjudicated rather than treated as abandonment.

## Discriminating proof

1. Real mounted PortfolioView caller: same-count ticker/shares/price/status edit through the normal mutation and canonical reread retires old brief text and renders only the new matching brief. Demonstrate baseline failure first.
2. Real exported proxy with existing Node canonical helper: exact producer witness fixtures; shuffled IDs, open/closed rows, note/time/Unicode differences, decimal strings, integers/1.0, -0, small/large exponents, nulls, boolean/unsupported numeric syntax and valid/invalid currency basis receipts. Supported cases bind to exactly the existing portfolioBookKey; unsupported cases refuse. No new hash owner.
3. Wrong owner/key/population/version, missing witness, truncated/duplicate/malformed rows and incorrect composition selection all refuse. Real canonical read and producer read may legitimately race; mismatch yields checking/unavailable, not fabricated agreement.
4. Late fetch/body/error/finally, committed A→B→A, owner transitions, seed changes, failed reread, unmount, StrictMode, retry double click and stale cleanup cannot revive/release/paint a successor request. Same-owner presentation updates preserve valid identity.
5. Ordinary proxy/Today behavior, 401/403/503, abort, rate limit, caller Authorization rejection, no-store and raw-witness stripping remain correct.
6. Actual EN/ZH browser edit path at desktop/tablet/mobile with checking/unavailable/current states and existing light/dark coverage appropriate to this bounded change. Use the product's synthetic fixture route and real canonical reread; label served brief payload fixtures. No production account mutation or reuse of the consumed QA grant.
7. Relevant focused suites, lint/typecheck, required hosted CI. Do not repeat unrelated giant suites without a concrete gate. Preserve evidence with exact source and hashes.

## Release

Use an admitted isolated source workspace and ordinary non-force publication. Keep this PR draft/unarmed until exact-head independent review, ignored-inclusive canonical remote-complete, terminal source-custody closure and CI. No self-acceptance or live-completion claim.

Deploy the qualified Macro producer before activating this consumer. Old producer behavior is an explicit unavailable state, never a silently accepted legacy payload. Parent retains integrated source composition, canonical deploy and authenticated read-only live acceptance. All earlier Risk1143, migration0036, consumed QA, denied source/carrier and uncertain-effect fences remain in force.
