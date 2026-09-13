import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listDeliveries, WEBHOOK_ROUTE_MESSAGES, type WebhookRouteCode } from "@/lib/webhooks";
import type { TenancyDb } from "@/lib/teams";

export const runtime = "nodejs";

async function resolveDb(): Promise<{ db: TenancyDb; userId: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { db: supabase as unknown as TenancyDb, userId: user.id };
}

function errorBody(error: string, code: WebhookRouteCode) {
  const [message, messageZh] = WEBHOOK_ROUTE_MESSAGES[code];
  return { error, message, messageZh };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await resolveDb();
  if (!session) {
    return NextResponse.json(errorBody("UNAUTHENTICATED", "not_signed_in"), { status: 401 });
  }
  const { id } = await ctx.params;
  const result = await listDeliveries(session.db, session.userId, id);
  if (!result.ok) {
    return NextResponse.json(errorBody(result.code.toUpperCase(), result.code), { status: result.status });
  }
  return NextResponse.json({ deliveries: result.deliveries });
}
