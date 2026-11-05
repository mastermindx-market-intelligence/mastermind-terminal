import { beforeEach, describe, expect, it, vi } from "vitest";
import { FOREX_WATCH_TYPE, forexConditionText } from "@/lib/forexWatches";

const H = vi.hoisted(() => ({
  user: "10000000-0000-4000-8000-000000000001" as string | null,
  rows: [] as Record<string, any>[],
  reads: [] as [string, unknown][][],
  writes: [] as { mode: string; filters: [string, unknown][]; excludeForex: boolean }[],
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  rpcResult: { data: null as any, error: null as any },
  rpcThrows: false,
  readError: null as any,
  beforeDelete: null as (() => void) | null,
}));
vi.mock("@/lib/entitlement", () => ({ isPaidTier: async () => true, isProTier: async () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: H.user ? { id: H.user } : null } }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      H.rpcCalls.push({ name, args });
      if (H.rpcThrows) throw new TypeError("response lost");
      return H.rpcResult;
    },
    from: () => {
      const filters: [string, unknown][] = [];
      let mode = "read", excludeForex = false, payload: Record<string, unknown> = {};
      const matches = () => H.rows.filter((r) => filters.every(([key, value]) => r[key] === value) &&
        (!excludeForex || r.condition?.type !== "forex_price_close"));
      const result = () => {
        if (mode === "read") {
          H.reads.push([...filters]);
          return { data: matches().map((r) => structuredClone(r)), error: H.readError };
        }
        H.writes.push({ mode, filters: [...filters], excludeForex });
        if (mode === "delete") H.beforeDelete?.();
        const found = matches();
        if (mode === "delete") H.rows = H.rows.filter((r) => !found.includes(r));
        if (mode === "update") found.forEach((r) => Object.assign(r, payload));
        if (mode === "insert") { H.rows.push(payload); return { data: [payload], error: null }; }
        return { data: found.map((r) => structuredClone(r)), error: null };
      };
      const q: any = {};
      q.select = () => q;
      q.eq = (key: string, value: unknown) => { filters.push([key, value]); return q; };
      q.or = (expression: string) => {
        expect(expression).toBe("condition->>type.is.null,condition->>type.neq.forex_price_close");
        excludeForex = true; return q;
      };
      q.order = async () => result();
      q.single = async () => {
        const r = result();
        return { data: r.data[0] ?? null, error: r.error ?? (r.data.length === 1 ? null : { code: "PGRST116" }) };
      };
      q.delete = () => { mode = "delete"; return q; };
      q.update = (value: Record<string, unknown>) => { mode = "update"; payload = value; return q; };
      q.insert = (value: Record<string, unknown>) => { mode = "insert"; payload = value; return q; };
      q.then = (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve);
      return q;
    },
  }),
}));
import { POST, PATCH, DELETE, GET } from "@/app/api/alerts/route";

const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";
const ID = "30000000-0000-4000-8000-000000000001";
const RULE = { kind: "price_close", pair: "USDJPY", quote_basis: "literal", interval: "4H",
  calendar: "fx-utc-4h/v1", operator: "lt", threshold: 149.5, consecutive: 2,
  expires_at: "2100-01-02T03:04:05.000Z", feed: null, origin_snapshot_id: "fixture-only" };
const row = (revision = 1) => ({ id: ID, user_id: A, symbol: "USDJPY", active: false,
  created_at: "2026-10-21T12:00:00Z",
  condition: { ...RULE, type: FOREX_WATCH_TYPE, schema_version: 1, condition_id: ID, revision } });
const body = (revision = 0) => ({ id: ID, expected_revision: revision, expected_user_id: A,
  symbol: "USDJPY", condition: { ...RULE, type: FOREX_WATCH_TYPE } });
