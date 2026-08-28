import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutDbResult, LayoutQuery, LayoutRow } from "@/lib/layouts";

// HTTP contract for /api/layouts. The point of these assertions is that the four facts the old
// route flattened into `200 {layouts:[]}` / `{ok:true}` now leave the server as four different
// answers: 401 (sign in), 503 (the store is down), 409 (that name is taken), 404 (nothing deleted).

const H = vi.hoisted(() => ({
  user: null as { id: string } | null,
  results: [] as LayoutDbResult[],
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    // ONE shared index across every `.from()` call this client makes — a multi-step operation
    // (e.g. `saveWorkspace`'s attempt1/attempt2/existing-check/insert) issues SEVERAL separate
    // `.from()` calls in one request, and each must consume the NEXT queued result in sequence, not
    // restart from `H.results[0]` (which is what a fresh per-call index would silently do).
    let index = 0;
    const next = (): LayoutDbResult => H.results[index++] ?? { data: [] };
    return {
      auth: { getUser: vi.fn(async () => ({ data: { user: H.user } })) },
      from: vi.fn(() => {
        const q = {
          select: () => q,
          eq: () => q,
          neq: () => q,
          is: () => q,
          order: () => q,
          insert: () => q,
          update: () => q,
          upsert: () => q,
          delete: () => q,
          maybeSingle: async () => { const r = next(); return r.error ? r : { data: (r.data as LayoutRow[] | undefined)?.[0] ?? null }; },
          then: (resolve: (v: LayoutDbResult) => unknown) => Promise.resolve(next()).then(resolve),
        } as unknown as LayoutQuery;
        return q;
      }),
    };
  }),
}));

import { DELETE, GET, POST } from "@/app/api/layouts/route";

const OUTAGE: LayoutDbResult = { error: { code: "XX000", message: "connection reset" } };

const post = (body: Record<string, unknown>) => POST(new Request("https://x.test/api/layouts", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}));
const del = (id?: string) => DELETE(new Request(`https://x.test/api/layouts${id ? `?id=${id}` : ""}`, { method: "DELETE" }));

beforeEach(() => { H.user = { id: "user-1" }; H.results = []; vi.clearAllMocks(); });

describe("GET /api/layouts", () => {
  it("refuses a guest with 401 rather than an empty library", async () => {
    H.user = null;
    const r = await GET();
    expect(r.status).toBe(401);
    await expect(r.json()).resolves.toEqual({ error: "unauthenticated" });
  });

  it("reports a store failure as 503, not 200 []", async () => {
    H.results = [OUTAGE];
    const r = await GET();
    expect(r.status).toBe(503);
    await expect(r.json()).resolves.toEqual({ error: "layouts_unavailable" });
  });

  it("returns an authoritative empty list as 200", async () => {
    H.results = [{ data: [] }];
    const r = await GET();
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ layouts: [] });
  });
});

describe("POST /api/layouts", () => {
  it("401s a guest", async () => {
    H.user = null;
    expect((await post({ name: "Swing", config: {} })).status).toBe(401);
  });

  it("400s an unusable name", async () => {
    const r = await post({ name: "  ", config: {} });
    expect(r.status).toBe(400);
    await expect(r.json()).resolves.toEqual({ error: "invalid_name" });
  });

  it("400s a body that is not JSON", async () => {
    const r = await POST(new Request("https://x.test/api/layouts", { method: "POST", body: "not json" }));
    expect(r.status).toBe(400);
  });

  it("503s a failed write instead of claiming ok", async () => {
    H.results = [OUTAGE];
    const r = await post({ name: "Swing", config: {} });
    expect(r.status).toBe(503);
    await expect(r.json()).resolves.toEqual({ error: "layouts_unavailable" });
  });

  it("409s a create onto a taken name so auto-naming can step past it", async () => {
    H.results = [{ data: [{ id: "existing" }] }];
    const r = await post({ name: "Layout 3", config: {}, mode: "create" });
    expect(r.status).toBe(409);
    await expect(r.json()).resolves.toEqual({ error: "name_taken" });
  });

  it("200s a real write", async () => {
    H.results = [{ data: [{ id: "L1" }] }];
    const r = await post({ name: "Swing", config: {} });
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ ok: true, id: "L1" });
  });

  it("reviewer ruling B3 (hostile review's P3): refuses a legacy save whose config is ALREADY a workspace envelope, rather than blind-upserting over it", async () => {
    // Contract §4 forbids a blind upsert of a `workspace_layout.v1` payload — only the revision-
    // fenced `save_workspace` op may write one. A legacy/naive client (or the reviewer's own P3
    // probe) sending `{name, config}` where `config.schema` is ALREADY the workspace schema must be
    // refused BEFORE `saveLayout` ever runs. Queuing `OUTAGE` as the only scripted DB response is
    // the tripwire: if the guard did NOT short-circuit, `saveLayout` would consume it and this test
    // would observe a 503, not the 400 asserted below — so a 400 here proves zero DB calls were
    // made, and therefore whatever is actually stored (e.g. a real revision-7 row) cannot have been
    // touched.
    H.results = [OUTAGE];
    const r = await post({
      name: "Swing",
      config: {
        schema: "workspace_layout.v1",
        requires: { floor: 1 },
        revision: 7,
        name: "Swing",
        link_groups: {},
        widgets: [],
        migration: { source: "none", source_revision: null },
      },
    });
    expect(r.status).toBe(400);
    await expect(r.json()).resolves.toEqual({ error: "malformed_workspace" });
  });
});

