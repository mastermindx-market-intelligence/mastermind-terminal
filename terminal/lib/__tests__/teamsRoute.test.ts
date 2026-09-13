import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_ROUTE_MESSAGES } from "@/lib/teams";

// vi.hoisted + vi.mock("@/lib/supabase/server") mirrors PR #502's thesesRoute.test.ts idiom.
const H = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: H.user } }) },
  }),
}));

// Local in-test fake transport over three arrays, modeling 0014's DDL trigger (an insert into
// `teams` seeds an owner row — the real authority is 0014's `on_team_created` trigger; this fake
// only imitates its externally-observable effect for the unit tests).
type Row = Record<string, unknown>;
function makeFakeTransport() {
  const state = {
    teams: [] as Row[],
    team_members: [] as Row[],
    team_invites: [] as Row[],
    fault: null as { code: string } | null,
    // Scoped to the insert step only (unlike `fault`, which also breaks the caller-role read
    // every write does first) — lets a test simulate a write-time-only Postgres error (22P02
    // malformed uuid, 23503 FK violation) without also faulting the preceding role lookup.
    insertFault: null as { code: string } | null,
    seq: 0,
  };
  const nextId = (prefix: string) => `${prefix}-${++state.seq}`;

  function rowsFor(table: keyof typeof state) {
    return state[table] as Row[];
  }

  const db = {
    from(table: "teams" | "team_members" | "team_invites") {
      let filters: Array<[string, unknown]> = [];
      let inFilter: { col: string; values: unknown[] } | null = null;
      let orderCol: string | null = null;
      let pendingInsert: Row | Row[] | null = null;

      const applyFilters = (rows: Row[]) =>
        rows.filter((r) => filters.every(([c, v]) => r[c] === v) && (!inFilter || inFilter.values.includes(r[inFilter.col])));

      const result = () => {
        if (state.fault) return { data: null, error: { code: state.fault.code, message: "fault" } };
        if (pendingInsert) {
          if (state.insertFault) return { data: null, error: { code: state.insertFault.code, message: "fault" } };
          const values = Array.isArray(pendingInsert) ? pendingInsert : [pendingInsert];
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
              // trigger idiom: creator becomes owner
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

describe("/api/teams and /api/teams/[id]/members", () => {
  let GET: any, POST: any, MGET: any, MPOST: any, transport: ReturnType<typeof makeFakeTransport>;

  beforeEach(async () => {
    vi.resetModules();
    H.user = null;
    transport = makeFakeTransport();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user: H.user } }) }, ...transport.db }),
    }));
    ({ GET, POST } = await import("@/app/api/teams/route"));
    ({ GET: MGET, POST: MPOST } = await import("@/app/api/teams/[id]/members/route"));
  });

  function req(body: unknown) {
    return new Request("http://localhost/api/teams", { method: "POST", body: JSON.stringify(body) });
  }
  function ctx(id: string) {
    return { params: Promise.resolve({ id }) };
  }

  it("401 UNAUTHENTICATED when signed out", async () => {
    const r1 = await GET();
    expect(r1.status).toBe(401);
    const body1 = await r1.json();
    expect(body1.error).toBe("UNAUTHENTICATED");
    expect(body1.message).toBe(TEAM_ROUTE_MESSAGES.not_signed_in[0]);
    expect(body1.messageZh).toBe(TEAM_ROUTE_MESSAGES.not_signed_in[1]);
    const r2 = await MGET(new Request("http://x"), ctx("t1"));
    expect(r2.status).toBe(401);
    const body2 = await r2.json();
    expect(body2.message).toBe(TEAM_ROUTE_MESSAGES.not_signed_in[0]);
    expect(body2.messageZh).toBe(TEAM_ROUTE_MESSAGES.not_signed_in[1]);
  });

  it("signed in, no teams -> 200 {teams: []}", async () => {
    H.user = { id: "u1" };
    const r = await GET();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ teams: [], truncated: false });
  });

  it("create team -> 201, owner, exactly one team_members row", async () => {
    H.user = { id: "u1" };
    const r = await POST(req({ name: "Desk" }));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.team.role).toBe("owner");
    expect(transport.state.team_members.filter((m) => m.team_id === body.team.id)).toEqual([
      expect.objectContaining({ role: "owner", user_id: "u1" }),
    ]);
  });

  it("created_by is always the session id", async () => {
    H.user = { id: "u1" };
    const r = await POST(req({ name: "Desk", created_by: "someone-else" }));
    const body = await r.json();
    const row = transport.state.teams.find((t) => t.id === body.team.id)!;
    expect(row.created_by).toBe("u1");
  });

  it("blank name -> 400 INVALID", async () => {
    H.user = { id: "u1" };
    const r = await POST(req({ name: "  " }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("INVALID");
  });

  it("user A sees only A's team", async () => {
    H.user = { id: "a" };
    await POST(req({ name: "A-desk" }));
    H.user = { id: "b" };
    await POST(req({ name: "B-desk" }));
    H.user = { id: "a" };
    const r = await GET();
    const body = await r.json();
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].name).toBe("A-desk");
  });

  it("non-member -> 403 FORBIDDEN on members GET", async () => {
    H.user = { id: "a" };
    const created = await (await POST(req({ name: "A-desk" }))).json();
    H.user = { id: "b" };
    const r = await MGET(new Request("http://x"), ctx(created.team.id));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("FORBIDDEN");
  });

  it("member GET -> 200 with callerRole", async () => {
    H.user = { id: "a" };
    const created = await (await POST(req({ name: "A-desk" }))).json();
    const r = await MGET(new Request("http://x"), ctx(created.team.id));
    expect(r.status).toBe(200);
    expect((await r.json()).callerRole).toBe("owner");
  });

  it("add member: member->403, admin->201, unknown team->404, repeat->409", async () => {
    H.user = { id: "a" };
    const created = await (await POST(req({ name: "A-desk" }))).json();
    const teamId = created.team.id;
    await MPOST(new Request("http://x", { method: "POST", body: JSON.stringify({ userId: "b", role: "member" }) }), ctx(teamId));
    H.user = { id: "b" };
    const asMember = await MPOST(new Request("http://x", { method: "POST", body: JSON.stringify({ userId: "c" }) }), ctx(teamId));
    expect(asMember.status).toBe(403);

    H.user = { id: "a" };
    await MPOST(new Request("http://x", { method: "POST", body: JSON.stringify({ userId: "d", role: "admin" }) }), ctx(teamId));
    H.user = { id: "d" };
    const asAdmin = await MPOST(new Request("http://x", { method: "POST", body: JSON.stringify({ userId: "e" }) }), ctx(teamId));
    expect(asAdmin.status).toBe(201);

    const unknown = await MPOST(new Request("http://x", { method: "POST", body: JSON.stringify({ userId: "z" }) }), ctx("no-such-team"));
    expect(unknown.status).toBe(404);

    H.user = { id: "a" };
    const dup = await MPOST(new Request("http://x", { method: "POST", body: JSON.stringify({ userId: "b" }) }), ctx(teamId));
    expect(dup.status).toBe(409);
  });

  it("invite by email -> 422, plain sentence, writes NO invite row (MO-PAID-081 not absorbed)", async () => {
    H.user = { id: "a" };
    const created = await (await POST(req({ name: "A-desk" }))).json();
    const r = await MPOST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ email: "b@example.com" }) }),
      ctx(created.team.id),
    );
    expect(r.status).toBe(422);
    const body = await r.json();
    expect(body.error).toBe("INVALID");
    expect(body.message).toBe(TEAM_ROUTE_MESSAGES.email_not_supported[0]);
    expect(body.messageZh).toBe(TEAM_ROUTE_MESSAGES.email_not_supported[1]);
    expect(transport.state.team_invites).toHaveLength(0);
  });

  it("neither userId nor email -> 400 with a plain sentence, not the raw lib string", async () => {
    H.user = { id: "a" };
    const created = await (await POST(req({ name: "A-desk" }))).json();
    const r = await MPOST(new Request("http://x", { method: "POST", body: JSON.stringify({}) }), ctx(created.team.id));
    expect(r.status).toBe(400);
    const missing = await r.json();
    expect(missing.message).toBe(TEAM_ROUTE_MESSAGES.missing_target[0]);
    expect(missing.messageZh).toBe(TEAM_ROUTE_MESSAGES.missing_target[1]);
  });

  it("invalid role -> 400 with a plain sentence", async () => {
    H.user = { id: "a" };
    const created = await (await POST(req({ name: "A-desk" }))).json();
    const r = await MPOST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ userId: "z", role: "superuser" }) }),
      ctx(created.team.id),
    );
    expect(r.status).toBe(400);
    const invalidRole = await r.json();
    expect(invalidRole.message).toBe(TEAM_ROUTE_MESSAGES.invalid_role[0]);
    expect(invalidRole.messageZh).toBe(TEAM_ROUTE_MESSAGES.invalid_role[1]);
  });

  it("malformed uuid (22P02) -> 400 'That user id is not valid.'", async () => {
    H.user = { id: "a" };
    const created = await (await POST(req({ name: "A-desk" }))).json();
    transport.state.insertFault = { code: "22P02" };
    const r = await MPOST(new Request("http://x", { method: "POST", body: JSON.stringify({ userId: "not-a-uuid" }) }), ctx(created.team.id));
    expect(r.status).toBe(400);
    const malformed = await r.json();
    expect(malformed.message).toBe(TEAM_ROUTE_MESSAGES.invalid_user_id[0]);
    expect(malformed.messageZh).toBe(TEAM_ROUTE_MESSAGES.invalid_user_id[1]);
  });

  it("well-formed but nonexistent userId (23503 FK) -> 400 'We could not find that person...'", async () => {
    H.user = { id: "a" };
    const created = await (await POST(req({ name: "A-desk" }))).json();
    transport.state.insertFault = { code: "23503" };
    const r = await MPOST(new Request("http://x", { method: "POST", body: JSON.stringify({ userId: "ghost" }) }), ctx(created.team.id));
    expect(r.status).toBe(400);
    const missingUser = await r.json();
    expect(missingUser.message).toBe(TEAM_ROUTE_MESSAGES.user_not_found[0]);
    expect(missingUser.messageZh).toBe(TEAM_ROUTE_MESSAGES.user_not_found[1]);
  });

  it("fault: absent tables -> 503 READ_UNAVAILABLE everywhere, never 500, never empty 200", async () => {
    H.user = { id: "a" };
    transport.state.fault = { code: "42P01" };
    const g1 = await GET();
    expect(g1.status).toBe(503);
    expect((await g1.json()).error).toBe("READ_UNAVAILABLE");

    const p1 = await POST(req({ name: "Desk" }));
    expect(p1.status).toBe(503);
    expect((await p1.json()).error).toBe("READ_UNAVAILABLE");

    const g2 = await MGET(new Request("http://x"), ctx("t1"));
    expect(g2.status).toBe(503);
    expect((await g2.json()).error).toBe("READ_UNAVAILABLE");

    const p2 = await MPOST(new Request("http://x", { method: "POST", body: JSON.stringify({ userId: "b" }) }), ctx("t1"));
    expect(p2.status).toBe(503);
    expect((await p2.json()).error).toBe("READ_UNAVAILABLE");
  });

  it("fault: non-absence error -> 503 READ_FAILED, distinct from READ_UNAVAILABLE", async () => {
    H.user = { id: "a" };
    transport.state.fault = { code: "08006" };
    const r = await GET();
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("READ_FAILED");
  });
});
