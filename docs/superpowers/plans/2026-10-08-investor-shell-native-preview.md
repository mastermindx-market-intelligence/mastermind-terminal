# Investor Shell Native Preview Implementation Plan

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