describe("DELETE /api/layouts", () => {
  it("401s a guest", async () => {
    H.user = null;
    expect((await del("L1")).status).toBe(401);
  });

  it("503s a failed delete instead of claiming ok", async () => {
    H.results = [OUTAGE];
    const r = await del("L1");
    expect(r.status).toBe(503);
    await expect(r.json()).resolves.toEqual({ error: "layouts_unavailable" });
  });

  it("404s when nothing was deleted", async () => {
    H.results = [{ data: [] }];
    expect((await del("L1")).status).toBe(404);
    expect((await del()).status).toBe(404);
  });

  it("200s a real delete", async () => {
    H.results = [{ data: [{ id: "L1" }] }];
    const r = await del("L1");
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ ok: true });
  });
});

// ── W2-A workspace ops (contract §8 status contract) ───────────────────────────────────────────
// These prove the HTTP mapping — status code + error string per outcome, guest 401, and that the
// server never trusts a client-supplied envelope. The atomicity/CAS behaviour itself is proven
// against the real fixture store in `workspacePersistence.test.ts`; this file only proves the
// route's dispatch and status-code contract.

const VALID_ENVELOPE = {
  schema: "workspace_layout.v1",
  requires: { floor: 1 },
  revision: 1,
  name: null,
  link_groups: { primary_security: { entity_type: "security" } },
  widgets: [
    {
      id: "chart-main", type: "chart", semantic_lane: "primary",
      context_in: ["primary_security"], context_out: ["primary_security"],
      config: {},
    },
  ],
  migration: { source: "none", source_revision: null },
};

describe("POST /api/layouts — op: save_workspace", () => {
  it("401s a guest", async () => {
    H.user = null;
    const r = await post({ op: "save_workspace", name: "Swing", envelope: VALID_ENVELOPE, expectedRevision: null });
    expect(r.status).toBe(401);
  });

  it("400s a hostile envelope instead of trusting the client (unknown top-level key)", async () => {
    const hostile = { ...VALID_ENVELOPE, extra_field: "nope" };
    const r = await post({ op: "save_workspace", name: "Swing", envelope: hostile, expectedRevision: null });
    expect(r.status).toBe(400);
    await expect(r.json()).resolves.toEqual({ error: "malformed_workspace" });
  });

  it("400s a non-object envelope", async () => {
    const r = await post({ op: "save_workspace", name: "Swing", envelope: "not-an-object", expectedRevision: null });
    expect(r.status).toBe(400);
  });

  it("400s a malformed expectedRevision", async () => {
    const r = await post({ op: "save_workspace", name: "Swing", envelope: VALID_ENVELOPE, expectedRevision: "three" });
    expect(r.status).toBe(400);
    await expect(r.json()).resolves.toEqual({ error: "malformed_workspace" });
  });

  it("200s a create (no prior row, no legacy row to migrate)", async () => {
    // attempt1 (is-null guard): 0 rows · attempt2 (neq guard): 0 rows · existing check: none · insert: ok
    H.results = [{ data: [] }, { data: [] }, { data: [] }, { data: [{ id: "L1" }] }];
    const r = await post({ op: "save_workspace", name: "Swing", envelope: VALID_ENVELOPE, expectedRevision: null });
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ ok: true, id: "L1", revision: 1 });
  });

  it("200s an ordinary revisioned save-over", async () => {
    H.results = [{ data: [{ id: "L1" }] }];
    const r = await post({ op: "save_workspace", name: "Swing", envelope: VALID_ENVELOPE, expectedRevision: 3 });
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ ok: true, id: "L1", revision: 4 });
  });

  it("409s a stale revision (0 rows updated, row still present)", async () => {
    H.results = [{ data: [] }, { data: [{ id: "L1" }] }];
    const r = await post({ op: "save_workspace", name: "Swing", envelope: VALID_ENVELOPE, expectedRevision: 3 });
    expect(r.status).toBe(409);
    await expect(r.json()).resolves.toEqual({ error: "stale_revision" });
  });

  it("404s not_found (0 rows updated, row gone)", async () => {
    H.results = [{ data: [] }, { data: [] }];
    const r = await post({ op: "save_workspace", name: "Swing", envelope: VALID_ENVELOPE, expectedRevision: 3 });
    expect(r.status).toBe(404);
    await expect(r.json()).resolves.toEqual({ error: "not_found" });
  });

  it("409s a name_conflict on create (insert loses the unique-index race)", async () => {
    const UNIQUE_VIOLATION: LayoutDbResult = { error: { code: "23505", message: "duplicate" } };
    H.results = [{ data: [] }, { data: [] }, { data: [] }, UNIQUE_VIOLATION];
    const r = await post({ op: "save_workspace", name: "Swing", envelope: VALID_ENVELOPE, expectedRevision: null });
    expect(r.status).toBe(409);
    await expect(r.json()).resolves.toEqual({ error: "name_conflict" });
  });

  it("503s store_unavailable — the WORKSPACE vocabulary, distinct from the legacy string", async () => {
    H.results = [OUTAGE];
    const r = await post({ op: "save_workspace", name: "Swing", envelope: VALID_ENVELOPE, expectedRevision: 3 });
    expect(r.status).toBe(503);
    await expect(r.json()).resolves.toEqual({ error: "store_unavailable" });
  });
});

