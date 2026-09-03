import RouteSkeleton from "@/components/RouteSkeleton";

// Shared Suspense fallback for the (shell) workspaces. The chrome (.app2 grid + topbar +
// AppNav + MobileNav) is owned by app/(shell)/layout.tsx, which wraps this fallback — so the
// skeleton renders the .main2 body only (`bare`) to avoid double-rendering the shell grid
// inside the layout's grid cell (same contract as the old app/flow/loading.tsx).
//
// ── Why this lives here instead of app/(shell)/loading.tsx ──
// A `loading.tsx` at the (shell) segment wraps the children of that layout — EVERY route in the
// group, including /admin. That boundary lets React flush the shell (and with it the HTTP status
// line, 200) as soon as the layout resolves, while the page is still awaiting its gate. A
// `redirect()` or `notFound()` thrown after that flush can no longer set a status: Next degrades
// it to a soft, client-side navigation carried in the RSC payload, so an anonymous visitor to
// /admin got 200 instead of the 307 the page asks for. Streaming a skeleton is the right trade
// for a data workspace and the wrong one for a route whose entire first act is an auth decision,
// so the boundary is declared per workspace and /admin deliberately has none.
// Pinned by lib/__tests__/adminPageStatusContract.test.ts.
export default function WorkspaceLoading() {
  return <RouteSkeleton title="Workspace" variant="table" bare />;
}
