import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revokeApiKey, type ApiKeysDb } from "@/lib/apiKeys";
import { apiKeyCopy } from "@/lib/apiKeyLabels";

export const runtime = "nodejs";

function fail(en: string, zh: string, status: number, error: string) {
  return NextResponse.json({ error, message: en, messageZh: zh }, { status });
}

async function resolveDb(): Promise<{ db: ApiKeysDb; userId: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { db: supabase as unknown as ApiKeysDb, userId: user.id };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await resolveDb();
  if (!session) {
    return fail(apiKeyCopy("notSignedIn", "en"), apiKeyCopy("notSignedIn", "zh"), 401, "not_signed_in");
  }
  const { id } = await ctx.params;
  // MAJOR-2 fix: call the SECURITY DEFINER function via service role, not PostgREST.
  // revoke_api_key(uuid) is the only permitted revoke path after the UPDATE grant removal.
  const service = createServiceClient();
  // BLOCKER fix: pass userId as p_caller so revoke_api_key can enforce auth.uid() = userId.
  // SECURITY DEFINER bypasses RLS but not the intra-function ownership check.
  const result = await revokeApiKey(session.db, session.userId, id, session.userId, service);
  if (!result.ok) {
    if (result.status === "not_found") {
      return fail(
        "That key is not on this account.",
        "此账户上没有该密钥。",
        404,
        "not_found",
      );
    }
    if (result.status === "forbidden") {
      return fail(
        "You do not have permission to revoke this key.",
        "您没有撤销此密钥的权限。",
        403,
        "forbidden",
      );
    }
    return fail(apiKeyCopy("revokeFailed", "en"), apiKeyCopy("revokeFailed", "zh"), 503, "revoke_failed");
  }
  return NextResponse.json({ key: result.key });
}
