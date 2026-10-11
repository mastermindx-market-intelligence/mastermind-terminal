// Auth-lifecycle fence: observation vs SDK verification, the generation fence,
// containment, and late preview replies through the frozen IM10 session
// reducer. No live network: the mocked observer resolves getClaims by hand, and
// the real auth-js client runs on in-memory storage with a mocked fetch that
// serves only a test JWKS and a test PUT /user, and refuses everything else.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const claimsOf = (token: string) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
const inAnHour = () => Math.floor(Date.now() / 1000) + 3600;
let signature = 0;
// Each token gets a fresh signature, like a rotated token string with the same claims.
const jwt = (claims: Record<string, unknown>) =>
  `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(claims)}.SECRETSIG${++signature}`;

function idClaims(sub: string, sid: string, aal: string | null = "aal1"): Record<string, unknown> {
  const claims: Record<string, unknown> = { sub, session_id: sid, role: "authenticated", exp: inAnHour() };
  if (aal !== null) claims.aal = aal;
  return claims;
}

function sessionFor(token: string, user: Record<string, unknown> | null): Session {
  const s: Record<string, unknown> = {
    access_token: token,
    refresh_token: "SECRETREFRESH-1",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: inAnHour(),
  };
  if (user !== null) s.user = { aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "", ...user };
  return s as unknown as Session;
}

function session(
  sub: string,
  sid: string,
  aal: string | null = "aal1",
  user: Record<string, unknown> | null = { id: sub },
): Session {
  return sessionFor(jwt(idClaims(sub, sid, aal)), user);
}

const withToken = (token: unknown, sub = USER_A) => ({ ...session(sub, "SECRETSID-x"), access_token: token }) as Session;
const verified = (token: string) => ({ data: { claims: claimsOf(token), header: {}, signature: new Uint8Array() }, error: null });

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type Check = { token: string; resolve(v: unknown): void; reject(e: unknown): void; done: boolean };

