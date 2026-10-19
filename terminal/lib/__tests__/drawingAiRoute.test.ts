import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/drawings/route";
import { storeAiDrawing, readStoredAiDrawing } from "../drawingAiPersistence";
import type { Drawing } from "../drawings";
import type { AiObject } from "../chartBus";

const db = vi.hoisted(() => ({
  user: { id: "uuid-a" } as { id: string } | null,
  rows: [] as Array<{ id: string; kind: string; user_id: string; symbol: string; data: Record<string, unknown> }>,
  serial: 0, writes: 0, fail: "" as "" | "read" | "insert" | "delete",
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: db.user } }) },
    from: () => ({
      select: () => {
        const filters: Record<string, unknown> = {};
        const query = {
          eq: (key: string, value: unknown) => { filters[key] = value; return query; },
          order: async () => ({ data: db.rows.filter(row => Object.entries(filters)
            .every(([key, value]) => row[key as keyof typeof row] === value)), error: db.fail === "read" ? "read failed" : null }),
        };
        return query;
      },
      insert: (row: Omit<(typeof db.rows)[number], "id">) => ({
        select: async () => {
          db.writes++;
          if (db.fail === "insert") return { data: null, error: "insert failed" };
          const id = "row-" + (++db.serial);
          db.rows.push({ ...row, id });
          return { data: [{ id }], error: null };
        },
      }),
      delete: () => ({
        in: (_key: string, ids: string[]) => ({
          eq: async (_ownerKey: string, owner: string) => {
            if (db.fail === "delete") { db.fail = ""; return { error: "delete failed" }; }
            db.rows = db.rows.filter(row => !ids.includes(row.id) || row.user_id !== owner);
            return { error: null };
          },
        }),
      }),
    }),
  }),
}));
const human: Drawing = { id: "manual", kind: "hline", source: "user", points: [{ t: "2026-01-01", p: 100 }] };
const ai = (id = "ai_saved"): Drawing => storeAiDrawing({
  id, source: "ai", kind: "fib", points: [{ t: "1767225600", p: 80 }, { t: "1769817600", p: 120 }],
  by: "ai", command_id: id, op: "draw.tool", batch_id: "saved-batch", seq: 1,
  hidden: true, caption: "Existing retracement", meta: { fibReverse: true },
} as AiObject, true);
const put = (body: Record<string, unknown>) => PUT(new Request("http://localhost/api/drawings", {
  method: "PUT", body: JSON.stringify({ symbol: "NVDA", ...(body.aiSchemaVersion === 1 ? { owner_id: "uuid-a" } : {}), ...body }),
}));
const load = (owner = "uuid-a") => GET(new Request("http://localhost/api/drawings?symbol=NVDA&owner_id=" + owner));
const seed = (drawings: Drawing[], owner = "uuid-a") => db.rows.push({
  id: "seed-" + owner, kind: "__collection_v1", user_id: owner, symbol: "NVDA", data: { drawings },
});

beforeEach(() => { db.user = { id: "uuid-a" }; db.rows = []; db.serial = 0; db.writes = 0; db.fail = ""; });

