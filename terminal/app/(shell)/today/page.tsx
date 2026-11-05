import type { Metadata } from "next";
import { readShellMember } from "@/lib/shared-shell/memberIdentity";
import TodayWorkspaceMount from "@/components/mounts/TodayWorkspaceMount";
import SignupGate from "@/components/gates/SignupGate";
import MemberVerificationUnavailable from "@/components/gates/MemberVerificationUnavailable";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Today · Mastermind Terminal" };

export default async function TodayPage() {
  const member = await readShellMember();
  if (member.state === "unavailable") return <MemberVerificationUnavailable />;
  if (member.state === "guest") return <SignupGate surface="today" />;
  return <TodayWorkspaceMount key={member.subjectId} ownerKey={member.subjectId} />;
}
