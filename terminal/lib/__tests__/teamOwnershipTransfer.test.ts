import { describe, expect, it } from "vitest";
import {
  TEAM_ROUTE_MESSAGES,
  TRANSFER_OWNERSHIP_FN,
  transferOwnership,
  type TenancyRpcDb,
} from "@/lib/teams";

const TEAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const MEMBER = "33333333-3333-4333-8333-333333333333";
const STRANGER = "44444444-4444-4444-8444-444444444444";

type MemberRow = { user_id: string; role: "owner" | "admin" | "member" };
type AuditRow = { subject_id: string; actor_id: string; old_role: string; new_role: string };

function fakeTransferDb(opts: {
  rpc?: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
}): TenancyRpcDb {
  return {
    from: () => {
      throw new Error("transferOwnership must not query tables; the function is the source of truth");
    },
    rpc: opts.rpc ?? (async () => ({ data: [], error: null })),
  } as unknown as TenancyRpcDb;
}

/**
 * In-memory stand-in for transfer_team_ownership. This is a SIMULATION of the
 * SQL function (including a simulated concurrent second call). Real serialization
 * with two Postgres connections is proven by terminal/scripts/f12_team_postgres_canary.py.
 */
function simulateFunction(state: {
  ownerId: string;
  members: MemberRow[];
  audit: AuditRow[];
  lockHeldBy: string | null;
}) {
  return async (callerId: string, teamId: string, newOwnerId: string) => {
    if (teamId !== TEAM) return { success: false, message: "team_not_found" };
    const owner = state.members.find((m) => m.role === "owner");
    if (!owner) return { success: false, message: "team_not_found" };
    if (owner.user_id !== callerId) return { success: false, message: "owner_only" };
    if (newOwnerId === owner.user_id) return { success: false, message: "same_owner" };
    const recipient = state.members.find((m) => m.user_id === newOwnerId);
    if (!recipient) return { success: false, message: "not_on_team" };
    if (recipient.role !== "admin") return { success: false, message: "transfer_requires_admin" };
    if (state.lockHeldBy && state.lockHeldBy !== callerId) {
      return { success: false, message: "conflict" };
    }
    const oldOwner = owner.user_id;
    owner.role = "admin";
    recipient.role = "owner";
    state.ownerId = newOwnerId;
    state.audit.push({ subject_id: oldOwner, actor_id: callerId, old_role: "owner", new_role: "admin" });
    state.audit.push({ subject_id: newOwnerId, actor_id: callerId, old_role: "admin", new_role: "owner" });
    return { success: true, message: "transfer_success" };
  };
}

function seed() {
  const members: MemberRow[] = [
    { user_id: OWNER, role: "owner" },
    { user_id: ADMIN, role: "admin" },
    { user_id: MEMBER, role: "member" },
  ];
  return { ownerId: OWNER, members, audit: [] as AuditRow[], lockHeldBy: null as string | null };
}

