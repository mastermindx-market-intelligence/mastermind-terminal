import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseHolder: { client: any } = { client: null };
let paid = true;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseHolder.client,
}));

vi.mock("@/lib/entitlement", () => ({
  isPaidTier: async () => paid,
}));

import { POST } from "@/app/api/scripts/save/route";
import { nextSavedAtIso } from "@/lib/savedScriptStamp";

type EqCall = [string, unknown];

function mockClient(opts: {
  user?: { id: string } | null;
  update?: { data: { id: string; updated_at: string } | null; error: any };
  insert?: { data: { id: string; updated_at: string } | null; error: any };
}) {
  const eqs: EqCall[] = [];
  let updatePayload: Record<string, unknown> | undefined;
  let insertPayload: Record<string, unknown> | undefined;
  let selectArg: string | undefined;
  const updateChain: any = {
    eq(k: string, v: unknown) {
      eqs.push([k, v]);
      return updateChain;
    },
    select(cols: string) {
      selectArg = cols;
      return updateChain;
    },
    maybeSingle() {
      return Promise.resolve(opts.update ?? { data: null, error: null });
    },
    single() {
      return Promise.resolve(opts.update ?? { data: null, error: { message: "0 rows" } });
    },
  };
  const insertChain: any = {
    select(cols: string) {
      selectArg = cols;
      return insertChain;
    },
    single() {
      return Promise.resolve(opts.insert ?? { data: { id: "new-1", updated_at: "2026-10-06T12:00:00.000Z" }, error: null });
    },
  };
  const from = vi.fn((table: string) => ({
    table,
    update(payload: Record<string, unknown>) {
      updatePayload = payload;
      return updateChain;
    },
    insert(payload: Record<string, unknown>) {
      insertPayload = payload;
      return insertChain;
    },
    select() {
      throw new Error("save route must not pre-read rows");
    },
  }));
  supabaseHolder.client = {
    auth: {
      getUser: async () => ({ data: { user: opts.user === undefined ? { id: "user-1" } : opts.user } }),
    },
    from,
  };
  return {
    eqs,
    from,
    getUpdatePayload: () => updatePayload,
    getInsertPayload: () => insertPayload,
    getSelectArg: () => selectArg,
  };
}

function req(body: unknown) {
  return new Request("http://localhost/api/scripts/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/scripts/save CAS", () => {
  beforeEach(() => {
    paid = true;
    supabaseHolder.client = null;
  });

  it("401 when unauthenticated", async () => {
    mockClient({ user: null });
    const res = await POST(req({ id: "s1", name: "A", source: "x", expected_updated_at: "2026-10-06T12:00:00.000Z" }));
    expect(res.status).toBe(401);
  });

  it("403 when not paid", async () => {
    paid = false;
    mockClient({});
    const res = await POST(req({ id: "s1", name: "A", source: "x", expected_updated_at: "2026-10-06T12:00:00.000Z" }));
    expect(res.status).toBe(403);
  });

  it("rejects malformed expected_updated_at on update", async () => {
    const m = mockClient({});
    for (const bad of [undefined, "", "not-a-date", 99, "2026-10-06", "October 6, 2026"]) {
      const res = await POST(req({ id: "s1", name: "A", source: "plot(close)", expected_updated_at: bad }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/malformed/i);
    }
    expect(m.from).not.toHaveBeenCalled();
  });

  it("updates with exact expected token, monotonic next stamp, owner filters, and actual receipt", async () => {
    const expected = "2026-10-06T12:00:00.000Z";
    const nowMs = Date.parse(expected) + 250;
    vi.spyOn(Date, "now").mockReturnValue(nowMs);
    const receipt = { id: "s1", updated_at: "2026-10-06T12:00:00.250Z" };
    const m = mockClient({ update: { data: receipt, error: null } });

    const res = await POST(req({
      id: "s1",
      name: "My Momentum",
      source: "plot(close * 2)",
      params: { len: 14 },
      expected_updated_at: expected,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, id: "s1", updated_at: receipt.updated_at });

    expect(m.from).toHaveBeenCalledWith("saved_scripts");
    expect(m.getSelectArg()).toBe("id, updated_at");
    expect(m.eqs).toEqual([
      ["id", "s1"],
      ["user_id", "user-1"],
      ["updated_at", expected],
    ]);
    const payload = m.getUpdatePayload()!;
    expect(payload.name).toBe("My Momentum");
    expect(payload.source).toBe("plot(close * 2)");
    expect(payload.params).toEqual({ len: 14 });
    expect(payload.updated_at).toBe(nextSavedAtIso(expected, nowMs));
    expect(payload.updated_at).toBe(new Date(nowMs).toISOString());
  });

  it("next stamp is expected+1ms when now is not later", async () => {
    const expected = "2026-10-06T12:00:00.000Z";
    const expectedMs = Date.parse(expected);
    vi.spyOn(Date, "now").mockReturnValue(expectedMs - 10);
    const next = nextSavedAtIso(expected, expectedMs - 10)!;
    const m = mockClient({ update: { data: { id: "s1", updated_at: next }, error: null } });
    const res = await POST(req({
      id: "s1", name: "A", source: "x", expected_updated_at: expected,
    }));
    expect(res.status).toBe(200);
    expect(m.getUpdatePayload()!.updated_at).toBe(new Date(expectedMs + 1).toISOString());
    const body = await res.json();
    expect(body.updated_at).toBe(next);
    expect(body.id).toBe("s1");
  });

  it("returns 409 when the expected token does not match (zero rows)", async () => {
    mockClient({ update: { data: null, error: null } });
    const res = await POST(req({
      id: "s1", name: "A", source: "x", expected_updated_at: "2026-10-06T12:00:00.000Z",
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("conflict");
  });

  it("inserts without CAS when id is omitted and returns id+updated_at", async () => {
    const m = mockClient({
      insert: { data: { id: "new-9", updated_at: "2026-10-06T13:00:00.000Z" }, error: null },
    });
    const res = await POST(req({ name: "Fresh", source: "plot(1)", lang: "pine", params: {} }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true, id: "new-9", updated_at: "2026-10-06T13:00:00.000Z",
    });
    expect(m.getInsertPayload()).toMatchObject({
      user_id: "user-1", name: "Fresh", source: "plot(1)", lang: "pine",
    });
    expect(m.eqs).toEqual([]);
  });

  it("does not read other users' rows on a CAS miss", async () => {
    const m = mockClient({ update: { data: null, error: null } });
    await POST(req({
      id: "someone-elses", name: "A", source: "x", expected_updated_at: "2026-10-06T12:00:00.000Z",
    }));
    expect(m.from).toHaveBeenCalledTimes(1);
    expect(m.eqs.map(([k]) => k)).toEqual(["id", "user_id", "updated_at"]);
  });
});
