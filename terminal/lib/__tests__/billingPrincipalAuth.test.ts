import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  token: "session-a" as string | null,
  refreshed: null as string | null,
  user: { id: "principal-a" } as { id?: unknown } | null,
  error: null as { status?: number; name?: string } | null,
  verified: [] as string[],
  readSession: 0,
  switchCookies: false,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: {
    getSession: async () => {
      h.readSession++;
      const token = h.refreshed ?? h.token;
      if (h.switchCookies) h.token = "session-b";
      return { data: { session: token ? { access_token: token } : null }, error: null };
    },
    getUser: async (token: string) => {
      h.verified.push(token);
      const user = h.switchCookies ? { id: token === "session-a" ? "principal-a" : "principal-b" } : h.user;
      return { data: { user }, error: h.error };
    },
  } }),
}));
beforeEach(() => {
  vi.resetModules();
  Object.assign(h, { token: "session-a", refreshed: null, user: { id: "principal-a" }, error: null, verified: [], readSession: 0, switchCookies: false });
});
async function gateway() { return import("@/app/api/billing/gateway"); }

describe("existing billing verifier principal projection", () => {
  it("returns the principal verified for precisely the refreshed session token", async () => {
    h.refreshed = "refreshed-a";
    const { billingPrincipalAuthResult } = await gateway();
    expect(await billingPrincipalAuthResult()).toEqual({ status: "ok", token: "refreshed-a", principal: "principal-a" });
    expect(h.verified).toEqual(["refreshed-a"]);
    expect(h.readSession).toBe(1);
  });
  it("keeps principal and token from one verification when cookie state changes between reads", async () => {
    h.switchCookies = true;
    const { billingPrincipalAuthResult } = await gateway();
    expect(await billingPrincipalAuthResult()).toEqual({ status: "ok", token: "session-a", principal: "principal-a" });
    expect(h.token).toBe("session-b");
    expect(h.verified).toEqual(["session-a"]);
  });
  it("preserves both legacy token-only result contracts", async () => {
    const { billingAuthResult, billingAuth } = await gateway();
    expect(await billingAuthResult()).toEqual({ status: "ok", token: "session-a" });
    expect(await billingAuth()).toEqual({ token: "session-a" });
  });
  it("never verifies a cookie-only or absent session", async () => {
    h.token = null;
    const { billingPrincipalAuthResult } = await gateway();
    expect(await billingPrincipalAuthResult()).toEqual({ status: "denied" });
    expect(h.verified).toEqual([]);
  });
  it("does not replace a missing verified user with cookie identity", async () => {
    h.user = null;
    const { billingPrincipalAuthResult } = await gateway();
    expect(await billingPrincipalAuthResult()).toEqual({ status: "denied" });
  });
  it.each([undefined, "", 42])("refuses malformed principal %j only on the principal-requiring projection", async (id) => {
    h.user = { id };
    const { billingPrincipalAuthResult, billingAuthResult } = await gateway();
    expect(await billingPrincipalAuthResult()).toEqual({ status: "denied" });
    expect(await billingAuthResult()).toEqual({ status: "ok", token: "session-a" });
  });
  it.each([
    [{ status: 401 }, "denied"], [{ status: 403 }, "denied"],
    [{ status: 429 }, "unavailable"], [{ status: 503 }, "unavailable"],
    [{ name: "AuthRetryableFetchError" }, "unavailable"],
  ] as const)("preserves original auth error classification %j", async (error, status) => {
    h.error = error;
    const { billingPrincipalAuthResult, billingAuthResult } = await gateway();
    expect(await billingPrincipalAuthResult()).toEqual({ status });
    expect(await billingAuthResult()).toEqual({ status });
  });
});
