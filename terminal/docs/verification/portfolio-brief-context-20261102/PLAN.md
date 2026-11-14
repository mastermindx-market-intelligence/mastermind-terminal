# Portfolio brief canonical-context consumer

Owner: Sol / WS:MARKET-OS. Date: 2026-11-02.
Application base: ff7d28228aa13e9ee9dc6248bba685c678f1edcc.
Branch: sol/web-portfolio-brief-context-20261102.
Status: ACCEPTED DESIGN against the concrete Macro10551 candidate below; implementation may proceed while independent producer review runs. Draft/unarmed until qualified producer compatibility, independent consumer review, custody, CI and Sol release.

## Outcome and dependencies

A brief may render its facts only for the authenticated owner and canonical portfolio book that produced them. Same-count edits, owner changes, failed reads and out-of-order responses must retire old facts before they can be presented under a new accepted book.

Terminal1214 (cache removal) merged as38031c9ee4f71d59fad5e04d45d0c963fdb70a34. Its source writer is accepted and stopped; do not restore the token cache. Terminal1212 (chart owner guard) merged asff7d28228aa13e9ee9dc6248bba685c678f1edcc. Preserve both. Macro10551 supplies a same-read raw snapshot witness; bind to its exact independently reviewed final contract, not a guessed wire shape.

The event repair in Terminal1213 owns EventImpactPanel and its tests. Do not edit those paths. Foreign Terminal866 owns pending money/currency UI work; preserve its unresolved hunks and custody. Its old timestamp is not abandonment.

## Concrete candidate wire and count domains

Implementation reference: Macro10551 immutable head68adf1cf47af278efc09fa0692d4066d2182f697, treed1c28ff10d252777260c6b7669fe6d3dd7aa4c50. Read docs/verification/portfolio-brief-snapshot-20261102/WIRE_SCHEMA.md (blobed68c48af609433e775c2c15839836f495789721), actual producer code and shared tests/fixtures/portfolio_brief_context/projection_cases.json (blobe1b5702357256ceaf0b53631379b18c98bf9c1cf). This is interface admission only; the producer source is unaccepted, independent review and a known hosted-CI test-wiring repair remain required. Do not inherit a Python imitation as a canonical oracle. The consumer's actual unchanged Node normalizer/key and strict compatibility gate govern acceptance; report fixture/projection disagreements without bending that owner.

The witness fields are schema, owner_id, population, raw rows, selected_position_ids, composer_input_source, composer_inputs and completeness. For this v1 contract require max_rows === 1000, positions_reads === 1, complete === true, source === portfolio_positions, watchlist === null for positions, and consistent finite integer count/range metadata. Empty ranges use null endpoints. Enforce both this explicit producer cap and imported Terminal MAX_POSITIONS2000. More than1000 raw rows is unsupported/unavailable in this version even when Terminal can display the larger book; never accept a truncated page or stitch pages. Declarative fields alone do not prove the producer's behavior; independently accepted producer source remains a release gate.

owner_id must equal the existing server-verified authenticated UUID exactly. An email fallback never qualifies and must not be resolved, rewritten or stamped with that UUID. The producer document's synthetic u-example is a negative consumer fixture; positive fixtures use a valid matching synthetic UUID.

Keep these count domains separate:

| Domain | Meaning |
| --- | --- |
| exact_count / returned_count / rows.length / nonempty range length | All raw captured database rows, open and closed, before normalization |
| open_count | Raw rows classified open by the existing canonical status rule |
| selected_count / selected-ID count / composer-input count | Selected open position records or lots |
| brief.book.n / brief.population.n | Unique normalized ticker names used by the composer |
| Portfolio caller population.count / open.length | Canonical open position records shown on the page |

Validate selected-ID membership and the complete expected composer-input projection with multiplicity. Do not reduce lots to a ticker set or assume index correspondence without establishing that contract from source/fixtures. Validate witness population, composer_input_source and the brief's own population together. Preserve raw currency/receipt fields for unchanged Node normalization even though composer_inputs contains only ticker, shares and entry_price.

For the bound Portfolio renderer, current-book qualification comes from verified owner, canonical book key, explicit population and actual committed request scope. A position-count versus unique-name-count difference is not evidence of a different book. Retire the legacy size-only mismatch heuristic in this strict path; it may remain for callers that did not opt in. Keep displayed position count truthful. If both counts appear, label positions versus names, or keep a compact source disclosure that does not imply numerical equality. A watchlist_union response never enters qualified positions facts.

## Server boundary

Keep the existing /api/portfolio-brief proxy. The Portfolio panel explicitly requests the fixed header X-Mastermind-Portfolio-Context: snapshot-v1; only this bounded mode requests the corresponding Macro producer contract. Ordinary callers, especially components/workspaces/TodaySinceLastVisit.tsx, retain their current endpoint/status/population/cursor behavior. No new route, client-supplied owner/key/holdings, authentication path, provider token or store is added.

For bound requests, use the existing server-verified user and session. Do not accept client Authorization. Match the producer witness owner to that verified UUID. Require the supported witness version, complete bounded raw row set, unique IDs, exact count/range and matching explicit population. The raw rows include open and closed positions. Respect imported MAX_POSITIONS from the existing owner. Compare exact database count/range against raw witnessed rows before normalization: rowToPosition may filter unusable rows, and that must not masquerade as a complete raw snapshot.

