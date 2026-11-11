import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { isSharedShellEnabled } from "@/lib/sharedShellContracts";
import { readShellMember } from "@/lib/shared-shell/memberIdentity";
import MemberVerificationUnavailable from "@/components/gates/MemberVerificationUnavailable";
import OptionsPaywall from "@/components/OptionsPaywall";
import OptionsServiceUnavailable from "@/components/OptionsServiceUnavailable";
import { getLiveOptionsAccess } from "@/lib/entitlement";
import ProphetEvaluationView from "@/components/prophet/evaluation/ProphetEvaluationView";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Strategy Evaluation · Mastermind" };
export const viewport: Viewport = { maximumScale: undefined, userScalable: true };

/**
 * `/prophet/evaluation` — the Strategy Evaluation surface (SX05/SX12): how the
 * Prophet model book actually performed against simply owning the market,
 * published by Macro's evaluation engine as `prophet.beta_evaluation/v1`.
 *
 * Gating mirrors app/(shell)/prophet/page.tsx exactly (shared-shell flag →
 * member identity → the incumbent paid-feature entitlement). The e2e fixture
 * branch mirrors app/(shell)/portfolio/page.tsx: deterministic responsive proof
 * only, development + fixture flag; production fails closed through the same
 * reads as /prophet.
 */
export default async function ProphetEvaluationPage() {
  if (process.env.NODE_ENV === "development" && process.env.TERMINAL_E2E_FIXTURE === "1") {
    return <ProphetEvaluationView />;
  }
  if (!isSharedShellEnabled(process.env.MMX_SHARED_SHELL)) notFound();
  const member = await readShellMember();
  if (member.state === "unavailable") return <MemberVerificationUnavailable />;
  if (member.state === "guest") return <OptionsPaywall />;
  // Exactly the incumbent paid feature; no separate Prophet subscription or authority.
  const access = await getLiveOptionsAccess();
  if (access === "denied") return <OptionsPaywall />;
  if (access !== "allowed") return <OptionsServiceUnavailable />;
  return <ProphetEvaluationView />;
}
