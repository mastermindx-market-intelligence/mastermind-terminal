import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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
  const result = await revokeApiKey(session.db, session.userId, id);
  if (!result.ok) {
    if (result.status === "not_found") {
      return fail(
        "That key is not on this account.",
        "此账户上没有该密钥。",
        404,
        "not_found",
      );
    }
    return fail(apiKeyCopy("revokeFailed", "en"), apiKeyCopy("revokeFailed", "zh"), 503, "revoke_failed");
  }
  return NextResponse.json({ key: result.key });
}
