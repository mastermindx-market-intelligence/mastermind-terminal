import { beforeEach, expect, it, vi } from "vitest";
import { readScenarioSession } from "@/lib/scenarioSessionServer";
const auth = vi.hoisted(() => ({ getSession: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth }) }));
beforeEach(() => {
  auth.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: "verified-token" } }, error: null });
  auth.getUser.mockReset().mockResolvedValue({ data: { user: { id: "owner", is_anonymous: false } }, error: null });
});
it("verifies precisely the session token before returning its subject and native credential", async () => {
  expect(await readScenarioSession("owner")).toEqual({ status: "ok", userId: "owner", token: "verified-token" });
  expect(auth.getUser.mock.calls).toEqual([["verified-token"]]);
});
it("refuses a session identity transition instead of forwarding another owner's token", async () => {
  expect(await readScenarioSession("other-owner")).toEqual({ status: "denied" });
});
it("requires verification even if cookie metadata names an owner", async () => {
  auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
  expect(await readScenarioSession()).toEqual({ status: "denied" });
});
it("keeps network/capacity authentication uncertainty distinct from denial", async () => {
  auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 503 } });
  expect(await readScenarioSession()).toEqual({ status: "unavailable" });
  auth.getSession.mockRejectedValue(new Error("private credential diagnostic"));
  expect(await readScenarioSession()).toEqual({ status: "unavailable" });
});
it("does not verify or forward absent, oversized or whitespace-bearing credentials", async () => {
  for (const access_token of ["", "x y", "x".repeat(16385)]) {
    auth.getSession.mockResolvedValue({ data: { session: { access_token } }, error: null });
    expect(await readScenarioSession()).toEqual({ status: "denied" });
  }
  expect(auth.getUser).not.toHaveBeenCalled();
});
it("anonymous users cannot invoke the private scenario source", async () => {
  auth.getUser.mockResolvedValue({ data: { user: { id: "owner", is_anonymous: true } }, error: null });
  expect(await readScenarioSession()).toEqual({ status: "denied" });
});
