# CMX A3b implementation plan

Execution: direct on retained #740 worktree; use test-driven development and executing-plans. No eligible reviewer is needed under the Chairman waiver; direct narrow implementation uses LOWER_TOTAL_OVERHEAD and no admitted worker is displaced.
Goal: expose bounded, pointer-linked native observations on the existing runnable A3 consumer.
Architecture: one projection over nativeSuiteSnapshot, not another computation or state owner.
Spec: docs/superpowers/specs/2026-09-24-cmx-a3b-compact-native-observation.md.
Tech: existing TypeScript/Node/esbuild/Vitest; no new dependencies.

## Global constraints
Retain all A3 restrictions; 12 KiB JSON view; no new data/model/network access; no source-custody change; no retry of denied Macro reads. Native labels/scores are evidence, not instructions/trade authority.

## Review focus
Confirmation order versus geometric anchor; absent/null last samples; negative oscillator coordinates versus prices; whole-fact byte omissions; module locks versus no setup; table footnotes and full artifact identity.

## Task 1: compact projection
Create ingest/native_suite_observation.ts; test terminal/lib/__tests__/nativeSuiteObservation.test.ts.
Consumes nativeSuiteSnapshot(request: unknown, host: unknown) and its output. Produces nativeSuiteObservation(request: unknown, host: unknown), observed compact output or typed refusal.
- [x] Write and execute failing real-kernel and edge-case tests.
- [x] Implement deterministic bounded projection, exact source references, coverage counts and retained limitations.
- [x] Run focused tests and semantic typecheck.

## Task 2: real one-shot consumer
Modify ingest/native_suite_snapshot_cli.ts and terminal/lib/__tests__/nativeSuiteSnapshotCli.test.ts; imported observation module belongs to the existing Node tsconfig graph.
- [x] Test --view compact missing behavior RED before changing CLI.
- [x] Add closed option parsing without changing full default or tier authority.
- [x] Run actual executable modes, identity/pointer checks and fresh-process reproducibility.
- [x] Update ingest/NATIVE_SUITE_SNAPSHOT.md with supported use and limitations.

## Task 3: scrutiny, evidence and publication
- [x] Run exact all-five-suite recorded-input comparison and retain compact/full sizes, source/content hashes and outcomes.
- [x] Run both semantic typechecks, full unit tests, diff checks and current source compatibility.
- [ ] Publish same branch/PR once; verify remote head; update existing cumulative checkpoint.
Backend wire repair, ACK/origin closure and production Brain/Fabric enrollment remain incomplete; never claim them from this view.

Actual pre-publication verification:26 projection/16 executable tests;386 files6227 passed/fourTODO; both typechecks pass. Recorded full/compact evidence in docs/research/cmx_a3b_compact_observation/.
