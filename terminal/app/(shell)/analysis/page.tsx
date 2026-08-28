import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import AnalysisWorkspaceMount from "@/components/mounts/AnalysisWorkspaceMount";
import SignupGate from "@/components/gates/SignupGate";

// Analysis workspace (Wave-2 IA) — the in-chart Fundamentals dashboard (MegaPane)
// promoted to its own route at /analysis, under the (shell) route group (route
// groups don't affect the path; shared chrome comes from app/(shell)/layout.tsx).
//
// All data is fetched CLIENT-side by AnalysisWorkspace (intel/fund/bars/quote per
// symbol), so there is no server payload to cache — this is a thin server shell.
// The (shell) layout reads auth cookies (auto-dynamic); this page only adds the
// signed-out gate.
//
// Member surface: the chart (/terminal) is open to guests, this desk is not.
// getClaims verifies the JWT locally (the same read the (shell) layout does for
// chrome) — no Auth round-trip unless a refresh is due.

export const metadata: Metadata = { title: "Analysis · Mastermind Terminal" };

interface AnalysisPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AnalysisPage({ searchParams }: AnalysisPageProps) {
  const query = await searchParams;
  const workspace = (
    <AnalysisWorkspaceMount
      initialSymbol={firstParam(query.symbol)}
      initialPage={firstParam(query.page) ?? firstParam(query.pane)}
    />
  );
  // Local visual QA needs the real workspace without manufacturing a Supabase
  // session. The production build can never activate this escape hatch.
  if (process.env.NODE_ENV !== "production" && process.env.ANALYSIS_LOCAL_PREVIEW === "1") {
    return workspace;
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims?.sub !== "string") return <SignupGate surface="analysis" />;
  return workspace;
}
