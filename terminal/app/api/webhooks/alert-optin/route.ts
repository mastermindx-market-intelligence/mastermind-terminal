import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/teams";
import { readAlertOptin, writeAlertOptin, WEBHOOK_ROUTE_MESSAGES, type WebhookRouteCode } from "@/lib/webhooks";
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

function teamIdFrom(req: Request): string | null {
  const raw = new URL(req.url).searchParams.get("teamId") || "";
  const teamId = raw.trim();
  if (!teamId || !isUuid(teamId)) return null;
  return teamId;
}

export async function GET(req: Request) {
  const session = await resolveDb();
  if (!session) {
    return NextResponse.json(errorBody("UNAUTHENTICATED", "not_signed_in"), { status: 401 });
  }
  const teamId = teamIdFrom(req);
  if (!teamId) {
    return NextResponse.json(errorBody("INVALID", "team_required"), { status: 400 });
  }
  const result = await readAlertOptin(session.db, session.userId, teamId);
  if (!result.ok) {
    return NextResponse.json(errorBody(result.code.toUpperCase(), result.code), { status: result.status });
  }
  return NextResponse.json({ enabled: result.enabled });
}

export async function PUT(req: Request) {
  const session = await resolveDb();
  if (!session) {
    return NextResponse.json(errorBody("UNAUTHENTICATED", "not_signed_in"), { status: 401 });
  }
  const teamId = teamIdFrom(req);
  if (!teamId) {
    return NextResponse.json(errorBody("INVALID", "team_required"), { status: 400 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.enabled !== "boolean") {
    return NextResponse.json(errorBody("INVALID", "send_json"), { status: 400 });
  }
  const result = await writeAlertOptin(session.db, session.userId, teamId, body.enabled);
  if (!result.ok) {
    return NextResponse.json(errorBody(result.code.toUpperCase(), result.code), { status: result.status });
  }
  return NextResponse.json({ ok: true, enabled: result.enabled });
}
