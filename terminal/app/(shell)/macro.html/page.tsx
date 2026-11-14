import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isSharedShellEnabled } from "@/lib/sharedShellContracts";
import { readShellMember } from "@/lib/shared-shell/memberIdentity";
import MacroDashboardMount from "@/components/mounts/MacroDashboardMount";
import SignupGate from "@/components/gates/SignupGate";
import MemberVerificationUnavailable from "@/components/gates/MemberVerificationUnavailable";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Macro Dashboard · Mastermind" };
export default async function MacroPage() {
  if (!isSharedShellEnabled(process.env.MMX_SHARED_SHELL)) notFound();
  const member = await readShellMember();
  if (member.state === "unavailable") return <MemberVerificationUnavailable />;
  if (member.state === "guest") return <SignupGate surface="today" />;
  return <MacroDashboardMount key={member.subjectId} ownerKey={member.subjectId} />;
}
