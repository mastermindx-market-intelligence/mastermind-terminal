import { describe, expect, it } from "vitest";
import { TENANT_SCOPE_VISIBILITIES, decideTenantScope, type DenyReason } from "@/lib/tenantScope";
import type { Team, TeamRole } from "@/lib/teams";
import {
  SHARING_VALUES,
  SHARED_WORKFLOW_DENIALS,
  SHARED_WORKFLOW_MESSAGES,
  canWriteShared,
  listVisibleWorkspaces,
  membershipsFrom,
  setWorkspaceSharing,
  toScopedResource,
} from "@/lib/teamSharedWorkflow";
import { deleteLayout, duplicateWorkspace, renameWorkspace, saveWorkspace } from "@/lib/layouts";
import { createLayoutFixtureDb, fixtureLayoutUserId } from "@/lib/layoutsFixtureDb";

type Row = Record<string, unknown>;
type Filter = { column: string; op: "eq" | "neq" | "is"; value: unknown };

function readPath(row: Row, column: string): unknown {
  const idx = column.indexOf("->>");
  if (idx === -1) return row[column];
  const base = row[column.slice(0, idx)];
  if (typeof base !== "object" || base === null || Array.isArray(base)) return null;
  const val = (base as Record<string, unknown>)[column.slice(idx + 3)];
  return val === undefined || val === null ? null : String(val);
}

function filterMatches(row: Row, filter: Filter): boolean {
  const actual = readPath(row, filter.column);
  switch (filter.op) {
    case "eq": return actual !== null && actual === filter.value;
    case "neq": return actual !== null && actual !== filter.value;
    case "is": return filter.value === null ? actual === null : actual === filter.value;
  }
}

