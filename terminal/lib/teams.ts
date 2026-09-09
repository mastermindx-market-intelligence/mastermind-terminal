// Tenancy foundation service (packet B-F12-1).
//
// Shape authority is `supabase/migrations/0014_tenancy_foundation.sql` (NOT yet applied — see its
// header). Structural narrowing follows `lib/watchlists.ts` / `lib/portfolio.ts`: the same
// `WatchlistDb` shape backs the real Supabase client, the e2e fixture transport, and unit tests.
//
// Absence is a FACT, never an empty result (lib/portfolio.ts:233-241 idiom): any read error is
// classified into `"unavailable"` (table/schema-cache absent) or `"failed"` (anything else) and
// NEVER collapsed into `{ok:true, teams:[]}`.
//
// Belt-and-braces owner scoping: RLS is the authority; every query here also carries an explicit
// `.eq("user_id", userId)` / `.eq("team_id", teamId)` filter.
//
// TWO-ORGANISMS LAW (UWP-R2): teams grant nothing. Entitlement authority remains macro-api;
// nothing here reads or writes `profiles.is_pro`.

import crypto from "node:crypto";
import type { DbResult, DbRow, WatchlistDb } from "@/lib/watchlists";

export type TenancyDb = WatchlistDb;
export type TeamRole = "owner" | "admin" | "member";
export type Team = { id: string; name: string; role: TeamRole; createdAt: string | null };
export type Member = {
  userId: string;
  role: TeamRole;
  invitedBy: string | null;
  createdAt: string | null;
  displayName?: string | null;
};
export type Invite = { id: string; email: string; role: TeamRole; expiresAt: string | null; acceptedAt: string | null };

export const TEAMS_TABLE = "teams";
export const TEAM_MEMBERS_TABLE = "team_members";
export const TEAM_INVITES_TABLE = "team_invites";
export const MAX_TEAM_NAME_LEN = 120;
export const MAX_TEAMS = 200;
export const MAX_MEMBERS = 500;
export const INVITE_TTL_DAYS = 14;

const ROLES: readonly TeamRole[] = ["owner", "admin", "member"];
const ADD_ROLES: readonly TeamRole[] = ["admin", "member"];
// eslint-disable-next-line no-control-regex
const HAS_CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/** Absence is classified by CODE ONLY — never by message prose (README:26-39 idiom). */
export function isAbsentTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error || !error.code) return false;
  return error.code === "42P01" || error.code === "PGRST205";
}

/**
 * A database-level permission denial (round-4 ruling R4(i)). 0019 uses one deliberately: a
 * forbidden DELETE raises 42501 through team_members_rls_deny() rather than filtering to zero
 * rows, and tm_update_admin's WITH CHECK raises it too. Both mean the same thing as the zero-row
 * result the write paths already turn into a 403 — so they must not fall through to a 500.
 * Classified by CODE ONLY, never by message prose (README:26-39 idiom).
 */
export function isPermissionDeniedError(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error && error.code === "42501");
}

export function normalizeTeamName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_TEAM_NAME_LEN) return null;
  if (HAS_CONTROL_CHARS.test(trimmed)) return null;
  return trimmed;
}

export function normalizeRole(value: unknown): TeamRole | null {
  if (typeof value !== "string") return null;
  const lowered = value.trim().toLowerCase();
  return (ROLES as readonly string[]).includes(lowered) ? (lowered as TeamRole) : null;
}

function normalizeAddRole(value: unknown): TeamRole | null {
  if (value === undefined || value === null || value === "") return "member";
  if (typeof value !== "string") return null;
  const lowered = value.trim().toLowerCase();
  return (ADD_ROLES as readonly string[]).includes(lowered) ? (lowered as TeamRole) : null;
}

/** PATCH nextRole: omitted, empty, or anything outside admin/member is invalid. Never default. */
function normalizeChangeRole(value: unknown): TeamRole | null {
  if (typeof value !== "string") return null;
  const lowered = value.trim().toLowerCase();
  if (!lowered) return null;
  return (ADD_ROLES as readonly string[]).includes(lowered) ? (lowered as TeamRole) : null;
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > 254) return null;
  if (HAS_CONTROL_CHARS.test(trimmed)) return null;
  const at = trimmed.indexOf("@");
  if (at <= 0 || at !== trimmed.lastIndexOf("@")) return null;
  const domain = trimmed.slice(at + 1);
  if (!domain || !domain.includes(".")) return null;
  return trimmed;
}

export function newInviteToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

export function inviteTokenHash(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export type ReadFail = { ok: false; reason: "unavailable" | "failed"; error: string };
// `truncated` (house idiom — lib/aggTrend.ts, lib/searchEvents.ts): true when the result hit
// MAX_TEAMS/MAX_MEMBERS, so a 200th team is never silently indistinguishable from "you have
// exactly 200 teams" (m1).
export type TeamsRead = { ok: true; teams: Team[]; truncated: boolean } | ReadFail;
export type MembersRead =
  | { ok: true; members: Member[]; callerRole: TeamRole; truncated: boolean }
  | { ok: false; reason: "unavailable" | "failed" | "forbidden" | "not_found"; error: string };
// `code` is the STABLE, internal reason a caller-side "invalid"/"duplicate" failed — plain-language
// law (Chairman ruling, M3): the route maps `code` to a complete-sentence `message`, and `error`
// (free-text, may embed a raw Postgres message) never reaches the HTTP response body directly.
export type InvalidCode = "invalid_role" | "invalid_user_id" | "user_not_found" | "email_not_supported" | "missing_target";
export type RoleGateCode =
  | "owner_only"
  | "owner_only_admin"
  | "owner_only_change_admin"
  | "owner_only_remove_admin"
  | "owner_locked"
  | "owner_cannot_leave"
  | "no_self_role"
  | "not_on_team"
  | "same_role"
  | "role_change_failed"
  | "remove_failed"
  | "not_member"
  | "remove_not_allowed"
  | "not_admin_add"
  | "team_not_found";
export type WriteResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: "unavailable" | "failed" | "forbidden" | "not_found" | "invalid" | "duplicate";
      error: string;
      code?: InvalidCode | RoleGateCode;
      status: number;
    };

