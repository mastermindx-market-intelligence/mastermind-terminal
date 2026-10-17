# Terminal sovereign auction display — source-only candidate

Scope: a bounded display sibling at the authenticated Neural Web feed seam. This is not deployed, enabled in production, or accepted as a production integration. Root remains the canonical writer and owns source custody, exact workspace tests, publisher acceptance and any later activation. Existing decision/Oracle/warning/ARM/CONFIRM/copilot/replay modules are unchanged.

## Source pin and files

Existing-file preimages are from mastermind-terminal `d660d98b1ebc0bdf0d1b16d66202b1760f6cc94a`, provided by `consumer_contract/SOURCE_RECEIPTS.json`. Root subsequently reported allowed existing files unchanged through master `54f97dd`; this report is not a substitute for root's official workspace receipt.

- `terminal/lib/sovereignAuctionContext.ts`: pure, clock-injected validation and strict curated projection. Exact context-only/research-only/null-probability/not-scored authority; explicit schema; strictly aware evidence clocks compared at full producer microsecond precision, no later than producer cutoff or injected now; calendar deadlines may be in the future. Recognized official HTTPS hosts only. W1 exact decimal strings are preserved alongside finite numeric values; booleans, nonfinite values and negative USD amounts are rejected. Raw class fields/flags must agree with the producer normalized class and stable CUSIP/date identity, including the base Bill/Note/Bond constraint. Blank raw flags/types follow W1 missing-field semantics without changing their original text. First-observed time cannot exceed row-known time. Auction and issue calendar states are checked against the producer cutoff in America/New_York; request wall time cannot advance them. No score, band, forecast, signal, cache or network import.
- `terminal/app/api/nw/route.ts`: fixed `f=sovereign_auction_context` allowlist entry; fetches `EVENT_CALENDAR_URL`, validates/extracts exactly the nested context, returns only its strict projection. Arbitrary URL/path query parameters cannot affect the endpoint. Other feed paths remain unchanged. The existing 402→403 contract remains unchanged.
- `terminal/lib/upstreams.ts`: `EVENT_CALENDAR_URL = new URL('/feeds/event_calendar.json', NW_BASE).href`; follows the existing server-only endpoint convention. No client import, R2, service credential, new source fetch or auth fallback.
- `terminal/components/SovereignAuctionContext.tsx`: independent sibling with native disclosure, bounded initial six rows and at most 24 expanded rows, visible count/truncation, scheduled/awaiting group before result group and stable chronology within groups. Preserves separate observed clock, cutoff, scheduled deadline, auction/issue/source states, dollar units, null results/reasons and each source's attempt/failure/body/valid-observation/age clocks. Always says “Freshness unassessed”; age is explicitly at producer cutoff.
- `terminal/components/NeuralWebStrip.tsx`: small sibling composition; incumbent market-plane rendering remains in `MarketPlaneStrip`. Auction context remains visible if market-plane is missing. Links are not nested.
- `terminal/lib/i18n.tsx`: EN/ZH LEX tuples for static auction copy. Dynamic producer labels, state codes, reason codes, IDs and timestamps retain original evidence text.
- `terminal/lib/__tests__/sovereignAuctionContext.test.ts`: producer binding, PIT/authority/null/source-failure/amount/link/identity/projection/order tests.
- `terminal/lib/__tests__/nwRoute.test.ts`: existing entitlement suite retained; new extraction/auth/deny/redirect/malformed/timeout/no-cache matrix. Development incumbent-fixture tests explicitly use `NODE_ENV=test`. `NW_FIXTURE=1` cannot bypass auth in production; new auction feed never uses fixture bypass, in any environment.
- `terminal/lib/__tests__/sovereignAuctionComponent.test.tsx`: actual component/strip DOM rendering, null result, exact evidence, EN/ZH, shared theme tokens, absent incumbent plane, auth/entitlement/error clearing, same-tab sign-out and storage change tests. These DOM assertions do not prove browser layout at contract viewports.
- `terminal/lib/__tests__/fixtures/sovereign_auction_context_w1.json`: byte-identical root shared full wrapper fixture.

