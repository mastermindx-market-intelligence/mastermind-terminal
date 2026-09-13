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
  rpcResult: { data: { ok: true, event_id: "evt-test" } as Record<string, unknown>, error: null as { code?: string; message?: string } | null },
  optins: [] as Record<string, unknown>[],
  lastUpsert: null as Record<string, unknown> | null,
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
        upsert(values: Record<string, unknown>) {
          q._pendingInsert = values;
          H.lastUpsert = values;
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
            if (table === "webhook_alert_optins") {
              const row = { enabled: true, ...q._pendingInsert };
              H.optins = H.optins.filter(
                (r) => !(r.user_id === row.user_id && r.team_id === row.team_id),
              );
              H.optins.push(row);
              return { data: row, error: null };
            }
            const row = {
              id: "ep-1",
              created_at: "2026-09-09T10:00:00.000Z",
              secret_version: 1,
              secret_rotated_at: null,
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
            const cols = typeof q._select === "string" ? q._select.split(",") : [];
            if (row && !cols.includes("secret") && !cols.includes("secret_previous") && ("secret" in row || "secret_previous" in row)) {
              const { secret: _s, secret_previous: _p, ...safe } = row as Record<string, unknown>;
              return { data: safe, error: null };
            }
            return { data: row, error: null };
          }
          if (table === "webhook_deliveries") {
            const rows = H.deliveries.filter((r) =>
              q._filters.every(([c, v]: [string, unknown]) => r[c] === v),
            );
            return { data: rows[0] ?? null, error: null };
          }
          if (table === "webhook_alert_optins") {
            const rows = H.optins.filter((r) =>
              q._filters.every(([c, v]: [string, unknown]) => r[c] === v),
            );
            return { data: rows[0] ?? null, error: null };
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
              const cols = typeof q._select === "string" ? q._select.split(",") : [];
              if (!cols.includes("secret") && !cols.includes("*")) {
                const { secret: _s, secret_previous: _p, ...safe } = r;
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
  let GET: any, POST: any, PATCH: any, TEST: any, DELIVERIES: any, ROTATE: any, RETRY: any, OPTIN_GET: any, OPTIN_PUT: any;

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
    H.optins = [];
    H.lastUpsert = null;
    ({ GET, POST } = await import("@/app/api/webhooks/route"));
    ({ PATCH } = await import("@/app/api/webhooks/[id]/route"));
    ({ POST: TEST } = await import("@/app/api/webhooks/[id]/test/route"));
    ({ GET: DELIVERIES } = await import("@/app/api/webhooks/[id]/deliveries/route"));
    ({ POST: ROTATE } = await import("@/app/api/webhooks/[id]/rotate/route"));
    ({ POST: RETRY } = await import("@/app/api/webhooks/[id]/deliveries/[deliveryId]/retry/route"));
    ({ GET: OPTIN_GET, PUT: OPTIN_PUT } = await import("@/app/api/webhooks/alert-optin/route"));
  });

  const ctx = { params: Promise.resolve({ id: "ep-1" }) };
  const retryCtx = { params: Promise.resolve({ id: "ep-1", deliveryId: "del-1" }) };
  const TEAM_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const seedEndpoint = {
    id: "ep-1",
    team_id: "team-1",
    url: "https://example.com/hook",
    enabled: true,
    event_filter: ["webhook.test"],
    created_by: "u-owner",
    created_at: "2026-09-09T10:00:00.000Z",
    secret_version: 1,
    secret_rotated_at: null,
  };

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

    const rRotate = await ROTATE(req("http://localhost/api/webhooks/ep-1/rotate", { method: "POST" }), ctx);
    expect(rRotate.status).toBe(401);
    expect((await rRotate.json()).messageZh).toBe(WEBHOOK_ROUTE_MESSAGES.not_signed_in[1]);

    const rRetry = await RETRY(req("http://localhost/api/webhooks/ep-1/deliveries/del-1/retry", { method: "POST" }), retryCtx);
    expect(rRetry.status).toBe(401);

    const rOptin = await OPTIN_GET(req(`http://localhost/api/webhooks/alert-optin?teamId=${TEAM_UUID}`));
    expect(rOptin.status).toBe(401);
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
    expect(JSON.stringify(body)).not.toMatch(/"secret"\s*:/);
    expect(JSON.stringify(body)).not.toContain("should-never-leak");
    expect(JSON.stringify(body)).not.toContain("secret_previous");
    expect(body.endpoints[0].secret).toBeUndefined();
    expect(body.endpoints[0].secretPrevious).toBeUndefined();
    expect(H.lastSelect).toBeTruthy();
    const selected = String(H.lastSelect).split(",");
    expect(selected).not.toContain("secret");
    expect(selected).not.toContain("secret_previous");
    expect(H.lastSelect).not.toBe("*");
  });

  it("rotate 403 for a member", async () => {
    H.user = { id: "u-member" };
    H.role = "member";
    H.endpoints = [{ ...seedEndpoint }];
    const r = await ROTATE(req("http://localhost/api/webhooks/ep-1/rotate", { method: "POST" }), ctx);
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.message).toBe(WEBHOOK_ROUTE_MESSAGES.not_admin[0]);
    expect(body.messageZh).toBe(WEBHOOK_ROUTE_MESSAGES.not_admin[1]);
    expect(H.rpcCalls).toEqual([]);
  });

  it("rotate 404 when the endpoint is missing", async () => {
    H.user = { id: "u-owner" };
    H.role = "owner";
    const r = await ROTATE(req("http://localhost/api/webhooks/ep-1/rotate", { method: "POST" }), ctx);
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.message).toBe(WEBHOOK_ROUTE_MESSAGES.not_found[0]);
    expect(JSON.stringify(body)).not.toMatch(/"secret"\s*:/);
  });

  it("rotate happy path returns the new secret once", async () => {
    H.user = { id: "u-owner" };
    H.role = "owner";
    H.endpoints = [{ ...seedEndpoint }];
    H.rpcResult = {
      data: { ok: true, secret: "whsec_new_once", secret_version: 2, previous_expires_at: "2026-09-10T12:00:00.000Z" },
      error: null,
    };
    const r = await ROTATE(req("http://localhost/api/webhooks/ep-1/rotate", { method: "POST" }), ctx);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({ ok: true, secret: "whsec_new_once", secretVersion: 2 });
    expect(H.rpcCalls).toEqual([{ fn: "rotate_webhook_secret", args: { p_endpoint_id: "ep-1" } }]);
  });

  it("retry 404 when the delivery is missing", async () => {
    H.user = { id: "u-owner" };
    H.role = "owner";
    H.endpoints = [{ ...seedEndpoint }];
    const r = await RETRY(req("http://localhost/api/webhooks/ep-1/deliveries/del-1/retry", { method: "POST" }), retryCtx);
    expect(r.status).toBe(404);
    expect((await r.json()).message).toBe(WEBHOOK_ROUTE_MESSAGES.not_found[0]);
  });

  it("retry 409 when the delivery has not given up", async () => {
    H.user = { id: "u-owner" };
    H.role = "owner";
    H.endpoints = [{ ...seedEndpoint }];
    H.deliveries = [
      {
        id: "del-1",
        endpoint_id: "ep-1",
        team_id: "team-1",
        event_id: "evt-1",
        event_type: "alert.fired",
        attempt: 2,
        status: "retrying",
        response_code: null,
        last_error: "timeout",
        next_retry_at: null,
        delivered_at: null,
        created_at: "2026-09-09T10:00:00.000Z",
      },
    ];
    H.rpcResult = { data: { ok: false, reason: "not_failed" }, error: null };
    const r = await RETRY(req("http://localhost/api/webhooks/ep-1/deliveries/del-1/retry", { method: "POST" }), retryCtx);
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.message).toBe(WEBHOOK_ROUTE_MESSAGES.not_failed[0]);
    expect(body.messageZh).toBe(WEBHOOK_ROUTE_MESSAGES.not_failed[1]);
  });

  it("retry happy path requeues a failed delivery", async () => {
    H.user = { id: "u-owner" };
    H.role = "owner";
    H.endpoints = [{ ...seedEndpoint }];
    H.deliveries = [
      {
        id: "del-1",
        endpoint_id: "ep-1",
        team_id: "team-1",
        event_id: "evt-1",
        event_type: "alert.fired",
        attempt: 5,
        status: "failed",
        response_code: 500,
        last_error: "http 500",
        next_retry_at: null,
        delivered_at: null,
        created_at: "2026-09-09T10:00:00.000Z",
      },
    ];
    H.rpcResult = { data: { ok: true }, error: null };
    const r = await RETRY(req("http://localhost/api/webhooks/ep-1/deliveries/del-1/retry", { method: "POST" }), retryCtx);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(H.rpcCalls).toEqual([{ fn: "requeue_failed_webhook_delivery", args: { p_delivery_id: "del-1" } }]);
  });

  it("alert-optin GET own-row happy defaults to off when no row", async () => {
    H.user = { id: "u-owner" };
    H.role = "owner";
    const r = await OPTIN_GET(req(`http://localhost/api/webhooks/alert-optin?teamId=${TEAM_UUID}`));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ enabled: false });
  });

  it("alert-optin GET own-row happy returns the saved flag", async () => {
    H.user = { id: "u-owner" };
    H.role = "owner";
    H.optins = [{ user_id: "u-owner", team_id: TEAM_UUID, enabled: true }];
    const r = await OPTIN_GET(req(`http://localhost/api/webhooks/alert-optin?teamId=${TEAM_UUID}`));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ enabled: true });
  });

  it("alert-optin PUT own-row happy upserts", async () => {
    H.user = { id: "u-owner" };
    H.role = "owner";
    const r = await OPTIN_PUT(
      req(`http://localhost/api/webhooks/alert-optin?teamId=${TEAM_UUID}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: true }),
      }),
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, enabled: true });
    expect(H.lastUpsert).toMatchObject({ user_id: "u-owner", team_id: TEAM_UUID, enabled: true });
  });

  it("alert-optin 400 shapes for missing teamId, invalid teamId, and non-boolean", async () => {
    H.user = { id: "u-owner" };
    H.role = "owner";
    const missing = await OPTIN_GET(req("http://localhost/api/webhooks/alert-optin"));
    expect(missing.status).toBe(400);
    expect((await missing.json()).message).toBe(WEBHOOK_ROUTE_MESSAGES.team_required[0]);

    const invalid = await OPTIN_PUT(
      req("http://localhost/api/webhooks/alert-optin?teamId=not-a-team", {
        method: "PUT",
        body: JSON.stringify({ enabled: true }),
      }),
    );
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).messageZh).toBe(WEBHOOK_ROUTE_MESSAGES.team_required[1]);

    const badBool = await OPTIN_PUT(
      req(`http://localhost/api/webhooks/alert-optin?teamId=${TEAM_UUID}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: "yes" }),
      }),
    );
    expect(badBool.status).toBe(400);
    expect((await badBool.json()).message).toBe(WEBHOOK_ROUTE_MESSAGES.send_json[0]);
  });

  it("alert-optin 404 for a non-member never confirms the team exists", async () => {
    H.user = { id: "u-stranger" };
    H.role = null;
    const r = await OPTIN_GET(req(`http://localhost/api/webhooks/alert-optin?teamId=${TEAM_UUID}`));
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.message).toBe(WEBHOOK_ROUTE_MESSAGES.not_member[0]);
    expect(body.messageZh).toBe(WEBHOOK_ROUTE_MESSAGES.not_member[1]);
    expect(JSON.stringify(body)).not.toMatch(/team_members|not a member|webhook_alert_optins/i);
  });

  it("PATCH accepts alert.fired inside event_filter", async () => {
    H.user = { id: "u-owner" };
    H.role = "owner";
    H.endpoints = [{ ...seedEndpoint }];
    const r = await PATCH(
      req("http://localhost/api/webhooks/ep-1", {
        method: "PATCH",
        body: JSON.stringify({ event_filter: ["webhook.test", "alert.fired"] }),
      }),
      ctx,
    );
    expect(r.status).toBe(200);
    expect(H.lastUpdate).toEqual({ event_filter: ["webhook.test", "alert.fired"] });
  });
});