function classifyReadError(result: DbResult): ReadFail | null {
  if (result.error) {
    return isAbsentTableError(result.error)
      ? { ok: false, reason: "unavailable", error: result.error.message || "table unavailable" }
      : { ok: false, reason: "failed", error: result.error.message || "read failed" };
  }
  if (!Array.isArray(result.data)) {
    return { ok: false, reason: "failed", error: "malformed response" };
  }
  return null;
}

function toRoleOrNull(value: unknown): TeamRole | null {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value) ? (value as TeamRole) : null;
}

export async function listTeams(db: TenancyDb, userId: string): Promise<TeamsRead> {
  const memberResult = await db
    .from(TEAM_MEMBERS_TABLE)
    .select("team_id,role")
    .eq("user_id", userId)
    .limit(MAX_TEAMS);
  const memberFail = classifyReadError(memberResult);
  if (memberFail) return memberFail;
  const memberRows = memberResult.data as DbRow[];
  // Hitting the limit means there may be more rows beyond it we never fetched — the caller is
  // told, rather than a 201st team silently reading identically to "you have exactly 200".
  const truncated = memberRows.length === MAX_TEAMS;
  if (memberRows.length === 0) return { ok: true, teams: [], truncated };

  const roleByTeam = new Map<string, TeamRole>();
  const ids: string[] = [];
  for (const row of memberRows) {
    const teamId = typeof row.team_id === "string" ? row.team_id : null;
    const role = toRoleOrNull(row.role);
    if (!teamId || !role) continue;
    roleByTeam.set(teamId, role);
    ids.push(teamId);
  }
  if (ids.length === 0) return { ok: true, teams: [], truncated };

  const teamsResult = await db
    .from(TEAMS_TABLE)
    .select("id,name,created_at")
    .in("id", ids)
    .order("created_at", { ascending: true })
    .limit(MAX_TEAMS);
  const teamsFail = classifyReadError(teamsResult);
  if (teamsFail) return teamsFail;
  const teamRows = teamsResult.data as DbRow[];

  const teams: Team[] = teamRows
    .map((row): Team | null => {
      const id = typeof row.id === "string" ? row.id : null;
      const name = typeof row.name === "string" ? row.name : null;
      const role = id ? roleByTeam.get(id) ?? null : null;
      if (!id || !name || !role) return null;
      return { id, name, role, createdAt: typeof row.created_at === "string" ? row.created_at : null };
    })
    .filter((t): t is Team => t !== null);
  return { ok: true, teams, truncated };
}

export async function createTeam(db: TenancyDb, userId: string, name: string): Promise<WriteResult<Team>> {
  const normalized = normalizeTeamName(name);
  if (!normalized) return { ok: false, reason: "invalid", error: "invalid name", status: 400 };
  // created_by is ALWAYS the session id — never taken from caller input beyond `name`.
  const result = await db
    .from(TEAMS_TABLE)
    .insert({ name: normalized, created_by: userId })
    .select("id,name,created_at")
    .maybeSingle();
  if (result.error) {
    return isAbsentTableError(result.error)
      ? { ok: false, reason: "unavailable", error: result.error.message || "unavailable", status: 503 }
      : { ok: false, reason: "failed", error: result.error.message || "insert failed", status: 500 };
  }
  const row = (Array.isArray(result.data) ? result.data[0] : result.data) as DbRow | null;
  if (!row || typeof row.id !== "string") {
    return { ok: false, reason: "failed", error: "insert returned no row", status: 500 };
  }
  return {
    ok: true,
    value: {
      id: row.id,
      name: typeof row.name === "string" ? row.name : normalized,
      role: "owner",
      createdAt: typeof row.created_at === "string" ? row.created_at : null,
    },
  };
}

export async function getCallerRole(
  db: TenancyDb,
  userId: string,
  teamId: string,
): Promise<{ ok: true; role: TeamRole | null } | ReadFail> {
  const result = await db
    .from(TEAM_MEMBERS_TABLE)
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .maybeSingle();
  // classifyReadError() is built for array-shaped results (`.limit()` queries) and would call a
  // `maybeSingle()` object malformed on every no-error response — do not reuse it here, and do not
  // compute an "isAbsentTableError vs other" guard only to discard it on the success path.
  if (result.error) {
    return isAbsentTableError(result.error)
      ? { ok: false, reason: "unavailable", error: result.error.message || "table unavailable" }
      : { ok: false, reason: "failed", error: result.error.message || "read failed" };
  }
  const row = result.data as DbRow | null;
  // A missing row is indistinguishable from "team does not exist" under RLS — both are `role:null`.
  return { ok: true, role: row ? toRoleOrNull(row.role) : null };
}

