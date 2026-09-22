import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import SignupGate from "@/components/gates/SignupGate";
import EvidenceToThesisWorkspace from "@/components/workspaces/EvidenceToThesisWorkspace";

export const metadata: Metadata = { title: "Research assistant · Mastermind Terminal" };

export default async function ResearchAssistantPage() {
  if (process.env.NODE_ENV !== "production" && process.env.ANALYSIS_LOCAL_PREVIEW === "1") {
    return <EvidenceToThesisWorkspace />;
  }
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims?.sub !== "string") return <SignupGate surface="analysis" />;
  return <EvidenceToThesisWorkspace />;
}
