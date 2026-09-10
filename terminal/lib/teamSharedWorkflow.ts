// Team-scoped shared saved workspaces (packet B-F12-B5-2).
//
// Pure service: the only I/O is the injected db. Vocabulary is TENANT_SCOPE_VISIBILITIES,
// re-exported, never retyped. decideTenantScope is the application-side second gate; RLS
// remains the authority. memberships MUST come from listTeams() (identity-scoped), never
// listMembers(). revokedAt is always null on a live-built membership (revocation is a
// row deletion in this build).

import {
  TENANT_SCOPE_VISIBILITIES,
  decideTenantScope,
  type DenyReason,
  type Membership,
  type ScopedResource,
} from "@/lib/tenantScope";
import { listTeams, type Team, type TeamRole, type TenancyDb } from "@/lib/teams";
import {
  LAYOUTS_TABLE,
  listLayouts,
  type LayoutDb,
  type LayoutRow,
  type SavedLayout,
} from "@/lib/layouts";
import { rowStateFor } from "@/lib/workspaceLayout";

type RowState = ReturnType<typeof rowStateFor>;

/** One vocabulary. Re-exported, never retyped. */
export const SHARING_VALUES = TENANT_SCOPE_VISIBILITIES;
export type Sharing = (typeof SHARING_VALUES)[number];

export const SHARED_LAYOUT_COLUMNS = "id,name,config,updated_at,user_id,team_id,visibility";

export const SHARED_WORKFLOW_CHROME: Record<string, [string, string]> = {
  wsGroupMine: ["Only you", "仅自己可见"],
  wsGroupTeam: ["Shared with your team", "已与团队共享"],
  wsSharedBadge: ["Team", "团队"],
  wsShareAction: ["Share with your team", "共享给团队"],
  wsUnshareAction: ["Make it private again", "改回仅自己可见"],
  wsShareTitle: ["Share this workspace with your team?", "要将此工作区共享给团队吗？"],
  wsShareBody: [
    "Everyone on {team} will be able to open it, with all of its charts and settings. Afterwards only an owner or an administrator can change it or remove it.",
    "{team} 的所有成员都可以打开它，包括其中的全部图表和设置。之后只有所有者或管理员才能修改或删除。",
  ],
  wsShareYes: ["Share it", "确认共享"],
  wsShareNo: ["Keep it private", "保持私有"],
  wsUnshareTitle: ["Stop sharing this workspace?", "要停止共享此工作区吗？"],
  wsUnshareBody: ["Your team will no longer see it. Your own copy stays.", "团队将不再看到它。您自己的副本会保留。"],
  wsUnshareYes: ["Stop sharing", "停止共享"],
  wsPickTeam: ["Choose the team to share with.", "请选择要共享给哪个团队。"],
  wsTeamEmpty: ["Your team has not shared a workspace yet.", "您的团队还没有共享任何工作区。"],
  wsTeamReadOnly: [
    "Only an owner or an administrator can change a workspace the team shares.",
    "只有团队所有者或管理员才能修改团队共享的工作区。",
  ],
  wsTakeCopy: ["Take your own copy", "复制一份到我的工作区"],
};

export const SHARED_WORKFLOW_MESSAGES = {
  shared_ok: ["Shared with {team}.", "已共享给 {team}。"],
  unshared_ok: ["This workspace is private again.", "此工作区已改回仅自己可见。"],
  malformed_sharing: ["Choose one: only you, or shared with your team.", "请选择：仅自己可见，或与团队共享。"],
  team_required: ["Choose the team to share with.", "请选择要共享给哪个团队。"],
  no_team: ["You are not on a team yet, so there is nothing to share this with.", "您还没有加入团队，因此暂时无法共享。"],
  not_admin_share: [
    "Only a team owner or an administrator can share a workspace with the team.",
    "只有团队所有者或管理员才能将工作区共享给团队。",
  ],
  not_admin_edit: [
    "Only a team owner or an administrator can change a workspace the team shares.",
    "只有团队所有者或管理员才能修改团队共享的工作区。",
  ],
  team_name_conflict: [
    "Your team already shares a workspace with this name. Choose a different name.",
    "团队中已存在同名的共享工作区，请换一个名称。",
  ],
  workspace_not_found: ["We could not find that workspace.", "找不到该工作区。"],
  team_read_unavailable: [
    "We could not read your team's shared workspaces just now. Your own workspaces are still listed.",
    "我们暂时无法读取团队的共享工作区。您自己的工作区仍会显示。",
  ],
  store_unavailable: ["We could not save that change.", "我们无法保存该更改。"],
  not_signed_in: ["Sign in to see this.", "请登录后查看。"],
} as const;

