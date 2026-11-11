# CMX A1b — native setting discovery evidence

## Capability and scope

The mounted Terminal now includes a bounded `capabilities.native_parameters` description in the existing chart-state POST. It is generated from the current suite metadata, not another catalog or indicator calculator. It describes numerical ranges/defaults, boolean switches, exact enum choices, and unsupported setting names. The existing validator is reused to qualify described defaults. It distinguishes replacement of indicator membership from merging saved parameters; the metadata does not grant entitlements or predict returns.

Only active native suites are described. Enabled modules receive priority. Complete modules fit into a 4096-byte UTF-8 budget; omitted module IDs and partial status remain explicit. The budget bounds this additive packet only, not the entire existing chart-state request. The global backend request-limit and exact-origin/receipt work remain separate obligations.

The source changes are confined to the existing metadata helper, TerminalShell, its new unit tests, and the existing mounted browser proof. `useChartBus`, BrainWidget, ChartPanel, the native computations, and Macro source were not edited. #597 and the other incumbent owners remain undisturbed.

## Executed evidence

- New discovery tests initially failed **8/8** because no discovery function existed.
- Focused native/legacy/catalog tests after implementation: **102 passed**.
- Full `npm test -- --maxWorkers=4 --minWorkers=1`: **383 files / 6,145 passed / 4 existing TODOs**.
- The new mounted assertion initially failed with `the real chart-state POST must publish the native setting description`; the emitted capability object lacked the descriptor. The retained Playwright error event established that failure, not a test-start error.
- After the minimal shell binding, the existing six journeys passed with **zero retries**: desktop 1440×900, tablet 820×1180, mobile 390×844, each EN/ZH. Each verifies actual native S/R geometry and settings, the emitted packet's native enum/boolean schema, malformed-command rejection, and module removal.
- Sequential `node node_modules/next/dist/bin/next typegen` then `node node_modules/typescript/bin/tsc --noEmit`: **exit 0 / exit 0**.
- Package and lock hashes remained `9f962bbb17a9f4c960c1c5ecc963419e49fcd7872386b091a734a7ee6d6c6dd5` and `549e6621f07ca43b6f64f4a22ce95e7e96ccf77f5593eb2baf3b1215eeb45dca`.
- Every current native module is selected in a validator-agreement test. Returned enum arrays cannot mutate the canonical catalog. UTF-8 overflow omits whole module descriptions instead of cutting fields or claiming completeness.

Warnings retained: existing Vite CommonJS deprecation; expected negative-test account-key rejection messages; fixture analytics memory-only warning. No new full-suite failure was suppressed.

Six fresh screenshots and their hashes: `terminal/docs/pr-crops/cmx-native-suite-control-20260924/capabilities/EVIDENCE.json`. The posted data/model/account endpoints are fixtures. No new visual design or CSS was introduced. These are client publication/rendering receipts, not live backend delivery or model task success.

## Authority and remaining boundary

Current Chairman review override is recorded at Macro #7151 comment **5826034970**. It waives independent review for this program; it does not assert that review occurred, bypass source protection/required checks, or resolve the known backend wire mismatch. No reviewer was launched in this continuation.

A compound native source-inspection request covering Macro build maps and gateway analysis was blocked before dispatch by OpenAI's safety check. It was not retried or routed through another surface; effect was NONE. Earlier broad GraphQL collision acquisition also failed and was not treated as a complete census. Therefore the backend companion was not modified. The disjoint existing Terminal carrier remained serviceable for these writes/tests.

The original backend `on`/batch/sequence incompatibility, ACK consumption and exact-origin isolation findings remain preserved in #740 comment5814929845 and the cumulative #7151 checkpoint. Playwright clears its transient `test-results` directory; earlier ignored probe files must not be assumed to survive these runs. The durable GitHub findings, source pins and reproduction summaries remain the recovery source. Current run facts are preserved here before transient log cleanup.

This slice remains BUILT_NOT_PROVEN until its fresh required CI and allowed paired-path release proof. No merge, deployment, customer-account mutation, provider activation, causal replay, trading authority or alpha result is claimed.
