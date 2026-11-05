# Investor Shell Native Preview Implementation Plan

> **CURRENT FRONTIER:** Exact-source fresh-server proof is now recorded in `terminal/docs/pr-crops/investor-shell-native-preview-20261008/isolated/receipt.json`. Primary source d1d09f37: 10 browser passes / 4 inherited mobile Escape failures / 4 project skips. Detached exact #697 dependency: 31 browser passes / 23 project skips / zero failures. Both source combinations pass 480 files / 7,863 unit cases / 4 todo. Optimized frontend compilation passes; the full production build and generated-route typecheck remain blocked by four pre-existing API exports. No live/hosted promotion or mobile-source adoption has occurred.

**Goal:** Start the approved shared-shell migration in the existing native application, with a default-off two-route preview and a retained Macro-to-native return journey. Parent migration remains incomplete.
**Architecture:** Extend AppShell and AppNav; retain TOP, navHref, useFromMacro, identity/settings/onboarding providers and the existing Brain host. The first slice is a presentation change, not adoption of a second route catalogue, identity store, engine, or complete six-job IA.
**Tech stack:** The repository-locked Next/React/TypeScript application, Vitest and its existing responsive browser harness. No framework or package upgrade.
**Spec:** Macro `research/SHARED_SHELL_PRODUCTION_REASSESSMENT_2026-10-08.md` at `9b54c2d7f1f19a7371a7ee2102fb706f46e1b7ac`; final Paper inventory/release in Macro #7949 comment `6070594815`. Current outer Chairman instruction: Continue.

## Authority, source and existing effects

Protected Mastermind pin: `f74e912d3efa3b67cae40ba04f9e558d579096e9`, compatible Skillpack 1.0.1 / bootstrap 1. INDEX, COLD_START, ACTIVE_EXECUTION, SESSION_RELIABILITY and WEB_CEO_DELEGATION loaded from this pin. Actual served model/mode unobserved.

Native base: `f03aa5d019f1894210a7c6e40b8825ae28015198`; branch `claude/investor-shell-native-20261008-c1`; isolated worktree at `/Users/chriswong/Documents/Cluade/charting-app/.claude/worktrees/investor-shell-native-20261008-c1`.

The original Macro worktree `shared-shell-r27` is clean at `1b895236dfec4f20e0a62812a7c9c4c6d2db901c`; it remains locked and was not checked out, reset or advanced. Macro #7949 is still Draft/HOLD at `9b54c2d7...`. Native primary checkouts were not edited. New worktree creation returned exit 0; isolated npm ci with scripts disabled returned exit 0 (459 packages). Full baseline tests are running under Studio process 96988; do not duplicate that run.

Executive V3 readback: server 1.4.0, mode readonly, no RUNNING attempts; its exposed submission only queues and is disabled in this generation. No eligible effectful dispatch was established. Direct source work proceeds under NO_ELIGIBLE_PRE_EFFECT_WORKER / PRINCIPAL_JUDGMENT for this cross-repository integration. No worker was submitted or spawned.

Collision census: 102 open native PRs inspected for the planned files. #654 adds intent prefetch to AppNav and an Observatory import to AppShell; preserve those contracts at integration. #846/#647 have competing non-production fixture identity branches in (shell)/layout; this slice does not import either or change authentication. #697 owns MobileNav modal behavior; do not edit or replace MobileNav. No source lease is displaced by this isolated branch. No merge, auto-merge, deployment, DNS or production flag changes are authorized by this first preview slice.

A compound Studio read of package/scripts, SearchModal, originNav, supabase/server, Discover page and Vitest config was refused before dispatch. That exact inspection is not retried or rerouted. No content from those refused targets is newly claimed. Use the already-inspected AppShell/AppNav/layout interfaces without modifying their underlying data/auth/origin implementations. Further global-search work is deferred rather than reconstructing an unknown search owner.

## Global constraints

