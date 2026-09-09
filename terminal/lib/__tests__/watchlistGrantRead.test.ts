import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "11111111-1111-4111-8111-111111111111";
const GRANTEE = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const LIST_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LIST_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEAM_X = "99999999-9999-4999-8999-999999999999";

const H = vi.hoisted(() => ({ user: null as { id: string } | null }));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: H.user } }) },
  }),
}));

type Row = Record<string, unknown>;

function makeFakeTransport() {
  const state = {
    watchlists: [] as Row[],
    watchlist_symbols: [] as Row[],
    resource_grants: [] as Row[],
    team_members: [] as Row[],
    watchlistsFault: null as { code: string } | null,
    symbolsFault: null as { code: string } | null,
    grantsMissing: false,
    seq: 0,
  };
  const nextId = (prefix: string) => {
    const n = ++state.seq;
    return `${prefix.replace(/_/g, "").slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
  const rowsFor = (table: string): Row[] => {
    if (table === "watchlists") return state.watchlists;
    if (table === "watchlist_symbols") return state.watchlist_symbols;
    if (table === "team_members") return state.team_members;
    return state.resource_grants;
  };

  const db = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let pendingInsert: Row | Row[] | null = null;
      let pendingUpdate: Row | null = null;
      let pendingDelete = false;
      let wantSingle = false;

      const applyFilters = (rows: Row[]) => rows.filter((r) => filters.every((f) => f(r)));
      const actor = () => H.user?.id ?? null;

      const visibleWatchlists = (rows: Row[]) => {
        const uid = actor();
        return rows.filter((r) => {
          if (r.user_id === uid) return true;
          return state.resource_grants.some(
            (g) =>
              g.resource_kind === "watchlist" &&
              g.resource_id === r.id &&
              g.grantee_user_id === uid &&
              g.revoked_at == null,
          );
        });
      };

      const result = () => {
        if (table === "resource_grants" && state.grantsMissing) {
          return { data: null, error: { code: "42P01", message: "relation does not exist" } };
        }
        if (table === "watchlists" && state.watchlistsFault) {
          return { data: null, error: { code: state.watchlistsFault.code, message: "watchlists fault" } };
        }
        if (table === "watchlist_symbols" && state.symbolsFault) {
          return { data: null, error: { code: state.symbolsFault.code, message: "symbols fault" } };
        }
        if (pendingInsert) {
          const values = Array.isArray(pendingInsert) ? pendingInsert : [pendingInsert];
          if (table === "watchlist_symbols" || table === "watchlists") {
            for (const v of values) {
              const listId = table === "watchlists" ? v.id : v.watchlist_id;
              const owned = state.watchlists.some((w) => w.id === listId && w.user_id === actor());
              if (!owned) return { data: null, error: { code: "42501", message: "permission denied" } };
            }
          }
          const inserted: Row[] = [];
          for (const v of values) {
            const row: Row = { id: v.id ?? nextId(table), created_at: new Date().toISOString(), ...v };
            rowsFor(table).push(row);
            inserted.push(row);
          }
          return { data: wantSingle ? inserted[0] ?? null : inserted, error: null };
        }
        if (pendingUpdate) {
          const matched = applyFilters(table === "watchlists" ? visibleWatchlists(state.watchlists) : applyFilters(rowsFor(table)));
          const writable = matched.filter((r) => {
            if (table === "watchlists") return r.user_id === actor();
            if (table === "watchlist_symbols") {
              return state.watchlists.some((w) => w.id === r.watchlist_id && w.user_id === actor());
            }
            return true;
          });
          if ((table === "watchlists" || table === "watchlist_symbols") && writable.length === 0) {
            return { data: [], error: null };
          }
          for (const old of writable) Object.assign(old, pendingUpdate);
          return { data: writable, error: null };
        }
        if (pendingDelete) {
          const src = rowsFor(table);
          const matched = applyFilters(src);
          const writable = matched.filter((r) => {
            if (table === "watchlists") return r.user_id === actor();
            if (table === "watchlist_symbols") {
              return state.watchlists.some((w) => w.id === r.watchlist_id && w.user_id === actor());
            }
            return false;
          });
          if (writable.length === 0) return { data: [], error: null };
          for (const row of writable) {
            const idx = src.indexOf(row);
            if (idx >= 0) src.splice(idx, 1);
          }
          return { data: writable, error: null };
        }
        let rows = rowsFor(table);
        if (table === "watchlists") rows = visibleWatchlists(rows);
        if (table === "watchlist_symbols") {
          const uid = actor();
          rows = rows.filter((r) => {
            const parent = state.watchlists.find((w) => w.id === r.watchlist_id);
            if (parent?.user_id === uid) return true;
            return state.resource_grants.some(
              (g) =>
                g.resource_kind === "watchlist" &&
                g.resource_id === r.watchlist_id &&
                g.grantee_user_id === uid &&
                g.revoked_at == null,
            );
          });
        }
        rows = applyFilters(rows);
        return { data: wantSingle ? rows[0] ?? null : rows, error: null };
      };

      const q: any = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          filters.push((r) => r[c] === v);
          return q;
        },
        in: (c: string, v: unknown[]) => {
          filters.push((r) => v.includes(r[c]));
          return q;
        },
        is: (c: string, v: null) => {
          filters.push((r) => r[c] == null);
          return q;
        },
        order: () => q,
        limit: () => q,
        insert: (values: Row | Row[]) => {
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
          wantSingle = true;
          return result();
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return q;
    },
  };
  return { db, state };
}

describe("GET /api/watchlist — grant-fed sharedWithMe", () => {
  let GET: any, POST: any, transport: ReturnType<typeof makeFakeTransport>;
  let decideSpy: { mock: { calls: unknown[][] } };
  let tenantScope: typeof import("@/lib/tenantScope");

  beforeEach(async () => {
    vi.resetModules();
    H.user = null;
    transport = makeFakeTransport();
    transport.state.watchlists.push(
      { id: LIST_A, user_id: OWNER, name: "Gold Miners", position: 0 },
      { id: LIST_B, user_id: OWNER, name: "Keep Private", position: 1 },
    );
    transport.state.watchlist_symbols.push(
      { id: "sym-1", watchlist_id: LIST_A, symbol: "NEM", section: "Miners", position: 0 },
      { id: "sym-2", watchlist_id: LIST_A, symbol: "AEM", section: "Miners", position: 1 },
      { id: "sym-3", watchlist_id: LIST_B, symbol: "MSFT", section: "Equities", position: 0 },
    );
    transport.state.resource_grants.push({
      id: "grant-live-0000-4000-8000-000000000001",
      resource_kind: "watchlist",
      resource_id: LIST_A,
      grantee_user_id: GRANTEE,
      granted_by: OWNER,
      created_at: "2026-09-09T00:00:00.000Z",
      revoked_at: null,
    });
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user: H.user } }) }, ...transport.db }),
    }));
    tenantScope = await import("@/lib/tenantScope");
    decideSpy = vi.spyOn(tenantScope, "decideTenantScope");
    ({ GET, POST } = await import("@/app/api/watchlist/route"));
  });

  function post(body: Record<string, unknown>) {
    return POST(new Request("https://x.test/api/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  it("a second signed-in user reads a shared watchlist through the watchlist route", async () => {
    // Ledger acceptance: a second authenticated user reads a shared watchlist via explicit grant.
    H.user = { id: GRANTEE };
    const r = await GET();
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.sharedWithMe).toHaveLength(1);
    expect(body.sharedWithMe[0].id).toBe(LIST_A);
    expect(body.sharedWithMe[0].name).toBe("Gold Miners");
    expect(body.sharedWithMe[0].symbols.map((s: { symbol: string }) => s.symbol)).toEqual(["NEM", "AEM"]);
  });

  it("the shared list arrives beside the caller's own lists, never inside them", async () => {
    H.user = { id: GRANTEE };
    const body = await (await GET()).json();
    expect(body.lists.every((list: { id: string }) => list.id !== LIST_A)).toBe(true);
    expect(body.sharedWithMe.some((list: { id: string }) => list.id === LIST_A)).toBe(true);
  });

  it("a signed-in stranger with no share sees nothing shared", async () => {
    H.user = { id: STRANGER };
    const body = await (await GET()).json();
    expect(body.sharedWithMe).toEqual([]);
  });

  it("a withdrawn share denies the read", async () => {
    transport.state.resource_grants[0].revoked_at = "2026-09-09T12:00:00.000Z";
    H.user = { id: GRANTEE };
    const r = await GET();
    const body = await r.json();
    expect(body.sharedWithMe).toEqual([]);
    const json = JSON.stringify(body);
    expect(json).not.toContain("grant_revoked");
    const decision = tenantScope.decideTenantScope(
      { userId: GRANTEE },
      [],
      { id: LIST_A, ownerId: OWNER, teamId: null, visibility: "private" },
      [{ resourceId: LIST_A, granteeUserId: GRANTEE, revokedAt: "2026-09-09T12:00:00.000Z" }],
    );
    expect(decision.reason).toBe("grant_revoked");
    expect(r.status).toBe(200);
  });

  it("a grantee cannot add a symbol to a list shared with them", async () => {
    H.user = { id: GRANTEE };
    const r = await post({ action: "add", listId: LIST_A, symbols: ["GOLD"], section: "Miners" });
    expect([400, 404]).toContain(r.status);
    const body = await r.json();
    expect(JSON.stringify(body)).not.toContain("GOLD");
    expect(transport.state.watchlist_symbols.some((s) => s.symbol === "GOLD")).toBe(false);
  });

  it("a grantee cannot rename or delete a list shared with them", async () => {
    H.user = { id: GRANTEE };
    const renamed = await post({ action: "renameList", listId: LIST_A, name: "Stolen" });
    expect(renamed.status).toBe(404);
    const deleted = await post({ action: "deleteList", listId: LIST_A });
    expect(deleted.status).toBe(404);
    expect(transport.state.watchlists.find((w) => w.id === LIST_A)?.name).toBe("Gold Miners");
  });

  it("a share of one list never exposes the owner's other lists", async () => {
    H.user = { id: GRANTEE };
    const body = await (await GET()).json();
    const ids = [
      ...body.lists.map((l: { id: string }) => l.id),
      ...body.sharedWithMe.map((l: { id: string }) => l.id),
    ];
    expect(ids).toContain(LIST_A);
    expect(ids).not.toContain(LIST_B);
  });

  it("a share naming a different account never allows this caller", async () => {
    transport.state.resource_grants[0].grantee_user_id = STRANGER;
    H.user = { id: GRANTEE };
    const body = await (await GET()).json();
    expect(body.sharedWithMe).toEqual([]);
  });

  it("a team membership does not stand in for a share", async () => {
    transport.state.resource_grants = [];
    transport.state.team_members.push({
      team_id: TEAM_X,
      user_id: GRANTEE,
      role: "member",
    });
    H.user = { id: GRANTEE };
    const body = await (await GET()).json();
    expect(body.sharedWithMe).toEqual([]);
    const decision = tenantScope.decideTenantScope(
      { userId: GRANTEE },
      [{ userId: GRANTEE, teamId: TEAM_X, role: "member" }],
      { id: LIST_A, ownerId: OWNER, teamId: null, visibility: "private" },
      [],
    );
    expect(decision).toEqual({ allow: false, reason: "private_not_owner" });
  });

  it("the read passes visibility \"private\" explicitly and memberships empty", async () => {
    H.user = { id: GRANTEE };
    await GET();
    expect(decideSpy.mock.calls.length).toBeGreaterThan(0);
    for (const call of decideSpy.mock.calls) {
      const memberships = call[1];
      const resource = call[2] as { visibility?: unknown } | undefined;
      expect(memberships).toEqual([]);
      expect(resource?.visibility).toBe("private");
      expect(resource?.visibility).not.toBeNull();
    }
  });

  it("an owner's own read is unchanged by the presence of grants", async () => {
    H.user = { id: OWNER };
    const body = await (await GET()).json();
    expect(body.lists.map((l: { name: string }) => l.name)).toEqual(["Gold Miners", "Keep Private"]);
    expect(body.sharedWithMe).toEqual([]);
  });

  it("a failed grant-fed read reports sharedWithMe null and the failed state, not an empty array", async () => {
    H.user = { id: GRANTEE };
    transport.state.symbolsFault = { code: "08000" };
    const r = await GET();
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.sharedWithMe).toBeNull();
    expect(body.sharedWithMeState).toBe("failed");
    expect(Array.isArray(body.lists)).toBe(true);
  });

  it("an unavailable grant-fed read reports sharedWithMe null and the unavailable state", async () => {
    H.user = { id: GRANTEE };
    transport.state.grantsMissing = true;
    const r = await GET();
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.sharedWithMe).toBeNull();
    expect(body.sharedWithMeState).toBe("unavailable");
  });
});
