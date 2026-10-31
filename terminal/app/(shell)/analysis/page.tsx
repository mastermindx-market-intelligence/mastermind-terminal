import type { Metadata } from "next";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { E2E_AUTH_MARKER_COOKIE, selectsFixtureAuthBranch } from "@/lib/e2e/investigationAuthFixture";
import AnalysisWorkspaceMount from "@/components/mounts/AnalysisWorkspaceMount";
import ThesisWorkspaceMount from "@/components/mounts/ThesisWorkspaceMount";
import InvestigationWorkspaceMount from "@/components/mounts/InvestigationWorkspaceMount";
import UnsupportedAnalysisRoute from "@/components/workspaces/UnsupportedAnalysisRoute";
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
//
// The Investigation evidence-review loops are the one exception to the seam below: with
// the test-fixture marker they take the real createClient()/getClaims() path, so the
// browser exercises the existing auth owner instead of a manufactured identity. The
// marker is a host-only path=/analysis cookie holding no principal and no token — it
// selects a branch, it never authenticates: an unverifiable session still lands on
// SignupGate, and production never selects this branch.

export const metadata: Metadata = { title: "Analysis · Mastermind Terminal" };

interface AnalysisPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AnalysisPage({ searchParams }: AnalysisPageProps) {
  const query = await searchParams;
  const route = parseAnalysisRoute(query);
  const workspace = (ownerKey: string) => route.kind === "company" ? (
    <AnalysisWorkspaceMount initialSymbol={route.symbol} initialPage={route.page} />
  ) : route.kind === "theses" ? (
    <ThesisWorkspaceMount key={`${ownerKey}:${route.thesisId ?? "new"}`} ownerKey={ownerKey} initialSymbol={route.symbol} initialThesisId={route.thesisId} />
  ) : route.kind === "investigations" ? (
    <InvestigationWorkspaceMount key={`${ownerKey}:${route.investigationId ?? "library"}:${route.revision ?? "head"}`} ownerKey={ownerKey} initialSymbol={route.symbol} initialInvestigationId={route.investigationId} initialRevision={route.revision} />
  ) : route.kind === "invalid_thesis" ? (
    <ThesisWorkspaceMount key={`${ownerKey}:invalid`} ownerKey={ownerKey} invalidLink />
  ) : (
    <UnsupportedAnalysisRoute reason={route.reason} />
  );
  // Local visual QA needs the real workspace without manufacturing a Supabase
  // session. The production build can never activate this escape hatch.
  const useFixtureAuth = selectsFixtureAuthBranch(route.kind, (await cookies()).get(E2E_AUTH_MARKER_COOKIE)?.value);
  if (!useFixtureAuth && process.env.NODE_ENV !== "production" && process.env.ANALYSIS_LOCAL_PREVIEW === "1") {
    return workspace("local-preview");
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims?.sub !== "string") return <SignupGate surface="analysis" />;
  return workspace(data.claims.sub);
}
