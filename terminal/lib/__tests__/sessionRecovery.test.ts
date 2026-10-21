import { describe, expect, it, vi } from "vitest";
import { hasSupabaseAuthCookie, recoverMemberSession } from "@/lib/supabase/sessionRecovery";

function storage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("member session recovery", () => {
  it("detects shared Supabase session cookies, including chunk 0, but not verifier cookies", () => {
    expect(hasSupabaseAuthCookie("x=1; sb-proj-auth-token.0=part; other=2")).toBe(true);
    expect(hasSupabaseAuthCookie("sb-proj-auth-token=base64-session")).toBe(true);
    expect(hasSupabaseAuthCookie("sb-proj-auth-token-code-verifier=1; foo=bar")).toBe(false);
    expect(hasSupabaseAuthCookie("unrelated=1")).toBe(false);
  });

  it("does not contact Auth or reload for a genuine guest", async () => {
    const verify = vi.fn();
    const navigate = vi.fn();
    expect(await recoverMemberSession({ cookieHeader: "x=1", verify, navigate })).toBe("guest");
    expect(verify).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("verifies a surviving session with Auth and performs one fresh same-route navigation", async () => {
    const store = storage(), verify = vi.fn().mockResolvedValue({ user: true }), navigate = vi.fn();
    const options = { cookieHeader: "sb-proj-auth-token.0=part", verify, navigate, storage: store, now: 100_000 };
    expect(await recoverMemberSession(options)).toBe("restoring");
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(await recoverMemberSession(options)).toBe("unavailable");
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(await recoverMemberSession({ ...options, manualRetry: true })).toBe("restoring");
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it("recognizes revoked/invalid sessions without granting member access", async () => {
    for (const error of [{ status: 400 }, { status: 401 }, { name: "AuthSessionMissingError" }]) {
      const navigate = vi.fn();
      expect(await recoverMemberSession({ cookieHeader: "sb-proj-auth-token=old", verify: async () => ({ user: false, error }), navigate }))
        .toBe("guest");
      expect(navigate).not.toHaveBeenCalled();
    }
  });

  it("rechecks one null-session race after another tab rotates shared auth cookies", async () => {
    for (const first of [
      { user: false, error: { name: "AuthSessionMissingError" } },
      { user: false, error: { name: "AuthRefreshDiscardedError" } },
      { user: false, error: null },
    ]) {
      const verify = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce({ user: true, error: null });
      const navigate = vi.fn();
      expect(await recoverMemberSession({ cookieHeader: "sb-proj-auth-token.0=cookie", verify, navigate, storage: storage() }))
        .toBe("restoring");
      expect(verify).toHaveBeenCalledTimes(2);
      expect(navigate).toHaveBeenCalledTimes(1);
    }
  });

  it("does not promote an invalid/revoked session after bounded repeat verification", async () => {
    const verify = vi.fn().mockResolvedValue({ user: false, error: { name: "AuthSessionMissingError" } });
    const navigate = vi.fn();
    expect(await recoverMemberSession({ cookieHeader: "sb-proj-auth-token=stale", verify, navigate })).toBe("guest");
    expect(verify).toHaveBeenCalledTimes(2);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not turn two ambiguous null-user answers into a signup prompt", async () => {
    // No verified identity and no provider invalidation is NOT proof of logout.
    // A competing refresh can yield these while the shared cookie survives.
    const verify = vi.fn().mockResolvedValue({ user: false, error: null });
    const navigate = vi.fn();
    expect(await recoverMemberSession({ cookieHeader: "sb-proj-auth-token.0=part", verify, navigate }))
      .toBe("unavailable");
    expect(verify).toHaveBeenCalledTimes(2);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps transient Auth outages distinct from sign-out and offers retry", async () => {
    const navigate = vi.fn();
    for (const verify of [async () => ({ user: false, error: { status: 503 } }), async (): Promise<{user: boolean}> => { throw Error("offline"); }]) {
      expect(await recoverMemberSession({ cookieHeader: "sb-proj-auth-token=old", verify, navigate })).toBe("unavailable");
      expect(navigate).not.toHaveBeenCalled();
    }
  });
});
