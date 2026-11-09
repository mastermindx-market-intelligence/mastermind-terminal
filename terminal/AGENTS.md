<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:mastermind-agent-laws (added 2026-07-23 after the onboarding-flow postmortem) -->
# Mastermind Terminal — agent laws

## Review without another session

Use the root [session-owned review rule](../AGENTS.md#session-owned-prsource-review-chairman-2026-11-03). For assigned attended CEO Web source work, **FAST, STANDARD, and CRITICAL each have no blanket independent reviewer requirement**: self-check the immutable diff, run focused tests and required CI, and prove the relevant security and real user path. Neither ordinary executable/non-T0 source nor an elevated tier alone creates a reviewer Job, separate ChatGPT chat, Fabric commission, native child or new formal GitHub approval. Only actual native GitHub/CODEOWNERS requirements, explicit security/release holds or a separately authorized manual review request can require external review. Preserve the distinct default-OFF signed automatic GitHub/Executive machine reviewer policy; no attended-Web waiver authorizes machine review bypass.

Mastermind #2018/#2026/#2030 and Terminal #1251 have their own protected and installed acceptance gates: do not assume a proposed PR is live, and do not treat an author's `routine` label or T0 classifier as GitHub authorization. Codex/Claude builders should likewise finish assigned work within their session, without another top-level chat; apply any actually binding technical/native review gate. If distinct scrutiny is truly owed, use a read-only, independently qualified in-session native Codex/Claude/Web child or admitted Fabric, verify exact head and findings, and adjudicate in the parent. `SELF_REVIEWED` is not independent proof and a child is not GitHub non-author `APPROVED`. No account switching, denied/EFFECT_UNKNOWN reroute, self-approval, self-merge, CI weakening or held-release shortcut.


## Original-PR delivery ownership

This application session must complete the existing PR's verification and authorized release path; a source commit, Draft, PR, CI wait or review request is not a terminal result. Repair CI on its original carrier, make stable PRs Ready, meet actual formal approval/hold checks, and verify final merge and required responsive/browser proof. See the root [finish-to-release rule](../AGENTS.md#finish-the-existing-release-not-the-draft). Do not invent review recipients or bypass protected merge.

## Model routing
Opus builds and reviews code. Design choices are judgment work — made in the session's main loop (or an Opus designer agent), never delegated to Sonnet; builders only implement fully-specified designs (exact markup/classes handed to them). Sonnet = mechanical non-code sweeps only; Haiku = trivial extraction.

## Human-first design, mockup and build contract

Read root `AGENTS.md` §Human-first product acceptance and the shared Macro
`docs/DESIGN_DOCTRINE.md` plus `research/MASTER_PRODUCT_DESIGN_SYSTEM_V1.md` before
user-facing work. Pin the accepted source revision; do not treat a candidate PR as law.
This is the same doctrine, not a Terminal-local copy or a new design system.

The primary viewport must orient the intended user to the subject, main assessment
and useful next step in 3–4 seconds, with important limitations visible. Do not make
the reader synthesize scattered panels or decode raw internal fields. Descriptions
and subtext are optional. Preserve analytical depth, dense grids and evidence through
coherent disclosure and navigation, including a reliable return to the prior selection.
Builders preserve the supplied reading contract. The assigned session resolves an
incomplete or contradictory spec against accepted source and current Chairman intent
before implementation; it does not improvise a card wall or wait for an archived owner.
Reviewers separate rendered output, design critique, actual human testing and real journey proof.
Missing human evidence is not yet tested, not a pass or a block on independent work.

This adds human-consumption requirements to the 2026-08-02 design direction below;
it does not reinstate the rescinded locked-layout rule. Use Terminal's current tokens,
primitives and shared shell. Do not transplant Macro's theme.css, invent trade authority,
or weaken source, rights, privacy or release boundaries.

## Design direction (user-facing surfaces)
- **OPERATOR RESCISSION 2026-08-02:** the former "design system is REAL and locked /
  house idiom wins" law and the former "paraphrase only — never copy their copy"
  competitor-audit law are RESCINDED by operator directive. Do NOT re-add them from
  older docs, audits, or session memory. The standing direction is the opposite:
  competitor layout, structure, IA, and feature sets are explicit build targets —
  the options suite in particular is being built to **full feature parity with
  QuantData, structured to be better than theirs in every regard** (program of
  record: `docs/QUANTDATA_PARITY_HANDOFF_2026-08-02.md`).
- `app/globals.css` (Terminal v5) + `app/observatory.css` remain the shared token/
  primitive base — reuse its tokens and primitives so surfaces stay coherent and
  east-flip/zh-safe, but layout and structure follow the product target, not a
  house idiom.
- Only competitor *logos and brand marks* stay out of the product (operator call,
  2026-08-02). Text, assets, layout, structure: fair game.
- Reference images must be actual files (committed under `design_refs/` or given as absolute paths). If a brief describes a look only in words, STOP and ask for the files before designing.
- Pin the design (exact markup/CSS) before fanning out any builder agents.

## Chart law (hand-rolled SVG)
Every inline SVG data chart MUST build on `components/charts/svgChart.ts` (useChartWidth,
niceTicks, padDomain, thinByPixelGap). Concretely: 1:1 pixel-space viewBox from a measured
container — never `preserveAspectRatio="none"` on a data chart (it distorts strokes) and never
a fixed-unit viewBox that caps the plot; domains take finite/positive-filtered values with
padding, zero unioned only when the series straddles it; axis labels thin by PIXEL GAP at
their mapped positions (never `i % n` on a value-mapped axis); tick formatting derives
precision from the step so two ticks can't render identically. The v7b wave fixed five charts
that each violated several of these — do not hand-roll a sixth way.

## Verification law (what "done" means)
- Scope verification by changed behavior, blast radius and actual risk. Localized visual-only work needs relevant type/static/unit checks and one affected-viewport crop; interactive UI requires a targeted browser interaction at the affected contract viewport and a desktop non-regression smoke. Include tablet when shared layout changes. Never accept a reload-to-recover workaround as a pass: a reproduced race must be repaired.
- Auth/session paths require a fresh authenticated/incognito journey; unrelated cosmetic edits do not. Shared-shell/navigation/global CSS, critical market data, finance/execution, permissions/security, CI and unknown impact retain the relevant full responsive regression and real source/consumer proof. Screenshots document only changed states. EN/ZH crops are needed when localized strings change; do not require an unsupported light theme. Existing accessibility and source-truth invariants remain enforced.
- A spawned child builder does not self-merge a flagship first pass; it returns the PR and artifacts to the commissioning main session. The main session reviews them and completes the merge plus git-gated live deployment in the same task unless the operator explicitly requests a hold or a genuine check is red.
- The operator's standing authorization (2026-07-30) is to commit, push, open a PR, qualify CI and required review, merge to `master`, run the git-gated VPS deployment, and verify live without a separate deployment request. A CI/review/deployment hold stops that release effect, not the whole assigned session: complete the next genuinely independent authorized source, test, integration or browser-proof action. An issue, reviewer request, green local tests or blocker report is not completion. Preserve finished source on the original managed branch through its authorized publisher when available. A refused commit/push is held on its exact original operation, not a reason to create a replacement branch or change tools/accounts; preserve local custody, never retry an explicit safety/permission denial, reconcile EFFECT_UNKNOWN on the same carrier, and continue other independent permitted work. Do not claim a pushed remote branch when publication did not occur; retain the exact recovery action.
- A ready, non-draft PR must carry `merge-on-green` and be armed with `gh pr merge <PR> --repo mastermindx-market-intelligence/mastermind-terminal --auto --squash --match-head-commit <CURRENT_40_HEX_HEAD>`. GitHub merge queues reject `--delete-branch` during enrollment; branch cleanup is optional only after verifying the actual merge. `master` protects all three checks and native merge_group. The controller remains a fail-closed orphan fallback. Neither route skips deployment or live verification. Never use an admin bypass.
- A source-complete, non-held Ready PR may arm native auto-merge while required CI is pending when actual enforcement, source custody, conflicts and binding approvals are qualified. Pending is never PASS; GitHub controls the eventual merge. Never arm a known-red, Draft, conflicting, held, incomplete or enforcement-unknown PR.

## Repo facts
Next.js 16 + Supabase; entitlements authority = macro-api (`profiles.is_pro` is a UI hint only); i18n via LEX `[en, zh]` tuples in `lib/i18n.tsx`; tests = vitest, golden fixtures in `lib/__tests__/fixtures/`. The main checkout is often on another agent's branch — never touch its git state. For host-local edits, attended Web/Studio sessions must reuse or acquire the one operation-bound managed workspace through the installed `mmx-workspace` owner; approved native/harness sessions use their assigned workspace/launcher. Independently authorized GitHub-native file/branch editing does not require an M2 worktree and preserves exact blob/head preimages on its original carrier. Never switch carriers to bypass a refusal, active writer, hold or EFFECT_UNKNOWN. Do not create a second worktree to route around an existing writer, release hold, denied operation or uncertain effect.

## Agent OS (organizational memory)
Durable org memory — workstreams `WS-*`, decisions `DEC-*`, discoveries `DSC-*`, session handoffs — lives in the Macro repo's `agentos/` (`/Users/chriswong/Documents/Cluade/Macro Dashboard`; rules: `agentos/README.md` there). A task on an existing Mastermind workstream starts by reading its `WS-*` record and latest handoff; `do_not_redo` is binding unless refuted with new evidence. Durable choices, verified non-obvious facts, and transfers of claimed work get a `DEC-*`/`DSC-*`/handoff record via a normal Macro PR — chat memory is not company memory. Knowledge plane only: nothing in it gates execution, ranks priorities, or proves liveness, and no Terminal-local copy of the store may exist. Full section: root `AGENTS.md` § "Agent OS knowledge plane".

## Responsive product contract
- This directory is one responsive Next.js application. Desktop, tablet, and mobile share routes,
  data fetching, chart logic, indicator logic, and settings; breakpoint-specific chrome is allowed,
  a separate mobile implementation is not.
- Use `npm run test:e2e:responsive` with the relevant configured project and affected specs
  for localized changes; the protected-base CI selector admits only strictly enumerated Screener
  presentation/test paths to the focused desktop/mobile subset. Run the full desktop/tablet/mobile
  matrix for shared layout, auth, critical data, elevated risk, unknown paths and merge_group.
  Preserve safe areas, mobile navigation/sheets, touch targets and zero horizontal overflow.
  Narrow source qualification is not a claim of deployed responsive acceptance.
- Never target the retired `feat/mobile-terminal-redesign` branch or `charting-app-mobile`
  worktree. They are historical recovery references only; canonical work starts from
  `origin/master`.
<!-- END:mastermind-agent-laws -->