export async function listMembers(db: TenancyDb, userId: string, teamId: string): Promise<MembersRead> {
  const roleResult = await getCallerRole(db, userId, teamId);
  if (!roleResult.ok) return roleResult;
  if (!roleResult.role) return { ok: false, reason: "forbidden", error: "not a member of this team" };

  const result = await db
    .from(TEAM_MEMBERS_TABLE)
    .select("user_id,role,invited_by,created_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: true })
    .limit(MAX_MEMBERS);
  const fail = classifyReadError(result);
  if (fail) return fail;
  const rows = result.data as DbRow[];
  const members: Member[] = rows
    .map((row): Member | null => {
      const userIdRow = typeof row.user_id === "string" ? row.user_id : null;
      const role = toRoleOrNull(row.role);
      if (!userIdRow || !role) return null;
      return {
        userId: userIdRow,
        role,
        invitedBy: typeof row.invited_by === "string" ? row.invited_by : null,
        createdAt: typeof row.created_at === "string" ? row.created_at : null,
      };
    })
    .filter((m): m is Member => m !== null);
  return { ok: true, members, callerRole: roleResult.role, truncated: rows.length === MAX_MEMBERS };
}

export async function addMember(
  db: TenancyDb,
  userId: string,
  teamId: string,
  input: { userId?: unknown; email?: unknown; role?: unknown },
): Promise<WriteResult<{ member?: Member; invite?: Invite; token?: string }>> {
  const roleResult = await getCallerRole(db, userId, teamId);
  if (!roleResult.ok) return { ok: false, reason: roleResult.reason, error: roleResult.error, status: roleResult.reason === "unavailable" ? 503 : 500 };
  if (!roleResult.role) {
    // Caller is not a member of ANYTHING matching this id — under RLS that is a 404, distinct from
    // "is a member but not owner/admin" (403). Neither leaks whether the team exists to a stranger
    // beyond what RLS already hides.
    return { ok: false, reason: "not_found", error: "team not found", status: 404 };
  }
  if (roleResult.role !== "owner" && roleResult.role !== "admin") {
    return { ok: false, reason: "forbidden", error: "only an owner or admin can add people", code: "not_admin_add", status: 403 };
  }

  const addRole = normalizeAddRole(input.role);
  if (!addRole) return { ok: false, reason: "invalid", error: "invalid role", code: "invalid_role", status: 400 };
  // T1: only the owner grants administrator.
  if (roleResult.role === "admin" && addRole === "admin") {
    return {
      ok: false,
      reason: "forbidden",
      error: "only the owner can make someone an administrator",
      code: "owner_only_admin",
      status: 403,
    };
  }

  const targetUserId = typeof input.userId === "string" ? input.userId.trim() : "";
  const emailProvided = input.email !== undefined && input.email !== null && input.email !== "";

  if (targetUserId) {
    const insertResult = await db
      .from(TEAM_MEMBERS_TABLE)
      .insert({ team_id: teamId, user_id: targetUserId, role: addRole, invited_by: userId })
      .select("user_id,role,invited_by,created_at")
      .maybeSingle();
    if (insertResult.error) {
      const code = (insertResult.error as { code?: string }).code;
      if (code === "23505") return { ok: false, reason: "duplicate", error: "already a member", status: 409 };
      if (code === "23503") {
        // Foreign key to auth.users: a well-formed but nonexistent userId. Caller error, not a
        // server fault — do not surface this as a 500.
        return { ok: false, reason: "invalid", error: "that user does not exist", code: "user_not_found", status: 400 };
      }
      if (code === "22P02") {
        // Malformed uuid literal (e.g. not even shaped like a uuid). Caller error, not a server
        // fault — do not surface this as a 500.
        return { ok: false, reason: "invalid", error: "invalid userId", code: "invalid_user_id", status: 400 };
      }
      if (isAbsentTableError(insertResult.error)) {
        return { ok: false, reason: "unavailable", error: insertResult.error.message || "unavailable", status: 503 };
      }
      return { ok: false, reason: "failed", error: insertResult.error.message || "insert failed", status: 500 };
    }
    const row = (Array.isArray(insertResult.data) ? insertResult.data[0] : insertResult.data) as DbRow | null;
    const member: Member = {
      userId: targetUserId,
      role: addRole,
      invitedBy: userId,
      createdAt: row && typeof row.created_at === "string" ? row.created_at : null,
    };
    return { ok: true, value: { member } };
  }

  if (emailProvided) {
    // MO-PAID-081 (invite-by-email delivery) is explicitly NOT absorbed by this packet (M2
    // ruling) — team_invites stays a schema-only foundation. There is no email->account lookup
    // (no service-role key, no secret store — TWO-ORGANISMS LAW), so every email input here is
    // "does not match an existing account" by construction, and this path writes NO row: an
    // unimplemented feature must fail loudly, never fall through to a silent no-op invite.
    return {
      ok: false,
      reason: "invalid",
      error: "email invites are not available yet",
      code: "email_not_supported",
      status: 422,
    };
  }

  return { ok: false, reason: "invalid", error: "userId or email required", code: "missing_target", status: 400 };
}

function failWrite<T>(
  reason: "unavailable" | "failed" | "forbidden" | "not_found" | "invalid",
  error: string,
  status: number,
  code?: InvalidCode | RoleGateCode,
): WriteResult<T> {
  return { ok: false, reason, error, status, ...(code ? { code } : {}) };
}

const TEAM_MEMBER_NAMES_FN = "team_member_names";

/** Display names for a team's roster. Fail-closed: an unreadable name is absent, never invented. */
export async function listMemberNames(
  db: TenancyDb & { rpc?: (fn: string, args: Record<string, unknown>) => Promise<DbResult> },
  teamId: string,
): Promise<{ ok: true; names: Map<string, string> } | ReadFail> {
  if (typeof db.rpc !== "function") return { ok: true, names: new Map() };
  const result = await db.rpc(TEAM_MEMBER_NAMES_FN, { p_team: teamId });
  if (result.error) {
    return isAbsentTableError(result.error)
      ? { ok: false, reason: "unavailable", error: result.error.message || "table unavailable" }
      : { ok: false, reason: "failed", error: result.error.message || "read failed" };
  }
  const rows = (Array.isArray(result.data) ? result.data : result.data ? [result.data] : []) as DbRow[];
  const names = new Map<string, string>();
  for (const row of rows) {
    const userId = typeof row.user_id === "string" ? row.user_id : null;
    const displayName = typeof row.display_name === "string" ? row.display_name : "";
    if (userId && displayName) names.set(userId, displayName);
  }
  return { ok: true, names };
}

export async function changeMemberRole(
  db: TenancyDb,
  actorUserId: string,
  teamId: string,
  targetUserId: string,
  nextRole: unknown,
): Promise<WriteResult<Member>> {
  const roleResult = await getCallerRole(db, actorUserId, teamId);
  if (!roleResult.ok) {
    return failWrite(roleResult.reason, roleResult.error, roleResult.reason === "unavailable" ? 503 : 500);
  }
  if (!roleResult.role) return failWrite("not_found", "team not found", 404, "team_not_found");
  // A member IS on this team, so the answer names the gate rather than denying their membership
  // (round-4 ruling R2). Only the owner changes a role, which is true for every target.
  if (roleResult.role === "member") return failWrite("forbidden", "only the owner can change a role", 403, "owner_only");

  const addRole = normalizeChangeRole(nextRole);
  if (!addRole) return failWrite("invalid", "invalid role", 400, "invalid_role");

  const target = await getCallerRole(db, targetUserId, teamId);
  if (!target.ok) {
    return failWrite(target.reason, target.error, target.reason === "unavailable" ? 503 : 500);
  }
  if (!target.role) return failWrite("not_found", "that person is not on this team", 404, "not_on_team");
  if (target.role === "owner") return failWrite("forbidden", "the owner cannot be changed", 403, "owner_locked");
  if (targetUserId === actorUserId) return failWrite("forbidden", "cannot change own role", 403, "no_self_role");
  if (roleResult.role !== "owner") {
    return failWrite(
      "forbidden",
      "only the owner can change a role",
      403,
      target.role === "admin" || addRole === "admin" ? "owner_only_change_admin" : "owner_only",
    );
  }
  if (target.role === addRole) return failWrite("invalid", "already that role", 400, "same_role");

  const updated = await db
    .from(TEAM_MEMBERS_TABLE)
    .update({ role: addRole })
    .eq("team_id", teamId)
    .eq("user_id", targetUserId)
    .select("user_id,role,invited_by,created_at");
  if (updated.error) {
    if (isAbsentTableError(updated.error)) return failWrite("unavailable", updated.error.message || "unavailable", 503);
    // The same refusal the zero-row branch below answers, just expressed as an error.
    if (isPermissionDeniedError(updated.error)) {
      return failWrite("forbidden", "role change refused by the database", 403, "role_change_failed");
    }
    return failWrite("failed", updated.error.message || "update failed", 500);
  }
  const rows = Array.isArray(updated.data) ? updated.data : updated.data ? [updated.data] : [];
  // Load-bearing: a zero-row result means RLS refused. Never a silent 200.
  if (rows.length === 0) {
    return failWrite("forbidden", "role change refused", 403, "role_change_failed");
  }
  const row = rows[0] as DbRow;
  return {
    ok: true,
    value: {
      userId: typeof row.user_id === "string" ? row.user_id : targetUserId,
      role: toRoleOrNull(row.role) ?? addRole,
      invitedBy: typeof row.invited_by === "string" ? row.invited_by : null,
      createdAt: typeof row.created_at === "string" ? row.created_at : null,
    },
  };
}

export async function removeMember(
  db: TenancyDb,
  actorUserId: string,
  teamId: string,
  targetUserId: string,
): Promise<WriteResult<{ userId: string }>> {
  const roleResult = await getCallerRole(db, actorUserId, teamId);
  if (!roleResult.ok) {
    return failWrite(roleResult.reason, roleResult.error, roleResult.reason === "unavailable" ? 503 : 500);
  }
  if (!roleResult.role) return failWrite("not_found", "team not found", 404, "team_not_found");

  const self = targetUserId === actorUserId;
  if (self && roleResult.role === "owner") {
    return failWrite("forbidden", "the owner cannot leave", 403, "owner_cannot_leave");
  }
  // Round-4 ruling R2: the caller is a member of this team, so the sentence names the gate. It
  // cannot be `owner_only` either — an administrator may remove a member — hence its own entry.
  if (roleResult.role === "member" && !self) {
    return failWrite("forbidden", "only the owner or an administrator can remove someone", 403, "remove_not_allowed");
  }

  const target = await getCallerRole(db, targetUserId, teamId);
  if (!target.ok) {
    return failWrite(target.reason, target.error, target.reason === "unavailable" ? 503 : 500);
  }
  if (!target.role) return failWrite("not_found", "that person is not on this team", 404, "not_on_team");
  if (target.role === "owner") return failWrite("forbidden", "the owner cannot be removed", 403, "owner_locked");
  if (!self && roleResult.role === "admin" && target.role === "admin") {
    return failWrite("forbidden", "only the owner can remove an administrator", 403, "owner_only_remove_admin");
  }

  const deleted = await db
    .from(TEAM_MEMBERS_TABLE)
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", targetUserId)
    .select("user_id");
  if (deleted.error) {
    if (isAbsentTableError(deleted.error)) return failWrite("unavailable", deleted.error.message || "unavailable", 503);
    // 0019's tm_delete_admin raises 42501 on a forbidden DELETE by design. That is a 403 with this
    // gate's sentence, not "We could not save that change."
    if (isPermissionDeniedError(deleted.error)) {
      return failWrite("forbidden", "remove refused by the database", 403, "remove_failed");
    }
    return failWrite("failed", deleted.error.message || "delete failed", 500);
  }
  const rows = Array.isArray(deleted.data) ? deleted.data : deleted.data ? [deleted.data] : [];
  // Zero rows with a caller who is a member is a 403, not a 404 and not a success.
  if (rows.length === 0) {
    return failWrite("forbidden", "remove refused", 403, "remove_failed");
  }
  const row = rows[0] as DbRow;
  return { ok: true, value: { userId: typeof row.user_id === "string" ? row.user_id : targetUserId } };
}

// --- Packet B-F12-3: invitations, role-gated authorization, workspace-scoped settings ---
// (MO-PAID-081 invitation/membership flow, MO-PAID-082 role/permission model, MO-PAID-083
// workspace concept.) Reuses this file's existing token primitives (newInviteToken /
// inviteTokenHash, previously unused for writes), INVITE_TTL_DAYS, getCallerRole, normalizeEmail,
// isAbsentTableError. `watchlists.ts` is NOT an owned path, so the rpc-capable db shape is widened
// locally rather than editing WatchlistDb.

import type { DbResult as _DbResult } from "@/lib/watchlists";
export type TenancyRpcDb = TenancyDb & { rpc: (fn: string, args: Record<string, unknown>) => Promise<_DbResult> };

export const ACCEPT_INVITE_FN = "accept_team_invite";
export const TRANSFER_OWNERSHIP_FN = "transfer_team_ownership";

/** RFC 4122-shaped UUID. The route validates both path and body ids before calling the function. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export type TransferOwnershipResult =
  | { success: true; message: "transfer_success"; newOwnerId: string }
  | { success: false; message: TeamRouteCode; status: number };

const TRANSFER_FAIL_STATUS: Record<string, number> = {
  not_signed_in: 401,
  team_not_found: 404,
  not_on_team: 404,
  owner_only: 403,
  transfer_requires_admin: 403,
  same_owner: 400,
  conflict: 409,
  unavailable: 403,
  invalid_user_id: 400,
  invalid_team_id: 400,
};

function transferFail(message: TeamRouteCode): TransferOwnershipResult {
  return { success: false, message, status: TRANSFER_FAIL_STATUS[message] ?? 500 };
}

/**
 * Call public.transfer_team_ownership. The function is the source of truth — this helper
 * does not re-gate. A zero-row result (RLS refusal or an empty update) is never a success.
 */
export async function transferOwnership(
  db: TenancyRpcDb,
  teamId: string,
  newOwnerId: string,
): Promise<TransferOwnershipResult> {
  if (!isUuid(teamId)) {
    return transferFail("invalid_team_id");
  }
  if (!isUuid(newOwnerId)) {
    return transferFail("invalid_user_id");
  }
  const result = await db.rpc(TRANSFER_OWNERSHIP_FN, {
    p_team: teamId,
    p_new_owner_user_id: newOwnerId,
  });
  if (result.error) {
    if (isAbsentTableError(result.error)) return transferFail("unavailable");
    if (isPermissionDeniedError(result.error)) return transferFail("unavailable");
    return {
      success: false,
      message: "write_failed",
      status: 500,
    };
  }
  const rows = (Array.isArray(result.data) ? result.data : result.data ? [result.data] : []) as DbRow[];
  // Load-bearing: a zero-row result means RLS refused. Never a silent 200.
  if (rows.length === 0) {
    return transferFail("unavailable");
  }
  const row = rows[0];
  const code = typeof row.message === "string" ? row.message : "";
  if (row.success === true && code === "transfer_success") {
    return { success: true, message: "transfer_success", newOwnerId };
  }
  if (code && code in TEAM_ROUTE_MESSAGES) {
    return transferFail(code as TeamRouteCode);
  }
  return transferFail("unavailable");
}
export const WORKSPACE_SETTINGS_TABLE = "workspace_settings";
export const MAX_INVITES = 200;
export const MAX_SETTING_BYTES = 4096;

export type InviteCode =
  | "not_signed_in" | "invalid_token" | "already_used" | "expired"
  | "email_unknown" | "email_mismatch" | "invalid_email" | "invalid_role"
  | "not_admin" | "team_not_found" | "duplicate_invite"
  | "no_email_delivery" | "unavailable" | "failed";

// [en, zh] tuples -- same shape as lib/i18n.tsx:18 `LEX: Record<string, [string, string]>`.
// UI-facing labels live in LEX (packet B-F12-8). Route messages stay here.
// Plain-word law: complete sentences, no role slugs, no table/function names, no status codes,
// no internal state words, never falsifier/refuted/证伪.
export const INVITE_MESSAGES: Record<InviteCode, [string, string]> = {
  not_signed_in: ["Sign in to accept this invitation.", "请登录后接受此邀请。"],
  invalid_token: ["This invitation link is not valid.", "该邀请链接无效。"],
  already_used: ["This invitation has already been used. Ask the team owner to send a new one.", "该邀请已被使用。请让团队所有者重新发送一份。"],
  expired: ["This invitation has expired. Ask the team owner to send a new one.", "该邀请已过期。请让团队所有者重新发送一份。"],
  email_unknown: ["We could not confirm your email address. Please sign in again.", "我们无法确认您的邮箱地址。请重新登录。"],
  email_mismatch: ["This invitation was sent to a different email address. Sign in with the invited address to join.", "该邀请发送至另一个邮箱地址。请使用被邀请的邮箱登录后加入。"],
  invalid_email: ["Enter a valid email address.", "请输入有效的邮箱地址。"],
  invalid_role: ["Choose a valid role for this person.", "请为此人选择一个有效角色。"],
  not_admin: ["Only a team owner or an administrator can invite people.", "只有团队所有者或管理员才能邀请他人。"],
  team_not_found: ["We could not find that team.", "找不到该团队。"],
  duplicate_invite: ["There is already a pending invitation for this email address.", "该邮箱地址已有一份待处理的邀请。"],
  no_email_delivery: ["We cannot send invitation emails yet. Copy the invitation link below and send it to them yourself — it works for 14 days.", "我们暂时无法发送邀请邮件。请复制下方邀请链接自行发送给对方——该链接 14 天内有效。"],
  unavailable: ["Team accounts are not set up on this server yet, so we cannot answer. Nothing was changed.", "此服务器尚未启用团队账户，因此我们无法作答。未更改任何内容。"],
  failed: ["We could not complete that action just now.", "我们暂时无法完成该操作。"],
};

export type TeamRouteCode =
  | "not_signed_in"
  | "unavailable"
  | "read_failed"
  | "write_failed"
  | "send_json"
  | "unrecognised_action"
  | "team_name_required"
  | "team_id_required"
  | "not_member"
  | "remove_not_allowed"
  | "not_admin_add"
  | "team_not_found"
  | "already_on_team"
  | "invalid_role"
  | "invalid_user_id"
  | "invalid_team_id"
  | "user_not_found"
  | "email_not_supported"
  | "missing_target"
  | "invalid_request"
  | "owner_only"
  | "owner_only_admin"
  | "owner_only_change_admin"
  | "owner_only_remove_admin"
  | "owner_locked"
  | "owner_cannot_leave"
  | "no_self_role"
  | "not_on_team"
  | "same_role"
  | "role_change_failed"
  | "remove_failed"
  | "transfer_requires_admin"
  | "same_owner"
  | "transfer_success"
  | "conflict";

// Same [en, zh] shape as INVITE_MESSAGES. Used by /api/teams and /api/teams/[id]/members.
export const TEAM_ROUTE_MESSAGES: Record<TeamRouteCode, [string, string]> = {
  not_signed_in: ["You are not signed in.", "您尚未登录。"],
  unavailable: INVITE_MESSAGES.unavailable,
  read_failed: ["We could not read the team directory just now.", "我们暂时无法读取团队目录。"],
  write_failed: ["We could not save that change.", "我们无法保存该更改。"],
  send_json: ["Send a JSON body.", "请发送 JSON 正文。"],
  unrecognised_action: ["We do not recognise that action.", "我们无法识别该操作。"],
  team_name_required: ["A team needs a name of 1 to 120 characters.", "团队名称需要为 1 到 120 个字符。"],
  team_id_required: ["A team id is required.", "必须提供团队编号。"],
  // `not_member` is for a caller who is genuinely not on the team (the roster GET's forbidden
  // branch). It is NEVER the answer to a caller who IS a member: round-4 ruling R2 — a sentence
  // the reader can receive has to be true about the reader's own state.
  not_member: ["You are not a member of this team.", "您不是该团队的成员。"],
  remove_not_allowed: [
    "Only the team owner or an administrator can remove someone from this team.",
    "只有团队所有者或管理员才能将成员移出团队。",
  ],
  not_admin_add: ["Only a team owner or admin can add people.", "只有团队所有者或管理员才能添加成员。"],
  team_not_found: INVITE_MESSAGES.team_not_found,
  already_on_team: ["That person is already on this team.", "该成员已在此团队中。"],
  // Round-4 ruling R4(j): every label this packet ships says "Administrator", so the sentence a
  // caller reads says it too. The Chinese twin already read 管理员.
  invalid_role: ["Choose a role: administrator or member.", "请选择角色：管理员或成员。"],
  invalid_user_id: ["That user id is not valid.", "该用户标识无效。"],
  invalid_team_id: ["That team id is not valid.", "该团队标识无效。"],
  user_not_found: ["We could not find that person. Ask them to sign in to Mastermind first.", "找不到该用户。请先让对方登录 Mastermind。"],
  email_not_supported: [
    "Invitations by email are not available yet. Ask them to sign in to Mastermind first, then add them by their account.",
    "目前还不能通过电子邮件发送邀请。请先让对方登录 Mastermind，然后用其账户添加。",
  ],
  missing_target: ["Provide a user id or an email address.", "请提供用户标识或电子邮件地址。"],
  invalid_request: ["That request is not valid.", "该请求无效。"],
  owner_only: ["Only the team owner can do this.", "只有团队所有者可以执行此操作。"],
  owner_only_admin: ["Only the team owner can make someone an administrator.", "只有团队所有者才能将他人设为管理员。"],
  owner_only_change_admin: ["Only the team owner can change an administrator.", "只有团队所有者才能更改管理员。"],
  owner_only_remove_admin: ["Only the team owner can remove an administrator.", "只有团队所有者才能移除管理员。"],
  owner_locked: ["The team owner cannot be changed or removed.", "团队所有者无法被更改或移除。"],
  owner_cannot_leave: ["The team owner cannot leave the team.", "团队所有者无法退出团队。"],
  no_self_role: ["You cannot change your own role. Ask the team owner.", "您无法更改自己的角色。请联系团队所有者。"],
  not_on_team: ["That person is not on this team.", "该成员不在此团队中。"],
  same_role: ["That person already has that role.", "该成员已经是该角色。"],
  role_change_failed: ["We could not change that role just now. Nothing was changed.", "我们暂时无法更改该角色。未更改任何内容。"],
  remove_failed: ["We could not remove that person just now. Nothing was changed.", "我们暂时无法移除该成员。未更改任何内容。"],
  transfer_requires_admin: [
    "They must be an administrator before they can become the owner.",
    "他们必须是管理员才能成为所有者。",
  ],
  same_owner: ["You are already the owner.", "您已经是所有者。"],
  transfer_success: ["Ownership transferred successfully.", "所有权已成功转移。"],
  conflict: [
    "The transfer failed due to a concurrent change. Please try again.",
    "由于并发更改，转移失败。请重试。",
  ],
};

export const SETTING_MESSAGES: Record<"saved" | "not_admin" | "invalid_key" | "invalid_value" | "unavailable", [string, string]> = {
  saved: ["Your setting was saved.", "您的设置已保存。"],
  not_admin: ["Only a team owner or an administrator can change this workspace setting.", "只有团队所有者或管理员才能更改此工作区设置。"],
  invalid_key: ["That setting name is not valid.", "该设置名称无效。"],
  invalid_value: ["That setting value is not valid.", "该设置值无效。"],
  unavailable: ["Team accounts are not set up on this server yet, so we cannot answer. Nothing was changed.", "此服务器尚未启用团队账户，因此我们无法作答。未更改任何内容。"],
};

const INVITE_STATUS: Record<InviteCode, number> = {
  not_signed_in: 401, invalid_token: 404, already_used: 409, expired: 410,
  email_unknown: 403, email_mismatch: 403, invalid_email: 400, invalid_role: 400,
  not_admin: 403, team_not_found: 404, duplicate_invite: 409,
  no_email_delivery: 200, unavailable: 503, failed: 500,
};

export type Setting = { scope: "user" | "workspace"; teamId: string | null; key: string; value: unknown; updatedAt: string | null };

export function inviteExpiry(now: Date = new Date()): string {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

const SETTING_KEY_RE = /^[a-z][a-z0-9_.]{0,63}$/;

export function normalizeSettingKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return SETTING_KEY_RE.test(value) ? value : null;
}

export function normalizeSettingValue(value: unknown): { ok: true; value: unknown } | { ok: false; code: "invalid_value" } {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return { ok: false, code: "invalid_value" };
    if (Buffer.byteLength(json, "utf8") > MAX_SETTING_BYTES) return { ok: false, code: "invalid_value" };
    return { ok: true, value };
  } catch {
    return { ok: false, code: "invalid_value" };
  }
}

