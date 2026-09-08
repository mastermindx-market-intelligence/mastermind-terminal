import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createInvite,
  listInvites,
  acceptInvite,
  INVITE_MESSAGES,
  type TenancyRpcDb,
} from "@/lib/teams";

export const runtime = "nodejs";

// The ONE named route for MO-PAID-082 / MO-PAID-081 / MO-PAID-083's write surface.
// Plain-language law: every response body is { message, messageZh } drawn from INVITE_MESSAGES --
// no raw Postgres text ever reaches the body.

async function resolveDb(): Promise<{ db: TenancyRpcDb; userId: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { db: supabase as unknown as TenancyRpcDb, userId: user.id };
}

function bodyFor(code: keyof typeof INVITE_MESSAGES, extra?: Record<string, unknown>) {
  const [message, messageZh] = INVITE_MESSAGES[code];
  return { error: code.toUpperCase(), message, messageZh, ...extra };
}

const unauthenticated = () =>
  NextResponse.json(bodyFor("not_signed_in"), { status: 401 });
const invalidAction = () =>
  NextResponse.json({ error: "INVALID", message: "We do not recognise that action.", messageZh: "我们无法识别该操作。" }, { status: 400 });

export async function GET(req: Request) {
  const session = await resolveDb();
  if (!session) return unauthenticated();
  const { searchParams } = new URL(req.url);
  const teamId = searchParams.get("teamId");
  if (!teamId) return NextResponse.json(bodyFor("team_not_found"), { status: 404 });
  const result = await listInvites(session.db, session.userId, teamId);
  if (!result.ok) {
    if (result.reason === "forbidden") return NextResponse.json(bodyFor("not_admin"), { status: 403 });
    if (result.reason === "not_found") return NextResponse.json(bodyFor("team_not_found"), { status: 404 });
    return NextResponse.json(bodyFor("unavailable"), { status: 503 });
  }
  return NextResponse.json({ invites: result.invites, callerRole: result.callerRole, truncated: result.truncated });
}

export async function POST(req: Request) {
  const session = await resolveDb();
  if (!session) return unauthenticated();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || (body.action !== "create" && body.action !== "accept")) return invalidAction();

  if (body.action === "create") {
    const teamId = typeof body.teamId === "string" ? body.teamId : "";
    if (!teamId) return NextResponse.json(bodyFor("team_not_found"), { status: 404 });
    const result = await createInvite(session.db, session.userId, teamId, { email: body.email, role: body.role });
    if (!result.ok) {
      const code = (result.code ?? "failed") as keyof typeof INVITE_MESSAGES;
      return NextResponse.json(bodyFor(code), { status: result.status });
    }
    const [msg, msgZh] = INVITE_MESSAGES.no_email_delivery;
    return NextResponse.json(
      {
        invite: result.value.invite,
        token: result.value.token,
        acceptWith: { action: "accept" },
        delivery: { sent: false, code: "no_email_delivery", message: msg, messageZh: msgZh },
      },
      { status: 201 },
    );
  }

  // action === "accept": read ONLY body.token. Any userId/email/teamId/role present alongside it
  // is ignored and never forwarded -- the accepting identity comes from the session (and, inside
  // the database, from auth.uid() in the definer function).
  const result = await acceptInvite(session.db, body.token);
  if (!result.ok) {
    return NextResponse.json(bodyFor(result.code), { status: result.status });
  }
  const [msg, msgZh] = ["You have joined the team.", "您已加入该团队。"];
  return NextResponse.json({ ok: true, teamId: result.teamId, role: result.role, message: msg, messageZh: msgZh });
}
