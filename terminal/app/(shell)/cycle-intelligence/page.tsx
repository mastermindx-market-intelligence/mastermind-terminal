import type { Metadata } from "next";
import CycleIntelligence from "@/components/workspaces/CycleIntelligence";
import { isSharedShellEnabled } from "@/lib/sharedShellContracts";
import { SHARED_SHELL_LEGACY_ORIGIN } from "@/lib/sharedShellRoutes";
import { readShellMember } from "@/lib/shared-shell/memberIdentity";
import MemberVerificationUnavailable from "@/components/gates/MemberVerificationUnavailable";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Cycle Intelligence · Mastermind", robots: { index:false, follow:false } };
export default async function CyclePage() {
  const member = await readShellMember();
  if (member.state === "unavailable") return <MemberVerificationUnavailable />;
  const owner = member.state === "ready" ? member.subjectId : "";
  const explorer = (isSharedShellEnabled(process.env.MMX_SHARED_SHELL) ? "" : SHARED_SHELL_LEGACY_ORIGIN) + "/cycle.html";
  return <CycleIntelligence key={owner} owner={owner} explorer={explorer} />;
}
