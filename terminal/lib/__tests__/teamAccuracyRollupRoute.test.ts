// /api/teams/[id]/accuracy/rollup route contract (packet W9T_F13_9 / MO-DELTA-007).
//
// Seat ruling: "Team sees its own scores; never a cross-team rank (hard gate, test pinned)."
// The test pins below name every face of that hard gate at the route boundary: only the team
// in the URL is read, only the caller if they are on it, and the response body never carries
// a per-member ranking, a cross-team field, or a leaked row from outside the team.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_ROUTE_MESSAGES } from "@/lib/teams";

// vi.hoisted + vi.mock("@/lib/supabase/server") is the same idiom teamsRoute.test.ts uses;
// teamMembers and userClaims are mocked as if they were the real Supabase tables, so the test
// exercises the route's actual SQL composition rather than a hand-rolled stub.
const H = vi.hoisted(() => ({
  user: null as { id: string } | null,
  teamMembers: [] as Array<Record<string, unknown>>,
  userClaims: [] as Array<Record<string, unknown>>,
  serviceFault: null as { code: string; message: string } | null,
  // MAJOR-2 fix (h_t587): when true, createServiceClient returns null instead of a
  // working client. This simulates a misconfigured deployment and verifies the route
  // returns 503 with the unavailable sentence — never personal figures as team rollup.
  serviceClientNull: false as boolean,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: H.user } }) },
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let inFilter: { col: string; values: unknown[] } | null = null;
      const q: Record<string, unknown> = {};
      const applyFilters = () => {
        if (table === "team_members") {
          return H.teamMembers.filter((r) => filters.every(([c, v]) => r[c] === v) && (!inFilter || inFilter.values.includes(r[inFilter.col]))).slice(0, 500);
        }
        if (table === "user_claims") {
          return H.userClaims.filter((r) => filters.every(([c, v]) => r[c] === v) && (!inFilter || inFilter.values.includes(r[inFilter.col])));
        }
        return [];
      };
      q.select = () => q;
      q.eq = (col: string, val: unknown) => {
        filters.push([col, val]);
        return q;
      };
      q.in = (col: string, vals: unknown[]) => {
        inFilter = { col, values: vals as unknown[] };
        return q;
      };
      q.order = () => q;
      q.limit = () => Promise.resolve({ data: applyFilters(), error: null });
      q.maybeSingle = async () => {
        const rows = applyFilters();
        return { data: rows[0] ?? null, error: null };
      };
      return q;
    },
  }),
}));

// A minimal service client that answers the `from("user_claims").select(...).in(...).order(...).limit(...)`
// the route composes. No .rpc — the route does not need one.
// MAJOR-2 fix (h_t587): createServiceClient returns null when H.serviceClientNull is set,
// simulating a misconfigured deployment with no service key.
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => {
    if (H.serviceClientNull) return null;
    return {
      from(table: string) {
        const inFilter: { col: string; values: unknown[] } | null = { col: "user_id", values: [] };
        let orderAsc = true;
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.in = (_col: string, vals: unknown[]) => {
          inFilter.values = vals as unknown[];
          return q;
        };
        q.order = (_col: string, opts?: { ascending?: boolean }) => {
          orderAsc = opts?.ascending !== false;
          return q;
        };
        q.limit = (n: number) => {
          if (table !== "user_claims") return Promise.resolve({ data: [], error: null });
          if (H.serviceFault) return Promise.resolve({ data: null, error: H.serviceFault });
          const rows = H.userClaims
            .filter((r) => inFilter.values.includes(r["user_id"]))
            .sort((a, b) => {
              const av = String(a["stated_at"] ?? "");
              const bv = String(b["stated_at"] ?? "");
              return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
            })
            .slice(0, n);
          return Promise.resolve({ data: rows, error: null });
        };
        q.eq = () => q;
        q.maybeSingle = async () => ({ data: null, error: null });
        return q;
      },
    };
  },
}));

import { GET } from "@/app/api/teams/[id]/accuracy/rollup/route";

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const TEAM_ID = "team-rollup-test";

function call(teamId: string) {
  return GET(new Request(`https://x.test/api/teams/${teamId}/accuracy/rollup`), {
    params: Promise.resolve({ id: teamId }),
  });
}