Authentication uses only the existing caller `sb-*-auth-token` relay, private no-store, Vary Cookie, manual redirects and four-second timeout. No cache is shared between callers. The new component uses the incumbent `@/lib/supabase/client` `createClient().auth.onAuthStateChange` subscription: principal/session changes invalidate/abort old responses; sign-out immediately clears previously entitled bytes and suppresses interval requests until a new session. Auth denial, entitlement denial, transport errors and invalid responses also clear state. Focus/pageshow/storage/visibility changes reset prior caller state before re-reading. Cleanup aborts requests and unsubscribes.

## Exact producer fixture binding

The sole positive fixture is copied exactly from root's `shared_fixtures/sovereign_auction_event_calendar.json`, SHA256:

`b3e7eb3b5ca32e0ebe3d23011d9fa917841f38e9fb436c73c8ca62b53b01d0cb`

Its nested object is root's `shared_fixtures/sovereign_auction_context.json`, SHA256:

`2dbf9d923e99d2ca8fbdc52f99c95f003e58f0177167cb659647ac754fa5cee8`

Root generated it through the final W1 `make_observation`/`build_context` module using original `upcoming.json` response bytes (three genuine future Bills), exact URL `https://www.treasurydirect.gov/TA_WS/securities/upcoming?format=json`, conservative verified availability `2026-10-08T22:12:22.414829+00:00`, cutoff `2026-10-08T22:15:00+00:00`. Original response SHA256 is `6a07572b3d7a13c034018d42b1ffdf165e72dbd4232fb71450d5ff6b0104ea2f`. This is an offline integration fixture, not a historical forecast decision. The Bill `auction:912797SU2:2026-10-13` preserves `95000000000` USD, scheduled deadline `2026-10-13T17:00:00+00:00`, null result and probabilities, and research-only/not-scored labels.

The earlier transformed one-row subset was removed and is not a positive fixture.

## Validation performed in this bounded scratch candidate

Native Node v24.19.0 type stripping imported and executed the actual final pure model: 47 independent validation cases passed, including exact fixture/hash binding, projection idempotence, decimal/null preservation, microsecond future-evidence rejection, base/type/flag reconciliation, producer-cutoff lifecycle states, first-vintage order, source-age consistency, malformed clocks/amounts/links, authority refusal and bounded display projection. The same final model also accepted the genuine four-source W1 capture: 74 episodes (43 observed results, 28 tentative, three announced) across Bill, Note, Bond, TIPS and FRN, and its projection revalidated identically. This broader capture is a positive integration control, not a second synthetic fixture. See review/pure_model_review_result.json and review/INDEPENDENT_REVIEW.md. These are pure-model execution results, not Vitest, Next typecheck, or React/browser acceptance.

No local node_modules includes TypeScript/Vitest/React/Next; root acquired the official workspace and will run real dependencies. Package manifest and Vitest config were inspected read-only at the exact source pin. Next API usage is unchanged; no new Next API was introduced. No source checkout, commit, provider mutation, message to an external person, merge or deployment was performed by this builder.

## Required official workspace commands and remaining checks

From `terminal/` in root's official isolated workspace:

```sh
npm test -- lib/__tests__/sovereignAuctionContext.test.ts lib/__tests__/nwRoute.test.ts lib/__tests__/sovereignAuctionComponent.test.tsx
npx tsc --noEmit
npm run lint -- app/api/nw/route.ts lib/sovereignAuctionContext.ts components/SovereignAuctionContext.tsx components/NeuralWebStrip.tsx lib/i18n.tsx
npm run test:e2e:responsive
```

Use fresh incognito EN/ZH light/dark at 1440×900, 820×1180, 390×844. Required evidence: no nested anchor, no horizontal overflow/clipped important state/reload workaround; incumbent warnings unchanged with auction feed on/off; same-tab and cross-tab sign-out clear state; new principal cannot inherit old data; stale overlapping requests cannot restore data. Verify result-observed, result-null, absent, invalid, source-failure, denied and bounded-expansion states. Root must typecheck and execute the actual tests rather than infer success from these command listings.

Production remains OFF at the existing producer-publication boundary: this source is undeployed and no new risk flag was added. Absence of nested context yields explicit unavailable. Exact canonical Macro publication and entitlement are unverified; only root/producer owner may establish them, without substituting public R2 or bypassing auth. Production acceptance/deployed SHA and publisher path remain separate gates.
