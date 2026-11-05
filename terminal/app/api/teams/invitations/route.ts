import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createInvite,
  listInvites,
  acceptInvite,
  buildInviteUrl,
  inviteDeliveryBlock,
  INVITE_MESSAGES,
  TEAM_ROUTE_MESSAGES,
  type TenancyRpcDb,
} from "@/lib/teams";

export const runtime = "nodejs";

// The ONE named route for MO-PAID-082 / MO-PAID-081 / MO-PAID-083's write surface.
// Plain-language law: every response body is { message, messageZh } drawn from INVITE_MESSAGES --
// no raw Postgres text ever reaches the body.
//
// MO-PAID-081 (seat ruling W9T_F12_17, link-only): this server sends no invitation mail, so a
// created invitation answers with the link the caller copies and sends themselves, plus a
// `delivery` block that says so and dates the check. Both the create answer and the list answer
// carry that block -- the list is where an unsent invitation is still sitting.

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

/**
 * The origin an invitation link must carry. Production sits behind a proxy, so the forwarded
 * host/proto is the address a person can actually open; `req.url` is the loopback the runtime
 * saw. Neither is trusted blindly -- the token is the only secret in the link and it is already
 * one-time and expiring.
 */
function publicOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
  const forwardedProto = (req.headers.get("x-forwarded-proto") || "").split(",")[0].trim();
  const proto = forwardedProto || url.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
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
    // Audit heal of t#514 (H2): name the cause. Absence (this server has no team tables) stays
    // UNAVAILABLE; any other read failure is READ_FAILED. They are never collapsed into one
    // sentence, and `result.error` — which may embed raw Postgres text — is logged, never returned.
    console.error("teams invitations GET failed:", result.error);
    return NextResponse.json(bodyFor(result.reason === "unavailable" ? "unavailable" : "read_failed"), { status: 503 });
  }
  return NextResponse.json({
    invites: result.invites,
    callerRole: result.callerRole,
    truncated: result.truncated,
    delivery: { code: "no_email_delivery", ...inviteDeliveryBlock() },
  });
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
      if (result.code === "owner_only_admin") {
        const [message, messageZh] = TEAM_ROUTE_MESSAGES.owner_only_admin;
        return NextResponse.json({ error: "FORBIDDEN", message, messageZh }, { status: 403 });
      }
      const code = (result.code ?? "failed") as keyof typeof INVITE_MESSAGES;
      return NextResponse.json(bodyFor(code), { status: result.status });
    }
    return NextResponse.json(
      {
        invite: result.value.invite,
        token: result.value.token,
        inviteUrl: buildInviteUrl(publicOrigin(req), result.value.token),
        acceptWith: { action: "accept" },
        delivery: { code: "no_email_delivery", ...inviteDeliveryBlock() },
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
  const [msg, msgZh] = ["You have joined the team.", "你已加入该团队。"];
  return NextResponse.json({ ok: true, teamId: result.teamId, role: result.role, message: msg, messageZh: msgZh });
}
