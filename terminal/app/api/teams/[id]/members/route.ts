import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  addMember,
  changeMemberRole,
  listMemberNames,
  listMembers,
  removeMember,
  TEAM_ROUTE_MESSAGES,
  type InvalidCode,
  type TeamRouteCode,
  type TenancyDb,
} from "@/lib/teams";

export const runtime = "nodejs";

// Plain-language law (Chairman ruling, M3): lib/teams.ts returns a stable internal `code`, never
// a raw Postgres/lib message, as the response `message` — every string below is a complete
// sentence, never a lowercase fragment or an internal identifier. Each body also carries
// messageZh from TEAM_ROUTE_MESSAGES.
const INVALID_CODES: Record<InvalidCode, TeamRouteCode> = {
  invalid_role: "invalid_role",
  invalid_user_id: "invalid_user_id",
  user_not_found: "user_not_found",
  email_not_supported: "email_not_supported",
  missing_target: "missing_target",
};

async function resolveDb(): Promise<{ db: TenancyDb; userId: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { db: supabase as unknown as TenancyDb, userId: user.id };
}

function errorBody(error: string, code: TeamRouteCode) {
  const [message, messageZh] = TEAM_ROUTE_MESSAGES[code];
  return { error, message, messageZh };
}

const unauthenticated = () =>
  NextResponse.json(errorBody("UNAUTHENTICATED", "not_signed_in"), { status: 401 });
const invalid = (code: TeamRouteCode, status = 400) =>
  NextResponse.json(errorBody("INVALID", code), { status });
const forbidden = (code: TeamRouteCode) =>
  NextResponse.json(errorBody("FORBIDDEN", code), { status: 403 });
const notFound = () =>
  NextResponse.json(errorBody("NOT_FOUND", "team_not_found"), { status: 404 });
const duplicate = () =>
  NextResponse.json(errorBody("DUPLICATE", "already_on_team"), { status: 409 });
const readFail = (reason: "unavailable" | "failed", error: string) =>
  reason === "unavailable"
    ? NextResponse.json(errorBody("READ_UNAVAILABLE", "unavailable"), { status: 503 })
    : NextResponse.json(errorBody("READ_FAILED", "read_failed"), { status: 503 });
const writeFail = () =>
  NextResponse.json(errorBody("WRITE_FAILED", "write_failed"), { status: 500 });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await resolveDb();
  if (!session) return unauthenticated();
  const { id } = await ctx.params;
  if (!id) return invalid("team_id_required");

  const result = await listMembers(session.db, session.userId, id);
  if (!result.ok) {
    if (result.reason === "forbidden") return forbidden("not_member");
    if (result.reason === "not_found") return notFound();
    console.error("team members GET failed:", result.error);
    return readFail(result.reason, result.error);
  }
  const named = await listMemberNames(session.db, id);
  const names = named.ok ? named.names : new Map<string, string>();
  const members = result.members.map((m) => ({
    ...m,
    displayName: names.get(m.userId) ?? null,
  }));
  return NextResponse.json({ members, callerRole: result.callerRole, truncated: result.truncated });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await resolveDb();
  if (!session) return unauthenticated();
  const { id } = await ctx.params;
  if (!id) return invalid("team_id_required");

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return invalid("send_json");

  const result = await addMember(session.db, session.userId, id, {
    userId: body.userId,
    email: body.email,
    role: body.role,
  });
  if (!result.ok) {
    if (result.reason === "forbidden") {
      const code: TeamRouteCode =
        result.code && result.code in TEAM_ROUTE_MESSAGES ? (result.code as TeamRouteCode) : "not_admin_add";
      return forbidden(code);
    }
    if (result.reason === "not_found") return notFound();
    if (result.reason === "duplicate") return duplicate();
    if (result.reason === "invalid") {
      const mapped = result.code && result.code in INVALID_CODES ? INVALID_CODES[result.code as InvalidCode] : undefined;
      return invalid(mapped ?? "invalid_request", result.status);
    }
    if (result.reason === "unavailable") return readFail("unavailable", result.error);
    console.error("team members POST failed:", result.error);
    return writeFail();
  }
  // MO-PAID-081 (invite-by-email) is not absorbed by this packet — addMember's only success path
  // is adding an existing account by user id; there is no invite/token branch to handle here.
  return NextResponse.json({ member: result.value.member }, { status: 201 });
}

function gateCode(code: string | undefined, fallback: TeamRouteCode): TeamRouteCode {
  return code && code in TEAM_ROUTE_MESSAGES ? (code as TeamRouteCode) : fallback;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await resolveDb();
  if (!session) return unauthenticated();
  const { id } = await ctx.params;
  if (!id) return invalid("team_id_required");

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return invalid("send_json");
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  if (!userId) return invalid("invalid_user_id");

  const result = await changeMemberRole(session.db, session.userId, id, userId, body.role);
  if (!result.ok) {
    if (result.reason === "forbidden") return forbidden(gateCode(result.code, "role_change_failed"));
    if (result.reason === "not_found") {
      return NextResponse.json(errorBody("NOT_FOUND", gateCode(result.code, "team_not_found")), { status: 404 });
    }
    if (result.reason === "invalid") {
      return invalid(gateCode(result.code, "invalid_request"), result.status);
    }
    if (result.reason === "unavailable") return readFail("unavailable", result.error);
    console.error("team members PATCH failed:", result.error);
    return writeFail();
  }
  return NextResponse.json({ member: result.value });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await resolveDb();
  if (!session) return unauthenticated();
  const { id } = await ctx.params;
  if (!id) return invalid("team_id_required");

  const userId = new URL(req.url).searchParams.get("userId")?.trim() || "";
  if (!userId) return invalid("invalid_user_id");

  const result = await removeMember(session.db, session.userId, id, userId);
  if (!result.ok) {
    if (result.reason === "forbidden") return forbidden(gateCode(result.code, "remove_failed"));
    if (result.reason === "not_found") {
      return NextResponse.json(errorBody("NOT_FOUND", gateCode(result.code, "team_not_found")), { status: 404 });
    }
    if (result.reason === "invalid") {
      return invalid(gateCode(result.code, "invalid_request"), result.status);
    }
    if (result.reason === "unavailable") return readFail("unavailable", result.error);
    console.error("team members DELETE failed:", result.error);
    return writeFail();
  }
  return NextResponse.json({ ok: true, userId: result.value.userId });
}