- One existing native AppShell; no chart-shell nesting or chart-engine edits.
- Preview flag is server-evaluated, exact opt-in only, and restricted to /analysis and /discover. A flag changes presentation, not authorization.
- Default path/markup, route hrefs, symbol decoration, Macro return, identity subject, settings, onboarding and Brain singleton remain intact.
- Retain existing native TOP destinations during this first bridge. The final six-job global IA requires its separate source-derived Macro/native join; do not counterfeit it with a second handwritten catalogue.
- Existing MobileNav remains the responsive owner. No new mobile drawer, session store, auth bypass or fixture identity is introduced.
- Reuse globals.css token roles with a scoped stylesheet; no global token replacement. Labels use existing LEX English/Chinese tuples.
- Paper IS01/IS02/IS03 are design references, not evidence of code/browser acceptance. No fictitious market figures enter product code.
- No live/customer data writes. No production rollout, merge or release acceptance in this slice.

## Review focus

1. Absent, malformed or truthy-but-not-exact flag must leave the current shell unchanged.
2. Chart, admin, portfolio and similar-prefix routes must not enter the two-route preview.
3. Collapsing labels must preserve accessible link names, selected destination and keyboard access.
4. Mobile and 200%-text layouts must not inherit a desktop grid or conceal controls; inherited MobileNav limitations remain explicit.
5. Existing identity and native/Macro return interfaces must remain unchanged; no second auth request or user-state writer.

## Task 1 — Default-off scope and existing-navigation presentation

Files: new `terminal/lib/investorShellPreview.ts`; modify `terminal/components/AppNav.tsx`, `terminal/components/chrome/AppShell.tsx`, `terminal/app/(shell)/layout.tsx`, `terminal/lib/i18n.tsx`; tests `terminal/lib/__tests__/investorShellPreview.test.tsx`.

Interfaces: `isInvestorShellPreviewEnabled(value: unknown): boolean`; `isInvestorShellPreviewPath(pathname: string): boolean`; optional `investorShellPreview?: boolean` AppShell prop; optional `labelled?: boolean` and `id?: string` AppNav presentation props. Existing callers retain defaults.

- [ ] Write failing policy/render tests for exact flag, exact two-route scope, old default markup, route count/hrefs, visible EN/ZH labels and accessible compact names.
- [ ] Run the focused test and observe the missing-feature failure.
- [ ] Implement the minimal policy, server flag handoff and labelled existing AppNav; retain all current providers and effects.
- [ ] Verify focused tests and TypeScript; checkpoint the exact source delta.

## Task 2 — Scoped production-intent chrome

Files: new `terminal/components/chrome/investor-shell-preview.css`; existing AppShell/AppNav from Task 1. No edits to globals.css, Observatory, MobileNav or page bodies.

- [ ] Write failing assertions for labelled/compact state and default-off scoping.
- [ ] Add a 224px labelled desktop rail, 64px contextual bar, readable labels, visible focus, restrained selected/hover states and reduced-motion behavior.
- [ ] Keep <=860px layout and drawer with their current owners; preserve safe areas and do not introduce page-wide horizontal scroll.
- [ ] Verify desktop/tablet/mobile and EN/ZH/dark/light through actual browser evidence. Label source/component-only proof when a real-path prerequisite is unavailable.

## Task 3 — Retained Macro/native join and verification

- [ ] Reconcile the original Macro source lineage and its current ownership before touching its files.
- [ ] Use the existing emitted Macro-to-native URL and native return owner, not a new URL/state protocol.
- [ ] Verify one retained Macro overview -> native Analysis/Discover -> return journey with initial and failed/empty data states. Do not alter engines or introduce new auth/test-identity branches to make a demo pass.
- [ ] Run the full native suite and required responsive command; distinguish baseline failures from introduced failures, with exact names.
- [ ] Preserve code, tests, screenshots and receipts in the existing repository/PR owners. Keep release held for remaining integration, review and production-like preview evidence.

## Progress / recovery

Plan established before product source edits. Current production-code delta: none. No unresolved modifying effect. Next: consume baseline process 96988, write/observe failing Task 1 tests, then implement in this isolated branch. Do not reread denied targets, recreate Paper boards or rerun passed portfolio/engine acceptance programmes.

### First implementation checkpoint

