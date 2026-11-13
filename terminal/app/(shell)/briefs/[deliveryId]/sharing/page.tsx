import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SignupGate from "@/components/gates/SignupGate";
import BriefSharingRequestReview from "@/components/briefs/BriefSharingRequestReview";
import BriefSharingReview from "@/components/briefs/BriefSharingReview";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/briefs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = { title: "Share the brief · Mastermind Terminal" };

// SHA-64 hex: the exact shape of a pre-send sharing correlation address
// (expected_effect_sha256). Anything else is not an address this page carries.
const SHA64_RE = /^[0-9a-f]{64}$/;


interface BriefSharingPageProps {
  params: Promise<{ deliveryId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Brief sharing — /briefs/[deliveryId]/sharing (one delivered brief, one team, view only).
 *
 * This route only qualifies the address and the identity: an unknown delivery id or a
 * malformed expected_effect_sha256 is not this page (notFound), a signed-out visitor gets
 * the alerts sign-up gate (a sharing decision needs an account), and a signed-in user is
 * mounted with their OWN auth uuid as the principal. Everything else — the review, the
 * grant, the receipt — is derived by the server API; the client never grants a permission
 * and this page runs no auth protocol of its own and no workspace identity mapping.
 *
 * The (shell) route group owns the chrome/header; this page owns <main class="main2">
 * content only.
 */
export default async function BriefSharingPage({ params, searchParams }: BriefSharingPageProps) {
  const { deliveryId } = await params;
  const query = await searchParams;
  const supplied = query.expected_effect_sha256;
  if (Array.isArray(supplied) || Object.keys(query).some(key => !["expected_effect_sha256", "request", "revision", "attempt", "request_team_id", "expected_content_sha256"].includes(key))) notFound();
  const requestRef = query.request, revision = query.revision, action = query.attempt;
  const requested = requestRef !== undefined;
  if (requested && (deliveryId !== deliveryId.toLowerCase() || typeof requestRef !== "string" || !isUuid(requestRef) || requestRef !== requestRef.toLowerCase() || revision !== "1" || (action !== undefined && action !== "SHARE" && action !== "KEEP_PRIVATE" && action !== "ISSUE"))) notFound();
  if (!requested && (revision !== undefined || action !== undefined)) notFound();
  const issueTeam = query.request_team_id, issueContent = query.expected_content_sha256;
  if (action === "ISSUE" ? (typeof issueTeam !== "string" || !isUuid(issueTeam) || issueTeam !== issueTeam.toLowerCase() || typeof issueContent !== "string" || !SHA64_RE.test(issueContent)) : (issueTeam !== undefined || issueContent !== undefined)) notFound();
  if (requested && ((action === "SHARE") !== (supplied !== undefined) || (action === "KEEP_PRIVATE" && supplied !== undefined))) notFound();
  const expectedEffect = supplied ?? null;
  if (!isUuid(deliveryId) || (expectedEffect !== null && !SHA64_RE.test(expectedEffect))) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user || !isUuid(data.user.id)) return <SignupGate surface="alerts" />;

  return (
    <main className="main2">
      <div className="pg">
        {requested ? <BriefSharingRequestReview
          selected={{ delivery_id: deliveryId, request_ref: requestRef as string, revision: 1 }}
          principalId={data.user.id} originalAction={action as "SHARE" | "KEEP_PRIVATE" | "ISSUE" | undefined ?? null}
          originalIssue={action === "ISSUE" ? { team_id: issueTeam as string, content_sha256: issueContent as string } : null}
          originalEffect={expectedEffect}
        /> : <BriefSharingReview
          deliveryId={deliveryId}
          principalId={data.user.id}
          initialExpectedEffect={expectedEffect}
        />}
      </div>
    </main>
  );
}