function inviteRow(row: DbRow | null): Invite | null {
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    role: (row.role as TeamRole) ?? "member",
    expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
    acceptedAt: typeof row.accepted_at === "string" ? row.accepted_at : null,
  };
}

type CreateInviteResult = WriteResult<{ invite: Invite; token: string }> & { code?: InviteCode | RoleGateCode };

export async function createInvite(
  db: TenancyDb,
  userId: string,
  teamId: string,
  input: { email?: unknown; role?: unknown },
): Promise<CreateInviteResult> {
  const fail = (v: { reason: string; error: string; code?: InviteCode | RoleGateCode; status: number }): CreateInviteResult => ({ ok: false, ...v } as unknown as CreateInviteResult);
  const roleResult = await getCallerRole(db, userId, teamId);
  if (!roleResult.ok) return fail({reason: roleResult.reason, error: roleResult.error, code: roleResult.reason === "unavailable" ? "unavailable" : "failed", status: roleResult.reason === "unavailable" ? 503 : 500})
  if (!roleResult.role) {
    return fail({reason: "not_found", error: "team not found", code: "team_not_found", status: 404})
  }
  if (roleResult.role !== "owner" && roleResult.role !== "admin") {
    return fail({reason: "forbidden", error: "only an owner or admin can invite people", code: "not_admin", status: 403})
  }
  const email = normalizeEmail(input.email);
  if (!email) return fail({reason: "invalid", error: "invalid email", code: "invalid_email", status: 400})
  const role = normalizeRole(input.role);
  if (!role || role === "owner") return fail({reason: "invalid", error: "invalid role", code: "invalid_role", status: 400})
  // T1: only the owner grants administrator, including through an invitation.
  if (roleResult.role === "admin" && role === "admin") {
    return fail({
      reason: "forbidden",
      error: "only the owner can make someone an administrator",
      code: "owner_only_admin",
      status: 403,
    });
  }

  const token = newInviteToken();
  const insertResult = await db
    .from(TEAM_INVITES_TABLE)
    .insert({
      team_id: teamId,
      email,
      role,
      token_hash: inviteTokenHash(token),
      invited_by: userId,
      expires_at: inviteExpiry(),
    })
    .select("id,email,role,expires_at,accepted_at")
    .maybeSingle();
  if (insertResult.error) {
    const code = (insertResult.error as { code?: string }).code;
    if (code === "23505") return fail({reason: "duplicate", error: "duplicate invite", code: "duplicate_invite", status: 409})
    if (code === "42501") return fail({reason: "forbidden", error: "not authorized", code: "not_admin", status: 403})
    if (isAbsentTableError(insertResult.error)) {
      return fail({reason: "unavailable", error: insertResult.error.message || "unavailable", code: "unavailable", status: 503})
    }
    return fail({reason: "failed", error: insertResult.error.message || "insert failed", code: "failed", status: 500})
  }
  const row = (Array.isArray(insertResult.data) ? insertResult.data[0] : insertResult.data) as DbRow | null;
  const invite = inviteRow(row);
  if (!invite) return fail({reason: "failed", error: "insert returned no row", code: "failed", status: 500})
  // The raw token is never persisted (only its hash was written above) and never logged.
  return { ok: true, value: { invite, token } };
}

