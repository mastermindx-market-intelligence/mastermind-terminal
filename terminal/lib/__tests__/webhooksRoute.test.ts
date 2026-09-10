import { beforeEach, describe, expect, it, vi } from "vitest";
import { WEBHOOK_ROUTE_MESSAGES } from "@/lib/webhooks";

const H = vi.hoisted(() => ({
  user: null as { id: string } | null,
  role: "owner" as "owner" | "admin" | "member" | null,
  insertError: null as { code: string; message: string } | null,
  lastInsert: null as Record<string, unknown> | null,
  lastUpdate: null as Record<string, unknown> | null,
  lastSelect: null as string | null,
  endpoints: [] as Record<string, unknown>[],
  deliveries: [] as Record<string, unknown>[],
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: { ok: true, event_id: "evt-test" }, error: null as { code?: string; message?: string } | null },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: H.user } }) },
    from(table: string) {
      const q: any = {
        _select: "*",
        _filters: [] as Array<[string, unknown]>,
        _pendingInsert: null as Record<string, unknown> | null,
        _pendingUpdate: null as Record<string, unknown> | null,
        select(fields?: string) {
          q._select = fields ?? "*";
          H.lastSelect = q._select;
          return q;
        },
        eq(col: string, val: unknown) {
          q._filters.push([col, val]);
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        insert(values: Record<string, unknown>) {
          q._pendingInsert = values;
          H.lastInsert = values;
          return q;
        },
        update(values: Record<string, unknown>) {
          q._pendingUpdate = values;
          H.lastUpdate = values;
          return q;
        },
        maybeSingle: async () => {
          if (table === "team_members") {
            if (!H.role) return { data: null, error: null };
            return { data: { role: H.role }, error: null };
          }
          if (q._pendingInsert) {
            if (H.insertError) return { data: null, error: H.insertError };
            const row = {
              id: "ep-1",
              created_at: "2026-09-09T10:00:00.000Z",
              ...q._pendingInsert,
            };
            delete (row as { secret?: string }).secret;
            H.endpoints.push(row);
            return { data: row, error: null };
          }
          if (table === "webhook_endpoints") {
            const rows = H.endpoints.filter((r) =>
              q._filters.every(([c, v]: [string, unknown]) => r[c] === v),
            );
            const row = rows[0] ?? null;
            if (row && typeof q._select === "string" && !q._select.includes("secret") && "secret" in row) {
              const { secret: _s, ...safe } = row;
              return { data: safe, error: null };
            }
            return { data: row, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve: (v: unknown) => unknown) {
          if (table === "team_members") {
            return Promise.resolve({
              data: H.role ? [{ team_id: "team-1", role: H.role }] : [],
              error: null,
            }).then(resolve);
          }
          if (table === "teams") {
            return Promise.resolve({
              data: [{ id: "team-1", name: "Desk", created_at: "2026-09-01T00:00:00.000Z" }],
              error: null,
            }).then(resolve);
          }
          if (table === "webhook_endpoints") {
            const rows = H.endpoints.map((r) => {
              if (typeof q._select === "string" && !q._select.includes("secret")) {
                const { secret: _s, ...safe } = r;
                return safe;
              }
              return r;
            });
            return Promise.resolve({ data: rows, error: null }).then(resolve);
          }
          if (table === "webhook_deliveries") {
            return Promise.resolve({ data: H.deliveries, error: null }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      H.rpcCalls.push({ fn, args });
      return H.rpcResult;
    },
  }),
}));

function req(url: string, init?: RequestInit) {
  return new Request(url, init);
}

describe("/api/webhooks routes", () => {
  let GET: any, POST: any, PATCH: any, TEST: any, DELIVERIES: any;

  beforeEach(async () => {
    vi.resetModules();
    H.user = null;
    H.role = "owner";
    H.insertError = null;
    H.lastInsert = null;
    H.lastUpdate = null;
    H.lastSelect = null;
    H.endpoints = [];
    H.deliveries = [];
    H.rpcCalls = [];
    H.rpcResult = { data: { ok: true, event_id: "evt-test" }, error: null };
    ({ GET, POST } = await import("@/app/api/webhooks/route"));
    ({ PATCH } = await import("@/app/api/webhooks/[id]/route"));
    ({ POST: TEST } = await import("@/app/api/webhooks/[id]/test/route"));
    ({ GET: DELIVERIES } = await import("@/app/api/webhooks/[id]/deliveries/route"));
  });

  const ctx = { params: Promise.resolve({ id: "ep-1" }) };

  it("401 UNAUTHENTICATED on every verb when signed out", async () => {
    const rGet = await GET(req("http://localhost/api/webhooks"));
    expect(rGet.status).toBe(401);
    const bGet = await rGet.json();
    expect(bGet.error).toBe("UNAUTHENTICATED");
    expect(bGet.message).toBe(WEBHOOK_ROUTE_MESSAGES.not_signed_in[0]);
    expect(bGet.messageZh).toBe(WEBHOOK_ROUTE_MESSAGES.not_signed_in[1]);

    const rPost = await POST(req("http://localhost/api/webhooks", { method: "POST", body: "{}" }));
    expect(rPost.status).toBe(401);
    expect((await rPost.json()).messageZh).toBe(WEBHOOK_ROUTE_MESSAGES.not_signed_in[1]);

    const rPatch = await PATCH(req("http://localhost/api/webhooks/ep-1", { method: "PATCH", body: "{}" }), ctx);
    expect(rPatch.status).toBe(401);

    const rTest = await TEST(req("http://localhost/api/webhooks/ep-1/test", { method: "POST" }), ctx);
    expect(rTest.status).toBe(401);

    const rDel = await DELIVERIES(req("http://localhost/api/webhooks/ep-1/deliveries"), ctx);
    expect(rDel.status).toBe(401);
  });

  it("member POST to create is a plain-language rejection, never a raw Postgres string", async () => {
    H.user = { id: "u-member" };
    H.role = "member";
    H.insertError = { code: "42501", message: "permission denied for table webhook_endpoints" };
    const r = await POST(
      req("http://localhost/api/webhooks", {
        method: "POST",
        body: JSON.stringify({ teamId: "team-1", url: "https://example.com/hook", event_filter: ["webhook.test"] }),
      }),
    );
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.message).toBe(WEBHOOK_ROUTE_MESSAGES.not_admin[0]);
    expect(body.messageZh).toBe(WEBHOOK_ROUTE_MESSAGES.not_admin[1]);
    expect(JSON.stringify(body)).not.toMatch(/42501|permission denied|webhook_endpoints/i);
  });

  it("PATCH carrying an extra secret key is 400 and never reaches the DB", async () => {
    H.user = { id: "u-owner" };
    H.role = "owner";
    H.endpoints = [
      {
        id: "ep-1",
        team_id: "team-1",
        url: "https://example.com/hook",
        enabled: true,
        event_filter: ["webhook.test"],
        created_by: "u-owner",
        created_at: "2026-09-09T10:00:00.000Z",
      },
    ];
    const r = await PATCH(
      req("http://localhost/api/webhooks/ep-1", {
        method: "PATCH",
        body: JSON.stringify({ enabled: true, secret: "x" }),
      }),
      ctx,
    );
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.message).toBe(WEBHOOK_ROUTE_MESSAGES.closed_patch[0]);
    expect(body.messageZh).toBe(WEBHOOK_ROUTE_MESSAGES.closed_patch[1]);
    expect(H.lastUpdate).toBeNull();
  });

  it("GET response does not contain a secret key at all", async () => {
    H.user = { id: "u-owner" };
    H.role = "owner";
    H.endpoints = [
      {
        id: "ep-1",
        team_id: "team-1",
        url: "https://example.com/hook",
        enabled: true,
        event_filter: ["webhook.test"],
        created_by: "u-owner",
        created_at: "2026-09-09T10:00:00.000Z",
        secret: "should-never-leak",
      },
    ];
    const r = await GET(req("http://localhost/api/webhooks?teamId=team-1"));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(JSON.stringify(body)).not.toContain("should-never-leak");
    expect(body.endpoints[0].secret).toBeUndefined();
    expect(H.lastSelect).toBeTruthy();
    expect(H.lastSelect).not.toContain("secret");
    expect(H.lastSelect).not.toBe("*");
  });
});
