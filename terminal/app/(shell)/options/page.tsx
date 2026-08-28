import { Suspense } from "react";
import type { Metadata } from "next";
import OptionsWorkspaceMount from "@/components/mounts/OptionsWorkspaceMount";
import OptionsPaywall from "@/components/OptionsPaywall";
import { hasLiveOptions } from "@/lib/entitlement";

// Options workspace (Wave-3 IA) — the options-intelligence hub, renamed from the
// former Research page. Serves /options under the (shell) route group (route groups
// don't affect the path); the shared chrome comes from app/(shell)/layout.tsx. This
// is the ex-/flow OptionsHubView engine, driven by the page-level WorkspaceTabs
// (see OptionsWorkspace). The old Fundamentals chip has moved to /analysis.
//
// All data is fetched CLIENT-side by the hub (flowGet, ~25s SWR), so there is no
// server payload to cache — the page is a thin server shell. The (shell) layout
// reads auth cookies (auto-dynamic); this page adds nothing server-side.

export const metadata: Metadata = { title: "Options · Mastermind Terminal" };

export default async function OptionsPage() {
  // Live options is a PAID surface (the `terminal_live_options` entitlement — the
  // same gate as /api/flow). Non-entitled callers get the upgrade paywall instead
  // of a would-be-empty workspace (the data API already 403s). The entitlement
  // read (auth cookies via billingAuth) forces per-request dynamic rendering.
  // FLOW_FIXTURE=1 (dev/CI) is exempt, mirroring /api/flow — fixture sessions
  // preview the workspace without auth; the var is never set in prod.
  if (process.env.FLOW_FIXTURE !== "1" && !(await hasLiveOptions())) return <OptionsPaywall />;
  // Suspense: OptionsWorkspace reads useSearchParams (?tab= deep-link seeding).
  // This route is always dynamically rendered today (force-dynamic (shell)
  // layout + the entitlement read above), so the params resolve server-side and
  // the boundary never suspends — it exists so a future rendering-mode change
  // degrades to a CSR bailout here instead of a build error.
  return (
    <Suspense fallback={null}>
      <OptionsWorkspaceMount />
    </Suspense>
  );
}
