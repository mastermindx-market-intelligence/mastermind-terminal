import type { Metadata } from "next";
import { readShellMember } from "@/lib/shared-shell/memberIdentity";
import MonitorWorkspaceMount from "@/components/mounts/MonitorWorkspaceMount";
import SignupGate from "@/components/gates/SignupGate";
import MemberVerificationUnavailable from "@/components/gates/MemberVerificationUnavailable";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Monitor · Mastermind Terminal" };

export default async function MonitorPage() {
  const member = await readShellMember();
  if (member.state === "unavailable") return <MemberVerificationUnavailable />;
  if (member.state === "guest") return <SignupGate surface="monitor" />;
  return <MonitorWorkspaceMount key={member.subjectId} />;
}
