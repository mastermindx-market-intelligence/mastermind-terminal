import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { patchEndpoint, WEBHOOK_ROUTE_MESSAGES, type WebhookRouteCode } from "@/lib/webhooks";
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

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await resolveDb();
  if (!session) {
    return NextResponse.json(errorBody("UNAUTHENTICATED", "not_signed_in"), { status: 401 });
  }
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json(errorBody("INVALID", "send_json"), { status: 400 });
  const result = await patchEndpoint(session.db, session.userId, id, body);
  if (!result.ok) {
    return NextResponse.json(errorBody(result.code.toUpperCase(), result.code), { status: result.status });
  }
  return NextResponse.json({
    endpoint: {
      id: result.endpoint.id,
      teamId: result.endpoint.teamId,
      url: result.endpoint.url,
      enabled: result.endpoint.enabled,
      eventFilter: result.endpoint.eventFilter,
      createdBy: result.endpoint.createdBy,
      createdAt: result.endpoint.createdAt,
    },
  });
}