const request = (method: string, value: unknown) => new Request("https://fixture.test/api/alerts",
  { method, headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
const del = (extra = "") => DELETE(new Request("https://fixture.test/api/alerts?id=" + ID + extra, { method: "DELETE" }));
const forexDelete = () => del("&type=forex_price_close&expected_revision=1&expected_user_id=" + A);

beforeEach(() => {
  H.user = A; H.rows = [row()]; H.reads = []; H.writes = []; H.rpcCalls = [];
  H.rpcResult = { data: row(), error: null }; H.rpcThrows = false; H.readError = null; H.beforeDelete = null;
});

describe("inactive Forex owner API", () => {
  it("creates with the stable ID and expected owner through the invoker RPC", async () => {
    const response = await POST(request("POST", body()));
    expect(response.status).toBe(200);
    expect((await response.json()).alert).toEqual(row());
    expect(H.rpcCalls).toEqual([{ name: "save_forex_watch",
      args: { p_id: ID, p_expected_revision: 0, p_expected_user_id: A, p_rule: RULE } }]);
    expect(H.writes).toEqual([]);
  });
  it("reads saved inactive rows without rewriting their evidence", async () => {
    expect((await (await GET()).json()).alerts).toEqual([row()]);
  });
  it("edits only through expected-revision RPC and validates the next revision", async () => {
    H.rpcResult.data = row(2);
    const response = await PATCH(request("PATCH", { ...body(1), action: "edit" }));
    expect(response.status).toBe(200);
    expect((await response.json()).alert.condition.revision).toBe(2);
    expect(H.rpcCalls[0].args.p_expected_revision).toBe(1);
    expect(H.writes).toEqual([]);
  });
  it.each([undefined, "resume"])("refuses Forex re-arm action %s without a write", async (action) => {
    const response = await PATCH(request("PATCH", { id: ID, action }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "forex_activation_unavailable", state: "unavailable" });
    expect(H.writes).toEqual([]); expect(H.rpcCalls).toEqual([]);
  });
  it("acknowledges an already inactive pause without changing revision", async () => {
    const response = await PATCH(request("PATCH", { id: ID, action: "pause" }));
    expect(response.status).toBe(200);
    expect((await response.json()).alert).toEqual(row());
    expect(H.writes).toEqual([]); expect(H.rpcCalls).toEqual([]);
  });
  it("never labels a malformed or active stored Forex row safely paused", async () => {
    H.rows[0].active = true;
    expect((await PATCH(request("PATCH", { id: ID, action: "pause" }))).status).toBe(503);
  });
  it("refuses a switched account before a save RPC", async () => {
    H.user = B;
    const response = await POST(request("POST", body()));
    expect(response.status).toBe(409);
    expect((await response.json()).state).toBe("session_changed");
    expect(H.rpcCalls).toEqual([]);
  });
  it.each([{ expected_revision: -1 }, { expected_revision: 1 }, { id: "bad" }, { expected_revision: "0" }])(
    "rejects invalid create intent %j", async (override) => {
      expect((await POST(request("POST", { ...body(), ...override }))).status).toBe(400);
      expect(H.rpcCalls).toEqual([]);
    });
  it.each([{ feed: { source: "daily" } }, { threshold: 0 }, { consecutive: 1.5 }, { operator: ["lt"] },
    { expires_at: "2100-02-30T00:00:00Z" }, { user_id: B }])("rejects invalid canonical rule %j", async (override) => {
    expect((await POST(request("POST", { ...body(), condition: { ...body().condition, ...override } }))).status).toBe(400);
    expect(H.rpcCalls).toEqual([]);
  });
  it.each(["forex_watch_revision_conflict", "forex_watch_identity_conflict"])("reports %s as conflict", async (message) => {
    H.rpcResult = { data: null, error: { code: "P0001", message } };
    const response = await POST(request("POST", body()));
    expect(response.status).toBe(409); expect((await response.json()).state).toBe("conflict");
  });
  it.each(["PGRST202", "42883", "42501"])("reports unavailable owner %s without claiming saved", async (code) => {
    H.rpcResult = { data: null, error: { code } };
    const response = await POST(request("POST", body()));
    expect(response.status).toBe(503); expect((await response.json()).state).toBe("unavailable");
  });
  it.each(["lost", "empty", "active", "wrong-owner", "wrong-revision", "wrong-rule"])(
    "keeps ambiguous save %s unconfirmed without retry", async (kind) => {
      if (kind === "lost") H.rpcThrows = true;
      if (kind === "empty") H.rpcResult.data = null;
      if (kind === "active") H.rpcResult.data.active = true;
      if (kind === "wrong-owner") H.rpcResult.data.user_id = B;
      if (kind === "wrong-revision") H.rpcResult.data.condition.revision = 2;
      if (kind === "wrong-rule") H.rpcResult.data.condition.threshold = 147;
      const response = await POST(request("POST", body()));
      expect(response.status).toBe(503); expect((await response.json()).state).toBe("unconfirmed");
      expect(H.rpcCalls).toHaveLength(1);
    });
  it("deletes with the captured account and revision", async () => {
    H.rpcResult.data = { id: ID, deleted: true };
    const response = await forexDelete();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, id: ID, deleted: true });
    expect(H.rpcCalls).toEqual([{ name: "delete_forex_watch",
      args: { p_id: ID, p_expected_revision: 1, p_expected_user_id: A } }]);
    expect(H.writes).toEqual([]);
  });
  it("refuses revision-less generic deletion of Forex", async () => {
    expect((await del()).status).toBe(409);
    expect(H.rpcCalls).toEqual([]); expect(H.writes).toEqual([]);
  });
  it("distinguishes current absence from stale account intent", async () => {
    H.rows = []; H.rpcResult.data = { id: ID, deleted: false };
    expect(await (await forexDelete()).json()).toEqual({ ok: true, id: ID, deleted: false });
    H.user = B; H.rpcCalls = [];
    expect((await forexDelete()).status).toBe(409);
    expect(H.rpcCalls).toEqual([]);
  });
  it("refuses a stale delete revision", async () => {
    H.rpcResult = { data: null, error: { message: "forex_watch_revision_conflict" } };
    const response = await forexDelete();
    expect(response.status).toBe(409); expect((await response.json()).state).toBe("conflict");
  });
  it("does not mutate after a failed ownership read", async () => {
    H.readError = { code: "08006" };
    expect((await forexDelete()).status).toBe(503);
    expect(H.rpcCalls).toEqual([]); expect(H.writes).toEqual([]);
  });
  it.each([null, {}, { id: ID }, { id: "different", deleted: true }])(
    "keeps malformed delete acknowledgement %j unconfirmed", async (data) => {
      H.rpcResult.data = data;
      expect((await (await forexDelete()).json()).state).toBe("unconfirmed");
      expect(H.rpcCalls).toHaveLength(1);
    });
  it("does not let legacy read/delete race cross into Forex or claim absence", async () => {
    H.rows[0].condition = { type: "price", value: 100 };
    H.beforeDelete = () => { H.rows = [row()]; };
    const response = await del();
    expect(response.status).toBe(409);
    expect(H.rows).toEqual([row()]);
    expect(H.writes[0].excludeForex).toBe(true);
  });
  it("preserves legacy deletion and owner/id predicates", async () => {
    H.rows[0].condition = { type: "price", value: 100 };
    expect(await (await del()).json()).toEqual({ ok: true, deleted: true });
    expect(H.writes[0]).toEqual({ mode: "delete", filters: [["user_id", A], ["id", ID]], excludeForex: true });
  });
  it("describes literal close units in both languages without raw JSON", () => {
    expect(forexConditionText(row().condition)).toBe("4H close < 149.5 · 2 consecutive closes");
    expect(forexConditionText(row().condition, "zh")).toBe("4小时收盘价 < 149.5 · 连续2次");
  });
});