describe("account drawing API source partitions", () => {
  it("saves and reloads the complete mixed collection with an explicit persistence receipt", async () => {
    const response = await put({ drawings: [human, ai()], aiSchemaVersion: 1, owner_id: "uuid-a" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, count: 2, aiSchemaVersion: 1, owner_id: "uuid-a" });
    const loaded = await (await load()).json();
    expect(loaded.drawings.map((d: Drawing) => d.id)).toEqual(["manual", "ai_saved"]);
    expect(readStoredAiDrawing(loaded.drawings[1])).toMatchObject({
      command_id: "ai_saved", batch_id: "saved-batch", hidden: true, meta: { fibReverse: true },
    });
  });

  it("preserves the AI partition for a sequential legacy manual replacement and empty tombstone", async () => {
    seed([human, ai()]);
    expect((await put({ drawings: [{ ...human, id: "replacement" }] })).status).toBe(200);
    expect((await (await load()).json()).drawings.map((d: Drawing) => d.id)).toEqual(["replacement", "ai_saved"]);
    expect((await put({ drawings: [] })).status).toBe(200);
    expect((await (await load()).json()).drawings.map((d: Drawing) => d.id)).toEqual(["ai_saved"]);
    expect((await put({ drawings: [], aiSchemaVersion: 1, owner_id: "uuid-a" })).status).toBe(200);
    expect((await (await load()).json()).drawings).toEqual([]);
  });

  it("scopes reads to the authenticated UUID and fails closed on a stale expected owner or expired login", async () => {
    seed([human]);
    seed([{ ...human, id: "other-account" }], "uuid-b");
    expect((await (await load()).json()).drawings).toHaveLength(1);
    expect((await load("uuid-b")).status).toBe(409);
    expect((await put({ drawings: [ai()], aiSchemaVersion: 1, owner_id: "uuid-b" })).status).toBe(409);
    db.user = null;
    expect((await load()).status).toBe(401);
    expect((await GET(new Request("http://localhost/api/drawings?symbol=NVDA"))).status).toBe(200);
    expect(db.writes).toBe(0);
  });

  it("requires an expected authenticated owner on every explicit mixed write", async () => {
    seed([human, ai()]);
    const response = await PUT(new Request("http://localhost/api/drawings", {
      method: "PUT", body: JSON.stringify({ symbol: "NVDA", aiSchemaVersion: 1, drawings: [] }),
    }));
    expect(response.status).toBe(409);
    expect(db.writes).toBe(0);
    expect((await (await load()).json()).drawings).toHaveLength(2);
  });

  it.each([null, [], "", " uuid-a "])("rejects a supplied malformed principal %j", async owner => {
    expect((await put({ drawings: [], aiSchemaVersion: 1, owner_id: owner })).status).toBe(409);
    expect(db.writes).toBe(0);
  });

  it.each([null, 0, 2, "1"])("does not downgrade unsupported explicit AI schema %j to legacy semantics", async version => {
    seed([human, ai()]);
    expect((await put({ drawings: [], aiSchemaVersion: version })).status).toBe(422);
    expect(db.writes).toBe(0);
  });

  it.each([
    (d: Drawing) => ({ ...d, source: ["ai"] }),
    (d: Drawing) => ({ ...d, source: "user" }),
    (d: Drawing) => ({ ...d, source: undefined, id: "ordinary" }),
    (d: Drawing) => ({ ...d, meta: { ...d.meta, chart_ai: { ...(d.meta!.chart_ai as object), op: "chart.set_symbol" } } }),
    (d: Drawing) => ({ ...d, points: [...d.points, { t: "bad", p: null }] }),
  ])("rejects a malformed mixed object before replacing the last good save", async change => {
    seed([human, ai()]);
    expect((await put({ drawings: [human, change(ai())], aiSchemaVersion: 1 })).status).toBe(422);
    expect(db.writes).toBe(0);
    expect((await (await load()).json()).drawings).toHaveLength(2);
  });

  it("rejects normalized reserved-ID conflicts and a coercible array time without losing anchors", async () => {
    seed([human, ai()]);
    expect((await put({ drawings: [{ ...human, id: " ai_reserved" }], aiSchemaVersion: 1 })).status).toBe(422);
    const malformed = { ...ai(), kind: "polyline", points: [
      { t: "1700000000", p: 100 }, { t: [1700000600], p: 105 }, { t: "1700001200", p: 110 },
    ] };
    expect((await put({ drawings: [malformed], aiSchemaVersion: 1 })).status).toBe(422);
    expect(db.writes).toBe(0);
  });

  it("validates caps and duplicate IDs after preserving the legacy opposite partition", async () => {
    seed([ai()]);
    const crowded = Array.from({ length: 500 }, (_, i) => ({ ...human, id: "manual-" + i }));
    expect((await put({ drawings: crowded })).status).toBe(413);
    expect((await put({ drawings: Array.from({ length: 61 }, (_, i) => ai("ai_" + i)), aiSchemaVersion: 1 })).status).toBe(413);
    expect((await put({ drawings: [human, { ...human }], aiSchemaVersion: 1 })).status).toBe(422);
    expect(db.writes).toBe(0);
  });

  it.each(["read", "insert", "delete"] as const)("preserves the last good collection when %s fails", async stage => {
    seed([human, ai()]);
    db.fail = stage;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await put({ drawings: [human], aiSchemaVersion: 1 })).status).toBe(500);
      db.fail = "";
      expect((await (await load()).json()).drawings.map((d: Drawing) => d.id)).toEqual(["manual", "ai_saved"]);
    } finally { spy.mockRestore(); }
  });
});
