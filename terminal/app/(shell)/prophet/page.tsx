import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { isSharedShellEnabled } from "@/lib/sharedShellContracts";
import { readShellMember } from "@/lib/shared-shell/memberIdentity";
import IntelligenceToolMount from "@/components/mounts/IntelligenceToolMount";
import MemberVerificationUnavailable from "@/components/gates/MemberVerificationUnavailable";
import OptionsPaywall from "@/components/OptionsPaywall";
import OptionsServiceUnavailable from "@/components/OptionsServiceUnavailable";
import { getLiveOptionsAccess } from "@/lib/entitlement";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title:"Prophet · Mastermind" };
export const viewport: Viewport = { maximumScale:undefined, userScalable:true };
export default async function ProphetPage() {
 if (!isSharedShellEnabled(process.env.MMX_SHARED_SHELL)) notFound();
 const member = await readShellMember();
 if (member.state === "unavailable") return <MemberVerificationUnavailable />;
 if (member.state === "guest") return <OptionsPaywall />;
 // Exactly the incumbent paid feature; no separate Prophet subscription or authority.
 const access = await getLiveOptionsAccess();
 if (access === "denied") return <OptionsPaywall />;
 if (access !== "allowed") return <OptionsServiceUnavailable />;
 return <IntelligenceToolMount key={member.subjectId} ownerKey={member.subjectId} kind="prophet" />;
}