export type SharedWorkflowCode = keyof typeof SHARED_WORKFLOW_MESSAGES;

export const SHARED_WORKFLOW_DENIALS: Record<DenyReason, [string, string]> = {
  no_identity: ["Sign in to see this.", "请登录后查看。"],
  malformed_resource: ["We could not read that workspace.", "我们无法读取该工作区。"],
  visibility_absent: [
    "This workspace does not say who it is shared with yet, so we are not showing it.",
    "此工作区尚未记录共享范围，因此暂不显示。",
  ],
  visibility_unrecognized: [
    "This workspace's sharing setting is not one this version understands, so we are not showing it.",
    "此工作区的共享设置不是本版本能识别的，因此暂不显示。",
  ],
  private_not_owner: ["This workspace is private to the person who made it.", "此工作区仅创建者本人可见。"],
  resource_has_no_team: [
    "This workspace is marked as shared but is not attached to a team.",
    "此工作区标记为共享，但未关联任何团队。",
  ],
  no_membership: ["You are not on a team yet.", "您还没有加入团队。"],
  wrong_team: ["This workspace belongs to a team you are not on.", "此工作区属于您未加入的团队。"],
  membership_revoked: ["You no longer have access to this team.", "您已无权访问该团队。"],
  grant_revoked: ["This workspace is no longer shared with you.", "此工作区已不再与您共享。"],
};

export function interpolateTeam(template: string, teamName: string): string {
  return template.replaceAll("{team}", teamName);
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** The adapter boundary the tenant-scope contract §6 requires: user_id -> ownerId. */
export function toScopedResource(row: LayoutRow): ScopedResource {
  return {
    id: str(row.id) ?? "",
    ownerId: typeof row.user_id === "string" && row.user_id ? row.user_id : null,
    teamId: typeof row.team_id === "string" && row.team_id ? row.team_id : null,
    visibility: typeof row.visibility === "string" ? row.visibility : null,
  };
}

/** Identity-scoped memberships. `teams` MUST come from listTeams(), never listMembers(). */
export function membershipsFrom(userId: string, teams: readonly Team[]): Membership[] {
  return teams.map((team) => ({ userId, teamId: team.id, role: team.role, revokedAt: null }));
}

/** The one write-authority predicate. Mirrors 0015's ws_insert/ws_update/ws_delete exactly. */
export function canWriteShared(role: TeamRole | null): boolean {
  return role === "owner" || role === "admin";
}

export function isSharing(value: unknown): value is Sharing {
  return typeof value === "string" && (SHARING_VALUES as readonly string[]).includes(value);
}

export type VisibleWorkspace = SavedLayout & {
  rowState: RowState;
  sharing: Sharing;
  teamId: string | null;
  teamName: string | null;
  mine: boolean;
  canEdit: boolean;
};

export type TeamReadOk = { ok: true };
export type TeamReadFail = { ok: false; message: string; messageZh: string };
export type TeamRead = TeamReadOk | TeamReadFail;

export type VisibleWorkspacesResult =
  | {
      ok: true;
      layouts: VisibleWorkspace[];
      teams: Array<{ id: string; name: string; role: TeamRole }>;
      teamRead: TeamRead;
      denied: Array<{ id: string; reason: DenyReason }>;
    }
  | { ok: false; reason: "unavailable" };

export type ListVisibleOptions = {
  teams?: Team[];
  memberships?: Membership[];
};

function teamFail(): TeamReadFail {
  return {
    ok: false,
    message: SHARED_WORKFLOW_MESSAGES.team_read_unavailable[0],
    messageZh: SHARED_WORKFLOW_MESSAGES.team_read_unavailable[1],
  };
}

function isMissingColumnError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  const msg = (error.message || "").toLowerCase();
  return msg.includes("visibility") || msg.includes("team_id") || msg.includes("does not exist");
}

async function selectSharedForTeam(db: LayoutDb, teamId: string): Promise<{ ok: true; rows: LayoutRow[] } | { ok: false }> {
  const result = await db
    .from(LAYOUTS_TABLE)
    .select(SHARED_LAYOUT_COLUMNS)
    .eq("team_id", teamId)
    .eq("visibility", "team");
  if (result.error) return { ok: false };
  const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data as LayoutRow] : [];
  return { ok: true, rows };
}

