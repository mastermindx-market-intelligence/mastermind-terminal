import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listApiKeys, mintApiKey, type ApiKeysDb } from "@/lib/apiKeys";
import { apiKeyCopy } from "@/lib/apiKeyLabels";

export const runtime = "nodejs";

const MESSAGES = {
  not_signed_in: [apiKeyCopy("notSignedIn", "en"), apiKeyCopy("notSignedIn", "zh")],
  load_failed: [apiKeyCopy("loadFailed", "en"), apiKeyCopy("loadFailed", "zh")],
  mint_failed: [apiKeyCopy("mintFailed", "en"), apiKeyCopy("mintFailed", "zh")],
  limit: [apiKeyCopy("activeCap", "en"), apiKeyCopy("activeCap", "zh")],
  invalid_label: [
    "Give this key a short name so you can recognise it later.",
    "请给此密钥起一个简短名称，方便以后辨认。",
  ],
} as const;

function fail(code: keyof typeof MESSAGES, status: number) {
  const [message, messageZh] = MESSAGES[code];
  return NextResponse.json({ error: code, message, messageZh }, { status });
}

async function resolveDb(): Promise<{ db: ApiKeysDb; userId: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { db: supabase as unknown as ApiKeysDb, userId: user.id };
}

export async function GET() {
  const session = await resolveDb();
  if (!session) return fail("not_signed_in", 401);
  const result = await listApiKeys(session.db, session.userId);
  if (!result.ok) return fail("load_failed", 503);
  return NextResponse.json({ keys: result.keys });
}

export async function POST(req: Request) {
  const session = await resolveDb();
  if (!session) return fail("not_signed_in", 401);
  const body = (await req.json().catch(() => null)) as { label?: unknown } | null;
  const result = await mintApiKey(session.db, session.userId, body?.label);
  if (!result.ok) {
    if (result.status === "limit") return fail("limit", 400);
    if (result.status === "invalid_label") return fail("invalid_label", 400);
    return fail("mint_failed", 503);
  }
  return NextResponse.json({ key: result.key, secret: result.secret }, { status: 201 });
}