describe("POST /api/layouts — op: rename", () => {
  it("401s a guest", async () => {
    H.user = null;
    const r = await post({ op: "rename", oldName: "Swing", newName: "Swing 2", expectedRevision: 1 });
    expect(r.status).toBe(401);
  });

  it("400s a malformed expectedRevision", async () => {
    const r = await post({ op: "rename", oldName: "Swing", newName: "Swing 2", expectedRevision: null });
    expect(r.status).toBe(400);
  });

  it("404s when the source row is gone", async () => {
    H.results = [{ data: [] }];
    const r = await post({ op: "rename", oldName: "Swing", newName: "Swing 2", expectedRevision: 1 });
    expect(r.status).toBe(404);
    await expect(r.json()).resolves.toEqual({ error: "not_found" });
  });

  it("200s an ordinary rename", async () => {
    H.results = [
      { data: [{ id: "L1", config: { schema: "workspace_layout.v1", revision: 1 } }] },
      { data: [{ id: "L1" }] },
    ];
    const r = await post({ op: "rename", oldName: "Swing", newName: "Swing 2", expectedRevision: 1 });
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ ok: true, revision: 2 });
  });

  it("409s a name_conflict", async () => {
    H.results = [
      { data: [{ id: "L1", config: { schema: "workspace_layout.v1", revision: 1 } }] },
      { error: { code: "23505", message: "duplicate" } },
    ];
    const r = await post({ op: "rename", oldName: "Swing", newName: "Taken", expectedRevision: 1 });
    expect(r.status).toBe(409);
    await expect(r.json()).resolves.toEqual({ error: "name_conflict" });
  });
});

describe("POST /api/layouts — op: duplicate", () => {
  it("401s a guest", async () => {
    H.user = null;
    const r = await post({ op: "duplicate", sourceName: "Swing" });
    expect(r.status).toBe(401);
  });

  it("404s when the source row is gone", async () => {
    H.results = [{ data: [] }];
    const r = await post({ op: "duplicate", sourceName: "Swing" });
    expect(r.status).toBe(404);
    await expect(r.json()).resolves.toEqual({ error: "not_found" });
  });

  it("200s an ordinary duplicate with an explicit name", async () => {
    H.results = [
      { data: [{ id: "L1", name: "Swing", config: { schema: "workspace_layout.v1", revision: 3 } }] },
      { data: [{ id: "L2" }] },
    ];
    const r = await post({ op: "duplicate", sourceName: "Swing", newName: "Swing copy" });
    expect(r.status).toBe(200);
    await expect(r.json()).resolves.toEqual({ ok: true, id: "L2", name: "Swing copy" });
  });
});

describe("GET /api/layouts — rowState", () => {
  it("marks a valid workspace row ok and an unreadable one, without hiding either", async () => {
    H.results = [{
      data: [
        { id: "a", name: "Swing", config: VALID_ENVELOPE, updated_at: "2026-08-19T00:00:00Z" },
        { id: "b", name: "Old", config: { schema: "workspace_layout.v2" }, updated_at: "2026-08-19T00:00:00Z" },
      ],
    }];
    const r = await GET();
    expect(r.status).toBe(200);
    const body = (await r.json()) as { layouts: Array<{ id: string; rowState: string }> };
    expect(body.layouts.find((l) => l.id === "a")?.rowState).toBe("ok");
    expect(body.layouts.find((l) => l.id === "b")?.rowState).toBe("unsupported_schema");
  });
});
