/**
 * The usage authority (E4).
 *
 * `SettingsPanel` cached `/api/brain/me` by EMAIL and never re-fetched it for the life of the
 * mounted shell. On /terminal that shell lives for a whole session — and the remaining-questions
 * count is the number most likely of all to have moved, because the user spends it from inside
 * the very same page. So the meters could sit showing an hour-old answer while the user watched
 * them.
 *
 * Policy asserted here: verify on Usage ENTRY, re-verify on re-entry past a bounded TTL, never
 * carry a count across owners, and never report an unreachable gateway as "no quota".
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ownerKeyFor, GUEST_OWNER } from "@/lib/accountIdentity";
import {
  __adoptUsageOwner, __resetUsageStore, __usageSnapshot, refreshUsage, usageView, USAGE_TTL_MS,
} from "@/lib/usageStore";

const OWNER_A = ownerKeyFor("8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22");
const OWNER_B = ownerKeyFor("0b6d1f57-3c84-4a11-8e29-6d40cc1b7f93");

const RICH = { tier: "pro", quotas: { fast: { remaining: 120, limit: 200, period: "month" }, pro: { remaining: 4, limit: 10 } } };
const SPENT = { tier: "pro", quotas: { fast: { remaining: 3, limit: 200, period: "month" }, pro: { remaining: 0, limit: 10 } } };

let respond: () => Promise<Response>;
let calls = 0;

const json = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  calls = 0;
  respond = async () => json(RICH);
  (globalThis as unknown as { fetch: unknown }).fetch = () => { calls += 1; return respond(); };
  __resetUsageStore();
});
afterEach(() => { delete (globalThis as unknown as { fetch?: unknown }).fetch; });

describe("verification is tied to looking at the meters", () => {
  it("does not ask while the Usage section is not on screen", async () => {
    __adoptUsageOwner(OWNER_A, false);
    await settle();
    expect(calls).toBe(0);
    expect(__usageSnapshot().state).toBe("LOADING");
  });

  it("asks on entry, and reads the lanes back", async () => {
    __adoptUsageOwner(OWNER_A);
    await settle();
    expect(calls).toBe(1);
    const view = usageView();
    expect(view.quotas).toEqual({
      fast: { remaining: 120, limit: 200, period: "month" },
      pro: { remaining: 4, limit: 10 },
    });
    expect(view.stale).toBe(false);
  });

  it("re-entry inside the TTL costs nothing; past it, the count is re-read", async () => {
    const t0 = 1_000_000;
    __adoptUsageOwner(OWNER_A, true, t0);
    await settle();
    expect(calls).toBe(1);

    // The user leaves Usage and comes straight back.
    refreshUsage(false, t0 + USAGE_TTL_MS - 1);
    await settle();
    expect(calls).toBe(1);

    // …and comes back later, having spent most of the lane in the meantime.
    respond = async () => json(SPENT);
    refreshUsage(false, Date.now() + USAGE_TTL_MS + 1);
    await settle();
    expect(calls).toBe(2);
    expect(usageView().quotas?.fast?.remaining).toBe(3);
  });

  it("never asks for a guest", async () => {
    __adoptUsageOwner(GUEST_OWNER);
    refreshUsage(true);
    await settle();
    expect(calls).toBe(0);
    expect(usageView().quotas).toBeNull();
  });
});

describe("failure is not an empty quota", () => {
  it("reports UNAVAILABLE when nothing same-owner is known", async () => {
    respond = async () => json({ error: "gateway" }, 503);
    __adoptUsageOwner(OWNER_A);
    await settle();
    const view = usageView();
    expect(view.unavailable).toBe(true);
    expect(view.quotas).toBeNull();     // the pane shows an error, not "0 left"
  });

  it("keeps a same-owner last-good and flags it stale", async () => {
    __adoptUsageOwner(OWNER_A);
    await settle();

    respond = async () => { throw new Error("offline"); };
    refreshUsage(true);
    await settle();

    const view = usageView();
    expect(view.stale).toBe(true);
    expect(view.quotas?.fast?.remaining).toBe(120);
  });
});

describe("the owner boundary", () => {
  it("drops the outgoing owner's meters synchronously on a switch", async () => {
    __adoptUsageOwner(OWNER_A);
    await settle();
    expect(usageView().quotas).not.toBeNull();

    respond = () => new Promise<Response>(() => {});
    __adoptUsageOwner(OWNER_B);
    const mid = __usageSnapshot();
    expect(mid.owner).toBe(OWNER_B);
    expect(mid.usage).toBeNull();
    expect(mid.state).toBe("LOADING");
  });

  it("never shows one account's remaining questions under another", async () => {
    __adoptUsageOwner(OWNER_A);
    await settle();

    respond = async () => json({ error: "gateway" }, 503);
    __adoptUsageOwner(OWNER_B);
    await settle();

    const view = usageView();
    expect(view.quotas).toBeNull();
    expect(view.stale).toBe(false);      // there is no B last-good to be stale ABOUT
    expect(view.unavailable).toBe(true);
  });

  it("ignores an answer that arrives after the owner changed", async () => {
    let release: (r: Response) => void = () => {};
    respond = () => new Promise<Response>((res) => { release = res; });
    __adoptUsageOwner(OWNER_A);

    respond = async () => json(SPENT);
    __adoptUsageOwner(OWNER_B);
    await settle();

    release(json(RICH));                 // A's answer, long after A stopped being the owner
    await settle();

    expect(__usageSnapshot().owner).toBe(OWNER_B);
    expect(usageView().quotas?.fast?.remaining).toBe(3);
  });
});
