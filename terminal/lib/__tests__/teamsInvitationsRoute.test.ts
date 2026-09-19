import { beforeEach, describe, expect, it, vi } from "vitest";
import { INVITE_MESSAGES, MAX_INVITES } from "@/lib/teams";

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

// --- Audit heal of t#514, criterion (e) FAIL ------------------------------------------------
// The merged PR shipped the invitations READ leg — `GET /api/teams/invitations` and the exported
// `listInvites` behind it — with zero tests, and the `truncated` flag the packet's own round-2 m1
// introduced was never asserted true from the producer that computes it. This block pins the GET
// handler end to end; lib/__tests__/teams.test.ts pins `listInvites` and the other two producers.
type GetFakeOpts = {
  role?: "owner" | "admin" | "member" | null;
  roleError?: { code?: string; message?: string } | null;
  inviteRows?: Record<string, unknown>[];
  inviteError?: { code?: string; message?: string } | null;
};

type GetCall = { table: string; eqs: Array<[string, unknown]>; limits: number[] };

function makeGetFake(opts: GetFakeOpts) {
  const calls: GetCall[] = [];
  const fake = {
    from: (table: string) => {
      const call: GetCall = { table, eqs: [], limits: [] };
      calls.push(call);
      const q: any = {
        select: () => q,
        eq: (col: string, value: unknown) => {
          call.eqs.push([col, value]);
          return q;
        },
        limit: (n: number) => {
          call.limits.push(n);
          return q;
        },
        maybeSingle: async () => {
          if (table !== "team_members") return { data: null, error: null };
          if (opts.roleError) return { data: null, error: opts.roleError };
          return { data: opts.role ? { role: opts.role } : null, error: null };
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (table !== "team_invites") return Promise.resolve({ data: [], error: null }).then(resolve);
          if (opts.inviteError) return Promise.resolve({ data: null, error: opts.inviteError }).then(resolve);
          return Promise.resolve({ data: opts.inviteRows ?? [], error: null }).then(resolve);
        },
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  return { fake, calls };
}

function inviteRows(count: number, teamId = "t1"): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `i${i + 1}`,
    team_id: teamId,
    email: `person${i + 1}@example.com`,
    role: i % 2 === 0 ? "member" : "admin",
    expires_at: "2026-09-20T00:00:00.000Z",
    accepted_at: null,
  }));
}

