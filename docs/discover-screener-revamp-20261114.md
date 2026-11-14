# Discover stock screener upgrade — 14 November 2026

## Mission and ownership
Operation: discover-screener-revamp-20261114-c3. The Chairman assigned this attended session to rebuild the Discover Stock Screener for an understandable, premium workflow, configurable table and account-saved views, with shared regular/overnight quotes and truthful signal/sector information.
GitHub-native source carrier: `sol/discover-screener-revamp-20261114-c3`. Base: c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40. Governing protected Mastermind pin: 199fd4f91ecc426b1d974eb3bf47f5162476cf24, skillpack 1.0.1, bootstrap 1 compatible. Shared Macro doctrine: 776b55ff76053dfe5cf66f129a584c4eefd9a6cb.
This is a source task tree, not runtime admission or a second organizational registry. No existing exact workstream was supplied. PLAN_NOT_ORG_LINKED.

## Completion
The production Discover Stock Screener has a compact primary filter bar, accessible designed menus and advanced disclosure; Symbol/Signal/Regime default together; filter changes preserve columns/sort; draggable and keyboard-reorderable optional columns; multiple account-saved views and honest autosave/recovery; shared quote-owner regular and qualified overnight observations; corrected sector-freshness behavior; exact signal/strategy definitions accessible at the decision point. Focused tests, responsive browser journeys and actual protected-release/served readbacks must support claims. CI, source publication and design are separate from production acceptance.

## Useful phases
- P1 (complete): source/semantics and incumbent audit; preserve existing filters, Smart screens, device presets, market/currency/entitlement/null rules.
- P2 (implemented): stable column registry and account preference composition; drag/keyboard controls, visibility, named views and explicit save state.
- P3 (implemented): compact primary toolbar, designed selects, grouped advanced controls, accessible signal/research help and responsive styling.
- P4 (implemented): compose existing quote demand/projection/session contracts; classify sector stale-source root cause and repair through its original owner.
- P5 (in progress): scoped behavioral tests, type checks, desktop/tablet/mobile EN/ZH visual/interaction verification and preserved legacy tests.
- P6 (next protected release lane): publish qualified Ready PR; preserve actual approvals/holds/protected queue; consume merge and git-gated deploy receipts; verify served product.

## Decisions and falsifiers
- Filters never choose a different column set or default sort. Default broad-universe sort remains traded value, with existing currency grouping.
- Explicit “Buy signals + uptrend” narrows to existing states, with signal age/coverage. It is not a new probability, validated ranking, trade or sizing rule.
- Historical WR/PF/CAGR are optional research columns. Source investigation already finds a legacy-backtest/current-signal exit mismatch; explain it rather than promoting CAGR as default opportunity rank.
- Default order starts Symbol, Signal, Regime, Last, Day change. Table customization must preserve row identity and support pointer, keyboard and touch.
- Reuse installed dnd-kit, account preference delivery owner, canonical quote endpoints and existing classification scan. No new quote/provider/auth/queue/lifecycle service.
- Never label unavailable/stale/EOD/closed-market observations live; genuine overnight must retain the actual session and timestamp.
- Account writes must not overwrite unread settings or land under a changed account; acknowledged saving must be distinguished from local/pending/failed.
- Preserve all existing advanced technical/fundamental and cross-market semantics; move their presentation without discarding depth.

## Concurrent source and carriers
Portfolio PR #1502 head 0ed9642368263859fbda39816b1e0dc02e55d832 is open. Its ScreenerView change only initializes search from the symbol URL. Preserve compatibility without modifying that writer. Its quote additions are not merged; canonical existing quote APIs remain the integration boundary. Discover chooser PR #1508 is path-disjoint from the screener. Sector #1249 source slice has no current screener overlap observed. No other open PR titled screener was returned.
Scratch source copies are validation artifacts; remote GitHub branch is the source writer. No host worktree, deployment, Paper canvas, live portfolio data or provider credentials modified.

