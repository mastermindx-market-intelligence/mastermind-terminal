import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createEndpoint,
  listEndpoints,
  WEBHOOK_ROUTE_MESSAGES,
  type WebhookRouteCode,
} from "@/lib/webhooks";
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

const unauthenticated = () =>
  NextResponse.json(errorBody("UNAUTHENTICATED", "not_signed_in"), { status: 401 });

export async function GET(req: Request) {
  const session = await resolveDb();
  if (!session) return unauthenticated();
  const teamId = new URL(req.url).searchParams.get("teamId") || "";
  if (!teamId) {
    return NextResponse.json(errorBody("INVALID", "team_required"), { status: 400 });
  }
  const result = await listEndpoints(session.db, session.userId, teamId);
  if (!result.ok) {
    if (result.reason === "not_found") {
      return NextResponse.json(errorBody("NOT_FOUND", "not_found"), { status: 404 });
    }
    if (result.reason === "forbidden") {
      return NextResponse.json(errorBody("FORBIDDEN", "not_admin"), { status: 403 });
    }
    return NextResponse.json(
      errorBody(result.reason === "unavailable" ? "READ_UNAVAILABLE" : "READ_FAILED", result.reason === "unavailable" ? "unavailable" : "read_failed"),
      { status: 503 },
    );
  }
  const endpoints = result.endpoints.map((e) => ({
    id: e.id,
    teamId: e.teamId,
    url: e.url,
    enabled: e.enabled,
    eventFilter: e.eventFilter,
    createdBy: e.createdBy,
    createdAt: e.createdAt,
  }));
  return NextResponse.json({ endpoints, callerRole: result.callerRole, truncated: result.truncated });
}

export async function POST(req: Request) {
  const session = await resolveDb();
  if (!session) return unauthenticated();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json(errorBody("INVALID", "send_json"), { status: 400 });
  const result = await createEndpoint(session.db, session.userId, {
    teamId: body.teamId,
    url: body.url,
    event_filter: body.event_filter,
  });
  if (!result.ok) {
    return NextResponse.json(errorBody(result.code.toUpperCase(), result.code), { status: result.status });
  }
  return NextResponse.json(
    {
      endpoint: {
        id: result.endpoint.id,
        teamId: result.endpoint.teamId,
        url: result.endpoint.url,
        enabled: result.endpoint.enabled,
        eventFilter: result.endpoint.eventFilter,
        createdBy: result.endpoint.createdBy,
        createdAt: result.endpoint.createdAt,
      },
      secret: result.secret,
    },
    { status: 201 },
  );
}