- Clean native baseline: 478 files, 7,830 passed, 4 todo; process 96988 exited 0. Do not repeat unchanged baseline.
- New 31-case test reproduced missing preview behavior. One unsupported assertion matcher was corrected (no product change); clean RED was 15 failures / 16 passes, process 20988 exit 1. No production source preceded that clean RED.
- Implemented exact server opt-in, exact /analysis and /discover scope, optional labelled AppNav and compact toggle, scoped CSS, and EN/ZH labels. Existing TOP, href decoration, providers, account claims, MobileNav and Brain host remain their current owners.
- GREEN: all 31 focused cases passed (24404 exit 0); TypeScript passed (24678 exit 0). Component tests mock framework/auth boundaries and do not prove live auth, browser focus or real Macro return behavior.
- Full post-change native tests: process 35152, log native-shell-full.log. Full responsive command: process 34711, log native-shell-responsive.log; it enumerated 1,702 cases with two workers and warmed the real local routes successfully. Focused real-route shell browser proof: process 37144, log native-shell-browser.log, against the same owned fixture server at 127.0.0.1:3197. Do not launch another server/worktree or claim those unfinished runs passed.
- No production deploy, DNS, merge, flag enrollment, user-data or engine change. Actual production-like preview and Macro source join remain unfinished. All effects are observed; no unknown write.

### Verified source checkpoint / remaining integration

Task 1 is implemented and verified; Task 2's desktop and narrow-layout pieces are built, but its mobile dismissal acceptance is not complete. Task 3's actual Macro integration has not yet been performed.

Ruling: reuse the existing localized `scr2DenCompact` text and omit the nonessential preview badge. The initial two new LEX entries invalidated nine historical evidence assertions across eight suites. Removing only those new entries leaves `lib/i18n.tsx` byte-identical to base, without weakening any evidence test or relabelling old screenshots. The root `data-investor-shell=preview` remains the machine-readable preview marker. No new translation registry was created.

Final full native unit run: **479 files / 7,861 passed / 4 todo**, process 41428 exit 0. Focused browser run against real local routes: **9 passed / 4 failed / 2 skipped**, process 45285 exit 1. All four failures are the existing MobileNav Escape-dismissal defect (Analysis and Discover, tablet and mobile). Exact existing repair #697 at `0023bffa7c6c0370f15ec1e3a16398d82fe2cf33` explicitly documents that defect; it remains unmerged, and its #688/CI/release dependency is not bypassed here. Do not create another drawer or claim mobile acceptance.

The 1,702-case broad responsive run was intentionally stopped (34711 exit 143). Two test runners briefly shared the default output directory; none of the broad-run screenshots is accepted. The final focused run used its own output subtree and completed with the exact red/green totals above. No full responsive-suite pass is claimed. Both fixture server runs have ended; no worker or unattended continuation is pending.

Evidence: `terminal/docs/pr-crops/investor-shell-native-preview-20261008/receipt.json` binds seven source/test files and 14 screenshots (ten appearance, four failures) by SHA-256. The desktop Analysis capture was visually inspected: the labelled rail and retained local tabs are present; the fixture body truthfully reports missing fundamentals. This is not populated financial-data parity proof. Test-generated edits to two unrelated screenshot files in this isolated checkout were restored to exact base; primary/source-owner workspaces were not touched.

Next: commit/push this default-off source and evidence as a draft native companion to Macro #7949, then continue the source-derived retained Macro/native join. Do not mark Ready or merge while mobile #697 integration, real bridge proof, and protected hosted-preview qualification remain outstanding. The old original Macro worktree remains clean and locked; no custody transfer is inferred from these records.

### Retained Macro/native bridge — local proof complete

Exact Macro baked source `9b54c2d7...` and native product `0b3c2bed...` now pass a real desktop browser round trip: existing Macro CTA -> existing Terminal portal -> preview Analysis -> existing back action -> original mounted Macro page/hash and invoking-link focus. Final process 66303 exited 0, one test passed. The initial click-before-hydration test failure was resolved by awaiting the existing terminal visual-ready event; no product source changed. A 30-file / 2,100,208-byte bounded source fixture was materialized from Git because the original clean/locked sparse worktree lacked its baked HTML. Only the manifest, two captures, receipt and reproducible browser test are committed, not a duplicate source tree. All external and non-GET/HEAD browser requests are blocked. This is local compatibility proof, not production auth/data or a new iframe architecture.