function harness() {
  let captured: Emit | null = null;
  let inCallback = false;
  let callsInCallback = 0;
  const unsubscribe = vi.fn();
  // Every other auth method is a trap: the callback must never call back into Supabase.
  const traps = { getSession: vi.fn(), getUser: vi.fn(), refreshSession: vi.fn(), signOut: vi.fn() };
  const checks: Check[] = [];
  const getClaims = vi.fn((token: string) => {
    if (inCallback) callsInCallback++;
    return new Promise((resolve, reject) => {
      const c: Check = { token, done: false, resolve: (v) => { c.done = true; resolve(v); }, reject: (e) => { c.done = true; reject(e); } };
      checks.push(c);
    });
  });
  const auth = {
    ...traps,
    getClaims,
    onAuthStateChange: vi.fn((cb: Emit) => {
      captured = cb;
      return { data: { subscription: { id: "sub-1", callback: cb, unsubscribe } } };
    }),
  };
  const seen: AuthLifecycleSnapshot[] = [];
  const sub = subscribeAuthLifecycle((s) => seen.push(s), () => auth as unknown as AuthObserver);
  const emit: Emit = (event, s) => {
    inCallback = true;
    try {
      const ret = (captured as Emit)(event, s);
      expect(ret).toBeUndefined();
    } finally {
      inCallback = false;
    }
  };
  const last = () => checks[checks.length - 1];
  /** Settle one check with a result (default: the SDK verifying its exact token),
   * let it apply, then let the coalesced notice go out. */
  const settle = async (c: Check = last(), result: unknown = verified(c.token)) => {
    c.resolve(result);
    await flush();
    await flush();
  };
  /** Emit, let the deferred check start, and verify it. */
  const confirm = async (event: string, s: Session) => {
    emit(event, s);
    await flush();
    await settle();
    return sub.getSnapshot();
  };
  const h = {
    sub, emit, seen, unsubscribe, traps, auth, getClaims, checks, last, settle, confirm,
    callsInCallback: () => callsInCallback,
    stale: () => captured as Emit,
  };
  return h;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("observation is never verification (mocked client)", () => {
  it("starts pending with an opaque minted epoch and no principal", async () => {
    const h = harness();
    const s0 = h.sub.getSnapshot();
    expect(s0).toEqual({ availability: "pending", principal_partition: null, auth_epoch: expect.stringMatching(HEX32) });
    expect(Object.isFrozen(s0)).toBe(true);
    await flush();
    expect(h.seen).toHaveLength(0);
    expect(h.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
    expect(h.getClaims).not.toHaveBeenCalled();
  });

  it("a storage-only SIGNED_IN stays unverified until the deferred SDK check verifies that exact token", async () => {
    const h = harness();
    const e0 = h.sub.getSnapshot().auth_epoch;
    const s = session(USER_A, "SECRETSID-1");
    h.emit("SIGNED_IN", s);
    const unverified = h.sub.getSnapshot();
    expect(unverified).toEqual({ availability: "unverified", principal_partition: USER_A, auth_epoch: expect.stringMatching(HEX32) });
    expect(unverified.auth_epoch).not.toBe(e0);
    expect(h.getClaims).not.toHaveBeenCalled();
    await flush();
    expect(h.getClaims).toHaveBeenCalledTimes(1);
    expect(h.getClaims).toHaveBeenCalledWith(s.access_token);
    expect(h.callsInCallback()).toBe(0);
    await flush();
    expect(h.sub.getSnapshot()).toBe(unverified);
    await h.settle();
    expect(h.sub.getSnapshot()).toEqual({ ...unverified, availability: "ready" });
    expect(h.seen).toEqual([unverified, { ...unverified, availability: "ready" }]);
  });

  it("INITIAL_SESSION is storage-loaded: unverified, ready only after verification on the same epoch", async () => {
    const h = harness();
    h.emit("INITIAL_SESSION", session(USER_A, "SECRETSID-1"));
    const s1 = h.sub.getSnapshot();
    expect(s1.availability).toBe("unverified");
    expect(s1.principal_partition).toBe(USER_A);
    await flush();
    expect(h.seen).toEqual([s1]);
    await h.settle();
    expect(h.sub.getSnapshot()).toEqual({ ...s1, availability: "ready" });
  });

  it("INITIAL_SESSION with no session is unavailable, keeps the unheld epoch and starts no check", async () => {
    const h = harness();
    const e0 = h.sub.getSnapshot().auth_epoch;
    h.emit("INITIAL_SESSION", null);
    expect(h.sub.getSnapshot()).toEqual({ availability: "unavailable", principal_partition: null, auth_epoch: e0 });
    await flush();
    expect(h.getClaims).not.toHaveBeenCalled();
  });

  it("a proxy, null or missing user never reaches ready on decoded claims alone", async () => {
    const proxy = session(USER_A, "SECRETSID-1", "aal1", null) as unknown as Record<string, unknown>;
    proxy.user = new Proxy({}, { get() { throw new Error("user not available"); } });
    const nullUser = { ...session(USER_A, "SECRETSID-1"), user: null } as unknown as Session;
    for (const s of [proxy as unknown as Session, nullUser, session(USER_A, "SECRETSID-1", "aal1", null)]) {
      const h = harness();
      h.emit("SIGNED_IN", s);
      await flush();
      await flush();
      expect(h.sub.getSnapshot()).toMatchObject({ availability: "unverified", principal_partition: USER_A });
      await h.settle(h.last(), { data: null, error: { name: "AuthInvalidJwtError" } });
      expect(h.sub.getSnapshot().availability).toBe("unverified");
      expect(h.seen.every((x) => x.availability !== "ready")).toBe(true);
      // Only the SDK's verification of the exact token promotes it.
      h.emit("SIGNED_IN", s);
      await flush();
      await h.settle();
      expect(h.sub.getSnapshot().availability).toBe("ready");
    }
  });

  const notVerified: Array<[string, (c: Check) => void]> = [
    ["an error result", (c) => c.resolve({ data: null, error: { name: "AuthInvalidJwtError", message: "Invalid JWT signature" } })],
    ["a rejected call", (c) => c.reject(new Error("network"))],
    ["an undefined result", (c) => c.resolve(undefined)],
    ["data without claims", (c) => c.resolve({ data: { claims: null }, error: null })],
    ["array claims", (c) => c.resolve({ data: { claims: [claimsOf(c.token)] }, error: null })],
    ["claims with no error field", (c) => c.resolve({ data: { claims: claimsOf(c.token) } })],
    ["claims next to an error", (c) => c.resolve({ data: { claims: claimsOf(c.token) }, error: { name: "AuthError" } })],
  ];

  it.each(notVerified)("%s leaves the identity unverified on the same epoch, with no retry of its own", async (_n, finish) => {
    const h = harness();
    const s = session(USER_A, "SECRETSID-1");
    h.emit("SIGNED_IN", s);
    const unverified = h.sub.getSnapshot();
    await flush();
    finish(h.last());
    await flush();
    await flush();
    expect(h.sub.getSnapshot()).toBe(unverified);
    expect(h.getClaims).toHaveBeenCalledTimes(1);
    // The SDK's next event for the same identity checks again.
    h.emit("SIGNED_IN", s);
    expect(h.sub.getSnapshot()).toBe(unverified);
    await flush();
    expect(h.getClaims).toHaveBeenCalledTimes(2);
    await h.settle();
    expect(h.sub.getSnapshot()).toEqual({ ...unverified, availability: "ready" });
  });

  it("a getClaims that throws synchronously stays unverified", async () => {
    const h = harness();
    h.getClaims.mockImplementationOnce(() => { throw new Error("sync"); });
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    const unverified = h.sub.getSnapshot();
    await flush();
    await flush();
    expect(h.sub.getSnapshot()).toBe(unverified);
  });

  const mismatched: Array<[string, (claims: Record<string, unknown>) => Record<string, unknown>]> = [
    ["another sub", (c) => ({ ...c, sub: USER_B })],
    ["another session_id", (c) => ({ ...c, session_id: "SECRETSID-other" })],
    ["another aal", (c) => ({ ...c, aal: "aal2" })],
    ["a missing aal", ({ aal: _aal, ...c }) => c],
    ["a missing session_id", ({ session_id: _sid, ...c }) => c],
  ];

  it.each(mismatched)("verified claims with %s fail closed: unavailable, principal null, new epoch", async (_n, change) => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    const e1 = h.sub.getSnapshot().auth_epoch;
    await flush();
    const c = h.last();
    await h.settle(c, { data: { claims: change(claimsOf(c.token)), header: {}, signature: new Uint8Array() }, error: null });
    const s = h.sub.getSnapshot();
    expect(s).toMatchObject({ availability: "unavailable", principal_partition: null });
    expect(s.auth_epoch).toMatch(HEX32);
    expect(s.auth_epoch).not.toBe(e1);
  });
});

describe("generation fence: a deferred result applies only while it is the pending check", () => {
  it("is ignored after sign-out", async () => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    await flush();
    const first = h.last();
    h.emit("SIGNED_OUT", null);
    const out = h.sub.getSnapshot();
    await h.settle(first);
    expect(h.sub.getSnapshot()).toBe(out);
    expect(out).toMatchObject({ availability: "unavailable", principal_partition: null });
  });

  it("is ignored after same-user A, B, A on the original session", async () => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    await flush();
    h.emit("SIGNED_IN", session(USER_B, "SECRETSID-2"));
    await flush();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    const aba = h.sub.getSnapshot();
    await flush();
    expect(h.checks).toHaveLength(3);
    await h.settle(h.checks[0]);
    await h.settle(h.checks[1]);
    expect(h.sub.getSnapshot()).toBe(aba);
    expect(aba).toMatchObject({ availability: "unverified", principal_partition: USER_A });
    await h.settle(h.checks[2]);
    expect(h.sub.getSnapshot()).toEqual({ ...aba, availability: "ready" });
  });

  it("is ignored after same-user reauthentication onto a new session", async () => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    await flush();
    const first = h.last();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-2"));
    const reauth = h.sub.getSnapshot();
    await h.settle(first);
    expect(h.sub.getSnapshot()).toBe(reauth);
    expect(reauth.availability).toBe("unverified");
  });

  it.each([
    ["USER_UPDATED", "SECRETSID-1", "aal1"],
    ["MFA_CHALLENGE_VERIFIED", "SECRETSID-1", "aal2"],
  ])("is ignored after a newer %s, which then needs its own check", async (event, sid, aal) => {
    const h = harness();
    const s = session(USER_A, "SECRETSID-1");
    h.emit("SIGNED_IN", s);
    await flush();
    const first = h.last();
    h.emit(event, aal === "aal1" ? s : session(USER_A, sid, aal));
    const newer = h.sub.getSnapshot();
    expect(newer.auth_epoch).not.toBe(h.seen[0]?.auth_epoch ?? "");
    await h.settle(first);
    expect(h.sub.getSnapshot()).toBe(newer);
    await flush();
    await h.settle();
    expect(h.sub.getSnapshot()).toEqual({ ...newer, availability: "ready" });
  });

  it("is ignored after password recovery, which starts no check", async () => {
    const h = harness();
    const s = session(USER_A, "SECRETSID-1");
    h.emit("SIGNED_IN", s);
    await flush();
    const first = h.last();
    h.emit("PASSWORD_RECOVERY", s);
    const rec = h.sub.getSnapshot();
    await h.settle(first);
    expect(h.sub.getSnapshot()).toBe(rec);
    expect(rec.availability).toBe("unverified");
    expect(h.checks).toHaveLength(1);
  });

  it("a stale INITIAL_SESSION check is ignored, and a late INITIAL_SESSION never replaces a later session", async () => {
    const h = harness();
    const initial = session(USER_A, "SECRETSID-1");
    h.emit("INITIAL_SESSION", initial);
    await flush();
    const initialCheck = h.last();
    const later = session(USER_A, "SECRETSID-2");
    h.emit("SIGNED_IN", later);
    const s2 = h.sub.getSnapshot();
    for (const stale of [initial, session(USER_B, "SECRETSID-3"), null]) h.emit("INITIAL_SESSION", stale);
    expect(h.sub.getSnapshot()).toBe(s2);
    await flush();
    expect(h.checks.map((c) => c.token)).toEqual([initial.access_token, later.access_token]);
    await h.settle(initialCheck);
    expect(h.sub.getSnapshot()).toBe(s2);
    await h.settle(h.checks[1]);
    expect(h.sub.getSnapshot()).toEqual({ ...s2, availability: "ready" });
    h.emit("INITIAL_SESSION", initial);
    expect(h.sub.getSnapshot()).toEqual({ ...s2, availability: "ready" });
  });

  it("a superseded token's success cannot promote when the latest token fails", async () => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    const unverified = h.sub.getSnapshot();
    await flush();
    const older = h.last();
    h.emit("TOKEN_REFRESHED", session(USER_A, "SECRETSID-1"));
    expect(h.sub.getSnapshot()).toBe(unverified);
    await flush();
    const newer = h.last();
    expect(newer).not.toBe(older);
    await h.settle(newer, { data: null, error: { name: "AuthInvalidJwtError" } });
    await h.settle(older);
    expect(h.sub.getSnapshot()).toBe(unverified);
  });

  it("the same token observed again while its check is in flight starts no second check", async () => {
    const h = harness();
    const s = session(USER_A, "SECRETSID-1");
    h.emit("SIGNED_IN", s);
    await flush();
    h.emit("SIGNED_IN", s);
    h.emit("INITIAL_SESSION", s);
    await flush();
    expect(h.getClaims).toHaveBeenCalledTimes(1);
    await h.settle();
    expect(h.sub.getSnapshot().availability).toBe("ready");
  });

  it("is ignored after unsubscribe, and a check not yet started never starts", async () => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    await flush();
    const first = h.last();
    h.sub.unsubscribe();
    const closed = h.sub.getSnapshot();
    await h.settle(first);
    expect(h.sub.getSnapshot()).toBe(closed);
    expect(closed).toMatchObject({ availability: "unavailable", principal_partition: null });

    const h2 = harness();
    h2.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    h2.sub.unsubscribe();
    await flush();
    await flush();
    expect(h2.getClaims).not.toHaveBeenCalled();
    expect(h2.seen).toHaveLength(0);
  });
});

