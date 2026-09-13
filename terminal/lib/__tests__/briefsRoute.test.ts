import { beforeEach, describe, expect, it, vi } from "vitest";
import { BRIEFS_ROUTE_MESSAGES } from "@/lib/briefs";

const H = vi.hoisted(() => ({
  user: null as { id: string } | null,
  insertError: null as { code: string; message: string } | null,
  updateError: null as { code: string; message: string } | null,
  deleteError: null as { code: string; message: string } | null,
  selectError: null as { code: string; message: string } | null,
  subscriptions: [] as Record<string, unknown>[],
  deliveries: [] as Record<string, unknown>[],
  theses: [] as Record<string, unknown>[],
  watchlists: [] as Record<string, unknown>[],
  thesisVersions: [] as Record<string, unknown>[],
  lastInsert: null as Record<string, unknown> | null,
  lastUpdate: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: H.user } }) },
    from(table: string) {
      const q: {
        _select: string;
        _filters: Array<[string, unknown]>;
        _in: Array<[string, unknown[]]>;
        _pendingInsert: Record<string, unknown> | null;
        _pendingUpdate: Record<string, unknown> | null;
        _pendingDelete: boolean;
        _order: Array<[string, boolean]>;
        _limit: number | null;
        select: (fields?: string) => typeof q;
        eq: (col: string, val: unknown) => typeof q;
        in: (col: string, vals: unknown[]) => typeof q;
        order: (col: string, opts?: { ascending?: boolean }) => typeof q;
        limit: (n: number) => typeof q;
        insert: (values: Record<string, unknown>) => typeof q;
        update: (values: Record<string, unknown>) => typeof q;
        delete: () => typeof q;
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }>;
        single: () => Promise<{ data: Record<string, unknown> | null; error: unknown }>;
        then: (resolve: (v: unknown) => unknown) => Promise<unknown>;
      } = {
        _select: "*",
        _filters: [],
        _in: [],
        _pendingInsert: null,
        _pendingUpdate: null,
        _pendingDelete: false,
        _order: [],
        _limit: null,
        select(fields?: string) {
          q._select = fields ?? "*";
          return q;
        },
        eq(col: string, val: unknown) {
          q._filters.push([col, val]);
          return q;
        },
        in(col: string, vals: unknown[]) {
          q._in.push([col, vals]);
          return q;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          q._order.push([col, opts?.ascending !== false]);
          return q;
        },
        limit(n: number) {
          q._limit = n;
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
        delete() {
          q._pendingDelete = true;
          return q;
        },
        maybeSingle: async () => finishSingle(true),
        single: async () => finishSingle(false),
        then(resolve: (v: unknown) => unknown) {
          return Promise.resolve(finishList()).then(resolve);
        },
      };

      function matches(row: Record<string, unknown>) {
        const eqOk = q._filters.every(([c, v]) => row[c] === v);
        const inOk = q._in.every(([c, vals]) => vals.includes(row[c]));
        return eqOk && inOk;
      }

      function finishSingle(allowEmpty: boolean) {
        if (table === "brief_subscriptions" && q._pendingInsert) {
          if (H.insertError) return { data: null, error: H.insertError };
          const row = {
            subscription_id: "sub-1",
            created_at: "2026-09-11T20:00:00.000Z",
            delivery: "in_product_inbox",
            state: "active",
            ...q._pendingInsert,
          };
          H.subscriptions.push(row);
          return { data: row, error: null };
        }
        if (table === "brief_subscriptions" && q._pendingUpdate) {
          if (H.updateError) return { data: null, error: H.updateError };
          const row = H.subscriptions.find(matches);
          if (!row) return { data: null, error: allowEmpty ? null : { code: "PGRST116", message: "not found" } };
          Object.assign(row, q._pendingUpdate);
          return { data: row, error: null };
        }
        if (table === "brief_subscriptions") {
          const row = H.subscriptions.find(matches) ?? null;
          return { data: row, error: H.selectError };
        }
        return { data: null, error: H.selectError };
      }

      function finishList() {
        if (H.selectError) return { data: null, error: H.selectError };
        if (table === "brief_subscriptions" && q._pendingDelete) {
          if (H.deleteError) return { data: null, error: H.deleteError };
          const before = H.subscriptions.length;
          const kept = H.subscriptions.filter((r) => !matches(r));
          const removed = H.subscriptions.filter(matches);
          H.subscriptions = kept;
          return { data: removed.map((r) => ({ subscription_id: r.subscription_id })), error: null, count: before - kept.length };
        }
        if (table === "brief_subscriptions") {
          let rows = H.subscriptions.filter(matches);
          return { data: rows, error: null };
        }
        if (table === "brief_deliveries") {
          let rows = [...H.deliveries];
          const subId = q._filters.find(([c]) => c === "subscription_id")?.[1];
          if (subId) rows = rows.filter((r) => r.subscription_id === subId);
          rows.sort((a, b) => String(b.slot_asof).localeCompare(String(a.slot_asof)));
          if (q._limit != null) rows = rows.slice(0, q._limit);
          return { data: rows, error: null };
        }
        if (table === "theses") {
          return { data: H.theses.filter(matches), error: null };
        }
        if (table === "watchlists") {
          return { data: H.watchlists.filter(matches), error: null };
        }
        if (table === "thesis_versions") {
          return { data: H.thesisVersions.filter(matches), error: null };
        }
        return { data: [], error: null };
      }

      return q;
    },
  }),
}));

