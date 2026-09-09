import { beforeEach, describe, expect, it, vi } from "vitest";
import { SHARED_WORKFLOW_MESSAGES } from "@/lib/teamSharedWorkflow";

const H = vi.hoisted(() => ({
  user: null as { id: string } | null,
  db: null as any,
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));

type Row = Record<string, unknown>;

function makeDb(init?: { layouts?: Row[]; teams?: Row[]; members?: Row[]; layoutFault?: boolean; writeFault?: boolean }) {
  const state = {
    layouts: (init?.layouts ?? []).map((r) => ({ ...r })),
    teams: (init?.teams ?? []).map((r) => ({ ...r })),
    members: (init?.members ?? []).map((r) => ({ ...r })),
    layoutFault: init?.layoutFault ?? false,
    writeFault: init?.writeFault ?? false,
  };

  function rowsFor(table: string): Row[] {
    if (table === "chart_layouts") return state.layouts;
    if (table === "teams") return state.teams;
    if (table === "team_members") return state.members;
    return [];
  }

  const db = {
    from(table: string) {
      let filters: Array<[string, unknown]> = [];
      let inFilter: { col: string; values: unknown[] } | null = null;
      let pendingInsert: Row | null = null;
      let pendingUpdate: Row | null = null;
      let pendingDelete = false;

      const apply = (rows: Row[]) =>
        rows.filter(
          (r) =>
            filters.every(([c, v]) => r[c] === v) &&
            (!inFilter || inFilter.values.includes(r[inFilter.col])),
        );

      const result = () => {
        if (table === "chart_layouts" && state.layoutFault) {
          return { data: null, error: { code: "XX000", message: "layout fault" } };
        }
        if (pendingInsert) {
          if (state.writeFault) return { data: null, error: { code: "XX000", message: "write fault" } };
          if (
            pendingInsert.visibility === "team" &&
            state.layouts.some(
              (r) => r.team_id === pendingInsert!.team_id && r.name === pendingInsert!.name && r.visibility === "team",
            )
          ) {
            return { data: null, error: { code: "23505", message: "duplicate" } };
          }
          const row = { id: pendingInsert.id ?? `row-${state.layouts.length + 1}`, created_at: new Date().toISOString(), ...pendingInsert };
          state.layouts.push(row);
          return { data: [row], error: null };
        }
        if (pendingUpdate) {
          if (state.writeFault) return { data: null, error: { code: "XX000", message: "write fault" } };
          const hit = apply(rowsFor(table));
          if (pendingUpdate.visibility === "team") {
            for (const row of hit) {
              const nextName = typeof pendingUpdate.name === "string" ? pendingUpdate.name : row.name;
              const nextTeam = pendingUpdate.team_id ?? row.team_id;
              const clash = state.layouts.some(
                (r) => r !== row && r.visibility === "team" && r.team_id === nextTeam && r.name === nextName,
              );
              if (clash) return { data: null, error: { code: "23505", message: "duplicate" } };
            }
          }
          for (const row of hit) Object.assign(row, pendingUpdate);
          return { data: hit.map((r) => ({ ...r })), error: null };
        }
        if (pendingDelete) {
          const hit = apply(rowsFor(table));
          const ids = new Set(hit.map((r) => r.id));
          if (table === "chart_layouts") state.layouts = state.layouts.filter((r) => !ids.has(r.id));
          return { data: hit.map((r) => ({ ...r })), error: null };
        }
        return { data: apply(rowsFor(table)).map((r) => ({ ...r })), error: null };
      };

      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          filters.push([c, v]);
          return q;
        },
        neq: () => q,
        is: () => q,
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
        upsert: () => q,
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
const OWNER = "user-owner";
const ADMIN = "user-admin";
const MEMBER = "user-member";

const seed = {
  teams: [{ id: TEAM_A, name: "Desk", created_at: "2026-01-01T00:00:00.000Z" }],
  members: [
    { team_id: TEAM_A, user_id: OWNER, role: "owner" },
    { team_id: TEAM_A, user_id: ADMIN, role: "admin" },
    { team_id: TEAM_A, user_id: MEMBER, role: "member" },
  ],
};

function privateRow(userId: string, name = "Mine"): Row {
  return {
    id: `priv-${userId}`,
    user_id: userId,
    name,
    config: {},
    updated_at: "2026-01-02T00:00:00.000Z",
    team_id: null,
    visibility: "private",
  };
}

function sharedRow(creator: string, name = "Open"): Row {
  return {
    id: `shared-${name}`,
    user_id: creator,
    name,
    config: { schema: "workspace_layout.v1", revision: 1, requires: { floor: 1 }, name: null, link_groups: {}, widgets: [], migration: { source: "none", source_revision: null } },
    updated_at: "2026-01-02T00:00:00.000Z",
    team_id: TEAM_A,
    visibility: "team",
  };
}

describe("team-shared workspaces — HTTP contract", () => {
  let GET: any, POST: any, DELETE: any, transport: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    vi.resetModules();
    H.user = { id: OWNER };
    transport = makeDb({
      layouts: [privateRow(OWNER, "Mine"), sharedRow(OWNER)],
      ...seed,
    });
    H.db = transport.db;
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: H.user } }) },
        from: H.db.from.bind(H.db),
      }),
    }));
    ({ GET, POST, DELETE } = await import("@/app/api/layouts/route"));
  });

  function post(body: Record<string, unknown>) {
    return POST(new Request("https://x.test/api/layouts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  }

  it("GET returns the caller's own workspaces plus their team's shared ones", async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.layouts.some((l: { name: string }) => l.name === "Mine")).toBe(true);
    expect(body.layouts.some((l: { sharing: string }) => l.sharing === "team")).toBe(true);
    expect(body.teams).toEqual(expect.arrayContaining([expect.objectContaining({ id: TEAM_A, role: "owner" })]));
    expect(body.teamRead).toEqual({ ok: true });
  });

  it("GET answers 401 for a guest, never an empty list", async () => {
    H.user = null;
    const r = await GET();
    expect(r.status).toBe(401);
    const body = await r.json();
    expect(body.layouts).toBeUndefined();
    expect(body.error).toBeTruthy();
    expect(typeof body.message).toBe("string");
    expect(typeof body.messageZh).toBe("string");
  });

  it("GET answers 200 with teamRead.ok false when the team read fails, and the personal list survives", async () => {
    transport = makeDb({ layouts: [privateRow(OWNER, "Mine")], ...seed, layoutFault: false });
    transport.state.members = [];
    // Force team_members read to fail by replacing from()
    const inner = transport.db.from.bind(transport.db);
    transport.db.from = (table: string) => {
      if (table === "team_members") {
        const q: any = {
          select: () => q,
          eq: () => q,
          limit: () => q,
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: { code: "XX000", message: "team down" } }).then(resolve),
        };
        return q;
      }
      return inner(table);
    };
    H.db = transport.db;
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: H.user } }) },
        from: H.db.from.bind(H.db),
      }),
    }));
    ({ GET } = await import("@/app/api/layouts/route"));
    const r = await GET();
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.layouts.some((l: { name: string }) => l.name === "Mine")).toBe(true);
    expect(body.teamRead.ok).toBe(false);
    expect(body.teamRead.message).toBe(SHARED_WORKFLOW_MESSAGES.team_read_unavailable[0]);
  });

  it("POST set_sharing to team answers 200 for an owner and 200 for an administrator", async () => {
    const owner = await post({ op: "set_sharing", id: "priv-user-owner", sharing: "team", teamId: TEAM_A });
    expect(owner.status).toBe(200);
    const ownerBody = await owner.json();
    expect(ownerBody.ok).toBe(true);
    expect(ownerBody.sharing).toBe("team");

    H.user = { id: ADMIN };
    transport.state.layouts.push(privateRow(ADMIN, "Admin Mine"));
    const admin = await post({ op: "set_sharing", id: "priv-user-admin", sharing: "team", teamId: TEAM_A });
    expect(admin.status).toBe(200);
  });

  it("POST set_sharing to team answers 403 not_admin_share for a plain member", async () => {
    H.user = { id: MEMBER };
    transport.state.layouts.push(privateRow(MEMBER, "Member Mine"));
    const r = await post({ op: "set_sharing", id: "priv-user-member", sharing: "team", teamId: TEAM_A });
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.error).toBe("FORBIDDEN");
    expect(body.message).toBe(SHARED_WORKFLOW_MESSAGES.not_admin_share[0]);
    expect(body.messageZh).toBe(SHARED_WORKFLOW_MESSAGES.not_admin_share[1]);
    expect(JSON.stringify(body)).not.toMatch(/not_admin_share|chart_layouts|42501/);
  });

  it("POST set_sharing answers 400 when sharing is neither private nor team", async () => {
    const r = await post({ op: "set_sharing", id: "priv-user-owner", sharing: "public", teamId: TEAM_A });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("INVALID");
    expect(body.message).toBe(SHARED_WORKFLOW_MESSAGES.malformed_sharing[0]);
  });

  it("POST set_sharing answers 400 when sharing is team and no team is chosen", async () => {
    const r = await post({ op: "set_sharing", id: "priv-user-owner", sharing: "team", teamId: null });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("INVALID");
    expect(body.message).toBe(SHARED_WORKFLOW_MESSAGES.team_required[0]);
  });

  it("POST set_sharing answers 404 for a workspace the caller cannot see", async () => {
    H.user = { id: MEMBER };
    const r = await post({ op: "set_sharing", id: "does-not-exist", sharing: "team", teamId: TEAM_A });
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.error).toBe("NOT_FOUND");
  });

  it("POST set_sharing answers 409 when the team already shares that name", async () => {
    transport.state.layouts.push({
      ...privateRow(OWNER, "Open"),
      id: "priv-open-dup",
      name: "Open",
    });
    const r = await post({ op: "set_sharing", id: "priv-open-dup", sharing: "team", teamId: TEAM_A });
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.error).toBe("DUPLICATE");
    expect(body.message).toBe(SHARED_WORKFLOW_MESSAGES.team_name_conflict[0]);
  });

  it("POST set_sharing answers 503 on a store failure, never 200", async () => {
    transport.state.writeFault = true;
    const r = await post({ op: "set_sharing", id: "priv-user-owner", sharing: "team", teamId: TEAM_A });
    expect(r.status).toBe(503);
    expect(r.status).not.toBe(200);
    const body = await r.json();
    expect(body.error).toBe("STORE_UNAVAILABLE");
  });

  it("POST rename answers 403 for a plain member against a shared workspace", async () => {
    H.user = { id: MEMBER };
    const r = await post({
      op: "rename",
      oldName: "Open",
      newName: "Hijacked",
      expectedRevision: 1,
      id: "shared-Open",
    });
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.error).toBe("FORBIDDEN");
    expect(body.message).toBe(SHARED_WORKFLOW_MESSAGES.not_admin_edit[0]);
  });

  it("DELETE answers 403 for a plain member against a shared workspace", async () => {
    H.user = { id: MEMBER };
    const r = await DELETE(new Request("https://x.test/api/layouts?id=shared-Open", { method: "DELETE" }));
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.error).toBe("FORBIDDEN");
    expect(body.message).toBe(SHARED_WORKFLOW_MESSAGES.not_admin_edit[0]);
  });

  it("POST duplicate succeeds for a plain member and the new row is private", async () => {
    H.user = { id: MEMBER };
    const r = await post({ op: "duplicate", sourceName: "Open", newName: "My Open", sourceId: "shared-Open" });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    const copy = transport.state.layouts.find((row) => row.id === body.id);
    expect(copy?.visibility).toBe("private");
    expect(copy?.team_id).toBeNull();
    expect(copy?.user_id).toBe(MEMBER);
  });

  it("every error body carries error, message and messageZh", async () => {
    H.user = null;
    const r = await GET();
    const body = await r.json();
    expect(body).toEqual(expect.objectContaining({ error: expect.any(String), message: expect.any(String), messageZh: expect.any(String) }));
  });

  it("the frozen section 8 codes keep their exact strings and statuses", async () => {
    const r = await post({ op: "rename", oldName: "  ", newName: "Swing", expectedRevision: 1 });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("invalid_name");
  });
});
