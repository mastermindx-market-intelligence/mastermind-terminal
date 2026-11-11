# Beta shell reliability sweep - 2026-11-09

Operation: `beta-shell-bug-sweep-20261109-astra-01`.
Parent: `docs/TERMINAL_EXPERIENCE_MASTERPLAN_2026-10-22.md`, especially loading/recovery, shared context, and production verification.
Chairman assignment: proactively scan the whole beta shell, reproduce and repair bugs in batches, advance protected delivery while continuing independent fixes. No change to authentication, entitlements, source authority, trading logic or release safeguards is authorized by this plan.

## Source and custody
- Terminal starting source: `e4329a7d265e1d2405cad4e87ead9b7797d60e61`.
- Mastermind procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`, skillpack `1.0.1`.
- Macro design guidance pin: `536ab7d78c2fbcab8a7c8a3cdc8d09fbe2bff136`; design doctrine/system blobs unchanged from prior accepted reads.
- Original managed branch: `sol/web-beta-shell-bug-sweep-20261109-astra-01`.
- Prior accepted repair: Terminal #1351, merged/deployed beta at `b58635bf54472a05ef3cd9db90c2ecc20cbdfd9f`; do not reimplement its unpinned Intelligence fallback.
- Live collision census: #1352 owns Portfolio navigation recovery; #1353 owns Settings isolation and navigationRecovery; #1188 owns deferred catalog startup; #1244 owns broader beta intelligence integration. Keep their branches and held effects untouched.
- Execution reason: `LOWER_TOTAL_OVERHEAD` for direct principal reproduction and small source fixes sharing one browser/test harness; retain one writer. No worker has been dispatched by this operation.

## Outcome and acceptance
Representative journeys cover native Today, Discover, Analysis, Monitor, Research, Portfolio, Terminal, Options and Alerts; legacy market/research/news pages; shared search/directory, dialogs, navigation, Back/Forward, and failure recovery. Identify current deployed SHA separately from local fixtures. A signed-out gate is expected, not an authenticated product pass.

A repair is accepted only with a failing-before/passing-after reproducer, affected tests, source self-review, required exact-head CI, permitted protected merge and required beta runtime/browser proof. An open PR, screenshot, local fixture or green CI alone is not live acceptance. Record untested authenticated and data-dependent cells honestly.

## Work phases
1. **Reproduce and prioritize**: public-beta route/interaction census plus production-shaped local fixtures. Inspect console/network failures without retaining secrets. Preserve existing repair ownership.
2. **Shared overlay reliability**: test suspected Tools/mobile-sheet scroll-lock races against the existing `scrollLock` owner; repair only demonstrated paths.
3. **Analysis request reliability**: test overlapping/delayed quote responses and symbol transitions; preserve valid source identity and current-versus-stale meaning.
4. **Follow discovered failures**: inspect independent state/URL/recovery issues; add deterministic regressions and fix coherent bounded batches. Do not invent data or treat denied access as missing data.
5. **Protected delivery and re-audit**: qualify each stable diff, publish one Ready PR per coherent batch, enroll normal merge-on-green/native queue when qualified, deploy through the existing beta owner, then check the next safe issue rather than ending at a checkpoint.

## Current evidence
Initial source inspection found inconsistent scroll locking in `ShellDirectory` and `MobileSheet`, and unsequenced Analysis quote polling. These are hypotheses until executable reproductions prove them. Public-browser baseline is pending.

## Deferred/non-goals
No production rollout unrelated to beta; no new control plane, catalog, cache, permission bypass or test quarantine. Existing NVDA native event-workspace coverage is an independently evidenced producer gap, not permission to manufacture current event data. This sweep does not claim every one of the 13,000+ finite legacy pages was tested.

## P2 verified local milestone
All six manual overflow writers now join the incumbent `scrollLock` owner: Tools directory, mobile sheets, mobile navigation, Analysis hub, guides and watchlist event planner. No new lock registry was created. Original focus, detent, handoff and PR697 hold semantics remain.

Failing-before proof: 7/7 regressions for the original directory/sheet; expanded coverage then exposed 11 failures in the remaining four components. After repair: 69 related unit tests pass; ESLint and TypeScript pass; 22 real-browser cases pass at desktop/tablet/mobile, with two unchanged viewport-specific skips. The existing directory handoff assertion used a retired search title; it now checks the accepted shared-search title plus explicit Companies scope, retaining focus/Escape assertions.

`overlay-qualification.json` binds exact source bytes, test commands and six responsive screenshots. Public route baseline: 16 routes returned HTTP 200 with no outer-shell exception or document overflow; seven member-gated routes were signed-out gates, not authenticated acceptance. Five planned embedded-content checks are not claimed as complete. A first sector probe timed out; a bounded diagnostic follow-up reached the real frame with its source gate ready and no page exception. The read-only sector probe is retained without financial report prose.

Next: publish and qualify this coherent overlay batch, then reproduce the independent Analysis quote ordering problem while CI proceeds. Merge/deployment and authenticated live paths remain unproven for this new repair until explicit receipts exist.
