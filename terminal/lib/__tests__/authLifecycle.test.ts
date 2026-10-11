// Auth-lifecycle fence: event/identity policy, containment, and late preview
// replies through the frozen IM10 session reducer. No network: the real
// auth-js client runs on in-memory storage with a fetch that refuses.
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthClient, type Session } from "@supabase/supabase-js";
import {
  subscribeAuthLifecycle,
  type AuthLifecycleSnapshot,
  type AuthObserver,
} from "@/lib/supabase/authLifecycle";
import {
  beginPolicyPreview,
  createPolicyPreviewSession,
  receivePolicyPreview,
  updatePolicyBinding,
  updatePolicyDraft,
  type PolicyPreviewResult,
  type PolicySettings,
  type PolicyValidation,
  type PreviewBinding,
  type PreviewTicket,
} from "@/lib/intlPolicyPreviewSession";

type Emit = (event: string, session: Session | null) => void;

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const HEX32 = /^[0-9a-f]{32}$/;

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
let signature = 0;
// Each token gets a fresh signature, like a rotated token string with the same claims.
const jwt = (claims: Record<string, unknown>) =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.SECRETSIG${++signature}`;

function session(
  sub: string,
  sid: string,
  aal: string | null = "aal1",
  user: Record<string, unknown> | null = { id: sub },
): Session {
  const claims: Record<string, unknown> = { sub, session_id: sid, role: "authenticated" };
  if (aal !== null) claims.aal = aal;
  const s: Record<string, unknown> = {
    access_token: jwt(claims),
    refresh_token: `SECRETREFRESH-${sid}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
  if (user !== null) s.user = { aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "", ...user };
  return s as unknown as Session;
}

