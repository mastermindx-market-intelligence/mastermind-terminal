export const dynamic = "force-dynamic";
export const revalidate = 0;
import { isUuid } from "@/lib/briefs";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignupGate from "@/components/gates/SignupGate";
import SharedBrief from "@/components/briefs/SharedBrief";

/**
 * Recipient entry for one shared brief delivery: /briefs/shared/<deliveryId>.
 *
 * The route is one canonical lowercase UUID and nothing else — any query
 * string or malformed id is a miss. The server verifies the current Supabase
 * user exactly once; a signed-out visitor gets the existing SignupGate. No
 * brief data is fetched here and no error is ever rendered alongside content:
 * the page only forwards the verified principal and the verified id to the
 * client consumer, which owns the single GET read, its decode and its scope.
 * The shell layout above this file owns all chrome; this surface only marks
 * its main content region.
 */

function canonicalUuid(value: string): boolean { return isUuid(value) && value === value.toLowerCase(); }

type SharedBriefPageProps = {
  params: Promise<{ deliveryId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SharedBriefPage({
  params,
  searchParams,
}: SharedBriefPageProps) {
  const [{ deliveryId }, query] = await Promise.all([params, searchParams]);
  if (!canonicalUuid(deliveryId) || Object.keys(query).length > 0) notFound();

  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return <SignupGate surface="alerts" />;

  const userId = data.user.id;
  if (!canonicalUuid(userId)) notFound();

  return (
    <main className="main2">
      <div className="pg"><SharedBrief principalId={userId} deliveryId={deliveryId} /></div>
    </main>
  );
}
