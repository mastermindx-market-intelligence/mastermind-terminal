<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:mastermind-agent-laws (added 2026-07-23 after the onboarding-flow postmortem) -->
# Mastermind Terminal — agent laws

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
Builders preserve the supplied reading contract; an incomplete or contradictory spec
returns to its design owner rather than becoming an improvised card wall. Reviewers
separate rendered output, design critique, actual human testing and real journey proof.
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
- A user-facing flow is NOT done until a fresh incognito end-to-end pass succeeds with zero manual workarounds — no reload-to-recover. If you hit a race and work around it, the bug is yours to fix, not to route around.
- Every UI PR carries its verification artifact in the body: screenshots/crops of each step and state (light + dark + zh via the LEX i18n tuples — zh strings must never leak into the EN view, and vice versa).
- A spawned child builder does not self-merge a flagship first pass; it returns the PR and artifacts to the commissioning main session. The main session reviews them and completes the merge plus git-gated live deployment in the same task unless the operator explicitly requests a hold or a genuine check is red.
- The operator's standing authorization (2026-07-30) is to commit, push, open a PR, wait for CI, merge to `master`, run the git-gated VPS deployment, and verify live without waiting for a separate deployment request. If blocked, preserve the work in a pushed remote branch before reporting the blocker; never leave completed work only in a session.
- A ready, non-draft PR must carry `merge-on-green` and be armed with `gh pr merge --auto --squash --delete-branch`. `master` protects the exact 3/3 CI contexts, so native auto-merge is the server-side fast path; the controller is the fail-closed orphan fallback (current-master ancestry, same-repo head, no hold/conflict, SHA-pinned squash). Neither path permits the commissioning session to skip deployment and live verification. Never use an admin bypass.

## Repo facts
Next.js 16 + Supabase; entitlements authority = macro-api (`profiles.is_pro` is a UI hint only); i18n via LEX `[en, zh]` tuples in `lib/i18n.tsx`; tests = vitest, golden fixtures in `lib/__tests__/fixtures/`. The main checkout is often on another agent's branch — ALWAYS `git worktree add` off `origin/master`; never touch the main checkout's git state.

## Agent OS (organizational memory)
Durable org memory — workstreams `WS-*`, decisions `DEC-*`, discoveries `DSC-*`, session handoffs — lives in the Macro repo's `agentos/` (`/Users/chriswong/Documents/Cluade/Macro Dashboard`; rules: `agentos/README.md` there). A task on an existing Mastermind workstream starts by reading its `WS-*` record and latest handoff; `do_not_redo` is binding unless refuted with new evidence. Durable choices, verified non-obvious facts, and transfers of claimed work get a `DEC-*`/`DSC-*`/handoff record via a normal Macro PR — chat memory is not company memory. Knowledge plane only: nothing in it gates execution, ranks priorities, or proves liveness, and no Terminal-local copy of the store may exist. Full section: root `AGENTS.md` § "Agent OS knowledge plane".

## Responsive product contract
- This directory is one responsive Next.js application. Desktop, tablet, and mobile share routes,
  data fetching, chart logic, indicator logic, and settings; breakpoint-specific chrome is allowed,
  a separate mobile implementation is not.
- A user-facing change is incomplete until `npm run test:e2e:responsive` passes at the repository's
  three contract viewports (1440×900, 820×1180, 390×844). Preserve safe-area handling, mobile
  navigation/sheets, usable touch targets, and zero horizontal document overflow.
- Never target the retired `feat/mobile-terminal-redesign` branch or `charting-app-mobile`
  worktree. They are historical recovery references only; canonical work starts from
  `origin/master`.
<!-- END:mastermind-agent-laws -->
