import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_ROUTE_MESSAGES } from "@/lib/teams";

const TEAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN = "22222222-2222-4222-8222-222222222222";

const H = vi.hoisted(() => ({
  user: null as { id: string } | null,
  rpcResult: { data: [] as unknown, error: null as { code?: string; message?: string } | null },
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: H.user } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      H.rpcCalls.push({ fn, args });
      return H.rpcResult;
    },
  }),
}));

describe("POST /api/teams/[id]/transfer-ownership", () => {
  let POST: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

  beforeEach(async () => {
    vi.resetModules();
    H.user = { id: "11111111-1111-4111-8111-111111111111" };
    H.rpcResult = { data: [], error: null };
    H.rpcCalls = [];
    ({ POST } = await import("@/app/api/teams/[id]/transfer-ownership/route"));
  });

  function req(body: unknown) {
    return new Request(`http://localhost/api/teams/${TEAM}/transfer-ownership`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  function ctx(id = TEAM) {
    return { params: Promise.resolve({ id }) };
  }

  it("401 when signed out", async () => {
    H.user = null;
    const res = await POST(req({ newOwnerUserId: ADMIN }), ctx());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.message).toBe(TEAM_ROUTE_MESSAGES.not_signed_in[0]);
    expect(body.messageZh).toBe(TEAM_ROUTE_MESSAGES.not_signed_in[1]);
    expect(H.rpcCalls).toEqual([]);
  });

  it("400 when newOwnerUserId is not a UUID", async () => {
    const res = await POST(req({ newOwnerUserId: "not-a-uuid" }), ctx());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe(TEAM_ROUTE_MESSAGES.invalid_user_id[0]);
    expect(H.rpcCalls).toEqual([]);
  });

  it("400 when the team path id is not a UUID, with the team-id sentence", async () => {
    const res = await POST(req({ newOwnerUserId: ADMIN }), ctx("not-a-team"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe(TEAM_ROUTE_MESSAGES.invalid_team_id[0]);
    expect(body.messageZh).toBe(TEAM_ROUTE_MESSAGES.invalid_team_id[1]);
    expect(body.message).not.toBe(TEAM_ROUTE_MESSAGES.invalid_user_id[0]);
    expect(H.rpcCalls).toEqual([]);
  });

  it("relays a successful function result as 200 with the mapped sentence", async () => {
    H.rpcResult = { data: [{ success: true, message: "transfer_success" }], error: null };
    const res = await POST(req({ newOwnerUserId: ADMIN }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.newOwnerId).toBe(ADMIN);
    expect(body.message).toBe(TEAM_ROUTE_MESSAGES.transfer_success[0]);
    expect(body.messageZh).toBe(TEAM_ROUTE_MESSAGES.transfer_success[1]);
    expect(H.rpcCalls[0]?.fn).toBe("transfer_team_ownership");
    expect(H.rpcCalls[0]?.args).toEqual({ p_team: TEAM, p_new_owner_user_id: ADMIN });
  });

  it("10. a zero-row rpc result is 403, never 200", async () => {
    H.rpcResult = { data: [], error: null };
    const res = await POST(req({ newOwnerUserId: ADMIN }), ctx());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toBe(TEAM_ROUTE_MESSAGES.unavailable[0]);
    expect(body.messageZh).toBe(TEAM_ROUTE_MESSAGES.unavailable[1]);
  });

  it("409 for conflict", async () => {
    H.rpcResult = { data: [{ success: false, message: "conflict" }], error: null };
    const res = await POST(req({ newOwnerUserId: ADMIN }), ctx());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toBe(TEAM_ROUTE_MESSAGES.conflict[0]);
    expect(body.messageZh).toBe(TEAM_ROUTE_MESSAGES.conflict[1]);
  });

  it("403 for owner_only and transfer_requires_admin; 404 for team_not_found and not_on_team", async () => {
    H.rpcResult = { data: [{ success: false, message: "owner_only" }], error: null };
    expect((await POST(req({ newOwnerUserId: ADMIN }), ctx())).status).toBe(403);

    H.rpcResult = { data: [{ success: false, message: "transfer_requires_admin" }], error: null };
    expect((await POST(req({ newOwnerUserId: ADMIN }), ctx())).status).toBe(403);

    H.rpcResult = { data: [{ success: false, message: "team_not_found" }], error: null };
    expect((await POST(req({ newOwnerUserId: ADMIN }), ctx())).status).toBe(404);

    H.rpcResult = { data: [{ success: false, message: "not_on_team" }], error: null };
    expect((await POST(req({ newOwnerUserId: ADMIN }), ctx())).status).toBe(404);
  });

  it("does not re-gate: it calls the function even when the helper could have guessed the caller is not owner", async () => {
    H.rpcResult = { data: [{ success: false, message: "owner_only" }], error: null };
    await POST(req({ newOwnerUserId: ADMIN }), ctx());
    expect(H.rpcCalls).toHaveLength(1);
  });
});