function decorate(
  row: LayoutRow,
  userId: string,
  teams: readonly Team[],
): VisibleWorkspace | null {
  const id = str(row.id);
  const name = str(row.name);
  if (!id || name === null) return null;
  const visibility = typeof row.visibility === "string" ? row.visibility : "private";
  const sharing: Sharing = visibility === "team" ? "team" : "private";
  const teamId = str(row.team_id);
  const team = teamId ? teams.find((t) => t.id === teamId) ?? null : null;
  const ownerId = str(row.user_id);
  const mine = ownerId === userId;
  const role = team?.role ?? null;
  const canEdit = sharing === "private" ? mine : canWriteShared(role);
  return {
    id,
    name,
    config: row.config ?? {},
    updated_at: str(row.updated_at),
    userId: ownerId,
    teamId,
    visibility,
    rowState: rowStateFor(row.config),
    sharing,
    teamName: team?.name ?? null,
    mine,
    canEdit,
  };
}

/** Merged, twice-gated read. */
export async function listVisibleWorkspaces(
  db: LayoutDb & TenancyDb,
  userId: string,
  options?: ListVisibleOptions,
): Promise<VisibleWorkspacesResult> {
  const personal = await listLayouts(db, userId);
  if (!personal.ok) return { ok: false, reason: "unavailable" };

  let teams: Team[] = options?.teams ?? [];
  let teamRead: TeamRead = { ok: true };
  if (!options?.teams) {
    const listed = await listTeams(db, userId);
    if (!listed.ok) {
      teamRead = teamFail();
      teams = [];
    } else {
      teams = listed.teams;
    }
  }

  const byId = new Map<string, LayoutRow>();
  for (const layout of personal.layouts) {
    byId.set(layout.id, {
      id: layout.id,
      name: layout.name,
      config: layout.config,
      updated_at: layout.updated_at,
      user_id: layout.userId ?? userId,
      team_id: layout.teamId,
      visibility: layout.visibility ?? "private",
    });
  }

  if (teamRead.ok) {
    for (const team of teams) {
      const shared = await selectSharedForTeam(db, team.id);
      if (!shared.ok) {
        teamRead = teamFail();
        break;
      }
      for (const row of shared.rows) {
        const id = str(row.id);
        if (!id) continue;
        byId.set(id, row);
      }
    }
  }

  const memberships = options?.memberships ?? membershipsFrom(userId, teams);
  const identity = userId ? { userId } : null;
  const denied: Array<{ id: string; reason: DenyReason }> = [];
  const layouts: VisibleWorkspace[] = [];

  for (const row of byId.values()) {
    const scoped = toScopedResource(row);
    const decision = decideTenantScope(identity, memberships, scoped);
    if (!decision.allow) {
      denied.push({ id: scoped.id || "unknown", reason: decision.reason });
      continue;
    }
    const visible = decorate(row, userId, teams);
    if (visible) layouts.push(visible);
  }

  layouts.sort((a, b) => {
    if (a.sharing !== b.sharing) return a.sharing === "team" ? -1 : 1;
    return String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
  });

  return {
    ok: true,
    layouts,
    teams: teams.map((t) => ({ id: t.id, name: t.name, role: t.role })),
    teamRead,
    denied,
  };
}

export type SetSharingResult =
  | { ok: true; id: string; sharing: Sharing; teamId: string | null; teamName: string | null }
  | {
      ok: false;
      reason: "invalid" | "forbidden" | "not_found" | "duplicate" | "unavailable";
      code:
        | "malformed_sharing"
        | "team_required"
        | "no_team"
        | "not_admin_share"
        | "not_admin_edit"
        | "workspace_not_found"
        | "team_name_conflict"
        | "store_unavailable";
    };

async function loadRow(db: LayoutDb, id: string): Promise<LayoutRow | null | "unavailable"> {
  const result = await db.from(LAYOUTS_TABLE).select(SHARED_LAYOUT_COLUMNS).eq("id", id).maybeSingle();
  if (result.error) {
    if (isMissingColumnError(result.error)) {
      const fallback = await db.from(LAYOUTS_TABLE).select("id,name,config,updated_at,user_id").eq("id", id).maybeSingle();
      if (fallback.error) return "unavailable";
      const row = (fallback.data as LayoutRow | null) ?? null;
      return row ? { ...row, team_id: null, visibility: "private" } : null;
    }
    return "unavailable";
  }
  const data = result.data;
  if (!data) return null;
  return (Array.isArray(data) ? data[0] : data) as LayoutRow;
}

