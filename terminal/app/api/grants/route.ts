import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createGrant,
  GRANT_ROUTE_MESSAGES,
  listGrants,
  revokeGrant,
  type GrantRouteCode,
  type GrantsDb,
} from "@/lib/resourceGrants";

export const runtime = "nodejs";

// Owner-scoped explicit-grant API (F12 packet B-F12-B5-1). Same shape as app/api/teams:
// resolveDb() -> RLS'd client, GET reads the caller's shares, POST/DELETE switch on the body.
//
// Plain-language law: every user-facing body is { message, messageZh } from GRANT_ROUTE_MESSAGES.
// `error` is a coarse machine token (UNAUTHENTICATED / INVALID / …), never a route code and
// never a raw enum.

async function resolveDb(): Promise<{ db: GrantsDb; userId: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { db: supabase as unknown as GrantsDb, userId: user.id };
}

function errorBody(error: string, code: GrantRouteCode) {
  const [message, messageZh] = GRANT_ROUTE_MESSAGES[code];
  return { error, message, messageZh };
}

const unauthenticated = () =>
  NextResponse.json(errorBody("UNAUTHENTICATED", "not_signed_in"), { status: 401 });
const invalid = (code: GrantRouteCode) =>
  NextResponse.json(errorBody("INVALID", code), { status: 400 });
const notFound = (code: GrantRouteCode = "grant_not_found") =>
  NextResponse.json(errorBody("NOT_FOUND", code), { status: 404 });
const unavailable = () =>
  NextResponse.json(errorBody("UNAVAILABLE", "unavailable"), { status: 503 });
const readFail = () =>
  NextResponse.json(errorBody("READ_FAILED", "read_failed"), { status: 500 });
const writeFail = () =>
  NextResponse.json(errorBody("WRITE_FAILED", "write_failed"), { status: 500 });

export async function GET() {
  const session = await resolveDb();
  if (!session) return unauthenticated();
  const result = await listGrants(session.db, session.userId);
  if (!result.ok) {
    console.error("grants GET failed:", result.error);
    return result.reason === "unavailable" ? unavailable() : readFail();
  }
  return NextResponse.json({ shared: result.shared, sharedWithMe: result.sharedWithMe });
}

export async function POST(req: Request) {
  const session = await resolveDb();
  if (!session) return unauthenticated();

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return invalid("send_json");

  const result = await createGrant(session.db, session.userId, body);
  if (!result.ok) {
    if (result.status === 400) return invalid(result.code);
    if (result.status === 404) return notFound(result.code);
    if (result.status === 503) return unavailable();
    console.error("grants POST failed:", result.error);
    return writeFail();
  }
  if (result.status === 200) {
    const [message, messageZh] = GRANT_ROUTE_MESSAGES.already_shared;
    return NextResponse.json({ grant: result.grant, message, messageZh }, { status: 200 });
  }
  return NextResponse.json({ grant: result.grant }, { status: 201 });
}

export async function DELETE(req: Request) {
  const session = await resolveDb();
  if (!session) return unauthenticated();

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return invalid("send_json");

  const result = await revokeGrant(session.db, session.userId, body);
  if (!result.ok) {
    if (result.status === 400) return invalid(result.code);
    if (result.status === 404) return notFound(result.code);
    if (result.status === 503) return unavailable();
    console.error("grants DELETE failed:", result.error);
    return writeFail();
  }
  return NextResponse.json({ ok: true });
}
