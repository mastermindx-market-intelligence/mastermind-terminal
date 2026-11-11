import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SignupGate from "@/components/gates/SignupGate";
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
  if (Array.isArray(supplied) || Object.keys(query).some(key => key !== "expected_effect_sha256")) notFound();
  const expectedEffect = supplied ?? null;
  if (!isUuid(deliveryId) || (expectedEffect !== null && !SHA64_RE.test(expectedEffect))) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user || !isUuid(data.user.id)) return <SignupGate surface="alerts" />;

  return (
    <main className="main2">
      <div className="pg">
        <BriefSharingReview
          deliveryId={deliveryId}
          principalId={data.user.id}
          initialExpectedEffect={expectedEffect}
        />
      </div>
    </main>
  );
}
