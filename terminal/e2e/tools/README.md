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
No bytes or values from `PROOF_STORAGE_STATE_OTHER` are ever printed or written to the receipt.
When Phase C runs it validates that the other account cannot read, revise, or archive the owner's
thesis; the receipt is written to `e2e/.live-state/receipt-signed-in.json`.
The list check proves only that the thesis is absent from the returned page, because the API caps that page at 200 records.
A skipped Phase C exits neutrally for the three documented skip reasons; an internal Phase C error, failed outcome, leak, or browser error writes the honest signed receipt first and then exits with the assertion code.
阶段 C 由获得许可的人工操作员执行，本次代码检查不证明真实跨账号结果。

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
