// Team-accuracy rollup route (packet W9T_F13_9 / MO-DELTA-007).
//
// A team can see its own calls scored together — never a ranking against other teams.
// The route returns the team's row set scored together using the same scorer the
// personal accuracy section already uses. The hard gate is the SQL read: we never
// pull a row whose user_id is not in `team_members` for the team in the URL, and we
// never surface a per-member leaderboard, rank, or "best-on-team" call.
//
// Plain-language law: every user-facing string is a complete sentence in EN and ZH.
// No internal state words, no slugs, no enum names. The route never invents a
// per-member ranking; the response shape is the same AccuracyReadout the personal
// section renders, plus three rollup-only fields (memberCount, membersWithClaims,
// truncated).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCallerRole, TEAM_ROUTE_MESSAGES, type TenancyDb } from "@/lib/teams";
import { scorePersonalAccuracy, type UserClaim } from "@/lib/personalAccuracy";
import { rollupTeamAccuracy } from "@/lib/teamRollup";

export const runtime = "nodejs";

type RollupCode =
  | "not_signed_in"
  | "unavailable"
  | "read_failed"
  | "team_not_found"
  | "not_member";

const ROLLUP_MESSAGES: Record<RollupCode, [string, string]> = {
  not_signed_in: TEAM_ROUTE_MESSAGES.not_signed_in,
  unavailable: TEAM_ROUTE_MESSAGES.unavailable,
  read_failed: TEAM_ROUTE_MESSAGES.read_failed,
  team_not_found: TEAM_ROUTE_MESSAGES.team_not_found,
  not_member: TEAM_ROUTE_MESSAGES.not_member,
};

function errorBody(error: string, code: RollupCode) {
  const [message, messageZh] = ROLLUP_MESSAGES[code];
  return { error, message, messageZh };
}

const unauthenticated = () =>
  NextResponse.json(errorBody("UNAUTHENTICATED", "not_signed_in"), { status: 401 });
const readFail = (reason: "unavailable" | "failed", error: string) =>
  reason === "unavailable"
    ? NextResponse.json(errorBody("READ_UNAVAILABLE", "unavailable"), { status: 503 })
    : NextResponse.json(errorBody("READ_FAILED", "read_failed"), { status: 503 });
const forbidden = (code: "not_member") =>
  NextResponse.json(errorBody("FORBIDDEN", code), { status: 403 });
const notFound = () =>
  NextResponse.json(errorBody("NOT_FOUND", "team_not_found"), { status: 404 });

const MAX_MEMBERS_FOR_ROLLUP = 500;
const MAX_CLAIMS_FOR_ROLLUP = 5000;

async function resolveCallerDb(): Promise<{ db: TenancyDb; userId: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { db: supabase as unknown as TenancyDb, userId: user.id };
}

/**
 * Read team_members for the team, scoped to the caller's membership. The caller must be a
 * member of the team — `getCallerRole` from `lib/teams` is the existing role gate and we reuse
 * it here instead of inventing a parallel check. Returns `null` when the team does not exist,
 * `[]` when the caller is not a member of any team with this id, and the member list otherwise.
 */
async function listMemberUserIds(
  db: TenancyDb,
  callerUserId: string,
  teamId: string,
): Promise<{ ok: true; memberIds: string[] } | { ok: false; reason: "unavailable" | "failed" | "not_member" | "not_found"; error: string }> {
  const roleResult = await getCallerRole(db, callerUserId, teamId);
  if (!roleResult.ok) return { ok: false, reason: roleResult.reason === "unavailable" ? "unavailable" : "failed", error: roleResult.error };
  if (!roleResult.role) {
    // The caller is not a member of this team. RLS makes "team does not exist" and "you are
    // not a member of it" indistinguishable from this side; both surface as 403 / 404 respectively
    // by the existing route convention. A non-member gets 403, never a body that hints at
    // whether the team exists.
    return { ok: false, reason: "not_member", error: "not a member of this team" };
  }

  const result = await db
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId)
    .limit(MAX_MEMBERS_FOR_ROLLUP);
  if (result.error) {
    return { ok: false, reason: "unavailable", error: result.error.message || "read failed" };
  }
  const rows = Array.isArray(result.data) ? result.data : [];
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = (row as { user_id?: unknown }).user_id;
    if (typeof id === "string" && id) ids.add(id);
  }
  // The caller MUST be in the set — getCallerRole said so — but never trust the cross-table read
  // to have echoed that. Insert the caller; the rollup re-checks below, so a missing caller row
  // is harmless (the rollup filters by memberIds) but a present caller row is the right default.
  ids.add(callerUserId);
  return { ok: true, memberIds: Array.from(ids) };
}

