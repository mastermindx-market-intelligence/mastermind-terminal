import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import AnalysisWorkspaceMount from "@/components/mounts/AnalysisWorkspaceMount";
import ThesisWorkspaceMount from "@/components/mounts/ThesisWorkspaceMount";
import SignupGate from "@/components/gates/SignupGate";
import { parseAnalysisRoute } from "@/lib/analysisRoute";

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

function UnsupportedAnalysisRoute({ reason }: { reason: string }) {
  return (
    <main className="main2 ws-shell" style={{ display: "grid", placeItems: "center", padding: "24px" }}>
      <section role="status" style={{ maxWidth: 560, padding: 28, border: "1px solid var(--border)", borderRadius: 12 }}>
        <p style={{ color: "var(--text-muted)", margin: "0 0 8px" }}>ANALYSIS LINK</p>
        <h1 style={{ fontSize: 24, margin: "0 0 10px" }}>This analysis view is not supported</h1>
        <p style={{ color: "var(--text-muted)", margin: 0 }}>
          Nothing else was opened. Return to <a href="/analysis">company research</a> or use a valid Thesis workspace link.
        </p>
        <span hidden>{reason}</span>
      </section>
    </main>
  );
}

export default async function AnalysisPage({ searchParams }: AnalysisPageProps) {
  const query = await searchParams;
  const route = parseAnalysisRoute(query);
  const workspace = route.kind === "company" ? (
    <AnalysisWorkspaceMount initialSymbol={route.symbol} initialPage={route.page} />
  ) : route.kind === "theses" ? (
    <ThesisWorkspaceMount initialSymbol={route.symbol} initialThesisId={route.thesisId} />
  ) : route.kind === "invalid_thesis" ? (
    <ThesisWorkspaceMount invalidLink />
  ) : (
    <UnsupportedAnalysisRoute reason={route.reason} />
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