Apply existing rowToPosition and portfolioBookKey unchanged in the server context helper. Never recreate the hash/normalizer in the browser or Python. Derive the canonical open-position selection from those normalized positions and compare with the witnessed selected IDs and actual producer composition inputs. Selected-ID equality alone is insufficient where Python float and JavaScript Number differ. Use the producer's exact conservative compatibility contract and shared adversarial fixtures; ambiguous or unsupported cases are unavailable. The helper validates compatibility against the result of unchanged rowToPosition; it must not repair values, introduce a second normalizer or guess units.

A watchlist_union brief cannot qualify as a positions brief. Market state_digest and the brief's asof/stale fields remain independent market-context facts, not book identity. Do not infer completeness, population or identity from count, ticker set, timestamps or a merely echoed requested key.

Strip the entire private witness before any browser response. Return only a minimal validated context alongside the existing public brief, with version, authenticated owner, canonical bookKey and population. No raw positions, currency basis receipts, notes or private witness fields may reach browser responses, logs or URLs. Even unsupported/malformed producer responses must not leak a witness. Preserve rate limiting, abort propagation, private/no-store and truthful 401/403/503 behavior. Bound-mode missing/old/invalid producer data is unavailable, never accepted through legacy size-only fallback.

Classify existing 401 and 403 status paths before successful-brief witness qualification. They need neither a witness nor a canonical book key. Canonical readiness gates personalized facts, not entitlement. Obtain current-owner entitlement independently while the canonical read is pending/unavailable; it must remain observable without treating a failed positions read as an entitlement result. Every status is fenced by the request owner and lifetime.

In bound mode, parsing, shape, identity or compatibility failure returns a fixed safe unavailable response. Never forward malformed upstream text, raw error details or exception strings that might contain witness content. Reconstruct only the supported public response; do not merely delete one property from an otherwise unvalidated object. Preserve the ordinary branch's existing data, population and cursor shape for Today.

## Accepted canonical binding in PortfolioView

Expose a reactive read binding alongside the positions currently accepted from GET /api/portfolio?view=positions. Use its decoded bookKey and the same owner/seed/sequence acceptance boundary that governs setPositions. Initial SSR positions have no key; the panel remains checking until a canonical read qualifies them. Do not synthesize a key from SSR data. Expose an owner-scoped canonical-read phase (checking, unavailable, qualified) alongside a stable accepted-read binding; do not create a fresh inline identity object on every presentation render. A failed/retired read is unavailable, not perpetual initial checking.

Retire the binding when the owner or seed changes, when a new canonical verification invalidates it, or when the private read is unavailable/stale. Failed rereads may keep the existing positions table under its current policy, while the brief must not retain qualified facts. Superseded reads may return to their mutation caller but cannot paint a new binding. Capture the existing committed owner generation/effect-lifetime scope at read start. Publish the brief binding only while both that scope and the canonical sequence/seed boundary remain valid, including A→B→A. Reuse this existing scope narrowly for the binding; do not rewrite mutation or analysis behavior. Do not change mutation serialization, receipt postconditions, quote demand, risk/history/target computation or write authority.

Pass the accepted owner/book/population binding to PortfolioBriefPanel. Same-owner email/language changes do not create a new owner. Committed owner/book A→B→A transitions cannot revive the original request. The Portfolio caller always selects the fixed snapshot contract: null, checking or unavailable binding never switches the request/renderer to the legacy size-only path. Only callers which did not opt in, including Today, retain legacy behavior.

Retry after canonical-read failure or same-owner book mismatch first uses PortfolioView's existing canonical reload path, then requests the brief for the newly accepted binding. The panel must not add another positions reader. No automatic mismatch/retry loop; owner mismatch never permits adopting another owner's book.

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
5. Ordinary proxy/Today behavior, 401/403/503, abort, rate limit, caller Authorization rejection, no-store and raw-witness stripping remain correct. Prove 401/403 remain observable for the current owner when a canonical key is absent, and late previous-owner status cannot paint. Malformed upstream text and thrown errors containing sentinel private witness fields must yield fixed safe unavailable bodies without leaking the sentinel.
6. Initial checking versus failed-read unavailable; deliberate retry after read failure and same-owner mismatch must use the existing canonical reload before bound qualification. A pending/failed binding never selects legacy mode. Verify raw completeness before row filtering and strong committed-scope ABA rejection.
7. Actual EN/ZH browser edit path at desktop/tablet/mobile with checking/unavailable/current states and existing light/dark coverage appropriate to this bounded change. Use the product's synthetic fixture route and real canonical reread; label served brief payload fixtures. No production account mutation or reuse of the consumed QA grant.
8. Multiple position IDs sharing a ticker must qualify the same exact book with truthful positions-versus-names disclosure. Duplicate/missing composer inputs must fail even if a ticker set matches. Nonmatching email owner, unsupported cap and1001-row captures refuse without a legacy fallback.
9. Relevant focused suites, lint/typecheck, required hosted CI. Do not repeat unrelated giant suites without a concrete gate. Preserve evidence with exact source and hashes.

## Release

Use an admitted isolated source workspace and ordinary non-force publication. Keep this PR draft/unarmed until exact-head independent review, ignored-inclusive canonical remote-complete, terminal source-custody closure and CI. No self-acceptance or live-completion claim.

Deploy the qualified Macro producer before activating this consumer. Old producer behavior is an explicit unavailable state, never a silently accepted legacy payload. Parent retains integrated source composition, canonical deploy and authenticated read-only live acceptance. All earlier Risk1143, migration0036, consumed QA, denied source/carrier and uncertain-effect fences remain in force.
