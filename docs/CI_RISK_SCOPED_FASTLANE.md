# Terminal CI risk-scoped fast lane

Status: source candidate, not installed until the reviewed source is on protected
master and actual GitHub PR proof demonstrates all required contexts.

## Observed bottleneck

A successful Terminal pull-request workflow run **41726143776**, created
2026-11-03T21:55:22Z and completed 22:53:32Z, took nearly **58 minutes**.
Measured E2E shard durations, including setup: tablet-3 3,481 seconds,
desktop-1 3,292 seconds, tablet-1 3,017 seconds, mobile-2 2,957 seconds,
tablet-2 2,811 seconds and desktop-4 2,453 seconds. The unit + mock evidence
capture job lasted 1,373 seconds; ingest/signal tests lasted 771 seconds.
Every PR, including passive evidence or CSS-only ones, paid for these jobs.

Master's actual protection requires three stable contexts: `Quote Hub tests`,
`Terminal typecheck + tests` and `Ingest + signal-layer tests`. The separate
Terminal merge-queue ruleset #24411653 is `evaluate`, **not an active gate**.
Therefore this policy does NOT pretend every short PR will receive the complete
matrix again before merge. Shortening verification is a deliberate risk-tier
tradeoff, authorized for bounded passive and visual changes only. Behavioral
changes keep full E2E on the PR that is actually being released.

## Source qualification

The new `pr_scope` job extracts `scripts/ci_terminal_pr_scope.py` from the
**PR's protected base commit**, never from the candidate checkout. It verifies
GitHub event identity, same-repo PR, full immutable base/head Git diff,
complete status and numstat coverage, at most 12 files / 200 changed lines,
regular non-executable Git blob modes, no renames/deletes/symlinks/submodules,
and exact allowlisted source paths. A missing or invalid source falls back to
`mode=full`. The first PR installing the selector therefore takes full CI.

- `passive`: only user evidence in `docs/pr-crops/` and
  `terminal/docs/pr-crops/` (images, passive markdown/JSON/notes). Keep Hub,
  Terminal typecheck/unit + plain-language/quarantine checks. Skip unrelated
  screenshot replay, full Playwright matrix, PostgreSQL and ingest test suites.
- `visual`: only bounded static CSS in `terminal/app/` or
  `terminal/styles/`, possibly with passive evidence. Forbid new `@import`,
  `url(`, `expression(` in changed CSS. Same quick unit/typecheck path,
  **plus a real Playwright canonical-shell test on all three contract viewports**
  (desktop, tablet, mobile). This is not fake screenshot validation.
- `full`: all application behavior, backend, signal calculations, native
  integration, auth, GitHub workflows, source authority docs, test code,
  Playwright configuration, unknown source and any other change, plus every
  `merge_group` and `workflow_dispatch`: full original responsive E2E
  desktop 5 + tablet 3 + mobile 3 + serial chain, mock evidence captures,
  hub/ingest/PostgreSQL and remaining tests.

The stable required `Terminal typecheck + tests` job uses a strict
`always()` fan-in of `pr_scope`, `pr_visual_smoke`, `terminal-unit` and
`terminal-e2e`. It returns success only if:
1. passive PR: trusted scope success, unit success, visual and full E2E skipped;
2. visual PR: trusted scope success, unit success, visual smoke success,
   full E2E skipped;
3. full PR: trusted scope success, unit and all full E2E shards success;
4. merge-group/manual dispatch: scope and visual intentionally skipped,
   unit and all full E2E shards successful.

`Ingest + signal-layer tests` remains a successful required status for
passive/visual because those paths contain **no executable ingest/contract
changes**, verified by the protected-base qualifier. Other PRs run its unchanged
normal test suites. Quote Hub runs on every PR. No new required check, merge
queue, credential or review approval plane.

## Qualification and rollout proof

- Locally run `tests/test_ci_terminal_pr_scope.py`,
  `tests/test_ci_terminal_fastlane_workflow.py`,
  `tests/test_ci_e2e_shards.py`, `tests/test_merge_on_green.py` and relevant
  existing CI/queue tests.
- New branch changes CI authority; it must complete original full hosted
  E2E once (base lacks the selector). Only then can it be released through
  the existing protected three-context merge-on-green procedure.
- After landing, a passive evidence-only canary must show stable required
  3/3 checks and no full E2E jobs; a CSS-only canary must show the three
  real responsive smoke cases and no full matrix; a behavioral source canary
  must still show the complete matrix and all shard-cover tests.
- Failures/refusals, missing base selector or unqualified source must not
  yield a short-path green. If this cannot be proven, keep the rollout held.
- Measure before/after PR elapsed wall time, runner-minutes and relevant
  escape defects over a meaningful sample. Expected routine evidence PRs
  move from roughly 58m to a few minutes, but **no production speedup is
  claimed before actual hosted canaries**.

A short PR CI path does not certify production behavior, grant self-merge,
or bypass an actual security, approval or deployment hold. Application-flow
change still requires the exact responsive/incognito and git-gated live path.
