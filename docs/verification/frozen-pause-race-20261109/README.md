# Prepared-intent owner-pause race qualification

This follow-up repairs the test oracle exposed by PR #973's merge-group PostgreSQL failure. It changes one test file and retains SQL, publisher, delivery, rearm and fence behavior unchanged.

## Exact tested input

The owned checkout was based on protected commit `f57c6c7f4b601999a7e1c3dde29d6687bb473f10`. Before the green runs, its only modified tracked source was `tests/test_alerts_frozen_hit_postgres.py`, SHA-256 `db7ae7163a384a37da25ba664b1a8cebc1d39d3c7cf4f70398a68399fd2d98df`. The publication commit must contain these exact bytes. The initial RED used the unchanged protected test/publisher/SQL source plus the separately retained `baseline_repro.py` diagnostic.

## Real database results

- PostgreSQL 17.11 ran in disposable private Unix-socket fixtures with TCP listening disabled. No configured or production database was used.
- Deterministic baseline RED: after a real prepare acknowledgement, an authenticated owner pause completed, then one real commit RPC returned `unavailable / inactive`. The exact full prepared row remained, with the correct principal, alert, event, channel and entire payload; no webhook existed. The old `(0, 0)` assertion then failed against actual `(1, 0)`.
- Focused green: **5 passed, 0 skipped**, covering the existing pause/rearm race plus forced pause-before-prepare, prepare-pause-commit and commit-before-pause orderings.
- Existing nine-file CI PostgreSQL pytest batch: **244 passed, 8 skipped**, with no failures or errors. All fixture servers stopped after execution.

The eight existing skips require an explicit Macro source fixture for the actual two-repository run/drain composition. They are not claimed as passing coverage. The separate drawing-audit command was not rerun because this repair changes no drawing or SQL source.

## Preserved contract

The race assertion accepts an inactive refusal with either no intent or precisely the expected prepared intent. It rejects a pending undelivered row, unrelated or extra rows, mismatched bindings, a changed payload, and an unexpected refusal. A committed result must have the exact pending intent and matching webhook event. Rearm retains its existing exclusion assertion.

The deterministic gate runs only after the actual prepare RPC returns, when its transaction has released database locks. It neither fabricates an acknowledgement nor changes publication behavior. RPC modes verify one prepare attempt and, when appropriate, one commit attempt; no retry, automatic fence or replacement event is introduced.

Raw baseline and green logs, JUnit results, complete baseline observation, source receipts and fixture-stop results accompany this file. These are local fixture proofs; source merge, deployment and production acceptance remain separate.