function claimRow(over: Record<string, unknown>) {
  return {
    claim_id: over.claim_id,
    user_id: over.user_id,
    subject: over.subject ?? { kind: "security", id: "AAA" },
    stated_at: over.stated_at ?? "2026-01-01T00:00:00.000Z",
    resolves_at: over.resolves_at ?? "2026-02-01T00:00:00.000Z",
    claim_text: over.claim_text ?? "a call",
    condition: over.condition ?? { metric: "last_close", comparator: ">=", threshold: 6000, owner: "quotes.last_close" },
    stated_probability: over.stated_probability ?? null,
    evidence: [],
    status: over.status ?? "resolved",
    resolution: over.resolution ?? { outcome: 1, observed: 6100, resolved_at: "2026-02-01T00:00:00.000Z", resolver: "quotes.last_close", note: "" },
    supersedes: null,
  };
}

beforeEach(() => {
  H.user = null;
  H.teamMembers = [];
  H.userClaims = [];
  H.serviceFault = null;
  H.serviceClientNull = false;
  vi.clearAllMocks();
});

describe("GET /api/teams/[id]/accuracy/rollup — auth", () => {
  it("401s a signed-out caller", async () => {
    H.user = null;
    const res = await call(TEAM_ID);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/teams/[id]/accuracy/rollup — hard gate: never a cross-team rank", () => {
  beforeEach(() => {
    H.user = { id: ALICE };
  });

  it("403s a caller who is not a member of this team (no leak of whether the team exists)", async () => {
    // Alice is not in team_members for this team. The route must not return any user_claims
    // and must not confirm the team's existence; it answers 403, period.
    H.teamMembers = [
      { team_id: TEAM_ID, user_id: BOB, role: "owner" },
    ];
    H.userClaims = [
      claimRow({ claim_id: "bbbbbbbbbbbbbbb1", user_id: BOB, claim_text: "bob" }),
    ];
    const res = await call(TEAM_ID);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("FORBIDDEN");
    expect(typeof body.message).toBe("string");
    expect(typeof body.messageZh).toBe("string");
    // The body must NOT carry any claims — a non-member never sees another team's rows.
    expect(body.readout).toBeUndefined();
    expect(body.memberCount).toBeUndefined();
  });

  it("rolls up only the team in the URL: a second team's rows are never included", async () => {
    // Two teams share a member (Bob). Bob's row exists once in user_claims; if the route's
    // `.in("user_id", ...)` were scoped to user_id alone, both teams' rollups would see Bob's
    // row. The route scopes by team_members first and uses that as the `.in(...)` source, so
    // the OTHER team's member Carol never contributes a row to THIS team's rollup.
    H.teamMembers = [
      { team_id: TEAM_ID, user_id: ALICE, role: "owner" },
      { team_id: TEAM_ID, user_id: BOB, role: "member" },
      { team_id: "team-other", user_id: BOB, role: "member" },
      { team_id: "team-other", user_id: CAROL, role: "owner" },
    ];
    H.userClaims = [
      claimRow({ claim_id: "aaaaaaaaaaaaaaaa", user_id: ALICE, claim_text: "alice on team" }),
      claimRow({ claim_id: "bbbbbbbbbbbbbbbb", user_id: BOB, claim_text: "bob on team" }),
      claimRow({ claim_id: "cccccccccccccccc", user_id: CAROL, claim_text: "carol on other team" }),
    ];
    const res = await call(TEAM_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("ok");
    expect(body.memberCount).toBe(2); // Alice + Bob, not Carol.
    expect(body.readout.claimCount).toBe(2);
    // The row from Carol (on the OTHER team) MUST NOT appear, even though the service-client
    // `from("user_claims").in("user_id", [...])` could in principle return it.
    const claimIds = (body.readout.claims as Array<{ claimId: string }>).map((r) => r.claimId);
    expect(claimIds.sort()).toEqual(["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]);
  });

  it("returns the team's shared readout — never a per-member ranking, never a cross-team field", async () => {
    // The response shape is `AccuracyReadout` (no per-member name, no per-member hit rate, no
    // "best on team" line) plus three rollup-only fields. Pin that.
    H.teamMembers = [
      { team_id: TEAM_ID, user_id: ALICE, role: "owner" },
      { team_id: TEAM_ID, user_id: BOB, role: "member" },
    ];
    H.userClaims = [
      claimRow({ claim_id: "aaaaaaaaaaaaaaaa", user_id: ALICE, claim_text: "alice", resolution: { outcome: 1, observed: 6100, resolved_at: "2026-02-01T00:00:00.000Z", resolver: "quotes.last_close", note: "" } }),
      claimRow({ claim_id: "bbbbbbbbbbbbbbbb", user_id: BOB, claim_text: "bob", resolution: { outcome: 0, observed: 5900, resolved_at: "2026-02-01T00:00:00.000Z", resolver: "quotes.last_close", note: "" } }),
    ];
    const res = await call(TEAM_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([
      "kind",
      "memberCount",
      "membersWithClaims",
      "message",
      "messageZh",
      "readout",
      "truncated",
    ]);
    // No per-member leaderboard field, no per-member rank field.
    expect(body.members).toBeUndefined();
    expect(body.leaderboard).toBeUndefined();
    expect(body.rank).toBeUndefined();
    // The team's row set is scored as ONE readout, not as a list of per-member readouts.
    expect(body.readoutByMember).toBeUndefined();
    // The readout's claim list does not carry its author anywhere — no userId / user_id / author.
    for (const row of body.readout.claims as Array<Record<string, unknown>>) {
      expect(Object.prototype.hasOwnProperty.call(row, "userId")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(row, "user_id")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(row, "author")).toBe(false);
    }
  });

  it("returns no_rows when the team has members but no one has written anything", async () => {
    H.teamMembers = [
      { team_id: TEAM_ID, user_id: ALICE, role: "owner" },
      { team_id: TEAM_ID, user_id: BOB, role: "member" },
    ];
    H.userClaims = [];
    const res = await call(TEAM_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("no_rows");
    expect(body.memberCount).toBe(2);
    expect(body.membersWithClaims).toBe(0);
    // The empty readout is the personal scorer's empty — never a misleading zero.
    expect(body.readout.claimCount).toBe(0);
    expect(body.readout.episodeCount).toBe(0);
  });

  it("503s when the service-role read fails (unavailable), with the bilingual pair", async () => {
    H.teamMembers = [{ team_id: TEAM_ID, user_id: ALICE, role: "owner" }];
    H.userClaims = [];
    H.serviceFault = { code: "PGRST205", message: "schema cache" };
    const res = await call(TEAM_ID);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(typeof body.message).toBe("string");
    expect(typeof body.messageZh).toBe("string");
  });

  // MAJOR-2 RED-first test (h_t587): service client null → 503, no personal figures leak.
  // At 898d80a4 (pre-fix) the route fell back to listOwnClaimsOnly when createServiceClient()
  // was null, returning 200 with the caller's personal row set and memberCount reported as
  // scored. The fix removes that fallback so a misconfigured deployment returns 503 with the
  // unavailable sentence instead.
  it("MAJOR-2 RED: service client null returns 503 — no personal figures, memberCount not scored", async () => {
    // Alice has personal claims in user_claims.
    H.teamMembers = [{ team_id: TEAM_ID, user_id: ALICE, role: "owner" }];
    H.userClaims = [
      claimRow({ claim_id: "alice-personal-1", user_id: ALICE, claim_text: "Alice personal call" }),
    ];
    // Simulate service-client unavailable (misconfigured deployment).
    H.serviceClientNull = true;
    const res = await call(TEAM_ID);
    // Must be 503 — not 200.
    expect(res.status).toBe(503);
    const body = await res.json();
    // The unavailable sentence in both languages, verbatim.
    expect(body.message).toBe(TEAM_ROUTE_MESSAGES.unavailable[0]);
    expect(body.messageZh).toBe(TEAM_ROUTE_MESSAGES.unavailable[1]);
    // No readout with personal figures: the response must NOT be a "kind":"ok" or "kind":"no_rows"
    // with memberCount implying the team was scored.
    expect(body.kind).toBeUndefined();
    expect(body.readout).toBeUndefined();
    // memberCount must not appear as scored team figures.
    expect(body.memberCount).toBeUndefined();
    expect(body.membersWithClaims).toBeUndefined();
  });
});
