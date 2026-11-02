# Portfolio brief proxy freshness — bounded prerequisite

Recorded 2026-11-02. Source subtree BC v1 under the existing Implement Portfolio Terminal recovery, WS:MARKET-OS / WS:MARKET-OS. The containing commit and readback receipt identify the plan revision.

Repository: mastermindx-market-intelligence/mastermind-terminal.
Path: terminal/docs/verification/portfolio-brief-cache-20261102/README.md.
Branch: sol/web-portfolio-brief-cache-20261102.
Application base: bf9826e3d52d84458e7498a95c88ea609c14428b.
Protected procedure: Mastermind@ae3fc6fce8f704b32b01664f1b0d1c0d52a1c8ed, INDEX1.0.1/bootstrap1.
Parent recovery: [Portfolio #1044](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1044).
Organizational linkage: PLAN_NOT_ORG_LINKED; no Market OS wave, Fable flagship ownership or artifact pointer is rewritten.

## Outcome

An authenticated brief read must reach the existing Macro producer, whose cache is keyed to the current holdings and market-context version. Terminal must not substitute a five-minute token-only cached response from an earlier holdings read.

The current proxy at blob a695b81bfbe31d37a38329faf3338bf2d3d486ed caches successful bodies by access token before contacting Macro. Macro app/main.py at b188d09fcf027f2a6f77a396c9d3e79e4660929d loads holdings first and keys its existing cache by uid, context-file modification time and holdings fingerprint. The extra Terminal cache bypasses that freshness protection.

Remove only the redundant Terminal cache and make the upstream read explicitly non-caching. Preserve authenticated-session verification, bearer forwarding to the same fixed upstream, rate limiting, request cancellation, typed/status/body/content-type passthrough, private/no-store response semantics and quiet upstream-failure handling. No cache-busting holding data in URLs, no new cache service, no new identity/hash, no producer changes.

DONE_WHEN for this bounded slice: the real exported route demonstrably returns the producer's second response for two calls under one token, does not retain a successful body across a following failure, and retains auth/error/isolation contracts; independent review and hosted gates qualify the source; normal release records the deployed revision. This is a freshness prerequisite, not complete brief/book consistency.

## Explicit remaining identity obligation

Current PortfolioBriefPanel receives only population/count and does not automatically reread on holdings edits. The brief response lacks the canonical Portfolio bookKey. Macro data.state_digest is a market-state cursor over tickers, not a holdings snapshot identity. Full consistency still requires a producer-bound identity from the actual composition snapshot, consumer matching and retired-request protection. Do not stamp a requested key onto an unrelated response, infer identity from matching counts, or claim this cache removal closes that obligation. Preserve existing population disclosure and the single composer.

## Task subtree

| Task | Dependency | State | Proof |
| --- | --- | --- | --- |
| BC-1 Scope current cache defect | Recovered project | accepted | Exact proxy and producer source inspected; current open-PR brief search returned zero; old #888 source/tests exactly match master and that superseded draft is closed. |
| BC-2 Remove redundant proxy success cache | BC-1 | ready | Only route, focused existing proxy tests and this evidence directory change. No UI/auth/backend semantics or chart/event branch edits. |
| BC-3 Prove freshness and preserved route behavior | BC-2 | proposed | Actual route test-first A-to-B under same token fails baseline and passes; subsequent failure cannot become prior success; two-user forwarding/isolation, unauthenticated, entitlement/error, headers and cancellation controls. |
| BC-4 Independent review, hosted gates and delivery | BC-3 | proposed | Non-author exact-head review; relevant checks; normal merged target/deploy/readback. No browser fixture or source check is promoted into authenticated production proof. |

## Custody, proof and limits

Use the existing repository runner and portfolioBriefProxy.test.ts. Inspect all current relevant PR paths before editing; the search result is not a lease census. No source change is permitted in PortfolioView, PortfolioBriefPanel, EventImpactPanel, TerminalShell, Macro or shared identity/math. Keep PR1212/chart original run and PR1213/event review independent.

API behavior is the changed surface; use discriminating route execution. Do not generate unrelated screenshots or repeat the whole program without a concrete gate. Preserve unchanged UI evidence and report any production authentication limit.

The builder may ordinary-fast-forward its assigned branch after focused proof, update this record truthfully and return exact head/tree, commands/exits, baseline failures, green results, limitations and clean remote/source custody. Keep draft/unarmed; no merge, deploy or production mutations are delegated. Independent review remains a separate actor.

0036 is already applied; immutable SQL/receipt. The old one-use production QA grant is consumed. Risk #1143 review and description actions were explicitly rejected and are outside this operation; no retry/substitute. Preserve original OHLC publisher unknown effects, old hostname probe denial, old comment-update denial and unreadable classic branch-protection observation; no alternate credential/probe or lock removal. No SSH/credentials/Paper/Vercel/Slack/email or descendants. Terminal return: STOP, NOT_WATCHER_ENABLED.
