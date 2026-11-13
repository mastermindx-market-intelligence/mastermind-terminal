import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { isSharedShellEnabled } from "@/lib/sharedShellContracts";
import { readShellMember } from "@/lib/shared-shell/memberIdentity";
import IntelligenceToolMount from "@/components/mounts/IntelligenceToolMount";
import MemberVerificationUnavailable from "@/components/gates/MemberVerificationUnavailable";
import OptionsPaywall from "@/components/OptionsPaywall";
import OptionsServiceUnavailable from "@/components/OptionsServiceUnavailable";
import { getLiveOptionsAccess } from "@/lib/entitlement";
import { ProphetLanesView } from "@/components/prophet/ProphetLanesView";
const PROPHET_CANONICAL_FIXTURE_COOKIE = "mm_e2e_prophet_canonical";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title:"Prophet · Mastermind" };
export const viewport: Viewport = { maximumScale:undefined, userScalable:true };
export default async function ProphetPage() {
 // E2E fixture seam: development + TERMINAL_E2E_FIXTURE + a request cookie
 // that only e2e/prophet-canonical.spec.ts sets, so the canonical mount's URL
 // contract (tab/sector/symbol/sel) has a deterministic browser proof in the
 // shared fixture server while other fixture journeys (the shared-shell
 // Intelligence qualify tool) keep the real mount. Production keeps failing
 // closed through the shared-shell, member and entitlement reads below.
 if (
   process.env.NODE_ENV === "development"
   && process.env.TERMINAL_E2E_FIXTURE === "1"
   && (await cookies()).get(PROPHET_CANONICAL_FIXTURE_COOKIE)?.value === "1"
 ) {
   return <div className="obs-prophet-lane-shell"><ProphetLanesView /></div>;
 }
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
