import type { Metadata } from "next";
import { workspaceMetadata } from "@/lib/shared-shell/metadata";
import { readShellMember } from "@/lib/shared-shell/memberIdentity";
import { isSharedShellDevOpen, SHARED_SHELL_DEV_SUBJECT } from "@/lib/shared-shell/devOpen";
import ResearchWorkspaceMount from "@/components/mounts/ResearchWorkspaceMount";
import SignupGate from "@/components/gates/SignupGate";
import MemberVerificationUnavailable from "@/components/gates/MemberVerificationUnavailable";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = workspaceMetadata("Research");

export default async function ResearchPage() {
  // Beta development mode (lib/shared-shell/devOpen.ts): render the real
  // workspace for signed-out visitors under the shared development subject,
  // before any auth read. Production declares no MMX_* env and keeps the gate.
  if (isSharedShellDevOpen()) {
    return <ResearchWorkspaceMount key={SHARED_SHELL_DEV_SUBJECT} ownerKey={SHARED_SHELL_DEV_SUBJECT} />;
  }
  const member = await readShellMember();
  if (member.state === "unavailable") return <MemberVerificationUnavailable />;
  if (member.state === "guest") return <SignupGate surface="research" />;
  return <ResearchWorkspaceMount key={member.subjectId} ownerKey={member.subjectId} />;
}
