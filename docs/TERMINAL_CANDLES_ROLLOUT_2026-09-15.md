# Mastermind Candles rollout and continuation

## Current direction and authority
Chairman Chris explicitly requested the rename and default-on for new AND existing users,
with subsequent removal respected. He then authorized the Terminal Visual Intelligence Layer
end to end in the same live conversation. Sol owns implementation, integration and acceptance.
Procedure pin: Mastermind 19b6111891ffd742ceec7c96f437a2a890847c92, skillpack 1.0.1.
Implementation authority is this repository, not old local deployment-memory prose.

## Rollout contract
Keep suite:trend/cp and the existing mm.inds/mm.indParams/mm.indHidden owner. A browser gets
one migration, marked mm.mastermindCandles.v1 after its data writes. A later removal or hide
must persist. Enable no sibling module for an inactive parent; preserve active siblings and
translate legacy whole-suite hiding to individual sibling eyes. Preserve customized mode.
The default candle-only carrier does not consume an anonymous study slot. No tier is bypassed.
No OHLC, candle calculation, forecast, alert, or trading authority changes in this slice.

## Verified at repair pass (2026-09-15)
- TypeScript: pass.
- Migration and suite tests: 276 passed, including six red-first malformed/visibility cases.
- Full Terminal unit suite: 326 files, 5412 passed, four existing todos.
- Targeted real-browser matrix: 41 passed, 13 existing project skips; desktop, tablet, mobile.
  Files: indicator-guides, suite-lazy-compute, visual-ready-default, layout-integrity.
- No production acceptance yet. PR #589 remains the only candle-rollout carrier.

## Findings resolved
The first hosted run exposed obsolete fixture assumptions: a post-rollout opt-out needs its
migration receipt; a first-visit readiness assertion includes trend; an already-active focused
preset is Current, not Add; suite params are flat and do not inherit classic-only _vis.
Tests retain those behaviors rather than skipping their assertions. A real migration defect
also revealed hidden siblings and a manual anonymous-add path counted the ambient carrier.
Both were repaired with discriminating tests and the existing cap/persistence machinery.

## Base receipt repair
Master #565 was squashed; b-f12-9's capturedAtHead still named its pre-squash efdbf23 commit.
All five recorded layoutFiles hashes were independently compared to protected master
1aca671d93c965a7cc9c3a92c5d28b1ae836ee77 and the working files: all byte-identical.
Only the pointer and an explanatory comment change. Capture time, PNGs, hashes, measurements,
team code and validation remain untouched. This is source-equivalence, NOT fresh browser proof.

## Exact continuation
Finish #589's required hosted checks, review exact head and fresh base, merge through the
protected branch, run the git-gated VPS deployment, and prove new/existing/removal behavior
on production. The next separate capability is explainable chart context, using the same candle
math and existing chart preferences, rendering, event data, snapshot and analytics consumers.
Do not recreate #589, reset a shared checkout, or claim the larger layer shipped from this PR.
