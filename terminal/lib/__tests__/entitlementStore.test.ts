/**
 * The canonical entitlement store (E3).
 *
 * Two independent client truths used to exist for one question, with opposite failure semantics:
 *
 *   * `lib/useEntitlement.ts` turned an AUTHENTICATED failure into `free`, so a 503 from billing
 *     told a paying customer they were on the free plan;
 *   * `SettingsPanel` kept its own email-keyed cache for Billing and never revalidated it.
 *
 * The repair is one owner-scoped state with SIX values and TWO selectors that deliberately
 * disagree — display may show a same-owner last-good, the gate may not. Every case below fails if
 * either half is collapsed back into the other.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ownerKeyFor, GUEST_OWNER } from "@/lib/accountIdentity";
import {
  __adoptEntitlementOwner, __entitlementSnapshot, __resetEntitlementStore,
  displayEntitlement, gateEntitlement, invalidateEntitlement, refreshEntitlement,
} from "@/lib/entitlementStore";

const UUID_A = "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22";
const UUID_B = "0b6d1f57-3c84-4a11-8e29-6d40cc1b7f93";
const OWNER_A = ownerKeyFor(UUID_A);
const OWNER_B = ownerKeyFor(UUID_B);

const PRO = { tier: "pro", status: "active", interval: "annual", features: ["terminal_live_options"] };
const FREE = { tier: "free", status: "none", features: [] as string[] };

let respond: () => Promise<Response>;
let calls = 0;

const json = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  calls = 0;
  respond = async () => json(FREE);
  (globalThis as unknown as { fetch: unknown }).fetch = () => { calls += 1; return respond(); };
  __resetEntitlementStore();
});

afterEach(() => {
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
});

describe("a guest costs nothing to establish", () => {
  it("is free by definition, with no request", async () => {
    __adoptEntitlementOwner(GUEST_OWNER);
    await settle();
    expect(calls).toBe(0);
    expect(__entitlementSnapshot().state).toBe("GUEST_FREE");
    expect(gateEntitlement().tier).toBe("free");
  });
});

describe("a failed verification is NOT a free account", () => {
  it("reports UNAVAILABLE on a 503 — the old hook reported `free`", async () => {
    respond = async () => json({ error: "gateway" }, 503);
    __adoptEntitlementOwner(OWNER_A);
    await settle();

    const snap = __entitlementSnapshot();
    expect(snap.state).toBe("UNAVAILABLE");
    // The gate still fails closed — but the STATE says why, which is what the pane needs to
    // avoid telling a subscriber they are on Free.
    expect(displayEntitlement(snap).unavailable).toBe(true);
    expect(gateEntitlement(snap).unverified).toBe(true);
  });

  it("reports UNAVAILABLE on a network error too", async () => {
    respond = async () => { throw new Error("offline"); };
    __adoptEntitlementOwner(OWNER_A);
    await settle();
    expect(__entitlementSnapshot().state).toBe("UNAVAILABLE");
  });
});

describe("same-owner last good", () => {
  it("keeps showing a verified PAID plan when a later refresh fails, flagged stale", async () => {
    respond = async () => json(PRO);
    __adoptEntitlementOwner(OWNER_A);
    await settle();
    expect(__entitlementSnapshot().state).toBe("VERIFIED_PAID");

    respond = async () => json({ error: "gateway" }, 503);
    refreshEntitlement(true);
    await settle();

    const snap = __entitlementSnapshot();
    expect(snap.state).toBe("STALE_LAST_GOOD");

    // DISPLAY: the customer still sees Pro, labelled as unrefreshed.
    const shown = displayEntitlement(snap);
    expect(shown.tier).toBe("pro");
    expect(shown.stale).toBe(true);
    expect(shown.unavailable).toBe(false);

    // GATE: fails closed. A stale Paid never NEWLY unlocks protected capability.
    const gate = gateEntitlement(snap);
    expect(gate.tier).toBe("free");
    expect(gate.features).toEqual([]);
    expect(gate.unverified).toBe(true);
  });

  it("never carries a last-good across owners", async () => {
    respond = async () => json(PRO);
    __adoptEntitlementOwner(OWNER_A);
    await settle();
    expect(displayEntitlement().tier).toBe("pro");

    // B signs in and its verification fails. B must not inherit A's Pro — not as a gate, and
    // not even as a "stale" display.
    respond = async () => json({ error: "gateway" }, 503);
    __adoptEntitlementOwner(OWNER_B);
    await settle();

    const snap = __entitlementSnapshot();
    expect(snap.owner).toBe(OWNER_B);
    expect(snap.plan).toBeNull();
    expect(snap.state).toBe("UNAVAILABLE");
    expect(displayEntitlement(snap).tier).toBe("free");
    expect(displayEntitlement(snap).stale).toBe(false);
  });

  it("drops the outgoing owner's plan SYNCHRONOUSLY, before the incoming answer lands", async () => {
    respond = async () => json(PRO);
    __adoptEntitlementOwner(OWNER_A);
    await settle();

    respond = () => new Promise<Response>(() => {});   // B's request never resolves
    __adoptEntitlementOwner(OWNER_B);

    const mid = __entitlementSnapshot();
    expect(mid.owner).toBe(OWNER_B);
    expect(mid.plan).toBeNull();
    expect(mid.state).toBe("LOADING");
  });

  it("ignores an answer that arrives after the owner changed", async () => {
    let release: (r: Response) => void = () => {};
    respond = () => new Promise<Response>((res) => { release = res; });
    __adoptEntitlementOwner(OWNER_A);

    respond = async () => json(FREE);
    __adoptEntitlementOwner(OWNER_B);
    await settle();

    release(json(PRO));       // A's answer, long after A stopped being the owner
    await settle();

    expect(__entitlementSnapshot().owner).toBe(OWNER_B);
    expect(gateEntitlement().tier).toBe("free");
  });
});

describe("verification and revalidation", () => {
  it("verifies a paid tier and grants it through the gate", async () => {
    respond = async () => json(PRO);
    __adoptEntitlementOwner(OWNER_A);
    await settle();

    const gate = gateEntitlement();
    expect(gate.tier).toBe("pro");
    expect(gate.features).toEqual(["terminal_live_options"]);
    expect(gate.unverified).toBe(false);
  });

  it("normalizes the legacy `insider` tier inbound", async () => {
    respond = async () => json({ tier: "insider", status: "trialing", features: [] });
    __adoptEntitlementOwner(OWNER_A);
    await settle();
    expect(gateEntitlement().tier).toBe("essential");
    expect(__entitlementSnapshot().state).toBe("VERIFIED_PAID");
  });

  it("keeps the current plan visible while a refresh is in flight, rather than blanking it", async () => {
    respond = async () => json(PRO);
    __adoptEntitlementOwner(OWNER_A);
    await settle();

    respond = () => new Promise<Response>(() => {});
    refreshEntitlement(true);
    expect(displayEntitlement().tier).toBe("pro");
    expect(displayEntitlement().loading).toBe(false);
  });

  it("invalidate() drops the old plan and re-asks — a user who just upgraded is not shown Free", async () => {
    respond = async () => json(FREE);
    __adoptEntitlementOwner(OWNER_A);
    await settle();
    expect(displayEntitlement().tier).toBe("free");

    // …the user completes a checkout. Without the invalidation the pane keeps the pre-purchase
    // answer for the life of the mounted shell.
    respond = async () => json(PRO);
    invalidateEntitlement();
    await settle();

    expect(displayEntitlement().tier).toBe("pro");
    expect(__entitlementSnapshot().state).toBe("VERIFIED_PAID");
  });

  it("orphans an in-flight PRE-change answer when invalidate() runs", async () => {
    let release: (r: Response) => void = () => {};
    respond = () => new Promise<Response>((res) => { release = res; });
    __adoptEntitlementOwner(OWNER_A);

    respond = async () => json(PRO);
    invalidateEntitlement();       // the plan changed; the outstanding read describes the old one
    await settle();

    release(json(FREE));           // the pre-change answer finally lands
    await settle();

    expect(displayEntitlement().tier).toBe("pro");
  });

  it("does not open a second request while one is already out", async () => {
    respond = () => new Promise<Response>(() => {});
    __adoptEntitlementOwner(OWNER_A);
    refreshEntitlement();
    refreshEntitlement();
    expect(calls).toBe(1);
  });

  it("never asks on behalf of a guest, even when told to refresh", async () => {
    __adoptEntitlementOwner(GUEST_OWNER);
    refreshEntitlement(true);
    invalidateEntitlement();
    await settle();
    expect(calls).toBe(0);
  });
});

describe("the gate and the display are not the same answer", () => {
  it("disagree exactly where they should: stale paid shows Pro but gates Free", async () => {
    respond = async () => json(PRO);
    __adoptEntitlementOwner(OWNER_A);
    await settle();
    respond = async () => { throw new Error("offline"); };
    refreshEntitlement(true);
    await settle();

    expect([displayEntitlement().tier, gateEntitlement().tier]).toEqual(["pro", "free"]);
  });

  it("agree when the answer is verified", async () => {
    respond = async () => json(PRO);
    __adoptEntitlementOwner(OWNER_A);
    await settle();
    expect([displayEntitlement().tier, gateEntitlement().tier]).toEqual(["pro", "pro"]);
  });
});

describe("regression guard: the dependency is the OWNER, not `!!email`", () => {
  it("re-verifies for a different account, and not for the same one", async () => {
    respond = async () => json(FREE);
    __adoptEntitlementOwner(OWNER_A);
    await settle();
    expect(calls).toBe(1);

    __adoptEntitlementOwner(OWNER_A);     // same account, e.g. after an email change
    await settle();
    expect(calls).toBe(1);

    __adoptEntitlementOwner(OWNER_B);     // a different account at the same address
    await settle();
    expect(calls).toBe(2);
  });
});

describe("payload narrowing", () => {
  it("survives a junk body without throwing, and treats it as free", async () => {
    respond = async () => json("not-an-object");
    __adoptEntitlementOwner(OWNER_A);
    await settle();
    expect(__entitlementSnapshot().state).toBe("VERIFIED_FREE");
    expect(gateEntitlement().features).toEqual([]);
  });

  it("keeps the metered lanes the Billing hero and Usage fallback read", async () => {
    respond = async () => json({
      ...PRO,
      current_period_end: "2027-01-01T00:00:00.000Z",
      source: "stripe",
      chat_budget: { fast: { remaining: 40, limit: 200, period: "month" }, pro: { remaining: 2, limit: 10 } },
    });
    __adoptEntitlementOwner(OWNER_A);
    await settle();
    const plan = displayEntitlement().plan!;
    expect(plan.current_period_end).toBe("2027-01-01T00:00:00.000Z");
    expect(plan.source).toBe("stripe");
    expect(plan.chat_budget).toEqual({
      fast: { remaining: 40, limit: 200, period: "month" },
      pro: { remaining: 2, limit: 10 },
    });
  });
});
