import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMBER_READ_TIMEOUT_MS, readShellClaims } from "@/lib/shared-shell/memberIdentity";

const auth = vi.hoisted(() => ({ createClient: vi.fn(), getClaims: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: auth.createClient }));
const subject = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  auth.createClient.mockReset(); auth.getClaims.mockReset(); auth.getUser.mockReset();
  auth.createClient.mockResolvedValue({ auth: { getClaims: auth.getClaims, getUser: auth.getUser } });
});
afterEach(() => { expect(auth.getUser).not.toHaveBeenCalled(); vi.useRealTimers(); });

describe("bounded local shell claims identity", () => {
  it("returns only the verified immutable subject and display email", async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: subject, email: "member@example.com", role: "admin", user_metadata: { email: "other@example.com" } } }, error: null });
    expect(await readShellClaims()).toEqual({ state: "ready", subjectId: subject, email: "member@example.com" });
    expect(auth.getClaims).toHaveBeenCalledOnce();
  });
  it("retains a verified account without a display email", async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: subject, email: 42 } }, error: null });
    expect(await readShellClaims()).toEqual({ state: "ready", subjectId: subject, email: "" });
  });
  it.each([null, {}, { sub: "not-a-uuid" }, { sub: 42 }])("does not create an account from absent or malformed claims %s", async claims => {
    auth.getClaims.mockResolvedValue({ data: { claims }, error: null });
    expect(await readShellClaims()).toEqual({ state: "guest" });
  });
  it("distinguishes a proven missing session", async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: { name: "AuthSessionMissingError" } });
    expect(await readShellClaims()).toEqual({ state: "guest" });
  });
  it.each([401, 403, 503])("preserves unknown access for an unrelated HTTP%s verification error", async status => {
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: subject, email: "member@example.com" } }, error: { name: "AuthUnknownError", status } });
    expect(await readShellClaims()).toEqual({ state: "unavailable" });
  });
  it.each(["client", "claims"])("handles a thrown %s failure", async edge => {
    if (edge === "client") auth.createClient.mockRejectedValue(Error("offline"));
    else auth.getClaims.mockRejectedValue(Error("offline"));
    expect(await readShellClaims()).toEqual({ state: "unavailable" });
  });
  it("bounds a pending verifier and ignores its late account result", async () => {
    vi.useFakeTimers(); let settle!: (value: unknown) => void;
    auth.getClaims.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
    const pending = readShellClaims();
    await vi.advanceTimersByTimeAsync(MEMBER_READ_TIMEOUT_MS + 1);
    expect(await pending).toEqual({ state: "unavailable" });
    settle({ data: { claims: { sub: subject } }, error: null });
    await Promise.resolve();
    expect(await pending).toEqual({ state: "unavailable" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
