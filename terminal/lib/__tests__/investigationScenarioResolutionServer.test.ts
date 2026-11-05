import { beforeEach, expect, it, vi } from "vitest";
import { handleSavedScenarioResolution } from "@/lib/investigationScenarioResolutionServer";
const state = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/scenarioSessionServer", () => ({ readScenarioSession: state.auth }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: state.limit }));
const id = "10000000-0000-4000-8000-000000000001", grant = "20000000-0000-4000-8000-000000000002";
const body = { investigation_id: id, revision: 4, grant_id: null as string | null };
const request = (value: unknown = body, authorization = "Bearer attacker-header") => new Request("https://terminal.test/api/investigation-scenarios", { method: "POST", headers: { Authorization: authorization }, body: JSON.stringify(value) });
const transport = vi.fn();
beforeEach(() => {
  transport.mockReset().mockResolvedValue({ status: "not_found" });
  state.auth.mockReset().mockResolvedValue({ status: "ok", userId: "owner", token: "verified-cookie-token" });
  state.limit.mockReset().mockReturnValue({ ok: true });
});
it("forwards only exact canonical context and the verified session token, never an incoming bearer", async () => {
  const response = await handleSavedScenarioResolution(request({ ...body, grant_id: grant }), transport);
  expect(transport.mock.calls).toEqual([[{ ...body, grant_id: grant, mode: "resolve" }, "verified-cookie-token"]]);
  expect(response.status).toBe(404);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("refuses unauthenticated and uncertain sessions before native transport", async () => {
  for (const [status, http] of [["denied", 401], ["unavailable", 503]] as const) {
    state.auth.mockResolvedValue({ status });
    expect((await handleSavedScenarioResolution(request(), transport)).status).toBe(http);
  }
  expect(transport).not.toHaveBeenCalled();
});
it("refuses overrides, incomplete context, malformed revisions and oversized input before native IO", async () => {
  for (const bad of [{ ...body, capture: {} }, { ...body, user_id: "other" }, { ...body, revision: 0 }, { ...body, revision: "4" }, { ...body, investigation_id: "bad" }, { ...body, grant_id: undefined }, "x".repeat(2048)]) {
    expect((await handleSavedScenarioResolution(request(bad), transport)).status).toBe(400);
  }
  expect(transport).not.toHaveBeenCalled();
});
it("refuses a differently bound answer and never returns raw byte/credential fields", async () => {
  transport.mockResolvedValue({ status: "resolved", ...body, revision: 5, gex: "private", token: "private" });
  expect((await handleSavedScenarioResolution(request(), transport)).status).toBe(503);
  transport.mockResolvedValue({ status: "resolved", ...body, capture: {}, basis: {}, result: {}, gex: "private", token: "private" });
  const response = await handleSavedScenarioResolution(request(), transport);
  expect(await response.json()).toEqual({ status: "resolved", ...body, capture: {}, basis: {}, result: {} });
});
it("keeps every capacity/authority/transport failure private and nondisclosing", async () => {
  state.limit.mockReturnValue({ ok: false });
  let response = await handleSavedScenarioResolution(request(), transport);
  expect(response.status).toBe(429); expect(transport).not.toHaveBeenCalled();
  state.limit.mockReturnValue({ ok: true }); transport.mockRejectedValue(new Error("secret"));
  response = await handleSavedScenarioResolution(request(), transport);
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  transport.mockResolvedValue({ status: "denied", reason: "private diagnostic" });
  response = await handleSavedScenarioResolution(request(), transport);
  expect(response.status).toBe(403); expect(await response.json()).toEqual({ status: "denied" });
});