describe("GET /api/teams/invitations", () => {
  let GET: any;

  beforeEach(async () => {
    H.user = { id: "u1" };
    H.rpcSpy = null;
    ({ GET } = await loadRoute());
  });

  function get(opts: GetFakeOpts, teamId: string | null = "t1") {
    const { fake, calls } = makeGetFake(opts);
    (globalThis as any).__teamsRouteFake = fake;
    const url = teamId === null
      ? "http://x/api/teams/invitations"
      : `http://x/api/teams/invitations?teamId=${encodeURIComponent(teamId)}`;
    return { res: GET(new Request(url)) as Promise<Response>, calls };
  }

  it("signed out -> 401 with the sign-in sentence in both languages", async () => {
    H.user = null;
    const { fake } = makeGetFake({ role: "owner", inviteRows: inviteRows(1) });
    (globalThis as any).__teamsRouteFake = fake;
    const res = await GET(new Request("http://x/api/teams/invitations?teamId=t1"));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("NOT_SIGNED_IN");
    expect(json.message).toBe(INVITE_MESSAGES.not_signed_in[0]);
    expect(json.messageZh).toBe(INVITE_MESSAGES.not_signed_in[1]);
  });

  it("no teamId -> 404 team_not_found, and nothing is read from the database", async () => {
    const { res, calls } = get({ role: "owner", inviteRows: inviteRows(1) }, null);
    const response = await res;
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.error).toBe("TEAM_NOT_FOUND");
    expect(json.message).toBe(INVITE_MESSAGES.team_not_found[0]);
    expect(json.messageZh).toBe(INVITE_MESSAGES.team_not_found[1]);
    expect(calls).toEqual([]);
  });

  it("a team the caller has no membership row for -> 404 team_not_found", async () => {
    const { res } = get({ role: null, inviteRows: inviteRows(3) });
    const response = await res;
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json.error).toBe("TEAM_NOT_FOUND");
    expect(json.message).toBe(INVITE_MESSAGES.team_not_found[0]);
    expect(json.messageZh).toBe(INVITE_MESSAGES.team_not_found[1]);
  });

  it("a plain member -> 403 not_admin, and the invitations table is never read", async () => {
    const { res, calls } = get({ role: "member", inviteRows: inviteRows(3) });
    const response = await res;
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error).toBe("NOT_ADMIN");
    expect(json.message).toBe(INVITE_MESSAGES.not_admin[0]);
    expect(json.messageZh).toBe(INVITE_MESSAGES.not_admin[1]);
    expect(calls.map((c) => c.table)).toEqual(["team_members"]);
  });

  it("owner -> 200 with exactly {invites, callerRole, truncated}, scoped to the asked team, read one row past the cap", async () => {
    const { res, calls } = get({ role: "owner", inviteRows: inviteRows(2) });
    const response = await res;
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(Object.keys(json).sort()).toEqual(["callerRole", "invites", "truncated"]);
    expect(json.callerRole).toBe("owner");
    expect(json.truncated).toBe(false);
    expect(json.invites).toEqual([
      { id: "i1", email: "person1@example.com", role: "member", expiresAt: "2026-09-20T00:00:00.000Z", acceptedAt: null },
      { id: "i2", email: "person2@example.com", role: "admin", expiresAt: "2026-09-20T00:00:00.000Z", acceptedAt: null },
    ]);
    const invitesCall = calls.find((c) => c.table === "team_invites");
    expect(invitesCall?.eqs).toEqual([["team_id", "t1"]]);
    expect(invitesCall?.limits).toEqual([MAX_INVITES + 1]);
  });

  it("administrator -> 200 and the body names the caller's own role", async () => {
    const { res } = get({ role: "admin", inviteRows: inviteRows(1) });
    const response = await res;
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.callerRole).toBe("admin");
    expect(json.invites.length).toBe(1);
  });

  it("a row is mapped field by field: ids become text, a missing role reads as member, unread dates stay null", async () => {
    const { res } = get({
      role: "owner",
      inviteRows: [
        { id: 7, email: "SEVEN@Example.com", role: "admin", expires_at: "2026-10-01T00:00:00.000Z", accepted_at: "2026-09-02T00:00:00.000Z" },
        { id: "i8", email: "eight@example.com" },
      ],
    });
    const json = await (await res).json();
    expect(json.invites).toEqual([
      { id: "7", email: "SEVEN@Example.com", role: "admin", expiresAt: "2026-10-01T00:00:00.000Z", acceptedAt: "2026-09-02T00:00:00.000Z" },
      { id: "i8", email: "eight@example.com", role: "member", expiresAt: null, acceptedAt: null },
    ]);
  });

  it("one row past the cap -> the cap is returned and truncated is TRUE (round-2 m1, producer side)", async () => {
    const { res } = get({ role: "owner", inviteRows: inviteRows(MAX_INVITES + 1) });
    const response = await res;
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.invites.length).toBe(MAX_INVITES);
    expect(json.truncated).toBe(true);
  });

  it("exactly the cap -> truncated stays FALSE, so a full page is not reported as cut short", async () => {
    const { res } = get({ role: "owner", inviteRows: inviteRows(MAX_INVITES) });
    const json = await (await res).json();
    expect(json.invites.length).toBe(MAX_INVITES);
    expect(json.truncated).toBe(false);
  });

  it("absent invitations table -> 503 UNAVAILABLE with the not-set-up sentence", async () => {
    const { res } = get({ role: "owner", inviteError: { code: "42P01", message: 'relation "team_invites" does not exist' } });
    const response = await res;
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json.error).toBe("UNAVAILABLE");
    expect(json.message).toBe(INVITE_MESSAGES.unavailable[0]);
    expect(json.messageZh).toBe(INVITE_MESSAGES.unavailable[1]);
  });

  it("H2: a read error that is NOT absence -> 503 READ_FAILED, never the not-set-up sentence", async () => {
    const { res } = get({ role: "owner", inviteError: { code: "08006", message: "connection failure" } });
    const response = await res;
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json.error).toBe("READ_FAILED");
    expect(json.message).toBe(INVITE_MESSAGES.read_failed[0]);
    expect(json.messageZh).toBe(INVITE_MESSAGES.read_failed[1]);
    expect(json.message).not.toBe(INVITE_MESSAGES.unavailable[0]);
    expect(json.messageZh).not.toBe(INVITE_MESSAGES.unavailable[1]);
    expect(json.message).toMatch(/^[A-Z].*[.!?]$/);
    expect(json.messageZh).toMatch(/[一-鿿]/);
  });

  it("H2: absence and failure stay two different answers, in both languages", async () => {
    const absent = await (await get({ role: "owner", inviteError: { code: "PGRST205", message: "schema cache" } }).res).json();
    const failed = await (await get({ role: "owner", inviteError: { code: "08006", message: "connection failure" } }).res).json();
    expect(absent.error).not.toBe(failed.error);
    expect(absent.message).not.toBe(failed.message);
    expect(absent.messageZh).not.toBe(failed.messageZh);
    expect(absent.message).toBe(INVITE_MESSAGES.unavailable[0]);
    expect(failed.message).toBe(INVITE_MESSAGES.read_failed[0]);
    expect(failed.messageZh).toBe(INVITE_MESSAGES.read_failed[1]);
  });

  it("a caller-role read error is classified the same way: absence 503 UNAVAILABLE, anything else 503 READ_FAILED", async () => {
    const absent = get({ role: "owner", roleError: { code: "PGRST205", message: "schema cache" } });
    const absentJson = await (await absent.res).json();
    expect(absentJson.error).toBe("UNAVAILABLE");
    expect(absent.calls.map((c) => c.table)).toEqual(["team_members"]);

    const failed = get({ role: "owner", roleError: { code: "08006", message: "connection failure" } });
    const failedJson = await (await failed.res).json();
    expect(failedJson.error).toBe("READ_FAILED");
    expect(failedJson.message).toBe(INVITE_MESSAGES.read_failed[0]);
    expect(failedJson.messageZh).toBe(INVITE_MESSAGES.read_failed[1]);
  });

  it("every non-2xx GET body carries a complete sentence in both languages and no raw database text", async () => {
    const scenarios: GetFakeOpts[] = [
      { role: null },
      { role: "member" },
      { role: "owner", inviteError: { code: "42P01", message: 'relation "team_invites" does not exist' } },
      { role: "owner", inviteError: { code: "08006", message: "connection failure" } },
      { role: "owner", roleError: { code: "08006", message: "connection failure" } },
    ];
    for (const opts of scenarios) {
      const response = await get(opts).res;
      expect(response.status).toBeGreaterThanOrEqual(400);
      const json = await response.json();
      expect(json.message).toBeTruthy();
      expect(json.messageZh).toBeTruthy();
      expect(json.message).not.toBe(json.messageZh);
      expect(json.message).toMatch(/^[A-Z].*[.!?]$/);
      expect(json.messageZh).toMatch(/[一-鿿]/);
      for (const banned of [
        "falsifier", "refuted", "证伪", "team_invites", "workspace_settings", "accept_team_invite",
        "RLS", "42501", "08006", "42P01", "PGRST205", "connection failure",
      ]) {
        expect(json.message).not.toContain(banned);
        expect(json.messageZh).not.toContain(banned);
      }
      expect(json.message).not.toMatch(/\b\d{3}\b/);
    }
  });
});