describe("transferOwnership (B-F12-9)", () => {
  it("1. owner transferring to an administrator succeeds; two simulated audit rows exist", async () => {
    const state = seed();
    const run = simulateFunction(state);
    const db = fakeTransferDb({
      rpc: async (fn, args) => {
        expect(fn).toBe(TRANSFER_OWNERSHIP_FN);
        const row = await run(OWNER, String(args.p_team), String(args.p_new_owner_user_id));
        return { data: [row], error: null };
      },
    });
    const result = await transferOwnership(db, TEAM, ADMIN);
    expect(result).toEqual({ success: true, message: "transfer_success", newOwnerId: ADMIN });
    expect(state.members.find((m) => m.user_id === OWNER)?.role).toBe("admin");
    expect(state.members.find((m) => m.user_id === ADMIN)?.role).toBe("owner");
    expect(state.audit).toEqual([
      { subject_id: OWNER, actor_id: OWNER, old_role: "owner", new_role: "admin" },
      { subject_id: ADMIN, actor_id: OWNER, old_role: "admin", new_role: "owner" },
    ]);
  });

  it("2. transferring to a member returns transfer_requires_admin and changes no rows", async () => {
    const state = seed();
    const snapshot = JSON.stringify(state.members);
    const run = simulateFunction(state);
    const db = fakeTransferDb({
      rpc: async (_fn, args) => ({
        data: [await run(OWNER, String(args.p_team), String(args.p_new_owner_user_id))],
        error: null,
      }),
    });
    const result = await transferOwnership(db, TEAM, MEMBER);
    expect(result).toEqual({ success: false, message: "transfer_requires_admin", status: 403 });
    expect(JSON.stringify(state.members)).toBe(snapshot);
    expect(state.audit).toEqual([]);
  });

  it("3. an administrator calling the function returns owner_only and changes no rows", async () => {
    const state = seed();
    const snapshot = JSON.stringify(state.members);
    const run = simulateFunction(state);
    const db = fakeTransferDb({
      rpc: async (_fn, args) => ({
        data: [await run(ADMIN, String(args.p_team), String(args.p_new_owner_user_id))],
        error: null,
      }),
    });
    const result = await transferOwnership(db, TEAM, ADMIN);
    expect(result).toEqual({ success: false, message: "owner_only", status: 403 });
    expect(JSON.stringify(state.members)).toBe(snapshot);
  });

  it("4. transferring to self returns same_owner and changes no rows", async () => {
    const state = seed();
    const snapshot = JSON.stringify(state.members);
    const run = simulateFunction(state);
    const db = fakeTransferDb({
      rpc: async (_fn, args) => ({
        data: [await run(OWNER, String(args.p_team), String(args.p_new_owner_user_id))],
        error: null,
      }),
    });
    const result = await transferOwnership(db, TEAM, OWNER);
    expect(result).toEqual({ success: false, message: "same_owner", status: 400 });
    expect(JSON.stringify(state.members)).toBe(snapshot);
  });

  it("5. a user id not on the team returns not_on_team and changes no rows", async () => {
    const state = seed();
    const snapshot = JSON.stringify(state.members);
    const run = simulateFunction(state);
    const db = fakeTransferDb({
      rpc: async (_fn, args) => ({
        data: [await run(OWNER, String(args.p_team), String(args.p_new_owner_user_id))],
        error: null,
      }),
    });
    const result = await transferOwnership(db, TEAM, STRANGER);
    expect(result).toEqual({ success: false, message: "not_on_team", status: 404 });
    expect(JSON.stringify(state.members)).toBe(snapshot);
  });

  it("6. an unknown team id returns team_not_found", async () => {
    const missing = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const db = fakeTransferDb({
      rpc: async () => ({ data: [{ success: false, message: "team_not_found" }], error: null }),
    });
    const result = await transferOwnership(db, missing, ADMIN);
    expect(result).toEqual({ success: false, message: "team_not_found", status: 404 });
  });

  it("7. SIMULATION: a second overlapping call returns conflict; no two-owner state (real proof is the Postgres canary)", async () => {
    const firstState = seed();
    const firstRun = simulateFunction(firstState);
    const firstDb = fakeTransferDb({
      rpc: async (_fn, args) => ({
        data: [await firstRun(OWNER, String(args.p_team), String(args.p_new_owner_user_id))],
        error: null,
      }),
    });
    const first = await transferOwnership(firstDb, TEAM, ADMIN);
    expect(first.success).toBe(true);
    expect(firstState.members.filter((m) => m.role === "owner")).toHaveLength(1);

    const overlapping = seed();
    overlapping.lockHeldBy = "concurrent-other";
    const snapshot = JSON.stringify(overlapping.members);
    const overlapRun = simulateFunction(overlapping);
    const secondDb = fakeTransferDb({
      rpc: async (_fn, args) => ({
        data: [await overlapRun(OWNER, String(args.p_team), String(args.p_new_owner_user_id))],
        error: null,
      }),
    });
    const second = await transferOwnership(secondDb, TEAM, ADMIN);
    expect(second).toEqual({ success: false, message: "conflict", status: 409 });
    expect(JSON.stringify(overlapping.members)).toBe(snapshot);
    expect(overlapping.members.filter((m) => m.role === "owner")).toHaveLength(1);
  });

  it("8. a successful transfer's simulated audit trail is demotion then promotion with actor_id = caller", async () => {
    const state = seed();
    const run = simulateFunction(state);
    const db = fakeTransferDb({
      rpc: async (_fn, args) => ({
        data: [await run(OWNER, String(args.p_team), String(args.p_new_owner_user_id))],
        error: null,
      }),
    });
    await transferOwnership(db, TEAM, ADMIN);
    expect(state.audit).toHaveLength(2);
    expect(state.audit[0]).toMatchObject({ old_role: "owner", new_role: "admin", actor_id: OWNER });
    expect(state.audit[1]).toMatchObject({ old_role: "admin", new_role: "owner", actor_id: OWNER });
  });

  it("10. a zero-row rpc result is never a success (RLS refusal)", async () => {
    const db = fakeTransferDb({ rpc: async () => ({ data: [], error: null }) });
    const result = await transferOwnership(db, TEAM, ADMIN);
    expect(result.success).toBe(false);
    expect(result).toEqual({ success: false, message: "unavailable", status: 403 });
  });

  it("rejects a malformed team path id as invalid_team_id, not invalid_user_id", async () => {
    let called = false;
    const db = fakeTransferDb({
      rpc: async () => {
        called = true;
        return { data: [], error: null };
      },
    });
    const result = await transferOwnership(db, "not-a-uuid", ADMIN);
    expect(called).toBe(false);
    expect(result).toEqual({ success: false, message: "invalid_team_id", status: 400 });
  });

  it("rejects a malformed recipient id as invalid_user_id", async () => {
    let called = false;
    const db = fakeTransferDb({
      rpc: async () => {
        called = true;
        return { data: [], error: null };
      },
    });
    const result = await transferOwnership(db, TEAM, "not-a-uuid");
    expect(called).toBe(false);
    expect(result).toEqual({ success: false, message: "invalid_user_id", status: 400 });
  });

  it("maps a P0001 restore-failed raise to write_failed, never the SQLSTATE or raise text", async () => {
    const db = fakeTransferDb({
      rpc: async () => ({
        data: null,
        error: { code: "P0001", message: "ownership transfer restore failed for team " + TEAM },
      }),
    });
    const result = await transferOwnership(db, TEAM, ADMIN);
    expect(result).toEqual({ success: false, message: "write_failed", status: 500 });
  });

  it("maps a missing transfer function (PGRST202) to unavailable, never write_failed", async () => {
    const db = fakeTransferDb({
      rpc: async () => ({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function public.transfer_team_ownership in the schema cache" },
      }),
    });
    const result = await transferOwnership(db, TEAM, ADMIN);
    expect(result).toEqual({ success: false, message: "unavailable", status: 403 });
  });

  it("maps a missing transfer function (SQLSTATE 42883) to unavailable, never write_failed", async () => {
    const db = fakeTransferDb({
      rpc: async () => ({
        data: null,
        error: { code: "42883", message: "function public.transfer_team_ownership(uuid, uuid) does not exist" },
      }),
    });
    const result = await transferOwnership(db, TEAM, ADMIN);
    expect(result).toEqual({ success: false, message: "unavailable", status: 403 });
  });
});

describe("TEAM_ROUTE_MESSAGES for transfer codes", () => {
  it("maps each transfer code to a complete EN/ZH pair", () => {
    expect(TEAM_ROUTE_MESSAGES.transfer_requires_admin[0]).toMatch(/^[A-Z].*\.$/);
    expect(TEAM_ROUTE_MESSAGES.same_owner[1]).toBe("你已经是所有者。");
    expect(TEAM_ROUTE_MESSAGES.conflict[1]).toMatch(/[一-鿿]/);
    expect(TEAM_ROUTE_MESSAGES.transfer_success[0]).toMatch(/^[A-Z].*\.$/);
  });
});
