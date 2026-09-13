import { beforeEach, describe, expect, it, vi } from "vitest";
import { GRANT_ROUTE_MESSAGES, toTenantGrants } from "@/lib/resourceGrants";
import { decideTenantScope } from "@/lib/tenantScope";

const OWNER = "11111111-1111-4111-8111-111111111111";
const GRANTEE = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const LIST_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LIST_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const H = vi.hoisted(() => ({ user: null as { id: string } | null }));
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
    fault: null as { code: string } | null,
    watchlistsFault: null as { code: string } | null,
    symbolsFault: null as { code: string } | null,
    grantsMissing: false,
    seq: 0,
  };
  const nextId = (_prefix: string) => {
    const n = ++state.seq;
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
  const rowsFor = (table: string): Row[] => {
    if (table === "watchlists") return state.watchlists;
    if (table === "watchlist_symbols") return state.watchlist_symbols;
    return state.resource_grants;
  };

  const db = {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let pendingInsert: Row | Row[] | null = null;
      let pendingUpdate: Row | null = null;
      let wantSingle = false;

      const applyFilters = (rows: Row[]) => rows.filter((r) => filters.every((f) => f(r)));

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
        if (state.fault) return { data: null, error: { code: state.fault.code, message: "fault" } };
        if (pendingInsert) {
          const values = Array.isArray(pendingInsert) ? pendingInsert : [pendingInsert];
          const inserted: Row[] = [];
          for (const v of values) {
            if (table === "resource_grants") {
              if (v.grantee_user_id === v.granted_by) {
                return { data: null, error: { code: "23514", message: "check violation" } };
              }
              const liveDup = state.resource_grants.find(
                (r) =>
                  r.resource_kind === v.resource_kind &&
                  r.resource_id === v.resource_id &&
                  r.grantee_user_id === v.grantee_user_id &&
                  r.revoked_at == null,
              );
              if (liveDup) return { data: null, error: { code: "23505", message: "duplicate" } };
              const actor = H.user?.id;
              const owned = state.watchlists.some((w) => w.id === v.resource_id && w.user_id === actor);
              if (!owned || v.granted_by !== actor || v.grantee_user_id === actor) {
                return { data: null, error: { code: "42501", message: "permission denied" } };
              }
            }
            const row: Row = { id: nextId(table), created_at: new Date().toISOString(), revoked_at: null, ...v };
            rowsFor(table).push(row);
            inserted.push(row);
          }
          return { data: wantSingle ? inserted[0] ?? null : inserted, error: null };
        }
        if (pendingUpdate) {
          const matched = applyFilters(rowsFor(table));
          if (table === "resource_grants") {
            for (const old of matched) {
              if (old.revoked_at != null && pendingUpdate.revoked_at !== undefined && pendingUpdate.revoked_at !== old.revoked_at) {
                return { data: null, error: { code: "42501", message: "a withdrawn share cannot be changed" } };
              }
              for (const col of ["resource_kind", "resource_id", "grantee_user_id", "granted_by", "created_at"] as const) {
                if (pendingUpdate[col] !== undefined && pendingUpdate[col] !== old[col]) {
                  return { data: null, error: { code: "42501", message: "a share record cannot be re-pointed" } };
                }
              }
            }
          }
          const updated: Row[] = [];
          for (const old of matched) {
            Object.assign(old, pendingUpdate);
            updated.push({ ...old });
          }
          return { data: wantSingle ? updated[0] ?? null : updated, error: null };
        }
        const rows = applyFilters(rowsFor(table));
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

describe("/api/grants — explicit watchlist shares", () => {
  let GET: any, POST: any, DELETE: any, transport: ReturnType<typeof makeFakeTransport>;

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
    );
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user: H.user } }) }, ...transport.db }),
    }));
    ({ GET, POST, DELETE } = await import("@/app/api/grants/route"));
  });

  function post(body: unknown) {
    return POST(new Request("http://localhost/api/grants", { method: "POST", body: JSON.stringify(body) }));
  }
  function del(body: unknown) {
    return DELETE(new Request("http://localhost/api/grants", { method: "DELETE", body: JSON.stringify(body) }));
  }
  const shareBody = {
    action: "share",
    resourceKind: "watchlist",
    resourceId: LIST_A,
    granteeUserId: GRANTEE,
  };

  it("refuses to share when nobody is signed in", async () => {
    const r = await post(shareBody);
    expect(r.status).toBe(401);
    const body = await r.json();
    expect(body.message).toBe(GRANT_ROUTE_MESSAGES.not_signed_in[0]);
    expect(body.messageZh).toBe(GRANT_ROUTE_MESSAGES.not_signed_in[1]);
  });

  it("refuses to share a list the caller does not own", async () => {
    H.user = { id: STRANGER };
    const r = await post(shareBody);
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.message).toBe(GRANT_ROUTE_MESSAGES.list_not_found[0]);
    expect(body.messageZh).toBe(GRANT_ROUTE_MESSAGES.list_not_found[1]);
    expect(transport.state.resource_grants).toHaveLength(0);
  });

  it("refuses to share a list with the caller's own account", async () => {
    H.user = { id: OWNER };
    const r = await post({ ...shareBody, granteeUserId: OWNER });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.message).toBe(GRANT_ROUTE_MESSAGES.cannot_share_with_self[0]);
    expect(body.messageZh).toBe(GRANT_ROUTE_MESSAGES.cannot_share_with_self[1]);
    expect(transport.state.resource_grants).toHaveLength(0);
  });

  it("answers cannot_share_with_self before it ever checks who owns the list", async () => {
    H.user = { id: STRANGER };
    const r = await post({
      ...shareBody,
      resourceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      granteeUserId: STRANGER,
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.message).toBe(GRANT_ROUTE_MESSAGES.cannot_share_with_self[0]);
    expect(body.error).not.toBe("list_not_found");
  });

  it("refuses an email address and says how to share instead", async () => {
    H.user = { id: OWNER };
    const r = await post({ ...shareBody, granteeUserId: "colleague@example.com" });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.message).toBe(GRANT_ROUTE_MESSAGES.email_not_supported[0]);
    expect(body.messageZh).toBe(GRANT_ROUTE_MESSAGES.email_not_supported[1]);
  });

  it("creates a read-only share and reports it back to the owner", async () => {
    H.user = { id: OWNER };
    const r = await post(shareBody);
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.grant.resourceId).toBe(LIST_A);
    expect(body.grant.granteeUserId).toBe(GRANTEE);
    expect(body.grant.resourceName).toBe("Gold Miners");
    expect(body.grant.revokedAt).toBeNull();
    expect(transport.state.resource_grants).toHaveLength(1);
    expect(transport.state.resource_grants[0].revoked_at).toBeNull();
  });

  it("sharing the same list with the same account twice does not create a second live share", async () => {
    H.user = { id: OWNER };
    const first = await post(shareBody);
    expect(first.status).toBe(201);
    const again = await post(shareBody);
    expect(again.status).toBe(200);
    const body = await again.json();
    expect(body.message).toBe(GRANT_ROUTE_MESSAGES.already_shared[0]);
    expect(body.grant.resourceId).toBe(LIST_A);
    expect(transport.state.resource_grants.filter((g) => g.revoked_at == null)).toHaveLength(1);
  });

  it("revoking a share marks it withdrawn and leaves the record in place", async () => {
    H.user = { id: OWNER };
    const created = await (await post(shareBody)).json();
    const r = await del({ grantId: created.grant.id });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(transport.state.resource_grants).toHaveLength(1);
    expect(transport.state.resource_grants[0].revoked_at).toBeTruthy();
  });

  it("revoking a share the caller did not make changes nothing and says the share has ended", async () => {
    H.user = { id: OWNER };
    const created = await (await post(shareBody)).json();
    H.user = { id: STRANGER };
    const r = await del({ grantId: created.grant.id });
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.message).toBe(GRANT_ROUTE_MESSAGES.grant_not_found[0]);
    expect(transport.state.resource_grants[0].revoked_at).toBeNull();
  });

  it("a withdrawn share cannot be reinstated", async () => {
    // Database-level guarantee that a withdrawn share cannot be un-revoked is
    // proved by the canary `ddl:revoke_is_terminal`. This test exercises the
    // product path: a second revokeGrant through the real module answers 404
    // grant_not_found.
    const { revokeGrant } = await import("@/lib/resourceGrants");
    H.user = { id: OWNER };
    const created = await (await post(shareBody)).json();
    const first = await revokeGrant(transport.db as never, OWNER, { grantId: created.grant.id });
    expect(first).toEqual({ ok: true });
    const second = await revokeGrant(transport.db as never, OWNER, { grantId: created.grant.id });
    expect(second).toMatchObject({ ok: false, status: 404, code: "grant_not_found" });
    expect(transport.state.resource_grants[0].revoked_at).toBeTruthy();
  });

  it("a share whose list was deleted is reported to neither side", async () => {
    H.user = { id: OWNER };
    await post(shareBody);
    transport.state.watchlists = transport.state.watchlists.filter((w) => w.id !== LIST_A);
    const ownerView = await (await GET()).json();
    expect(ownerView.shared).toEqual([]);
    H.user = { id: GRANTEE };
    const granteeView = await (await GET()).json();
    expect(granteeView.sharedWithMe).toEqual([]);
  });

  it("every route message carries English and Chinese and no machine code reaches the body", async () => {
    for (const [code, pair] of Object.entries(GRANT_ROUTE_MESSAGES)) {
      expect(pair[0].length).toBeGreaterThan(8);
      expect(pair[1].length).toBeGreaterThan(4);
      expect(pair[0]).not.toMatch(/_/);
      expect(pair[1]).not.toContain(code);
      expect(pair[0]).not.toContain(code);
      expect(pair[1]).toMatch(/[一-鿿]/);
      if (/[.!?]$/.test(pair[0].trim())) {
        expect(pair[1].trim(), `${code} ZH must end a sentence`).toMatch(/[。！？]$/);
      }
    }
    H.user = { id: OWNER };
    const r = await post({ ...shareBody, granteeUserId: OWNER });
    const body = await r.json();
    expect(JSON.stringify(body)).not.toContain("cannot_share_with_self");
  });

  it("maps a grant row into the tenantScope Grant shape without renaming or defaulting a field", () => {
    const mapped = toTenantGrants([
      { resource_id: LIST_A, grantee_user_id: GRANTEE, revoked_at: null },
    ]);
    expect(mapped).toEqual([{ resourceId: LIST_A, granteeUserId: GRANTEE, revokedAt: null }]);
  });

  it("passes an empty revoked_at straight through so the decider can fail closed", () => {
    const mapped = toTenantGrants([
      { resource_id: LIST_A, grantee_user_id: GRANTEE, revoked_at: "" },
    ]);
    expect(mapped[0].revokedAt).toBe("");
    const decision = decideTenantScope(
      { userId: GRANTEE },
      [],
      { id: LIST_A, ownerId: OWNER, teamId: null, visibility: "private" },
      mapped,
    );
    expect(decision).toEqual({ allow: false, reason: "grant_revoked" });
  });

  it("answers unavailable, not a crash, when the grants table is not there", async () => {
    H.user = { id: OWNER };
    transport.state.grantsMissing = true;
    const r = await post(shareBody);
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body.message).toBe(GRANT_ROUTE_MESSAGES.unavailable[0]);
    expect(body.messageZh).toBe(GRANT_ROUTE_MESSAGES.unavailable[1]);
  });

  it("a failed watchlists read is unavailable, not an empty share list", async () => {
    H.user = { id: OWNER };
    const created = await post(shareBody);
    expect(created.status).toBe(201);
    transport.state.watchlistsFault = { code: "42P01" };
    const r = await GET();
    expect(r.status).toBe(503);
    const body = await r.json();
    expect(body.shared).toBeUndefined();
    expect(body.sharedWithMe).toBeUndefined();
    expect(body.message).toBe(GRANT_ROUTE_MESSAGES.unavailable[0]);
  });

  it("a failed watchlists read is failed, not an empty share list", async () => {
    H.user = { id: OWNER };
    const created = await post(shareBody);
    expect(created.status).toBe(201);
    transport.state.watchlistsFault = { code: "08000" };
    const r = await GET();
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.shared).toBeUndefined();
    expect(body.sharedWithMe).toBeUndefined();
    expect(body.message).toBe(GRANT_ROUTE_MESSAGES.read_failed[0]);
  });

  it("a failed symbols read is failed, not a fabricated zero-symbol share", async () => {
    H.user = { id: OWNER };
    const created = await post(shareBody);
    expect(created.status).toBe(201);
    H.user = { id: GRANTEE };
    transport.state.symbolsFault = { code: "08000" };
    const r = await GET();
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.shared).toBeUndefined();
    expect(body.sharedWithMe).toBeUndefined();
    expect(body.message).toBe(GRANT_ROUTE_MESSAGES.read_failed[0]);
  });
});
