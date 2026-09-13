import { beforeEach, describe, expect, it, vi } from "vitest";
import { INVITE_MESSAGES } from "@/lib/teams";

// vi.hoisted + vi.mock("@/lib/supabase/server") mirrors teamsRoute.test.ts / PR #502's idiom.
const H = vi.hoisted(() => ({ user: null as { id: string } | null, rpcSpy: null as any }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: H.user } }) },
    from: (table: string) => {
      const state = (globalThis as any).__teamsRouteFake;
      return state.from(table);
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (H.rpcSpy) H.rpcSpy(fn, args);
      const state = (globalThis as any).__teamsRouteFake;
      return state.rpc(fn, args);
    },
  }),
}));

type Fake = {
  roleFor: (teamId: string) => "owner" | "admin" | "member" | null;
  insertError?: { code?: string } | null;
  insertRow?: Record<string, unknown> | null;
  rpcResult?: { data?: unknown; error?: { code?: string; message?: string } | null };
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data?: unknown; error?: unknown }>;
};

function makeFake(roleFor: (teamId: string) => "owner" | "admin" | "member" | null, insertRow: Record<string, unknown> | null, insertError: { code?: string } | null, rpcResult: { data?: unknown; error?: { code?: string; message?: string } | null }): Fake {
  const fake: Fake = {
    roleFor,
    insertRow,
    insertError,
    rpcResult,
    from: (table: string) => {
      const q: any = {
        select: () => q,
        eq: () => q,
        limit: () => q,
        insert: () => ({
          select: () => ({ maybeSingle: async () => ({ data: insertRow, error: insertError ?? null }) }),
        }),
        then: (resolve: (v: unknown) => unknown) => {
          if (table === "team_members") {
            // getCallerRole path
            return Promise.resolve({ data: { role: roleFor("t1") }, error: null }).then((r) => resolve(r));
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
        maybeSingle: async () => ({ data: roleFor("t1") ? { role: roleFor("t1") } : null, error: null }),
      };
      return q;
    },
    rpc: async () => rpcResult,
  };
  return fake;
}

async function loadRoute() {
  const mod = await import("../../app/api/teams/invitations/route");
  return mod;
}

describe("POST /api/teams/invitations", () => {
  beforeEach(() => {
    H.user = { id: "u1" };
    H.rpcSpy = null;
  });

  it("acceptance #1: same request body, owner->201, member->403", async () => {
    const { POST } = await loadRoute();
    const body = JSON.stringify({ action: "create", teamId: "t1", email: "x@example.com", role: "member" });

    (globalThis as any).__teamsRouteFake = makeFake(() => "owner", { id: "i1", email: "x@example.com", role: "member", expires_at: null, accepted_at: null }, null, {});
    const res1 = await POST(new Request("http://x/api/teams/invitations", { method: "POST", body }));
    expect(res1.status).toBe(201);

    (globalThis as any).__teamsRouteFake = makeFake(() => "member", null, null, {});
    const res2 = await POST(new Request("http://x/api/teams/invitations", { method: "POST", body }));
    expect(res2.status).toBe(403);
    const json2 = await res2.json();
    expect(json2.message).toBe(INVITE_MESSAGES.not_admin[0]);
    expect(json2.messageZh).toBe(INVITE_MESSAGES.not_admin[1]);

    expect(res1.status).not.toBe(res2.status);
  });

  it("accept ignores userId/email/role alongside token and forwards exactly { p_token }", async () => {
    const { POST } = await loadRoute();
    H.rpcSpy = vi.fn();
    (globalThis as any).__teamsRouteFake = makeFake(() => "owner", null, null, { data: { ok: true, team_id: "t1", role: "member" }, error: null });
    const res = await POST(
      new Request("http://x/api/teams/invitations", {
        method: "POST",
        body: JSON.stringify({ action: "accept", token: "sometoken1234567890123456789012", userId: "attacker", email: "attacker@evil.com", role: "owner" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(H.rpcSpy).toHaveBeenCalledTimes(1);
    expect(H.rpcSpy).toHaveBeenCalledWith("accept_team_invite", { p_token: "sometoken1234567890123456789012" });
  });

  it("accept twice -> second is 409 already_used", async () => {
    const { POST } = await loadRoute();
    (globalThis as any).__teamsRouteFake = makeFake(() => "owner", null, null, { data: { ok: false, reason: "already_used" }, error: null });
    const res = await POST(new Request("http://x/api/teams/invitations", { method: "POST", body: JSON.stringify({ action: "accept", token: "sometoken1234567890123456789012" }) }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.message).toBe(INVITE_MESSAGES.already_used[0]);
  });

  it("expired invite -> 410 with plain-word sentence", async () => {
    const { POST } = await loadRoute();
    (globalThis as any).__teamsRouteFake = makeFake(() => "owner", null, null, { data: { ok: false, reason: "expired" }, error: null });
    const res = await POST(new Request("http://x/api/teams/invitations", { method: "POST", body: JSON.stringify({ action: "accept", token: "sometoken1234567890123456789012" }) }));
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.message).toBe(INVITE_MESSAGES.expired[0]);
    expect(json.messageZh).toBe(INVITE_MESSAGES.expired[1]);
  });

  it("unauthenticated -> 401", async () => {
    H.user = null;
    const { POST } = await loadRoute();
    (globalThis as any).__teamsRouteFake = makeFake(() => null, null, null, {});
    const res = await POST(new Request("http://x/api/teams/invitations", { method: "POST", body: JSON.stringify({ action: "accept", token: "x".repeat(32) }) }));
    expect(res.status).toBe(401);
  });

  it("absent table (PGRST205) -> 503 with plain-word unavailable sentence", async () => {
    const { POST } = await loadRoute();
    (globalThis as any).__teamsRouteFake = makeFake(() => "owner", null, null, { data: null, error: { code: "PGRST205", message: "schema cache" } });
    const res = await POST(new Request("http://x/api/teams/invitations", { method: "POST", body: JSON.stringify({ action: "accept", token: "x".repeat(32) }) }));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.message).toBe(INVITE_MESSAGES.unavailable[0]);
    expect(json.messageZh).toBe(INVITE_MESSAGES.unavailable[1]);
  });

  it("create branch: team_members table unavailable -> 503 unavailable, never the generic failed sentence", async () => {
    // Regression for the null-disclosure MAJOR: createInvite's fail() used to omit `code`, so
    // route.ts fell back to bodyFor("failed") even though the underlying reason was "unavailable"
    // (HTTP 503 carrying error:"FAILED" + the generic sentence instead of INVITE_MESSAGES.unavailable).
    const { POST } = await loadRoute();
    (globalThis as any).__teamsRouteFake = {
      from: (table: string) => {
        const q: any = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () =>
            table === "team_members" ? { data: null, error: { code: "PGRST205", message: "schema cache" } } : { data: null, error: null },
        };
        return q;
      },
      rpc: async () => ({ data: null, error: null }),
    };
    const res = await POST(
      new Request("http://x/api/teams/invitations", {
        method: "POST",
        body: JSON.stringify({ action: "create", teamId: "t1", email: "x@example.com", role: "member" }),
      }),
    );
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.message).toBe(INVITE_MESSAGES.unavailable[0]);
    expect(json.messageZh).toBe(INVITE_MESSAGES.unavailable[1]);
    expect(json.error).not.toBe("FAILED");
  });

  it("every non-2xx body carries both message and messageZh", async () => {
    const { POST } = await loadRoute();
    const scenarios: Array<[() => "owner" | "admin" | "member" | null, { data?: unknown; error?: { code?: string; message?: string } | null } | null, Record<string, unknown>]> = [
      [() => "member", null, { action: "create", teamId: "t1", email: "x@example.com", role: "member" }],
      [() => "owner", { data: null, error: { code: "PGRST205" } }, { action: "accept", token: "x".repeat(32) }],
    ];
    for (const [roleFor, rpcResult, body] of scenarios) {
      (globalThis as any).__teamsRouteFake = makeFake(roleFor, null, null, rpcResult ?? {});
      const res = await POST(new Request("http://x/api/teams/invitations", { method: "POST", body: JSON.stringify(body) }));
      if (res.status >= 300) {
        const json = await res.json();
        expect(json.message).toBeTruthy();
        expect(json.messageZh).toBeTruthy();
      }
    }
  });
});
