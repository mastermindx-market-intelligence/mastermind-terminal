# Mastermind fast-delivery policy — risk beats PR size

**Scope:** Terminal pilot in the existing GitHub CI and merge controller. Expanding to Macro, Mastermind Executive or Agent OS requires those repositories' own reviewed source/protection change. This document is an implementation proposal until merged and its live behavior is verified.

## Why

PR #1238 changed a tiny Prophet marker on a very large `ChartPanel.tsx`. CI still ran 12 responsive E2E shards and three required protected checks; a whole-file Visual Intelligence source-hash pin triggered a 30-case recapture plus four ChartChrome captures. Those mechanisms were doing what they were designed to do, but the work was disproportionate to the user change. The bottleneck was **coarse verification scope**, not a lack of reviewer capacity.

**Goal:** low-risk cosmetic changes ship quickly, with no per-change independent human/Fabric/Dot review and no blanket E2E suite, while executable and consequential changes keep the checks that can catch their failures. GitHub remains the source/release authority; there is no new review runner, status publisher, background queue, identity or merge plane.

## Proposed risk classes

| Tier | Example | Testing and review | Merge and release |
|---|---|---|---|
| **T0 · static micro** | bounded isolated product copy, a standalone SVG/PNG icon under a safe asset directory | trusted base-version diff classifier, safe asset validation, no independent reviewer, no heavy test suite | existing protected PR + native squash auto-merge after the three **lightweight** required status contexts; deploy and check the user-facing change |
| **T1 · cosmetic UI code** | isolated style tokens, a presentation-only component, bounded layout adjustments | targeted typecheck/lint, one or two real browser smoke views; no mandatory independent reviewer when deterministic change isolation passes | same merge-on-green, limited test scope, then browser verification |
| **T2 · ordinary behavior** | routine frontend/backend fixes outside sensitive contracts | affected unit/integration tests; author code review; asynchronous sampling/challenge rather than mandatory per-PR independent review | normal protected checks with targeted suites; canary/rollback according to consumer |
| **T3 · sensitive/critical** | auth, permissions, billing, trading/risk/Prophet signal semantics, order authority, DB migrations, data publication, deployment tooling, control/agent lifecycle, security, CI/reviewer/branch-protection policy | full relevant integration/security/production-path suite plus genuine independent non-author review | normal protected gate, exact-head review, and real-path production acceptance |

**Priority order:** the highest material risk of any changed file wins; no label or author assertion can lower the calculated tier. Never classify on number of changed lines alone. A one-line auth/SQL/indicator change is not T0. If the code cannot prove an inert boundary, it stays full. A test failure, conflict, changed head, failed classifier, unknown baseline, fork, rename, deletion, symlink, protected-doc change, or excessive diff never converts into a green fast result.

### Working pilot implemented in this PR

Only **T0** is currently executable. `scripts/ci_fast_lane.py` is a pure bounded static change validator. It accepts at most six files and 80 changed text lines, only under `terminal/public/{icons,brand-icons}/` (SVG/PNG/JPG/WEBP) and designated product-copy directories `terminal/docs/ux-notes/` / `docs/product-previews/`. Files must be regular Git blobs and meet size, type, and inert SVG-content rules. Changes to `ChartPanel.tsx`, CSS, executable code, workflow files, source law, tests, and all unrecognised paths remain **FULL**.

`.github/workflows/ci.yml` reads the classifier **from the protected base commit (HEAD^1)**, not the proposed changes. This CI-policy PR itself therefore runs the **existing full suite**, never its own new fast path. For future eligible T0 PRs, the existing `Quote Hub tests`, `Terminal typecheck + tests`, and `Ingest + signal-layer tests` status names remain intact; each completes with a transparent static-only notice instead of running unrelated packages or the 12 E2E shards. The Terminal aggregator demands successful classification and both full-suite jobs explicitly marked `skipped`. Merge-group, manual dispatch, and fork events always take full CI. The existing merge-on-green controller and branch protection are **unchanged**.

This is a fast **minimal trusted CI gate**, not zero GitHub Actions execution. Removing even those protected statuses would require a deliberate repository rules change and would undermine the fail-closed release path; that is not recommended.

