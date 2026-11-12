# Hosted export prerequisite ordering

CI run 43224805483 stopped before the raw exporter: the checked-in Batch 3 packet and active-inbox packet still bound the prior capture-control bytes. Its parallel PL6 shard produced the actual current Batch 3 packet; that output is imported separately with its original receipts and preserved history.

The single repository-state control-lock test is moved verbatim out of the pure synthetic planner test file into `terminal/scripts/ci/evidence-control-lock.test.cjs`. Every pure orchestration/exporter test remains a blocking preflight. The committed-lock test still runs before any active packet writes.

Only same-repository pull request 895 may continue after that isolated committed-lock failure to author its missing proof. Its original `outcome` is then enforced by an `always()` step after export. Failure, skipped and absent outcomes fail the job. The exporter therefore cannot turn stale checked-in evidence into a green check; actual packet import and a new natural CI run are required.

The existing Chromium installation and existing active-inbox producer are relocated ahead of the raw exporter, keeping the same arguments, port, time limit, strict reader and output packet. There is one inbox invocation. The producer already records all eight cases, 15 source hashes, actual runtime/checkout and complete cleanup. Existing always-on artifact retention saves its nine files and stage proof. Ordinary planner, selectors, fan-in and native acceptance remain unchanged.

The PR-specific continuation allowance and raw export hook are temporary authoring machinery to remove when the complete immutable successor import is ready. No local capture, workflow rerun, source-lock restamp or acceptance waiver is used.
