# Guest/member module boundaries

Every gated route in `app/(shell)/` is a server component that returns a gate for a visitor who
cannot enter the surface. That is correct for AUTH, and it was wrong for BUNDLES: a static import
of the workspace puts every client component reachable from it into the route's client manifest,
so the gate shipped the whole desk with it. A signed-out `/analysis` load decoded ~2.1 MB of a
workspace the visitor is not allowed to open; the same shape cost ~5 MB more across `/discover`,
`/alerts`, `/options`, `/scripts` and `/portfolio`.

A server-side `await import()` does not fix it — measured in PR #420. Next resolves the client
reference at build time either way, and the module lands in the same route chunk group. **Do not
retry that experiment.**

The boundary has to sit on the CLIENT side of the RSC seam. Each file here is a `"use client"`
mount that pulls its workspace through `next/dynamic`, which makes the workspace its own async
chunk, requested only when the mount actually renders. The guest branch never renders it, so the
guest never fetches it.

Rules for anything added here:

* SSR stays ON (`next/dynamic`'s default). The member path must be unchanged — the workspace still
  server-renders inside the shell and its chunk loads during hydration, so there is no second
  navigation, no client-only flash and no hydration race.
* Props are typed with `import type` + `React.ComponentProps`, which TypeScript erases entirely.
  A value import of the workspace here would put it straight back in the guest graph.
* The mount does NOTHING else. No data fetching, no auth logic, no fallback UI that could diverge
  from the workspace's own. It exists to be a chunk boundary.
* `e2e/guest-bundle-isolation.spec.ts` is the fence: it fails if a guest navigation pulls a
  workspace marker string down the wire.
