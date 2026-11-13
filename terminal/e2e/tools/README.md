# Live thesis journey prover

## Wrong-user negative case (Phase C) | 错误用户反向用例（阶段 C）

A second permitted account's session can be exported with the same `codegen` command used for
`PROOF_STORAGE_STATE`, but saved to a different file under `e2e/.live-state/`:

```bash
npx playwright codegen --save-storage=e2e/.live-state/other-account-state.json https://app.mastermind-x.com
```

Pass both states when running the prover:

```bash
PROOF_STORAGE_STATE=e2e/.live-state/owner-state.json \
PROOF_STORAGE_STATE_OTHER=e2e/.live-state/other-account-state.json \
PROOF_RELEASE=<id> \
PROOF_SYMBOL=NVDA \
node e2e/tools/prove-thesis-journey-live.mjs
```

The second session must be a different file from `PROOF_STORAGE_STATE` (same-path is rejected).
A different filename does not establish a different account. Before any Phase B create, the
prover reads the owner through `GET /api/auth/principal`. Immediately before Phase C it reads
both contexts again: the owner must match the captured owner and the second principal must
be distinct. This small same-origin endpoint uses cookie-backed server `auth.getUser()`, with
private/no-store responses; it has no fixture, token-parsing, billing or API-key fallback.
Principal UUIDs stay only in memory. They, cookies and storage-state values are not logged or
written into proof receipts. Missing/malformed/unverified principals, a changed owner or equal
principals stop before all Phase C thesis requests and make the run fail rather than prove denial.
阶段 B 创建前验证所有者；阶段 C 开始前再次验证双方身份。所有者变化、身份缺失或相同时立即关闭反向用例，不生成跨账号成功结论。

Phase C reads the target first. Only an exact 404 permits the revision probe; only its exact 404
permits the archive probe. Any other response or uncertain request stops all subsequent C
requests, with no retry or fallback. The receipt distinguishes attempted requests with unknown
responses from requests never attempted: `null` is not a fabricated 404. The list check proves
only absence from the returned page, because the API caps that page at 200 records.

Closed partial observations are saved to ignored `e2e/.live-state/receipt-phase-c.json` as each
attempt begins (synchronously before dispatch), as each stage settles, and after context teardown.
An evidence-write failure prevents that dispatch. A recorded attempt with a null response does
not prove a remote effect or its absence; no repeat is authorized. The validator checks the closed
attempt flags against observed statuses/results, including a 200 list response for success.
A transport or close error
preserves already observed statuses and sets `phase_c_error`; it does not relabel an attempted
case as not-run. This separate file reports `ownerJourney: "in_progress"` and never certifies a
completed owner journey. The unchanged owner flow and owner-only failure cleanup remain separate
from C's safety abort. If the owner flow completes, `receipt-signed-in.json` carries the final C
result; the assertion exit follows its write. If later owner work/teardown fails, the separate
partial C evidence survives without claiming owner completion or clearing uncertain effects.
非 404 或网络结果不确定时停止后续阶段 C 请求；部分证据保留真实状态，未执行或未观察到的状态使用 null，不伪造 404。所有者流程及其清理与反向用例安全中止分开记录。

No other state, invalid/same-path storage state and Phase B not-run remain documented neutral
skips. Identity failures, internal errors, failed outcomes, leaks and browser errors are failures.
Source/mocked tests do not establish usable live accounts or an observed cross-account result.

# Bundle measurement (B6 / B7)

Bundle weight is only meaningful against a PRODUCTION build. `npm run dev` splits chunks
differently and compiles on demand, so a dev-mode number proves nothing about what a user
downloads. Both scripts below expect `next build` + `next start`.

```bash
npm run build
npx next start -H 127.0.0.1 -p 3180 &

# signed-out: what a visitor pulls to look at a sign-up gate
node e2e/tools/measure-guest-bundles.mjs 3180 AFTER /tmp/guest.json

# entitled: the workspace must still arrive, in one render, with no hydration errors
pkill -f "next start"
TERMINAL_E2E_FIXTURE=1 TERMINAL_E2E_ENTITLEMENT=unlimited FLOW_FIXTURE=1 \
  npx next start -H 127.0.0.1 -p 3183 &
node e2e/tools/measure-member-bundles.mjs 3183 MEMBER
```

Each route gets a fresh context (no shared cache) and reports transferred bytes, decoded bytes
and the chunk count from `performance.getEntriesByType("resource")`, plus whether any
workspace-only string literal reached the browser. Those markers are CSS class names, which
survive minification — an identifier would not.

The CI-side fence is `lib/__tests__/guestBundleBoundary.test.ts`: it walks the real static import
graph and fails if a workspace becomes reachable from a gated page again. That is the invariant;
the byte counts here are its consequence, and are what a PR records as evidence.

⚠️ Remove any `terminal/.env.local` you created for a guest-mode build before running the
Playwright suite — pointing Supabase at a dead port makes unrelated chart specs time out.
