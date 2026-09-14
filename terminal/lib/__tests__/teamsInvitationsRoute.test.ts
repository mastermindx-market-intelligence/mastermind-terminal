import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INVITE_EMAIL_DELIVERY_CHECKED_AT,
  INVITE_MESSAGES,
  inviteCheckedOn,
  isInviteToken,
} from "@/lib/teams";

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

describe("MO-PAID-081 (W9T_F12_17): a created invitation answers with a copyable link and the dated no-mail line", () => {
  const CREATED_ROW = { id: "i1", email: "friend@example.com", role: "member", expires_at: null, accepted_at: null };

  function fakeOwner() {
    (globalThis as any).__teamsRouteFake = makeFake(() => "owner", CREATED_ROW, null, {});
  }

  async function createInviteRequest(
    headers: Record<string, string> = {},
    url = "http://127.0.0.1:3108/api/teams/invitations",
  ) {
    const { POST } = await loadRoute();
    const res = await POST(
      new Request(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "create", teamId: "t1", email: "friend@example.com", role: "member" }),
      }),
    );
    return { status: res.status, body: (await res.json()) as any };
  }

  beforeEach(() => {
    H.user = { id: "u1" };
  });

  it("201 carries the link, the token it holds, and delivery.sent false with the checked date", async () => {
    fakeOwner();
    const { status, body } = await createInviteRequest();
    expect(status).toBe(201);
    expect(isInviteToken(body.token)).toBe(true);
    expect(body.inviteUrl).toBe(`http://127.0.0.1:3108/invite?token=${body.token}`);
    expect(body.inviteUrl.startsWith("http")).toBe(true);
    expect(body.delivery.sent).toBe(false);
    expect(body.delivery.checkedAt).toBe(INVITE_EMAIL_DELIVERY_CHECKED_AT);
    expect(body.acceptWith).toEqual({ action: "accept" });
  });

  it("the delivery sentence is the dated catalogued pair in both languages", async () => {
    fakeOwner();
    const { body } = await createInviteRequest();
    expect(body.delivery.message).toBe(INVITE_MESSAGES.no_email_delivery[0]);
    expect(body.delivery.messageZh).toBe(INVITE_MESSAGES.no_email_delivery[1]);
    expect(body.delivery.message).toContain(inviteCheckedOn(INVITE_EMAIL_DELIVERY_CHECKED_AT, "en"));
    expect(body.delivery.messageZh).toContain(inviteCheckedOn(INVITE_EMAIL_DELIVERY_CHECKED_AT, "zh"));
    expect(body.delivery.messageZh).toMatch(/[一-鿿]/);
    // The sentence a person reads never carries the internal code that sits beside it.
    expect(body.delivery.message).not.toContain("no_email_delivery");
    expect(body.delivery.messageZh).not.toContain("no_email_delivery");
  });

  it("the link is built on the forwarded public origin, not the loopback the runtime saw", async () => {
    fakeOwner();
    const { body } = await createInviteRequest({
      "x-forwarded-host": "app.mastermind-x.com",
      "x-forwarded-proto": "https",
    });
    expect(body.inviteUrl).toBe(`https://app.mastermind-x.com/invite?token=${body.token}`);
  });

  it("a first hop in a list of forwarded protocols is the one used", async () => {
    fakeOwner();
    const { body } = await createInviteRequest({
      "x-forwarded-host": "app.mastermind-x.com",
      "x-forwarded-proto": "https, http",
    });
    expect(body.inviteUrl.startsWith("https://app.mastermind-x.com/invite?token=")).toBe(true);
  });

  it("GET answers with the same dated delivery block beside the invitation list", async () => {
    fakeOwner();
    const { GET } = await loadRoute();
    const res = await GET(new Request("http://x/api/teams/invitations?teamId=t1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.invites)).toBe(true);
    expect(body.delivery.sent).toBe(false);
    expect(body.delivery.checkedAt).toBe(INVITE_EMAIL_DELIVERY_CHECKED_AT);
    expect(body.delivery.message).toBe(INVITE_MESSAGES.no_email_delivery[0]);
    expect(body.delivery.messageZh).toBe(INVITE_MESSAGES.no_email_delivery[1]);
    // The list never leaks a token: only the create answer ever holds one.
    expect(JSON.stringify(body.invites)).not.toMatch(/[0-9a-f]{64}/);
  });

  it("a refused create answers with no link at all, and the refusal sentence", async () => {
    (globalThis as any).__teamsRouteFake = makeFake(() => "member", null, null, {});
    const { POST } = await loadRoute();
    const res = await POST(
      new Request("http://x/api/teams/invitations", {
        method: "POST",
        body: JSON.stringify({ action: "create", teamId: "t1", email: "friend@example.com", role: "member" }),
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.inviteUrl).toBeUndefined();
    expect(body.token).toBeUndefined();
    expect(body.delivery).toBeUndefined();
    expect(body.message).toBe(INVITE_MESSAGES.not_admin[0]);
    expect(body.messageZh).toBe(INVITE_MESSAGES.not_admin[1]);
  });

  it("a duplicate invitation answers with no link and the duplicate sentence", async () => {
    (globalThis as any).__teamsRouteFake = makeFake(() => "owner", null, { code: "23505" }, {});
    const { POST } = await loadRoute();
    const res = await POST(
      new Request("http://x/api/teams/invitations", {
        method: "POST",
        body: JSON.stringify({ action: "create", teamId: "t1", email: "friend@example.com", role: "member" }),
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.inviteUrl).toBeUndefined();
    expect(body.message).toBe(INVITE_MESSAGES.duplicate_invite[0]);
    expect(body.messageZh).toBe(INVITE_MESSAGES.duplicate_invite[1]);
  });
});
