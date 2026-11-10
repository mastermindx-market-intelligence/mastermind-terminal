import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { isSharedShellEnabled } from "@/lib/sharedShellContracts";
import { readShellMember } from "@/lib/shared-shell/memberIdentity";
import IntelligenceToolMount from "@/components/mounts/IntelligenceToolMount";
import SignupGate from "@/components/gates/SignupGate";
import MemberVerificationUnavailable from "@/components/gates/MemberVerificationUnavailable";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title:"Sector Intelligence · Mastermind" };
export const viewport: Viewport = { maximumScale:undefined, userScalable:true };
export default async function SectorsPage() {
 if (!isSharedShellEnabled(process.env.MMX_SHARED_SHELL)) notFound();
 const member = await readShellMember();
 if (member.state === "unavailable") return <MemberVerificationUnavailable />;
 if (member.state === "guest") return <SignupGate surface="discover" />;
 return <IntelligenceToolMount key={member.subjectId} ownerKey={member.subjectId} kind="sectors" />;
}