async function roleInTeam(db: TenancyDb, userId: string, teamId: string, known?: readonly Team[]): Promise<TeamRole | null> {
  const fromKnown = known?.find((t) => t.id === teamId)?.role ?? null;
  if (fromKnown) return fromKnown;
  const listed = await listTeams(db, userId);
  if (!listed.ok) return null;
  return listed.teams.find((t) => t.id === teamId)?.role ?? null;
}

/** Flip one row's sharing state. */
export async function setWorkspaceSharing(
  db: LayoutDb & TenancyDb,
  userId: string,
  input: { id: unknown; sharing: unknown; teamId: unknown },
): Promise<SetSharingResult> {
  if (!isSharing(input.sharing)) {
    return { ok: false, reason: "invalid", code: "malformed_sharing" };
  }
  const sharing = input.sharing;
  const targetTeamId = sharing === "team" ? str(input.teamId) : null;
  if (sharing === "team" && !targetTeamId) {
    return { ok: false, reason: "invalid", code: "team_required" };
  }
  const id = str(input.id);
  if (!id) return { ok: false, reason: "not_found", code: "workspace_not_found" };

  const row = await loadRow(db, id);
  if (row === "unavailable") return { ok: false, reason: "unavailable", code: "store_unavailable" };
  if (!row) return { ok: false, reason: "not_found", code: "workspace_not_found" };

  const listed = await listTeams(db, userId);
  const teams = listed.ok ? listed.teams : [];

  if (str(row.visibility) === "team") {
    const currentTeamId = str(row.team_id);
    const role = currentTeamId ? await roleInTeam(db, userId, currentTeamId, teams) : null;
    if (!canWriteShared(role)) {
      return { ok: false, reason: "forbidden", code: "not_admin_edit" };
    }
  }

  if (sharing === "team") {
    if (teams.length === 0) return { ok: false, reason: "invalid", code: "no_team" };
    const role = await roleInTeam(db, userId, targetTeamId!, teams);
    if (!canWriteShared(role)) {
      return { ok: false, reason: "forbidden", code: "not_admin_share" };
    }
  }

  const nextTeamId = sharing === "team" ? targetTeamId : null;
  const updated = await db
    .from(LAYOUTS_TABLE)
    .update({ visibility: sharing, team_id: nextTeamId, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id,name,team_id,visibility");
  if (updated.error) {
    if (updated.error.code === "23505") return { ok: false, reason: "duplicate", code: "team_name_conflict" };
    if (updated.error.code === "42501") {
      return { ok: false, reason: "forbidden", code: str(row.visibility) === "team" ? "not_admin_edit" : "not_admin_share" };
    }
    return { ok: false, reason: "unavailable", code: "store_unavailable" };
  }
  const rows = Array.isArray(updated.data) ? updated.data : updated.data ? [updated.data as LayoutRow] : [];
  if (!rows.length) {
    return { ok: false, reason: "forbidden", code: str(row.visibility) === "team" ? "not_admin_edit" : "not_admin_share" };
  }
  const teamName = nextTeamId ? teams.find((t) => t.id === nextTeamId)?.name ?? null : null;
  return { ok: true, id, sharing, teamId: nextTeamId, teamName };
}

export function sharingErrorStatus(code: SetSharingResult extends { ok: false } ? SetSharingResult["code"] : never): number {
  switch (code) {
    case "malformed_sharing":
    case "team_required":
    case "no_team":
      return 400;
    case "not_admin_share":
    case "not_admin_edit":
      return 403;
    case "workspace_not_found":
      return 404;
    case "team_name_conflict":
      return 409;
    default:
      return 503;
  }
}

export type SharingFailCode = Extract<SetSharingResult, { ok: false }>["code"];

export function sharingErrorName(code: SharingFailCode | SharedWorkflowCode): string {
  switch (code) {
    case "malformed_sharing":
    case "team_required":
    case "no_team":
      return "INVALID";
    case "not_admin_share":
    case "not_admin_edit":
      return "FORBIDDEN";
    case "workspace_not_found":
      return "NOT_FOUND";
    case "team_name_conflict":
      return "DUPLICATE";
    case "store_unavailable":
    case "team_read_unavailable":
      return "STORE_UNAVAILABLE";
    case "not_signed_in":
      return "UNAUTHENTICATED";
    default:
      return "INVALID";
  }
}