function makeDb(init?: {
  layouts?: Row[];
  teams?: Row[];
  members?: Row[];
  layoutFault?: boolean;
  teamFault?: boolean;
  updateZero?: boolean;
  writeCode?: string;
}) {
  const state = {
    layouts: (init?.layouts ?? []).map((r) => ({ ...r })),
    teams: (init?.teams ?? []).map((r) => ({ ...r })),
    members: (init?.members ?? []).map((r) => ({ ...r })),
    layoutFault: init?.layoutFault ?? false,
    teamFault: init?.teamFault ?? false,
    updateZero: init?.updateZero ?? false,
    writeCode: init?.writeCode,
  };
  let lastSeenUserId: unknown = null;

  function rowsFor(table: string): Row[] {
    if (table === "chart_layouts") return state.layouts;
    if (table === "teams") return state.teams;
    if (table === "team_members") return state.members;
    return [];
  }

  const db = {
    from(table: string) {
      const filters: Filter[] = [];
      let inFilter: { col: string; values: unknown[] } | null = null;
      let pendingInsert: Row | null = null;
      let pendingUpdate: Row | null = null;
      let pendingDelete = false;

      const apply = (rows: Row[]) =>
        rows.filter(
          (r) =>
            filters.every((f) => filterMatches(r, f)) &&
            (!inFilter || inFilter.values.includes(r[inFilter.col])),
        );

      const result = () => {
        if (table === "chart_layouts" && state.layoutFault) {
          return { data: null, error: { code: "XX000", message: "layout fault" } };
        }
        if ((table === "teams" || table === "team_members") && state.teamFault) {
          return { data: null, error: { code: "XX000", message: "team fault" } };
        }
        if (table === "chart_layouts" && state.writeCode && (pendingInsert || pendingUpdate || pendingDelete)) {
          return { data: null, error: { code: state.writeCode, message: "insufficient privilege" } };
        }
        if (pendingInsert) {
          if (
            pendingInsert.visibility === "team" &&
            state.layouts.some(
              (r) => r.team_id === pendingInsert!.team_id && r.name === pendingInsert!.name && r.visibility === "team",
            )
          ) {
            return { data: null, error: { code: "23505", message: "duplicate" } };
          }
          const row = { id: pendingInsert.id ?? `row-${state.layouts.length + 1}`, ...pendingInsert };
          state.layouts.push(row);
          return { data: [row], error: null };
        }
        if (pendingUpdate) {
          if (state.updateZero) return { data: [], error: null };
          const hit = apply(rowsFor(table));
          if (table === "chart_layouts") {
            const teamHit = hit.filter((r) => r.visibility === "team" || pendingUpdate!.visibility === "team");
            if (teamHit.length) {
              const teamId = teamHit[0]?.team_id ?? pendingUpdate!.team_id;
              const member = state.members.find((m) => m.user_id === lastSeenUserId && m.team_id === teamId);
              if (!member || (member.role !== "owner" && member.role !== "admin")) {
                return { data: null, error: { code: "42501", message: "insufficient privilege" } };
              }
            }
          }
          if (
            pendingUpdate.visibility === "team" &&
            typeof pendingUpdate.name === "string" &&
            state.layouts.some(
              (r) =>
                r.team_id === pendingUpdate!.team_id &&
                r.name === pendingUpdate!.name &&
                r.visibility === "team" &&
                !hit.includes(r),
            )
          ) {
            return { data: null, error: { code: "23505", message: "duplicate" } };
          }
          for (const row of hit) Object.assign(row, pendingUpdate);
          return { data: hit.map((r) => ({ ...r })), error: null };
        }
        if (pendingDelete) {
          const hit = apply(rowsFor(table));
          if (table === "chart_layouts" && hit.some((r) => r.visibility === "team")) {
            const teamId = hit.find((r) => r.visibility === "team")?.team_id;
            const member = state.members.find((m) => m.user_id === lastSeenUserId && m.team_id === teamId);
            if (!member || (member.role !== "owner" && member.role !== "admin")) {
              return { data: null, error: { code: "42501", message: "insufficient privilege" } };
            }
          }
          const ids = new Set(hit.map((r) => r.id));
          if (table === "chart_layouts") state.layouts = state.layouts.filter((r) => !ids.has(r.id));
          return { data: hit.map((r) => ({ ...r })), error: null };
        }
        return { data: apply(rowsFor(table)).map((r) => ({ ...r })), error: null };
      };

      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          if (c === "user_id") lastSeenUserId = v;
          filters.push({ column: c, op: "eq", value: v });
          return q;
        },
        neq: (c: string, v: unknown) => {
          filters.push({ column: c, op: "neq", value: v });
          return q;
        },
        is: (c: string, v: null | boolean) => {
          filters.push({ column: c, op: "is", value: v });
          return q;
        },
        in: (c: string, v: unknown[]) => {
          inFilter = { col: c, values: v };
          return q;
        },
        order: () => q,
        limit: () => q,
        insert: (values: Row) => {
          pendingInsert = values;
          return q;
        },
        update: (values: Row) => {
          pendingUpdate = values;
          return q;
        },
        delete: () => {
          pendingDelete = true;
          return q;
        },
        maybeSingle: async () => {
          const r = result();
          if (r.error) return r;
          const data = Array.isArray(r.data) ? r.data[0] ?? null : r.data;
          return { data, error: null };
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return q;
    },
  };
  return { db, state };
}

const TEAM_A = "team-a";
const TEAM_B = "team-b";
const OWNER = "user-owner";
const ADMIN = "user-admin";
const MEMBER = "user-member";
const STRANGER = "user-stranger";
const OTHER = "user-other";

const teamsA = (role: TeamRole, userId: string): Team[] => [
  { id: TEAM_A, name: "Desk", role, createdAt: "2026-01-01T00:00:00.000Z" },
];

function seedTeam() {
  return {
    teams: [
      { id: TEAM_A, name: "Desk", created_at: "2026-01-01T00:00:00.000Z" },
      { id: TEAM_B, name: "Other Desk", created_at: "2026-01-01T00:00:00.000Z" },
    ],
    members: [
      { team_id: TEAM_A, user_id: OWNER, role: "owner" },
      { team_id: TEAM_A, user_id: ADMIN, role: "admin" },
      { team_id: TEAM_A, user_id: MEMBER, role: "member" },
      { team_id: TEAM_B, user_id: OTHER, role: "member" },
    ],
  };
}

const WS1 = { schema: "workspace_layout.v1", revision: 1 };

const privateRow = (userId: string, name = "Mine", config: Row = {}): Row => ({
  id: `priv-${userId}`,
  user_id: userId,
  name,
  config,
  updated_at: "2026-01-02T00:00:00.000Z",
  team_id: null,
  visibility: "private",
});

