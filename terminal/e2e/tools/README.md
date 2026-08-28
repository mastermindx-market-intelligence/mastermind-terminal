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