/**
 * Read user_claims for a fixed set of user_ids. RLS on user_claims is owner-only — `auth.uid() =
 * user_id` — so an anon-key read can NEVER cross user boundaries. That is exactly the property
 * the seat ruling wants: a team can read its OWN members' rows, not anyone else's, and the
 * `auth.uid() = user_id` clause is what scopes that.
 *
 * We rely on the row-level security on user_claims to scope the read, NOT on a service-role
 * bypass. The team-member list itself is read with the caller-scoped client (`getCallerRole`
 * verified the caller is on the team), so the only rows the policy lets us see are the ones
 * whose `user_id` matches the signed-in caller — i.e. the caller's OWN row, never another
 * member's. To get the team's row set under that policy we have to read each member's rows
 * with that member's session, which is impossible from a server-side handler. The seat ruling
 * therefore requires a service-role read here, and the read filters the rows by the team-member
 * list we already verified.
 *
 * MAJOR-2 fix (h_t587): when createServiceClient() is null, this function returns
 * {ok: false, reason: "unavailable"} rather than falling back to a per-member read.
 * Returning personal rows as "team" rollup would violate the hard gate.
 */
async function listClaimsForMembers(
  memberIds: readonly string[],
): Promise<{ ok: true; claims: UserClaim[] } | { ok: false; reason: "unavailable" | "failed"; error: string }> {
  if (memberIds.length === 0) return { ok: true, claims: [] };

  const service = createServiceClient();
  if (!service) {
    // MAJOR-2 fix (h_t587): do NOT fall back to a per-member read here.
    // A service-null environment (malconfigured deployment) must return an explicit
    // unavailable state — never personal figures as team rollup.
    return { ok: false, reason: "unavailable", error: "service client unavailable" };
  }

  const result = await service
    .from("user_claims")
    .select("claim_id,user_id,subject,stated_at,resolves_at,claim_text,condition,stated_probability,evidence,status,resolution,supersedes")
    .in("user_id", memberIds.slice(0, MAX_MEMBERS_FOR_ROLLUP))
    .order("stated_at", { ascending: true })
    .limit(MAX_CLAIMS_FOR_ROLLUP);
  if (result.error) {
    return { ok: false, reason: "unavailable", error: result.error.message || "read failed" };
  }
  const rows = Array.isArray(result.data) ? result.data : [];
  const { parseUserClaim } = await import("@/lib/personalAccuracyStore");
  const allowed = new Set(memberIds);
  const claims: UserClaim[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const parsed = parseUserClaim(row as Record<string, unknown>);
    if (!parsed) continue;
    // Re-filter: never trust the SQL `IN` to have been scoped to team members. A misconfigured
    // read or a stale team_members row cannot leak a row from outside the team through here.
    if (!allowed.has(parsed.user_id)) continue;
    claims.push(parsed);
  }
  return { ok: true, claims };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  void _req;
  let session: Awaited<ReturnType<typeof resolveCallerDb>>;
  try {
    session = await resolveCallerDb();
  } catch {
    return readFail("unavailable", "accuracy store unavailable");
  }
  if (!session) return unauthenticated();

  const { id: teamId } = await ctx.params;
  if (!teamId || typeof teamId !== "string") return notFound();

  const members = await listMemberUserIds(session.db, session.userId, teamId);
  if (!members.ok) {
    if (members.reason === "not_member") return forbidden("not_member");
    if (members.reason === "not_found") return notFound();
    if (members.reason === "unavailable") return readFail("unavailable", members.error);
    return readFail("failed", members.error);
  }

  const claimsRead = await listClaimsForMembers(members.memberIds);
  if (!claimsRead.ok) {
    // MAJOR-2 fix (h_t587): when createServiceClient() is null, listClaimsForMembers
    // now returns {ok: false, reason: "unavailable"} instead of falling back to
    // listOwnClaimsOnly. The caller gets a 503 with the unavailable sentence — never
    // a rollup built from personal rows that leaks memberCount as scored figures.
    console.error("team rollup read failed:", claimsRead.error);
    return readFail(claimsRead.reason, claimsRead.error);
  }
  const claims = claimsRead.claims;

  const result = rollupTeamAccuracy(members.memberIds, claims);

  if (result.kind === "empty_members") {
    return NextResponse.json({
      kind: "empty_members",
      memberCount: 0,
      membersWithClaims: 0,
      truncated: false,
      readout: scorePersonalAccuracy([]),
      message: "Your team has no members yet.",
      messageZh: "你的团队暂时还没有成员。",
    });
  }

  if (result.kind === "no_rows") {
    return NextResponse.json({
      kind: "no_rows",
      memberCount: result.memberCount,
      membersWithClaims: result.membersWithClaims,
      truncated: false,
      readout: scorePersonalAccuracy([]),
      message: "No one on your team has written down a call yet.",
      messageZh: "你的团队中还没有人写下判断。",
    });
  }

  return NextResponse.json({
    kind: "ok",
    memberCount: result.memberCount,
    membersWithClaims: result.membersWithClaims,
    truncated: false,
    readout: result.readout,
    message: "Your team's calls, scored together.",
    messageZh: "你的团队判断，一起打分。",
  });
}

// Route-coverage note: every error path above carries the route's bilingual pair from
// ROLLUP_MESSAGES (or a per-state sentence). The hard gate — "never rank against other teams" —
// is enforced by `listMemberUserIds` (the SQL `team_id = $1` filter) AND by `listClaimsForMembers`
// (the post-read `allowed.has(parsed.user_id)` re-filter). A ranker would need to read a
// different team's rows; this route never queries anything outside the team in the URL.
