import { beforeEach, describe, expect, it, vi } from "vitest";
import { D, T, U, H, E, review, committed } from "./briefDeliverySharing.fixture";
const state = vi.hoisted(() => ({ users: [] as Array<string | null>, data: null as unknown,
  error: null as { code?: string } | null, throwRpc: false,
  calls: [] as Array<{ name: string; args: Record<string, string> }> }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: (() => {
    const id = state.users.shift(); return id ? { id } : null;
  })() }, error: null }) },
  rpc: async (name: string, args: Record<string, string>) => {
    state.calls.push({ name, args });
    if (state.throwRpc) throw new Error("PRIVATE_TRANSPORT_FAILURE");
    return { data: state.data, error: state.error };
  },
}) }));
import { GET, POST } from "../../app/api/briefs/deliveries/[deliveryId]/sharing/route";
import { GET as sharedGET } from "../../app/api/briefs/shared/[deliveryId]/route";
const origin = "https://app.mastermind-x.com";
const path = `${origin}/api/briefs/deliveries/${D}/sharing`;
const context = () => ({ params: Promise.resolve({ deliveryId: D }) });
const command = () => ({ team_id: T, expected_content_sha256: H, expected_effect_sha256: E });
const post = (body = JSON.stringify(command()), extra: Record<string, string> = {}) =>
  new Request(path, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...extra }, body });
beforeEach(() => { state.users = [U, U]; state.data = review(); state.error = null;
  state.throwRpc = false; state.calls = []; });

describe("actual Terminal authenticated brief sharing BFF", () => {
  it("uses only the session-bound exact owner RPC and private no-store response", async () => {
    const response = await GET(new Request(`${path}?team_id=${T}`), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).schema).toBe("mastermind.brief_delivery_sharing.v1");
    expect(state.calls).toEqual([{ name: "read_brief_delivery_sharing", args: { p_delivery_id: D, p_team_id: T } }]);
  });
  it("does not invoke any RPC for a signed-out caller", async () => {
    state.users = [null];
    expect((await GET(new Request(`${path}?team_id=${T}`), context())).status).toBe(401);
    expect(state.calls).toEqual([]);
  });
  it.each([`team_id=${T}&team_id=${T}`, `team_id=${T}&expected_effect_sha256=${E}`,
    `target=${T}`, `team_id=${T}&actor=${U}`])("rejects ambiguous query %s", async query => {
    expect((await GET(new Request(`${path}?${query}`), context())).status).toBe(400);
    expect(state.calls).toEqual([]);
  });
  it("submits once and verifies the actual sharing principal in the owner response", async () => {
    state.data = committed();
    const response = await POST(post(), context());
    expect(response.status).toBe(200);
    expect(state.calls).toEqual([{ name: "share_brief_delivery", args: {
      p_delivery_id: D, p_team_id: T, p_expected_content_sha256: H, p_expected_effect_sha256: E,
    } }]);
  });
  it.each(["throw", "malformed", "auth_changed", "foreign_actor"])("holds original recovery after possible send: %s", async fault => {
    state.data = committed();
    if (fault === "throw") state.throwRpc = true;
    if (fault === "malformed") state.data = { raw: "PRIVATE_CANARY" };
    if (fault === "auth_changed") state.users = [U, null];
    if (fault === "foreign_actor") state.data = { ...committed(), grant: { ...committed().grant!, shared_by: "10000000-0000-4000-8000-000000000002" } };
    const response = await POST(post(), context()), body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toEqual({ ok: false, code: "effect_unknown", reference: { delivery_id: D, expected_effect_sha256: E } });
    expect(state.calls).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("PRIVATE_CANARY");
  });
  it("withholds a readonly response after identity revocation", async () => {
    state.users = [U, null];
    const response = await GET(new Request(`${path}?team_id=${T}`), context());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, code: "denied" });
    expect(state.calls).toHaveLength(1);
  });
  it("rejects cross-origin, duplicate-key and oversized streams before any effect", async () => {
    expect((await POST(post(undefined, { Origin: "https://foreign.example" }), context())).status).toBe(403);
    const duplicated = JSON.stringify(command()).replace('"team_id":', `"team_id":"${T}","team_id":`);
    expect((await POST(post(duplicated), context())).status).toBe(400);
    expect((await POST(post(" ".repeat(16384) + JSON.stringify(command()), { "Content-Length": "0" }), context())).status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });
  it("reads only the exact original receipt and never calls the mutation for recovery", async () => {
    state.data = { schema: "mastermind.brief_delivery_sharing_receipt.v1", delivery_id: D,
      expected_effect_sha256: E, observation: "NOT_OBSERVED", grant: null, current_access: false };
    const response = await GET(new Request(`${path}?expected_effect_sha256=${E}`), context());
    expect(response.status).toBe(200);
    expect((await response.json()).observation).toBe("NOT_OBSERVED");
    expect(state.calls).toEqual([{ name: "reconcile_brief_delivery_sharing", args: { p_delivery_id: D, p_expected_effect_sha256: E } }]);
  });
  it("exposes only fixed redacted member content", async () => {
    const original = review(), { market_read, monitors, artifact } = original.delivery.body;
    state.data = { schema: "mastermind.shared_brief_delivery.v1", delivery: {
      ...original.delivery, body: { market_read, monitors, artifact } }, audience: original.audience };
    const response = await sharedGET(new Request(`${origin}/api/briefs/shared/${D}`), context());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body.delivery.body).sort()).toEqual(["artifact", "market_read", "monitors"]);
    expect(JSON.stringify(body)).not.toContain("private-target");
    expect(state.calls.map(call => call.name)).toEqual(["read_shared_brief_delivery"]);
  });
});