const withToken = (token: unknown, sub = USER_A) => ({ ...session(sub, "SECRETSID-x"), access_token: token }) as Session;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function harness() {
  let captured: Emit | null = null;
  const unsubscribe = vi.fn();
  // Every other auth method is a trap: the callback must never call back into Supabase.
  const traps = { getSession: vi.fn(), getUser: vi.fn(), refreshSession: vi.fn(), signOut: vi.fn() };
  const auth = {
    ...traps,
    onAuthStateChange: vi.fn((cb: Emit) => {
      captured = cb;
      return { data: { subscription: { id: "sub-1", callback: cb, unsubscribe } } };
    }),
  };
  const seen: AuthLifecycleSnapshot[] = [];
  const sub = subscribeAuthLifecycle((s) => seen.push(s), () => auth as unknown as AuthObserver);
  const emit: Emit = (event, s) => {
    const ret = (captured as Emit)(event, s);
    expect(ret).toBeUndefined();
  };
  return { sub, emit, seen, unsubscribe, traps, auth, stale: () => captured as Emit };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("event and identity policy (SDK callback contract, mocked client)", () => {
  it("starts pending with an opaque minted epoch and no principal", async () => {
    const h = harness();
    const s0 = h.sub.getSnapshot();
    expect(s0).toEqual({ availability: "pending", principal_partition: null, auth_epoch: expect.stringMatching(HEX32) });
    expect(Object.isFrozen(s0)).toBe(true);
    await flush();
    expect(h.seen).toHaveLength(0);
    expect(h.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
  });

  it("INITIAL_SESSION is storage-loaded: unverified, never ready", async () => {
    const h = harness();
    const e0 = h.sub.getSnapshot().auth_epoch;
    h.emit("INITIAL_SESSION", session(USER_A, "SECRETSID-1"));
    const s1 = h.sub.getSnapshot();
    expect(s1.availability).toBe("unverified");
    expect(s1.principal_partition).toBe(USER_A);
    expect(s1.auth_epoch).not.toBe(e0);
    await flush();
    expect(h.seen).toEqual([s1]);
  });

  it("INITIAL_SESSION with no session is unavailable and keeps the unheld epoch", () => {
    const h = harness();
    const e0 = h.sub.getSnapshot().auth_epoch;
    h.emit("INITIAL_SESSION", null);
    expect(h.sub.getSnapshot()).toEqual({ availability: "unavailable", principal_partition: null, auth_epoch: e0 });
  });

  it("init order SIGNED_IN then INITIAL_SESSION: ready on one epoch, one notification", async () => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    const ready = h.sub.getSnapshot();
    expect(ready.availability).toBe("ready");
    h.emit("INITIAL_SESSION", session(USER_A, "SECRETSID-1"));
    expect(h.sub.getSnapshot()).toBe(ready);
    await flush();
    expect(h.seen).toEqual([ready]);
  });

  it("late subscriber: unverified promotes to ready on a confirming event without a new epoch", () => {
    const h = harness();
    h.emit("INITIAL_SESSION", session(USER_A, "SECRETSID-1"));
    const e1 = h.sub.getSnapshot().auth_epoch;
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    expect(h.sub.getSnapshot()).toEqual({ availability: "ready", principal_partition: USER_A, auth_epoch: e1 });
  });

  it("duplicate, focus or cross-tab SIGNED_IN for the same session is silent", async () => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    const ready = h.sub.getSnapshot();
    await flush();
    for (let i = 0; i < 5; i++) h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    expect(h.sub.getSnapshot()).toBe(ready);
    await flush();
    expect(h.seen).toHaveLength(1);
  });

  it("a new session for the same user gets a new epoch", () => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    const e1 = h.sub.getSnapshot().auth_epoch;
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-2"));
    const s2 = h.sub.getSnapshot();
    expect(s2.principal_partition).toBe(USER_A);
    expect(s2.availability).toBe("ready");
    expect(s2.auth_epoch).toMatch(HEX32);
    expect(s2.auth_epoch).not.toBe(e1);
  });

  it("principal A, B, A gets three distinct epochs; coalesced listeners see only the last", async () => {
    const h = harness();
    const epochs: string[] = [];
    for (const [user, sid] of [[USER_A, "SECRETSID-1"], [USER_B, "SECRETSID-2"], [USER_A, "SECRETSID-1"]]) {
      h.emit("SIGNED_IN", session(user, sid));
      epochs.push(h.sub.getSnapshot().auth_epoch);
    }
    expect(new Set(epochs).size).toBe(3);
    await flush();
    expect(h.seen).toHaveLength(1);
    expect(h.seen[0]).toEqual({ availability: "ready", principal_partition: USER_A, auth_epoch: epochs[2] });
  });

  it("TOKEN_REFRESHED keeps the epoch for the same session and rotates for a different one", () => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    const ready = h.sub.getSnapshot();
    h.emit("TOKEN_REFRESHED", session(USER_A, "SECRETSID-1"));
    expect(h.sub.getSnapshot()).toBe(ready);
    h.emit("TOKEN_REFRESHED", session(USER_A, "SECRETSID-9"));
    expect(h.sub.getSnapshot().auth_epoch).not.toBe(ready.auth_epoch);
    expect(h.sub.getSnapshot().availability).toBe("ready");
  });

  it("USER_UPDATED for the same identity keeps the epoch", () => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    const ready = h.sub.getSnapshot();
    h.emit("USER_UPDATED", session(USER_A, "SECRETSID-1", "aal1", { id: USER_A, email: "changed@example.invalid" }));
    expect(h.sub.getSnapshot()).toBe(ready);
  });

  it("an aal change rotates, and MFA_CHALLENGE_VERIFIED always rotates", () => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1", "aal1"));
    const e1 = h.sub.getSnapshot().auth_epoch;
    h.emit("TOKEN_REFRESHED", session(USER_A, "SECRETSID-1", "aal2"));
    const e2 = h.sub.getSnapshot().auth_epoch;
    expect(e2).not.toBe(e1);
    h.emit("MFA_CHALLENGE_VERIFIED", session(USER_A, "SECRETSID-1", "aal2"));
    const after = h.sub.getSnapshot();
    expect(after.auth_epoch).not.toBe(e2);
    expect(after.availability).toBe("ready");
  });

  it("PASSWORD_RECOVERY rotates and holds unverified until USER_UPDATED", () => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    const e1 = h.sub.getSnapshot().auth_epoch;
    h.emit("PASSWORD_RECOVERY", session(USER_A, "SECRETSID-1"));
    const rec = h.sub.getSnapshot();
    expect(rec.availability).toBe("unverified");
    expect(rec.auth_epoch).not.toBe(e1);
    h.emit("PASSWORD_RECOVERY", session(USER_A, "SECRETSID-1"));
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    h.emit("TOKEN_REFRESHED", session(USER_A, "SECRETSID-1"));
    h.emit("INITIAL_SESSION", session(USER_A, "SECRETSID-1"));
    expect(h.sub.getSnapshot()).toBe(rec);
    h.emit("USER_UPDATED", session(USER_A, "SECRETSID-1"));
    expect(h.sub.getSnapshot()).toEqual({ availability: "ready", principal_partition: USER_A, auth_epoch: rec.auth_epoch });
  });

  it("a different session ends the recovery hold", () => {
    const h = harness();
    h.emit("PASSWORD_RECOVERY", session(USER_A, "SECRETSID-1"));
    const rec = h.sub.getSnapshot();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-2"));
    expect(h.sub.getSnapshot().availability).toBe("ready");
    expect(h.sub.getSnapshot().auth_epoch).not.toBe(rec.auth_epoch);
  });

  const unreadable: Array<[string, () => Session | null]> = [
    ["null session", () => null],
    ["two-part token", () => withToken("a.b")],
    ["non-base64url payload", () => withToken(`x.${"e30="}.y`)],
    ["non-JSON payload", () => withToken(`x.${Buffer.from("not json").toString("base64url")}.y`)],
    ["array payload", () => withToken(`x.${b64url([1])}.y`)],
    ["non-string token", () => withToken(42)],
    ["missing sub", () => withToken(jwt({ session_id: "SECRETSID-1" }))],
    ["missing session_id", () => withToken(jwt({ sub: USER_A }))],
    ["empty session_id", () => withToken(jwt({ sub: USER_A, session_id: "" }))],
    ["non-string aal", () => withToken(jwt({ sub: USER_A, session_id: "SECRETSID-1", aal: 2 }))],
    ["user.id differs from sub", () => session(USER_A, "SECRETSID-1", "aal1", { id: USER_B })],
    [
      "throwing access_token getter",
      () => {
        const s = session(USER_A, "SECRETSID-1") as unknown as Record<string, unknown>;
        Object.defineProperty(s, "access_token", { get() { throw new Error("boom"); } });
        return s as unknown as Session;
      },
    ],
  ];

  it.each(unreadable)("fails closed on %s: unavailable, principal null, new epoch", (_name, make) => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    const e1 = h.sub.getSnapshot().auth_epoch;
    h.emit("SIGNED_IN", make());
    const s = h.sub.getSnapshot();
    expect(s.availability).toBe("unavailable");
    expect(s.principal_partition).toBeNull();
    expect(s.auth_epoch).not.toBe(e1);
  });

  it("SIGNED_OUT and unknown events fail closed even with a readable session", () => {
    for (const event of ["SIGNED_OUT", "USER_DELETED", ""]) {
      const h = harness();
      h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
      const e1 = h.sub.getSnapshot().auth_epoch;
      h.emit(event, session(USER_A, "SECRETSID-1"));
      expect(h.sub.getSnapshot()).toEqual({ availability: "unavailable", principal_partition: null, auth_epoch: expect.not.stringMatching(e1) });
    }
  });

  it("an unreadable user (auth-js user-not-available proxy) leaves sub as the identity", () => {
    const h = harness();
    const s = session(USER_A, "SECRETSID-1", "aal1", null) as unknown as Record<string, unknown>;
    s.user = new Proxy({}, { get() { throw new Error("user not available"); } });
    h.emit("SIGNED_IN", s as unknown as Session);
    expect(h.sub.getSnapshot()).toMatchObject({ availability: "ready", principal_partition: USER_A });
    const h2 = harness();
    h2.emit("SIGNED_IN", session(USER_A, "SECRETSID-1", null, null));
    expect(h2.sub.getSnapshot()).toMatchObject({ availability: "ready", principal_partition: USER_A });
  });

  it("the callback never calls back into Supabase and never notifies synchronously", async () => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    h.emit("TOKEN_REFRESHED", session(USER_A, "SECRETSID-2"));
    h.emit("SIGNED_OUT", null);
    expect(h.seen).toHaveLength(0);
    for (const trap of Object.values(h.traps)) expect(trap).not.toHaveBeenCalled();
    await flush();
    expect(h.seen).toHaveLength(1);
  });

  it("exposes exactly three fields and no token, session id, aal or refresh material", async () => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1", "aal2"));
    await flush();
    for (const s of [h.sub.getSnapshot(), ...h.seen]) {
      expect(Object.keys(s).sort()).toEqual(["auth_epoch", "availability", "principal_partition"]);
      const text = JSON.stringify(s);
      expect(text).not.toMatch(/SECRET|aal|session|token|refresh/i);
    }
  });
});