## Delegation and evidence
Native advisory UX reasoning completed; parent consumed it. Native signal-contract and concurrency reasoning completed; parent accepted and repaired the concrete findings. No routine native builder substitution. Paid Fabric capability preflight reported adapter_available=false; no request was dispatched. Principal retains implementation under NO_ELIGIBLE_PRE_EFFECT_WORKER/PRINCIPAL_JUDGMENT and actual source authority. WHY NOT FABLE: no additional strategic principal is needed.

## Next action
Publish the source-complete candidate as a Ready PR on the original branch; consume exact-head CI and browser artifacts, repair owned failures, then continue protected release and actual app proof. No production outcome claimed.

## Verified implementation checkpoint — 2026-11-14

P1 source audit complete. Local P2–P4 candidate includes compact/advanced filtering, custom listboxes, 28-column registry, pointer/keyboard arrangement, signal/regime defaults, multi-view UI, shared regular/BOATS quote adapters, and dated classification repair. Signal semantics and the exact `yfinance+massive` provenance fault are source-verified. Current local tests: 67 TypeScript/component assertions and 49 Python producer assertions pass; focused typecheck and dependency-closure parse pass. Browser rendering remains NOT_VERIFIED: local Chromium cannot launch under the execution environment; cloud preview cannot access scratch localhost, and inspection of its internal error page was explicitly refused. That refused error-page effect is closed; do not route around it.

This is an INCOMPLETE SOURCE CHECKPOINT, not release-qualified. Review identified that full saved views must use existing `workspace_settings`, not auth metadata/cookies. Next action: replace only the added Discover persistence lane using existing smart-screens API/auth/fixtures and the existing owner/generation plus PreferencePump, with conditional storage and conflict/failure proof. No production migration is needed by the installed table schema (0015). Then qualify adapted/new browser journeys through normal CI and continue the original protected release. No PR or deploy yet.

Advisory review findings accepted and repaired: account retry restoration/deep links, prompt local intent capture, active-view re-selection, hidden technical-filter visibility, request-continuation fences, owner-generation write binding and per-session quote status. New source-date comparison preserves newer dated GICS evidence and independent industry provenance. Do not redo these without contrary evidence.


## Source qualification — 2026-11-14 11:29:58 UTC

This supersedes the incomplete checkpoint at b23f5a1b1143e621c6532139bc63058678c83b2e. Full Discover views now use a single user-scoped `workspace_settings` document through the existing Smart Screens route and auth/RLS owner. Auth metadata's original write fence is restored. The feature remains under the existing `useMarketPrefs` owner/generation and reuses PreferencePump; it is lazy outside Discover. One row-token CAS atomically saves current/named changes while independent per-key preimages preserve unrelated views. Pending preimages survive reload, unchanged intent replay is idempotent, unsupported formats are refused, and a failed account-version replacement read preserves the draft. No database migration or new auth/queue service.

Local verification: 215 focused TypeScript/component assertions passed across 11 suites; the 56 affected UI/contract checks passed again after moving copy to the existing EN/ZH translation pattern. Focused UI TypeScript check passed. 49 earlier Python producer/sector/verdict assertions remain applicable to the unchanged producer slice. Forward-only plain-language guard passed against the base-to-candidate diff. Playwright collected 93 tests across 7 relevant specs, including 12 new Discover responsive/account/quote cases; collection is not browser execution. Actual browser rendering is still NOT_VERIFIED and is owed through the repository's normal CI artifacts and eventual live app. No synthetic visual pass or cold-reader comprehension claim.

Accepted advisory repairs include durable pending preimages, same-key vs unrelated ACK handling, no lane replacement while a PUT is unresolved, nonretryable conflict handling, failed-discard read safety, unknown-format preservation, API resource consistency, hidden-sort visibility, touch-accessible price details, IME composition, focused rename/error feedback and localized drag announcements. Reuse exact-head evidence; do not repeat these reviews without a changed risk.

Current protected master remains c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40. Portfolio #1502 remains open at 0ed9642368263859fbda39816b1e0dc02e55d832 with `merge-on-green` and `merge-blocked`; do not clear its hold or import its unmerged work. Discover uses the incumbent regular/BOATS quote boundary and preserves its symbol deep link. #1508 remains a separate path-disjoint chooser source.

