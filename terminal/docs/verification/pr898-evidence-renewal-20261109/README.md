# PR #898: complete batch-3 evidence renewal

This repair composes original branch `claude/b-pl-6-batch-3-evidence` at `d5dcb1452778d4fd289ec9d6d056d9f28809177d` with protected snapshot `f34b0deb0bb2a0b2f57ba82256b9e87886ad76e0`. It preserves the batch-3 source-lock and actual-capture requirement while making that packet a consumer of the existing CI capture owner and planner.

## Changes

The original alerts stylesheet lock, rendered flow-row wait and accurate capture command metadata are retained. The producer now locks 16 inputs, including its existing owner and Heatmap fixture. It is import-safe, uses the incumbent supervised server lifecycle, and emits a complete native receipt only after all 20 expected captures succeed. Owner-mode partial filters are refused. It checks the actual dev-indicator DOM; it no longer removes/hides the indicator or trims 40 pixels from the phone AlertDetail crop.

The existing `capture_ci_evidence.cjs` legacy packet registry now includes batch3, and the existing capture planner includes its manifest. The same owner validates a single exact 20-file receipt, current source hashes and server closure. Producer/fixture-only drift triggers the complete capture. There is no new runner, watcher, queue or CI workflow. The Pine child allowance, batch3 eight-minute allowance and overall deadline remain unchanged.

The evidence guard requires the exact 16 source keys and exact 20 current image declarations. The plain-language call-site guard verifies no DOM hiding or bottom trimming while preserving its fixture and screenshot-order checks. Product runtime source is the protected version.

## Actual proof

| Check | Observed result |
| --- | --- |
| Incumbent capture-owner and planner tests |117/117 passed |
| Batch3 artifact and plain-language call-site tests |64/64 passed |
| TypeScript | Full `--noEmit --incremental false` passed |
| Changed TypeScript files, optional ESLint | Passed, zero diagnostics |
| Native capture through actual `superviseLegacy` |20/20 actual frames, exit 0,60.67 seconds |
| Source stability |1,486 observed files unchanged before/after; all16 contractual inputs still match |
| Lifecycle | Child closed; server reported stopped and settled; no refusal, signal or timeout |
| Preserved additional protected images | All18 unchanged |

`capture-execution.json` records the actual supervision driver, commands, times, source/tree identity, single native receipt, complete frame set, actual PNG dimensions/digests and closure. The original head in the receipt identifies the pre-commit checkout. The integrated working source is bound by protected parent, staged source tree, and before/after hashes. No fresh capture is inferred from the later commit SHA.

The local runtime was Node 26.5.0, Next 16.2.9, Playwright 1.61.1, TypeScript 5.9.3 and Vitest 2.1.9. Representative full phone AlertDetail, Chinese Flow Board, Chinese Heatmap and desktop Pine images were visually inspected. This is fixture-based native proof, not a deployment or production acceptance claim.

## Historical provenance

`prior-pr` preserves all 21 prior PR root files, and `prior-protected` preserves all 37 protected-root files. Both inventories record exact bytes and original Git blobs. `history.json` binds their source commits. The current root manifest declares only the 20 fresh images. The 18 additional FlowDesk crops remain untouched and historical. [CAPTURE_HISTORY.md](../../pr-crops/b-pl-6-batch-3/CAPTURE_HISTORY.md) explains the older appendix relationships without attributing old pixels to this run.

## Diagnostics and CI boundary

The initial raw adjacent Vitest run passed 72/75. One failure was the obsolete batch3 assertion expecting indicator stripping and phone bottom trimming; it was corrected, and the final 64 owned tests passed. The other two failures were stale batch1 and batch2 legacy root source locks inherited from protected master. Normal PR CI already captures fresh PL6 operation records and selects the validated composition for batch1; source drift makes the incumbent batch2 planner perform its complete 24-case capture before unit tests. This repair neither restamps those old roots nor adds a replacement capture owner. Actual published-head CI must still pass.

An optional direct ESLint invocation across all seven changed source/test files reported 34 `@typescript-eslint/no-require-imports` findings in CommonJS tools and tests, including intentional producer imports. The protected repository's workflows/actions/CI scripts do not invoke ESLint; package.json merely exposes the optional command. The CommonJS APIs remain intact. The two changed TypeScript tests passed ESLint separately. The optional diagnostic is recorded in `final-checks.json`, not represented as a successful check.

The initial local merge encountered eight missing promisor blobs. No merge/source effect had occurred; the clean head/index were reconciled before recovery. The exact blobs were read from the canonical GitHub object API, verified against their Git blob SHA1s, added to the object cache, and the qualified merge then proceeded. No alternate publication carrier or shared primary worktree was used.

## Publication

`terminal-pr898-native-validation-20261109` is a local-only validation workspace. Publication must update the original GitHub branch with expected-head comparison against `d5dcb1452778d4fd289ec9d6d056d9f28809177d`, retaining both original head and protected snapshot as parents. The validation branch is not pushed. Required CI and actual native merge controls remain authoritative; no independent release/security/review hold is cleared by this packet.