function req(url: string, init?: RequestInit) {
  return new Request(url, init);
}

const THESIS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("/api/briefs routes", () => {
  let GET_SUB: (r: Request) => Promise<Response>;
  let POST_SUB: (r: Request) => Promise<Response>;
  let PATCH_SUB: (r: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  let DELETE_SUB: (r: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  let GET_DEL: (r: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    H.user = null;
    H.insertError = null;
    H.updateError = null;
    H.deleteError = null;
    H.selectError = null;
    H.subscriptions = [];
    H.deliveries = [];
    H.theses = [];
    H.watchlists = [];
    H.thesisVersions = [];
    H.lastInsert = null;
    H.lastUpdate = null;
    ({ GET: GET_SUB, POST: POST_SUB } = await import("@/app/api/briefs/subscriptions/route"));
    ({ PATCH: PATCH_SUB, DELETE: DELETE_SUB } = await import("@/app/api/briefs/subscriptions/[id]/route"));
    ({ GET: GET_DEL } = await import("@/app/api/briefs/deliveries/route"));
  });

  const ctx = { params: Promise.resolve({ id: SUB }) };

  it("401 on every verb when signed out", async () => {
    const rGet = await GET_SUB(req("http://localhost/api/briefs/subscriptions"));
    expect(rGet.status).toBe(401);
    expect((await rGet.json()).message).toBe(BRIEFS_ROUTE_MESSAGES.not_signed_in[0]);

    const rPost = await POST_SUB(req("http://localhost/api/briefs/subscriptions", { method: "POST", body: "{}" }));
    expect(rPost.status).toBe(401);

    const rPatch = await PATCH_SUB(req("http://localhost/api/briefs/subscriptions/x", { method: "PATCH", body: "{}" }), ctx);
    expect(rPatch.status).toBe(401);

    const rDel = await DELETE_SUB(req("http://localhost/api/briefs/subscriptions/x", { method: "DELETE" }), ctx);
    expect(rDel.status).toBe(401);

    const rDeliv = await GET_DEL(req("http://localhost/api/briefs/deliveries"));
    expect(rDeliv.status).toBe(401);
    expect((await rDeliv.json()).messageZh).toBe(BRIEFS_ROUTE_MESSAGES.not_signed_in[1]);
  });

  it("non-owner PATCH and DELETE are 404, never a Postgres string", async () => {
    H.user = { id: "u-other" };
    H.subscriptions = [{
      subscription_id: SUB,
      user_id: "u-owner",
      target_kind: "thesis",
      target_id: THESIS,
      cadence: "daily_after_us_close",
      delivery: "in_product_inbox",
      state: "active",
      created_at: "2026-09-11T00:00:00.000Z",
    }];
    const rPatch = await PATCH_SUB(
      req("http://localhost/api/briefs/subscriptions/" + SUB, {
        method: "PATCH",
        body: JSON.stringify({ state: "pause" }),
      }),
      ctx,
    );
    expect(rPatch.status).toBe(404);
    const bPatch = await rPatch.json();
    expect(bPatch.message).toBe(BRIEFS_ROUTE_MESSAGES.not_found[0]);
    expect(bPatch.messageZh).toBe(BRIEFS_ROUTE_MESSAGES.not_found[1]);
    expect(JSON.stringify(bPatch)).not.toMatch(/PGRST|permission denied|RLS/i);

    const rDel = await DELETE_SUB(
      req("http://localhost/api/briefs/subscriptions/" + SUB, { method: "DELETE" }),
      ctx,
    );
    expect(rDel.status).toBe(404);
    expect((await rDel.json()).messageZh).toBe(BRIEFS_ROUTE_MESSAGES.not_found[1]);
  });

  it("duplicate POST is 409 with a plain reason", async () => {
    H.user = { id: "u-1" };
    H.insertError = { code: "23505", message: "duplicate key value violates unique constraint \"brief_subscriptions_user_id_target_kind_target_id_cadence_key\"" };
    const r = await POST_SUB(
      req("http://localhost/api/briefs/subscriptions", {
        method: "POST",
        body: JSON.stringify({ target_kind: "thesis", target_id: THESIS, cadence: "daily_after_us_close" }),
      }),
    );
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.message).toBe(BRIEFS_ROUTE_MESSAGES.duplicate[0]);
    expect(body.messageZh).toBe(BRIEFS_ROUTE_MESSAGES.duplicate[1]);
    expect(JSON.stringify(body)).not.toContain("23505");
    expect(JSON.stringify(body)).not.toContain("brief_subscriptions_user_id");
  });

  it("pause then resume flips the row state", async () => {
    H.user = { id: "u-1" };
    H.subscriptions = [{
      subscription_id: SUB,
      user_id: "u-1",
      target_kind: "watchlist",
      target_id: THESIS,
      cadence: "weekly_saturday",
      delivery: "in_product_inbox",
      state: "active",
      created_at: "2026-09-11T00:00:00.000Z",
    }];
    const rPause = await PATCH_SUB(
      req("http://localhost/api/briefs/subscriptions/" + SUB, {
        method: "PATCH",
        body: JSON.stringify({ state: "pause" }),
      }),
      ctx,
    );
    expect(rPause.status).toBe(200);
    expect(H.lastUpdate).toEqual({ state: "paused" });
    expect((await rPause.json()).subscription.state).toBe("paused");

    const rResume = await PATCH_SUB(
      req("http://localhost/api/briefs/subscriptions/" + SUB, {
        method: "PATCH",
        body: JSON.stringify({ state: "resume" }),
      }),
      ctx,
    );
    expect(rResume.status).toBe(200);
    expect(H.lastUpdate).toEqual({ state: "active" });
    expect((await rResume.json()).subscription.state).toBe("active");
  });

  it("GET deliveries returns newest first with the subscription joined", async () => {
    H.user = { id: "u-1" };
    H.subscriptions = [{
      subscription_id: SUB,
      user_id: "u-1",
      target_kind: "thesis",
      target_id: THESIS,
      cadence: "daily_after_us_close",
      delivery: "in_product_inbox",
      state: "active",
      created_at: "2026-09-01T00:00:00.000Z",
    }];
    H.deliveries = [
      {
        delivery_id: "old",
        subscription_id: SUB,
        slot_asof: "2026-09-10",
        state: "ready",
        degraded_reason: null,
        artifact_asof: "2026-09-10T20:00:00.000Z",
        body: {
          target: { kind: "thesis", id: THESIS, name: "NVDA cycle", version_or_asof: "v2" },
          market_read: [{ section: "tape", sentence_en: "Older close.", sentence_zh: "较早的收盘。", asof: "2026-09-10" }],
          monitors: [],
          artifact: { name: "digest", asof: "2026-09-10T20:00:00.000Z" },
        },
        created_at: "2026-09-10T20:10:00.000Z",
        brief_subscriptions: {
          subscription_id: SUB,
          user_id: "u-1",
          target_kind: "thesis",
          target_id: THESIS,
          cadence: "daily_after_us_close",
          state: "active",
        },
      },
      {
        delivery_id: "new",
        subscription_id: SUB,
        slot_asof: "2026-09-11",
        state: "degraded",
        degraded_reason: "stale_artifact",
        artifact_asof: null,
        body: {},
        created_at: "2026-09-11T20:10:00.000Z",
        brief_subscriptions: {
          subscription_id: SUB,
          user_id: "u-1",
          target_kind: "thesis",
          target_id: THESIS,
          cadence: "daily_after_us_close",
          state: "active",
        },
      },
    ];
    const r = await GET_DEL(req("http://localhost/api/briefs/deliveries?limit=10"));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.deliveries.map((d: { deliveryId: string }) => d.deliveryId)).toEqual(["new", "old"]);
    expect(body.deliveries[0].subscription.cadence).toBe("daily_after_us_close");
    expect(body.deliveries[0].state).toBe("degraded");
    expect(body.deliveries[1].state).toBe("ready");
    expect(body.deliveries[0].subscription.targetName).toBe("NVDA cycle");
    expect(body.deliveries[0].body).toEqual({});
  });

  it("strips an invalid body instead of shipping judgement keys to the client", async () => {
    H.user = { id: "u-1" };
    H.deliveries = [{
      delivery_id: "bad",
      subscription_id: SUB,
      slot_asof: "2026-09-11",
      state: "ready",
      degraded_reason: null,
      artifact_asof: null,
      body: { score: 0.81, prompt: "summarise", target: { kind: "thesis" } },
      created_at: "2026-09-11T20:10:00.000Z",
      brief_subscriptions: {
        subscription_id: SUB,
        user_id: "u-1",
        target_kind: "thesis",
        target_id: THESIS,
        cadence: "daily_after_us_close",
        state: "active",
      },
    }];
    const r = await GET_DEL(req("http://localhost/api/briefs/deliveries"));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.deliveries[0].body).toEqual({});
    expect(JSON.stringify(body)).not.toMatch(/score|prompt|summarise/);
  });

  it("joins a thesis title onto a degraded row that has no sibling body", async () => {
    H.user = { id: "u-1" };
    H.theses = [{ id: THESIS, current_version: 1, user_id: "u-1" }];
    H.thesisVersions = [{
      thesis_id: THESIS,
      version: 1,
      user_id: "u-1",
      content: { title: "NVDA cycle" },
    }];
    H.deliveries = [{
      delivery_id: "deg-only",
      subscription_id: SUB,
      slot_asof: "2026-09-11",
      state: "degraded",
      degraded_reason: "stale_artifact",
      artifact_asof: null,
      body: {},
      created_at: "2026-09-11T20:10:00.000Z",
      brief_subscriptions: {
        subscription_id: SUB,
        user_id: "u-1",
        target_kind: "thesis",
        target_id: THESIS,
        cadence: "daily_after_us_close",
        state: "active",
      },
    }];
    const r = await GET_DEL(req("http://localhost/api/briefs/deliveries"));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.deliveries[0].subscription.targetName).toBe("NVDA cycle");
  });
});