Release readback: the authorized branch response reports required Quote Hub tests, Terminal typecheck + tests, and Ingest + signal-layer tests bound to GitHub Actions app 15368. Ruleset 24411653 remains active for the default-branch merge queue. The separate admin branch-protection endpoint returned integration 403; that read is closed, with no alternate-carrier replay. Actual PR reviews/holds/checks still need exact-head readback. The incumbent merge-on-green controller reports queue readiness but cannot enqueue under GITHUB_TOKEN; native user admission with a head lease is still required. No label, auto-merge, merge or deployment effect performed yet.

Parent DONE_WHEN remains open. Next proof: exact-head hosted build/journeys and screenshots, then permitted native queue admission, merged-SHA readback, git-gated rollout, classification generation/readback and authenticated account + price-session user-path proof. Current state: MORE_WORK_EXISTS.


## Protected release and consumer-input proof — 2026-11-14 11:43 UTC

Ready PR [#1515](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1515) is the original release carrier. Source implementation at `58207035ab7f76b27c253d62675583a453abb359` was read back exactly. Test-only followup `3c08537f70e1020be64c8bb89a3794fb41b05347` separates drag activation from movement, fixes the browser quote clock, and compares stable symbols. Both branch and file readbacks matched.

`merge-on-green` was added once, and the native user command with `--match-head-commit 3c08537f70e1020be64c8bb89a3794fb41b05347` requested protected auto-merge at 11:37:12Z. Same-PR GraphQL readback: OPEN, exact head, autoMergeRequest present, mergeQueueEntry null. Preserve this existing enrollment; do not re-arm it blindly. There is no self-approval or bypass. The pinned `vps-main-deploy` workflow automatically follows the actual protected-master merge and resolves its current target. Inspect that existing run rather than start a duplicate release.

CI [43590841557](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/43590841557) passed its production build, Quote Hub, PostgreSQL invariants, and unit shards 1/3 and 3/3. Its typecheck found an Element-vs-HTMLButtonElement test-helper typing error; unit shard 2/3 found one existing technical-bar assertion still reading native select options (8,467 other assertions in that shard passed). This commit repairs both test contracts without weakening the unsupported-timeframe assertion. Focused typecheck now includes the affected preset test and passes; 38 preset and 10 technical-bar checks pass. Required hosted CI for this followup remains owed. Responsive jobs from the previous head are diagnostics, not binding acceptance.

Production preflight through the existing StudioDirect M2 native host confirmed the live VPS at its canonical address, active terminal.service, and installed marker `c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40`; no matching release/classification/data writer was active at that observation. No key contents were inspected or changed. The production classification generation is 1794628368 (2026-11-14T03:52:48Z). Exact existing NVDA/AAPL/AMD/TSLA/MSFT records all use `yfinance+massive`, have dated Yahoo profile sectors/industries, but the live scan marks that source unrecognized and falls back to undated GICS. The candidate correctly evaluates all five Yahoo sectors/industries while retaining their existing 2026-11-13 record date. [Exact public input and output receipt](evidence/discover-classification-20261114.json). This was an offline read-only consumer-input proof, not a live generation refresh; normal atomic producer publication after merged-source deployment is still owed.

The normal HTTPS production page is reachable in the cloud browser but signed out. Automatic approval review rejected the attempt to open the observed existing-account sign-in control because it classified the index action as account creation. No account was created, no credential entered, no alternative login action replayed. The page is retained for later authenticated verification; genuine sign-in presence is still needed. Earlier localhost error-page inspection denial and branch-protection admin-read 403 remain closed. No alternate-carrier replay.

Parent acceptance remains open: qualify this exact head, consume responsive screenshots, reconcile permitted protected merge and the incumbent deploy run, verify installed SHA/release receipts, publish classification using the existing producer/lock, and complete authenticated current/named-view plus real price-session proof. MISSION_COMPLETE: false. No deployment or live UI acceptance claimed.
