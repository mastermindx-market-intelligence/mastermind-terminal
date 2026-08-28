import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import DiscoverWorkspaceMount from "@/components/mounts/DiscoverWorkspaceMount";
import SignupGate from "@/components/gates/SignupGate";

// Discover workspace (Wave-2 IA) — find setups. Serves /discover under the (shell)
// route group; shared chrome from app/(shell)/layout.tsx. Composes the ex-/screener
// Stock Screener, the ex-/heatmap Heatmap, and the two ex-/flow tabs (Leaders,
// Leader Radar) under one WorkspaceTabs sub-nav (?tab=, default screener).
//
// email is read client-side from the AppShell context (useShellEmail), which the
// (shell) layout resolves once. All view data is fetched client-side, so this page
// is a thin server shell (auto-dynamic via the layout's cookie read) — the only
// server work is the signed-out gate: the chart (/terminal) is open to guests,
// Discover is a member surface.

export const metadata: Metadata = { title: "Discover · Mastermind Terminal" };

export default async function DiscoverPage() {
  if (process.env.TERMINAL_E2E_FIXTURE === "1") return <DiscoverWorkspaceMount />;

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims?.sub !== "string") return <SignupGate surface="discover" />;
  return <DiscoverWorkspaceMount />;
}
