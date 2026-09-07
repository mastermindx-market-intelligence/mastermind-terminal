import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createTeam,
  listTeams,
  normalizeTeamName,
  TEAM_ROUTE_MESSAGES,
  type TeamRouteCode,
  type TenancyDb,
} from "@/lib/teams";

export const runtime = "nodejs";

// Owner-scoped tenancy API (F12). Same shape as app/api/watchlist and app/api/portfolio:
// resolveDb() -> RLS'd client, GET reads the whole owner-scoped inventory, POST switches on
// `action`. No fixture-DB branch here (no UI / no Playwright spec in this packet — see the
// packet's owned-paths note: watchlistsFixtureDb.ts is not extended by F12).
//
// TWO-ORGANISMS LAW (UWP-R2): teams grant nothing. Entitlement authority stays macro-api;
// nothing here reads or writes `profiles.is_pro`.
//
// Plain-language law: every user-facing body is { message, messageZh } from TEAM_ROUTE_MESSAGES.

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
const invalid = (code: TeamRouteCode) =>
  NextResponse.json(errorBody("INVALID", code), { status: 400 });
const readFail = (reason: "unavailable" | "failed", error: string) =>
  reason === "unavailable"
    ? NextResponse.json(errorBody("READ_UNAVAILABLE", "unavailable"), { status: 503 })
    : NextResponse.json(errorBody("READ_FAILED", "read_failed"), { status: 503 });
const writeFail = () =>
  NextResponse.json(errorBody("WRITE_FAILED", "write_failed"), { status: 500 });

export async function GET() {
  const session = await resolveDb();
  if (!session) return unauthenticated();
  const result = await listTeams(session.db, session.userId);
  if (!result.ok) {
    console.error("teams GET failed:", result.error);
    return readFail(result.reason, result.error);
  }
  return NextResponse.json({ teams: result.teams, truncated: result.truncated });
}

export async function POST(req: Request) {
  const session = await resolveDb();
  if (!session) return unauthenticated();

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return invalid("send_json");
  if (body.action !== undefined && body.action !== "create") return invalid("unrecognised_action");

  const name = normalizeTeamName(body.name);
  if (!name) return invalid("team_name_required");

  const result = await createTeam(session.db, session.userId, name);
  if (!result.ok) {
    if (result.reason === "unavailable") return readFail("unavailable", result.error);
    if (result.reason === "invalid") return invalid("team_name_required");
    console.error("teams POST failed:", result.error);
    return writeFail();
  }
  return NextResponse.json({ team: result.value }, { status: 201 });
}
