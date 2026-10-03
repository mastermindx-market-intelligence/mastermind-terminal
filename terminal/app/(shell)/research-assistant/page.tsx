import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import SignupGate from "@/components/gates/SignupGate";
import EvidenceToThesisWorkspace from "@/components/workspaces/EvidenceToThesisWorkspace";

export const metadata: Metadata = { title: "Research assistant · Mastermind Terminal" };

export default async function ResearchAssistantPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <SignupGate surface="analysis" />;
  return <EvidenceToThesisWorkspace key={user.id} ownerId={user.id} />;
}