### What makes another tiny icon edit fast

The Prophet icon in PR #1238 is inline inside the executable `ChartPanel.tsx`; it does **not** qualify for this T0 pilot. For future icon iterations, extract purely static path/color/radius geometry into a validated SVG asset or constrained presentational module. Its one-time renderer-integration PR takes normal tests; subsequent tiny art-only revisions become T0 and require no recapture of unrelated chart-context surfaces. This also makes visual review faster than asking an independent model to inspect an entire chart renderer.

Next, implement **T1** with an explicitly reviewed isolated UI-only source surface and a narrow, auditable AST/semantic diff contract. Do not accept arbitrary `.tsx` or `.css` files into T1 by extension alone, especially chart, options, account, risk and shared-shell code. For a genuine small layout tweak, run a small browser check against actual affected viewport states rather than all 12 unrelated Playwright shards.

## Eliminate the visual evidence source-hash tax

Do not drop screenshot integrity verification. Instead:
1. Split static visual primitives from large chart/application state owners.
2. Tie retained visual-evidence source locks to the **actual render dependency closure**, not the hash of a 5,000-line monolith.
3. Give marker geometry its own focused browser or SVG witness; recapture only impacted screen states when that witness changes.
4. Preserve old capture identities and require actual new screenshot bytes when a relevant state changes; never just overwrite the expected hash to green a stale test.
5. Keep whole responsive E2E for cross-page navigation, chart architecture, locale/accessibility contracts, and risky integrated behavior.

## Operational release contract

The actual behavior is governed by the protected branch and current accepted source law. This proposal does not self-approve its own policy change. After an eligible low-risk classification has been adopted into accepted repository instructions, there should be **no Fabric or Dot review request** for a T0/T1 cosmetic edit. An agent should implement/test/push a small scoped PR, receive the trusted fast check, arm native auto-merge under existing permissions and release the merged commit by the git-gated deploy. A genuine red check or hold remains blocking. No privileged direct-to-master bypass, no mock approval, no duplicate status checks and no deployment from PR head.

A T3 change still requires the canonical non-author source/architecture review and the correct full CI/security/production proof. Post-merge sampling of T0/T1 can find drift, but must not be represented as a prior formal approval.

## Rollout, measurement and safeguards

1. **Pilot T0 in Terminal** on a real small safe SVG or product-copy PR after this governance/CI change has itself passed the full checks and required independent review. Verify the three trusted context results, the absence of E2E shards, and an actual protected squash merge. Verify deploy and end-user path independently.
2. **Pilot T1 on isolated UI primitives.** Measure real lead time and check that a deliberate executable/dangerous diff is classified FULL. Add a dedicated compact browser test for visual surfaces instead of weakening broad tests.
3. **Expand to Macro/Mastermind** with repository-specific sensitive paths, GitHub rules, tests and source-law changes. No cross-repo script push or generic blanket policy label.
4. Record run metadata from GitHub's existing checks and PRs. Compare p50/p95 PR-to-green, PR-to-merge, number of runners/jobs/minutes, false fast classifications, rollback/escaped regressions, and blocked-release count. Targets to validate, **not measurements**: under three minutes of actual test execution for T0 and under ten minutes for T1, excluding third-party runner queue and deployment time.

**Rollback:** revert the fast-route workflow change through normal protected GitHub publication, or change the trusted classifier to FULL-only and publish that through protected source. Until then every unrecognised diff remains full. No new override/retry/control plane is introduced.

## Implementation anchors

- CI: `.github/workflows/ci.yml` (classification and required contexts)
- Pure policy: `scripts/ci_fast_lane.py` (always loaded from trusted base)
- Adversarial / workflow contract: `tests/test_ci_fast_lane.py`
- Existing release owner: `scripts/merge_on_green.py` (no change)
- Existing release and agent instructions: `AGENTS.md`, `terminal/AGENTS.md`
- Source for initial workload diagnosis: Terminal PR #1238, CI runs 41549617351 and 41589937389, exact evidence under `terminal/docs/verification/prophet-marker-20261102/`
