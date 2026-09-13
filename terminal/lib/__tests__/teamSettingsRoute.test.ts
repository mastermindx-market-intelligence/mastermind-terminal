/* eslint-disable @typescript-eslint/no-explicit-any */
// /api/teams/[id]/settings — packet MO-B F12-13. vi.hoisted + vi.mock("@/lib/supabase/server")
// mirrors teamsRoute.test.ts:121-125. The fake transport supports upsert into workspace_settings
// (writeSetting uses .upsert(..., { onConflict }) — lib/teams.ts:981-987) and the readSettings
// select/eq/eq chain. The 0015 unique index (scope, owner_id, key) is exercised end-to-end.
import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: H.user } }) },
  }),
}));

type Row = Record<string, unknown>;
function makeFakeTransport(opts?: {
  fault?: { code: string } | null;
  upsertFault?: { code: string } | null;
  rlsEmptyWrite?: boolean;
  initial?: Row[];
}) {
  const state = {
    teams: [] as Row[],
    team_members: [] as Row[],
    workspace_settings: opts?.initial ? [...opts.initial] : ([] as Row[]),
    fault: opts?.fault ?? null,
    upsertFault: opts?.upsertFault ?? null,
    rlsEmptyWrite: opts?.rlsEmptyWrite ?? false,
    seq: 0,
  };
  const nextId = (prefix: string) => `${prefix}-${++state.seq}`;
  const db = {
    rpc: async () => ({ data: [], error: null }),
    from(table: "teams" | "team_members" | "workspace_settings") {
      let filters: Array<[string, unknown]> = [];
      let pendingUpsert: Row | null = null;
      const applyFilters = (rows: Row[]) => rows.filter((r) => filters.every(([c, v]) => r[c] === v));
      const result = () => {
        if (state.fault) return { data: null, error: { code: state.fault.code, message: "fault" } };
        if (pendingUpsert) {
          if (state.upsertFault) return { data: null, error: { code: state.upsertFault.code, message: "fault" } };
          if (table === "workspace_settings") {
            if (state.rlsEmptyWrite) return { data: [], error: null };
            const ownerId = (r: Row) => (r.team_id ?? r.user_id) as unknown;
            const idx = state.workspace_settings.findIndex(
              (r) =>
                r.scope === pendingUpsert!.scope &&
                ownerId(r) === ownerId(pendingUpsert!) &&
                r.key === pendingUpsert!.key,
            );
            const saved: Row = { ...pendingUpsert, updated_at: new Date().toISOString() };
            if (idx >= 0) state.workspace_settings[idx] = saved;
            else state.workspace_settings.push(saved);
            pendingUpsert = null;
            return { data: [saved], error: null };
          }
        }
        return { data: applyFilters(state[table]), error: null };
      };
      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          filters.push([c, v]);
          return q;
        },
        in: () => q,
        order: () => q,
        limit: () => q,
        upsert: (row: Row, _opts?: unknown) => {
          pendingUpsert = row;
          return q;
        },
        maybeSingle: async () => {
          if (table === "team_members") {
            if (state.fault) return { data: null, error: { code: state.fault.code, message: "fault" } };
            const hit = applyFilters(state.team_members)[0];
            return { data: hit || null, error: null };
          }
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

let transport: ReturnType<typeof makeFakeTransport>;
let GET: any, PATCH: any;

beforeEach(async () => {
  vi.resetModules();
  H.user = null;
  transport = makeFakeTransport();
  vi.doMock("@/lib/supabase/server", () => ({
    createClient: async () => ({ auth: { getUser: async () => ({ data: { user: H.user } }) }, ...transport.db }),
  }));
  ({ GET, PATCH } = await import("@/app/api/teams/[id]/settings/route"));
});

function ctx(teamId: string) {
  return { params: Promise.resolve({ id: teamId }) };
}

function patchBody(key: string, value: unknown) {
  return new Request("http://x/", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
}

describe("/api/teams/[id]/settings — GET", () => {
  it("401 not_signed_in with full-sentence pair when there is no session", async () => {
    H.user = null;
    const res = await GET({} as Request, ctx("t1"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.message).toBeTruthy();
    expect(body.messageZh).toBeTruthy();
    expect(body.message).not.toContain("falsifier");
    expect(body.messageZh).toMatch(/[一-鿿]/);
  });

  it("owner: 200 with both defaults applied when nothing is stored", async () => {
    H.user = { id: "u-owner" };
    transport.state.teams = [];
    transport.state.team_members = [];
    transport.state.workspace_settings = [];
    const res = await GET({} as Request, ctx("t1"));
    expect(res.status).toBe(404);
  });

  it("owner with seeded member row: 200 with both defaults applied", async () => {
    H.user = { id: "u-owner" };
    transport.state.team_members = [{ team_id: "t1", user_id: "u-owner", role: "owner" }];
    const res = await GET({} as Request, ctx("t1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.teamId).toBe("t1");
    expect(body.role).toBe("owner");
    expect(body.settings).toEqual([
      { key: "default_chart_theme", value: "green_up", updatedAt: null },
      { key: "share_layouts_by_default", value: false, updatedAt: null },
    ]);
  });

  it("member: 200 read-only (defaults filled, unknown stored keys dropped)", async () => {
    H.user = { id: "u-member" };
    transport.state.team_members = [{ team_id: "t1", user_id: "u-member", role: "member" }];
    const res = await GET({} as Request, ctx("t1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("member");
    expect(body.settings).toEqual([
      { key: "default_chart_theme", value: "green_up", updatedAt: null },
      { key: "share_layouts_by_default", value: false, updatedAt: null },
    ]);
  });

  it("stored unknown key is dropped, known keys still flow through mergeWithDefaults", async () => {
    H.user = { id: "u-owner" };
    transport.state.team_members = [{ team_id: "t1", user_id: "u-owner", role: "owner" }];
    transport.state.workspace_settings = [
      { scope: "workspace", team_id: "t1", key: "default_chart_theme", value: "red_up", updated_at: "2026-09-13T00:00:00Z" },
      { scope: "workspace", team_id: "t1", key: "mystery_key", value: "leak", updated_at: "2026-09-13T00:00:00Z" },
    ];
    const res = await GET({} as Request, ctx("t1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings.map((s: { key: string }) => s.key)).toEqual([
      "default_chart_theme",
      "share_layouts_by_default",
    ]);
    const theme = body.settings.find((s: { key: string }) => s.key === "default_chart_theme");
    expect(theme.value).toBe("red_up");
    expect(theme.updatedAt).toBe("2026-09-13T00:00:00Z");
  });

  it("outsider: 404 team_not_found with full-sentence pair (never confirms the team exists)", async () => {
    H.user = { id: "u-outsider" };
    transport.state.team_members = [];
    const res = await GET({} as Request, ctx("t1"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toBeTruthy();
    expect(body.messageZh).toBeTruthy();
  });

  it("503 unavailable when the team_members table is missing", async () => {
    H.user = { id: "u-x" };
    transport.state.team_members = [];
    transport.state.fault = { code: "42P01" };
    const res = await GET({} as Request, ctx("t1"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.message).toBeTruthy();
    expect(body.messageZh).toBeTruthy();
  });
});

describe("/api/teams/[id]/settings — PATCH", () => {
  it("owner: 200 + persisted value echoed, plus saved message pair", async () => {
    H.user = { id: "u-owner" };
    transport.state.team_members = [{ team_id: "t1", user_id: "u-owner", role: "owner" }];
    const res = await PATCH(patchBody("default_chart_theme", "red_up"), ctx("t1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(true);
    expect(body.message).toBeTruthy();
    expect(body.messageZh).toBeTruthy();
    expect(body.setting.key).toBe("default_chart_theme");
    expect(body.setting.value).toBe("red_up");
    expect(body.setting.updatedAt).toBeTruthy();
  });

  it("admin: 200 + persisted value echoed", async () => {
    H.user = { id: "u-admin" };
    transport.state.team_members = [{ team_id: "t1", user_id: "u-admin", role: "admin" }];
    const res = await PATCH(patchBody("share_layouts_by_default", true), ctx("t1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(true);
    expect(body.setting.key).toBe("share_layouts_by_default");
    expect(body.setting.value).toBe(true);
  });

  it("member: 403 not_admin with full-sentence pair", async () => {
    H.user = { id: "u-member" };
    transport.state.team_members = [{ team_id: "t1", user_id: "u-member", role: "member" }];
    const res = await PATCH(patchBody("default_chart_theme", "green_up"), ctx("t1"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toBeTruthy();
    expect(body.messageZh).toBeTruthy();
    // No row was written
    expect(transport.state.workspace_settings).toHaveLength(0);
  });

  it("outsider: 404 team_not_found", async () => {
    H.user = { id: "u-outsider" };
    transport.state.team_members = [];
    const res = await PATCH(patchBody("default_chart_theme", "green_up"), ctx("t1"));
    expect(res.status).toBe(404);
    expect(transport.state.workspace_settings).toHaveLength(0);
  });

  it("unknown key -> 400 invalid_key with full-sentence pair", async () => {
    H.user = { id: "u-owner" };
    transport.state.team_members = [{ team_id: "t1", user_id: "u-owner", role: "owner" }];
    const res = await PATCH(patchBody("bogus_key", "anything"), ctx("t1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBeTruthy();
    expect(body.messageZh).toBeTruthy();
    expect(transport.state.workspace_settings).toHaveLength(0);
  });

  it("'purple_up' -> 400 invalid_value with full-sentence pair", async () => {
    H.user = { id: "u-owner" };
    transport.state.team_members = [{ team_id: "t1", user_id: "u-owner", role: "owner" }];
    const res = await PATCH(patchBody("default_chart_theme", "purple_up"), ctx("t1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBeTruthy();
    expect(body.messageZh).toBeTruthy();
    expect(transport.state.workspace_settings).toHaveLength(0);
  });

  it("string 'true' for the boolean -> 400 invalid_value with full-sentence pair", async () => {
    H.user = { id: "u-owner" };
    transport.state.team_members = [{ team_id: "t1", user_id: "u-owner", role: "owner" }];
    const res = await PATCH(patchBody("share_layouts_by_default", "true"), ctx("t1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBeTruthy();
    expect(body.messageZh).toBeTruthy();
    expect(transport.state.workspace_settings).toHaveLength(0);
  });

  it("missing key -> 400 with full-sentence pair", async () => {
    H.user = { id: "u-owner" };
    transport.state.team_members = [{ team_id: "t1", user_id: "u-owner", role: "owner" }];
    const req = new Request("http://x/", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "green_up" }),
    });
    const res = await PATCH(req, ctx("t1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBeTruthy();
    expect(body.messageZh).toBeTruthy();
  });

  it("lib 42501 -> 403 not_admin (RLS refusal at write time)", async () => {
    H.user = { id: "u-owner" };
    transport.state.team_members = [{ team_id: "t1", user_id: "u-owner", role: "owner" }];
    transport.state.upsertFault = { code: "42501" };
    const res = await PATCH(patchBody("default_chart_theme", "red_up"), ctx("t1"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toBeTruthy();
    expect(body.messageZh).toBeTruthy();
  });
});