Native #859 remains Draft/HOLD. Candidate mobile #697 has been read, not accepted/adopted. Before any next source integration: reconcile termination of owned local servers 52590/54901; inspect current exact #697 source and dependency compatibility. No edits or custody transfer on #697/#688 or original Macro writer are authorized by a local integration test.

### Test-only mobile dependency integration

Same-carrier merge-tree preflight combined native `02aebe793115f00e0b1690434c5c7133ef39ef0c` with existing mobile #697 `0023bffa7c6c0370f15ec1e3a16398d82fe2cf33`, yielding tree `298d5d0b33280ab29e91d18d7ce3b90659264922` with no conflicts. Exactly four #697 files differ, and each integrated blob is byte-identical to that original candidate. Current native base movement did not alter MobileNav.tsx.

This next action is a detached, LOCAL TEST ONLY combination, not source acceptance, publication of #697 through #859, a replacement repair, original-writer transfer, or a protected merge. The #859 source branch remains unchanged; #697/#688/CI/release gates stay intact. Existing tests are executed against the combined dependency so the shell owner has concrete compatibility evidence. No semantic edits to the imported repair are permitted. Both prior loopback servers 52590/54901 exited 0 before creating this test checkout.

### Mobile dependency result and stronger bridge evidence

Detached test-only combined commit `7fa9126511da7c0f3be3f1058c6f4380454b7eed` (tree `298d5d0b...`, parents #859 `02aebe79...` and #697 `0023bffa...`) passed **31 browser checks / 23 intentional project skips / zero failures**, full **479 files / 7,861 unit passes / 4 todo**, and TypeScript. The four inherited Escape failures are resolved by the exact existing mobile owner, without a competing fix. This is not an adoption or protected release of #697. Source remains held under its original #688/CI/deployment closure. The fixture logged Stripe.js load failures; payments were not exercised/qualified. Receipts and representative mobile/tablet images are saved in `mobile-dependency/`.

Visual inspection found the first bridge screenshot captured chrome before the streamed page body. The test was strengthened to await .main2 and Overview content, then passed once again (12424 exit 0) with no product-code change. Current bridge captures now include the real missing-fundamentals state; original chrome-only evidence remains historical. Sample data parity remains unproven. The unit-test mock types were made explicit; scoped ESLint and all 31 focused cases passed (99714 exit 0) without changing product behavior.

A production-mode compiler build of the native preview is now running under process 27708, output native-shell-production-build.log. It is compile qualification, not deployment. Do not claim its outcome until reconciled. Prior servers 52590/54901 ended 0; second Macro fixture server12073 was terminated after the strengthened bridge run. Current test-only detached worktree remains recoverable; no original or shared writer was changed.

Release-owner source review: issue #483 is closed, but its final comment 5896814530 accepts the narrower #771 pycache repair and explicitly leaves the deploy mutex separate. Do not treat that closed issue as full shared-shell or concurrency/rollback acceptance. Preview promotion needs current owner/configuration and exact accepted artifact proof, not that historical closed status.

### Production compiler blocker — narrow incumbent style repair

Production webpack compile failed at pre-existing SelectionCohortCard.module.css:33 (27708 exit 1), not at the new shell. The same invalid global-only selector exists at current master505edf7872541075b5eee24691703a46d1151074, blob9f087366551382adf3c4ef17812cceeea36db3e4, introduced in #837. A fresh path-specific open-PR census found no active candidate touching the card component/stylesheet. Two regression cases now fail (35319 exit1): the actual locked Next pure-mode transform rejects the module and the explicit global import is absent.

Repair scope is only this incumbent component style boundary: move the existing global masthead selector/declarations to an adjacent global stylesheet imported by SelectionCohortCard.tsx. Preserve the exact global class, overflow/z-index behavior, local selectors, markup, fetch/polling/data/assessment semantics and all controller owners. Do not bypass pure-mode checking or add :has/browser requirements; do not touch the refused Discover/origin/auth files. This small compile prerequisite is within the shell build outcome, not a new Prophet engine programme.

### Production and source gates after the compile repair

The invalid global-only cohort selector was moved unchanged into SelectionCohortCard.global.css and explicitly imported by its existing component. Two locked-Next pure-mode/source-boundary regressions went RED2 -> GREEN2. Full native tests pass **480 files / 7,863 passed / 4 todo** (39074 exit0); scoped ESLint passed (47368 exit0). Product webpack compilation now succeeds, but the full build remains red. Generated-route TypeScript (49555 exit2) confirms four invalid route exports: account/deletion LIFECYCLE_TABLE; alerts normalizeStoredAlert; sector-intelligence filteredSupabaseCookieHeader; v1/dislocations MAX_EPISODES. No API implementation was changed.

A bounded compound inspection of those API helper test-consumers and their open-PR ownership was safety-refused before dispatch. It is not retried/rerouted. That blocks this session from safely taking their source repair; it is not a general GitHub or repository outage. The original prior SearchModal/origin/Supabase/Discover source-inspection refusal also remains intact. Preserve data/auth/alerts owners and default-off scope.

A fresh port inspection found next-server PID49056 has cwd in the separate rotation-risk-confluence worktree, not this owned checkout. It was left untouched. Therefore earlier green browser totals cannot be promoted as exact-source acceptance. Both preview specs now refuse explicit preview qualification without CI, whose inherited Playwright configuration disables server reuse. Replacement runs use fresh ports and --retries=0. This is a genuine provenance invalidator, not a redundant rerun. Saved historical unit results remain valid.

### Current cumulative continuation boundary

FINALIZATION_CLASSIFICATION: ALL_SCOPED_LANES_BLOCKED for promotion of this bounded native-preview slice. PARENT_MISSION_COMPLETE: false. The full product-shell migration, final global IA/search, populated-data parity, hosted preview and rollout remain unfinished. This is not a completed product or a final architecture-wide rollout.

The current safe local implementation and compatibility proof are saved; further qualification/promotion needs the existing API-source owners and mobile-source acceptance. Production-generated TypeScript independently confirms all four route-export failures. The bounded owner/test-consumer inspection needed to make the API repair safely was refused before dispatch; do not retry or reroute it under unchanged conditions. No auth/deletion/alerts/cookie-header/dislocation source was modified. Source/default-off safeguards and the original #697/#688/CI/release gates are intact. There is no unattended child or claimed background continuation.

**Fresh replacement proof:** CI=1 enforces reuseExistingServer=false through the inherited Playwright config; both specs refuse explicit opt-in testing without it. Current primary source d1d09f374f9cb5dbbcf562a366db43ee3cce8819 on fresh port31991 produced 10 passes, four known inherited mobile failures and four project skips (63369 exit1), including the real Macro -> Terminal -> Analysis body -> same mounted Macro/hash/focus return. The detached exact dependency combination77ccc547ab4f3ce91b5782d9d485b684b8ba63d9/tree d77bf90017784cf78d785f3b32fb4cb599162fd2 (parents d1d09f37... and0023bffa...) used fresh port31993:31 passed/23 skipped/zero failed (64021 exit0). Its live next-server64093 cwd was independently verified to the owned detached checkout. All 480 unit files/7,863 cases passed on that exact combined tree (67588 exit0). The current native source passed scoped ESLint (72061 exit0).

All earlier reuse-enabled browser receipts are superseded for source acceptance. Current screenshots, source digests, commands and limits are under isolated/. Sample Stripe.js failures mean payments are not qualified. All three fresh-run ports31991/31992/31993 are closed; Macro fixture63131 was terminated after its test. Another worktree's server49056 on3197 was not killed or changed. No ambiguous write remains.

**Next action:** complete the four API export-boundary repairs through their existing owners after the inspection/admission lane is available; consume the exact #697 dependency through its existing release sequence; run an exact-source production build and complete responsive/access checks, then qualify a protected hosted preview and rollback. No new route catalogue, auth/state store, engine, retry plane, worker or watcher is needed. Current repo base f03aa5d... is preserved; master505edf78... introduced an unrelated event-impact fix, not clearance of these build gaps. Keep #859 and Macro#7949 Draft/HOLD. Do not repeat census, baseline tests, or old failed/reuse-enabled browser runs absent a material invalidator.
