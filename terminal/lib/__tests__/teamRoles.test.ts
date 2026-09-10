/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_ROUTE_MESSAGES, writeSetting } from "@/lib/teams";

// vi.hoisted + vi.resetModules + vi.doMock + await import: same idiom as teamsRoute.test.ts.
const H = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: H.user } }) },
  }),
}));

type Row = Record<string, unknown>;
function makeFakeTransport() {
  const state = {
    teams: [] as Row[],
    team_members: [] as Row[],
    team_invites: [] as Row[],
    workspace_settings: [] as Row[],
    fault: null as { code: string } | null,
    insertFault: null as { code: string } | null,
    rlsEmptyWrite: false,
    // A fault that fires on the UPDATE/DELETE only, so the caller's role still reads normally and
    // the write is the thing under test (round-4 ruling R4(i)).
    writeFault: null as { code: string } | null,
    seq: 0,
  };
  const nextId = (prefix: string) => `${prefix}-${++state.seq}`;

  type Table = "teams" | "team_members" | "team_invites" | "workspace_settings";
  function rowsFor(table: Table) {
    return state[table];
  }

  const db = {
    rpc: async () => ({ data: [], error: null }),
    from(table: Table) {
      const filters: Array<[string, unknown]> = [];
      let inFilter: { col: string; values: unknown[] } | null = null;
      let orderCol: string | null = null;
      let pendingInsert: Row | Row[] | null = null;
      let pendingUpdate: Row | null = null;
      let pendingDelete = false;

      const applyFilters = (rows: Row[]) =>
        rows.filter((r) => filters.every(([c, v]) => r[c] === v) && (!inFilter || inFilter.values.includes(r[inFilter.col])));

      const result = () => {
        if (state.fault) return { data: null, error: { code: state.fault.code, message: "fault" } };
        if (pendingInsert) {
          if (state.insertFault) return { data: null, error: { code: state.insertFault.code, message: "fault" } };
          const values = Array.isArray(pendingInsert) ? pendingInsert : [pendingInsert];
          if (table === "workspace_settings") {
            const v = values[0] || {};
            if (v.scope === "workspace" && v.team_id) {
              const role = rowsFor("team_members").find((r) => r.team_id === v.team_id && r.user_id === v.user_id)?.role;
              if (role === "member" || role == null) {
                return { data: null, error: { code: "42501", message: "rls" } };
              }
            }
          }
          const inserted: Row[] = [];
          for (const v of values) {
            if (table === "team_members") {
              const dup = rowsFor(table).find((r) => r.team_id === v.team_id && r.user_id === v.user_id);
              if (dup) return { data: null, error: { code: "23505", message: "duplicate" } };
            }
            if (table === "team_invites") {
              const dup = rowsFor(table).find((r) => r.team_id === v.team_id && r.email === v.email);
              if (dup) return { data: null, error: { code: "23505", message: "duplicate" } };
            }
            const row: Row = { id: nextId(table), created_at: new Date().toISOString(), ...v };
            rowsFor(table).push(row);
            inserted.push(row);
            if (table === "teams") {
              state.team_members.push({
                id: nextId("tm"),
                team_id: row.id,
                user_id: row.created_by,
                role: "owner",
                invited_by: row.created_by,
                created_at: row.created_at,
              });
            }
          }
          return { data: inserted, error: null };
        }
        if (pendingUpdate) {
          if (state.writeFault) return { data: null, error: { code: state.writeFault.code, message: "fault" } };
          if (state.rlsEmptyWrite) return { data: [], error: null };
          const matched = applyFilters(rowsFor(table));
          for (const row of matched) Object.assign(row, pendingUpdate);
          return { data: matched, error: null };
        }
        if (pendingDelete) {
          if (state.writeFault) return { data: null, error: { code: state.writeFault.code, message: "fault" } };
          if (state.rlsEmptyWrite) return { data: [], error: null };
          const matched = applyFilters(rowsFor(table)).map((r) => ({ ...r }));
          const ids = new Set(matched.map((r) => r.id));
          state[table] = state[table].filter((r) => !ids.has(r.id)) as typeof state.teams;
          return { data: matched, error: null };
        }
        let rows = applyFilters(rowsFor(table));
        if (orderCol) rows = [...rows].sort((a, b) => String(a[orderCol!]).localeCompare(String(b[orderCol!])));
        return { data: rows, error: null };
      };

      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          filters.push([c, v]);
          return q;
        },
        in: (c: string, v: unknown[]) => {
          inFilter = { col: c, values: v };
          return q;
        },
        order: (c: string) => {
          orderCol = c;
          return q;
        },
        limit: () => q,
        insert: (values: Row | Row[]) => {
          pendingInsert = values;
          return q;
        },
        upsert: (values: Row | Row[]) => {
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

describe("B-F12-8 policy matrix (§2.1)", () => {
  let POST: any, MGET: any, MPOST: any, MPATCH: any, MDELETE: any, IGET: any, IPOST: any;
  let transport: ReturnType<typeof makeFakeTransport>;

  beforeEach(async () => {
    vi.resetModules();
    H.user = null;
    transport = makeFakeTransport();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user: H.user } }) }, ...transport.db }),
    }));
    ({ POST } = await import("@/app/api/teams/route"));
    ({ GET: MGET, POST: MPOST, PATCH: MPATCH, DELETE: MDELETE } = await import("@/app/api/teams/[id]/members/route"));
    ({ GET: IGET, POST: IPOST } = await import("@/app/api/teams/invitations/route"));
  });

  function req(body: unknown) {
    return new Request("http://localhost/api/teams", { method: "POST", body: JSON.stringify(body) });
  }
  function ctx(id: string) {
    return { params: Promise.resolve({ id }) };
  }
  function membersReq(method: string, body?: unknown, query = "") {
    return new Request(`http://localhost/api/teams/t/members${query}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function seedRoster() {
    H.user = { id: "owner" };
    const created = await (await POST(req({ name: "Desk" }))).json();
    const teamId = created.team.id as string;
    await MPOST(membersReq("POST", { userId: "admin", role: "admin" }), ctx(teamId));
    await MPOST(membersReq("POST", { userId: "member", role: "member" }), ctx(teamId));
    await MPOST(membersReq("POST", { userId: "peer", role: "member" }), ctx(teamId));
    return teamId;
  }

  async function jsonOf(res: Response) {
    return { status: res.status, body: await res.json() };
  }

  function expectCode(body: { message?: string; messageZh?: string }, code: keyof typeof TEAM_ROUTE_MESSAGES) {
    expect(body.message).toBe(TEAM_ROUTE_MESSAGES[code][0]);
    expect(body.messageZh).toBe(TEAM_ROUTE_MESSAGES[code][1]);
  }

  it("GET roster: owner, administrator and member all see the people on the team", async () => {
    const teamId = await seedRoster();
    for (const id of ["owner", "admin", "member"]) {
      H.user = { id };
      const { status, body } = await jsonOf(await MGET(membersReq("GET"), ctx(teamId)));
      expect(status).toBe(200);
      expect(body.members.length).toBeGreaterThanOrEqual(3);
      expect(body.callerRole).toBe(id === "owner" ? "owner" : id === "admin" ? "admin" : "member");
    }
  });

  it("invite by email link: owner and administrator 201, member 403", async () => {
    const teamId = await seedRoster();
    const body = { action: "create", teamId, email: "new@example.com", role: "member" };
    H.user = { id: "owner" };
    expect((await IPOST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }))).status).toBe(201);
    H.user = { id: "admin" };
    expect(
      (await IPOST(new Request("http://x", { method: "POST", body: JSON.stringify({ ...body, email: "two@example.com" }) }))).status,
    ).toBe(201);
    H.user = { id: "member" };
    const denied = await IPOST(new Request("http://x", { method: "POST", body: JSON.stringify({ ...body, email: "three@example.com" }) }));
    expect(denied.status).toBe(403);
  });

  it("see pending invitations: owner and administrator 200, member 403", async () => {
    const teamId = await seedRoster();
    H.user = { id: "owner" };
    expect((await IGET(new Request(`http://x/api/teams/invitations?teamId=${teamId}`))).status).toBe(200);
    H.user = { id: "admin" };
    expect((await IGET(new Request(`http://x/api/teams/invitations?teamId=${teamId}`))).status).toBe(200);
    H.user = { id: "member" };
    expect((await IGET(new Request(`http://x/api/teams/invitations?teamId=${teamId}`))).status).toBe(403);
  });

  it("add an existing account as a member: owner and administrator 201, member 403", async () => {
    const teamId = await seedRoster();
    H.user = { id: "owner" };
    expect((await MPOST(membersReq("POST", { userId: "m-from-owner", role: "member" }), ctx(teamId))).status).toBe(201);
    H.user = { id: "admin" };
    expect((await MPOST(membersReq("POST", { userId: "m-from-admin", role: "member" }), ctx(teamId))).status).toBe(201);
    H.user = { id: "member" };
    const denied = await jsonOf(await MPOST(membersReq("POST", { userId: "m-from-member", role: "member" }), ctx(teamId)));
    expect(denied.status).toBe(403);
    expectCode(denied.body, "not_admin_add");
  });

  it("T1: only the owner adds an administrator; an administrator gets 403 owner_only_admin", async () => {
    const teamId = await seedRoster();
    H.user = { id: "owner" };
    expect((await MPOST(membersReq("POST", { userId: "new-admin", role: "admin" }), ctx(teamId))).status).toBe(201);
    H.user = { id: "admin" };
    const denied = await jsonOf(await MPOST(membersReq("POST", { userId: "peer-admin", role: "admin" }), ctx(teamId)));
    expect(denied.status).toBe(403);
    expectCode(denied.body, "owner_only_admin");
    H.user = { id: "member" };
    expect((await MPOST(membersReq("POST", { userId: "nope", role: "admin" }), ctx(teamId))).status).toBe(403);
  });

  it("T1: createInvite role admin from an administrator is 403 owner_only_admin", async () => {
    const teamId = await seedRoster();
    H.user = { id: "admin" };
    const denied = await jsonOf(
      await IPOST(
        new Request("http://x", {
          method: "POST",
          body: JSON.stringify({ action: "create", teamId, email: "adminish@example.com", role: "admin" }),
        }),
      ),
    );
    expect(denied.status).toBe(403);
    expectCode(denied.body, "owner_only_admin");
    H.user = { id: "owner" };
    expect(
      (
        await IPOST(
          new Request("http://x", {
            method: "POST",
            body: JSON.stringify({ action: "create", teamId, email: "ok-admin@example.com", role: "admin" }),
          }),
        )
      ).status,
    ).toBe(201);
  });

  it("make a member an administrator: owner 200, administrator 403, member 403", async () => {
    const teamId = await seedRoster();
    H.user = { id: "admin" };
    const asAdmin = await jsonOf(await MPATCH(membersReq("PATCH", { userId: "member", role: "admin" }), ctx(teamId)));
    expect(asAdmin.status).toBe(403);
    expectCode(asAdmin.body, "owner_only_admin");
    H.user = { id: "member" };
    const asMember = await jsonOf(await MPATCH(membersReq("PATCH", { userId: "peer", role: "admin" }), ctx(teamId)));
    expect(asMember.status).toBe(403);
    expectCode(asMember.body, "owner_only");
    H.user = { id: "owner" };
    const asOwner = await jsonOf(await MPATCH(membersReq("PATCH", { userId: "member", role: "admin" }), ctx(teamId)));
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.member.role).toBe("admin");
  });

  it("make an administrator a member: owner 200, administrator 403, member 403", async () => {
    const teamId = await seedRoster();
    H.user = { id: "owner" };
    await MPOST(membersReq("POST", { userId: "admin2", role: "admin" }), ctx(teamId));
    H.user = { id: "admin" };
    const asAdmin = await jsonOf(await MPATCH(membersReq("PATCH", { userId: "admin2", role: "member" }), ctx(teamId)));
    expect(asAdmin.status).toBe(403);
    expectCode(asAdmin.body, "owner_only_change_admin");
    H.user = { id: "member" };
    expect((await MPATCH(membersReq("PATCH", { userId: "admin2", role: "member" }), ctx(teamId))).status).toBe(403);
    H.user = { id: "owner" };
    const asOwner = await jsonOf(await MPATCH(membersReq("PATCH", { userId: "admin2", role: "member" }), ctx(teamId)));
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.member.role).toBe("member");
  });

  it("remove a member: owner and administrator 200, member 403 unless leaving", async () => {
    const teamId = await seedRoster();
    H.user = { id: "member" };
    const asMember = await jsonOf(await MDELETE(membersReq("DELETE", undefined, "?userId=peer"), ctx(teamId)));
    expect(asMember.status).toBe(403);
    expectCode(asMember.body, "remove_not_allowed");
    H.user = { id: "admin" };
    expect((await MDELETE(membersReq("DELETE", undefined, "?userId=peer"), ctx(teamId))).status).toBe(200);
    H.user = { id: "owner" };
    expect((await MDELETE(membersReq("DELETE", undefined, "?userId=member"), ctx(teamId))).status).toBe(200);
  });

  it("remove an administrator: owner 200, administrator 403 owner_only_remove_admin, member 403", async () => {
    const teamId = await seedRoster();
    H.user = { id: "owner" };
    await MPOST(membersReq("POST", { userId: "admin2", role: "admin" }), ctx(teamId));
    H.user = { id: "admin" };
    const asAdmin = await jsonOf(await MDELETE(membersReq("DELETE", undefined, "?userId=admin2"), ctx(teamId)));
    expect(asAdmin.status).toBe(403);
    expectCode(asAdmin.body, "owner_only_remove_admin");
    H.user = { id: "member" };
    expect((await MDELETE(membersReq("DELETE", undefined, "?userId=admin2"), ctx(teamId))).status).toBe(403);
    H.user = { id: "owner" };
    expect((await MDELETE(membersReq("DELETE", undefined, "?userId=admin2"), ctx(teamId))).status).toBe(200);
  });

  it("T2: nobody changes their own role", async () => {
    const teamId = await seedRoster();
    H.user = { id: "owner" };
    const ownerSelf = await jsonOf(await MPATCH(membersReq("PATCH", { userId: "owner", role: "member" }), ctx(teamId)));
    expect(ownerSelf.status).toBe(403);
    expectCode(ownerSelf.body, "owner_locked");
    H.user = { id: "admin" };
    const adminSelf = await jsonOf(await MPATCH(membersReq("PATCH", { userId: "admin", role: "member" }), ctx(teamId)));
    expect(adminSelf.status).toBe(403);
    expectCode(adminSelf.body, "no_self_role");
    H.user = { id: "member" };
    const memberSelf = await jsonOf(await MPATCH(membersReq("PATCH", { userId: "member", role: "admin" }), ctx(teamId)));
    expect(memberSelf.status).toBe(403);
    expectCode(memberSelf.body, "owner_only");
  });

  it("last-owner: PATCH targeting the owner is 403 owner_locked", async () => {
    const teamId = await seedRoster();
    H.user = { id: "owner" };
    const denied = await jsonOf(await MPATCH(membersReq("PATCH", { userId: "owner", role: "member" }), ctx(teamId)));
    expect(denied.status).toBe(403);
    expectCode(denied.body, "owner_locked");
    H.user = { id: "admin" };
    const asAdmin = await jsonOf(await MPATCH(membersReq("PATCH", { userId: "owner", role: "member" }), ctx(teamId)));
    expect(asAdmin.status).toBe(403);
    expectCode(asAdmin.body, "owner_locked");
  });

  it("last-owner: DELETE targeting the owner is 403 owner_locked; owner leaving is 403 owner_cannot_leave", async () => {
    const teamId = await seedRoster();
    H.user = { id: "admin" };
    const asAdmin = await jsonOf(await MDELETE(membersReq("DELETE", undefined, "?userId=owner"), ctx(teamId)));
    expect(asAdmin.status).toBe(403);
    expectCode(asAdmin.body, "owner_locked");
    H.user = { id: "owner" };
    const leaving = await jsonOf(await MDELETE(membersReq("DELETE", undefined, "?userId=owner"), ctx(teamId)));
    expect(leaving.status).toBe(403);
    expectCode(leaving.body, "owner_cannot_leave");
  });

  it("T3: a member may leave; an administrator may leave", async () => {
    const teamId = await seedRoster();
    H.user = { id: "member" };
    const left = await jsonOf(await MDELETE(membersReq("DELETE", undefined, "?userId=member"), ctx(teamId)));
    expect(left.status).toBe(200);
    H.user = { id: "admin" };
    const adminLeft = await jsonOf(await MDELETE(membersReq("DELETE", undefined, "?userId=admin"), ctx(teamId)));
    expect(adminLeft.status).toBe(200);
  });

  it("RLS refusal is never a success: empty update/delete answers 403, not 200", async () => {
    const teamId = await seedRoster();
    transport.state.rlsEmptyWrite = true;
    H.user = { id: "owner" };
    const patched = await jsonOf(await MPATCH(membersReq("PATCH", { userId: "member", role: "admin" }), ctx(teamId)));
    expect(patched.status).toBe(403);
    expectCode(patched.body, "role_change_failed");
    const removed = await jsonOf(await MDELETE(membersReq("DELETE", undefined, "?userId=member"), ctx(teamId)));
    expect(removed.status).toBe(403);
    expectCode(removed.body, "remove_failed");
  });

  it("unsigned PATCH and DELETE are 401", async () => {
    H.user = null;
    expect((await MPATCH(membersReq("PATCH", { userId: "x", role: "member" }), ctx("t1"))).status).toBe(401);
    expect((await MDELETE(membersReq("DELETE", undefined, "?userId=x"), ctx("t1"))).status).toBe(401);
  });

  it("a caller with no row gets 404 on PATCH and DELETE", async () => {
    const teamId = await seedRoster();
    H.user = { id: "stranger" };
    const patched = await jsonOf(await MPATCH(membersReq("PATCH", { userId: "member", role: "admin" }), ctx(teamId)));
    expect(patched.status).toBe(404);
    expectCode(patched.body, "team_not_found");
    const removed = await jsonOf(await MDELETE(membersReq("DELETE", undefined, "?userId=member"), ctx(teamId)));
    expect(removed.status).toBe(404);
    expectCode(removed.body, "team_not_found");
  });

  it("PATCH nextRole omitted, empty, or owner is 400 invalid_role, not a silent demotion", async () => {
    const teamId = await seedRoster();
    H.user = { id: "owner" };
    const omitted = await jsonOf(await MPATCH(membersReq("PATCH", { userId: "admin" }), ctx(teamId)));
    expect(omitted.status).toBe(400);
    expectCode(omitted.body, "invalid_role");
    const empty = await jsonOf(await MPATCH(membersReq("PATCH", { userId: "admin", role: "" }), ctx(teamId)));
    expect(empty.status).toBe(400);
    expectCode(empty.body, "invalid_role");
    const asOwner = await jsonOf(await MPATCH(membersReq("PATCH", { userId: "admin", role: "owner" }), ctx(teamId)));
    expect(asOwner.status).toBe(400);
    expectCode(asOwner.body, "invalid_role");
    H.user = { id: "admin" };
    const stillAdmin = await jsonOf(await MGET(membersReq("GET"), ctx(teamId)));
    expect(stillAdmin.body.members.find((m: { userId: string }) => m.userId === "admin").role).toBe("admin");
  });

  it("R2: a caller who IS on the team is never told they are not a member", async () => {
    // The plain-language law is about the sentence the reader receives, and "You are not a member
    // of this team." is false for a member. Every gate a member can reach is checked here, in both
    // languages, against the exact catalogued strings.
    const teamId = await seedRoster();
    const [notMemberEn, notMemberZh] = TEAM_ROUTE_MESSAGES.not_member;
    H.user = { id: "member" };
    const reached = [
      await jsonOf(await MPATCH(membersReq("PATCH", { userId: "peer", role: "admin" }), ctx(teamId))),
      await jsonOf(await MPATCH(membersReq("PATCH", { userId: "member", role: "admin" }), ctx(teamId))),
      await jsonOf(await MDELETE(membersReq("DELETE", undefined, "?userId=peer"), ctx(teamId))),
      await jsonOf(await MDELETE(membersReq("DELETE", undefined, "?userId=admin"), ctx(teamId))),
    ];
    for (const answer of reached) {
      expect(answer.status).toBe(403);
      expect(answer.body.message).not.toBe(notMemberEn);
      expect(answer.body.messageZh).not.toBe(notMemberZh);
    }
    expectCode(reached[0].body, "owner_only");
    expectCode(reached[1].body, "owner_only");
    expectCode(reached[2].body, "remove_not_allowed");
    expectCode(reached[3].body, "remove_not_allowed");
  });

  it("R2: not_member is still the answer to a caller who is truly not on the team", async () => {
    const teamId = await seedRoster();
    H.user = { id: "stranger" };
    const { status, body } = await jsonOf(await MGET(membersReq("GET"), ctx(teamId)));
    expect(status).toBe(403);
    expectCode(body, "not_member");
  });

  it("R4(i): a database permission denial is 403 with this gate's sentence, never a 500", async () => {
    // 0019's tm_delete_admin raises 42501 through team_members_rls_deny() instead of filtering to
    // zero rows, and tm_update_admin's WITH CHECK raises it too. Both mean the same thing as the
    // zero-row refusal the route already answers with a 403.
    const teamId = await seedRoster();
    transport.state.writeFault = { code: "42501" };
    H.user = { id: "owner" };
    const patched = await jsonOf(await MPATCH(membersReq("PATCH", { userId: "member", role: "admin" }), ctx(teamId)));
    expect(patched.status).toBe(403);
    expectCode(patched.body, "role_change_failed");
    const removed = await jsonOf(await MDELETE(membersReq("DELETE", undefined, "?userId=member"), ctx(teamId)));
    expect(removed.status).toBe(403);
    expectCode(removed.body, "remove_failed");
  });

  it("a write error that is not a permission denial is still a 500", async () => {
    const teamId = await seedRoster();
    transport.state.writeFault = { code: "08006" };
    H.user = { id: "owner" };
    const patched = await jsonOf(await MPATCH(membersReq("PATCH", { userId: "member", role: "admin" }), ctx(teamId)));
    expect(patched.status).toBe(500);
    expectCode(patched.body, "write_failed");
  });
});