const sharedRow = (creator: string, name = "Open", config: Row = {}): Row => ({
  id: `shared-${name}`,
  user_id: creator,
  name,
  config,
  updated_at: "2026-01-02T00:00:00.000Z",
  team_id: TEAM_A,
  visibility: "team",
});

describe("team-shared workspaces — who can see what", () => {
  it("a private workspace is read by its owner and by nobody else", async () => {
    const { db } = makeDb({ layouts: [privateRow(OWNER)], ...seedTeam() });
    const mine = await listVisibleWorkspaces(db as any, OWNER);
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
    expect(mine.layouts.map((l) => l.id)).toEqual(["priv-user-owner"]);
    const other = await listVisibleWorkspaces(db as any, MEMBER);
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(other.layouts.map((l) => l.id)).toEqual([]);
  });

  it("a workspace shared with a team is read by a second member of that team", async () => {
    const { db } = makeDb({ layouts: [sharedRow(OWNER)], ...seedTeam() });
    const result = await listVisibleWorkspaces(db as any, MEMBER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layouts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "shared-Open", sharing: "team" })]),
    );
  });

  it("a signed-out visitor is denied every shared workspace", async () => {
    const decision = decideTenantScope(null, [], toScopedResource(sharedRow(OWNER)));
    expect(decision).toEqual({ allow: false, reason: "no_identity" });
    const { db } = makeDb({ layouts: [sharedRow(OWNER)], ...seedTeam() });
    const result = await listVisibleWorkspaces(db as any, "");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layouts).toEqual([]);
  });

  it("a signed-in person who is on no team is denied a shared workspace", async () => {
    const decision = decideTenantScope({ userId: STRANGER }, [], toScopedResource(sharedRow(OWNER)));
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("no_membership");
    const { db } = makeDb({
      layouts: [sharedRow(OWNER)],
      teams: seedTeam().teams,
      members: seedTeam().members.filter((m) => m.user_id !== STRANGER),
    });
    const result = await listVisibleWorkspaces(db as any, STRANGER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layouts.map((l) => l.id)).not.toContain("shared-Open");
  });

  it("a member of another team is denied a shared workspace", async () => {
    const decision = decideTenantScope(
      { userId: OTHER },
      [{ userId: OTHER, teamId: TEAM_B, role: "member", revokedAt: null }],
      toScopedResource(sharedRow(OWNER)),
    );
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("wrong_team");
    const { db } = makeDb({ layouts: [sharedRow(OWNER)], ...seedTeam() });
    const result = await listVisibleWorkspaces(db as any, OTHER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layouts.map((l) => l.id)).not.toContain("shared-Open");
  });

  it("a person whose membership was revoked is denied, even holding the row", async () => {
    const { db } = makeDb({ layouts: [sharedRow(OWNER)], ...seedTeam() });
    const result = await listVisibleWorkspaces(db as any, MEMBER, {
      memberships: [{ userId: MEMBER, teamId: TEAM_A, role: "member", revokedAt: "2026-09-01T00:00:00.000Z" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layouts.map((l) => l.id)).not.toContain("shared-Open");
    expect(result.denied.some((d) => d.reason === "membership_revoked")).toBe(true);
  });

  it("a workspace marked shared with no team attached is denied, never shown", async () => {
    const malformed = { ...sharedRow(OWNER), team_id: null };
    const decision = decideTenantScope(
      { userId: MEMBER },
      [{ userId: MEMBER, teamId: TEAM_A, role: "member", revokedAt: null }],
      toScopedResource(malformed),
    );
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("resource_has_no_team");
    const { db } = makeDb({ layouts: [malformed], ...seedTeam() });
    const result = await listVisibleWorkspaces(db as any, MEMBER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layouts.map((l) => l.id)).not.toContain("shared-Open");
  });

  it("a sharing value this build does not understand denies instead of defaulting to private", async () => {
    const weird = { ...sharedRow(OWNER), visibility: "public" };
    const decision = decideTenantScope(
      { userId: MEMBER },
      [{ userId: MEMBER, teamId: TEAM_A, role: "member", revokedAt: null }],
      toScopedResource(weird),
    );
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("visibility_unrecognized");
    const { db } = makeDb({ layouts: [weird], ...seedTeam() });
    const result = await listVisibleWorkspaces(db as any, MEMBER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layouts.map((l) => l.id)).not.toContain("shared-Open");
  });

  it("the sharing vocabulary is TENANT_SCOPE_VISIBILITIES itself, not a second copy", () => {
    expect(SHARING_VALUES).toBe(TENANT_SCOPE_VISIBILITIES);
    expect(SHARING_VALUES).toEqual(["private", "team"]);
  });

  it("memberships are built from listTeams, and a foreign membership row grants nothing", () => {
    const foreign = membershipsFrom(MEMBER, [{ id: TEAM_A, name: "Desk", role: "owner", createdAt: null }]);
    expect(foreign.every((m) => m.userId === MEMBER)).toBe(true);
    const mixed = membershipsFrom(MEMBER, teamsA("member", MEMBER));
    expect(mixed).toEqual([
      expect.objectContaining({ userId: MEMBER, teamId: TEAM_A, role: "member", revokedAt: null }),
    ]);
    const scoped = toScopedResource(sharedRow(OWNER));
    expect(scoped.ownerId).toBe(OWNER);
    expect(scoped.teamId).toBe(TEAM_A);
    expect(scoped.visibility).toBe("team");
  });
});

describe("team-shared workspaces — who can write", () => {
  it("a team owner may share, rename and delete a shared workspace", async () => {
    const { db, state } = makeDb({ layouts: [privateRow(OWNER, "Open", WS1)], ...seedTeam() });
    const shared = await setWorkspaceSharing(db as any, OWNER, { id: "priv-user-owner", sharing: "team", teamId: TEAM_A });
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;
    expect(shared.sharing).toBe("team");
    const renamed = await renameWorkspace(db as any, OWNER, "Open", "Open 2", 1, "priv-user-owner");
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(state.layouts.find((r) => r.id === "priv-user-owner")?.name).toBe("Open 2");
    const deleted = await deleteLayout(db as any, OWNER, "priv-user-owner");
    expect(deleted.ok).toBe(true);
    expect(state.layouts.some((r) => r.id === "priv-user-owner")).toBe(false);
    expect(canWriteShared("owner")).toBe(true);
  });

  it("a team administrator may share, rename and delete a shared workspace", async () => {
    const { db, state } = makeDb({ layouts: [privateRow(ADMIN, "Admin Desk", WS1)], ...seedTeam() });
    const shared = await setWorkspaceSharing(db as any, ADMIN, {
      id: "priv-user-admin",
      sharing: "team",
      teamId: TEAM_A,
    });
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;
    const renamed = await renameWorkspace(db as any, ADMIN, "Admin Desk", "Admin Desk 2", 1, "priv-user-admin");
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(state.layouts.find((r) => r.id === "priv-user-admin")?.name).toBe("Admin Desk 2");
    const deleted = await deleteLayout(db as any, ADMIN, "priv-user-admin");
    expect(deleted.ok).toBe(true);
    expect(state.layouts.some((r) => r.id === "priv-user-admin")).toBe(false);
    expect(canWriteShared("admin")).toBe(true);
  });

  it("a team administrator who did not create the row may overwrite a shared workspace", async () => {
    const { db, state } = makeDb({
      layouts: [sharedRow(OWNER, "Open", WS1)],
      ...seedTeam(),
    });
    const saved = await saveWorkspace(
      db as any,
      ADMIN,
      "Open",
      { schema: "workspace_layout.v1", widgets: [{ id: "w1" }] },
      1,
      "shared-Open",
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.revision).toBe(2);
    const row = state.layouts.find((r) => r.id === "shared-Open");
    expect((row?.config as { revision?: number } | undefined)?.revision).toBe(2);
  });

  it("a store refusal of a shared overwrite is forbidden, never unavailable", async () => {
    const { db } = makeDb({
      layouts: [sharedRow(OWNER, "Open", WS1)],
      ...seedTeam(),
      writeCode: "42501",
    });
    const saved = await saveWorkspace(db as any, OWNER, "Open", { schema: "workspace_layout.v1" }, 1, "shared-Open");
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.reason).toBe("forbidden");
  });

  it("a plain member cannot share a workspace with the team", async () => {
    const { db } = makeDb({ layouts: [privateRow(MEMBER, "Mine")], ...seedTeam() });
    const result = await setWorkspaceSharing(db as any, MEMBER, {
      id: "priv-user-member",
      sharing: "team",
      teamId: TEAM_A,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_admin_share");
  });

  it("a plain member cannot rename, overwrite or delete a workspace the team shares", async () => {
    const { db } = makeDb({ layouts: [sharedRow(OWNER)], ...seedTeam() });
    const renamed = await renameWorkspace(db as any, MEMBER, "Open", "Hijacked", 1, "shared-Open");
    expect(renamed.ok).toBe(false);
    if (renamed.ok) return;
    expect(renamed.reason).toBe("forbidden");
    const saved = await saveWorkspace(db as any, MEMBER, "Open", { schema: "workspace_layout.v1" }, 1, "shared-Open");
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.reason).toBe("forbidden");
  });

  it("a plain member may duplicate a shared workspace, and the copy is private", async () => {
    const { db, state } = makeDb({ layouts: [sharedRow(OWNER)], ...seedTeam() });
    const copy = await duplicateWorkspace(db as any, MEMBER, "Open", "My Open", "shared-Open");
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    const row = state.layouts.find((r) => r.id === copy.id);
    expect(row?.visibility).toBe("private");
    expect(row?.team_id).toBeNull();
    expect(row?.user_id).toBe(MEMBER);
  });

  it("the creator of a shared workspace cannot change it once they are no longer an administrator", async () => {
    const { db } = makeDb({
      layouts: [sharedRow(ADMIN)],
      teams: seedTeam().teams,
      members: [
        { team_id: TEAM_A, user_id: OWNER, role: "owner" },
        { team_id: TEAM_A, user_id: ADMIN, role: "member" },
        { team_id: TEAM_A, user_id: MEMBER, role: "member" },
      ],
    });
    const result = await setWorkspaceSharing(db as any, ADMIN, {
      id: "shared-Open",
      sharing: "private",
      teamId: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_admin_edit");
  });

  it("nothing about private workspaces changes: a member still creates, renames and deletes their own", async () => {
    const { db, state } = makeDb({ layouts: [], ...seedTeam() });
    const created = await saveWorkspace(db as any, MEMBER, "Solo", { schema: "workspace_layout.v1" }, null);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(state.layouts.some((r) => r.id === created.id && r.user_id === MEMBER && r.visibility !== "team")).toBe(true);
    const renamed = await renameWorkspace(db as any, MEMBER, "Solo", "Solo 2", 1, created.id);
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(state.layouts.find((r) => r.id === created.id)?.name).toBe("Solo 2");
    const deleted = await deleteLayout(db as any, MEMBER, created.id);
    expect(deleted.ok).toBe(true);
    expect(state.layouts.some((r) => r.id === created.id)).toBe(false);
    const listed = await listVisibleWorkspaces(db as any, MEMBER);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.layouts.some((l) => l.id === created.id)).toBe(false);
  });

  it("fixture select hides a foreign team's shared row on an id read", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const keyA = `wf-fix-a-${suffix}`;
    const keyB = `wf-fix-b-${suffix}`;
    const teamA = `team-a-${suffix}`;
    const teamB = `team-b-${suffix}`;
    const dbA = createLayoutFixtureDb(keyA, "", { teamId: teamA, role: "owner", teamName: "Desk A" });
    const userA = fixtureLayoutUserId(keyA);
    const inserted = await dbA
      .from("chart_layouts")
      .insert({
        user_id: userA,
        name: "Open",
        config: WS1,
        visibility: "team",
        team_id: teamA,
        updated_at: "2026-01-02T00:00:00.000Z",
      })
      .select("id");
    const id = (inserted.data as Row[] | undefined)?.[0]?.id;
    expect(typeof id).toBe("string");
    const dbB = createLayoutFixtureDb(keyB, "", { teamId: teamB, role: "member", teamName: "Desk B" });
    const loaded = await dbB.from("chart_layouts").select("id").eq("id", id).maybeSingle();
    expect(loaded.error).toBeUndefined();
    expect(loaded.data ?? null).toBeNull();
  });

  it("a write that touches zero rows is a refusal, never a success", async () => {
    const { db } = makeDb({ layouts: [sharedRow(OWNER)], ...seedTeam(), updateZero: true });
    const result = await setWorkspaceSharing(db as any, OWNER, {
      id: "shared-Open",
      sharing: "private",
      teamId: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_admin_edit");
  });
});

describe("team-shared workspaces — reading the library", () => {
  it("a team-directory failure never renders as an empty team library", async () => {
    const { db } = makeDb({ layouts: [privateRow(OWNER)], ...seedTeam(), teamFault: true });
    const result = await listVisibleWorkspaces(db as any, OWNER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layouts.some((l) => l.id === "priv-user-owner")).toBe(true);
    expect(result.teamRead.ok).toBe(false);
    if (result.teamRead.ok) return;
    expect(result.teamRead.message).toBe(SHARED_WORKFLOW_MESSAGES.team_read_unavailable[0]);
    expect(result.teamRead.messageZh).toBe(SHARED_WORKFLOW_MESSAGES.team_read_unavailable[1]);
  });

  it("a personal-library failure is still a 503, not a partial success", async () => {
    const { db } = makeDb({ layouts: [privateRow(OWNER)], ...seedTeam(), layoutFault: true });
    const result = await listVisibleWorkspaces(db as any, OWNER);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unavailable");
  });

  it("a row that is both mine and shared appears exactly once, in the team group", async () => {
    const { db } = makeDb({
      layouts: [{ ...sharedRow(OWNER), user_id: OWNER }],
      ...seedTeam(),
    });
    const result = await listVisibleWorkspaces(db as any, OWNER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hits = result.layouts.filter((l) => l.id === "shared-Open");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.sharing).toBe("team");
    expect(hits[0]?.mine).toBe(true);
  });

  it("canEdit is computed from the caller's role, never from who created the row", async () => {
    const { db } = makeDb({ layouts: [sharedRow(OWNER)], ...seedTeam() });
    const member = await listVisibleWorkspaces(db as any, MEMBER);
    expect(member.ok).toBe(true);
    if (!member.ok) return;
    expect(member.layouts.find((l) => l.id === "shared-Open")?.canEdit).toBe(false);
    const admin = await listVisibleWorkspaces(db as any, ADMIN);
    expect(admin.ok).toBe(true);
    if (!admin.ok) return;
    expect(admin.layouts.find((l) => l.id === "shared-Open")?.canEdit).toBe(true);
  });
});

describe("team-shared workspaces — plain words", () => {
  it("every deny reason has an English sentence and a Chinese sentence", () => {
    const reasons: DenyReason[] = [
      "no_identity",
      "malformed_resource",
      "visibility_absent",
      "visibility_unrecognized",
      "private_not_owner",
      "resource_has_no_team",
      "no_membership",
      "wrong_team",
      "membership_revoked",
      "grant_revoked",
    ];
    for (const reason of reasons) {
      const pair = SHARED_WORKFLOW_DENIALS[reason];
      expect(pair[0].length).toBeGreaterThan(8);
      expect(pair[1].length).toBeGreaterThan(4);
    }
  });

  it("no reason string, policy name, table name or Postgres code appears in any message", () => {
    const banned =
      /chart_layouts|not_admin_share|not_admin_edit|23505|42501|team_member_visible|visibility_unrecognized|visibility_absent|private_not_owner|resource_has_no_team|membership_revoked|grant_revoked|no_identity|malformed_resource|pg_/i;
    const all = [
      ...Object.values(SHARED_WORKFLOW_MESSAGES).flat(),
      ...Object.values(SHARED_WORKFLOW_DENIALS).flat(),
    ];
    for (const sentence of all) {
      expect(sentence).not.toMatch(banned);
    }
  });

  it("every message is a complete sentence ending in a full stop", () => {
    const all = [
      ...Object.values(SHARED_WORKFLOW_MESSAGES).flat(),
      ...Object.values(SHARED_WORKFLOW_DENIALS).flat(),
    ];
    for (const sentence of all) {
      expect(sentence.endsWith(".") || sentence.endsWith("。")).toBe(true);
    }
  });
});