export async function listInvites(
  db: TenancyDb,
  userId: string,
  teamId: string,
): Promise<{ ok: true; invites: Invite[]; callerRole: TeamRole; truncated: boolean } | { ok: false; reason: "unavailable" | "failed" | "forbidden" | "not_found"; error: string }> {
  const roleResult = await getCallerRole(db, userId, teamId);
  if (!roleResult.ok) return { ok: false, reason: roleResult.reason, error: roleResult.error };
  if (!roleResult.role) return { ok: false, reason: "not_found", error: "team not found" };
  if (roleResult.role !== "owner" && roleResult.role !== "admin") {
    return { ok: false, reason: "forbidden", error: "only an owner or admin can list invitations" };
  }
  const result = await db
    .from(TEAM_INVITES_TABLE)
    .select("id,email,role,expires_at,accepted_at")
    .eq("team_id", teamId)
    .limit(MAX_INVITES + 1);
  const fail = classifyReadError(result);
  if (fail) return fail;
  const rows = (Array.isArray(result.data) ? result.data : []) as DbRow[];
  const invites = rows.slice(0, MAX_INVITES).map((r) => inviteRow(r)).filter((i): i is Invite => i !== null);
  return { ok: true, invites, callerRole: roleResult.role, truncated: rows.length > MAX_INVITES };
}