describe("B-F12-8 §2.1 matrix (caller × action)", () => {
  let POST: any, MGET: any, MPOST: any, MPATCH: any, MDELETE: any, IGET: any, IPOST: any, teamsMod: any;
  let transport: ReturnType<typeof makeFakeTransport>;

  beforeEach(async () => {
    vi.resetModules();
    H.user = null;
    transport = makeFakeTransport();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user: H.user } }) }, ...transport.db }),
    }));
    ({ POST } = await import("@/app/api/teams/route"));
    teamsMod = await import("@/app/api/teams/route");
    ({ GET: MGET, POST: MPOST, PATCH: MPATCH, DELETE: MDELETE } = await import("@/app/api/teams/[id]/members/route"));
    ({ GET: IGET, POST: IPOST } = await import("@/app/api/teams/invitations/route"));
  });

  function req(body: unknown) {
    return new Request("http://localhost/api/teams", { method: "POST", body: JSON.stringify(body) });
  }
  function ctx(id: string) {
    return { params: Promise.resolve({ id }) };
  }
  function membersReq(method: string, body?: unknown, query = "") {
    return new Request(`http://localhost/api/teams/t/members${query}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function seedRoster() {
    H.user = { id: "owner" };
    const created = await (await POST(req({ name: "Desk" }))).json();
    const teamId = created.team.id as string;
    await MPOST(membersReq("POST", { userId: "admin", role: "admin" }), ctx(teamId));
    await MPOST(membersReq("POST", { userId: "member", role: "member" }), ctx(teamId));
    await MPOST(membersReq("POST", { userId: "peer", role: "member" }), ctx(teamId));
    return teamId;
  }

  const callers = ["owner", "admin", "member"] as const;

  it.each(callers)("see the team and the list of people on it: %s → 200", async (caller) => {
    const teamId = await seedRoster();
    H.user = { id: caller };
    expect((await MGET(membersReq("GET"), ctx(teamId))).status).toBe(200);
  });

  it.each([
    ["owner", 201],
    ["admin", 201],
    ["member", 403],
  ] as const)("invite someone by email link: %s → %s", async (caller, status) => {
    const teamId = await seedRoster();
    H.user = { id: caller };
    const res = await IPOST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ action: "create", teamId, email: `${caller}@example.com`, role: "member" }),
      }),
    );
    expect(res.status).toBe(status);
  });

  it.each([
    ["owner", 200],
    ["admin", 200],
    ["member", 403],
  ] as const)("see pending invitations: %s → %s", async (caller, status) => {
    const teamId = await seedRoster();
    H.user = { id: caller };
    expect((await IGET(new Request(`http://x/api/teams/invitations?teamId=${teamId}`))).status).toBe(status);
  });

  it.each([
    ["owner", 201],
    ["admin", 201],
    ["member", 403],
  ] as const)("add an existing account as a member: %s → %s", async (caller, status) => {
    const teamId = await seedRoster();
    H.user = { id: caller };
    expect((await MPOST(membersReq("POST", { userId: `added-by-${caller}`, role: "member" }), ctx(teamId))).status).toBe(status);
  });

  it.each([
    ["owner", 201],
    ["admin", 403],
    ["member", 403],
  ] as const)("add an existing account as an administrator: %s → %s", async (caller, status) => {
    const teamId = await seedRoster();
    H.user = { id: caller };
    expect((await MPOST(membersReq("POST", { userId: `admin-by-${caller}`, role: "admin" }), ctx(teamId))).status).toBe(status);
  });

  it.each([
    ["owner", 200],
    ["admin", 403],
    ["member", 403],
  ] as const)("make a member an administrator: %s → %s", async (caller, status) => {
    const teamId = await seedRoster();
    H.user = { id: caller };
    expect((await MPATCH(membersReq("PATCH", { userId: "peer", role: "admin" }), ctx(teamId))).status).toBe(status);
  });

  it.each([
    ["owner", 200],
    ["admin", 403],
    ["member", 403],
  ] as const)("make an administrator a member: %s → %s", async (caller, status) => {
    const teamId = await seedRoster();
    H.user = { id: caller };
    expect((await MPATCH(membersReq("PATCH", { userId: "admin", role: "member" }), ctx(teamId))).status).toBe(status);
  });

  it.each([
    ["owner", 200],
    ["admin", 200],
    ["member", 403],
  ] as const)("remove a member from the team: %s → %s", async (caller, status) => {
    const teamId = await seedRoster();
    H.user = { id: caller };
    expect((await MDELETE(membersReq("DELETE", undefined, "?userId=peer"), ctx(teamId))).status).toBe(status);
  });

  it.each([
    ["owner", 200],
    ["admin", 403],
    ["member", 403],
  ] as const)("remove an administrator from the team: %s → %s", async (caller, status) => {
    const teamId = await seedRoster();
    H.user = { id: "owner" };
    await MPOST(membersReq("POST", { userId: "admin2", role: "admin" }), ctx(teamId));
    H.user = { id: caller };
    expect((await MDELETE(membersReq("DELETE", undefined, "?userId=admin2"), ctx(teamId))).status).toBe(status);
  });

  it.each([
    ["owner", 403],
    ["admin", 403],
    ["member", 403],
  ] as const)("change their own role: %s → %s", async (caller, status) => {
    const teamId = await seedRoster();
    H.user = { id: caller };
    const next = caller === "member" ? "admin" : "member";
    expect((await MPATCH(membersReq("PATCH", { userId: caller, role: next }), ctx(teamId))).status).toBe(status);
  });

  it.each([
    ["owner", 403],
    ["admin", 200],
    ["member", 200],
  ] as const)("leave the team themselves: %s → %s", async (caller, status) => {
    const teamId = await seedRoster();
    H.user = { id: caller };
    expect((await MDELETE(membersReq("DELETE", undefined, `?userId=${caller}`), ctx(teamId))).status).toBe(status);
  });

  it.each([
    ["owner", true],
    ["admin", true],
    ["member", false],
  ] as const)("write a team-scoped setting: %s allowed=%s", async (caller, allowed) => {
    const teamId = await seedRoster();
    const result = await writeSetting(transport.db as any, caller, {
      scope: "workspace",
      teamId,
      key: "chart.density",
      value: "compact",
    });
    if (allowed) {
      expect(result.ok).toBe(true);
    } else {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("forbidden");
        expect(result.status).toBe(403);
      }
    }
  });

  it.each(callers)("change who the owner is / delete the team: %s cannot", async (caller) => {
    const teamId = await seedRoster();
    H.user = { id: caller };
    expect((await MPATCH(membersReq("PATCH", { userId: "owner", role: "member" }), ctx(teamId))).status).toBe(403);
    expect((await MDELETE(membersReq("DELETE", undefined, "?userId=owner"), ctx(teamId))).status).toBe(403);
    expect(teamsMod.DELETE).toBeUndefined();
    expect(teamsMod.PATCH).toBeUndefined();
  });
});
