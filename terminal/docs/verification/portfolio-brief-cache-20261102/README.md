# Portfolio brief proxy freshness — bounded prerequisite

Recorded 2026-11-02. Source subtree BC v1 under the existing Implement Portfolio Terminal recovery, WS:MARKET-OS / WS:MARKET-OS. The containing commit and readback receipt identify the plan revision; the published implementation head and tree are recorded in the PR body for #1214.

Repository: mastermindx-market-intelligence/mastermind-terminal.
Path: terminal/docs/verification/portfolio-brief-cache-20261102/README.md.
Branch: sol/web-portfolio-brief-cache-20261102.
Plan revision (start head): 9b84f05723276dd33c019a2fa7fd43290f954d82.
Application base: bf9826e3d52d84458e7498a95c88ea609c14428b.
Protected procedure: Mastermind@ae3fc6fce8f704b32b01664f1b0d1c0d52a1c8ed, INDEX1.0.1/bootstrap1.
Parent recovery: [Portfolio #1044](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1044).
Organizational linkage: PLAN_NOT_ORG_LINKED; no Market OS wave, Fable flagship ownership or artifact pointer is rewritten.

## Outcome

An authenticated brief read must reach the existing Macro producer, whose cache is keyed to the current holdings and market-context version. Terminal must not substitute a five-minute token-only cached response from an earlier holdings read.

Before this change the proxy at blob a695b81bfbe31d37a38329faf3338bf2d3d486ed cached successful bodies by access token before contacting Macro. Macro app/main.py at b188d09fcf027f2a6f77a396c9d3e79e4660929d loads holdings first and keys its existing cache by uid, context-file modification time and holdings fingerprint. That extra Terminal cache bypassed the producer's freshness protection.

Remove only the redundant Terminal cache and make the upstream read explicitly non-caching — done, see Executed evidence below. Preserve authenticated-session verification, bearer forwarding to the same fixed upstream, rate limiting, request cancellation, typed/status/body/content-type passthrough, private/no-store response semantics and quiet upstream-failure handling. No cache-busting holding data in URLs, no new cache service, no new identity/hash, no producer changes.

DONE_WHEN for this bounded slice: the real exported route demonstrably returns the producer's second response for two calls under one token, does not retain a successful body across a following failure, and retains auth/error/isolation contracts; independent review and hosted gates qualify the source; normal release records the deployed revision. This is a freshness prerequisite, not complete brief/book consistency.

## Explicit remaining identity obligation

Current PortfolioBriefPanel receives only population/count and does not automatically reread on holdings edits. The brief response lacks the canonical Portfolio bookKey. Macro data.state_digest is a market-state cursor over tickers, not a holdings snapshot identity. Full consistency still requires a producer-bound identity from the actual composition snapshot, consumer matching and retired-request protection. Do not stamp a requested key onto an unrelated response, infer identity from matching counts, or claim this cache removal closes that obligation. Preserve existing population disclosure and the single composer.

## Task subtree

| Task | Dependency | State | Proof |
| --- | --- | --- | --- |
| BC-1 Scope current cache defect | Recovered project | accepted | Exact proxy and producer source inspected; current open-PR brief search returned zero; old #888 source/tests exactly match master and that superseded draft is closed. |
| BC-2 Remove redundant proxy success cache | BC-1 | accepted | Proxy cache block deleted from the route; upstream read now explicit `cache: "no-store"`. Only route, focused existing proxy tests and this evidence directory changed. No UI/auth/backend semantics or chart/event branch edits. |
| BC-3 Prove freshness and preserved route behavior | BC-2 | accepted | Test-first: the new contract fails against the unchanged route (4 red) and passes after the repair (16 green) in the real exported `GET`. Subsequent failure cannot become a prior success; two-user forwarding/isolation, unauthenticated, entitlement/error, headers and cancellation controls covered. |
| BC-4 Independent review, hosted gates and delivery | BC-3 | proposed | NOT DONE BY THE BUILDER. Non-author exact-head review; relevant hosted checks; normal merged target/deploy/readback remain with the parent. No browser fixture or source check is promoted into authenticated production proof. |

## Executed evidence (builder, 2026-11-02)

Start head `9b84f05723276dd33c019a2fa7fd43290f954d82`; application base `bf9826e3d52d84458e7498a95c88ea609c14428b`.
Route blob before `a695b81bfbe31d37a38329faf3338bf2d3d486ed`; focused proxy test blob before `180bbe701f2ce7f843c35281e822634c3d6abd20`.

Path ownership was re-censused at edit time, not taken from the earlier search: every open PR in the
repository was enumerated (`gh api repos/…/pulls/<n>/files`, 60 open PRs) and only PR 1214 — this
branch — touches `portfolio-brief` or `portfolioBriefProxy`. No live conflict, so editing proceeded.

Commands and exits, run in `terminal/` of the isolated worktree:

| Command | Exit | Result |
| --- | --- | --- |
| `npx vitest run lib/__tests__/portfolioBriefProxy.test.ts` (original file, start head) | 0 | 7 passed — the suite was green before any change |
| `npx vitest run lib/__tests__/portfolioBriefProxy.test.ts` (new contract, UNCHANGED route) | 1 | 16 tests, **4 failed** — the baseline red |
| `npx vitest run lib/__tests__/portfolioBriefProxy.test.ts` (new contract, repaired route) | 0 | 16 passed |
| `npx tsc --noEmit` | 0 | no output |
| `npx eslint app/api/portfolio-brief/route.ts lib/__tests__/portfolioBriefProxy.test.ts` | 1 | 3 `no-explicit-any` errors — byte-identical count and sites to the start head (route `catch (e: any)`, test `installFetchSpy`); no new lint debt introduced. ESLint is not a hosted CI gate; CI runs `tsc --noEmit` plus tests. |
| `npx vitest run lib/__tests__/portfolioBriefPanelRetry.test.tsx lib/__tests__/todaySinceLastVisit.test.tsx` | 0 | 58 passed (closely-related brief consumers) |

The four baseline red failures were exactly the new user-facing contract, one clause each:

1. `returns the producer's second answer for a second call under the SAME token` — returned `AAPL`, expected `MSFT`; the producer was contacted once.
2. `does not replay a prior success when the next producer read fails` — returned `200`, expected `503`.
3. `never claims a proxy-cache hit` — the second response carried `X-Brief-Cache: hit`.
4. `issues the producer read with cache: no-store` — `init.cache` was `undefined`.

The old cache-hit assertion was replaced, not deleted: `describe("per-user cache: a second call within
TTL is served from cache")` became `describe("brief freshness: every read returns the producer's
CURRENT answer")`, which asserts the producer's current answer under one token, no replay of a prior
success after a later failure, and a truthful diagnostic header. Two incidental test-harness defects
surfaced while writing it and were fixed in the same file: tests shared one access token, so the old
module-level cache leaked a body between them and made failures depend on test order (every test now
takes its own token unless it names one); and `new Response(string)` stamps `text/plain`, which masked
the "upstream sent no content-type" fallback (the producer spy now returns a byte body).

Repair, in `terminal/app/api/portfolio-brief/route.ts` only: the `CACHE_TTL_MS`/`CACHE_MAX` constants,
the `cache` map and `cacheGet`/`cacheSet` are deleted, the cache-hit branch is deleted, and the upstream
read gains `cache: "no-store"`. `X-Brief-Cache` is retained and now always reports `miss` — the header
name and its hit/miss vocabulary are unchanged, but a hit is impossible, so no response claims one.
Unchanged: same-origin same-fixed-upstream target, session/user verification, client `Authorization`
never forwarded, `Authorization: Bearer <token>` minted from the verified session, rate limit (30,
`portfolio-brief`), `req.signal` propagation, upstream status/body/content-type passthrough, the
`private, no-store` response, the local `401` on a missing session and the quiet local `503` on an
unreachable gateway. No query-string holdings/token/data, no new invalidation service or store, no
producer, identity, money-math, auth/RLS, copy/UI, PortfolioView/Panel, EventImpactPanel or
TerminalShell change.

Not changed and reported rather than silently edited, because the frozen scope for this slice is the
route, the focused proxy test and this directory: `terminal/lib/__tests__/alertPrefsProxy.test.ts:9`
still reads `No response cache (unlike portfolio-brief)`. The parenthetical is now false — that proxy
also holds no response cache — while the sentence's own claim about `alertPrefs` stays true. It is a
comment-only correction for the parent to take or decline.

### Limits of this proof

The route was executed against mocked auth and mocked transport in the repository's vitest runner, so
this proves the proxy's own behavior, not an authenticated live brief. No production account was
touched, no one-use QA grant was consumed, no migration was applied, and no credential, SSH, host,
Vercel, Paper, Slack or email surface was used. The UI is untouched and was not re-verified in a
browser; the changed surface is API behavior. This does not prove that the brief matches the book
currently displayed — the canonical producer-bound `bookKey`, current-context rendering and auto
refresh remain owed separately, exactly as the identity obligation above states. `population` and
`count` are not treated as book identity, `state_digest` is not treated as a holdings snapshot, and
Macro's single composer plus its population disclosure are preserved.


## Custody, proof and limits

Use the existing repository runner and portfolioBriefProxy.test.ts. Inspect all current relevant PR paths before editing; the search result is not a lease census. No source change is permitted in PortfolioView, PortfolioBriefPanel, EventImpactPanel, TerminalShell, Macro or shared identity/math. Keep PR1212/chart original run and PR1213/event review independent.

API behavior is the changed surface; use discriminating route execution. Do not generate unrelated screenshots or repeat the whole program without a concrete gate. Preserve unchanged UI evidence and report any production authentication limit.

The builder may ordinary-fast-forward its assigned branch after focused proof, update this record truthfully and return exact head/tree, commands/exits, baseline failures, green results, limitations and clean remote/source custody. Keep draft/unarmed; no merge, deploy or production mutations are delegated. Independent review remains a separate actor.

0036 is already applied; immutable SQL/receipt. The old one-use production QA grant is consumed. Risk #1143 review and description actions were explicitly rejected and are outside this operation; no retry/substitute. Preserve original OHLC publisher unknown effects, old hostname probe denial, old comment-update denial and unreadable classic branch-protection observation; no alternate credential/probe or lock removal. No SSH/credentials/Paper/Vercel/Slack/email or descendants. Terminal return: STOP, NOT_WATCHER_ENABLED.