export async function acceptInvite(
  db: TenancyRpcDb,
  token: unknown,
): Promise<{ ok: true; teamId: string; role: TeamRole } | { ok: false; code: InviteCode; status: number; error: string }> {
  if (typeof token !== "string" || token.length < 1) {
    return { ok: false, code: "invalid_token", status: INVITE_STATUS.invalid_token, error: "invalid token" };
  }
  // Exactly one argument -- the accepting identity comes from the session inside the RPC
  // (auth.uid()), never from a caller-supplied user id/email/teamId/role.
  const result = await db.rpc(ACCEPT_INVITE_FN, { p_token: token });
  if (result.error) {
    if (isAbsentTableError(result.error)) {
      return { ok: false, code: "unavailable", status: INVITE_STATUS.unavailable, error: result.error.message || "unavailable" };
    }
    return { ok: false, code: "failed", status: INVITE_STATUS.failed, error: result.error.message || "rpc failed" };
  }
  const data = result.data as { ok?: boolean; reason?: string; team_id?: string; role?: TeamRole } | null;
  if (!data || data.ok !== true) {
    const reason = (data?.reason as InviteCode) || "failed";
    const code: InviteCode = (reason in INVITE_STATUS ? reason : "failed") as InviteCode;
    return { ok: false, code, status: INVITE_STATUS[code], error: reason };
  }
  return { ok: true, teamId: String(data.team_id), role: (data.role as TeamRole) ?? "member" };
}

