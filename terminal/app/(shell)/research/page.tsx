import type { Metadata } from "next";
import { readShellMember } from "@/lib/shared-shell/memberIdentity";
import ResearchWorkspaceMount from "@/components/mounts/ResearchWorkspaceMount";
import SignupGate from "@/components/gates/SignupGate";
import MemberVerificationUnavailable from "@/components/gates/MemberVerificationUnavailable";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Research · Mastermind Terminal" };

export default async function ResearchPage() {
  const member = await readShellMember();
  if (member.state === "unavailable") return <MemberVerificationUnavailable />;
  if (member.state === "guest") return <SignupGate surface="research" />;
  return <ResearchWorkspaceMount key={member.subjectId} ownerKey={member.subjectId} />;
}