describe("setup, cleanup and containment", () => {
  it("a throwing factory fails closed", () => {
    const sub = subscribeAuthLifecycle(() => {}, () => { throw new Error("no client"); });
    expect(sub.getSnapshot()).toMatchObject({ availability: "unavailable", principal_partition: null });
    expect(() => sub.unsubscribe()).not.toThrow();
  });

  it("a throwing or malformed subscription fails closed and leaves the callback inert", async () => {
    const throwing = subscribeAuthLifecycle(() => {}, () => ({ onAuthStateChange: () => { throw new Error("x"); } }) as unknown as AuthObserver);
    expect(throwing.getSnapshot().availability).toBe("unavailable");
    let cb: Emit | null = null;
    const listener = vi.fn();
    const bad = subscribeAuthLifecycle(listener, () => ({ onAuthStateChange: (c: Emit) => { cb = c; return {}; } }) as unknown as AuthObserver);
    const before = bad.getSnapshot();
    expect(before.availability).toBe("unavailable");
    (cb as unknown as Emit)("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    expect(bad.getSnapshot()).toBe(before);
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });

  it("a callback delivered synchronously during subscribe is honoured", async () => {
    const listener = vi.fn();
    const sub = subscribeAuthLifecycle(listener, () => ({
      onAuthStateChange: (c: Emit) => {
        c("SIGNED_IN", session(USER_A, "SECRETSID-1"));
        return { data: { subscription: { unsubscribe() {} } } };
      },
    }) as unknown as AuthObserver);
    expect(sub.getSnapshot()).toMatchObject({ availability: "ready", principal_partition: USER_A });
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe detaches once, retires the identity, and ignores stale callbacks and pending notifications", async () => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    const e1 = h.sub.getSnapshot().auth_epoch;
    h.sub.unsubscribe();
    h.sub.unsubscribe();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    const closed = h.sub.getSnapshot();
    expect(closed).toMatchObject({ availability: "unavailable", principal_partition: null });
    expect(closed.auth_epoch).not.toBe(e1);
    h.stale()("SIGNED_IN", session(USER_B, "SECRETSID-2"));
    expect(h.sub.getSnapshot()).toBe(closed);
    await flush();
    expect(h.seen).toHaveLength(0);
  });

  it("a throwing listener is contained and later changes still notify", async () => {
    let calls = 0;
    let cb: Emit | null = null;
    subscribeAuthLifecycle(() => { calls++; throw new Error("consumer bug"); }, () => ({
      onAuthStateChange: (c: Emit) => { cb = c; return { data: { subscription: { unsubscribe() {} } } }; },
    }) as unknown as AuthObserver);
    (cb as unknown as Emit)("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    await flush();
    (cb as unknown as Emit)("SIGNED_IN", session(USER_B, "SECRETSID-2"));
    await flush();
    expect(calls).toBe(2);
  });

  it("no source of randomness means unavailable, never a manufactured ready epoch", () => {
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(() => { throw new Error("no rng"); });
    const factory = vi.fn();
    const sub = subscribeAuthLifecycle(() => {}, factory as unknown as () => AuthObserver);
    expect(sub.getSnapshot()).toEqual({ availability: "unavailable", principal_partition: null, auth_epoch: "" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("losing randomness mid-life fails closed and cannot return to ready on an old epoch", () => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    const e1 = h.sub.getSnapshot().auth_epoch;
    const rng = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(() => { throw new Error("no rng"); });
    h.emit("SIGNED_IN", session(USER_B, "SECRETSID-2"));
    expect(h.sub.getSnapshot()).toEqual({ availability: "unavailable", principal_partition: null, auth_epoch: e1 });
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    expect(h.sub.getSnapshot().availability).toBe("unavailable");
    rng.mockRestore();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    expect(h.sub.getSnapshot().availability).toBe("ready");
    expect(h.sub.getSnapshot().auth_epoch).not.toBe(e1);
  });
});

describe("real auth-js client (in-memory storage, no network)", () => {
  const KEY = "sb-authlifecycle-test-auth-token";
  type Internals = {
    _notifyAllSubscribers(event: string, session: Session | null): Promise<void>;
    _removeSession(): Promise<void>;
    stateChangeEmitters: Map<string, unknown>;
  };

  function realClient(stored: Session | null, skipAutoInitialize = false) {
    const map = new Map<string, string>();
    if (stored) map.set(KEY, JSON.stringify(stored));
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
    };
    const fetch = vi.fn(async () => { throw new Error("network is not allowed in this test"); });
    const client = new AuthClient({
      url: "http://auth.invalid/auth/v1",
      storageKey: KEY,
      storage,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      skipAutoInitialize,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    return { client, internals: client as unknown as Internals, fetch, map };
  }

  it("a subscriber attaching after init hears only INITIAL_SESSION and stays unverified", async () => {
    const stored = session(USER_A, "SECRETSID-1");
    const { client, internals, fetch } = realClient(stored);
    await client.initialize();
    const sub = subscribeAuthLifecycle(() => {}, () => client);
    await vi.waitFor(() => expect(sub.getSnapshot().availability).toBe("unverified"));
    const unverified = sub.getSnapshot();
    expect(unverified.principal_partition).toBe(USER_A);
    await internals._notifyAllSubscribers("SIGNED_IN", stored);
    expect(sub.getSnapshot()).toEqual({ ...unverified, availability: "ready" });
    expect(fetch).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it("a subscriber attaching before init reaches ready on the init SIGNED_IN, one epoch", async () => {
    const stored = session(USER_A, "SECRETSID-1");
    const { client, fetch } = realClient(stored, true);
    const sub = subscribeAuthLifecycle(() => {}, () => client);
    await client.initialize();
    await vi.waitFor(() => expect(sub.getSnapshot().availability).toBe("ready"));
    const ready = sub.getSnapshot();
    await flush();
    expect(sub.getSnapshot()).toBe(ready);
    expect(ready.principal_partition).toBe(USER_A);
    expect(fetch).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it("a hostile session cannot make the SDK notification reject (control: a raw throwing subscriber does)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stored = session(USER_A, "SECRETSID-1");
    const { client, internals } = realClient(stored);
    await client.initialize();
    const sub = subscribeAuthLifecycle(() => { throw new Error("consumer bug"); }, () => client);
    await vi.waitFor(() => expect(sub.getSnapshot().availability).toBe("unverified"));
    const hostile = session(USER_A, "SECRETSID-1") as unknown as Record<string, unknown>;
    Object.defineProperty(hostile, "access_token", { get() { throw new Error("boom"); } });
    await expect(internals._notifyAllSubscribers("SIGNED_IN", hostile as unknown as Session)).resolves.toBeUndefined();
    expect(sub.getSnapshot()).toMatchObject({ availability: "unavailable", principal_partition: null });
    await flush();

    const raw = client.onAuthStateChange((event) => { if (event === "SIGNED_IN") throw new Error("raw"); });
    await flush();
    await expect(internals._notifyAllSubscribers("SIGNED_IN", stored)).rejects.toThrow("raw");
    raw.data.subscription.unsubscribe();
    sub.unsubscribe();
  });

  it("a real sign-out retires the identity; unsubscribe removes the SDK emitter", async () => {
    const stored = session(USER_A, "SECRETSID-1");
    const { client, internals, map, fetch } = realClient(stored);
    await client.initialize();
    const before = internals.stateChangeEmitters.size;
    const sub = subscribeAuthLifecycle(() => {}, () => client);
    expect(internals.stateChangeEmitters.size).toBe(before + 1);
    await vi.waitFor(() => expect(sub.getSnapshot().availability).toBe("unverified"));
    const e1 = sub.getSnapshot().auth_epoch;
    await internals._removeSession();
    expect(map.has(KEY)).toBe(false);
    expect(sub.getSnapshot()).toMatchObject({ availability: "unavailable", principal_partition: null });
    expect(sub.getSnapshot().auth_epoch).not.toBe(e1);
    sub.unsubscribe();
    expect(internals.stateChangeEmitters.size).toBe(before);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("late preview replies through the frozen IM10 session reducer", () => {
  const BINDING: PreviewBinding = {
    principal_partition: null, auth_epoch: "", saved_id: "saved-1", saved_revision: 4,
    source_generation: "gen-1", instrument_mapping_identity: "map-1", qualification_identity: "qual-1",
  };
  const SETTINGS: PolicySettings = {
    economy_a: "DE", economy_b: "FR", lens: "nominal_policy_point_gap",
    definition: "absolute_gap_change_bp", method_version: "mv-7",
    period: { mode: "fixed_dates", start: "2026-01-31", end: "2026-02-28" },
    instrument_a_ref: "ins-a", instrument_b_ref: "ins-b", revision_policy: "latest_vintage",
  };
  const OK: PolicyValidation = { ok: true, settings: structuredClone(SETTINGS) };
  const qReply = (t: PreviewTicket): PolicyPreviewResult =>
    ({ state: "qualified", identity: { binding: structuredClone(t.binding), settings: structuredClone(t.settings) },
      signed_start_bp: 12.5, signed_end_bp: -3.25, signed_change_bp: -15.75,
      absolute_change_bp: 15.75, direction: "widened", crosses_zero: true }) as PolicyPreviewResult;
  const bindingFrom = (s: AuthLifecycleSnapshot): PreviewBinding =>
    ({ ...BINDING, principal_partition: s.principal_partition, auth_epoch: s.auth_epoch });

  /** Begin a preview while ready, run the events, apply only the latest snapshot, then deliver the reply. */
  async function lateReply(events: Array<[string, Session | null]>) {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    expect(h.sub.getSnapshot().availability).toBe("ready");
    const begun = beginPolicyPreview(updatePolicyDraft(createPolicyPreviewSession(bindingFrom(h.sub.getSnapshot())), OK));
    const ticket = begun.ticket as PreviewTicket;
    expect(ticket).not.toBeNull();
    for (const [event, s] of events) h.emit(event, s);
    await flush();
    const rebound = updatePolicyBinding(begun.state, bindingFrom(h.sub.getSnapshot()));
    const after = receivePolicyPreview(rebound, ticket, qReply(ticket));
    return { rebound, after, h };
  }

  const dropped: Array<[string, Array<[string, Session | null]>]> = [
    ["a new session for the same user", [["SIGNED_IN", session(USER_A, "SECRETSID-2")]]],
    ["principal A, B, A on the original session", [["SIGNED_IN", session(USER_B, "SECRETSID-3")], ["SIGNED_IN", session(USER_A, "SECRETSID-1")]]],
    ["sign-out then the same session back", [["SIGNED_OUT", null], ["SIGNED_IN", session(USER_A, "SECRETSID-1")]]],
    ["sign-out", [["SIGNED_OUT", null]]],
    ["MFA step-up on the same session", [["MFA_CHALLENGE_VERIFIED", session(USER_A, "SECRETSID-1", "aal2")]]],
    ["password recovery", [["PASSWORD_RECOVERY", session(USER_A, "SECRETSID-1")]]],
    ["a refresh onto a different session", [["TOKEN_REFRESHED", session(USER_A, "SECRETSID-4")]]],
    ["an unreadable session", [["SIGNED_IN", withToken("a.b")], ["SIGNED_IN", session(USER_A, "SECRETSID-1")]]],
  ];

  it.each(dropped)("drops the late reply after %s", async (_name, events) => {
    const { rebound, after } = await lateReply(events);
    expect(rebound.pending).toBeNull();
    expect(after).toBe(rebound);
    expect(after.preview).toBeNull();
  });

  const accepted: Array<[string, Array<[string, Session | null]>]> = [
    ["duplicate and focus SIGNED_IN", [["SIGNED_IN", session(USER_A, "SECRETSID-1")], ["SIGNED_IN", session(USER_A, "SECRETSID-1")]]],
    ["a same-session TOKEN_REFRESHED", [["TOKEN_REFRESHED", session(USER_A, "SECRETSID-1")]]],
    ["USER_UPDATED", [["USER_UPDATED", session(USER_A, "SECRETSID-1")]]],
    ["a late INITIAL_SESSION", [["INITIAL_SESSION", session(USER_A, "SECRETSID-1")]]],
  ];

  it.each(accepted)("accepts the reply after %s", async (_name, events) => {
    const { rebound, after } = await lateReply(events);
    expect(rebound.pending).not.toBeNull();
    expect(after.pending).toBeNull();
    expect(after.preview?.state).toBe("qualified");
  });

  it("an unverified-to-ready promotion keeps the draft; INITIAL_SESSION alone does not allow a ready preview", async () => {
    const h = harness();
    h.emit("INITIAL_SESSION", session(USER_A, "SECRETSID-1"));
    expect(h.sub.getSnapshot().availability).not.toBe("ready");
    const drafted = updatePolicyDraft(createPolicyPreviewSession(bindingFrom(h.sub.getSnapshot())), OK);
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    expect(h.sub.getSnapshot().availability).toBe("ready");
    expect(updatePolicyBinding(drafted, bindingFrom(h.sub.getSnapshot()))).toBe(drafted);
  });
});