function settingRow(row: DbRow | null): Setting | null {
  if (!row) return null;
  return {
    scope: (row.scope as "user" | "workspace") ?? "user",
    teamId: typeof row.team_id === "string" ? row.team_id : null,
    key: String(row.key),
    value: row.value,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

export async function readSettings(
  db: TenancyDb,
  userId: string,
  args: { scope: "user" | "workspace"; teamId?: string | null },
): Promise<{ ok: true; settings: Setting[] } | { ok: false; reason: "unavailable" | "failed" | "forbidden" | "invalid"; error: string }> {
  if (args.scope === "workspace") {
    // A workspace read with no teamId must never reach getCallerRole (nothing to check
    // membership against) or the query builder (an empty string against a uuid column raises
    // 22P02, surfacing as an unclassified 500 instead of a validated 400 -- round-2 review).
    if (!args.teamId) return { ok: false, reason: "invalid", error: "teamId required for workspace scope" };
    const roleResult = await getCallerRole(db, userId, args.teamId);
    if (!roleResult.ok) return { ok: false, reason: roleResult.reason, error: roleResult.error };
    if (!roleResult.role) return { ok: false, reason: "forbidden", error: "not a member" };
  }
  let query = db.from(WORKSPACE_SETTINGS_TABLE).select("scope,team_id,key,value,updated_at").eq("scope", args.scope);
  query = args.scope === "workspace" ? query.eq("team_id", args.teamId as string) : query.eq("user_id", userId);
  const result = await query;
  const fail = classifyReadError(result);
  if (fail) return fail;
  const rows = (Array.isArray(result.data) ? result.data : []) as DbRow[];
  const settings = rows.map((r) => settingRow(r)).filter((s): s is Setting => s !== null);
  return { ok: true, settings };
}

// A settings-only code union, kept separate from the invite-shaped `InvalidCode` (which a
// pre-existing route already exhaustively maps and must not be widened by this packet). Both
// invalid branches below now set `code` explicitly and symmetrically so a future settings route
// can map result.code -> SETTING_MESSAGES (round-2 review MINOR-4: an explicit `code: undefined`
// on one branch and an omitted `code` on the sibling read the same at runtime, but neither ever
// carried a code a caller could switch on).
export type WriteSettingCode = "invalid_key" | "invalid_value";
export type WriteSettingResult = WriteResult<Setting> | { ok: false; reason: "invalid"; error: string; code: WriteSettingCode; status: number };

export async function writeSetting(
  db: TenancyDb,
  userId: string,
  args: { scope: "user" | "workspace"; teamId?: string | null; key: string; value: unknown },
): Promise<WriteSettingResult> {
  const key = normalizeSettingKey(args.key);
  if (!key) return { ok: false, reason: "invalid", error: "invalid key", code: "invalid_key", status: 400 };
  const normalized = normalizeSettingValue(args.value);
  if (!normalized.ok) return { ok: false, reason: "invalid", error: "invalid value", code: "invalid_value", status: 400 };
  const teamId = args.scope === "workspace" ? args.teamId ?? null : null;
  if (args.scope === "workspace" && !teamId) return { ok: false, reason: "invalid", error: "teamId required for workspace scope", status: 400 };
  // owner_id (generated column: coalesce(team_id, user_id)) makes this one target work for both
  // scopes -- see supabase/migrations/0015_team_roles_invitations.sql for why a partial index
  // cannot be used as a PostgREST onConflict target.
  const onConflict = "scope,owner_id,key";
  const result = await db
    .from(WORKSPACE_SETTINGS_TABLE)
    .upsert(
      { scope: args.scope, team_id: teamId, user_id: userId, key, value: normalized.value, updated_at: new Date().toISOString() },
      { onConflict },
    )
    .select("scope,team_id,key,value,updated_at")
    .maybeSingle();
  if (result.error) {
    const code = (result.error as { code?: string }).code;
    if (code === "42501") return { ok: false, reason: "forbidden", error: "not authorized", status: 403 };
    if (isAbsentTableError(result.error)) return { ok: false, reason: "unavailable", error: result.error.message || "unavailable", status: 503 };
    return { ok: false, reason: "failed", error: result.error.message || "write failed", status: 500 };
  }
  const row = (Array.isArray(result.data) ? result.data[0] : result.data) as DbRow | null;
  const setting = settingRow(row);
  if (!setting) return { ok: false, reason: "failed", error: "write returned no row", status: 500 };
  return { ok: true, value: setting };
}
