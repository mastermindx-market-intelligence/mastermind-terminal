# Terminal sovereign auction candidate — independent bounded review

**Review status:** source candidate frozen for root-owned official workspace integration and verification. No remote repository write, commit, PR, merge, deployment, provider job, or production acceptance occurred in this review.

## Findings resolved

1. The validator accepted a raw Bill plus explicit/normalized Note because the final ordinary-base class constraint was absent. It now applies the exact W1 base/class/flag reconciliation and retains blank raw source fields under W1 missing-field semantics.
2. JavaScript `Date.parse` discarded receipt microseconds. A receipt one microsecond after cutoff was therefore accepted. Internal instant comparisons now retain the full six-digit producer precision. The exact source text remains unchanged. The injected millisecond request clock is conservatively treated as its lower-bound instant; no source timestamp is rounded forward.
3. A future October 13 Bill could be labeled `AWAITING_RESULT` at the October 8 producer cutoff. Auction and issue calendar labels now reconcile against the producer cutoff and its New York calendar day. The component's later request time cannot advance a frozen source snapshot. Passed deadlines without result evidence retain null results.
4. `first_observed_at` later than `known_at` now rejects. Source age is independently reconciled at microsecond precision; the prior zero-age contradiction was already rejected and remains covered.

Regression coverage also includes sign-out during an in-flight request and overlapping old/new principal responses. The actual component aborts the old signal, clears state at the auth event, and checks a generation token before every state update. The added React tests await execution in the official workspace; this report does not mark them passed.

## Executed evidence

`node review/pure_model_review.mjs [path-to-full-capture-context.json]` executed the actual model under Node v24.19.0. **47 validation cases passed**. The authoritative three-Bill wrapper fixture SHA256 is `b3e7eb3b5ca32e0ebe3d23011d9fa917841f38e9fb436c73c8ca62b53b01d0cb`.

The optional full positive control was generated from root's four actual primary-runtime receipts with W1 `snapshot(data_dir=research_source/forward_capture_primary, as_of="2026-10-08T22:54:00Z")` and JSON indentation 2 plus a final newline. Its SHA256 is `4c6423e712db574b1b7481723f296bdab98366bf3502899903b79ad192725e7b`. **All 74 episodes were accepted**, including 43 observed results and 28 tentative episodes, across Bill, Bond, FRN, Note and TIPS. Projected output validated again identically. The temporary derived context is not duplicated in Terminal; source receipts belong to Macro's research owner.

The source read and comparison included the actual candidate, the source-pinned Terminal originals, final W1 producer implementation and the authoritative wrapper fixture. No protected decision, Oracle, ARM/CONFIRM, copilot, replay, score or forecast module is imported by the new model/component. The incumbent strip renderer changes only by moving into a sibling component; its original market-plane behavior remains untouched.

## Authentication and data boundary review

The new proxy selection is a fixed allowlisted feed name. It constructs `/feeds/event_calendar.json` on the server-owned `NW_BASE` origin; query URL/path parameters cannot change the target. It retains only caller `sb-*-auth-token` cookies, uses no service credential, follows no redirect, has a four-second abort timeout, and returns private/no-store with Vary Cookie for the new feed. Missing cookie never fetches. Upstream 401 remains 401 and 402/403 become 403. No stale/shared result cache or fallback exists. Production cannot use the incumbent fixture bypass; the new auction feed cannot use it in any environment.

The same-tab Supabase auth subscription clears and aborts on principal/session changes. A null session suppresses interval/focus/page/storage fetch attempts until a new authenticated session arrives. Stale overlapping responses are ignored. The initial unknown session may make one server-authenticated read; it cannot bypass the server or upstream entitlement check.

**Unverified publication gate:** the real Macro `/feeds/event_calendar.json` path must actually be served under the incumbent entitlement authority before activation. Mocked route tests cannot prove that guard or the deployed publisher path. Root must keep this separate from source-level proxy correctness. The current source-only publication hold remains intact.

## Required official-workspace acceptance

From the root-owned worktree's `terminal/` directory:

```sh
npm test -- lib/__tests__/sovereignAuctionContext.test.ts lib/__tests__/nwRoute.test.ts lib/__tests__/sovereignAuctionComponent.test.tsx
npx tsc --noEmit
npm run lint -- app/api/nw/route.ts lib/sovereignAuctionContext.ts components/SovereignAuctionContext.tsx components/NeuralWebStrip.tsx lib/i18n.tsx
npm run test:e2e:responsive
```

Use installed lockfile dependencies: Next 16, React/React DOM, Vitest, jsdom and TypeScript from the official workspace. Native `node` checks do not substitute for these. No new Next API was introduced. Read the applicable installed Next guide if any subsequent fix introduces or changes a Next API.

Fresh-incognito browser proof must cover EN/ZH and light/dark at 1440×900, 820×1180 and 390×844; scheduled/awaiting rows before result rows; null, absent, invalid, denied, degraded-source and expanded states; exact USD text and source clocks; no nested anchors, horizontal overflow or clipped important state; same/cross-tab sign-out; new principal and stale-overlap refusal. Existing warning/Oracle/ARM/CONFIRM display must be invariant when auction context toggles. Pure model and DOM tests cannot certify responsive layout, real authentication, entitlement publication or production availability.