describe("event policy once verified (mocked client)", () => {
  it("a harmless focus or duplicate SIGNED_IN keeps a verified epoch with no new check or notice", async () => {
    const h = harness();
    const ready = await h.confirm("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    expect(ready.availability).toBe("ready");
    const notices = h.seen.length;
    for (let i = 0; i < 5; i++) h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    h.emit("TOKEN_REFRESHED", session(USER_A, "SECRETSID-1"));
    expect(h.sub.getSnapshot()).toBe(ready);
    await flush();
    expect(h.getClaims).toHaveBeenCalledTimes(1);
    expect(h.seen).toHaveLength(notices);
  });

  it("a new session for the same user gets a new epoch and needs its own check", async () => {
    const h = harness();
    const ready = await h.confirm("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-2"));
    const s2 = h.sub.getSnapshot();
    expect(s2).toMatchObject({ availability: "unverified", principal_partition: USER_A });
    expect(s2.auth_epoch).toMatch(HEX32);
    expect(s2.auth_epoch).not.toBe(ready.auth_epoch);
    await flush();
    await h.settle();
    expect(h.sub.getSnapshot()).toEqual({ ...s2, availability: "ready" });
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
    expect(h.seen).toEqual([{ availability: "unverified", principal_partition: USER_A, auth_epoch: epochs[2] }]);
  });

  it("USER_UPDATED rotates even with the same session, token and aal, then needs a new check", async () => {
    const h = harness();
    const s = session(USER_A, "SECRETSID-1");
    const ready = await h.confirm("SIGNED_IN", s);
    h.emit("USER_UPDATED", sessionFor(s.access_token, { id: USER_A, email: "changed@example.invalid" }));
    const updated = h.sub.getSnapshot();
    expect(updated).toMatchObject({ availability: "unverified", principal_partition: USER_A });
    expect(updated.auth_epoch).not.toBe(ready.auth_epoch);
    await flush();
    expect(h.last().token).toBe(s.access_token);
    await h.settle();
    expect(h.sub.getSnapshot()).toEqual({ ...updated, availability: "ready" });
  });

  it("an aal change rotates, and MFA_CHALLENGE_VERIFIED always rotates", async () => {
    const h = harness();
    const e1 = (await h.confirm("SIGNED_IN", session(USER_A, "SECRETSID-1", "aal1"))).auth_epoch;
    const s2 = await h.confirm("TOKEN_REFRESHED", session(USER_A, "SECRETSID-1", "aal2"));
    expect(s2.availability).toBe("ready");
    expect(s2.auth_epoch).not.toBe(e1);
    h.emit("MFA_CHALLENGE_VERIFIED", session(USER_A, "SECRETSID-1", "aal2"));
    const after = h.sub.getSnapshot();
    expect(after.availability).toBe("unverified");
    expect(after.auth_epoch).not.toBe(s2.auth_epoch);
  });

  it("PASSWORD_RECOVERY rotates and holds unverified with no check until USER_UPDATED", async () => {
    const h = harness();
    const s = session(USER_A, "SECRETSID-1");
    const e1 = (await h.confirm("SIGNED_IN", s)).auth_epoch;
    h.emit("PASSWORD_RECOVERY", s);
    const rec = h.sub.getSnapshot();
    expect(rec.availability).toBe("unverified");
    expect(rec.auth_epoch).not.toBe(e1);
    h.emit("PASSWORD_RECOVERY", s);
    h.emit("SIGNED_IN", s);
    h.emit("TOKEN_REFRESHED", session(USER_A, "SECRETSID-1"));
    h.emit("INITIAL_SESSION", s);
    expect(h.sub.getSnapshot()).toBe(rec);
    await flush();
    expect(h.getClaims).toHaveBeenCalledTimes(1);
    h.emit("USER_UPDATED", s);
    const updated = h.sub.getSnapshot();
    expect(updated.availability).toBe("unverified");
    expect(updated.auth_epoch).not.toBe(rec.auth_epoch);
    await flush();
    await h.settle();
    expect(h.sub.getSnapshot()).toEqual({ ...updated, availability: "ready" });
  });

  it("a different session ends the recovery hold", async () => {
    const h = harness();
    h.emit("PASSWORD_RECOVERY", session(USER_A, "SECRETSID-1"));
    const rec = h.sub.getSnapshot();
    const after = await h.confirm("SIGNED_IN", session(USER_A, "SECRETSID-2"));
    expect(after.availability).toBe("ready");
    expect(after.auth_epoch).not.toBe(rec.auth_epoch);
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

  it.each(unreadable)("fails closed on %s: unavailable, principal null, new epoch, no check", async (_name, make) => {
    const h = harness();
    const e1 = (await h.confirm("SIGNED_IN", session(USER_A, "SECRETSID-1"))).auth_epoch;
    h.emit("SIGNED_IN", make());
    const s = h.sub.getSnapshot();
    expect(s.availability).toBe("unavailable");
    expect(s.principal_partition).toBeNull();
    expect(s.auth_epoch).not.toBe(e1);
    await flush();
    expect(h.getClaims).toHaveBeenCalledTimes(1);
  });

  it("SIGNED_OUT and unknown events fail closed even with a readable session", async () => {
    for (const event of ["SIGNED_OUT", "USER_DELETED", ""]) {
      const h = harness();
      const e1 = (await h.confirm("SIGNED_IN", session(USER_A, "SECRETSID-1"))).auth_epoch;
      h.emit(event, session(USER_A, "SECRETSID-1"));
      expect(h.sub.getSnapshot()).toEqual({ availability: "unavailable", principal_partition: null, auth_epoch: expect.not.stringMatching(e1) });
    }
  });

  it("the callback never calls back into Supabase and never notifies synchronously", async () => {
    const h = harness();
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    h.emit("TOKEN_REFRESHED", session(USER_A, "SECRETSID-2"));
    h.emit("USER_UPDATED", session(USER_A, "SECRETSID-2"));
    h.emit("SIGNED_OUT", null);
    expect(h.seen).toHaveLength(0);
    expect(h.getClaims).not.toHaveBeenCalled();
    for (const trap of Object.values(h.traps)) expect(trap).not.toHaveBeenCalled();
    await flush();
    expect(h.seen).toHaveLength(1);
    expect(h.getClaims).not.toHaveBeenCalled();
    expect(h.callsInCallback()).toBe(0);
  });

  it("exposes exactly three fields and no token, session id, aal or refresh material", async () => {
    const h = harness();
    await h.confirm("SIGNED_IN", session(USER_A, "SECRETSID-1", "aal2"));
    await flush();
    expect(h.seen.length).toBeGreaterThan(0);
    for (const s of [h.sub.getSnapshot(), ...h.seen]) {
      expect(Object.keys(s).sort()).toEqual(["auth_epoch", "availability", "principal_partition"]);
      const text = JSON.stringify(s);
      expect(text).not.toMatch(/SECRET|aal|session|token|refresh|claims/i);
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
    const getClaims = vi.fn();
    const bad = subscribeAuthLifecycle(listener, () => ({ getClaims, onAuthStateChange: (c: Emit) => { cb = c; return {}; } }) as unknown as AuthObserver);
    const before = bad.getSnapshot();
    expect(before.availability).toBe("unavailable");
    (cb as unknown as Emit)("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    expect(bad.getSnapshot()).toBe(before);
    await flush();
    expect(listener).not.toHaveBeenCalled();
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("a callback delivered synchronously during subscribe is observed, then checked on a later task", async () => {
    const listener = vi.fn();
    const s = session(USER_A, "SECRETSID-1");
    const getClaims = vi.fn(async (token: string) => verified(token));
    const sub = subscribeAuthLifecycle(listener, () => ({
      getClaims,
      onAuthStateChange: (c: Emit) => {
        c("SIGNED_IN", s);
        return { data: { subscription: { unsubscribe() {} } } };
      },
    }) as unknown as AuthObserver);
    expect(sub.getSnapshot()).toMatchObject({ availability: "unverified", principal_partition: USER_A });
    expect(getClaims).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(sub.getSnapshot().availability).toBe("ready"));
    expect(getClaims).toHaveBeenCalledWith(s.access_token);
  });

  it("an observer without getClaims stays unverified", async () => {
    let cb: Emit | null = null;
    const sub = subscribeAuthLifecycle(() => {}, () => ({
      onAuthStateChange: (c: Emit) => { cb = c; return { data: { subscription: { unsubscribe() {} } } }; },
    }) as unknown as AuthObserver);
    (cb as unknown as Emit)("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    await flush();
    await flush();
    expect(sub.getSnapshot()).toMatchObject({ availability: "unverified", principal_partition: USER_A });
  });

  it("unsubscribe detaches once, retires the identity, and ignores stale callbacks and pending notifications", async () => {
    const h = harness();
    const e1 = (await h.confirm("SIGNED_IN", session(USER_A, "SECRETSID-1"))).auth_epoch;
    h.emit("SIGNED_IN", session(USER_B, "SECRETSID-2"));
    const notices = h.seen.length;
    h.sub.unsubscribe();
    h.sub.unsubscribe();
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    const closed = h.sub.getSnapshot();
    expect(closed).toMatchObject({ availability: "unavailable", principal_partition: null });
    expect(closed.auth_epoch).not.toBe(e1);
    h.stale()("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    expect(h.sub.getSnapshot()).toBe(closed);
    await flush();
    expect(h.seen).toHaveLength(notices);
    expect(h.getClaims).toHaveBeenCalledTimes(1);
  });

  it("a throwing listener is contained and later changes still notify", async () => {
    let calls = 0;
    let cb: Emit | null = null;
    subscribeAuthLifecycle(() => { calls++; throw new Error("consumer bug"); }, () => ({
      getClaims: async () => ({ data: null, error: { name: "AuthError" } }),
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

  it("losing randomness mid-life fails closed and cannot return to ready on an old epoch", async () => {
    const h = harness();
    const e1 = (await h.confirm("SIGNED_IN", session(USER_A, "SECRETSID-1"))).auth_epoch;
    const rng = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(() => { throw new Error("no rng"); });
    h.emit("SIGNED_IN", session(USER_B, "SECRETSID-2"));
    expect(h.sub.getSnapshot()).toEqual({ availability: "unavailable", principal_partition: null, auth_epoch: e1 });
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    expect(h.sub.getSnapshot().availability).toBe("unavailable");
    await flush();
    expect(h.getClaims).toHaveBeenCalledTimes(1);
    rng.mockRestore();
    const back = await h.confirm("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    expect(back.availability).toBe("ready");
    expect(back.auth_epoch).not.toBe(e1);
  });
});

describe("real auth-js client (in-memory storage, mocked fetch, no live network)", () => {
  type Internals = {
    _notifyAllSubscribers(event: string, session: Session | null): Promise<void>;
    _removeSession(): Promise<void>;
    stateChangeEmitters: Map<string, unknown>;
    lockAcquired: boolean;
  };
  type Lock = <R>(name: string, timeout: number, fn: () => Promise<R>) => Promise<R>;
  let keys = 0;
  let globalFetches = 0;

  beforeEach(() => {
    // Each client gets its own fetch below; the global one must never be reached.
    globalFetches = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      globalFetches++;
      throw new Error("global fetch is not allowed");
    });
  });
  afterEach(() => {
    expect(globalFetches).toBe(0);
  });

  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  function realClient(
    stored: Session | null,
    opts: { skipAutoInitialize?: boolean; lock?: Lock; jwks?: unknown; putUser?: (body: Record<string, unknown>) => unknown } = {},
  ) {
    // GLOBAL_JWKS is keyed by storageKey across clients, so each client gets its own key.
    const key = `sb-authlifecycle-test-${++keys}-auth-token`;
    const map = new Map<string, string>();
    if (stored) map.set(key, JSON.stringify(stored));
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
    };
    const puts: Array<Record<string, unknown>> = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (opts.jwks && u === "http://auth.invalid/auth/v1/.well-known/jwks.json" && init?.method === "GET") return json(opts.jwks);
      if (opts.putUser && u === "http://auth.invalid/auth/v1/user" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        return json(opts.putUser(body));
      }
      throw new Error("network is not allowed in this test");
    });
    const client = new AuthClient({
      url: "http://auth.invalid/auth/v1",
      storageKey: key,
      storage,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      skipAutoInitialize: opts.skipAutoInitialize ?? false,
      ...(opts.lock ? { lock: opts.lock } : {}),
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const urls = () => fetch.mock.calls.map(([u, i]) => `${(i as RequestInit | undefined)?.method ?? "GET"} ${String(u)}`);
    return { client, internals: client as unknown as Internals, fetch, urls, map, key, puts };
  }

  /** An ES256 project key: a public JWKS for the mocked endpoint and a signer for test tokens. */
  async function es256() {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const kid = `test-kid-${++keys}`;
    const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid, alg: "ES256", use: "sig" };
    const sign = async (claims: Record<string, unknown>, privateKey: CryptoKey = pair.privateKey) => {
      const signed = `${b64url({ alg: "ES256", kid, typ: "JWT" })}.${b64url(claims)}`;
      const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(signed));
      return `${signed}.${Buffer.from(sig).toString("base64url")}`;
    };
    return { jwks: { keys: [jwk] }, sign };
  }

  const userJson = (sub: string) => ({ id: sub, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" });

  it("a symmetric token the SDK cannot verify offline stays unverified on INITIAL_SESSION and SIGNED_IN (getUser refused)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stored = session(USER_A, "SECRETSID-1");
    const { client, internals, fetch, urls } = realClient(stored);
    await client.initialize();
    const seen: AuthLifecycleSnapshot[] = [];
    const sub = subscribeAuthLifecycle((s) => seen.push(s), () => client);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await flush();
    const unverified = sub.getSnapshot();
    expect(unverified).toMatchObject({ availability: "unverified", principal_partition: USER_A });
    await internals._notifyAllSubscribers("SIGNED_IN", stored);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await flush();
    expect(sub.getSnapshot()).toBe(unverified);
    expect(seen.every((s) => s.availability !== "ready")).toBe(true);
    expect(urls()).toEqual(["GET http://auth.invalid/auth/v1/user", "GET http://auth.invalid/auth/v1/user"]);
    sub.unsubscribe();
  });

  it("an ES256 token verified against the project JWKS reaches ready on the epoch it was observed on", async () => {
    const key = await es256();
    const stored = sessionFor(await key.sign(idClaims(USER_A, "SECRETSID-1")), { id: USER_A });
    const { client, urls } = realClient(stored, { jwks: key.jwks });
    await client.initialize();
    const seen: AuthLifecycleSnapshot[] = [];
    const sub = subscribeAuthLifecycle((s) => seen.push(s), () => client);
    expect(sub.getSnapshot().availability).toBe("pending");
    await vi.waitFor(() => expect(sub.getSnapshot().availability).toBe("ready"));
    const ready = sub.getSnapshot();
    expect(ready.principal_partition).toBe(USER_A);
    expect(seen.map((s) => s.auth_epoch).every((e) => e === ready.auth_epoch)).toBe(true);
    expect(urls()).toEqual(["GET http://auth.invalid/auth/v1/.well-known/jwks.json"]);
    sub.unsubscribe();
  });

  it.each([
    ["a forged signature", async (k: Awaited<ReturnType<typeof es256>>) => {
      const other = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
      return k.sign(idClaims(USER_A, "SECRETSID-1"), other.privateKey);
    }],
    ["an expired token", (k: Awaited<ReturnType<typeof es256>>) => k.sign({ ...idClaims(USER_A, "SECRETSID-1"), exp: 1 })],
  ])("%s stays unverified", async (_n, make) => {
    const key = await es256();
    const stored = sessionFor(await make(key), { id: USER_A });
    const { client, internals } = realClient(stored, { jwks: key.jwks });
    await client.initialize();
    const verify = vi.spyOn(client, "getClaims");
    const sub = subscribeAuthLifecycle(() => {}, () => client);
    await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(1));
    const result = await verify.mock.results[0].value;
    expect(result).toMatchObject({ data: null, error: { name: "AuthInvalidJwtError" } });
    await internals._notifyAllSubscribers("SIGNED_IN", stored);
    await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(2));
    await verify.mock.results[1].value;
    await flush();
    expect(sub.getSnapshot()).toMatchObject({ availability: "unverified", principal_partition: USER_A });
    sub.unsubscribe();
  });

  it("legacy lock path: the init SIGNED_IN arrives while the auth lock is held, and the check starts only after release", async () => {
    const key = await es256();
    const stored = sessionFor(await key.sign(idClaims(USER_A, "SECRETSID-1")), { id: USER_A });
    const lock: Lock = async (_name, _timeout, fn) => await fn();
    const { client, internals } = realClient(stored, { lock, jwks: key.jwks });
    const lockAtCheck: boolean[] = [];
    const original = client.getClaims.bind(client);
    const verify = vi.spyOn(client, "getClaims").mockImplementation(async (token, options) => {
      lockAtCheck.push(internals.lockAcquired);
      return original(token, options);
    });
    // Subscribed in the constructor's tick, like the browser singleton: ours first, then a raw control.
    const sub = subscribeAuthLifecycle(() => {}, () => client);
    const during: Array<{ event: string; lock: boolean; checks: number; availability: string }> = [];
    client.onAuthStateChange((event) => {
      during.push({ event, lock: internals.lockAcquired, checks: verify.mock.calls.length, availability: sub.getSnapshot().availability });
    });
    await client.initialize();
    await vi.waitFor(() => expect(sub.getSnapshot().availability).toBe("ready"));
    expect(during[0]).toEqual({ event: "SIGNED_IN", lock: true, checks: 0, availability: "unverified" });
    expect(during.every((d) => d.lock)).toBe(true);
    expect(lockAtCheck).toEqual([false]);
    sub.unsubscribe();
  });

  it("default lockless path (the Terminal's client has no lock): still no SDK call inside the callback", async () => {
    const key = await es256();
    const stored = sessionFor(await key.sign(idClaims(USER_A, "SECRETSID-1")), { id: USER_A });
    const { client, internals } = realClient(stored, { jwks: key.jwks });
    const verify = vi.spyOn(client, "getClaims");
    const sub = subscribeAuthLifecycle(() => {}, () => client);
    const during: Array<{ event: string; lock: boolean; checks: number }> = [];
    client.onAuthStateChange((event) => {
      during.push({ event, lock: internals.lockAcquired, checks: verify.mock.calls.length });
    });
    await client.initialize();
    await vi.waitFor(() => expect(sub.getSnapshot().availability).toBe("ready"));
    expect(during[0]).toEqual({ event: "SIGNED_IN", lock: false, checks: 0 });
    expect(verify).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });

  it("a real updateUser password change keeps the same session and token, emits USER_UPDATED, rotates the epoch and drops a late reply", async () => {
    const key = await es256();
    const token = await key.sign(idClaims(USER_A, "SECRETSID-1"));
    const stored = sessionFor(token, { id: USER_A });
    const { client, map, key: storageKey, puts } = realClient(stored, { jwks: key.jwks, putUser: () => userJson(USER_A) });
    await client.initialize();
    const sub = subscribeAuthLifecycle(() => {}, () => client);
    await vi.waitFor(() => expect(sub.getSnapshot().availability).toBe("ready"));
    const ready = sub.getSnapshot();
    const begun = beginPolicyPreview(updatePolicyDraft(createPolicyPreviewSession(previewBinding(ready)), PREVIEW_OK));
    const ticket = begun.ticket as PreviewTicket;
    expect(ticket).not.toBeNull();

    const events: string[] = [];
    client.onAuthStateChange((event) => { events.push(event); });
    await flush();
    events.length = 0;
    const { error } = await client.updateUser({ password: "synthetic-test-only" });
    expect(error).toBeNull();
    expect(puts).toHaveLength(1);
    expect(Object.keys(puts[0])).toContain("password");
    expect(events).toEqual(["USER_UPDATED"]);
    expect(JSON.parse(map.get(storageKey) as string).access_token).toBe(token);

    const updated = sub.getSnapshot();
    expect(updated.availability).toBe("unverified");
    expect(updated.auth_epoch).not.toBe(ready.auth_epoch);
    const rebound = updatePolicyBinding(begun.state, previewBinding(updated));
    expect(rebound.pending).toBeNull();
    expect(receivePolicyPreview(rebound, ticket, qualifiedReply(ticket))).toBe(rebound);
    await vi.waitFor(() => expect(sub.getSnapshot()).toEqual({ ...updated, availability: "ready" }));
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

  it("a real sign-out retires a verified identity; unsubscribe removes the SDK emitter", async () => {
    const key = await es256();
    const stored = sessionFor(await key.sign(idClaims(USER_A, "SECRETSID-1")), { id: USER_A });
    const { client, internals, map, key: storageKey } = realClient(stored, { jwks: key.jwks });
    await client.initialize();
    const before = internals.stateChangeEmitters.size;
    const sub = subscribeAuthLifecycle(() => {}, () => client);
    expect(internals.stateChangeEmitters.size).toBe(before + 1);
    await vi.waitFor(() => expect(sub.getSnapshot().availability).toBe("ready"));
    const e1 = sub.getSnapshot().auth_epoch;
    await internals._removeSession();
    expect(map.has(storageKey)).toBe(false);
    const out = sub.getSnapshot();
    expect(out).toMatchObject({ availability: "unavailable", principal_partition: null });
    expect(out.auth_epoch).not.toBe(e1);
    await flush();
    await flush();
    expect(sub.getSnapshot()).toBe(out);
    sub.unsubscribe();
    expect(internals.stateChangeEmitters.size).toBe(before);
  });
});

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
const PREVIEW_OK: PolicyValidation = { ok: true, settings: structuredClone(SETTINGS) };
const qualifiedReply = (t: PreviewTicket): PolicyPreviewResult =>
  ({ state: "qualified", identity: { binding: structuredClone(t.binding), settings: structuredClone(t.settings) },
    signed_start_bp: 12.5, signed_end_bp: -3.25, signed_change_bp: -15.75,
    absolute_change_bp: 15.75, direction: "widened", crosses_zero: true }) as PolicyPreviewResult;
const previewBinding = (s: AuthLifecycleSnapshot): PreviewBinding =>
  ({ ...BINDING, principal_partition: s.principal_partition, auth_epoch: s.auth_epoch });

describe("late preview replies through the frozen IM10 session reducer", () => {
  /** Verify, begin a preview while ready, run the events, let every check the SDK
   * would make succeed, apply only the latest snapshot, then deliver the reply. */
  async function lateReply(events: (signedIn: Session) => Array<[string, Session | null]>) {
    const h = harness();
    const signedIn = session(USER_A, "SECRETSID-1");
    expect((await h.confirm("SIGNED_IN", signedIn)).availability).toBe("ready");
    const begun = beginPolicyPreview(updatePolicyDraft(createPolicyPreviewSession(previewBinding(h.sub.getSnapshot())), PREVIEW_OK));
    const ticket = begun.ticket as PreviewTicket;
    expect(ticket).not.toBeNull();
    const checksBefore = h.checks.length;
    for (const [event, s] of events(signedIn)) h.emit(event, s);
    await flush();
    for (const c of h.checks) if (!c.done) await h.settle(c);
    await flush();
    const rebound = updatePolicyBinding(begun.state, previewBinding(h.sub.getSnapshot()));
    const after = receivePolicyPreview(rebound, ticket, qualifiedReply(ticket));
    return { rebound, after, h, newChecks: h.checks.length - checksBefore };
  }

  const dropped: Array<[string, (s: Session) => Array<[string, Session | null]>]> = [
    ["a new session for the same user", () => [["SIGNED_IN", session(USER_A, "SECRETSID-2")]]],
    ["principal A, B, A on the original session", () => [["SIGNED_IN", session(USER_B, "SECRETSID-3")], ["SIGNED_IN", session(USER_A, "SECRETSID-1")]]],
    ["sign-out then the same session back", (s) => [["SIGNED_OUT", null], ["SIGNED_IN", s]]],
    ["sign-out", () => [["SIGNED_OUT", null]]],
    ["MFA step-up on the same session", () => [["MFA_CHALLENGE_VERIFIED", session(USER_A, "SECRETSID-1", "aal2")]]],
    ["password recovery", (s) => [["PASSWORD_RECOVERY", s]]],
    ["a refresh onto a different session", () => [["TOKEN_REFRESHED", session(USER_A, "SECRETSID-4")]]],
    ["an unreadable session", (s) => [["SIGNED_IN", withToken("a.b")], ["SIGNED_IN", s]]],
    ["a password-change USER_UPDATED with the same session and token", (s) =>
      [["USER_UPDATED", sessionFor(s.access_token, { id: USER_A, updated_at: "2026-10-11T00:00:00Z" })]]],
    ["a profile-only USER_UPDATED (conservative)", (s) =>
      [["USER_UPDATED", sessionFor(s.access_token, { id: USER_A, user_metadata: { name: "x" } })]]],
  ];

  it.each(dropped)("drops the late reply after %s", async (_name, events) => {
    const { rebound, after } = await lateReply(events);
    expect(rebound.pending).toBeNull();
    expect(after).toBe(rebound);
    expect(after.preview).toBeNull();
  });

  const accepted: Array<[string, (s: Session) => Array<[string, Session | null]>]> = [
    ["duplicate and focus SIGNED_IN", (s) => [["SIGNED_IN", s], ["SIGNED_IN", session(USER_A, "SECRETSID-1")]]],
    ["a same-session TOKEN_REFRESHED", () => [["TOKEN_REFRESHED", session(USER_A, "SECRETSID-1")]]],
    ["a late INITIAL_SESSION", (s) => [["INITIAL_SESSION", s], ["INITIAL_SESSION", session(USER_B, "SECRETSID-9")]]],
  ];

  it.each(accepted)("accepts the reply after %s, with no new check", async (_name, events) => {
    const { rebound, after, newChecks } = await lateReply(events);
    expect(newChecks).toBe(0);
    expect(rebound.pending).not.toBeNull();
    expect(after.pending).toBeNull();
    expect(after.preview?.state).toBe("qualified");
  });

  it("a draft made while unverified survives verification; observation alone never reads as ready", async () => {
    const h = harness();
    h.emit("INITIAL_SESSION", session(USER_A, "SECRETSID-1"));
    expect(h.sub.getSnapshot().availability).toBe("unverified");
    const drafted = updatePolicyDraft(createPolicyPreviewSession(previewBinding(h.sub.getSnapshot())), PREVIEW_OK);
    h.emit("SIGNED_IN", session(USER_A, "SECRETSID-1"));
    expect(h.sub.getSnapshot().availability).toBe("unverified");
    await flush();
    await h.settle();
    expect(h.sub.getSnapshot().availability).toBe("ready");
    expect(updatePolicyBinding(drafted, previewBinding(h.sub.getSnapshot()))).toBe(drafted);
  });
});
