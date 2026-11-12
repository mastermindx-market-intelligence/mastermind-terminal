# CI evidence path-file transport

## Observed failure

PR #1270 head `762a0f7b88e0470cbf932bad8208b84d71b79c92`, CI run
43049099269, job 130622153024, failed before the evidence planner launched.
The workflow wrote its complete 2,649-path census into one environment
variable: 439,184 UTF-8 bytes. Linux could not start bash, then could not start
the artifact-upload and cleanup Node processes, reporting
`Argument list too long`.

The actual tested synthetic merge was
`017b342dacfd44865c55a3768899a256a76222c0`, with protected parent
`b6db0ca0ebfba1463746dc1eb6bdd6b50f4e19e7` and PR parent `762a0f7b…`.
The workflow-run API's older embedded base is not the actual checkout identity.
The original full log, exact census reconstruction and hashes are retained here.
The reconstructed path file adds the normal terminal LF and is therefore
439,185 bytes; it is not described as a newly executed Git diff.

## Repair

The existing recording step still writes the complete exact-merge diff to
`RUNNER_TEMP/evidence-pr-touched.txt`. It exports only that filename.
The pull-request planner reads UTF-8 text from the file and passes it to the
existing explicit-text drift attribution function. A missing or unreadable
configured file fails explicitly. An existing empty file keeps the existing
empty-list behavior.

PRs still require their own captures. Known drift is attributed only to paths
the PR touched. Inherited drift, malformed evidence and merge-group reuse
retain their existing semantics. No census truncation, path filtering,
inline-content fallback, required-check change or capture exemption is added.

## Qualification

- The new workflow regression executed the original recording step and failed
  on its multiline environment export. It passes after the repair.
- All 48 workflow-contract tests pass.
- All 342 tests in the existing six-file synthetic orchestration command pass,
  with zero failed, skipped or cancelled tests.
- A child Node process consumes a path file larger than the observed 439 KB
  census and still detects a genuinely drifted source at its final entry.
- Missing/non-file inputs, an existing empty census, inherited drift and both
  non-PR event paths are covered.
- The first fresh-workspace orchestration run had one missing TypeScript module
  and 341 passing tests. The final run reused the exact lockfile-matched installed
  compiler read-only. Its version and compiler digest are recorded; no dependency
  lock or installed dependency was modified.
- Diff checks pass. The four source preimages and final bytes are recorded.

## Original D06 consumer

The same four preimages were verified in D06 before applying the qualified
patch. Its 46 planner tests pass. Its actual local planner consumes all 2,649
original paths and emits `capture=true`.

The existing combined legacy evidence plan reports conflicting source locks
and therefore remains fail-closed; it cannot attribute that drift to the PR.
The unchanged PR policy requests full fresh proof. This transport repair does
not turn that warning into accepted evidence or a capture waiver.

Both D06 native packet owners remain qualified on revision
`d06-r5-copy-20261111`, with 32 EOD and 29 GEX source inputs. None of the
four transport/test paths belongs to those native maps. Qualified descriptors,
roots, original browser/native captures and their Git identities are unchanged.
The corresponding browser map separation was also checked during diagnosis;
the repair does not alter the current 72/77 browser dependency sets.

D06's original local HEAD `357c32f…`, pending merge `18fabe9d…` and index
bytes remain intact. The local planner event configuration is a labeled
reproduction, not a GitHub execution identity. Hosted execution on the new
published head, required CI and D06's remaining product/release acceptance are
still owed.

Operation: `terminal-pr-estate-support-20261111-c3`.
Isolated shared-input operation: `terminal-evidence-path-file-support-20261111-c3`.
Mastermind law pin: `bb2c2e4437e6ee250f9d4ee9b6b420abdfbbc178`.

The generic four-file CI repair can be reviewed independently of D06's product
changes. Any shared rollout preserves #1270's Draft, no-auto and remaining
product/release holds; the original D06 branch also receives the repair.
