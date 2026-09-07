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
export type Member = { userId: string; role: TeamRole; invitedBy: string | null; createdAt: string | null };
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
export type WriteResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: "unavailable" | "failed" | "forbidden" | "not_found" | "invalid" | "duplicate";
      error: string;
      code?: InvalidCode;
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
    return { ok: false, reason: "forbidden", error: "only an owner or admin can add people", status: 403 };
  }

  const addRole = normalizeAddRole(input.role);
  if (!addRole) return { ok: false, reason: "invalid", error: "invalid role", code: "invalid_role", status: 400 };

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

// --- Packet B-F12-3: invitations, role-gated authorization, workspace-scoped settings ---
// (MO-PAID-081 invitation/membership flow, MO-PAID-082 role/permission model, MO-PAID-083
// workspace concept.) Reuses this file's existing token primitives (newInviteToken /
// inviteTokenHash, previously unused for writes), INVITE_TTL_DAYS, getCallerRole, normalizeEmail,
// isAbsentTableError. `watchlists.ts` is NOT an owned path, so the rpc-capable db shape is widened
// locally rather than editing WatchlistDb.

import type { DbResult as _DbResult } from "@/lib/watchlists";
export type TenancyRpcDb = TenancyDb & { rpc: (fn: string, args: Record<string, unknown>) => Promise<_DbResult> };

export const ACCEPT_INVITE_FN = "accept_team_invite";
export const WORKSPACE_SETTINGS_TABLE = "workspace_settings";
export const MAX_INVITES = 200;
export const MAX_SETTING_BYTES = 4096;

export type InviteCode =
  | "not_signed_in" | "invalid_token" | "already_used" | "expired"
  | "email_unknown" | "email_mismatch" | "invalid_email" | "invalid_role"
  | "not_admin" | "team_not_found" | "duplicate_invite"
  | "no_email_delivery" | "unavailable" | "failed";

// [en, zh] tuples -- same shape as lib/i18n.tsx:18 `LEX: Record<string, [string, string]>`.
// i18n.tsx is NOT an owned path, so the catalogue lives here; lift into LEX when a UI lands.
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

type CreateInviteResult = WriteResult<{ invite: Invite; token: string }> & { code?: InviteCode };

export async function createInvite(
  db: TenancyDb,
  userId: string,
  teamId: string,
  input: { email?: unknown; role?: unknown },
): Promise<CreateInviteResult> {
  const fail = (v: { reason: string; error: string; code?: InviteCode; status: number }): CreateInviteResult => ({ ok: false, ...v } as unknown as CreateInviteResult);
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
