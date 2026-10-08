# Sovereign auction context — accepted Terminal source delivery

**Status: Draft/HOLD, source-only.** This is the final source-verification entry point for the Chairman's October 8 program. Macro [PR #8657](https://github.com/mastermindx-market-intelligence/macro/pull/8657) remains the official source, lifecycle, economic and research owner. No production deployment, paid-data acquisition or trading authority is included.

## Resulting behavior

The active `TerminalShell` detail surface mounts one independent `SovereignAuctionContext` leaf after the existing action group. The initially proposed `NeuralWebStrip` is dormant in this product; it was restored byte-for-byte to its base and receives no final change. No old market-plane fetch is revived.

The existing `/api/nw` allowlist adds one fixed auction-context selector. It relays only the caller's supported session cookies to Macro's existing guarded calendar path, rejects absent cookies before fetch, refuses redirects, uses a four-second timeout and returns private/no-store responses with `Vary: Cookie`. Upstream registration and staged entitlement remain authoritative. There is no public-R2 fallback, service credential or newly invented tier predicate.

The strict reader validates the nested Macro object, microsecond point-in-time clocks, raw instrument flags, lifecycle dates, nulls and context/research authority. Session changes and sign-out clear the leaf and invalidate older in-flight responses. Poll cadence never represents source freshness.

The UI shows readable EN/ZH instrument and lifecycle text, exact grouped decimal dollars, normalized UTC deadlines and explicit unknowns. Raw IDs, enum values, result keys, null reasons, original decimal/timestamp strings and source health are available in native disclosures. Six events are initially listed; expansion is capped at 24 with explicit total counts. Importance remains unscored, probabilities null and source freshness unassessed.

## Verification accepted

| Gate | Result and evidence |
|---|---|
| Vitest | 42 passed: 8 model, 17 proxy and 17 React component tests. `verification/native_final/`. |
| TypeScript | `npx tsc --noEmit` passed in the canonical workspace. |
| Changed presentation/E2E lint | Passed with zero errors/warnings. Earlier leaf route/model lint also passed. |
| Existing shared Shell lint | 54 errors and 14 warnings already exist. All 68 diagnostics match the original source after exact source-location, embedded code-frame and suggestion-range normalization; no introduced diagnostic. `lint_final/`. This is not a whole-file lint pass. |
| Actual Terminal route in Chromium | 18/18 passed, zero skipped/flaky/unexpected cases. Three viewports, EN/ZH, real shared/full producer fixtures, source disclosures, expansion, unknowns, source failure, unavailable, invalid authority, empty observed set and entitlement loss. `verification/browser_final/`. |
| Existing product invariant | One active leaf; no dormant NeuralWebStrip or old feed request; incumbent signal text remains unchanged across context/error transitions. |
| Visual review | Final desktop EN and mobile ZH screenshots inspected; exact amount/deadline and source-detail reachability checked. |

The product's accepted theme is dark. The browser matrix also probes a `data-theme=light` attribute for robustness; that diagnostic does not implement or certify a light theme. Browser requests and sockets are contained. The source fixture session is fake and loopback-only; production auth/CSP are not claimed. Deliberate refusal of the unstarted loopback Supabase server appears in the runner log and is distinct from the zero page/test errors.

The native test run found and repaired a projection bug: `auctionDisplayRows` needed to return rows after sorting decorated records. Current-source inspection showed that the proposed parent was inactive; the final browser gate verifies the direct `TerminalShell` mount. Later presentation checks preserve auth/effect/projection bytes while moving raw evidence into source disclosures. Final assertions explicitly open and inspect that evidence rather than suppressing it.

`VERIFIED_SOURCE_MANIFEST.json` binds final source, tests and fixtures. Earlier `README_SOVEREIGN_AUCTION_SOURCE_CANDIDATE.md`, the original root source-candidate manifest, and initial review snapshots are historical records, not final hashes or current mount descriptions. Shared fixture SHA-256 is `c3019af2c6439d954886744a4261b8ec84b98f33ebb32ee8aecfa6dcfa98c268`; the actual 74-event context fixture is `e363d46c7082b8c997d3385af3faf5ebab0eb9c07be9a89912c4d215a8cb32b3`.

## Ownership and release boundary

The shared-Shell census and final main-drift record preserve other open writers. The leaf follows existing actions rather than competing with the held returns-calendar insertion. The final observed main change replaces the script-rename import and handler; preserve those two upstream edits together during integration. No Oracle, copilot, replay, ARM/CONFIRM, risk bridge, exit, chart or analysis authority is changed by this leaf.

Macro's calendar path has the existing registration and staged `site_full` gate. A real anonymous 401 confirms that refusal only. The source bridge and simulated identical-file checks do not establish a deployed artifact or a successful entitled HTTP read. Keep this PR held for independent source/CI review and separately authorized release-time verification of actual origin, caller entitlement, production CSP, feed revision/hash, source age and session transitions.

The substantive program, research design, source limitations and prior NO-GO/FAIL/KILL evidence are retained in Macro's existing Rates & Inflation owner. This component is a context surface; it cannot promote an auction hypothesis into a portfolio decision.
